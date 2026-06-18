/**
 * Per-MIME-class upload caps — mirror of backend/ingestion/limits.py.
 *
 * Three categories: document / image / audio. Each has a per-file byte cap and
 * a per-case file-count cap. Backend is authoritative; this module pre-validates
 * so users see instant feedback instead of a 400 after the upload PUT.
 */

const MB = 1024 * 1024;

export const LIMITS = {
  document: { maxBytes: 10 * MB, maxMb: 10, maxFiles: 50, label: "document" },
  image: { maxBytes: 10 * MB, maxMb: 10, maxFiles: 15, label: "image" },
  audio: { maxBytes: 50 * MB, maxMb: 50, maxFiles: 10, label: "audio" },
} as const;

export type FileCategory = keyof typeof LIMITS;

const DOCUMENT_MIME = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
]);

const IMAGE_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const AUDIO_MIME = new Set<string>([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

export const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  ...DOCUMENT_MIME,
  ...IMAGE_MIME,
  ...AUDIO_MIME,
]);

export const SUPPORTED_FILES_LABEL =
  "PDF · DOCX · Excel · HTML · Markdown · plain text · images · audio";

export function classify(mime: string): FileCategory | null {
  if (DOCUMENT_MIME.has(mime)) return "document";
  if (IMAGE_MIME.has(mime)) return "image";
  if (AUDIO_MIME.has(mime)) return "audio";
  return null;
}

export function uid(): string {
  return crypto.randomUUID();
}

export interface FileRejection {
  file: File;
  reason: "mime" | "size" | "count";
  message: string;
}

export interface FilePartition {
  accepted: File[];
  rejected: FileRejection[];
}

export interface ValidationContext {
  /** Files already on the case server-side, grouped by category. */
  existingCountsByCategory?: Partial<Record<FileCategory, number>>;
  /** Files just queued client-side in the same batch, grouped by category. */
  pendingCountsByCategory?: Partial<Record<FileCategory, number>>;
}

export function partitionSupportedFiles(
  files: File[],
  ctx: ValidationContext = {},
): FilePartition {
  const running: Record<FileCategory, number> = {
    document: ctx.existingCountsByCategory?.document ?? 0,
    image: ctx.existingCountsByCategory?.image ?? 0,
    audio: ctx.existingCountsByCategory?.audio ?? 0,
  };
  for (const cat of categories) {
    running[cat] += ctx.pendingCountsByCategory?.[cat] ?? 0;
  }

  const partition: FilePartition = { accepted: [], rejected: [] };
  for (const file of files) {
    const mime = mimeOf(file);
    const cat = classify(mime);
    if (!cat) {
      partition.rejected.push({
        file,
        reason: "mime",
        message: `Unsupported file type (${mime || "unknown"}).`,
      });
      continue;
    }
    const cap = LIMITS[cat];
    if (file.size > cap.maxBytes) {
      partition.rejected.push({
        file,
        reason: "size",
        message: `${cap.label} files limited to ${cap.maxMb} MB (this one is ${(file.size / MB).toFixed(1)} MB).`,
      });
      continue;
    }
    if (running[cat] >= cap.maxFiles) {
      partition.rejected.push({
        file,
        reason: "count",
        message: `Cap of ${cap.maxFiles} ${cap.label} file(s) per case reached.`,
      });
      continue;
    }
    running[cat] += 1;
    partition.accepted.push(file);
  }
  return partition;
}

const categories: readonly FileCategory[] = ["document", "image", "audio"];

export function queueFiles(files: File[]) {
  return files.map((file) => ({
    uid: uid(),
    file,
    stage: "queued" as const,
    progress: 0,
  }));
}

export function mimeOf(file: File): string {
  if (file.type) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      html: "text/html",
      htm: "text/html",
      txt: "text/plain",
      md: "text/markdown",
      mp3: "audio/mpeg",
      m4a: "audio/x-m4a",
      mp4: "audio/mp4",
      wav: "audio/wav",
      webm: "audio/webm",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
