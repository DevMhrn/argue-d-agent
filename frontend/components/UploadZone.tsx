"use client";

import { useCallback, useRef, useState } from "react";
import { LIMITS } from "@/lib/fileSupport";

interface Props {
  disabled?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
}

/**
 * Drag-drop + click-to-pick file zone. The parent owns the file list and
 * upload state; this component only emits the picked files.
 */
export function UploadZone({ disabled, accept, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) handle(e.dataTransfer.files);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed p-10 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-border-soft bg-panel/40 opacity-60"
          : over
            ? "border-accent bg-accent/5"
            : "border-border bg-panel hover:border-accent/60"
      }`}
    >
      <div className="text-2xl text-muted">⬆</div>
      <div className="font-medium text-sm">
        Drop documents here, or click to pick
      </div>
      <div className="text-[12px] text-muted">
        Documents (PDF · DOCX · Excel · CSV · HTML · MD · TXT) up to{" "}
        {LIMITS.document.maxMb} MB · max {LIMITS.document.maxFiles}/case
        <br />
        Images up to {LIMITS.image.maxMb} MB · max {LIMITS.image.maxFiles}/case
        &nbsp;·&nbsp; Audio up to {LIMITS.audio.maxMb} MB · max{" "}
        {LIMITS.audio.maxFiles}/case
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={
          accept ??
          ".pdf,.docx,.xlsx,.csv,.tsv,.html,.htm,.txt,.md,.mp3,.m4a,.mp4,.wav,.webm,.jpg,.jpeg,.png,.webp,.gif,application/pdf,text/csv"
        }
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
