"use client";

import { FileRow, LocalFile } from "@/components/FileRow";

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
  lumen:
    "bg-gradient-to-br from-accent via-accent-2 to-agent-verifier text-bg",
  system: "bg-panel-3 text-muted",
};

export function ChatMessageBubble({ msg }: { msg: ChatMessage }) {
  const align = msg.role === "user" ? "items-end" : "items-start";
  const bubbleAlign = msg.role === "user" ? "flex-row-reverse" : "flex-row";

  return (
    <article className={`flex w-full ${align}`}>
      <div className={`flex max-w-[88%] gap-3 ${bubbleAlign}`}>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${AVATAR_STYLES[msg.role]}`}
        >
          {msg.role === "lumen" ? "L" : msg.role === "user" ? "•" : "i"}
        </div>
        <div
          className={`min-w-0 flex-1 rounded-[14px] border px-4 py-3 shadow-card ${ROLE_STYLES[msg.role]}`}
        >
          <header className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-[11px] uppercase tracking-wider text-muted-2">
              {ROLE_LABEL[msg.role]}
            </span>
          </header>
          {msg.text ? (
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
              {msg.text}
              {msg.pending ? <PendingDots /> : null}
            </p>
          ) : null}
          {msg.form ? <div className="mt-3">{msg.form}</div> : null}
          {msg.attachments && msg.attachments.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {msg.attachments.map((f) => (
                <FileRow key={f.uid} row={f} />
              ))}
            </ul>
          ) : null}
          {msg.action ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={msg.action.onClick}
                disabled={msg.action.disabled}
                className={`rounded-[9px] border px-4 py-2 text-sm transition-colors ${
                  msg.action.tone === "ok"
                    ? "border-ok/40 bg-ok/15 text-ok hover:bg-ok/25"
                    : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
                } disabled:opacity-50`}
              >
                {msg.action.label}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

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
