"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ArgumentRoom } from "@/components/ArgumentRoom";
import { DecisionPanel } from "@/components/DecisionPanel";
import { DocumentsPanel } from "@/components/DocumentsPanel";
import { GateRail } from "@/components/GateRail";
import { LedgerGraphPanel } from "@/components/LedgerGraphPanel";
import { LedgerPanel } from "@/components/LedgerPanel";
import { RoomPanel } from "@/components/RoomPanel";
import { StageStepper } from "@/components/StageStepper";
import { ApiError, getCase, getRunReplay, listRunsForCase } from "@/lib/api";
import type {
  CaseDetailResponse,
  DbCase,
  DbCaseResponse,
  DemoCaseResponse,
  RunHistoryEntry,
} from "@/lib/types";
import { decisionFromPersisted, useRunStream } from "@/lib/useRunStream";

const LEDGER_READY_POLL_MS = 3000;

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Two flows in one page, distinguished by `source` on the API response:
 *
 *   - source === "demo" → legacy three-panel mock orchestration. The demo
 *     pipeline does intake → evidence → debate inline and posts everything
 *     to the room over SSE. The ledger is built DURING the run.
 *
 *   - source === "db"   → real Supabase case. Stages are explicit:
 *         1) Ingesting    — documents still extracting (worker)
 *         2) Building ledger — ingestion done, Gowtham's lane writes nodes+edges
 *         3) Room ready   — ledger locked; Argument Room CTA unlocks
 *         4) In session   — agents debate over the locked ledger
 *         5) Decision     — final outcome + letter
 */
