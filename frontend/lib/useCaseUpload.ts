"use client";

/**
 * useCaseUpload — shared upload pipeline hook.
 *
 * Drives the per-file flow that every page handling evidence uses:
 *   1. SHA-256 in browser via crypto.subtle.digest
 *   2. POST /api/ingest/sign-upload      (reserve documents row, get signed PUT)
 *   3. PUT bytes → object storage         (browser-direct, with progress events)
 *   4. POST /api/ingest/commit           (HEAD storage, flip status, enqueue extraction)
 *
 * Used by:
 *   - /cases/new           — initial intake
 *   - /cases/[id]          — adding more evidence to an existing case
 *
 * Returns local "in-flight" file state — the page is responsible for showing
 * server-side rows separately (e.g. via getCaseStatus polling) and removing
 * local chips once the corresponding document_id appears on the server.
 */
import { useCallback, useRef, useState } from "react";

import {
  ApiError,
  commitUpload,
  signUpload,
  uploadToStorage,
} from "@/lib/api";
import { sha256Hex } from "@/lib/sha256";
import { type LocalFile } from "@/components/FileRow";

function uid(): string {
  return crypto.randomUUID();
}

/** Best-effort MIME sniff from the extension if the browser didn't supply one. */
function mimeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
    case "htm":
      return "text/html";
    case "txt":
    case "md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/** Mirror of backend/ingestion/extractors/registry.py — keep in sync. */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "text/plain",
  "text/markdown",
]);

export const SUPPORTED_FILES_LABEL = "PDF · DOCX · HTML · plain text";

export interface UseCaseUploadOptions {
  /** Max concurrent uploads (browser cap is ~6 per host; default 3). */
  concurrency?: number;
  /** Notified when a file finishes commit (document_id known + on server). */
  onCommitted?: (documentId: string) => void;
  /** Notified when a file is rejected client-side for unsupported MIME. */
  onRejected?: (rejected: File[]) => void;
}

export function useCaseUpload(caseUuid: string, opts: UseCaseUploadOptions = {}) {
  const { concurrency = 3, onCommitted, onRejected } = opts;
  const [files, setFiles] = useState<LocalFile[]>([]);
  const cursorRef = useRef(0);

  const setRow = useCallback((rowUid: string, patch: Partial<LocalFile>) => {
    setFiles((prev) => prev.map((r) => (r.uid === rowUid ? { ...r, ...patch } : r)));
  }, []);

  const runOne = useCallback(
    async (row: LocalFile) => {
      try {
        setRow(row.uid, { stage: "hashing", progress: 0 });
        const sha256 = await sha256Hex(row.file);
        setRow(row.uid, { sha256 });

        setRow(row.uid, { stage: "signing" });
        const presign = await signUpload({
          case_id: caseUuid,
          filename: row.file.name,
          mime_type: mimeOf(row.file),
          size: row.file.size,
          sha256,
        });
        setRow(row.uid, { documentId: presign.document_id });

        setRow(row.uid, { stage: "uploading", progress: 0 });
        await uploadToStorage(presign, row.file, (pct) =>
          setRow(row.uid, { progress: pct }),
        );

        setRow(row.uid, { stage: "committing" });
        const committed = await commitUpload(presign.document_id);
        setRow(row.uid, {
          stage: committed.status === "extracting" ? "extracting" : "uploaded",
        });
        onCommitted?.(presign.document_id);
      } catch (err) {
        setRow(row.uid, {
          stage: "failed",
          error: err instanceof ApiError ? err.message : String(err),
        });
      }
    },
    [caseUuid, setRow, onCommitted],
  );

  const addFiles = useCallback(
    async (picked: File[]): Promise<{ accepted: number; rejected: number }> => {
      // Client-side MIME filter so unsupported types (images, etc.) get a
      // friendly inline rejection instead of a 400 from the backend.
      const accepted: File[] = [];
      const rejected: File[] = [];
      for (const f of picked) {
        if (SUPPORTED_MIME_TYPES.has(mimeOf(f))) accepted.push(f);
        else rejected.push(f);
      }
      if (rejected.length > 0) onRejected?.(rejected);
      if (accepted.length === 0) return { accepted: 0, rejected: rejected.length };

      const queued: LocalFile[] = accepted.map((f) => ({
        uid: uid(),
        file: f,
        stage: "queued",
        progress: 0,
      }));
      setFiles((prev) => [...prev, ...queued]);

      // Bounded concurrency so we don't saturate the per-host browser limit.
      const startIdx = cursorRef.current;
      cursorRef.current += queued.length;
      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (i < queued.length) {
          const j = i++;
          await runOne(queued[j]);
        }
      });
      await Promise.all(workers);

      void startIdx;
      return { accepted: accepted.length, rejected: rejected.length };
    },
    [concurrency, onRejected, runOne],
  );

  const clearCommitted = useCallback((knownIds: Set<string>) => {
    // Remove local chips for files whose document_id is now visible on the
    // server side (avoids duplicate rendering between local + server lists).
    setFiles((prev) =>
      prev.filter((f) => !f.documentId || !knownIds.has(f.documentId)),
    );
  }, []);

  const removeFile = useCallback((rowUid: string) => {
    setFiles((prev) => prev.filter((r) => r.uid !== rowUid));
  }, []);

  const anyInFlight = files.some((f) =>
    ["queued", "hashing", "signing", "uploading", "committing"].includes(f.stage),
  );

  return { files, addFiles, clearCommitted, removeFile, anyInFlight };
}
