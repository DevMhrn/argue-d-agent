-- ============================================================================
-- Lumen — Initial Schema (migration 001)
-- ============================================================================
--
-- Tables for the three-stage pipeline:
--   1. INGESTION    (Aman)       — cases, runs, documents, document_pages, statutes
--   2. LEDGER       (Gowtham)    — nodes, edges
--   3. ORCHESTRATION (Sudharsan) — transcript, decisions
--
-- Apply to a fresh Supabase project via the SQL editor. Idempotent for table
-- creation; re-running on a populated DB is safe.
--
-- Creation order is bottom-up by foreign-key dependency:
--   cases → runs → documents → document_pages → statutes → nodes → edges → transcript → decisions
--
-- Conventions:
--   - All primary keys are uuid (gen_random_uuid()), generated server-side.
--   - All timestamps are timestamptz; created_at + updated_at on every table.
--   - Type-like columns use text + CHECK (enumerated) for easy migration.
--   - JSONB for variable-shape data; jsonb_typeof CHECK where the root type matters.
--   - Cascade deletes from cases → child tables; one exception: nodes.source_document_id
--     uses SET NULL so historical facts survive their source document being removed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;        -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
-- BEFORE UPDATE trigger function attached to every table with updated_at.
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
  last_run_at         timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, case_id)
);

drop trigger if exists cases_set_updated_at on cases;
create trigger cases_set_updated_at before update on cases
  for each row execute function set_updated_at();

create index if not exists cases_tenant_id_idx on cases (tenant_id);
create index if not exists cases_status_idx on cases (ingestion_complete, ledger_complete, finalized);
create index if not exists cases_last_run_at_idx on cases (last_run_at desc nulls last);

