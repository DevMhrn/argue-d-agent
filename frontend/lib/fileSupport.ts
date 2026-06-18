export const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/plain",
  "text/markdown",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-m4a",
  "audio/x-wav",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const SUPPORTED_FILES_LABEL =
  "PDF · DOCX · Excel · HTML · Markdown · plain text · images · audio";

export function uid(): string {
  return crypto.randomUUID();
}

export interface FilePartition {
  accepted: File[];
  rejected: File[];
}

export function partitionSupportedFiles(files: File[]): FilePartition {
  return files.reduce<FilePartition>(addToPartition, {
    accepted: [],
    rejected: [],
  });
}

function addToPartition(partition: FilePartition, file: File): FilePartition {
  const target = SUPPORTED_MIME_TYPES.has(mimeOf(file))
    ? partition.accepted
    : partition.rejected;
  target.push(file);
  return partition;
}

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
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
