/**
 * Cases index — the landing page. Renders TWO sources:
 *   1. Real cases in Supabase (post-upload, created via /api/ingest/case) →
 *      `db_cases`, shown under "Your cases".
 *   2. Legacy demo claims from data/cases.json (clean / loser — used by the
 *      canned-mock orchestration) → `demo_cases`, shown under "Demo cases".
 *
 * The /api/cases endpoint returns both. Real cases land in `db_cases` and
 * have `source: "db"`; demo cases have `source: "demo"`.
 *
 * Restyled to the Lumen comp (cases-list, comp lines 784-831): a "Cases" header
 * with a gradient "+ New case" button, two mono-eyebrow sections, and four-column
 * grid rows (id+title / parties / status badge / timestamp+damages). Each row is
 * a <Link> to /cases/{id}. Status badge is derived from the real case fields and
 * inlined (no dependency on CaseStatusBadge).
 */
import Link from "next/link";
import { type CasesResponse, getCases } from "@/lib/api";
import type { DbCase, LegacyCase } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---- status badge (font-mono pill) ----------------------------------------
// Six visual keys, exactly as the comp's `badge()` map (logic lines 1470-1482):
//   ingesting → amber, ledger → accent, ready → sage outline,
//   escalate → amber, pursue → sage, decline → brick.
type BadgeKey =
  | "ingesting"
  | "ledger"
  | "ready"
  | "escalate"
  | "pursue"
  | "decline";

const BADGE: Record<
  BadgeKey,
  { label: string; className: string; style?: React.CSSProperties }
> = {
  ingesting: {
    label: "Ingesting",
    className: "text-warn",
    style: {
      borderColor: "rgba(212,164,74,0.4)",
      background: "rgba(212,164,74,0.1)",
    },
  },
  ledger: {
    label: "Ledger",
    className: "text-accent-strong",
    style: {
      borderColor: "var(--color-accent-dim)",
      background: "rgba(111,155,240,0.1)",
    },
  },
  ready: {
    label: "Ready",
    className: "text-ok",
    style: { borderColor: "rgba(110,169,138,0.5)", background: "transparent" },
  },
  escalate: {
    label: "Finalized · Escalate",
    className: "text-warn",
    style: {
      borderColor: "rgba(212,164,74,0.4)",
      background: "rgba(212,164,74,0.14)",
    },
  },
  pursue: {
    label: "Finalized · Pursue",
    className: "text-ok",
    style: {
      borderColor: "rgba(110,169,138,0.4)",
      background: "rgba(110,169,138,0.14)",
    },
  },
  decline: {
    label: "Finalized · Decline",
    className: "text-bad",
    style: {
      borderColor: "rgba(198,106,90,0.4)",
      background: "rgba(198,106,90,0.14)",
    },
  },
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
    <div className="mx-auto w-full max-w-275 px-6 pt-8 pb-20">
      <CasesHeader />
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

function CasesHeader() {
  return (
    <div className="mb-7.5 flex items-end justify-between gap-6">
      <div>
        <h1 className="font-semibold text-[30px] tracking-[-0.02em]">Cases</h1>
        <div className="mt-1.75 text-[13px] text-muted">
          Subrogation recovery workbench · sorted newest first
        </div>
      </div>
      <Link
        href="/cases/new"
        className="whitespace-nowrap rounded-pill px-4.25 py-2.5 font-semibold text-[13px] no-underline"
        style={{
          background: "linear-gradient(180deg,#6f9bf0,#5b8def)",
          color: "#0e1320",
        }}
      >
        + New case
      </Link>
    </div>
  );
}

function CasesBody({ data }: { data: CasesPageData }) {
  if (data.backendOffline) return <BackendOfflineNotice />;

  return (
    <>
      <Eyebrow>Your cases</Eyebrow>
      <DbCasesContent dbCases={data.dbCases} dbError={data.dbError} />

      <Eyebrow>
        Demo cases{" "}
        <span className="text-muted-2 normal-case tracking-normal">
          · bundled fixtures
        </span>
      </Eyebrow>
      <DemoCasesContent demoCases={data.demoCases} />
    </>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-9 mb-3.25 font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em] first:mt-0">
      {children}
    </div>
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
    <div className="flex flex-col gap-2.25">
      {dbCases.map((caseRow) => (
        <DbCaseRow key={caseRow.id} caseRow={caseRow} />
      ))}
    </div>
  );
}

function DemoCasesContent({ demoCases }: { demoCases: LegacyCase[] }) {
  if (demoCases.length === 0) return <EmptyDemoCases />;

  return (
    <div className="flex flex-col gap-2.25">
      {demoCases.map((caseRow) => (
        <DemoCaseRow key={caseRow.id} caseRow={caseRow} />
      ))}
    </div>
  );
}

// ---- rows ------------------------------------------------------------------

const ROW_CLASS =
  "grid items-center gap-[18px] rounded-card border border-border-soft bg-panel px-[18px] py-[15px] no-underline transition-colors hover:border-accent";
