export const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/html",
  "text/plain",
  "text/markdown",
]);

export const SUPPORTED_FILES_LABEL = "PDF · DOCX · HTML · plain text";

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
      html: "text/html",
      htm: "text/html",
      txt: "text/plain",
      md: "text/plain",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
