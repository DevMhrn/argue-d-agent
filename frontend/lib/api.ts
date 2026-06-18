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
  CaseDetailResponse,
  CaseRow,
  CaseStatusResponse,
  DbCase,
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

/**
 * Resolve a path to a full URL.
 *
 * Client-side (browser): return the relative path so the Next.js dev-server
 * rewrite in next.config.ts proxies /api/* to the FastAPI backend on :8000.
 *
 * Server-side (Node runtime — e.g. Server Components, route handlers,
 * generateStaticParams): the rewrite doesn't apply because the request never
 * leaves the Node process. We must hit the backend with an absolute URL.
 * The base URL comes from LUMEN_API_BASE_URL (matches next.config.ts) and
 * defaults to http://127.0.0.1:8000 in dev.
 */
function apiUrl(path: string): string {
  if (typeof window !== "undefined") return path;
  const base =
    process.env.LUMEN_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://127.0.0.1:8000";
  return `${base}${path}`;
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
  const res = await fetch(apiUrl("/api/ingest/case"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<CaseRow>(res);
}

export async function signUpload(
  payload: PrepareUploadRequest,
): Promise<PrepareUploadResponse> {
  const res = await fetch(apiUrl("/api/ingest/sign-upload"), {
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
      else
        reject(
          new ApiError(
            `Upload failed: ${xhr.status} ${xhr.statusText}`,
            xhr.status,
          ),
        );
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload", 0));
    xhr.send(file);
  });
}

export async function commitUpload(documentId: string): Promise<DocumentRow> {
  const res = await fetch(apiUrl("/api/ingest/commit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  return jsonOrThrow<DocumentRow>(res);
}

export async function getCaseStatus(
  caseId: string,
): Promise<CaseStatusResponse> {
  const res = await fetch(apiUrl(`/api/ingest/status/${caseId}`), {
    cache: "no-store",
  });
  return jsonOrThrow<CaseStatusResponse>(res);
}

export async function finalizeCase(caseId: string): Promise<CaseRow> {
  const res = await fetch(apiUrl(`/api/ingest/finalize/${caseId}`), {
    method: "POST",
  });
  return jsonOrThrow<CaseRow>(res);
}

// ---- legacy orchestration (still served from data/cases.json today) -------

export interface CasesResponse {
  mock: boolean;
  /** Backward-compat alias — same as demo_cases. */
  cases: LegacyCase[];
  demo_cases: LegacyCase[];
  db_cases: DbCase[];
  db_error: string | null;
}

export async function getCases(): Promise<CasesResponse> {
  const res = await fetch(apiUrl("/api/cases"), { cache: "no-store" });
  return jsonOrThrow<CasesResponse>(res);
}

export async function getCase(id: string): Promise<CaseDetailResponse> {
  const res = await fetch(apiUrl(`/api/case/${id}`), { cache: "no-store" });
  return jsonOrThrow<CaseDetailResponse>(res);
}

/** Backward-compat shim — only used by code paths that still expect the
 *  legacy {claim} shape (the existing three-panel demo view). */
export async function getDemoClaim(
  id: string,
): Promise<{ claim: LegacyClaim }> {
  const data = await getCase(id);
  if (data.source !== "demo") {
    throw new ApiError(`Case ${id} is not a demo case`, 400);
  }
  return { claim: data.claim };
}

export async function postDecision(payload: {
  caseId: string;
  action: "approve" | "reject";
}): Promise<{ ok: boolean }> {
  const res = await fetch(apiUrl("/api/decision"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<{ ok: boolean }>(res);
}
