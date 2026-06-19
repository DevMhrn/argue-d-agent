"use client";

import { useRef, useState } from "react";
import { LIMITS, SUPPORTED_FILE_ACCEPT } from "@/lib/fileSupport";

interface Props {
  disabled?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
}

/**
 * Drag-drop + click-to-pick file zone — the dashed "exhibit drop" area at the
 * foot of the Documents panel (comp lines 255-258 / 869). The parent owns the
 * file list and upload state; this component only emits the picked files.
 */
export function UploadZone({ disabled, accept, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  function pick() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={pick}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) emit(e.dataTransfer.files);
      }}
      className={`block w-full appearance-none rounded-[10px] border-[1.5px] border-dashed p-3.5 text-center transition-colors ${
        disabled
          ? "cursor-not-allowed border-border-soft bg-panel/40 opacity-60"
          : over
            ? "cursor-pointer border-accent bg-[rgba(111,155,240,0.06)]"
            : "cursor-pointer border-border bg-transparent hover:border-accent-dim hover:bg-[rgba(111,155,240,0.04)]"
      }`}
    >
      <div className="mb-1 text-[12px] text-muted">
        Drop documents here, or click to pick
      </div>
      <div className="font-mono text-[9.5px] text-muted-2 leading-normal">
        PDF · DOCX · XLSX · CSV · up to {LIMITS.document.maxMb}MB · max{" "}
        {LIMITS.document.maxFiles}/case
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={accept ?? SUPPORTED_FILE_ACCEPT}
        onChange={(e) => emit(e.target.files)}
      />
    </button>
  );
}
