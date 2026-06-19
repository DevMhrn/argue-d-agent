"use client";

import type { LocalFile } from "@/components/FileRow";

export type ChatRole = "user" | "lumen" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Plain text content. Whitespace is preserved (whitespace-pre-wrap). */
  text?: string;
  /** Attached files — rendered as live per-file progress chips. */
  attachments?: LocalFile[];
  /** Optional inline action (button) — used by Lumen messages that prompt next step. */
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "primary" | "ok";
  };
  /** Optional inline form block — used for case metadata capture. */
  form?: React.ReactNode;
  /** Optional pending state (animated dots) — show while Lumen is "thinking". */
  pending?: boolean;
}

const LUMEN_AVATAR_GRADIENT = "linear-gradient(135deg,#e7d3a8,#caa86a)";

export function ChatMessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === "system") return <SystemMessage msg={msg} />;
  return <PartyMessage msg={msg} />;
}

/* ----------------------------------------------------------- party message */

function PartyMessage({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";

  return (
    <div
      className="flex items-start gap-3"
      style={{ flexDirection: isUser ? "row-reverse" : "row" }}
    >
      {isUser ? <UserAvatar /> : <LumenAvatar />}
      <MessageColumn msg={msg} isUser={isUser} />
    </div>
  );
}

function MessageColumn({ msg, isUser }: { msg: ChatMessage; isUser: boolean }) {
  // Attachment-only user messages render the drop-zone + live chips stack;
  // everything else renders a single bubble. Lumen bubbles clip top-left,
  // user bubbles clip top-right (per comp).
  if (isUser && msg.attachments?.length) {
    return <AttachmentColumn files={msg.attachments} />;
  }

  return (
    <div
      className="min-w-0 flex-1 border border-border bg-panel"
      style={{
        borderRadius: "13px",
        borderTopLeftRadius: isUser ? "13px" : "4px",
        borderTopRightRadius: isUser ? "4px" : "13px",
        padding: "16px 20px",
        maxWidth: isUser ? "480px" : undefined,
      }}
    >
      <MessageText text={msg.text} pending={msg.pending} />
      {msg.form ? <div className="mt-4">{msg.form}</div> : null}
      <MessageAction action={msg.action} />
    </div>
  );
}

function LumenAvatar() {
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center font-bold font-serif"
      style={{
        borderRadius: "9px",
        background: LUMEN_AVATAR_GRADIENT,
        color: "#1a150d",
        fontSize: "15px",
      }}
    >
      L
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-border bg-panel-3 font-semibold text-[12px] text-muted">
      You
    </div>
  );
}

function MessageText({ text, pending }: { text?: string; pending?: boolean }) {
  if (!text) return null;

  return (
    <p className="whitespace-pre-wrap text-[13.5px] text-text leading-[1.6]">
      {text}
      {pending ? <PendingDots /> : null}
    </p>
  );
}

function MessageAction({ action }: { action?: ChatMessage["action"] }) {
  if (!action) return null;

  const ok = action.tone === "ok";

  return (
    <div className="mt-3.5">
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        className="font-semibold text-[13px]"
        style={{
          padding: "10px 17px",
          borderRadius: "9px",
          border: "none",
          background: ok
            ? "linear-gradient(180deg,#7bbf9c,#5fa882)"
            : "linear-gradient(180deg,#6f9bf0,#5b8def)",
          color: "#0e1320",
        }}
      >
        {action.label}
      </button>
    </div>
  );
}

/* ------------------------------------------------- attachment chip column */

function AttachmentColumn({ files }: { files: LocalFile[] }) {
  return (
    <div
      className="flex flex-1 flex-col items-end gap-2.25"
      style={{ maxWidth: "480px" }}
    >
      <DropZoneBubble />
      {files.map((file) => (
        <AttachmentChip key={file.uid} file={file} />
      ))}
    </div>
  );
}

/** Static dashed affordance heading the user attachment column (per comp). */
function DropZoneBubble() {
  return (
    <div
      className="w-full text-center text-[12.5px] text-muted"
      style={{
        border: "1.5px dashed var(--color-accent-dim)",
        borderRadius: "13px",
        borderTopRightRadius: "4px",
        padding: "16px",
        background: "rgba(111,155,240,0.04)",
      }}
    >
      Documents dropped into the chat
    </div>
  );
}

interface ChipVisual {
  /** Stage one-liner under the filename. */
  label: string;
  /** Stage-driven color token used for the label, badge, and bar fill. */
  color: string;
  /** Right-aligned badge text (✓ when extracted, otherwise a percentage). */
  badge: string;
  /** Progress-bar fill width, 0–100. */
  pct: number;
}

const ACTIVE_COLOR = "var(--color-accent-strong)";

