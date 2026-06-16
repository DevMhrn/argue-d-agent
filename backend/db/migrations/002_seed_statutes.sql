-- ============================================================================
-- Lumen — Statute Seed Data (migration 002)
-- ============================================================================
--
-- Loads the public statute store used by the orchestration's Citation Gate and
-- by Gowtham's Statute nodes. Mirrors the existing data/statutes.json file so
-- the synthetic Alex/Jordan demo runs end-to-end against the database.
--
-- Idempotent: ON CONFLICT DO NOTHING means re-running this on a populated DB
-- is safe.
-- ============================================================================

insert into statutes (statute_id, jurisdiction, title, text) values
  (
    'CA-1431.2',
    'CA',
    'California Civil Code §1431.2 — Comparative Fault Allocation',
    'In any action based upon principles of comparative fault, the liability of each defendant for non-economic damages shall be several only and shall be allocated to each defendant in direct proportion to that defendant''s percentage of fault. A plaintiff''s recovery is reduced by the plaintiff''s own proportionate share of fault.'
  ),
  (
    'CVC-21453',
    'CA',
    'California Vehicle Code §21453(a) — Steady Red Signal',
    'A driver facing a steady circular red signal alone shall stop at a marked limit line, or if none, before entering the crosswalk or intersection, and shall remain stopped until an indication to proceed is shown.'
  )
on conflict (statute_id) do nothing;
