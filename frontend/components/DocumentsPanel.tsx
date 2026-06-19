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
  /** Fired when documents change (committed / status advanced) — lets the parent
   *  refresh and reopen the case-status stream so a rebuild animates live. */
  onDocumentsChanged?: () => void;
}

const STATUS_TONE: Record<DocumentRow["status"], string> = {
  pending: "border-border bg-panel-3 text-muted-2",
  uploaded: "border-accent-dim bg-accent/10 text-accent-strong",
  extracting: "border-warn/40 bg-warn/10 text-warn",
  extracted: "border-ok/35 bg-ok/10 text-ok",
  failed: "border-bad/40 bg-bad/10 text-bad",
};

const STATUS_LABEL: Record<DocumentRow["status"], string> = {
  pending: "Pending",
  uploaded: "Uploaded",
  extracting: "Extracting",
  extracted: "Extracted ✓",
  failed: "Failed",
};

type PollTimer = ReturnType<typeof globalThis.setInterval>;

function isTerminal(s: DocumentRow["status"]): boolean {
  return s === "extracted" || s === "failed";
}

// ---- exhibit-binder sections ----------------------------------------------
// Group server documents into binder sections inferred from filename / mime /
// document_kind. Order is fixed (comp line 1189) so the panel reads like a
// physical exhibit binder.

type SectionTitle = "Source documents" | "Damages evidence" | "Audio / visual";

const SECTION_ORDER: readonly SectionTitle[] = [
  "Source documents",
  "Damages evidence",
  "Audio / visual",
];

const SOURCE_HINTS = [
  "police",
  "recon",
  "camera",
  "report",
  "statement",
  "log",
];
const DAMAGES_HINTS = [
  "medical",
  "repair",
  "invoice",
  "estimate",
  "bill",
  "damage",
];

function sectionFor(doc: DocumentRow): SectionTitle {
  const mime = doc.mime_type.toLowerCase();
  if (
    mime.startsWith("audio/") ||
    mime.startsWith("image/") ||
    mime.startsWith("video/")
  ) {
    return "Audio / visual";
  }
  const haystack = `${doc.filename} ${doc.document_kind ?? ""}`.toLowerCase();
  if (DAMAGES_HINTS.some((h) => haystack.includes(h)))
    return "Damages evidence";
  if (SOURCE_HINTS.some((h) => haystack.includes(h))) return "Source documents";
  return "Source documents";
}

// Pictogram glyph by kind (comp line 1183): pdf ▤, xls/csv ▦, audio ◉, image ▣.
function glyphFor(doc: DocumentRow): string {
  const mime = doc.mime_type.toLowerCase();
  if (mime.startsWith("audio/")) return "◉";
  if (mime.startsWith("image/") || mime.startsWith("video/")) return "▣";
  if (mime.includes("spreadsheet") || mime.includes("csv")) return "▦";
  return "▤";
}

interface DocSection {
  title: SectionTitle;
  docs: DocumentRow[];
}

function groupSections(docs: DocumentRow[]): DocSection[] {
  const buckets = new Map<SectionTitle, DocumentRow[]>();
  for (const doc of docs) {
    const title = sectionFor(doc);
    const list = buckets.get(title);
    if (list) list.push(doc);
    else buckets.set(title, [doc]);
  }
  return SECTION_ORDER.flatMap((title) => {
    const grouped = buckets.get(title);
    return grouped ? [{ title, docs: grouped }] : [];
  });
}

function exhibitCount(n: number): string {
  return `${n} ${n === 1 ? "exhibit" : "exhibits"}`;
}

export function DocumentsPanel({
  caseUuid,
  initialDocuments,
  onDocumentsChanged,
}: Props) {
  const { docs, files, addFiles, rejectedNote, summary } = useDocumentsPanel({
    caseUuid,
    initialDocuments,
    onDocumentsChanged,
  });

  return (
    <section className="overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <DocumentsHeader summary={summary} />
      <div className="p-2">
        <ServerDocuments docs={docs} />
        <LocalUploads files={files} />
      </div>
      <UploadFooter addFiles={addFiles} rejectedNote={rejectedNote} />
    </section>
  );
}

