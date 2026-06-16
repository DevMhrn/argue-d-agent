-- ============================================================================
-- Lumen — Initial Schema (migration 001)
-- ============================================================================
--
-- Tables for the three-stage pipeline:
--   1. INGESTION  (this lane) — cases, documents, document_pages, statutes
--   2. LEDGER     (Gowtham)   — nodes, edges
--   3. ORCHESTRATION (Sudharsan) — transcript, decisions
--
-- Apply to a fresh Supabase project via the SQL editor. Idempotent for table
-- creation; re-running on a populated DB is safe but will not rebuild triggers.
--
-- Creation order is bottom-up by foreign-key dependency:
--   cases → documents → document_pages → statutes → nodes → edges → transcript → decisions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
-- updated_at auto-touch — attach as a BEFORE UPDATE trigger to any table that
-- has an updated_at column.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- cases — one row per subrogation case the system has seen.
-- ---------------------------------------------------------------------------
-- tenant_id has a default UUID so single-tenant demo writes "just work";
-- production deployments override per request.
-- case_id is a human-readable identifier ("CLM-2026-0427") unique within tenant.
-- The three boolean flags drive the cross-stage handoff:
--   ingestion_complete → triggers Gowtham's ledger stage
--   ledger_complete    → triggers Sudharsan's orchestration stage
--   finalized          → human reviewer has signed off
create table if not exists cases (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null default '00000000-0000-0000-0000-000000000001',
  case_id             text not null,
  title               text not null,
  summary             text,
  jurisdiction        text not null,
  damages_usd         numeric(12, 2),
  insured_name        text,
  other_party_name    text,
  ingestion_complete  boolean not null default false,
  ledger_complete     boolean not null default false,
  finalized           boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, case_id)
);

drop trigger if exists cases_set_updated_at on cases;
create trigger cases_set_updated_at before update on cases
  for each row execute function set_updated_at();

create index if not exists cases_tenant_id_idx on cases (tenant_id);
create index if not exists cases_status_idx on cases (ingestion_complete, ledger_complete, finalized);

-- ---------------------------------------------------------------------------
-- documents — one row per uploaded file, content-addressed by sha256.
-- ---------------------------------------------------------------------------
-- Raw bytes live in object storage (Backblaze B2 today). We keep the canonical
-- storage_url plus the bucket/key so we can regenerate signed URLs on demand.
-- (case_id, sha256) unique → re-uploading the same file is idempotent.
-- document_kind preserves the existing ClaimInput.documents[].kind field
-- ("police report", "First Notice of Loss", etc.).
create table if not exists documents (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  filename            text not null,
  document_kind       text,
  mime_type           text not null,
  sha256              text not null,
  file_size_bytes     bigint not null,
  storage_provider    text not null default 'backblaze'
                      check (storage_provider in ('backblaze', 'supabase', 's3')),
  storage_bucket      text not null,
  storage_key         text not null,
  storage_url         text,
  page_count          integer,
  status              text not null default 'pending'
                      check (status in ('pending', 'uploaded', 'extracting', 'extracted', 'failed')),
  extraction_error    text,
  ingested_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (case_id, sha256)
);

drop trigger if exists documents_set_updated_at on documents;
create trigger documents_set_updated_at before update on documents
  for each row execute function set_updated_at();

create index if not exists documents_case_id_status_idx on documents (case_id, status);
create index if not exists documents_sha256_idx on documents (sha256);

-- ---------------------------------------------------------------------------
-- document_pages — one row per logical page of extracted text.
-- ---------------------------------------------------------------------------
-- "Page" is a logical unit: PDFs use native pages; DOCX/HTML use headings or
-- section boundaries; plain text is a single page. Granularity matters because
-- Fact nodes downstream reference (document_id, page_number).
-- The GIN index supports Postgres full-text search ("grep-like" queries) as a
-- built-in alternative to vector embeddings.
create table if not exists document_pages (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents(id) on delete cascade,
  page_number         integer not null check (page_number >= 1),
  extracted_text      text not null,
  char_count          integer not null,
  extraction_metadata jsonb,
  created_at          timestamptz not null default now(),
  unique (document_id, page_number)
);

create index if not exists document_pages_document_id_idx on document_pages (document_id);
create index if not exists document_pages_text_fts_idx on document_pages
  using gin (to_tsvector('english', extracted_text));

-- ---------------------------------------------------------------------------
-- statutes — public legal text referenced by node citations.
-- ---------------------------------------------------------------------------
-- statute_id is globally unique (e.g. "CA-1431.2"); jurisdictions are not
-- expected to collide on identifier syntax. If they ever do, add a (jurisdiction,
-- statute_id) unique constraint in a follow-up migration.
create table if not exists statutes (
  id                  uuid primary key default gen_random_uuid(),
  statute_id          text unique not null,
  jurisdiction        text not null,
  title               text not null,
  text                text not null,
  created_at          timestamptz not null default now()
);

