"use client";

import { FileRow, type LocalFile } from "@/components/FileRow";

export type ChatRole = "user" | "lumen" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Plain text content. Whitespace is preserved (whitespace-pre-wrap). */
  text?: string;
  /** Attached files — rendered as compact rows below the text. */
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

const ROLE_LABEL: Record<ChatRole, string> = {
  user: "You",
  lumen: "Lumen",
  system: "—",
};

const ROLE_STYLES: Record<ChatRole, string> = {
  user: "border-accent/40 bg-accent/5",
  lumen: "border-border-soft bg-panel-2",
  system: "border-border-soft bg-panel-2 text-muted",
};

const AVATAR_STYLES: Record<ChatRole, string> = {
  user: "bg-accent text-bg",
  lumen: "bg-gradient-to-br from-accent via-accent-2 to-agent-verifier text-bg",
  system: "bg-panel-3 text-muted",
};

export function ChatMessageBubble({ msg }: { msg: ChatMessage }) {
  const align = msg.role === "user" ? "items-end" : "items-start";
  const bubbleAlign = msg.role === "user" ? "flex-row-reverse" : "flex-row";

  return (
    <article className={`flex w-full ${align}`}>
      <div className={`flex max-w-[88%] gap-3 ${bubbleAlign}`}>
        <MessageAvatar role={msg.role} />
        <MessageBody msg={msg} />
      </div>
    </article>
  );
}

function MessageAvatar({ role }: { role: ChatRole }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold text-[11px] ${AVATAR_STYLES[role]}`}
    >
      {AVATAR_LABEL[role]}
    </div>
  );
}

const AVATAR_LABEL: Record<ChatRole, string> = {
  user: "•",
  lumen: "L",
  system: "i",
};

function MessageBody({ msg }: { msg: ChatMessage }) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-card border px-4 py-3 shadow-card ${ROLE_STYLES[msg.role]}`}
    >
      <MessageHeader role={msg.role} />
      <MessageText text={msg.text} pending={msg.pending} />
      {msg.form ? <div className="mt-3">{msg.form}</div> : null}
      <Attachments files={msg.attachments} />
      <MessageAction action={msg.action} />
    </div>
  );
}

function MessageHeader({ role }: { role: ChatRole }) {
  return (
    <header className="mb-1 flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-muted-2 uppercase tracking-wider">
        {ROLE_LABEL[role]}
      </span>
    </header>
  );
}

function MessageText({ text, pending }: { text?: string; pending?: boolean }) {
  if (!text) return null;

  return (
    <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
      {text}
      {pending ? <PendingDots /> : null}
    </p>
  );
}

function Attachments({ files }: { files?: LocalFile[] }) {
  if (!files?.length) return null;

  return (
    <ul className="mt-3 space-y-2">
      {files.map((file) => (
        <FileRow key={file.uid} row={file} />
      ))}
    </ul>
  );
}

function MessageAction({ action }: { action?: ChatMessage["action"] }) {
  if (!action) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.disabled}
        className={`rounded-pill border px-4 py-2 text-sm transition-colors ${ACTION_TONE[action.tone ?? "primary"]} disabled:opacity-50`}
      >
        {action.label}
      </button>
    </div>
  );
}

type ActionTone = NonNullable<NonNullable<ChatMessage["action"]>["tone"]>;

const ACTION_TONE: Record<ActionTone, string> = {
  ok: "border-ok/40 bg-ok/15 text-ok hover:bg-ok/25",
  primary: "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
};

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
