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
import { type CasesResponse, getCases } from "@/lib/api";
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

interface CasesPageData {
  mock: boolean;
  demoCases: LegacyCase[];
  dbCases: DbCase[];
  dbError: string | null;
  backendOffline: boolean;
}

export default async function CasesPage() {
  const data = await loadCasesPageData();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <CasesHeader data={data} />
      <CasesBody data={data} />
    </div>
  );
}

async function loadCasesPageData(): Promise<CasesPageData> {
  try {
    return casesPageData(await getCases());
  } catch {
    return BACKEND_OFFLINE_DATA;
  }
}

function casesPageData(data: CasesResponse): CasesPageData {
  return {
    mock: data.mock,
    demoCases: data.demo_cases,
    dbCases: data.db_cases,
    dbError: data.db_error,
    backendOffline: false,
  };
}

const BACKEND_OFFLINE_DATA: CasesPageData = {
  mock: true,
  demoCases: [],
  dbCases: [],
  dbError: null,
  backendOffline: true,
};

function CasesHeader({ data }: { data: CasesPageData }) {
  return (
    <div className="flex items-end justify-between gap-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          Recovery Operations
        </h1>
        <p className="mt-2 max-w-2xl text-muted text-sm">
          Each case is a subrogation claim. A band of specialist agents builds
          the recovery argument, the opposing red team attacks it, two
          adjudicators on different model families decide, and a verifier audits
          every cited claim.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <ModeBadge data={data} />
        <Link
          href="/cases/new"
          className="rounded-pill border border-border bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25"
        >
          + New case
        </Link>
      </div>
    </div>
  );
}

function ModeBadge({ data }: { data: CasesPageData }) {
  const badge = modeBadge(data);

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

function modeBadge(data: CasesPageData) {
  if (data.backendOffline) {
    return {
      label: "Backend offline",
      className: "border-bad/40 bg-bad/10 text-bad",
    };
  }
  if (data.mock) {
    return {
      label: "Mock mode",
      className: "border-warn/40 bg-warn/10 text-warn",
    };
  }
  return { label: "Live", className: "border-ok/40 bg-ok/10 text-ok" };
}

function CasesBody({ data }: { data: CasesPageData }) {
  if (data.backendOffline) return <BackendOfflineNotice />;

  return (
    <div className="mt-10 space-y-10">
      <DbCasesSection dbCases={data.dbCases} dbError={data.dbError} />
      <DemoCasesSection demoCases={data.demoCases} />
    </div>
  );
}

function BackendOfflineNotice() {
  return (
    <div className="mt-10 rounded-card border border-bad/40 bg-bad/5 p-6 text-muted text-sm">
      <p className="font-medium text-bad">Cannot reach the FastAPI backend.</p>
      <p className="mt-2">
        Start it with <InlineCode>./run.sh server</InlineCode> (or{" "}
        <InlineCode>./run.sh dev</InlineCode> for the full stack).
      </p>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[12px]">
      {children}
    </code>
  );
}

function DbCasesSection({
  dbCases,
  dbError,
}: {
  dbCases: DbCase[];
  dbError: string | null;
}) {
  return (
    <section>
      <SectionHeader
        title="Your cases"
        meta={`${dbCases.length} stored in Supabase`}
      />
      <DbCasesContent dbCases={dbCases} dbError={dbError} />
    </section>
  );
}

function DbCasesContent({
  dbCases,
  dbError,
}: {
  dbCases: DbCase[];
  dbError: string | null;
}) {
  if (dbError) return <DbError error={dbError} />;
  if (dbCases.length === 0) return <EmptyDbCases />;

  return (
    <ul className="grid gap-3">
      {dbCases.map((caseRow) => (
        <DbCaseCard key={caseRow.id} caseRow={caseRow} />
      ))}
    </ul>
  );
}

function SectionHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <header className="mb-3 flex items-baseline justify-between">
      <h2 className="font-semibold text-base text-text">{title}</h2>
      <span className="text-[12px] text-muted-2">{meta}</span>
    </header>
  );
}

function DbError({ error }: { error: string }) {
  return (
    <div className="rounded-card border border-bad/40 bg-bad/5 p-4 text-[13px] text-bad">
      Couldn&apos;t reach Supabase: {error}
    </div>
  );
}

