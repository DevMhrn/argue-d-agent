/**
 * Typed fetch wrappers for the FastAPI backend.
 *
 * All calls are relative — Next.js rewrites `/api/*` to the backend in dev
 * (see next.config.ts) so the browser sees same-origin and there's no CORS.
 * In production, point LUMEN_API_BASE_URL at the deployed backend.
 *
 * The functions throw `ApiError` on non-2xx; callers should display the
 * `.message` (which carries the FastAPI `detail` field when present).
 */
import type {
  CaseCreatePayload,
  CaseRow,
  CaseStatusResponse,
  DocumentRow,
  LegacyCase,
  LegacyClaim,
  PrepareUploadRequest,
  PrepareUploadResponse,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // body wasn't JSON
    }
    throw new ApiError(`${res.status} ${detail}`, res.status);
  }
  return (await res.json()) as T;
}

// ---- ingestion lane --------------------------------------------------------

export async function createCase(payload: CaseCreatePayload): Promise<CaseRow> {
  const res = await fetch("/api/ingest/case", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<CaseRow>(res);
}

export async function signUpload(
  payload: PrepareUploadRequest,
): Promise<PrepareUploadResponse> {
  const res = await fetch("/api/ingest/sign-upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<PrepareUploadResponse>(res);
}

/**
 * Upload a file directly to object storage via a pre-signed PUT URL.
 *
 * Why PUT not POST: B2's S3-compatible API returns 501 NotImplemented for
 * POST policy uploads. PUT is universally supported. The body is the raw
 * file bytes; the Content-Type header must match what the backend signed.
 */
export async function uploadToStorage(
  presign: PrepareUploadResponse,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  // XMLHttpRequest (not fetch) because we need upload progress events for
  // the per-file progress bars in the UI.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(presign.upload_method, presign.upload_url, true);
    for (const [k, v] of Object.entries(presign.upload_headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      // S3-compatible PUT returns 200 on success.
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(`Upload failed: ${xhr.status} ${xhr.statusText}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.send(file);
  });
}

export async function commitUpload(documentId: string): Promise<DocumentRow> {
  const res = await fetch("/api/ingest/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  return jsonOrThrow<DocumentRow>(res);
}

export async function getCaseStatus(caseId: string): Promise<CaseStatusResponse> {
  const res = await fetch(`/api/ingest/status/${caseId}`, { cache: "no-store" });
  return jsonOrThrow<CaseStatusResponse>(res);
}

export async function finalizeCase(caseId: string): Promise<CaseRow> {
  const res = await fetch(`/api/ingest/finalize/${caseId}`, { method: "POST" });
  return jsonOrThrow<CaseRow>(res);
}

// ---- legacy orchestration (still served from data/cases.json today) -------

export interface CasesResponse {
  mock: boolean;
  cases: LegacyCase[];
}

export async function getCases(): Promise<CasesResponse> {
  const res = await fetch("/api/cases", { cache: "no-store" });
  return jsonOrThrow<CasesResponse>(res);
}

export async function getCase(id: string): Promise<{ claim: LegacyClaim }> {
  const res = await fetch(`/api/case/${id}`, { cache: "no-store" });
  return jsonOrThrow<{ claim: LegacyClaim }>(res);
}

export async function postDecision(payload: {
  caseId: string;
  action: "approve" | "reject";
}): Promise<{ ok: boolean }> {
  const res = await fetch("/api/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<{ ok: boolean }>(res);
}
