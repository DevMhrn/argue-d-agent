"use client";

import type { CSSProperties } from "react";
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

/**
 * Per-stage presentation: the colored stage text (mono, comp line 878), the
 * trailing badge (✓ / percent / label) and the color that drives both the
 * stage text and the thin progress bar.
 */
interface StagePresentation {
  /** Human stage line, e.g. "Signing → Uploading…". */
  text: string;
  /** CSS color token driving the stage text + progress fill. */
  color: string;
  /** Trailing badge contents — ✓ when terminal-good, else a short token. */
  badge: string;
  /** Badge chip color tone (token utilities). */
  badgeTone: string;
}

const STAGE_TEXT: Record<LocalFileStage, string> = {
  queued: "Queued",
  hashing: "Hashing…",
  signing: "Signing…",
  uploading: "Uploading…",
  committing: "Committing…",
  uploaded: "Uploaded",
  extracting: "Extracting…",
  extracted: "Extracted ✓",
  failed: "Failed",
};

// Stage text color (comp drives the progress fill from this same token).
const STAGE_COLOR: Record<LocalFileStage, string> = {
  queued: "var(--color-muted-2)",
  hashing: "var(--color-accent)",
  signing: "var(--color-warn)",
  uploading: "var(--color-warn)",
  committing: "var(--color-accent)",
  uploaded: "var(--color-accent)",
  extracting: "var(--color-accent)",
  extracted: "var(--color-ok)",
  failed: "var(--color-bad)",
};

const OK_BADGE = "border-ok/40 bg-ok/10 text-ok";
const ACCENT_BADGE = "border-accent-dim bg-accent/10 text-accent-strong";
const WARN_BADGE = "border-warn/40 bg-warn/10 text-warn";
const BAD_BADGE = "border-bad/40 bg-bad/10 text-bad";
const MUTED_BADGE = "border-border bg-panel-3 text-muted";

const BADGE_TONE: Record<LocalFileStage, string> = {
  queued: MUTED_BADGE,
  hashing: ACCENT_BADGE,
  signing: WARN_BADGE,
  uploading: WARN_BADGE,
  committing: ACCENT_BADGE,
  uploaded: ACCENT_BADGE,
  extracting: ACCENT_BADGE,
  extracted: OK_BADGE,
  failed: BAD_BADGE,
};

const SERVER_STAGE: Partial<Record<DocumentStatus, LocalFileStage>> = {
  extracted: "extracted",
  failed: "failed",
  extracting: "extracting",
  uploaded: "uploaded",
};

function presentationFor(row: LocalFile): StagePresentation {
  return {
    text: STAGE_TEXT[row.stage],
    color: STAGE_COLOR[row.stage],
    badge: badgeLabel(row),
    badgeTone: BADGE_TONE[row.stage],
  };
}

function badgeLabel(row: LocalFile): string {
  if (row.stage === "extracted") return "✓";
  if (row.stage === "failed") return "Failed";
  if (showProgress(row.stage)) return `${Math.round(row.progress)}%`;
  return STAGE_TEXT[row.stage];
}

/** Merge a per-document status from the polling endpoint into the local stage. */
export function mergeServerStatus(
  local: LocalFileStage,
  server: DocumentStatus | undefined,
): LocalFileStage {
  if (!server) return local;
  const serverStage = SERVER_STAGE[server];
  if (!serverStage) return local;
  return mergeUploadedStage(local, serverStage);
}

function mergeUploadedStage(
  local: LocalFileStage,
  server: LocalFileStage,
): LocalFileStage {
  if (server !== "uploaded") return server;
  return local === "extracting" ? local : server;
}

/** Short format tag for the pictogram (PDF / XLS / CSV / …) from the filename. */
function formatTag(name: string): string {
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  if (!ext || ext.length > 4) return "DOC";
  if (ext === "XLSX") return "XLS";
  if (ext === "JPEG") return "IMG";
  if (ext === "PNG" || ext === "JPG" || ext === "WEBP" || ext === "GIF") {
    return "IMG";
  }
  return ext;
}

export function FileRow({
  row,
  onRemove,
}: {
  row: LocalFile;
  onRemove?: () => void;
}) {
  const present = presentationFor(row);

  return (
    <li className="w-full rounded-[10px] border border-border bg-panel-2 px-3.25 py-2.75">
      <div className="flex items-center gap-2.5">
        <FormatTag name={row.file.name} />
        <FileInfo row={row} present={present} />
        <FileActions present={present} stage={row.stage} onRemove={onRemove} />
      </div>
      <ProgressBar row={row} color={present.color} />
      <FileError error={row.error} />
    </li>
  );
}

function FormatTag({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-border bg-panel-3 font-mono text-[8.5px] text-muted">
      {formatTag(name)}
    </span>
  );
}

function FileInfo({
  row,
  present,
}: {
  row: LocalFile;
  present: StagePresentation;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium text-[12.5px]">{row.file.name}</div>
      <div
        className="mt-0.5 font-mono text-[10px]"
        style={{ color: present.color }}
      >
        {present.text}
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-muted-2">
        {fileMeta(row)}
      </div>
    </div>
  );
}

function fileMeta(row: LocalFile): string {
  return [
    `${(row.file.size / (1024 * 1024)).toFixed(2)} MB`,
    row.file.type || "unknown",
    shaMeta(row.sha256),
  ]
    .filter(Boolean)
    .join(" · ");
}

function shaMeta(sha256: string | undefined): string {
  return sha256 ? `sha256:${sha256.slice(0, 8)}…` : "";
}

function FileActions({
  present,
  stage,
  onRemove,
}: {
  present: StagePresentation;
  stage: LocalFileStage;
  onRemove?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span
        className={`inline-flex items-center rounded-chip border px-2 py-0.5 font-mono text-[9.5px] ${present.badgeTone}`}
      >
        {present.badge}
      </span>
      <RemoveButton stage={stage} onRemove={onRemove} />
    </div>
  );
}

function RemoveButton({
  stage,
  onRemove,
}: {
  stage: LocalFileStage;
  onRemove?: () => void;
}) {
  if (!canRemove(stage, onRemove)) return null;

  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label="Remove file"
      className="appearance-none border-0 bg-transparent p-0 text-muted leading-none hover:text-bad"
    >
      ✕
    </button>
  );
}

function canRemove(stage: LocalFileStage, onRemove?: () => void) {
  return Boolean(onRemove) && stage !== "extracting" && stage !== "uploading";
}

function ProgressBar({ row, color }: { row: LocalFile; color: string }) {
  if (!showProgress(row.stage)) return null;

  const fill: CSSProperties = { width: `${row.progress}%`, background: color };

  return (
    <div className="mt-2.25 h-0.75 overflow-hidden rounded-[3px] bg-panel-3">
      <div className="h-full rounded-[3px] transition-all" style={fill} />
    </div>
  );
}

function showProgress(stage: LocalFileStage): boolean {
  return stage === "uploading" || stage === "hashing";
}

function FileError({ error }: { error?: string }) {
  if (!error) return null;

  return (
    <div className="mt-2 rounded-md border border-bad/40 bg-bad/5 px-2 py-1 text-[11.5px] text-bad">
      {error}
    </div>
  );
}
