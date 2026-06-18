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
import { ApiError, getCase } from "@/lib/api";
import type {
  CaseDetailResponse,
  DbCase,
  DbCaseResponse,
  DemoCaseResponse,
} from "@/lib/types";
import { useRunStream } from "@/lib/useRunStream";

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
  const { state, start } = useRunStream();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await getCase(id);
        if (!cancelled) setData(resp);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setLoadError(`Case ${id} not found.`);
          } else {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleRun = () => {
    start(id);
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

  return <DbCaseView data={data} onRun={handleRun} run={state} caseId={id} />;
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
}: {
  data: DbCaseResponse;
  onRun: () => void;
  run: ReturnType<typeof useRunStream>["state"];
  caseId: string;
}) {
  const c = data.case as DbCase;
  const ingestionComplete = c.ingestion_complete;
  const ledgerComplete = c.ledger_complete;

  // What's stopping the Argument Room from opening?
  const lockedReason = !ingestionComplete
    ? "Documents are still extracting. The Argument Room opens once the ledger lane builds the graph."
    : !ledgerComplete
      ? "Ingestion complete — waiting for the ledger lane to build the typed graph of facts + edges. (That's Gowtham's lane; the room opens automatically when ledger_complete flips true.)"
      : null;
  const canRun = Boolean(ledgerComplete);

  return (
    <div className="mx-auto flex w-full max-w-350 flex-1 flex-col gap-4 px-6 py-6">
      {/* Header: who, what, where, and a stage stepper */}
      <header className="rounded-card border border-border bg-panel p-5 shadow-card">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="truncate font-semibold text-xl tracking-tight">
              {c.title}
            </h1>
            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[12.5px] text-muted">
              <div>
                <span className="text-muted-2">Case ID:</span>{" "}
                <span className="font-mono">{c.case_id}</span>
              </div>
              <div>
                <span className="text-muted-2">Jurisdiction:</span>{" "}
                {c.jurisdiction}
              </div>
              {c.insured_name ? (
                <div>
                  <span className="text-muted-2">Insured:</span>{" "}
                  {c.insured_name}
                </div>
              ) : null}
              {c.other_party_name ? (
                <div>
                  <span className="text-muted-2">Other party:</span>{" "}
                  {c.other_party_name}
                </div>
              ) : null}
              {c.damages_usd ? (
                <div>
                  <span className="text-muted-2">Damages:</span>{" "}
                  <span className="font-mono">
                    ${Number(c.damages_usd).toLocaleString("en-US")}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <StageStepper caseRow={c} />
        </div>
      </header>

      {/* Gate rail (only meaningful once the room is in session, but harmless before) */}
      {run.postings.length > 0 || canRun ? (
        <GateRail postings={run.postings} />
      ) : null}

      {/* Two-column body: left = evidence (ingestion + ledger), right = argument room */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <DocumentsPanel caseUuid={c.id} initialDocuments={data.documents} />
          <LedgerGraphPanel
            hasLedger={data.has_ledger}
            nodes={data.nodes}
            edges={data.edges}
            ingestionComplete={ingestionComplete}
          />
        </div>
        <ArgumentRoom
          status={run.status}
          postings={run.postings}
          bandRoomId={run.bandRoomId}
          canRun={canRun}
          lockedReason={lockedReason}
          onRun={onRun}
        />
      </div>

      {/* Decision panel — appears once the room has adjourned */}
      {run.decision ? (
        <DecisionPanel
          caseId={caseId}
          decision={run.decision}
          letter={run.letter}
        />
      ) : null}
    </div>
  );
}
