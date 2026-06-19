-- Persist final recommendation semantics for replay after refresh.
alter table decisions
  add column if not exists outcome text not null default 'pursue',
  add column if not exists pursue boolean not null default true,
  add column if not exists decline_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'decisions_outcome_check'
  ) then
    alter table decisions
      add constraint decisions_outcome_check
      check (outcome in ('pursue', 'escalate', 'decline'));
  end if;
end $$;

comment on column decisions.outcome is
  'Final recommendation: pursue, escalate to human review, or decline/close the file.';
comment on column decisions.decline_reason is
  'Human-readable reason when outcome=decline, retained for replay after refresh.';
