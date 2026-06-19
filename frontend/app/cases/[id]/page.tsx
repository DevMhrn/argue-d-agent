"use client";

import Link from "next/link";
import { type ReactNode, use, useEffect, useState } from "react";
import { ArgumentRoom } from "@/components/ArgumentRoom";
import { DecisionPanel } from "@/components/DecisionPanel";
import { DocumentsPanel } from "@/components/DocumentsPanel";
import { GateRail } from "@/components/GateRail";
import { Icon } from "@/components/Icon";
import { LedgerGraphPanel } from "@/components/LedgerGraphPanel";
import { LedgerPanel } from "@/components/LedgerPanel";
import { StageStepper } from "@/components/StageStepper";
import { ApiError, getCase, getRunReplay, listRunsForCase } from "@/lib/api";
import type {
  CaseDetailResponse,
  DbCase,
  DbCaseResponse,
  DemoCaseResponse,
  RunHistoryEntry,
} from "@/lib/types";
import { type CaseStatusEvent, useCaseStream } from "@/lib/useCaseStream";
import { decisionFromPersisted, useRunStream } from "@/lib/useRunStream";

const LEDGER_READY_POLL_MS = 3000;

interface PageProps {
  params: Promise<{ id: string }>;
}

type RunState = ReturnType<typeof useRunStream>["state"];

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
 *
 * Both flows now share the legal-brief case shell (caption block, recovery
 * readout, stage stepper, gate rail, two-column body, disposition, run history).
 * The page owns the citation-highlight state and threads it to the Argument
 * Room (cite-click source) and the ledger panels (highlight target).
 */
export default function CaseDetailPage({ params }: PageProps) {
  const { id } = use(params);

  const [data, setData] = useState<CaseDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [runReplaySuspended, setRunReplaySuspended] = useState(false);
  // Citation highlight — set by clicking a [Fact] chip in the Argument Room,
  // consumed by the ledger panels to pulse the matching node. Owned here so the
  // two columns stay in sync (SPEC citation-highlight contract).
  const [highlightFact, setHighlightFact] = useState<string | null>(null);
  const { state, start, stop, seed } = useRunStream();
  // Bumped after a document is added so the status stream reopens and the
  // rebuild on an already-complete case animates live.
  const [streamReopenKey, setStreamReopenKey] = useState(0);
  // Live case status (SSE) — pushes ingestion/ledger transitions + the ledger
  // lane's build phase so the page advances without a manual refresh.
  const live = useCaseStream(id, data?.source === "db", streamReopenKey);
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

  // SSE-driven refetch: whenever the live stream reports a change (a doc
  // extracted, ledger build phase advanced, ledger_complete flipped), pull the
  // authoritative full case (flags + nodes/edges). This is the primary path.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    void loadCaseDetail(id).then((result) => {
      if (cancelled || result.error || !result.data) return;
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [id, live]);

  // Polling fallback (covers the whole ingesting→building window) in case the
  // SSE proxy drops the stream. Both paths converge on setData; harmless overlap.
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
    // Reopen the case-status stream so a ledger rebuild triggered by the new
    // document animates live (build progress + node/edge counts) rather than
    // only surfacing on the next poll.
    setStreamReopenKey((k) => k + 1);
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
    return (
      <DemoCaseView
        data={data}
        onRun={handleRun}
        run={state}
        highlightFact={highlightFact}
        onCiteClick={setHighlightFact}
      />
    );
  }

  return (
    <DbCaseView
      data={data}
      onRun={handleRun}
      run={state}
      caseId={id}
      runHistory={runHistory}
      live={live}
      onDocumentsChanged={handleDocumentsChanged}
      highlightFact={highlightFact}
      onCiteClick={setHighlightFact}
    />
  );
}

