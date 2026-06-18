/**
 * Cases list — the landing page. Renders TWO sources:
 *   1. Real cases in Supabase (post-upload, created via /api/ingest/case).
 *   2. Legacy demo claims from data/cases.json (clean / loser — used by
 *      the canned-mock orchestration in /api/run/:id).
 *
 * The /api/cases endpoint returns both. Real cases land in `db_cases` and
 * have `source: "db"`; demo cases have `source: "demo"`.
 */
import Link from "next/link";
import { getCases } from "@/lib/api";
import type { DbCase, LegacyCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STAGE_TONE: Record<DbCase["stage"], string> = {
  ingesting: "border-warn/40 bg-warn/10 text-warn",
  ledger: "border-warn/40 bg-warn/10 text-warn",
  ready: "border-accent/40 bg-accent/10 text-accent",
  finalized: "border-ok/40 bg-ok/10 text-ok",
  declined: "border-bad/40 bg-bad/10 text-bad",
};

const STAGE_LABEL: Record<DbCase["stage"], string> = {
  ingesting: "Ingesting",
  ledger: "Building ledger",
  ready: "Ready",
  finalized: "Finalized",
  declined: "Declined",
};

export default async function CasesPage() {
  let mock = true;
  let demoCases: LegacyCase[] = [];
  let dbCases: DbCase[] = [];
  let dbError: string | null = null;
  let backendOffline = false;

  try {
    const data = await getCases();
    mock = data.mock;
    demoCases = data.demo_cases ?? data.cases ?? [];
    dbCases = data.db_cases ?? [];
    dbError = data.db_error ?? null;
  } catch {
    backendOffline = true;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Recovery Operations
          </h1>
          <p className="mt-2 max-w-2xl text-muted text-sm">
            Each case is a subrogation claim. A band of specialist agents builds
            the recovery argument, the opposing red team attacks it, two
            adjudicators on different model families decide, and a verifier
            audits every cited claim.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider ${
              backendOffline
                ? "border-bad/40 bg-bad/10 text-bad"
                : mock
                  ? "border-warn/40 bg-warn/10 text-warn"
                  : "border-ok/40 bg-ok/10 text-ok"
            }`}
          >
            {backendOffline ? "Backend offline" : mock ? "Mock mode" : "Live"}
          </span>
          <Link
            href="/cases/new"
            className="rounded-pill border border-border bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25"
          >
            + New case
          </Link>
        </div>
      </div>

      {backendOffline ? (
        <div className="mt-10 rounded-card border border-bad/40 bg-bad/5 p-6 text-muted text-sm">
          <p className="font-medium text-bad">
            Cannot reach the FastAPI backend.
          </p>
          <p className="mt-2">
            Start it with{" "}
            <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px]">
              ./run.sh server
            </code>{" "}
            (or{" "}
            <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px]">
              ./run.sh dev
            </code>{" "}
            for the full stack).
          </p>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {/* ---------- Your cases (real Supabase rows) ---------- */}
          <section>
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold text-base text-text">Your cases</h2>
              <span className="text-[12px] text-muted-2">
                {dbCases.length} stored in Supabase
              </span>
            </header>
            {dbError ? (
              <div className="rounded-card border border-bad/40 bg-bad/5 p-4 text-[13px] text-bad">
                Couldn&apos;t reach Supabase: {dbError}
              </div>
            ) : dbCases.length === 0 ? (
              <div className="rounded-card border border-border bg-panel p-8 text-center text-muted text-sm">
                <p>No cases yet.</p>
                <p className="mt-1.5 text-[12px] text-muted-2">
                  Click <span className="text-text">+ New case</span> to upload
                  evidence and create one.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3">
                {dbCases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/cases/${encodeURIComponent(c.id)}`}
                      className="flex items-start justify-between gap-6 rounded-card border border-border bg-panel p-5 shadow-card transition-colors hover:border-accent"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {c.title || c.case_id}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-muted">
                          {c.insured_name ? (
                            <div>
                              <span className="text-muted-2">Insured: </span>
                              {c.insured_name}
                            </div>
                          ) : null}
                          {c.other_party_name ? (
                            <div>
                              <span className="text-muted-2">
                                Other party:{" "}
                              </span>
                              {c.other_party_name}
                            </div>
                          ) : null}
                          <div>
                            <span className="text-muted-2">Jurisdiction: </span>
                            {c.jurisdiction}
                          </div>
                          {c.damages_usd ? (
                            <div>
                              <span className="text-muted-2">Damages: </span>
                              <span className="font-mono">
                                ${c.damages_usd.toLocaleString("en-US")}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-2 flex items-baseline gap-3">
                          <span className="font-mono text-[11px] text-muted-2">
                            {c.case_id}
                          </span>
                          <span className="font-mono text-[11px] text-muted-2">
                            · {c.id.slice(0, 8)}
                          </span>
                          <span className="text-[11px] text-muted-2">
                            · updated {new Date(c.updated_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${STAGE_TONE[c.stage]}`}
                      >
                        {STAGE_LABEL[c.stage]}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- Demo cases (canned mock orchestration) ---------- */}
          <section>
            <header className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold text-base text-text">Demo cases</h2>
              <span className="text-[12px] text-muted-2">
                deterministic mock-mode sample claims · runs the live debate
              </span>
            </header>
            <ul className="grid gap-3">
              {demoCases.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/cases/${encodeURIComponent(c.id)}`}
                    className="flex items-start justify-between gap-6 rounded-card border border-border bg-panel p-5 shadow-card transition-colors hover:border-accent"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{c.title}</div>
                      {c.subtitle ? (
                        <div className="mt-1 text-[13px] text-muted">
                          {c.subtitle}
                        </div>
                      ) : null}
                      <div className="mt-2 font-mono text-[11px] text-muted-2">
                        {c.id}
                      </div>
                    </div>
                    {c.outcome ? (
                      <span
                        className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${
                          c.outcome === "decline"
                            ? "border-bad/40 bg-bad/10 text-bad"
                            : "border-accent/40 bg-accent/10 text-accent"
                        }`}
                      >
                        {c.outcome}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
