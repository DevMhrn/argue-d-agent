-- Add structured orchestration metadata to transcript postings.
alter table transcript
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column transcript.metadata is
  'Structured orchestration metadata for UI replay and audit: phase, issue key, turn type, actor keys, citations, gate verdicts, and tool summaries.';
