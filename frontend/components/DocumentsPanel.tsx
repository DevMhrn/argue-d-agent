"use client";

/**
 * DocumentsPanel — the combined "raw evidence" view on a case detail page.
 *
 * Shows three things:
 *   1. The server-side list of documents (with per-doc status + retry count)
 *      via polling /api/ingest/status/{case_id}.
 *   2. The in-flight local chips for files currently being uploaded by the
 *      user (hashing → signing → uploading → committing).
 *   3. A drop zone at the bottom to add more evidence at any time — even
 *      after the case has been finalized once. Useful because real
 *      subrogation evidence trickles in over weeks.
 *
 * Polling rules:
 *   - Always poll while ANY document on the server is non-terminal
 *     (pending / uploaded / extracting), regardless of ingestion_complete.
 *     This means newly-added documents to a "complete" case still surface.
 *   - Stop polling when every doc is terminal AND no local upload is in flight.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { getCaseStatus } from "@/lib/api";
import { FileRow } from "@/components/FileRow";
import { UploadZone } from "@/components/UploadZone";
import { SUPPORTED_FILES_LABEL, useCaseUpload } from "@/lib/useCaseUpload";
import type { DocumentRow } from "@/lib/types";

interface Props {
  caseUuid: string;
  initialDocuments: DocumentRow[];
}

const STATUS_TONE: Record<DocumentRow["status"], string> = {
  pending: "border-muted-2/40 bg-panel-3 text-muted",
  uploaded: "border-accent/40 bg-accent/10 text-accent",
  extracting: "border-warn/40 bg-warn/10 text-warn",
  extracted: "border-ok/40 bg-ok/10 text-ok",
  failed: "border-bad/40 bg-bad/10 text-bad",
};

const STATUS_LABEL: Record<DocumentRow["status"], string> = {
  pending: "Pending",
  uploaded: "Uploaded",
  extracting: "Extracting",
  extracted: "Extracted ✓",
  failed: "Failed",
};

function isTerminal(s: DocumentRow["status"]): boolean {
  return s === "extracted" || s === "failed";
}

export function DocumentsPanel({ caseUuid, initialDocuments }: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>(initialDocuments);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const onCommitted = useCallback(() => {
    // After a successful commit, force a quick refresh so the new doc lands
    // in the server-side list within ~150 ms (rather than waiting for the
    // next 1.5 s tick).
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseUuid]);

  const onRejected = useCallback((rejected: File[]) => {
    const list = rejected
      .map((f) => `${f.name} (${f.type || "unknown"})`)
      .join(", ");
    setRejectedNote(
      `Can't ingest: ${list}. Only ${SUPPORTED_FILES_LABEL} supported in v1.`,
    );
    window.setTimeout(() => setRejectedNote(null), 6000);
  }, []);

  const { files, addFiles, clearCommitted, anyInFlight } = useCaseUpload(
    caseUuid,
    { onCommitted, onRejected },
  );

  const refresh = useCallback(async () => {
    try {
      const status = await getCaseStatus(caseUuid);
      setDocs(status.documents);
      // Drop any local chips whose document is now visible on the server.
      clearCommitted(new Set(status.documents.map((d) => d.id)));
    } catch {
      // ignore transient poll failures
    }
  }, [caseUuid, clearCommitted]);

  // Poll while any server-side doc is non-terminal OR any local upload is in flight.
  useEffect(() => {
    const needsPoll =
      docs.some((d) => !isTerminal(d.status)) || anyInFlight;
    if (!needsPoll) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    if (intervalRef.current) return; // already polling
    intervalRef.current = window.setInterval(refresh, 1500);
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [docs, anyInFlight, refresh]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const extracted = docs.filter((d) => d.status === "extracted").length;
  const failed = docs.filter((d) => d.status === "failed").length;

  return (
    <section className="rounded-[14px] border border-border bg-panel p-5 shadow-card">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Documents</h3>
          <p className="mt-0.5 text-[12px] text-muted">
            Raw bytes in Backblaze · extracted text + metadata in Supabase.
          </p>
        </div>
        <span className="text-[12px] text-muted-2">
          {extracted} / {docs.length} extracted
          {failed ? ` · ${failed} failed` : ""}
        </span>
      </header>

      {/* Server-side document list */}
      {docs.length === 0 ? (
        <p className="text-[13px] text-muted">No documents uploaded for this case yet.</p>
      ) : (
        <ul className="grid gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-[9px] border border-border-soft bg-panel-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{d.filename}</div>
                <div className="mt-0.5 flex items-baseline gap-3 font-mono text-[11px] text-muted-2">
                  <span>{(d.file_size_bytes / 1024).toFixed(1)} KB</span>
                  <span>·</span>
                  <span>{d.mime_type.split("/").pop()}</span>
                  {d.page_count != null ? <span>· {d.page_count} pages</span> : null}
                  {d.retry_count > 0 ? (
                    <span className="text-warn">· retried {d.retry_count}×</span>
                  ) : null}
                </div>
                {d.extraction_error ? (
                  <div className="mt-1 rounded-[6px] border border-bad/40 bg-bad/5 px-2 py-1 text-[11.5px] text-bad">
                    {d.extraction_error}
                  </div>
                ) : null}
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider ${STATUS_TONE[d.status]}`}
              >
                {STATUS_LABEL[d.status]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Local in-flight chips (uploads happening right now in this browser) */}
      {files.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {files.map((f) => (
            <FileRow key={f.uid} row={f} />
          ))}
        </ul>
      ) : null}

      {/* Inline drop zone — add more evidence at any time */}
      <div className="mt-4">
        <UploadZone onFiles={addFiles} />
        {rejectedNote ? (
          <div className="mt-2 rounded-[6px] border border-warn/40 bg-warn/5 px-2 py-1 text-[12px] text-warn">
            {rejectedNote}
          </div>
        ) : null}
      </div>
    </section>
  );
}
