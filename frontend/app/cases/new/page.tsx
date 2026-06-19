"use client";

import { useRouter } from "next/navigation";
/**
 * Chat-style case intake.
 *
 * Flow:
 *   1. Lumen greets and offers a compact metadata form (inline form bubble).
 *      User can fill the form OR just type the case context naturally — the
 *      first text message becomes the title/summary, defaults fill the rest.
 *   2. On submit, we POST /api/ingest/case → Lumen confirms case_id.
 *   3. User attaches files in the composer; each file becomes an
 *      attachment in a user message + a Lumen response that tracks per-file
 *      progress (sha256 → sign → PUT to B2 → commit → extracted).
 *   4. Polling /api/ingest/status updates extraction status in place.
 *   5. When every file shows "extracted", Lumen offers a "Finalize & open case"
 *      action that hits /api/ingest/finalize and navigates to /cases/{id}.
 */
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/ChatComposer";
import { type ChatMessage, ChatMessageBubble } from "@/components/ChatMessage";
import { type LocalFile, mergeServerStatus } from "@/components/FileRow";
import {
  ApiError,
  commitUpload,
  createCase,
  finalizeCase,
  getCaseStatus,
  signUpload,
  uploadToStorage,
} from "@/lib/api";
import {
  countLocalFilesByCategory,
  type FileRejection,
  mimeOf,
  partitionSupportedFiles,
  queueFiles,
  SUPPORTED_FILES_LABEL,
  uid,
} from "@/lib/fileSupport";
import { sha256Hex } from "@/lib/sha256";
import type { CaseCreatePayload, CaseRow, DocumentRow } from "@/lib/types";

/* -------------------------------------------------------------- helpers */

/**
 * Supported file label comes from frontend/lib/fileSupport.ts, which mirrors
 * backend/ingestion/limits.py and backend/ingestion/extractors/registry.py.
 */
const SUPPORTED_LABEL = SUPPORTED_FILES_LABEL;

/* -------------------------------------------------------------- page */

type Phase = "intake" | "uploading" | "ready" | "finalizing";
type CaseForm = typeof INITIAL_CASE_FORM;
type PollTimer = ReturnType<typeof globalThis.setInterval>;
interface UploadState {
  allExtracted: boolean;
  anyFailed: boolean;
  anyInFlight: boolean;
}

const INITIAL_CASE_FORM = {
  case_id: "",
  title: "",
  jurisdiction: "CA",
  insured_name: "",
  other_party_name: "",
  damages_usd: "",
  summary: "",
};

const UPLOAD_CONCURRENCY = 3;

