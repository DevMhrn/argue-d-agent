"use client";

import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useRef,
  useState,
} from "react";

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
export function ChatComposer(props: Props) {
  const composer = useComposer(props);

  return (
    <ComposerFrame
      dragOver={composer.dragOver}
      onDrop={composer.handleDrop}
      onDragOverChange={composer.setDragOver}
    >
      <div className="flex items-end gap-2">
        <AttachButton
          fileInputRef={composer.fileInputRef}
          disabled={props.disabled}
        />
        <FileInput
          fileInputRef={composer.fileInputRef}
          onChange={composer.handleFileChange}
        />
        <TextEntry
          textareaRef={composer.textareaRef}
          text={composer.text}
          disabled={props.disabled}
          placeholder={props.placeholder}
          onChange={composer.handleTextChange}
          onKeyDown={composer.handleKey}
        />
        <SendButton
          text={composer.text}
          disabled={props.disabled}
          onSend={composer.send}
        />
      </div>
      <ComposerHint hint={props.hint} />
    </ComposerFrame>
  );
}

type ComposerOptions = Pick<Props, "disabled" | "onSend" | "onAttach">;

function useComposer({ disabled, onSend, onAttach }: ComposerOptions) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    resetTextarea(textareaRef.current);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    autoResize(e.currentTarget);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    attachFileList(e.dataTransfer.files, onAttach);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    attachFileList(e.target.files, onAttach);
    e.target.value = "";
  }

  return {
    text,
    dragOver,
    fileInputRef,
    textareaRef,
    send,
    handleKey,
    handleTextChange,
    handleDrop,
    handleFileChange,
    setDragOver,
  };
}

function ComposerFrame({
  dragOver,
  onDrop,
  onDragOverChange,
  children,
}: {
  dragOver: boolean;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragOverChange: (dragOver: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverChange(true);
      }}
      onDragLeave={() => onDragOverChange(false)}
      onDrop={onDrop}
      className={`mx-auto w-full max-w-3xl rounded-[18px] border bg-panel/80 p-2 shadow-card backdrop-blur transition-colors ${
        dragOver ? "border-accent/60 bg-accent/5" : "border-border"
      }`}
    >
      {children}
    </div>
  );
}

function AttachButton({
  fileInputRef,
  disabled,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      disabled={disabled}
      aria-label="Attach files"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-border-soft bg-panel-2 text-muted hover:border-accent hover:text-accent disabled:opacity-50"
    >
      <span className="text-base leading-none">📎</span>
    </button>
  );
}

function FileInput({
  fileInputRef,
  onChange,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      hidden
      accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf"
      onChange={onChange}
    />
  );
}

function TextEntry({
  textareaRef,
  text,
  disabled,
  placeholder,
  onChange,
  onKeyDown,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
  disabled?: boolean;
  placeholder?: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={text}
      disabled={disabled}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder ?? "Type or drop evidence files…"}
      className="flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none placeholder:text-muted-2"
    />
  );
}

function SendButton({
  text,
  disabled,
  onSend,
}: {
  text: string;
  disabled?: boolean;
  onSend: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={disabled || !text.trim()}
      className="flex h-9 shrink-0 items-center gap-1.5 rounded-pill border border-accent/40 bg-accent/15 px-3 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
    >
      Send <span className="text-base leading-none">↵</span>
    </button>
  );
}

function ComposerHint({ hint }: { hint?: string }) {
  if (!hint) return null;
  return <div className="mt-1.5 px-2 text-[11px] text-muted-2">{hint}</div>;
}

function attachFileList(
  files: FileList | null,
  onAttach: (files: File[]) => void,
) {
  if (!files || files.length === 0) return;
  onAttach(Array.from(files));
}

function resetTextarea(el: HTMLTextAreaElement | null) {
  if (el) el.style.height = "auto";
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}