create index if not exists statutes_jurisdiction_idx on statutes (jurisdiction);

-- ---------------------------------------------------------------------------
-- nodes — the Evidence Ledger as a typed graph (Gowtham's lane).
-- ---------------------------------------------------------------------------
-- node_id is the human-readable display id ("F1", "P1", "V1"...), unique within
-- a case. type drives the schema of props (Fact carries statement+source, Party
-- carries name+role, etc.); the CHECK constraint enumerates supported types and
-- can be extended with ALTER TABLE.
-- For Fact nodes, verbatim_quote + source_document_id + source_page_number form
-- the anchor the Fact Gate verifies against extracted_text in document_pages.
-- source_document_id uses ON DELETE SET NULL so historical facts survive if
-- their source document is deleted (audit trail preservation).
create table if not exists nodes (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  node_id             text not null,
  type                text not null
                      check (type in ('Fact', 'Party', 'Vehicle', 'Event', 'Location', 'Statute', 'Damage', 'Document')),
  props               jsonb not null default '{}'::jsonb,
  verbatim_quote      text,
  source_document_id  uuid references documents(id) on delete set null,
  source_page_number  integer,
  confidence          numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (case_id, node_id)
);

drop trigger if exists nodes_set_updated_at on nodes;
create trigger nodes_set_updated_at before update on nodes
  for each row execute function set_updated_at();

create index if not exists nodes_case_id_type_idx on nodes (case_id, type);
create index if not exists nodes_source_document_id_idx on nodes (source_document_id)
  where source_document_id is not null;

-- ---------------------------------------------------------------------------
-- edges — typed relationships between nodes.
-- ---------------------------------------------------------------------------
-- edge types capture the semantic graph: mentioned_in (Fact → Document),
-- corroborates / contradicts (Fact → Fact), attributed_to (Fact → Party),
-- governed_by (Event → Statute), caused (Event → Damage), involves (Event →
-- Party), occurred_at (Event → Location), drives (Party → Vehicle).
-- Both directions are indexed for graph traversal in either direction.
create table if not exists edges (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  edge_id             text not null,
  from_id             uuid not null references nodes(id) on delete cascade,
  to_id               uuid not null references nodes(id) on delete cascade,
  type                text not null
                      check (type in ('mentioned_in', 'corroborates', 'contradicts', 'attributed_to', 'governed_by', 'caused', 'involves', 'occurred_at', 'drives')),
  props               jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  unique (case_id, edge_id)
);

create index if not exists edges_case_id_from_id_type_idx on edges (case_id, from_id, type);
create index if not exists edges_case_id_to_id_type_idx on edges (case_id, to_id, type);

-- ---------------------------------------------------------------------------
-- transcript — Band-room postings persisted per pipeline run (Sudharsan's lane).
-- ---------------------------------------------------------------------------
-- run_id is generated by the orchestrator at the start of each pipeline call.
-- (run_id, seq) is the canonical ordering; (case_id, run_id, seq) is the
-- query index for "show me run X of case Y in order."
create table if not exists transcript (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  run_id              uuid not null,
  seq                 integer not null,
  agent_name          text not null,
  color               integer not null,
  kind                text not null
                      check (kind in ('message', 'handoff', 'gate', 'decision', 'system')),
  content             text not null,
  posted_at           timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists transcript_case_run_seq_idx on transcript (case_id, run_id, seq);

-- ---------------------------------------------------------------------------
-- decisions — the final FinalDecision produced by orchestration.
-- ---------------------------------------------------------------------------
-- One row per pipeline run. secondary_decision holds Adjudicator B's full
-- output (faultTable + percentage + reasoning) when dual-adjudication is on.
-- fault_table is jsonb because its shape is { factId, favors, weight }[] —
-- documented in pydantic types.py, validated at write time.
create table if not exists decisions (
  id                       uuid primary key default gen_random_uuid(),
  case_id                  uuid not null references cases(id) on delete cascade,
  run_id                   uuid not null unique,
  other_driver_fault_pct   numeric(5, 2) not null
                           check (other_driver_fault_pct >= 0 and other_driver_fault_pct <= 100),
  confidence               numeric(3, 2) not null
                           check (confidence >= 0 and confidence <= 1),
  recovery_usd             numeric(12, 2) not null,
  escalate                 boolean not null,
  escalate_reasons         jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(escalate_reasons) = 'array'),
  near_fifty_fifty         boolean not null,
  consensus_type           text not null
                           check (consensus_type in ('agreement', 'disagreement', 'single', 'none')),
  consensus_delta          numeric(5, 2) not null,
  fault_table              jsonb not null
                           check (jsonb_typeof(fault_table) = 'array'),
  reasoning                text not null,
  secondary_decision       jsonb,
  letter                   text not null,
  audit_hash               text,
  finalized_at             timestamptz not null default now()
);

create index if not exists decisions_case_id_idx on decisions (case_id);

-- ============================================================================
-- End of migration 001
-- ============================================================================