function chipVisual(file: LocalFile): ChipVisual {
  const pct = stagePct(file);
  switch (file.stage) {
    case "extracted":
      return {
        label: "Extracted ✓",
        color: "var(--color-ok)",
        badge: "✓",
        pct: 100,
      };
    case "extracting":
      return {
        label: "Extracting…",
        color: "var(--color-warn)",
        badge: pctText(pct),
        pct,
      };
    case "failed":
      return {
        label: file.error ?? "Failed",
        color: "var(--color-bad)",
        badge: "!",
        pct: 100,
      };
    case "queued":
      return {
        label: "Queued",
        color: "var(--color-muted-2)",
        badge: pctText(pct),
        pct,
      };
    case "hashing":
      return {
        label: "Hashing…",
        color: ACTIVE_COLOR,
        badge: pctText(pct),
        pct,
      };
    case "signing":
      return {
        label: "Signing…",
        color: ACTIVE_COLOR,
        badge: pctText(pct),
        pct,
      };
    case "uploading":
      return {
        label: "Signing → Uploading…",
        color: ACTIVE_COLOR,
        badge: pctText(pct),
        pct,
      };
    case "committing":
      return {
        label: "Committing…",
        color: ACTIVE_COLOR,
        badge: pctText(pct),
        pct,
      };
    default:
      return {
        label: "Uploaded",
        color: ACTIVE_COLOR,
        badge: pctText(pct),
        pct,
      };
  }
}

/** Derive a coarse progress percentage from the upload state machine. */
function stagePct(file: LocalFile): number {
  switch (file.stage) {
    case "queued":
      return 4;
    case "hashing":
      return 16;
    case "signing":
      return 28;
    case "uploading":
      // The PUT reports real byte progress; map it into the 28–80 band.
      return 28 + Math.round((clampPct(file.progress) / 100) * 52);
    case "committing":
      return 84;
    case "uploaded":
      return 88;
    case "extracting":
      return 92;
    case "extracted":
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function pctText(pct: number): string {
  return `${Math.round(pct)}%`;
}

function AttachmentChip({ file }: { file: LocalFile }) {
  const v = chipVisual(file);

  return (
    <div
      className="w-full border border-border bg-panel-2"
      style={{ borderRadius: "10px", padding: "11px 13px" }}
    >
      <div className="flex items-center gap-2.5">
        <FormatTag name={file.file.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-[12.5px] text-text">
            {file.file.name}
          </div>
          <div
            className="mt-0.5 font-mono text-[10px]"
            style={{ color: v.color }}
          >
            {v.label}
          </div>
        </div>
        <ChipBadge text={v.badge} color={v.color} />
      </div>
      <ChipProgress pct={v.pct} color={v.color} />
    </div>
  );
}

function FormatTag({ name }: { name: string }) {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-border bg-panel-3 font-mono text-[8.5px] text-muted">
      {fileFormat(name)}
    </div>
  );
}

function fileFormat(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "DOC";
  return name
    .slice(dot + 1)
    .slice(0, 4)
    .toUpperCase();
}

function ChipBadge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="shrink-0 font-mono text-[9.5px]"
      style={{
        padding: "2px 8px",
        borderRadius: "20px",
        color,
        border: `1px solid ${withAlpha(color, "0.4")}`,
        background: withAlpha(color, "0.1"),
      }}
    >
      {text}
    </span>
  );
}

function ChipProgress({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      className="mt-2.25 overflow-hidden bg-panel-3"
      style={{ height: "3px", borderRadius: "3px" }}
    >
      <div
        className="h-full transition-all"
        style={{ width: `${pct}%`, background: color, borderRadius: "3px" }}
      />
    </div>
  );
}

/**
 * Fold a stage color (token or hex) into an rgba wash. CSS variables can't be
 * alpha-composited inline, so map the known tokens to their literal channels.
 */
function withAlpha(color: string, alpha: string): string {
  const rgb = TOKEN_RGB[color];
  return rgb ? `rgba(${rgb},${alpha})` : color;
}

const TOKEN_RGB: Record<string, string> = {
  "var(--color-ok)": "110,169,138",
  "var(--color-warn)": "212,164,74",
  "var(--color-bad)": "198,106,90",
  "var(--color-accent-strong)": "140,176,247",
  "var(--color-muted-2)": "110,102,87",
};

/* ----------------------------------------------------------- system band */

function SystemMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border-soft" />
      <span className="font-mono text-[10.5px] text-muted-2 uppercase tracking-[0.12em]">
        {msg.text}
      </span>
      <span className="h-px flex-1 bg-border-soft" />
    </div>
  );
}

/* ----------------------------------------------------------- pending dots */

function PendingDots() {
  return (
    <span className="ml-1 inline-flex gap-1 align-middle">
      <Dot delay="0ms" />
      <Dot delay="160ms" />
      <Dot delay="320ms" />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-2"
      style={{ animationDelay: delay }}
    />
  );
}