-- ---------------------------------------------------------------------------
-- runs — one row per pipeline execution; replaces the bare run_id UUID.
-- ---------------------------------------------------------------------------
-- The orchestrator inserts a row at run start, updates it at run end. Tracks
-- mode (mock/live), status, timing, and any error message. transcript and
-- decisions FK to this table so deleting a run cleans up everything from it.
create table if not exists runs (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases(id) on delete cascade,
  mode            text not null check (mode in ('mock', 'live')),
  status          text not null default 'running'
                  check (status in ('running', 'completed', 'failed', 'escalated')),
  triggered_by    text,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  duration_ms     integer,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists runs_set_updated_at on runs;
create trigger runs_set_updated_at before update on runs
  for each row execute function set_updated_at();

create index if not exists runs_case_started_idx on runs (case_id, started_at desc);
create index if not exists runs_status_idx on runs (status);

-- ---------------------------------------------------------------------------
-- documents — one row per uploaded file, content-addressed by sha256.
-- ---------------------------------------------------------------------------
create table if not exists documents (
  id                      uuid primary key default gen_random_uuid(),
  case_id                 uuid not null references cases(id) on delete cascade,
  filename                text not null,
  document_kind           text,
  mime_type               text not null,
  sha256                  text not null,
  file_size_bytes         bigint not null,
  storage_provider        text not null default 'backblaze'
                          check (storage_provider in ('backblaze', 'supabase', 's3')),
  storage_bucket          text not null,
  storage_key             text not null,
  storage_url             text,
  page_count              integer,
  status                  text not null default 'pending'
                          check (status in ('pending', 'uploaded', 'extracting', 'extracted', 'failed')),
  extraction_error        text,
  extraction_duration_ms  integer,
  retry_count             integer not null default 0,
  last_retry_at           timestamptz,
  ingested_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
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
create table if not exists document_pages (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references documents(id) on delete cascade,
  page_number         integer not null check (page_number >= 1),
  extracted_text      text not null,
  char_count          integer not null,
  extraction_metadata jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (document_id, page_number)
);

drop trigger if exists document_pages_set_updated_at on document_pages;
create trigger document_pages_set_updated_at before update on document_pages
  for each row execute function set_updated_at();

create index if not exists document_pages_document_id_idx on document_pages (document_id);
create index if not exists document_pages_text_fts_idx on document_pages
  using gin (to_tsvector('english', extracted_text));

-- ---------------------------------------------------------------------------
-- statutes — public legal text referenced by node citations.
-- ---------------------------------------------------------------------------
create table if not exists statutes (
  id                  uuid primary key default gen_random_uuid(),
  statute_id          text unique not null,
  jurisdiction        text not null,
  title               text not null,
  text                text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists statutes_set_updated_at on statutes;
create trigger statutes_set_updated_at before update on statutes
  for each row execute function set_updated_at();

create index if not exists statutes_jurisdiction_idx on statutes (jurisdiction);

-- ---------------------------------------------------------------------------
-- nodes — the Evidence Ledger as a typed graph (Gowtham's lane).
-- ---------------------------------------------------------------------------
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
  updated_at          timestamptz not null default now(),
  unique (case_id, edge_id)
);

drop trigger if exists edges_set_updated_at on edges;
create trigger edges_set_updated_at before update on edges
  for each row execute function set_updated_at();

create index if not exists edges_case_id_from_id_type_idx on edges (case_id, from_id, type);
create index if not exists edges_case_id_to_id_type_idx on edges (case_id, to_id, type);

-- ---------------------------------------------------------------------------
-- transcript — room postings persisted per pipeline run.
-- ---------------------------------------------------------------------------
-- posted_at is the canonical ordering field (when the agent actually posted).
-- created_at / updated_at track row lifecycle for consistency with other tables.
create table if not exists transcript (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases(id) on delete cascade,
  run_id              uuid not null references runs(id) on delete cascade,
  seq                 integer not null,
  agent_name          text not null,
  color               integer not null,
  kind                text not null
                      check (kind in ('message', 'handoff', 'gate', 'decision', 'system')),
  content             text not null,
  posted_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (run_id, seq)
);

drop trigger if exists transcript_set_updated_at on transcript;
create trigger transcript_set_updated_at before update on transcript
  for each row execute function set_updated_at();

create index if not exists transcript_case_run_seq_idx on transcript (case_id, run_id, seq);

-- ---------------------------------------------------------------------------
-- decisions — the FinalDecision produced by orchestration.
-- ---------------------------------------------------------------------------
-- finalized_at is the canonical "when the decision became final" timestamp.
-- created_at / updated_at track row lifecycle.
create table if not exists decisions (
  id                       uuid primary key default gen_random_uuid(),
  case_id                  uuid not null references cases(id) on delete cascade,
  run_id                   uuid not null unique references runs(id) on delete cascade,
  other_driver_fault_pct   numeric(5, 2) not null
                           check (other_driver_fault_pct >= 0 and other_driver_fault_pct <= 100),
  confidence               numeric(3, 2) not null
                           check (confidence >= 0 and confidence <= 1),
  recovery_usd             numeric(12, 2) not null,
  escalate                 boolean not null,
  escalate_reasons         jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(escalate_reasons) = 'array'),
  outcome                  text not null default 'pursue'
                           check (outcome in ('pursue', 'escalate', 'decline')),
  pursue                   boolean not null default true,
  decline_reason           text,
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
  finalized_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

drop trigger if exists decisions_set_updated_at on decisions;
create trigger decisions_set_updated_at before update on decisions
  for each row execute function set_updated_at();

create index if not exists decisions_case_id_idx on decisions (case_id);

-- ---------------------------------------------------------------------------
-- Documentation: table + column comments (surfaced in Supabase dashboard
-- and any auto-generated OpenAPI / dbdocs output).
-- ---------------------------------------------------------------------------

comment on table cases is
  'One row per subrogation case. Three boolean flags drive the cross-stage handoff: ingestion_complete (Aman→Gowtham), ledger_complete (Gowtham→Sudharsan), finalized (Sudharsan→human).';
comment on column cases.tenant_id is
  'Default UUID supports single-tenant demo writes; multi-tenant deployments override per request.';
comment on column cases.case_id is
  'Human-readable identifier (e.g. CLM-2026-0427). Unique within tenant.';
comment on column cases.last_run_at is
  'Most recent pipeline run timestamp; denormalized for UI sort. Reserved until orchestration updates it.';
comment on column cases.metadata is
  'Free-form JSONB escape hatch for case-level fields (UI hints, integration IDs, labels) that do not warrant a column.';

comment on table runs is
  'One row per pipeline execution. Replaces the bare run_id UUID. Orchestrator inserts at run start, updates at run end.';
comment on column runs.mode is
  'mock = deterministic offline; live = real provider calls.';
comment on column runs.status is
  'running while the pipeline is active; completed/failed/escalated when finished.';
comment on column runs.triggered_by is
  'Free-text source label (ui, cron, manual, etc.) for run provenance.';
comment on column runs.duration_ms is
  'Wall-clock duration; populated when ended_at fills. Performance monitoring only.';

comment on table documents is
  'One row per uploaded file. Raw bytes live in object storage (Backblaze B2); we keep storage_bucket + storage_key so signed URLs can be regenerated.';
comment on column documents.sha256 is
  'Content-addressing key. (case_id, sha256) is unique → re-uploading the same file is idempotent.';
comment on column documents.document_kind is
  'Human-readable category preserved from the original ClaimInput shape: "police report", "FNOL", "witness statement", etc.';
comment on column documents.status is
  'Lifecycle: pending → uploaded → extracting → extracted (or failed).';
comment on column documents.extraction_duration_ms is
  'Wall-clock duration of the extraction job; populated by the worker on completion. Performance monitoring only.';
comment on column documents.retry_count is
  'Number of extraction attempts so far. Incremented by the worker on each transient failure. 0 = never retried.';
comment on column documents.last_retry_at is
  'Timestamp of the most recent retry attempt. Null until first retry. Used for debugging stalled jobs.';

comment on table document_pages is
  'One row per logical page of extracted text. PDFs use native pages; DOCX/HTML use heading boundaries; plain text is a single page. Fact nodes reference (document_id, page_number) for the Fact Gate verbatim-quote check.';
comment on column document_pages.extracted_text is
  'Plain extracted text. Postgres TOAST handles large values automatically.';

comment on table statutes is
  'Public legal text the Citation Gate validates statute citations against. statute_id is globally unique (e.g. CA-1431.2).';

comment on table nodes is
  'Evidence Ledger as a typed graph (Gowtham''s lane). node_id is the human-readable display id (F1, P1, V1...). Fact nodes carry verbatim_quote + (source_document_id, source_page_number) which the Fact Gate verifies against document_pages.extracted_text.';
comment on column nodes.source_document_id is
  'For Fact nodes: the source. ON DELETE SET NULL so historical facts survive their source document being removed (audit-trail preservation).';

comment on table edges is
  'Typed graph relationships. mentioned_in (Fact → Document) is the corroboration primitive — one Fact node can have many mentioned_in edges, one per source document that asserts it. This is how we model "same observation across multiple sources" without dedup.';

comment on table transcript is
  'Room postings per pipeline run. (run_id, seq) is the canonical ordering. posted_at is the posting timestamp; created_at is the row insert timestamp (usually identical).';

comment on table decisions is
  'One row per pipeline run holding the FinalDecision payload. secondary_decision carries Adjudicator B''s full output when dual-adjudication is on. fault_table is the structured {factId, favors, weight}[] array.';
comment on column decisions.outcome is
  'Final recommendation: pursue, escalate to human review, or decline/close the file.';
comment on column decisions.decline_reason is
  'Human-readable reason when outcome=decline, retained for replay after refresh.';
comment on column decisions.audit_hash is
  'SHA-256 of (transcript + decision + letter) at finalization. Tamper-evident.';

-- ============================================================================
-- End of migration 001
-- ============================================================================
