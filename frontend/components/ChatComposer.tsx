"use client";

import { useRef, useState } from "react";

interface Props {
  placeholder?: string;
  disabled?: boolean;
  onSend: (text: string) => void;
  onAttach: (files: File[]) => void;
  hint?: string;
}

/**
 * Bottom-pinned composer with a paperclip + textarea + send button.
 *
 * Enter sends; Shift-Enter inserts a newline. The whole composer also acts
 * as a drop target so users can drag files straight onto it (in addition to
 * the wider drop zone provided by the parent page).
 */
export function ChatComposer({ placeholder, disabled, onSend, onAttach, hint }: Props) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    // Reset textarea height after send.
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
          onAttach(Array.from(e.dataTransfer.files));
        }
      }}
      className={`mx-auto w-full max-w-3xl rounded-[18px] border bg-panel/80 p-2 shadow-card backdrop-blur transition-colors ${
        dragOver ? "border-accent/60 bg-accent/5" : "border-border"
      }`}
    >
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach files"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-border-soft bg-panel-2 text-muted hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {/* paperclip glyph */}
          <span className="text-base leading-none">📎</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf"
          onChange={(e) => {
            if (e.target.files) onAttach(Array.from(e.target.files));
            // Reset so re-selecting the same file fires onChange again.
            e.target.value = "";
          }}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            autoResize(e.currentTarget);
          }}
          onKeyDown={handleKey}
          placeholder={placeholder ?? "Type or drop evidence files…"}
          className="flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-2"
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || !text.trim()}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-accent/40 bg-accent/15 px-3 text-sm text-accent hover:bg-accent/25 disabled:opacity-50"
        >
          Send <span className="text-base leading-none">↵</span>
        </button>
      </div>
      {hint ? (
        <div className="mt-1.5 px-2 text-[11px] text-muted-2">{hint}</div>
      ) : null}
    </div>
  );
}
