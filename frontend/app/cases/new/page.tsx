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
 *   3. User drops files anywhere in the conversation; each file becomes an
 *      attachment in a user message + a Lumen response that tracks per-file
 *      progress (sha256 → sign → PUT to B2 → commit → extracted).
 *   4. Polling /api/ingest/status updates extraction status in place.
 *   5. When every file shows "extracted", Lumen offers a "Finalize & open case"
 *      action that hits /api/ingest/finalize and navigates to /cases/{id}.
 */
import { type DragEvent, useEffect, useRef, useState } from "react";
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
  mimeOf,
  partitionSupportedFiles,
  queueFiles,
  SUPPORTED_FILES_LABEL,
  uid,
} from "@/lib/fileSupport";
import { sha256Hex } from "@/lib/sha256";
import type { CaseCreatePayload, CaseRow } from "@/lib/types";

/* -------------------------------------------------------------- helpers */

/**
 * MIME types our extractors actually handle today. This must mirror
 * backend/ingestion/extractors/registry.py — keep them in sync by hand.
 * Images (PNG/JPG) and audio are Phase 2 (vision via Gemini/Claude + Whisper),
 * see docs/ingestion-start-context.md §17 / §22.
 */
const SUPPORTED_LABEL = SUPPORTED_FILES_LABEL;

/* -------------------------------------------------------------- page */

type Phase = "intake" | "uploading" | "ready" | "finalizing";
type CaseForm = typeof INITIAL_CASE_FORM;
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
  const pollRef = useRef<number | null>(null);

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
        text: "Let's build a new case. Fill in the basics or just type the case context — I'll capture it.",
      },
    ]);
  }, []);

  // Auto-scroll on every message/file update.
  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, files]);

  // Stop polling on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
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
      setFile(row.uid, {
        stage: committed.status === "extracting" ? "extracting" : "uploaded",
      });
    } catch (err) {
      setFile(row.uid, {
        stage: "failed",
        error: err instanceof ApiError ? err.message : String(err),
      });
    }
  }

  function startPolling(caseUuid: string) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await getCaseStatus(caseUuid);
        setFiles((prev) =>
          prev.map((row) => {
            const server = status.documents.find(
              (d) => d.id === row.documentId,
            );
            if (!server) return row;
            return {
              ...row,
              stage: mergeServerStatus(row.stage, server.status),
              error: server.extraction_error ?? row.error,
            };
          }),
        );
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

    // Filter to supported types BEFORE we hit the backend so the user gets
    // an instant, friendly explanation instead of a 400 error chip. Drag-
    // drop bypasses the <input accept="..."> filter, so this is the only
    // place we can catch unsupported types client-side.
    const { accepted, rejected } = partitionSupportedFiles(picked);
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

  // When we transition into "all extracted", drop a Lumen message offering to
  // finalize. Tracked via a ref so we only post the prompt once.
  const promptedFinalizeRef = useRef(false);
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

  useEffect(() => {
    if (
      !shouldPromptFinalize(
        upload.allExtracted,
        promptedFinalizeRef.current,
        caseRow,
      )
    )
      return;
    promptedFinalizeRef.current = true;
    clearPolling(pollRef);
    push(finalizePromptMessage(files.length, finalizeCurrentCase));
    setPhase("ready");
  }, [upload.allExtracted, caseRow, files.length]);

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

  // Inject the inline form into the first Lumen message bubble.
  const renderedMessages = messages.map((m, i) =>
    i === 0 && m.role === "lumen" ? { ...m, form: metadataForm } : m,
  );

  /* ----- render -------------------------------------------------------- */
  return (
    <div className="flex flex-1 flex-col">
      <NewCaseFeed
        feedRef={feedRef}
        messages={renderedMessages}
        anyFailed={upload.anyFailed}
        onAttach={handleAttach}
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
  onAttach,
}: {
  feedRef: FeedRef;
  messages: ChatMessage[];
  anyFailed: boolean;
  onAttach: (files: File[]) => void;
}) {
  return (
    <div
      ref={feedRef}
      className="flex-1 overflow-auto"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => handleFeedDrop(e, onAttach)}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} msg={message} />
        ))}
        <FailedUploadNotice show={anyFailed} />
      </div>
    </div>
  );
}

function handleFeedDrop(
  e: DragEvent<HTMLDivElement>,
  onAttach: (files: File[]) => void,
) {
  e.preventDefault();
  attachDroppedFiles(e.dataTransfer.files, onAttach);
}

