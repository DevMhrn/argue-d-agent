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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { sha256Hex } from "@/lib/sha256";
import type { CaseRow } from "@/lib/types";

/* -------------------------------------------------------------- helpers */

function uid() {
  return crypto.randomUUID();
}

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

/**
 * MIME types our extractors actually handle today. This must mirror
 * backend/ingestion/extractors/registry.py — keep them in sync by hand.
 * Images (PNG/JPG) and audio are Phase 2 (vision via Gemini/Claude + Whisper),
 * see docs/ingestion-start-context.md §17 / §22.
 */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "text/plain",
  "text/markdown",
]);
const SUPPORTED_LABEL = "PDF · DOCX · HTML · plain text";

/* -------------------------------------------------------------- page */

type Phase = "intake" | "uploading" | "ready" | "finalizing";

export default function NewCasePage() {
  const router = useRouter();

  // Conversation state — messages are immutable bubbles, files are tracked
  // separately so we can mutate their per-file progress in place.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [caseRow, setCaseRow] = useState<CaseRow | null>(null);
  const [phase, setPhase] = useState<Phase>("intake");

  // Inline metadata form state (lives inside Lumen's first message bubble).
  const [form, setForm] = useState({
    case_id: "",
    title: "",
    jurisdiction: "CA",
    insured_name: "",
    other_party_name: "",
    damages_usd: "",
    summary: "",
  });

  // Refs so we can scroll-to-bottom and stop polling on unmount.
  const feedRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<number | null>(null);

  // ---- conversation helpers --------------------------------------------
  const push = useCallback((msg: Omit<ChatMessage, "id">) => {
    setMessages((prev) => [...prev, { id: uid(), ...msg }]);
  }, []);

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
    push({
      role: "user",
      text:
        `${form.title || "Untitled case"}\n` +
        `${form.insured_name || "—"} vs ${form.other_party_name || "—"} · ` +
        `${form.jurisdiction || "CA"}` +
        (form.damages_usd ? ` · $${form.damages_usd}` : ""),
    });
    push({ role: "lumen", text: "Creating the case shell…", pending: true });

    try {
      const damages = form.damages_usd.trim()
        ? Number(form.damages_usd.replace(/[^0-9.]/g, ""))
        : null;
      const created = await createCase({
        case_id: form.case_id.trim() || `CLM-${Date.now()}`,
        title: form.title.trim() || "Untitled case",
        summary: form.summary.trim() || null,
        jurisdiction: form.jurisdiction.trim() || "CA",
        damages_usd: damages,
        insured_name: form.insured_name.trim() || null,
        other_party_name: form.other_party_name.trim() || null,
      });
      setCaseRow(created);
      // Replace the pending bubble with the confirmation.
      setMessages((prev) =>
        prev.slice(0, -1).concat({
          id: uid(),
          role: "lumen",
          text:
            `Case created — ${created.case_id} (id ${created.id.slice(0, 8)}…).\n` +
            "Drop the evidence files into the chat, or click 📎 below.",
        }),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.slice(0, -1).concat({
          id: uid(),
          role: "lumen",
          text: `Couldn't create the case: ${err instanceof ApiError ? err.message : String(err)}. Try again.`,
        }),
      );
      setPhase("intake");
    }
  }

  // ---- step 2: per-file ingestion pipeline -----------------------------
  function setFile(uid_: string, patch: Partial<LocalFile>) {
    setFiles((prev) =>
      prev.map((r) => (r.uid === uid_ ? { ...r, ...patch } : r)),
    );
  }

  const runOneFile = useCallback(async (caseUuid: string, row: LocalFile) => {
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
  }, []);

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

  const handleAttach = useCallback(
    async (picked: File[]) => {
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
      const accepted: File[] = [];
      const rejected: File[] = [];
      for (const f of picked) {
        const m = mimeOf(f);
        if (SUPPORTED_MIME_TYPES.has(m)) accepted.push(f);
        else rejected.push(f);
      }

      if (rejected.length > 0) {
        const list = rejected
          .map((f) => `• ${f.name} (${f.type || "unknown type"})`)
          .join("\n");
        const isImage = rejected.some((f) => f.type.startsWith("image/"));
        const isAudio = rejected.some((f) => f.type.startsWith("audio/"));
        const phase2Note =
          isImage || isAudio
            ? `\n\n${isImage ? "Images" : "Audio"} need a separate vision/transcription pass — that's on the Phase 2 roadmap (Gemini/Claude vision, Whisper for audio).`
            : "";
        push({
          role: "lumen",
          text: `Can't ingest ${rejected.length === 1 ? "this file" : "these files"} yet — only ${SUPPORTED_LABEL} are supported in v1:\n\n${list}${phase2Note}`,
        });
      }

      if (accepted.length === 0) return;

      // 1. Push a user message with the file chips (initially "queued").
      const queued: LocalFile[] = accepted.map((f) => ({
        uid: uid(),
        file: f,
        stage: "queued",
        progress: 0,
      }));
      setFiles((prev) => [...prev, ...queued]);
      push({
        role: "user",
        attachments: queued,
      });
      push({
        role: "lumen",
        text: `Uploading ${queued.length} file${queued.length === 1 ? "" : "s"} directly to object storage and queueing extraction…`,
      });

      // 2. Run each file through the upload pipeline (concurrency = 3).
      const CONCURRENCY = 3;
      let cursor = 0;
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < queued.length) {
          const i = cursor++;
          await runOneFile(caseRow.id, queued[i]);
        }
      });
      await Promise.all(workers);

      // 3. Begin polling for extraction completion.
      startPolling(caseRow.id);
    },
    [caseRow, push, runOneFile],
  );

  // ---- step 3: finalize when all files are extracted -------------------
  const allFileStages = files.map((f) => f.stage);
  const allExtracted =
    files.length > 0 && allFileStages.every((s) => s === "extracted");
  const anyFailed = allFileStages.includes("failed");
  const anyInFlight = allFileStages.some((s) =>
    [
      "queued",
      "hashing",
      "signing",
      "uploading",
      "committing",
      "uploaded",
      "extracting",
    ].includes(s),
  );

  // When we transition into "all extracted", drop a Lumen message offering to
  // finalize. Tracked via a ref so we only post the prompt once.
  const promptedFinalizeRef = useRef(false);
  useEffect(() => {
    if (allExtracted && !promptedFinalizeRef.current && caseRow) {
      promptedFinalizeRef.current = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      push({
        role: "lumen",
        text: `All ${files.length} file${files.length === 1 ? "" : "s"} extracted ✓ — ready to finalize ingestion and hand off to the ledger lane.`,
        action: {
          label: "Finalize & open case",
          tone: "ok",
          onClick: async () => {
            if (!caseRow) return;
            setPhase("finalizing");
            try {
              await finalizeCase(caseRow.id);
              router.push(`/cases/${encodeURIComponent(caseRow.id)}`);
            } catch (err) {
              push({
                role: "lumen",
                text: `Finalize failed: ${err instanceof ApiError ? err.message : String(err)}`,
              });
              setPhase("ready");
            }
          },
        },
      });
      setPhase("ready");
    }
  }, [allExtracted, caseRow, files.length, push, router]);

  // ---- free-text user messages -----------------------------------------
  const handleSend = useCallback(
    (text: string) => {
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
    },
    [caseRow, form.title, phase, push],
  );

  // ---- the inline metadata form rendered inside the first Lumen bubble -
  const metadataForm = useMemo(
    () => (
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Case ID">
            <input
              value={form.case_id}
              onChange={(e) => setForm({ ...form, case_id: e.target.value })}
              placeholder={`CLM-${new Date().getFullYear()}-`}
              className="input"
            />
          </Field>
          <Field label="Jurisdiction">
            <input
              value={form.jurisdiction}
              onChange={(e) =>
                setForm({ ...form, jurisdiction: e.target.value })
              }
              className="input"
              maxLength={4}
            />
          </Field>
        </div>
        <Field label="Title">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Rivera v. Blake — Red-light T-bone at 5th & Main"
            className="input"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Our insured">
            <input
              value={form.insured_name}
              onChange={(e) =>
                setForm({ ...form, insured_name: e.target.value })
              }
              placeholder="Alex Rivera"
              className="input"
            />
          </Field>
          <Field label="Other party">
            <input
              value={form.other_party_name}
              onChange={(e) =>
                setForm({ ...form, other_party_name: e.target.value })
              }
              placeholder="Jordan Blake"
              className="input"
            />
          </Field>
        </div>
        <Field label="Documented damages (USD)">
          <input
            value={form.damages_usd}
            onChange={(e) => setForm({ ...form, damages_usd: e.target.value })}
            placeholder="42000"
            inputMode="decimal"
            className="input"
          />
        </Field>
        <button
          type="button"
          onClick={submitForm}
          disabled={phase !== "intake"}
          className="self-start rounded-pill border border-accent/40 bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
        >
          {phase === "intake" ? "Create case" : "Created ✓"}
        </button>
      </div>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, phase],
  );

  // Inject the inline form into the first Lumen message bubble.
  const renderedMessages = messages.map((m, i) =>
    i === 0 && m.role === "lumen" ? { ...m, form: metadataForm } : m,
  );

  /* ----- render -------------------------------------------------------- */
  return (
    <div className="flex flex-1 flex-col">
      <div
        ref={feedRef}
        className="flex-1 overflow-auto"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length > 0) {
            handleAttach(Array.from(e.dataTransfer.files));
          }
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
          {renderedMessages.map((m) => (
            <ChatMessageBubble key={m.id} msg={m} />
          ))}
          {anyFailed ? (
            <div className="rounded-pill border border-bad/40 bg-bad/5 px-3 py-2 text-[12px] text-bad">
              One or more files failed. Remove and re-drop, or check the worker
              logs.
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 border-border border-t bg-bg/80 p-3 backdrop-blur">
        <ChatComposer
          placeholder={
            !caseRow
              ? "Type the case context (or just paste a paragraph)…"
              : anyInFlight
                ? "Files extracting… you can still drop more."
                : "Drop more evidence, or type a note."
          }
          onSend={handleSend}
          onAttach={handleAttach}
          hint={
            caseRow
              ? `Case ${caseRow.case_id} · ${files.length} file${files.length === 1 ? "" : "s"} · ${files.filter((f) => f.stage === "extracted").length} extracted`
              : "Create the case first, then drop files."
          }
        />
      </div>
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
