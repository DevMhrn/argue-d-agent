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
import { useCallback, useState } from "react";
import type { LocalFile, LocalFileStage } from "@/components/FileRow";
import { ApiError, commitUpload, signUpload, uploadToStorage } from "@/lib/api";
import {
  mimeOf,
  partitionSupportedFiles,
  queueFiles,
  SUPPORTED_FILES_LABEL,
} from "@/lib/fileSupport";
import { sha256Hex } from "@/lib/sha256";

export { SUPPORTED_FILES_LABEL };

export interface UseCaseUploadOptions {
  /** Max concurrent uploads (browser cap is ~6 per host; default 3). */
  concurrency?: number;
  /** Notified when a file finishes commit (document_id known + on server). */
  onCommitted?: (documentId: string) => void;
  /** Notified when a file is rejected client-side for unsupported MIME. */
  onRejected?: (rejected: File[]) => void;
}

export function useCaseUpload(
  caseUuid: string,
  opts: UseCaseUploadOptions = {},
) {
  const { concurrency = 3, onCommitted, onRejected } = opts;
  const [files, setFiles] = useState<LocalFile[]>([]);

  const setRow = useCallback((rowUid: string, patch: Partial<LocalFile>) => {
    setFiles((prev) =>
      prev.map((r) => (r.uid === rowUid ? { ...r, ...patch } : r)),
    );
  }, []);

  const runOne = useCallback(
    async (row: LocalFile) => {
      await uploadLocalFile({ row, caseUuid, setRow, onCommitted });
    },
    [caseUuid, setRow, onCommitted],
  );

  const addFiles = useCallback(
    async (picked: File[]): Promise<{ accepted: number; rejected: number }> => {
      // Client-side MIME filter so unsupported types (images, etc.) get a
      // friendly inline rejection instead of a 400 from the backend.
      const { accepted, rejected } = partitionSupportedFiles(picked);
      notifyRejected(rejected, onRejected);
      if (accepted.length === 0)
        return { accepted: 0, rejected: rejected.length };

      const queued: LocalFile[] = queueFiles(accepted);
      setFiles((prev) => [...prev, ...queued]);

      // Bounded concurrency so we don't saturate the per-host browser limit.
      await runQueuedUploads(queued, concurrency, runOne);

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
    ["queued", "hashing", "signing", "uploading", "committing"].includes(
      f.stage,
    ),
  );

  return { files, addFiles, clearCommitted, removeFile, anyInFlight };
}

type SetLocalFile = (rowUid: string, patch: Partial<LocalFile>) => void;

interface UploadLocalFileOptions {
  row: LocalFile;
  caseUuid: string;
  setRow: SetLocalFile;
  onCommitted?: (documentId: string) => void;
}

async function uploadLocalFile(options: UploadLocalFileOptions) {
  try {
    await uploadLocalFileSteps(options);
  } catch (err) {
    failLocalFile(options.row, options.setRow, err);
  }
}

async function uploadLocalFileSteps({
  row,
  caseUuid,
  setRow,
  onCommitted,
}: UploadLocalFileOptions) {
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
  setRow(row.uid, { stage: committedStage(committed.status) });
  onCommitted?.(presign.document_id);
}

function committedStage(status: string): LocalFileStage {
  return status === "extracting" ? "extracting" : "uploaded";
}

function failLocalFile(row: LocalFile, setRow: SetLocalFile, err: unknown) {
  setRow(row.uid, {
    stage: "failed",
    error: err instanceof ApiError ? err.message : String(err),
  });
}

function notifyRejected(
  rejected: File[],
  onRejected: ((rejected: File[]) => void) | undefined,
) {
  if (rejected.length > 0) onRejected?.(rejected);
}

async function runQueuedUploads(
  queued: LocalFile[],
  concurrency: number,
  runOne: (row: LocalFile) => Promise<void>,
) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < queued.length) {
      const row = queued[cursor];
      cursor += 1;
      await runOne(row);
    }
  });
  await Promise.all(workers);
}