function attachDroppedFiles(
  files: FileList,
  onAttach: (files: File[]) => void,
) {
  if (files.length > 0) onAttach(Array.from(files));
}

function FailedUploadNotice({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="rounded-pill border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] text-bad">
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
    <div className="sticky bottom-0 border-border border-t bg-bg/80 p-3 backdrop-blur">
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
  current: number | null;
}

function replaceLastMessage(
  setMessages: MessageSetter,
  msg: Omit<ChatMessage, "id">,
) {
  setMessages((prev) => prev.slice(0, -1).concat({ id: uid(), ...msg }));
}

function notifyUnsupportedFiles(rejected: File[], push: MessagePusher) {
  if (rejected.length > 0) {
    push({ role: "lumen", text: unsupportedFilesMessage(rejected) });
  }
}

function unsupportedFilesMessage(rejected: File[]): string {
  return `Can't ingest ${unsupportedNoun(rejected)} yet — only ${SUPPORTED_LABEL} are supported in v1:\n\n${rejectedFilesList(rejected)}${unsupportedRoadmapNote(rejected)}`;
}

function unsupportedNoun(rejected: File[]): string {
  return rejected.length === 1 ? "this file" : "these files";
}

function rejectedFilesList(rejected: File[]): string {
  return rejected
    .map((file) => `• ${file.name} (${file.type || "unknown type"})`)
    .join("\n");
}

function unsupportedRoadmapNote(rejected: File[]): string {
  const media = rejectedMediaType(rejected);
  if (!media) return "";
  return `\n\n${media} need a separate vision/transcription pass — that's on the Phase 2 roadmap (Gemini/Claude vision, Whisper for audio).`;
}

function rejectedMediaType(rejected: File[]): string {
  if (rejected.some((file) => file.type.startsWith("image/"))) return "Images";
  if (rejected.some((file) => file.type.startsWith("audio/"))) return "Audio";
  return "";
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

function shouldPromptFinalize(
  allExtracted: boolean,
  alreadyPrompted: boolean,
  caseRow: CaseRow | null,
) {
  return allExtracted && !alreadyPrompted && Boolean(caseRow);
}

function clearPolling(pollRef: PollRef) {
  if (!pollRef.current) return;
  window.clearInterval(pollRef.current);
  pollRef.current = null;
}

function finalizePromptMessage(
  fileCount: number,
  onClick: () => void,
): Omit<ChatMessage, "id"> {
  return {
    role: "lumen",
    text: `All ${fileCount} ${fileNoun(fileCount)} extracted ✓ — ready to finalize ingestion and hand off to the ledger lane.`,
    action: {
      label: "Finalize & open case",
      tone: "ok",
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
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Case ID">
          <input
            value={form.case_id}
            onChange={(e) => onChange({ ...form, case_id: e.target.value })}
            placeholder={`CLM-${new Date().getFullYear()}-`}
            className="input"
          />
        </Field>
        <Field label="Jurisdiction">
          <input
            value={form.jurisdiction}
            onChange={(e) =>
              onChange({ ...form, jurisdiction: e.target.value })
            }
            className="input"
            maxLength={4}
          />
        </Field>
      </div>
      <Field label="Title">
        <input
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          placeholder="Rivera v. Blake — Red-light T-bone at 5th & Main"
          className="input"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Our insured">
          <input
            value={form.insured_name}
            onChange={(e) =>
              onChange({ ...form, insured_name: e.target.value })
            }
            placeholder="Alex Rivera"
            className="input"
          />
        </Field>
        <Field label="Other party">
          <input
            value={form.other_party_name}
            onChange={(e) =>
              onChange({ ...form, other_party_name: e.target.value })
            }
            placeholder="Jordan Blake"
            className="input"
          />
        </Field>
      </div>
      <Field label="Documented damages (USD)">
        <input
          value={form.damages_usd}
          onChange={(e) => onChange({ ...form, damages_usd: e.target.value })}
          placeholder="42000"
          inputMode="decimal"
          className="input"
        />
      </Field>
      <button
        type="button"
        onClick={onSubmit}
        disabled={phase !== "intake"}
        className="self-start rounded-pill border border-accent/40 bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
      >
        {phase === "intake" ? "Create case" : "Created ✓"}
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-muted-2 uppercase tracking-wider">
        {label}
      </span>
      {children}
    </label>
  );
}
