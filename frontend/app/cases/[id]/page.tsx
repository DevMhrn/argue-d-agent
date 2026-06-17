"use client";

import { use, useCallback, useEffect, useState } from "react";

import { getCase } from "@/lib/api";
import { DecisionPanel } from "@/components/DecisionPanel";
import { GateRail } from "@/components/GateRail";
import { LedgerPanel } from "@/components/LedgerPanel";
import { RoomPanel } from "@/components/RoomPanel";
import { useRunStream } from "@/lib/useRunStream";
import type { LegacyClaim } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function CaseDetailPage({ params }: PageProps) {
  // Next 16: params is a Promise in client components — unwrap with React.use().
  const { id } = use(params);

  const [claim, setClaim] = useState<LegacyClaim | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { state, start } = useRunStream();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { claim } = await getCase(id);
        if (!cancelled) setClaim(claim);
      } catch (err) {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleRun = useCallback(() => {
    start(id);
  }, [id, start]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-4 px-6 py-6">
      <GateRail postings={state.postings} />

      <div className="grid flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        <LedgerPanel claim={claim} />
        <RoomPanel
          postings={state.postings}
          status={state.status}
          onRun={handleRun}
          canRun={Boolean(claim) && !loadError}
          bandRoomId={state.bandRoomId}
        />
        <DecisionPanel
          caseId={claim?.caseId ?? id}
          decision={state.decision}
          letter={state.letter}
        />
      </div>

      {loadError ? (
        <div className="rounded-[9px] border border-bad/40 bg-bad/5 p-3 text-[13px] text-bad">
          {loadError}
        </div>
      ) : null}
    </div>
  );
}