function useDocumentsPanel({
  caseUuid,
  initialDocuments,
  onDocumentsChanged,
}: Props) {
  const [docs, setDocs] = useState<DocumentRow[]>(initialDocuments);
  const [rejectedNote, setRejectedNote] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const intervalRef = useRef<PollTimer | null>(null);
  const docsSignatureRef = useRef(documentsSignature(initialDocuments));
  const onDocumentsChangedRef =
    useRef<Props["onDocumentsChanged"]>(onDocumentsChanged);

  useEffect(() => {
    onDocumentsChangedRef.current = onDocumentsChanged;
  }, [onDocumentsChanged]);

  function onCommitted() {
    // After a successful commit, force a quick refresh so the new doc lands
    // in the server-side list within ~150 ms (rather than waiting for the
    // next 1.5 s tick). The parent is notified via onDocumentsChanged when the
    // refreshed document set actually changes (see applyServerDocuments).
    setRefreshNonce((n) => n + 1);
  }

  function onRejected(rejected: FileRejection[]) {
    const list = rejected
      .map((r) => `${r.file.name} — ${r.message}`)
      .join("; ");
    setRejectedNote(`Can't ingest: ${list}`);
    globalThis.setTimeout(() => setRejectedNote(null), 6000);
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
        applyServerDocuments(
          status.documents,
          setDocs,
          clearCommitted,
          docsSignatureRef,
          onDocumentsChangedRef,
        );
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
    intervalRef.current = globalThis.setInterval(() => {
      void refreshDocuments(
        caseUuid,
        setDocs,
        clearCommitted,
        docsSignatureRef,
        onDocumentsChangedRef,
      );
    }, 1500);
    return () => {
      clearPollInterval(intervalRef);
    };
  }, [docs, anyInFlight, caseUuid, clearCommitted]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (intervalRef.current) globalThis.clearInterval(intervalRef.current);
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
  current: PollTimer | null;
}

function shouldPollDocuments(
  docs: DocumentRow[],
  anyInFlight: boolean,
): boolean {
  return docs.some((doc) => !isTerminal(doc.status)) || anyInFlight;
}

function clearPollInterval(intervalRef: IntervalRef) {
  if (!intervalRef.current) return;
  globalThis.clearInterval(intervalRef.current);
  intervalRef.current = null;
}

async function refreshDocuments(
  caseUuid: string,
  setDocs: (docs: DocumentRow[]) => void,
  clearCommitted: (knownIds: Set<string>) => void,
  docsSignatureRef: { current: string },
  onDocumentsChangedRef: { current: Props["onDocumentsChanged"] },
) {
  try {
    const status = await getCaseStatus(caseUuid);
    applyServerDocuments(
      status.documents,
      setDocs,
      clearCommitted,
      docsSignatureRef,
      onDocumentsChangedRef,
    );
  } catch {
    // ignore transient poll failures
  }
}

function applyServerDocuments(
  documents: DocumentRow[],
  setDocs: (docs: DocumentRow[]) => void,
  clearCommitted: (knownIds: Set<string>) => void,
  docsSignatureRef: { current: string },
  onDocumentsChangedRef: { current: Props["onDocumentsChanged"] },
) {
  setDocs(documents);
  clearCommitted(new Set(documents.map((doc) => doc.id)));

  const nextSignature = documentsSignature(documents);
  if (nextSignature === docsSignatureRef.current) return;
  docsSignatureRef.current = nextSignature;
  onDocumentsChangedRef.current?.();
}

function documentsSignature(documents: DocumentRow[]): string {
  return documents
    .map((doc) =>
      [
        doc.id,
        doc.status,
        doc.page_count ?? "",
        doc.retry_count,
        doc.extraction_error ?? "",
      ].join(":"),
    )
    .join("|");
}