function EmptyDbCases() {
  return (
    <div className="rounded-card border border-border bg-panel p-8 text-center text-muted text-sm">
      <p>No cases yet.</p>
      <p className="mt-1.5 text-[12px] text-muted-2">
        Click <span className="text-text">+ New case</span> to upload evidence
        and create one.
      </p>
    </div>
  );
}

function DbCaseCard({ caseRow }: { caseRow: DbCase }) {
  return (
    <li>
      <Link
        href={`/cases/${encodeURIComponent(caseRow.id)}`}
        className="flex items-start justify-between gap-6 rounded-card border border-border bg-panel p-5 shadow-card transition-colors hover:border-accent"
      >
        <DbCaseDetails caseRow={caseRow} />
        <CaseStageBadge stage={caseRow.stage} />
      </Link>
    </li>
  );
}

function DbCaseDetails({ caseRow }: { caseRow: DbCase }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium">{caseRow.title || caseRow.case_id}</div>
      <DbCaseFacts caseRow={caseRow} />
      <DbCaseMeta caseRow={caseRow} />
    </div>
  );
}

function DbCaseFacts({ caseRow }: { caseRow: DbCase }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] text-muted">
      <OptionalFact label="Insured" value={caseRow.insured_name} />
      <OptionalFact label="Other party" value={caseRow.other_party_name} />
      <Fact label="Jurisdiction" value={caseRow.jurisdiction} />
      <OptionalFact
        label="Damages"
        value={caseRow.damages_usd?.toLocaleString("en-US")}
        prefix="$"
        mono
      />
    </div>
  );
}

function Fact({
  label,
  value,
  prefix = "",
  mono,
}: {
  label: string;
  value: string;
  prefix?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-muted-2">{label}: </span>
      <span className={mono ? "font-mono" : ""}>
        {prefix}
        {value}
      </span>
    </div>
  );
}

function OptionalFact({
  value,
  ...props
}: Omit<Parameters<typeof Fact>[0], "value"> & { value?: string | null }) {
  return value ? <Fact {...props} value={value} /> : null;
}

function DbCaseMeta({ caseRow }: { caseRow: DbCase }) {
  return (
    <div className="mt-2 flex items-baseline gap-3">
      <span className="font-mono text-[11px] text-muted-2">
        {caseRow.case_id}
      </span>
      <span className="font-mono text-[11px] text-muted-2">
        · {caseRow.id.slice(0, 8)}
      </span>
      <span className="text-[11px] text-muted-2">
        · updated {new Date(caseRow.updated_at).toLocaleString()}
      </span>
    </div>
  );
}

function CaseStageBadge({ stage }: { stage: DbCase["stage"] }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${STAGE_TONE[stage]}`}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

function DemoCasesSection({ demoCases }: { demoCases: LegacyCase[] }) {
  return (
    <section>
      <SectionHeader
        title="Demo cases"
        meta="deterministic mock-mode sample claims · runs the live debate"
      />
      <ul className="grid gap-3">
        {demoCases.map((caseRow) => (
          <DemoCaseCard key={caseRow.id} caseRow={caseRow} />
        ))}
      </ul>
    </section>
  );
}

function DemoCaseCard({ caseRow }: { caseRow: LegacyCase }) {
  return (
    <li>
      <Link
        href={`/cases/${encodeURIComponent(caseRow.id)}`}
        className="flex items-start justify-between gap-6 rounded-card border border-border bg-panel p-5 shadow-card transition-colors hover:border-accent"
      >
        <div className="min-w-0">
          <div className="font-medium">{caseRow.title}</div>
          {caseRow.subtitle ? (
            <div className="mt-1 text-[13px] text-muted">
              {caseRow.subtitle}
            </div>
          ) : null}
          <div className="mt-2 font-mono text-[11px] text-muted-2">
            {caseRow.id}
          </div>
        </div>
        <DemoOutcome outcome={caseRow.outcome} />
      </Link>
    </li>
  );
}

function DemoOutcome({ outcome }: { outcome?: string }) {
  if (!outcome) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 font-medium text-[11px] uppercase tracking-wider ${demoOutcomeTone(outcome)}`}
    >
      {outcome}
    </span>
  );
}

function demoOutcomeTone(outcome: string) {
  return outcome === "decline"
    ? "border-bad/40 bg-bad/10 text-bad"
    : "border-accent/40 bg-accent/10 text-accent";
}
