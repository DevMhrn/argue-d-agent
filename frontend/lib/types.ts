/**
 * Shared TypeScript types for the Lumen frontend.
 *
 * These mirror the Pydantic models on the backend (backend/schemas/) plus the
 * pipeline I/O shapes (backend/app/types.py) the SSE stream emits. They are
 * not auto-generated — keep them in sync by hand when the backend contract
 * changes. (Generating from FastAPI's OpenAPI is a v2 nicety.)
 */

// ---- cases (storage layer) -------------------------------------------------

export type CaseStage =
  | "ingesting"
  | "ledger"
  | "ready"
  | "running"
  | "finalized"
  | "declined";

export interface CaseRow {
  id: string;
  tenant_id: string;
  case_id: string;
  title: string;
  summary: string | null;
  jurisdiction: string;
  damages_usd: string | null; // Decimal serialized as string
  insured_name: string | null;
  other_party_name: string | null;
  ingestion_complete: boolean;
  ledger_complete: boolean;
  finalized: boolean;
  last_run_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CaseCreatePayload {
  case_id: string;
  title: string;
  summary?: string | null;
  jurisdiction: string;
  damages_usd?: number | null;
  insured_name?: string | null;
  other_party_name?: string | null;
  metadata?: Record<string, unknown>;
}

// ---- documents -------------------------------------------------------------

export type DocumentStatus =
  | "pending"
  | "uploaded"
  | "extracting"
  | "extracted"
  | "failed";

export interface DocumentRow {
  id: string;
  case_id: string;
  filename: string;
  document_kind: string | null;
  mime_type: string;
  sha256: string;
  file_size_bytes: number;
  storage_provider: "backblaze" | "supabase" | "s3";
  storage_bucket: string;
  storage_key: string;
  storage_url: string | null;
  page_count: number | null;
  status: DocumentStatus;
  extraction_error: string | null;
  extraction_duration_ms: number | null;
  retry_count: number;
  last_retry_at: string | null;
  ingested_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- ingestion endpoints ---------------------------------------------------

export interface PrepareUploadRequest {
  case_id: string;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string;
  document_kind?: string | null;
}

export interface PrepareUploadResponse {
  document_id: string;
  upload_url: string;
  upload_method: "PUT";
  upload_headers: Record<string, string>;
  storage_key: string;
}

export interface CaseStatusResponse {
  case: CaseRow;
  documents: DocumentRow[];
  ingestion_complete: boolean;
}

// ---- legacy orchestration shapes (still served by server.py today) --------
// The cases list shown on / is the union of:
//   - Supabase cases from /api/ingest/* (real, post-upload)
//   - data/cases.json static cases (mock-only sample claims for the demo)
// Until Sudharsan rewrites api_run to read from Supabase, the live debate
// pipeline still uses the static claim shape — we surface both.

export interface LegacyCase {
  id: string;
  title: string;
  subtitle?: string;
  outcome?: string;
}

export interface LegacyClaim {
  caseId: string;
  insured: string;
  otherParty: string;
  jurisdiction: string;
  damagesUsd: number;
  documents: Array<{ kind: string; filename?: string }>;
}

// ---- SSE event shape (from /api/run/:id) -----------------------------------

export type RoomKind =
  | "agent"
  | "gate"
  | "system"
  | "decision"
  | "letter"
  | "verdict";

export interface RoomPosting {
  agent: string;
  color?: string;
  kind: RoomKind;
  content: string;
  at?: number;
}

export interface DecisionResult {
  outcome: "pursue" | "escalate" | "decline";
  otherFaultPct: number;
  recoveryUsd: number;
  confidence: number;
  escalate: boolean;
  consensus?: "agreement" | "disagreement" | "single" | "none";
  consensusDeltaPp?: number;
  faultTable?: Array<{ factId: string; favors: "us" | "them"; weight: number }>;
  reasoning?: string;
  letter?: string;
  auditHash?: string;
  bandRoomId?: string | null;
  secondaryDecision?: unknown;
}