const ROW_GRID: React.CSSProperties = {
  gridTemplateColumns: "200px 1fr 168px 96px",
};

function DbCaseRow({ caseRow }: { caseRow: DbCase }) {
  const badgeKey = dbBadgeKey(caseRow);

  return (
    <Link
      href={`/cases/${encodeURIComponent(caseRow.id)}`}
      className={ROW_CLASS}
      style={ROW_GRID}
    >
      <RowTitle id={caseRow.case_id} title={caseRow.title || caseRow.case_id} />
      <RowParties parties={dbParties(caseRow)} />
      <StatusBadge badgeKey={badgeKey} />
      <RowMeta
        ts={relativeTime(caseRow.updated_at)}
        damages={dbDamages(caseRow.damages_usd)}
      />
    </Link>
  );
}

function DemoCaseRow({ caseRow }: { caseRow: LegacyCase }) {
  return (
    <Link
      href={`/cases/${encodeURIComponent(caseRow.id)}`}
      className={ROW_CLASS}
      style={ROW_GRID}
    >
      <RowTitle id={caseRow.id} title={caseRow.title} />
      <RowParties parties={caseRow.subtitle ?? ""} />
      <StatusBadge badgeKey={demoBadgeKey(caseRow.outcome)} />
      <RowMeta ts="bundled" damages="" />
    </Link>
  );
}

function RowTitle({ id, title }: { id: string; title: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-0.75 truncate font-mono text-[11px] text-muted-2">
        {id}
      </div>
      <div className="truncate font-semibold text-[14px]">{title}</div>
    </div>
  );
}

function RowParties({ parties }: { parties: string }) {
  if (!parties) return <div />;
  return (
    <div className="truncate font-mono text-[12.5px] text-muted">{parties}</div>
  );
}

function StatusBadge({ badgeKey }: { badgeKey: BadgeKey }) {
  const badge = BADGE[badgeKey];

  return (
    <div>
      <span
        className={`whitespace-nowrap rounded-chip border font-medium font-mono text-[10.5px] ${badge.className}`}
        style={{ padding: "4px 11px", ...badge.style }}
      >
        {badge.label}
      </span>
    </div>
  );
}

function RowMeta({ ts, damages }: { ts: string; damages: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[11px] text-muted-2">{ts}</div>
      {damages ? (
        <div className="mt-0.5 text-[10.5px] text-muted-2">{damages}</div>
      ) : null}
    </div>
  );
}

// ---- derivations -----------------------------------------------------------

/**
 * Map a real (Supabase) case to one of the six badge keys. Finalized cases
 * resolve by disposition (decline vs escalate — the list-shape `DbCase` carries
 * no fault metadata, so a settled recovery reads "Escalate" per the comp);
 * everything else falls through the ingest → ledger → ready ladder using the
 * canonical `stage` field plus the underlying completion booleans.
 */
function dbBadgeKey(c: DbCase): BadgeKey {
  if (c.stage === "declined") return "decline";
  if (c.finalized || c.stage === "finalized") return "escalate";
  if (c.stage === "ready" || c.ledger_complete) return "ready";
  if (c.stage === "ledger" || c.ingestion_complete) return "ledger";
  return "ingesting";
}

function demoBadgeKey(outcome?: string): BadgeKey {
  if (outcome === "decline") return "decline";
  if (outcome === "pursue") return "pursue";
  if (outcome === "escalate") return "escalate";
  return "ready";
}

function dbParties(c: DbCase): string {
  if (c.insured_name && c.other_party_name) {
    return `${c.insured_name} vs ${c.other_party_name}`;
  }
  return c.insured_name ?? c.other_party_name ?? c.jurisdiction;
}

function dbDamages(damages: number | null): string {
  if (damages == null) return "";
  return `$${damages.toLocaleString("en-US")} documented`;
}

/** Compact "2m ago" / "1h ago" / "just now" relative time, like the comp. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---- empty / error / offline states ----------------------------------------

function BackendOfflineNotice() {
  return (
    <div className="mt-9 rounded-card border border-bad/40 bg-bad/5 p-6 text-[13px] text-muted">
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

function DbError({ error }: { error: string }) {
  return (
    <div className="rounded-card border border-bad/40 bg-bad/5 p-4 text-[13px] text-bad">
      Couldn&apos;t reach Supabase: {error}
    </div>
  );
}

function EmptyDbCases() {
  return (
    <div className="rounded-card border border-border-soft bg-panel p-8 text-center text-[13px] text-muted">
      <p>No cases yet.</p>
      <p className="mt-1.5 text-[12px] text-muted-2">
        Click <span className="text-text">+ New case</span> to upload evidence
        and create one.
      </p>
    </div>
  );
}

function EmptyDemoCases() {
  return (
    <div className="rounded-card border border-border-soft bg-panel p-6 text-center text-[12px] text-muted-2">
      No bundled fixtures available.
    </div>
  );
}
