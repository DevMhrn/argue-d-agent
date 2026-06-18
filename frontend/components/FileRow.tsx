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

const ACTIVE_TONE = "border-accent/40 bg-accent/10 text-accent";
const BADGES: Record<LocalFileStage, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "border-border bg-panel-2 text-muted" },
  hashing: { label: "Hashing", tone: ACTIVE_TONE },
  signing: { label: "Signing", tone: ACTIVE_TONE },
  uploading: { label: "Uploading", tone: ACTIVE_TONE },
  committing: { label: "Committing", tone: ACTIVE_TONE },
  uploaded: { label: "Uploaded", tone: ACTIVE_TONE },
  extracting: {
    label: "Extracting",
    tone: "border-warn/40 bg-warn/10 text-warn",
  },
  extracted: { label: "Extracted ✓", tone: "border-ok/40 bg-ok/10 text-ok" },
  failed: { label: "Failed", tone: "border-bad/40 bg-bad/10 text-bad" },
};

const SERVER_STAGE: Partial<Record<DocumentStatus, LocalFileStage>> = {
  extracted: "extracted",
  failed: "failed",
  extracting: "extracting",
  uploaded: "uploaded",
};

function badgeFor(stage: LocalFileStage): { label: string; tone: string } {
  return BADGES[stage];
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

export function FileRow({
  row,
  onRemove,
}: {
  row: LocalFile;
  onRemove?: () => void;
}) {
  return (
    <li className="rounded-pill border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-3">
        <FileInfo row={row} />
        <FileActions row={row} onRemove={onRemove} />
      </div>
      <ProgressBar row={row} />
      <FileError error={row.error} />
    </li>
  );
}

function FileInfo({ row }: { row: LocalFile }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{row.file.name}</div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-2">
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
  row,
  onRemove,
}: {
  row: LocalFile;
  onRemove?: () => void;
}) {
  const badge = badgeFor(row.stage);

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${badge.tone}`}
      >
        {badge.label}
      </span>
      <RemoveButton stage={row.stage} onRemove={onRemove} />
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
      className="text-muted hover:text-bad"
    >
      ✕
    </button>
  );
}

function canRemove(stage: LocalFileStage, onRemove?: () => void) {
  return Boolean(onRemove) && stage !== "extracting" && stage !== "uploading";
}

function ProgressBar({ row }: { row: LocalFile }) {
  if (!showProgress(row.stage)) return null;

  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-3">
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${row.progress}%` }}
      />
    </div>
  );
}

function showProgress(stage: LocalFileStage): boolean {
  return stage === "uploading" || stage === "hashing";
}

function FileError({ error }: { error?: string }) {
  if (!error) return null;

  return (
    <div className="mt-2 rounded-md border border-bad/40 bg-bad/5 px-2 py-1 text-[12px] text-bad">
      {error}
    </div>
  );
}
