"use client";

import type { DocumentStatus } from "@/lib/types";

export type LocalFileStage =
  | "queued"
  | "hashing"
  | "signing"
  | "uploading"
  | "committing"
  | "uploaded"
  | "extracting"
  | "extracted"
  | "failed";

export interface LocalFile {
  /** Browser-side id (UUID) so React keys are stable before we have a DB id. */
  uid: string;
  file: File;
  stage: LocalFileStage;
  progress: number; // 0–100 during upload
  sha256?: string;
  documentId?: string;
  error?: string;
}

function badgeFor(stage: LocalFileStage): { label: string; tone: string } {
  switch (stage) {
    case "queued":
      return { label: "Queued", tone: "border-border bg-panel-2 text-muted" };
    case "hashing":
      return { label: "Hashing", tone: "border-accent/40 bg-accent/10 text-accent" };
    case "signing":
      return { label: "Signing", tone: "border-accent/40 bg-accent/10 text-accent" };
    case "uploading":
      return { label: "Uploading", tone: "border-accent/40 bg-accent/10 text-accent" };
    case "committing":
      return { label: "Committing", tone: "border-accent/40 bg-accent/10 text-accent" };
    case "uploaded":
      return { label: "Uploaded", tone: "border-accent/40 bg-accent/10 text-accent" };
    case "extracting":
      return { label: "Extracting", tone: "border-warn/40 bg-warn/10 text-warn" };
    case "extracted":
      return { label: "Extracted ✓", tone: "border-ok/40 bg-ok/10 text-ok" };
    case "failed":
      return { label: "Failed", tone: "border-bad/40 bg-bad/10 text-bad" };
  }
}

/** Merge a per-document status from the polling endpoint into the local stage. */
export function mergeServerStatus(
  local: LocalFileStage,
  server: DocumentStatus | undefined,
): LocalFileStage {
  if (!server) return local;
  if (server === "extracted") return "extracted";
  if (server === "failed") return "failed";
  if (server === "extracting") return "extracting";
  if (server === "uploaded") return local === "extracting" ? "extracting" : "uploaded";
  return local;
}

export function FileRow({ row, onRemove }: { row: LocalFile; onRemove?: () => void }) {
  const badge = badgeFor(row.stage);
  const sizeMb = (row.file.size / (1024 * 1024)).toFixed(2);
  const showBar = row.stage === "uploading" || row.stage === "hashing";
  return (
    <li className="rounded-[9px] border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{row.file.name}</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-2">
            {sizeMb} MB · {row.file.type || "unknown"}
            {row.sha256 ? ` · sha256:${row.sha256.slice(0, 8)}…` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${badge.tone}`}
          >
            {badge.label}
          </span>
          {onRemove && row.stage !== "extracting" && row.stage !== "uploading" ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove file"
              className="text-muted hover:text-bad"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>
      {showBar ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-3">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${row.progress}%` }}
          />
        </div>
      ) : null}
      {row.error ? (
        <div className="mt-2 rounded-[6px] border border-bad/40 bg-bad/5 px-2 py-1 text-[12px] text-bad">
          {row.error}
        </div>
      ) : null}
    </li>
  );
}