function shouldPollCaseDetail(data: CaseDetailResponse | null): boolean {
  // Poll across the whole non-terminal window — ingesting AND building — so the
  // page still advances even if the SSE stream isn't connected. (The earlier
  // version only polled after ingestion finished, so a page opened mid-ingestion
  // never updated.)
  return data?.source === "db" && !data.case.ledger_complete;
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
   CASE SHELL — the legal-brief workbench layout, shared by both flows.
   Owns the centred max-1440 column, breadcrumb, caption block + recovery
   readout, plain summary banner, stage stepper, gate rail, the sticky
   two-column body (left = documents + ledger, right = argument room), the
   disposition panel slot, and the run-history strip.
--------------------------------------------------------------------------- */

interface CaseShellProps {
  caption: CaptionModel;
  readout: ReadoutModel;
  stageCase: DbCase;
  gatePostings: RunState["postings"];
  showGateRail: boolean;
  left: ReactNode;
  right: ReactNode;
  decision: ReactNode;
  runHistory: ReactNode;
}

function CaseShell({
  caption,
  readout,
  stageCase,
  gatePostings,
  showGateRail,
  left,
  right,
  decision,
  runHistory,
}: CaseShellProps) {
  return (
    <div className="mx-auto w-full max-w-360 px-6 pt-7 pb-16">
      <Breadcrumb caseId={caption.id} />
      <BriefCaption caption={caption} readout={readout} />
      <SummaryBanner summary={caption.summary} />

      <div className="mb-3.5">
        <StageStepper caseRow={stageCase} />
      </div>

      {showGateRail ? (
        <div className="mb-6">
          <GateRail postings={gatePostings} />
        </div>
      ) : (
        <div className="mb-6" />
      )}

      <div className="grid grid-cols-1 items-start gap-4.5 min-[1100px]:grid-cols-[368px_1fr]">
        <div className="flex flex-col gap-4.5 min-[1100px]:sticky min-[1100px]:top-18">
          {left}
        </div>
        <div>{right}</div>
      </div>

      {decision}
      {runHistory}
    </div>
  );
}

function Breadcrumb({ caseId }: { caseId: string }) {
  return (
    <nav className="mb-4 flex items-center gap-2.25 font-mono text-[11.5px] text-muted-2">
      <Link className="text-muted-2 transition-colors hover:text-text" href="/">
        Cases
      </Link>
      <span className="text-muted-2 opacity-70">›</span>
      <span className="text-muted">{caseId}</span>
    </nav>
  );
}

/* ----- legal-brief caption block + recovery readout ----------------------- */

interface CaptionModel {
  id: string;
  kicker: string;
  title: string;
  tagline: string;
  summary: string;
  parts: string[];
}

interface ReadoutModel {
  /** complete + pursue/escalate → settled money; complete + decline → DO NOT PURSUE. */
  state: "idle" | "running" | "pursue" | "decline";
  moneyLabel: string;
  documentedLabel: string;
  faultThemPct: number;
  declineReason: string;
}

function BriefCaption({
  caption,
  readout,
}: {
  caption: CaptionModel;
  readout: ReadoutModel;
}) {
  const declined = readout.state === "decline";
  const ruleColor = declined ? "rgba(198,106,90,0.3)" : "var(--color-border)";

  return (
    <div
      className="mb-6 pb-5.5"
      style={{ borderBottom: `1px solid ${ruleColor}` }}
    >
      <div className="flex items-stretch justify-between gap-9">
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="mb-3.25 font-mono text-[10.5px] text-muted-2 uppercase tracking-[0.22em]">
            {caption.kicker}
          </div>
          <h1 className="m-0 font-semibold font-serif text-[50px] leading-[0.98] tracking-[-0.015em]">
            {caption.title}
          </h1>
          <div className="mt-1.75 font-serif text-[19px] text-muted italic">
            {caption.tagline}
          </div>
          <div className="mt-3.25 flex flex-wrap items-center gap-4.5 font-mono text-[12.5px] text-muted">
            {caption.parts.map((part, i) => (
              <span
                key={part}
                className={i === 0 ? "text-muted" : "text-muted-2"}
              >
                {part}
              </span>
            ))}
          </div>
        </div>

        <RecoveryReadout readout={readout} />
      </div>
    </div>
  );
}

function RecoveryReadout({ readout }: { readout: ReadoutModel }) {
  const declined = readout.state === "decline";
  const cardBorder = declined ? "rgba(198,106,90,0.35)" : "var(--color-border)";
  const cardBg = declined ? "rgba(198,106,90,0.06)" : "var(--color-panel)";

  return (
    <div
      className="flex min-w-65 shrink-0 items-center justify-center rounded-card px-5 py-4.5"
      style={{
        border: `1px solid ${cardBorder}`,
        background: cardBg,
        boxShadow: "inset 0 1px 0 rgba(0,0,0,0.25)",
      }}
    >
      {readout.state === "decline" ? (
        <div className="text-center">
          <div className="mb-2.25 inline-flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-bad font-bold text-[11px] text-bad">
              ✕
            </span>
            <span className="font-bold text-[16px] text-bad tracking-[0.04em]">
              DO NOT PURSUE
            </span>
          </div>
          <div className="max-w-57.5 text-[11px] text-muted leading-normal">
            {readout.declineReason}
          </div>
        </div>
      ) : readout.state === "pursue" ? (
        <div className="w-full">
          <div className="flex items-baseline justify-between gap-3.5 border-border border-b border-dashed pb-2.25">
            <span className="font-mono text-[9.5px] text-muted-2 uppercase tracking-[0.12em]">
              documented
            </span>
            <span className="tnum font-medium font-mono text-[17px] text-money opacity-[0.72]">
              {readout.documentedLabel}
            </span>
          </div>
          <div className="flex items-center justify-end gap-1.75 pt-1.5 pb-0.75 font-mono text-[10px] text-muted-2">
            <span>× {readout.faultThemPct}% liability</span>
          </div>
          <div className="flex items-baseline justify-between gap-3.5">
            <span className="font-mono text-[9.5px] text-muted-2 uppercase tracking-[0.12em]">
              recovery
            </span>
            <span className="tnum font-mono font-semibold text-[38px] text-money leading-none tracking-[-0.02em]">
              {readout.moneyLabel}
            </span>
          </div>
        </div>
      ) : (
        <div className="w-full text-right">
          <div className="mb-1.5 font-mono text-[10px] text-muted-2 uppercase tracking-[0.16em]">
            recovery
          </div>
          <div className="font-medium font-mono text-[30px] text-muted-2 tracking-[-0.02em]">
            {readout.moneyLabel}
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-muted-2">
            {readout.state === "running"
              ? "settling…"
              : "projected on disposition"}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryBanner({ summary }: { summary: string }) {
  if (!summary) return null;
  return (
    <div className="mb-3.5 flex items-start gap-2.5 rounded-[11px] border border-border bg-panel px-4 py-3.25">
      <span className="mt-px shrink-0 text-accent">
        <Icon name="info" size={16} />
      </span>
      <div className="text-[13px] text-muted leading-normal">{summary}</div>
    </div>
  );
}

/* ----- run history strip (legal-brief horizontal hearing rail) ------------ */

function RunHistoryStrip({ history }: { history: RunHistoryEntry[] }) {
  return (
    <div className="mt-4.5 flex items-center gap-3.25 rounded-[11px] border border-border bg-panel px-4.5 py-3.25">
      <span className="font-mono text-[10.5px] text-muted-2 uppercase tracking-widest">
        Run history
      </span>
      <div className="flex flex-1 gap-2 overflow-auto">
        {history.length === 0 ? (
          <HearingCard
            label="No prior hearings"
            meta="on this case yet"
            empty
          />
        ) : (
          history.map((entry, i) => (
            <HearingCard
              key={entry.run.id}
              label={`Hearing #${history.length - i}`}
              meta={hearingMeta(entry)}
              accent={i === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

function HearingCard({
  label,
  meta,
  accent,
  empty,
}: {
  label: string;
  meta: string;
  accent?: boolean;
  empty?: boolean;
}) {
  const border = empty
    ? "border-dashed border-border"
    : accent
      ? "border-[var(--color-accent-dim)]"
      : "border-border";
  return (
    <div
      className={`flex flex-col gap-px whitespace-nowrap rounded-lg border bg-panel-2 px-3 py-1.75 ${border} ${
        empty ? "bg-transparent" : ""
      }`}
    >
      <span
        className={`font-mono text-[11px] ${empty ? "text-muted-2" : "text-text"}`}
      >
        {label}
      </span>
      <span className="font-mono text-[10px] text-muted-2">{meta}</span>
    </div>
  );
}

function hearingMeta(entry: RunHistoryEntry): string {
  const when = new Date(entry.run.started_at).toLocaleString();
  if (!entry.decision_summary) return `${when} · no decision`;
  const fault = entry.decision_summary.other_driver_fault_pct;
  const recovery = `$${Math.round(
    entry.decision_summary.recovery_usd,
  ).toLocaleString("en-US")}`;
  const tail = entry.decision_summary.escalate ? " · escalated" : "";
  return `${fault}% · ${recovery}${tail}`;
}

/* ----- shared derivations ------------------------------------------------- */

function runOutcomeState(run: RunState): ReadoutModel["state"] {
  if (run.status === "complete" && run.decision) {
    return run.decision.outcome === "decline" ? "decline" : "pursue";
  }
  if (run.status === "connecting" || run.status === "streaming")
    return "running";
  return "idle";
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function readoutFromRun(
  run: RunState,
  documentedUsd: number | null,
): ReadoutModel {
  const state = runOutcomeState(run);
  const decision = run.decision;
  const documentedLabel = documentedUsd ? money(documentedUsd) : "—";
  const faultThemPct = decision ? Math.round(decision.otherFaultPct) : 0;

  if (state === "pursue" && decision) {
    return {
      state,
      moneyLabel: money(decision.recoveryUsd),
      documentedLabel,
      faultThemPct,
      declineReason: "",
    };
  }
  if (state === "decline" && decision) {
    return {
      state,
      moneyLabel: "",
      documentedLabel,
      faultThemPct,
      declineReason:
        decision.declineReason ??
        "Recovery falls below the pursue threshold once comparative fault is applied.",
    };
  }
  // idle / running → ghosted projection
  return {
    state,
    moneyLabel: documentedLabel,
    documentedLabel,
    faultThemPct,
    declineReason: "",
  };
}

function captionParts(
  caseId: string,
  jurisdiction: string,
  filed: string | null,
  documentedUsd: number | null,
): string[] {
  const parts = [caseId, `${jurisdiction} jurisdiction`];
  if (filed) parts.push(`Filed: ${filed}`);
  if (documentedUsd) parts.push(`${money(documentedUsd)} documented`);
  return parts;
}

function formatFiled(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

/* ---------------------------------------------------------------------------
   DEMO case — legacy mock orchestration, now rendered into the shared shell.
   The demo pipeline runs intake → evidence → debate inline, so a synthetic
   DbCase drives the stage stepper (ingestion + ledger are effectively done;
   finalized once a decision lands).
--------------------------------------------------------------------------- */
function DemoCaseView({
  data,
  onRun,
  run,
  highlightFact,
  onCiteClick,
}: {
  data: DemoCaseResponse;
  onRun: () => void;
  run: RunState;
  highlightFact: string | null;
  onCiteClick: (factId: string) => void;
}) {
  const claim = data.claim;
  const documentedUsd = Number(claim.damagesUsd) || null;
  const readout = readoutFromRun(run, documentedUsd);
  const room = demoRoomState(run);

  const caption: CaptionModel = {
    id: data.meta.id,
    kicker: "Subrogation recovery case",
    title: data.meta.title,
    tagline: data.meta.subtitle ?? "Subrogation recovery",
    summary:
      data.meta.subtitle ??
      `${data.meta.title}: subrogation recovery analysis over the bundled evidence file.`,
    parts: captionParts(claim.caseId, claim.jurisdiction, null, documentedUsd),
  };

  return (
    <CaseShell
      caption={caption}
      readout={readout}
      stageCase={demoStageCase(data, run)}
      gatePostings={run.postings}
      showGateRail={run.postings.length > 0}
      left={<LedgerPanel claim={claim} highlightFact={highlightFact} />}
      right={
        <ArgumentRoom
          status={run.status}
          postings={run.postings}
          bandRoomId={run.bandRoomId}
          activeRunId={run.activeRunId}
          lastSeq={run.lastSeq}
          canRun={room.canRun}
          lockedReason={room.lockedReason}
          onRun={onRun}
          activity={run.activity}
          highlightFact={highlightFact}
          onCiteClick={onCiteClick}
        />
      }
      decision={
        run.decision ? (
          <DecisionPanel
            caseId={claim.caseId}
            decision={run.decision}
            letter={run.letter}
          />
        ) : null
      }
      runHistory={null}
    />
  );
}

function demoRoomState(run: RunState): {
  canRun: boolean;
  lockedReason: string | null;
} {
  // The demo case is always runnable — its "ledger" is the bundled claim file.
  const running = run.status === "connecting" || run.status === "streaming";
  return { canRun: !running, lockedReason: null };
}

/** Synthetic DbCase so the demo path can drive the shared StageStepper. */
function demoStageCase(data: DemoCaseResponse, run: RunState): DbCase {
  const finalized = run.status === "complete" && run.decision != null;
  return {
    source: "db",
    id: data.meta.id,
    case_id: data.claim.caseId,
    title: data.meta.title,
    summary: data.meta.subtitle ?? null,
    jurisdiction: data.claim.jurisdiction,
    damages_usd: Number(data.claim.damagesUsd) || null,
    insured_name: data.claim.insured,
    other_party_name: data.claim.otherParty,
    ingestion_complete: true,
    ledger_complete: true,
    finalized,
    last_run_at: null,
    updated_at: new Date().toISOString(),
    stage: finalized ? "finalized" : "ready",
  };
}

/* ---------------------------------------------------------------------------
   DB case — the staged Argument-Room flow, rendered into the shared shell.
--------------------------------------------------------------------------- */
function DbCaseView({
  data,
  onRun,
  run,
  caseId,
  runHistory,
  live,
  onDocumentsChanged,
  highlightFact,
  onCiteClick,
}: {
  data: DbCaseResponse;
  onRun: () => void;
  run: RunState;
  caseId: string;
  runHistory: RunHistoryEntry[];
  live: CaseStatusEvent | null;
  onDocumentsChanged: () => void;
  highlightFact: string | null;
  onCiteClick: (factId: string) => void;
}) {
  const c = data.case as DbCase;
  const room = dbRoomState(c);
  const documentedUsd = c.damages_usd;
  const readout = readoutFromRun(run, documentedUsd);

  const caption: CaptionModel = {
    id: c.case_id,
    kicker: "Subrogation recovery case",
    title: c.title,
    tagline: caseTagline(c),
    summary: caseSummary(c),
    parts: captionParts(
      c.case_id,
      c.jurisdiction,
      formatFiled(c.last_run_at ?? c.updated_at),
      documentedUsd,
    ),
  };

  return (
    <CaseShell
      caption={caption}
      readout={readout}
      stageCase={c}
      gatePostings={run.postings}
      showGateRail={run.postings.length > 0 || room.canRun}
      left={
        <>
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
            build={live?.build ?? null}
            extracted={live?.extracted}
            total={live?.total}
            highlightFact={highlightFact}
          />
        </>
      }
      right={
        <ArgumentRoom
          status={run.status}
          postings={run.postings}
          bandRoomId={run.bandRoomId}
          activeRunId={run.activeRunId}
          lastSeq={run.lastSeq}
          canRun={room.canRun}
          lockedReason={room.lockedReason}
          onRun={onRun}
          activity={run.activity}
          highlightFact={highlightFact}
          onCiteClick={onCiteClick}
        />
      }
      decision={
        run.decision ? (
          <DecisionPanel
            caseId={caseId}
            decision={run.decision}
            letter={run.letter}
          />
        ) : null
      }
      runHistory={<RunHistoryStrip history={runHistory} />}
    />
  );
}

function caseTagline(c: DbCase): string {
  if (c.insured_name && c.other_party_name) {
    return `${c.insured_name} v. ${c.other_party_name}`;
  }
  return "Subrogation recovery";
}

function caseSummary(c: DbCase): string {
  if (c.summary) return c.summary;
  const who =
    c.insured_name && c.other_party_name
      ? `${c.insured_name} v. ${c.other_party_name}: `
      : "";
  return `${who}subrogation recovery analysis in ${c.jurisdiction}${
    c.damages_usd ? ` over ${money(c.damages_usd)} documented` : ""
  }.`;
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

// Re-exported for any sibling that wants the decision-readout mapping.
export type { CaptionModel, ReadoutModel };
export { runOutcomeState };