export default function NewCasePage() {
  const router = useRouter();

  // Conversation state — messages are immutable bubbles, files are tracked
  // separately so we can mutate their per-file progress in place.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");

  // Inline metadata form state (lives inside Lumen's first message bubble).
  const [form, setForm] = useState(INITIAL_CASE_FORM);

  // Refs so we can scroll-to-bottom and stop polling on unmount.
  const feedRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<PollTimer | null>(null);

  // ---- conversation helpers --------------------------------------------
  function push(msg: Omit<ChatMessage, "id">) {
    setMessages((prev) => [...prev, { id: uid(), ...msg }]);
  }

  // Bootstrap with Lumen's greeting + the inline metadata form.
  useEffect(() => {
    setMessages([
      {
        id: uid(),
        role: "lumen",
        text: "I'm Lumen. I'll open the file, extract your evidence, and build a locked ledger before any agent argues. Start with the basics:",
      },
    ]);
  }, []);

  // Auto-scroll whenever the chat re-renders after message or file changes.
  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  });

  // Stop polling on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) globalThis.clearInterval(pollRef.current);
    };
  }, []);

  // ---- step 1: create the case shell -----------------------------------
  async function submitForm() {
    if (phase !== "intake") return;
    setPhase("uploading"); // tentatively — we'll roll back on error
    push({ role: "user", text: caseSummary(form) });
    push({ role: "lumen", text: "Creating the case shell…", pending: true });

    try {
      const created = await createCase(casePayload(form));
      setCaseRow(created);
      // Replace the pending bubble with the confirmation.
      replaceLastMessage(setMessages, caseCreatedMessage(created));
    } catch (err) {
      replaceLastMessage(setMessages, caseCreateFailedMessage(err));
      setPhase("intake");
    }
  }

  // ---- step 2: per-file ingestion pipeline -----------------------------
  function setFile(uid_: string, patch: Partial<LocalFile>) {
    setFiles((prev) =>
      prev.map((r) => (r.uid === uid_ ? { ...r, ...patch } : r)),
    );
  }

  async function runOneFile(caseUuid: string, row: LocalFile) {
    try {
      setFile(row.uid, { stage: "hashing", progress: 0 });
      const sha256 = await sha256Hex(row.file);
      setFile(row.uid, { sha256 });

      setFile(row.uid, { stage: "signing" });
      const presign = await signUpload({
        case_id: caseUuid,
        filename: row.file.name,
        mime_type: mimeOf(row.file),
        size: row.file.size,
        sha256,
      });
      setFile(row.uid, { documentId: presign.document_id });

      setFile(row.uid, { stage: "uploading", progress: 0 });
      await uploadToStorage(presign, row.file, (pct) =>
        setFile(row.uid, { progress: pct }),
      );

      setFile(row.uid, { stage: "committing" });
      const committed = await commitUpload(presign.document_id);
      setFile(row.uid, { stage: stageAfterCommit(committed.status) });
    } catch (err) {
      setFile(row.uid, {
        stage: "failed",
        error: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  function startPolling(caseUuid: string) {
    clearPolling(pollRef);
    pollRef.current = globalThis.setInterval(async () => {
      try {
        const status = await getCaseStatus(caseUuid);
        setFiles((prev) =>
          prev.map((row) => mergePolledFile(row, status.documents)),
        );
        if (shouldStopPolling(status.documents)) {
          clearPolling(pollRef);
        }
      } catch {
        // ignore transient poll failures
      }
    }, 1500);
  }

  async function handleAttach(picked: File[]) {
    if (!caseRow) {
      push({
        role: "lumen",
        text: "Create the case first (use the form above), then drop files.",
      });
      return;
    }

    // Filter to supported types + per-class caps BEFORE we hit the backend so
    // the user gets instant feedback instead of a 400 error chip. Drag-drop
    // bypasses the <input accept="..."> filter, so this is the only place we
    // can catch oversized/over-count uploads client-side.
    const pendingCountsByCategory = countLocalFilesByCategory(files);
    const { accepted, rejected } = partitionSupportedFiles(picked, {
      pendingCountsByCategory,
    });
    notifyUnsupportedFiles(rejected, push);

    if (accepted.length === 0) return;

    // 1. Push a user message with the file chips (initially "queued").
    const queued: LocalFile[] = queueFiles(accepted);
    setFiles((prev) => [...prev, ...queued]);
    push({
      role: "user",
      attachments: queued,
    });
    push({
      role: "lumen",
      text: uploadQueuedMessage(queued.length),
    });

    // 2. Run each file through the upload pipeline (concurrency = 3).
    await Promise.all(createUploadWorkers(caseRow.id, queued, runOneFile));

    // 3. Begin polling for extraction completion.
    startPolling(caseRow.id);
  }

  // ---- step 3: finalize when all files are extracted -------------------
  const upload = uploadState(files);

  async function finalizeCurrentCase() {
    if (!caseRow) return;
    setPhase("finalizing");
    try {
      await finalizeCase(caseRow.id);
      router.push(`/cases/${encodeURIComponent(caseRow.id)}`);
    } catch (err) {
      push({
        role: "lumen",
        text: `Finalize failed: ${apiErrorMessage(err)}`,
      });
      setPhase("ready");
    }
  }

  // ---- free-text user messages -----------------------------------------
  function handleSend(text: string) {
    push({ role: "user", text });
    // First free-text message during intake auto-fills the title/summary.
    if (phase === "intake" && !form.title) {
      const firstLine = text.split("\n")[0].slice(0, 120);
      setForm((f) => ({
        ...f,
        title: f.title || firstLine,
        summary: f.summary || text,
      }));
      push({
        role: "lumen",
        text:
          `Captured. Tweak the form above if anything's off, then click ` +
          `Create case to continue.`,
      });
    } else {
      // After case is created, free text is just notes — Lumen acknowledges.
      push({
        role: "lumen",
        text: caseRow
          ? "Noted. Drop the evidence files when you're ready (📎 or drag-drop)."
          : "Fill in the form above to create the case shell first.",
      });
    }
  }

  // ---- the inline metadata form rendered inside the first Lumen bubble -
  const metadataForm = (
    <CaseMetadataForm
      form={form}
      phase={phase}
      onChange={setForm}
      onSubmit={submitForm}
    />
  );

  // Inject the inline form into the first Lumen message bubble and keep any
  // attachment chips synced to the live upload state (so chips advance in place
  // instead of staying stuck on "Queued").
  const renderedMessages = attachLiveFiles(
    messages.map((m, i) =>
      i === 0 && m.role === "lumen" ? { ...m, form: metadataForm } : m,
    ),
    files,
  );
  const showFinalizePrompt =
    upload.allExtracted && Boolean(caseRow) && phase !== "finalizing";
  const displayMessages = showFinalizePrompt
    ? renderedMessages.concat({
        id: "finalize-prompt",
        ...finalizePromptMessage(files.length, finalizeCurrentCase),
      })
    : renderedMessages;

  /* ----- render -------------------------------------------------------- */
  return (
    <div className="flex flex-1 flex-col">
      <NewCaseFeed
        feedRef={feedRef}
        messages={displayMessages}
        anyFailed={upload.anyFailed}
      />
      <NewCaseComposer
        caseRow={caseRow}
        files={files}
        upload={upload}
        onSend={handleSend}
        onAttach={handleAttach}
      />
    </div>
  );
}

function uploadState(files: LocalFile[]): UploadState {
  const stages = files.map((file) => file.stage);
  return {
    allExtracted: hasExtractedFiles(files) && stages.every(isExtractedStage),
    anyFailed: stages.includes("failed"),
    anyInFlight: stages.some(isInFlightStage),
  };
}

function hasExtractedFiles(files: LocalFile[]): boolean {
  return files.length > 0;
}

function isExtractedStage(stage: LocalFile["stage"]): boolean {
  return stage === "extracted";
}

function isInFlightStage(stage: LocalFile["stage"]): boolean {
  return IN_FLIGHT_STAGES.has(stage);
}

function stageAfterCommit(status: string): LocalFile["stage"] {
  return status === "extracting" ? "extracting" : "uploaded";
}

function mergePolledFile(row: LocalFile, documents: DocumentRow[]): LocalFile {
  const server = documents.find((doc) => doc.id === row.documentId);
  if (!server) return row;
  return {
    ...row,
    stage: mergeServerStatus(row.stage, server.status),
    error: server.extraction_error ?? row.error,
  };
}

function isTerminalDocument(document: DocumentRow): boolean {
  return document.status === "extracted" || document.status === "failed";
}

function shouldStopPolling(documents: DocumentRow[]): boolean {
  return documents.length > 0 && documents.every(isTerminalDocument);
}

const IN_FLIGHT_STAGES = new Set<LocalFile["stage"]>([
  "queued",
  "hashing",
  "signing",
  "uploading",
  "committing",
  "uploaded",
  "extracting",
]);

interface FeedRef {
  current: HTMLDivElement | null;
}

function NewCaseFeed({
  feedRef,
  messages,
  anyFailed,
}: {
  feedRef: FeedRef;
  messages: ChatMessage[];
  anyFailed: boolean;
}) {
  return (
    <div ref={feedRef} className="flex-1 overflow-auto">
      <div
        className="mx-auto w-full"
        style={{ maxWidth: "780px", padding: "32px 24px 80px" }}
      >
        <IntakeHeader />
        <div className="flex flex-col gap-4.5">
          {messages.map((message) => (
            <ChatMessageBubble key={message.id} msg={message} />
          ))}
          <FailedUploadNotice show={anyFailed} />
        </div>
      </div>
    </div>
  );
}

function IntakeHeader() {
  return (
    <div className="mb-6.5">
      <div className="mb-2 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]">
        New case · intake
      </div>
      <h1 className="m-0 font-semibold text-[26px] text-text tracking-[-0.02em]">
        Open a recovery file
      </h1>
    </div>
  );
}

function FailedUploadNotice({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div
      className="text-[12px] text-bad"
      style={{
        padding: "10px 14px",
        borderRadius: "10px",
        border: "1px solid rgba(198,106,90,0.4)",
        background: "rgba(198,106,90,0.06)",
      }}
    >
      One or more files failed. Remove and re-drop, or check the worker logs.
    </div>
  );
}

function NewCaseComposer({
  caseRow,
  files,
  upload,
  onSend,
  onAttach,
}: {
  caseRow: CaseRow | null;
  files: LocalFile[];
  upload: UploadState;
  onSend: (text: string) => void;
  onAttach: (files: File[]) => void;
}) {
  return (
    <div
      className="sticky bottom-0 border-border-soft border-t px-6 py-3 backdrop-blur"
      style={{ background: "rgba(21,18,14,0.86)" }}
    >
      <ChatComposer
        placeholder={composerPlaceholder(caseRow, upload)}
        onSend={onSend}
        onAttach={onAttach}
        hint={composerHint(caseRow, files)}
      />
    </div>
  );
}

function composerPlaceholder(
  caseRow: CaseRow | null,
  upload: UploadState,
): string {
  if (!caseRow) return "Type the case context (or just paste a paragraph)…";
  if (upload.anyInFlight) return "Files extracting… you can still drop more.";
  return "Drop more evidence, or type a note.";
}

function composerHint(caseRow: CaseRow | null, files: LocalFile[]): string {
  if (!caseRow) return "Create the case first, then drop files.";
  return `Case ${caseRow.case_id} · ${files.length} ${fileNoun(files.length)} · ${extractedCount(files)} extracted`;
}

function extractedCount(files: LocalFile[]): number {
  return files.filter((file) => file.stage === "extracted").length;
}

function caseSummary(form: CaseForm): string {
  return [
    textOr(form.title, "Untitled case"),
    `${textOr(form.insured_name, "—")} vs ${textOr(form.other_party_name, "—")} · ${textOr(form.jurisdiction, "CA")}`,
    damagesSummary(form.damages_usd),
  ]
    .filter(Boolean)
    .join("\n");
}

function damagesSummary(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `$${trimmed}` : "";
}

function casePayload(form: CaseForm): CaseCreatePayload {
  return {
    case_id: textOr(form.case_id, `CLM-${Date.now()}`),
    title: textOr(form.title, "Untitled case"),
    summary: nullableText(form.summary),
    jurisdiction: textOr(form.jurisdiction, "CA"),
    damages_usd: parseDamages(form.damages_usd),
    insured_name: nullableText(form.insured_name),
    other_party_name: nullableText(form.other_party_name),
  };
}

function textOr(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

function parseDamages(value: string): number | null {
  const trimmed = value.trim();
  return trimmed ? Number(trimmed.replace(/[^0-9.]/g, "")) : null;
}

function caseCreatedMessage(created: CaseRow): Omit<ChatMessage, "id"> {
  return {
    role: "lumen",
    text:
      `Case created — ${created.case_id} (id ${created.id.slice(0, 8)}…).\n` +
      "Drop the evidence files into the chat, or click 📎 below.",
  };
}

function caseCreateFailedMessage(err: unknown): Omit<ChatMessage, "id"> {
  return {
    role: "lumen",
    text: `Couldn't create the case: ${apiErrorMessage(err)}. Try again.`,
  };
}

function apiErrorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : String(err);
}

type MessageSetter = (
  value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
) => void;
type MessagePusher = (msg: Omit<ChatMessage, "id">) => void;
interface PollRef {
  current: PollTimer | null;
}

function replaceLastMessage(
  setMessages: MessageSetter,
  msg: Omit<ChatMessage, "id">,
) {
  setMessages((prev) => prev.slice(0, -1).concat({ id: uid(), ...msg }));
}

function notifyUnsupportedFiles(
  rejected: FileRejection[],
  push: MessagePusher,
) {
  if (rejected.length > 0) {
    push({ role: "lumen", text: unsupportedFilesMessage(rejected) });
  }
}

function unsupportedFilesMessage(rejected: FileRejection[]): string {
  const reasonHint = rejected.every((r) => r.reason === "mime")
    ? `Only ${SUPPORTED_LABEL} are supported.`
    : "Check the per-file cap and per-case limit for each category.";
  return `Can't ingest ${unsupportedNoun(rejected)}. ${reasonHint}\n\n${rejectedFilesList(rejected)}`;
}

function unsupportedNoun(rejected: FileRejection[]): string {
  return rejected.length === 1 ? "this file" : "these files";
}

function rejectedFilesList(rejected: FileRejection[]): string {
  return rejected.map((r) => `• ${r.file.name} — ${r.message}`).join("\n");
}

function uploadQueuedMessage(count: number): string {
  return `Uploading ${count} ${fileNoun(count)} directly to object storage and queueing extraction…`;
}

function fileNoun(count: number): string {
  return count === 1 ? "file" : "files";
}

function createUploadWorkers(
  caseUuid: string,
  queued: LocalFile[],
  runOneFile: (caseUuid: string, row: LocalFile) => Promise<void>,
) {
  let cursor = 0;

  return Array.from({ length: UPLOAD_CONCURRENCY }, async () => {
    while (cursor < queued.length) {
      const row = queued[cursor];
      cursor += 1;
      await runOneFile(caseUuid, row);
    }
  });
}

function clearPolling(pollRef: PollRef) {
  if (!pollRef.current) return;
  globalThis.clearInterval(pollRef.current);
  pollRef.current = null;
}

function attachLiveFiles(
  messages: ChatMessage[],
  files: LocalFile[],
): ChatMessage[] {
  const filesByUid = new Map(files.map((file) => [file.uid, file]));
  return messages.map((message) =>
    message.attachments
      ? {
          ...message,
          attachments: message.attachments.map(
            (file) => filesByUid.get(file.uid) ?? file,
          ),
        }
      : message,
  );
}

function finalizePromptMessage(
  fileCount: number,
  onClick: () => void,
): Omit<ChatMessage, "id"> {
  return {
    role: "lumen",
    text: `All ${fileCount} ${fileNoun(fileCount)} extracted ✓ — I've locked the ledger. Ready to convene the band and open the room.`,
    action: {
      label: "Finalize & open the room →",
      tone: "primary",
      onClick,
    },
  };
}

function CaseMetadataForm({
  form,
  phase,
  onChange,
  onSubmit,
}: {
  form: CaseForm;
  phase: Phase;
  onChange: (form: CaseForm) => void;
  onSubmit: () => void;
}) {
  const created = phase !== "intake";

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="case-title" label="Case title">
          <input
            id="case-title"
            value={form.title}
            onChange={(e) => onChange({ ...form, title: e.target.value })}
            placeholder="Rivera v. Blake"
            className="input"
          />
        </Field>
        <Field id="case-id" label="Case ID">
          <input
            id="case-id"
            value={form.case_id}
            onChange={(e) => onChange({ ...form, case_id: e.target.value })}
            placeholder={`CLM-${new Date().getFullYear()}-`}
            className="input font-mono text-muted"
          />
        </Field>
        <Field id="case-insured" label="Insured">
          <input
            id="case-insured"
            value={form.insured_name}
            onChange={(e) =>
              onChange({ ...form, insured_name: e.target.value })
            }
            placeholder="Rivera"
            className="input"
          />
        </Field>
        <Field id="case-other-party" label="Other party">
          <input
            id="case-other-party"
            value={form.other_party_name}
            onChange={(e) =>
              onChange({ ...form, other_party_name: e.target.value })
            }
            placeholder="Blake"
            className="input"
          />
        </Field>
        <Field id="case-jurisdiction" label="Jurisdiction">
          <input
            id="case-jurisdiction"
            value={form.jurisdiction}
            onChange={(e) =>
              onChange({ ...form, jurisdiction: e.target.value })
            }
            placeholder="CA"
            maxLength={4}
            className="input"
          />
        </Field>
        <Field id="case-damages" label="Documented damages (USD)">
          <input
            id="case-damages"
            value={form.damages_usd}
            onChange={(e) => onChange({ ...form, damages_usd: e.target.value })}
            placeholder="optional"
            inputMode="decimal"
            className="input font-mono text-muted-2"
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={created}
        className="mt-4 font-semibold text-[12.5px] disabled:opacity-50"
        style={{
          padding: "9px 16px",
          borderRadius: "8px",
          border: "1px solid var(--color-accent-dim)",
          background: "rgba(111,155,240,0.12)",
          color: "var(--color-accent-strong)",
          whiteSpace: "nowrap",
        }}
      >
        {created ? "Created ✓" : "Create case"}
      </button>
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex flex-col">
      <span className="mb-1.25 font-mono text-[10.5px] text-muted-2">
        {label}
      </span>
      {children}
    </label>
  );
}