export default function CaseDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const [data, setData] = useState<CaseDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [runReplaySuspended, setRunReplaySuspended] = useState(false);
  const { state, start, stop, seed } = useRunStream();
  const shouldPollForLedger = shouldPollCaseDetail(data);

  useEffect(() => {
    let cancelled = false;
    void loadCaseDetail(id).then((result) =>
      applyCaseLoadResult(result, () => cancelled, setData, setLoadError),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!shouldPollForLedger) return;
    let cancelled = false;

    async function refresh() {
      const result = await loadCaseDetail(id);
      if (cancelled || result.error || !result.data) return;
      setData(result.data);
    }

    const timer = globalThis.setInterval(() => {
      void refresh();
    }, LEDGER_READY_POLL_MS);
    void refresh();

    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [id, shouldPollForLedger]);

  // On mount for real (UUID) cases: fetch run history + replay the latest
  // persisted run so a refresh doesn't blow away the conversation. Demo case
  // ids never have runs in the DB (no FK target) — getRunsForCase 400s on them.
  useEffect(() => {
    if (data?.source !== "db") return;
    let cancelled = false;
    (async () => {
      try {
        const { runs } = await listRunsForCase(data.case.id);
        if (cancelled) return;
        setRunHistory(runs);
        const latest = replayableLatestRun(runs, runReplaySuspended);
        if (!latest) return;
        const replay = await getRunReplay(latest.id);
        if (cancelled) return;
        seed({
          caseId: data.case.case_id,
          runId: latest.id,
          postings: replay.postings.map((p) => ({
            seq: p.seq,
            agent: p.agent,
            color: `c${p.color}`, // RoomPosting.color is a string token
            kind: p.kind,
            content: p.content,
            metadata: p.metadata,
            at: new Date(p.posted_at).getTime(),
          })),
          decision: decisionFromPersisted(replay.decision),
          status: replayStatus(latest.status),
        });
      } catch {
        // Don't block the page if the runs endpoint isn't reachable yet.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data, runReplaySuspended, seed]);

  const handleRun = () => {
    setRunReplaySuspended(false);
    start(id);
  };

  async function refreshCaseDetail() {
    const result = await loadCaseDetail(id);
    if (!result.error && result.data) setData(result.data);
  }

  const handleDocumentsChanged = () => {
    setRunReplaySuspended(true);
    void refreshCaseDetail();
    if (state.status !== "connecting" && state.status !== "streaming") {
      stop();
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="rounded-card border border-bad/40 bg-bad/5 p-6 text-sm">
          <p className="font-medium text-bad">{loadError}</p>
          <p className="mt-2 text-muted">
            Open{" "}
            <Link className="text-accent hover:underline" href="/">
              the cases list
            </Link>{" "}
            to see what&apos;s available.
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10 text-muted text-sm">
        Loading case…
      </div>
    );
  }

  if (data.source === "demo") {
    return <DemoCaseView data={data} onRun={handleRun} run={state} />;
  }

  return (
    <DbCaseView
      data={data}
      onRun={handleRun}
      run={state}
      caseId={id}
      runHistory={runHistory}
      onDocumentsChanged={handleDocumentsChanged}
    />
  );
}

function shouldPollCaseDetail(data: CaseDetailResponse | null): boolean {
  return (
    data?.source === "db" &&
    data.case.ingestion_complete &&
    !data.case.ledger_complete
  );
}

function replayStatus(status: RunHistoryEntry["run"]["status"]) {
  return status === "failed" ? "error" : "complete";
}

function replayableLatestRun(
  runs: RunHistoryEntry[],
  replaySuspended: boolean,
): RunHistoryEntry["run"] | null {
  if (replaySuspended || runs.length === 0) return null;
  const latest = runs[0].run;
  return latest.status === "running" ? null : latest;
}

interface CaseLoadResult {
  data: CaseDetailResponse | null;
  error: string | null;
}

async function loadCaseDetail(id: string): Promise<CaseLoadResult> {
  try {
    return { data: await getCase(id), error: null };
  } catch (err) {
    return { data: null, error: caseLoadError(id, err) };
  }
}

function caseLoadError(id: string, err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return `Case ${id} not found.`;
  }
  return err instanceof Error ? err.message : String(err);
}

type CaseDataSetter = (data: CaseDetailResponse | null) => void;
type LoadErrorSetter = (error: string | null) => void;

function applyCaseLoadResult(
  result: CaseLoadResult,
  isCancelled: () => boolean,
  setData: CaseDataSetter,
  setLoadError: LoadErrorSetter,
) {
  if (isCancelled()) return;
  if (result.error) {
    setLoadError(result.error);
    return;
  }
  setData(result.data);
}

/* ---------------------------------------------------------------------------
   DEMO case — the existing three-panel mock orchestration. Unchanged from
   the previous implementation; just wrapped so it shares the page shell.
--------------------------------------------------------------------------- */
function DemoCaseView({
  data,
  onRun,
  run,
}: {
  data: DemoCaseResponse;
  onRun: () => void;
  run: ReturnType<typeof useRunStream>["state"];
}) {
  return (
    <div className="mx-auto flex w-full max-w-350 flex-1 flex-col gap-4 px-6 py-6">
      <GateRail postings={run.postings} />

      <div className="grid flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        <LedgerPanel claim={data.claim} />
        <RoomPanel
          postings={run.postings}
          status={run.status}
          onRun={onRun}
          canRun
          bandRoomId={run.bandRoomId}
        />
        <DecisionPanel
          caseId={data.claim.caseId}
          decision={run.decision}
          letter={run.letter}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   DB case — the staged Argument-Room flow.
--------------------------------------------------------------------------- */
function DbCaseView({
  data,
  onRun,
  run,
  caseId,
  runHistory,
  onDocumentsChanged,
}: {
  data: DbCaseResponse;
  onRun: () => void;
  run: ReturnType<typeof useRunStream>["state"];
  caseId: string;
  runHistory: RunHistoryEntry[];
  onDocumentsChanged: () => void;
}) {
  const c = data.case as DbCase;
  const room = dbRoomState(c);

  return (
    <div className="mx-auto flex w-full max-w-350 flex-1 flex-col gap-4 px-6 py-6">
      <DbCaseHeader caseRow={c} />
      <DbGateRail postings={run.postings} canRun={room.canRun} />
      <DbCaseBody
        data={data}
        run={run}
        room={room}
        onRun={onRun}
        onDocumentsChanged={onDocumentsChanged}
      />
      <DbDecision caseId={caseId} run={run} />
      <RunHistoryStrip history={runHistory} />
    </div>
  );
}

function RunHistoryStrip({ history }: { history: RunHistoryEntry[] }) {
  if (history.length === 0) return null;
  return (
    <section className="rounded-card border border-border bg-panel p-4 shadow-card">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="font-semibold text-sm">Run history</h3>
        <span className="text-[12px] text-muted-2">
          {history.length} debate{history.length === 1 ? "" : "s"} persisted
        </span>
      </header>
      <ul className="grid gap-1.5">
        {history.map((entry) => (
          <li
            key={entry.run.id}
            className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 rounded-pill border border-border-soft bg-panel-2 px-3 py-1.5 text-[12px]"
          >
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                entry.run.status === "running"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : entry.run.status === "failed"
                    ? "border-bad/40 bg-bad/10 text-bad"
                    : entry.run.status === "escalated"
                      ? "border-warn/40 bg-warn/10 text-warn"
                      : "border-ok/40 bg-ok/10 text-ok"
              }`}
            >
              {entry.run.status}
            </span>
            <span className="font-mono text-muted-2">
              {new Date(entry.run.started_at).toLocaleString()}
            </span>
            {entry.decision_summary ? (
              <span className="text-muted">
                {entry.decision_summary.other_driver_fault_pct}% fault · $
                {Math.round(entry.decision_summary.recovery_usd).toLocaleString(
                  "en-US",
                )}
                {entry.decision_summary.escalate ? " · escalated" : ""}
              </span>
            ) : (
              <span className="text-muted-2">no decision yet</span>
            )}
            <span className="text-[10px] text-muted-2">
              {entry.run.mode} ·{" "}
              {entry.run.duration_ms
                ? `${(entry.run.duration_ms / 1000).toFixed(1)}s`
                : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface DbRoomState {
  ingestionComplete: boolean;
  canRun: boolean;
  lockedReason: string | null;
}

function dbRoomState(caseRow: DbCase): DbRoomState {
  return {
    ingestionComplete: caseRow.ingestion_complete,
    canRun: caseRow.ledger_complete,
    lockedReason: dbRoomLockedReason(caseRow),
  };
}

function dbRoomLockedReason(caseRow: DbCase): string | null {
  if (!caseRow.ingestion_complete) {
    return "Documents are still extracting. The Argument Room opens once the ledger lane builds the graph.";
  }
  if (!caseRow.ledger_complete) {
    return "Ingestion complete — waiting for the ledger lane to build the typed graph of facts + edges. (That's Gowtham's lane; the room opens automatically when ledger_complete flips true.)";
  }
  return null;
}

function DbCaseHeader({ caseRow }: { caseRow: DbCase }) {
  return (
    <header className="rounded-card border border-border bg-panel p-5 shadow-card">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-xl tracking-tight">
            {caseRow.title}
          </h1>
          <DbCaseMeta caseRow={caseRow} />
        </div>
      </div>
      <div className="mt-4">
        <StageStepper caseRow={caseRow} />
      </div>
    </header>
  );
}

function DbCaseMeta({ caseRow }: { caseRow: DbCase }) {
  return (
    <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[12.5px] text-muted">
      <CaseFact label="Case ID" value={caseRow.case_id} mono />
      <CaseFact label="Jurisdiction" value={caseRow.jurisdiction} />
      <OptionalCaseFact label="Insured" value={caseRow.insured_name} />
      <OptionalCaseFact label="Other party" value={caseRow.other_party_name} />
      <OptionalCaseFact
        label="Damages"
        value={formatDamages(caseRow.damages_usd)}
        mono
      />
    </div>
  );
}

function CaseFact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-muted-2">{label}:</span>{" "}
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}

function OptionalCaseFact({
  value,
  ...props
}: Omit<Parameters<typeof CaseFact>[0], "value"> & {
  value: string | null;
}) {
  return value ? <CaseFact {...props} value={value} /> : null;
}

function formatDamages(damages: number | null): string | null {
  return damages ? `$${damages.toLocaleString("en-US")}` : null;
}

function DbGateRail({
  postings,
  canRun,
}: {
  postings: ReturnType<typeof useRunStream>["state"]["postings"];
  canRun: boolean;
}) {
  if (!shouldShowGateRail(postings, canRun)) return null;
  return <GateRail postings={postings} />;
}

function shouldShowGateRail(
  postings: ReturnType<typeof useRunStream>["state"]["postings"],
  canRun: boolean,
) {
  return postings.length > 0 || canRun;
}

function DbCaseBody({
  data,
  run,
  room,
  onRun,
  onDocumentsChanged,
}: {
  data: DbCaseResponse;
  run: ReturnType<typeof useRunStream>["state"];
  room: DbRoomState;
  onRun: () => void;
  onDocumentsChanged: () => void;
}) {
  const c = data.case as DbCase;

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex h-full max-h-[85vh] min-h-0 flex-col gap-4 overflow-hidden">
        <DocumentsPanel
          caseUuid={c.id}
          initialDocuments={data.documents}
          onDocumentsChanged={onDocumentsChanged}
        />
        <LedgerGraphPanel
          hasLedger={data.has_ledger}
          nodes={data.nodes}
          edges={data.edges}
          ingestionComplete={room.ingestionComplete}
        />
      </div>
      <ArgumentRoom
        status={run.status}
        postings={run.postings}
        bandRoomId={run.bandRoomId}
        activeRunId={run.activeRunId}
        lastSeq={run.lastSeq}
        canRun={room.canRun}
        lockedReason={room.lockedReason}
        onRun={onRun}
      />
    </div>
  );
}

function DbDecision({
  caseId,
  run,
}: {
  caseId: string;
  run: ReturnType<typeof useRunStream>["state"];
}) {
  if (!run.decision) return null;

  return (
    <DecisionPanel
      caseId={caseId}
      decision={run.decision}
      letter={run.letter}
    />
  );
}