interface DocumentsSummary {
  extracted: number;
  total: number;
  failed: number;
}

function DocumentsHeader({ summary }: { summary: DocumentsSummary }) {
  return (
    <header className="flex items-center justify-between gap-3 border-border-soft border-b px-4 py-3.25">
      <h3 className="font-semibold text-[13px] tracking-tight">Documents</h3>
      <span className="font-mono text-[10.5px] text-muted-2">
        {fileCountText(summary)}
      </span>
    </header>
  );
}

function fileCountText(summary: DocumentsSummary): string {
  const base = `${summary.total} file${summary.total === 1 ? "" : "s"}`;
  return summary.failed ? `${base} · ${summary.failed} failed` : base;
}

function ServerDocuments({ docs }: { docs: DocumentRow[] }) {
  if (docs.length === 0) {
    return (
      <p className="px-2 py-3 text-[12.5px] text-muted">
        No documents filed for this case yet.
      </p>
    );
  }

  const sections = groupSections(docs);

  return (
    <div>
      {sections.map((sec) => (
        <ExhibitSection key={sec.title} section={sec} />
      ))}
    </div>
  );
}

function ExhibitSection({ section }: { section: DocSection }) {
  return (
    <section className="mb-1.5">
      <SectionRule title={section.title} count={section.docs.length} />
      {section.docs.map((doc) => (
        <ServerDocumentRow key={doc.id} doc={doc} />
      ))}
    </section>
  );
}

function SectionRule({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-1.75 pb-1.25">
      <span className="font-mono text-[9px] text-muted-2 uppercase tracking-[0.14em]">
        {title}
      </span>
      <div className="h-px flex-1 bg-border-soft" />
      <span className="font-mono text-[9px] text-muted-2">
        {exhibitCount(count)}
      </span>
    </div>
  );
}

function ServerDocumentRow({ doc }: { doc: DocumentRow }) {
  return (
    <div className="rounded-lg px-2 py-2.25 hover:bg-panel-2/60">
      <div className="flex items-center gap-2.5">
        <Pictogram glyph={glyphFor(doc)} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[12.5px]">
            {doc.filename}
          </div>
          <DocumentMeta doc={doc} />
        </div>
        <StatusBadge status={doc.status} />
      </div>
      <ExtractionError error={doc.extraction_error} />
    </div>
  );
}

function Pictogram({ glyph }: { glyph: string }) {
  return (
    <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg border border-border bg-panel-2 text-[14px] text-muted">
      {glyph}
    </span>
  );
}

function DocumentMeta({ doc }: { doc: DocumentRow }) {
  return (
    <div className="mt-px font-mono text-[10px] text-muted-2">
      {metaLine(doc)}
    </div>
  );
}

function metaLine(doc: DocumentRow): string {
  const parts = [
    `${(doc.file_size_bytes / 1024).toFixed(1)} KB`,
    doc.mime_type.split("/").pop() ?? doc.mime_type,
  ];
  if (doc.page_count != null) {
    parts.push(`${doc.page_count} ${unitFor(doc.mime_type)}`);
  }
  if (doc.status === "extracted") parts.push(extractedVerb(doc.mime_type));
  if (doc.retry_count > 0) parts.push(`retried ${doc.retry_count}×`);
  return parts.join(" · ");
}

function unitFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("spreadsheet") || m.includes("csv")) return "rows";
  return "pages";
}

function extractedVerb(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith("audio/") || m.startsWith("video/")) return "Transcribed";
  if (m.startsWith("image/")) return "OCR'd";
  return "OCR'd";
}

function ExtractionError({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="mt-1 ml-11 rounded-md border border-bad/40 bg-bad/5 px-2 py-1 text-[11px] text-bad">
      {error}
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentRow["status"] }) {
  return (
    <span
      className={`shrink-0 rounded-chip border px-2 py-0.75 font-mono text-[9.5px] ${STATUS_TONE[status]}`}
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
    <ul className="mt-2 grid gap-2 px-2">
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
    <div className="m-2">
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
