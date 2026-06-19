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
import { useEffect, useMemo, useRef, useState } from "react";
import { FileRow } from "@/components/FileRow";
import { UploadZone } from "@/components/UploadZone";
import { getCaseStatus } from "@/lib/api";
import {
  classify,
  type FileCategory,
  type FileRejection,
} from "@/lib/fileSupport";
import type { DocumentRow } from "@/lib/types";
import { useCaseUpload } from "@/lib/useCaseUpload";

interface Props {
  caseUuid: string;
  initialDocuments: DocumentRow[];
  /** Called after a document is committed — lets the parent reopen the
   *  case-status stream so a rebuild on an already-complete case animates live. */
  onDocumentAdded?: () => void;
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

export function DocumentsPanel({
  caseUuid,
  initialDocuments,
  onDocumentAdded,
}: Props) {
  const { docs, files, addFiles, rejectedNote, summary } = useDocumentsPanel({
    caseUuid,
    initialDocuments,
    onDocumentAdded,
  });

  return (
    <section className="rounded-card border border-border bg-panel p-5 shadow-card">
      <DocumentsHeader summary={summary} />
      <ServerDocuments docs={docs} />
      <LocalUploads files={files} />
      <UploadFooter addFiles={addFiles} rejectedNote={rejectedNote} />
    </section>
  );
}

function useDocumentsPanel({
  caseUuid,
  initialDocuments,
  onDocumentAdded,
}: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>(initialDocuments);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const intervalRef = useRef<number | null>(null);

  function onCommitted() {
    // After a successful commit, force a quick refresh so the new doc lands
    // in the server-side list within ~150 ms (rather than waiting for the
    // next 1.5 s tick).
    setRefreshNonce((n) => n + 1);
    // Let the parent reopen the case-status stream so the ledger rebuild
    // triggered by this new document animates live.
    onDocumentAdded?.();
  }

  function onRejected(rejected: FileRejection[]) {
    const list = rejected
      .map((r) => `${r.file.name} — ${r.message}`)
      .join("; ");
    setRejectedNote(`Can't ingest: ${list}`);
    window.setTimeout(() => setRejectedNote(null), 6000);
  }

  const existingCountsByCategory = useMemo(
    () => countDocsByCategory(docs),
    [docs],
  );
  const { files, addFiles, clearCommitted, anyInFlight } = useCaseUpload(
    caseUuid,
    { onCommitted, onRejected, existingCountsByCategory },
  );

  useEffect(() => {
    if (refreshNonce === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const status = await getCaseStatus(caseUuid);
        if (cancelled) return;
        setDocs(status.documents);
        // Drop any local chips whose document is now visible on the server.
        clearCommitted(new Set(status.documents.map((d) => d.id)));
      } catch {
        // ignore transient poll failures
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseUuid, clearCommitted, refreshNonce]);

  // Poll while any server-side doc is non-terminal OR any local upload is in flight.
  useEffect(() => {
    if (!shouldPollDocuments(docs, anyInFlight)) {
      clearPollInterval(intervalRef);
      return;
    }
    if (intervalRef.current) return; // already polling
    intervalRef.current = window.setInterval(() => {
      void refreshDocuments(caseUuid, setDocs, clearCommitted);
    }, 1500);
    return () => {
      clearPollInterval(intervalRef);
    };
  }, [docs, anyInFlight, caseUuid, clearCommitted]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const extracted = docs.filter((d) => d.status === "extracted").length;
  const failed = docs.filter((d) => d.status === "failed").length;

  return {
    docs,
    files,
    addFiles,
    rejectedNote,
    summary: { extracted, total: docs.length, failed },
  };
}

interface IntervalRef {
  current: number | null;
}

function shouldPollDocuments(
  docs: DocumentRow[],
  anyInFlight: boolean,
): boolean {
  return docs.some((doc) => !isTerminal(doc.status)) || anyInFlight;
}

function clearPollInterval(intervalRef: IntervalRef) {
  if (!intervalRef.current) return;
  window.clearInterval(intervalRef.current);
  intervalRef.current = null;
}

async function refreshDocuments(
  caseUuid: string,
  setDocs: (docs: DocumentRow[]) => void,
  clearCommitted: (knownIds: Set<string>) => void,
) {
  try {
    const status = await getCaseStatus(caseUuid);
    setDocs(status.documents);
    clearCommitted(new Set(status.documents.map((doc) => doc.id)));
  } catch {
    // ignore transient poll failures
  }
}

interface DocumentsSummary {
  extracted: number;
  total: number;
  failed: number;
}

function DocumentsHeader({ summary }: { summary: DocumentsSummary }) {
  return (
    <header className="mb-3 flex items-baseline justify-between gap-3">
      <div>
        <h3 className="font-semibold text-base tracking-tight">Documents</h3>
        <p className="mt-0.5 text-[12px] text-muted">
          Raw bytes in Backblaze · extracted text + metadata in Supabase.
        </p>
      </div>
      <span className="text-[12px] text-muted-2">
        {summary.extracted} / {summary.total} extracted
        {failedText(summary.failed)}
      </span>
    </header>
  );
}

function failedText(failed: number): string {
  return failed ? ` · ${failed} failed` : "";
}

function ServerDocuments({ docs }: { docs: DocumentRow[] }) {
  if (docs.length === 0) {
    return (
      <p className="text-[13px] text-muted">
        No documents uploaded for this case yet.
      </p>
    );
  }

  return (
    <ul className="grid gap-2">
      {docs.map((doc) => (
        <ServerDocumentRow key={doc.id} doc={doc} />
      ))}
    </ul>
  );
}

function ServerDocumentRow({ doc }: { doc: DocumentRow }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-pill border border-border-soft bg-panel-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{doc.filename}</div>
        <DocumentMeta doc={doc} />
        <ExtractionError error={doc.extraction_error} />
      </div>
      <StatusBadge status={doc.status} />
    </li>
  );
}

function DocumentMeta({ doc }: { doc: DocumentRow }) {
  return (
    <div className="mt-0.5 flex items-baseline gap-3 font-mono text-[11px] text-muted-2">
      <span>{(doc.file_size_bytes / 1024).toFixed(1)} KB</span>
      <span>·</span>
      <span>{doc.mime_type.split("/").pop()}</span>
      <PageCount count={doc.page_count} />
      <RetryCount count={doc.retry_count} />
    </div>
  );
}

function PageCount({ count }: { count: number | null }) {
  return count != null ? <span>· {count} pages</span> : null;
}

function RetryCount({ count }: { count: number }) {
  return count > 0 ? (
    <span className="text-warn">· retried {count}×</span>
  ) : null;
}

function ExtractionError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="mt-1 rounded-md border border-bad/40 bg-bad/5 px-2 py-1 text-[11.5px] text-bad">
      {error}
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentRow["status"] }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 font-medium text-[10.5px] uppercase tracking-wider ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function LocalUploads({
  files,
}: {
  files: ReturnType<typeof useCaseUpload>["files"];
}) {
  if (files.length === 0) return null;

  return (
    <ul className="mt-3 grid gap-2">
      {files.map((file) => (
        <FileRow key={file.uid} row={file} />
      ))}
    </ul>
  );
}

function UploadFooter({
  addFiles,
  rejectedNote,
}: {
  addFiles: ReturnType<typeof useCaseUpload>["addFiles"];
  rejectedNote: string | null;
}) {
  return (
    <div className="mt-4">
      <UploadZone onFiles={addFiles} />
      <RejectedNote note={rejectedNote} />
    </div>
  );
}

function RejectedNote({ note }: { note: string | null }) {
  if (!note) return null;

  return (
    <div className="mt-2 rounded-md border border-warn/40 bg-warn/5 px-2 py-1 text-[12px] text-warn">
      {note}
    </div>
  );
}

function countDocsByCategory(
  docs: DocumentRow[],
): Partial<Record<FileCategory, number>> {
  const counts: Partial<Record<FileCategory, number>> = {};
  for (const d of docs) {
    if (d.status === "failed") continue;
    const cat = classify(d.mime_type);
    if (!cat) continue;
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  return counts;
}
