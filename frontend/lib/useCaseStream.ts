/**
 * useCaseStream — live case status over SSE (`/api/case/{id}/events`).
 *
 * The server polls the DB and pushes a status snapshot whenever it changes, so
 * the case page reflects ingestion → ledger-build → room-ready transitions (and
 * the ledger lane's live build phase) WITHOUT a manual refresh. Mirrors the
 * EventSource pattern in useRunStream.ts; Next rewrites /api/* to the backend so
 * the proxy streams SSE through (see next.config.ts).
 *
 * Returns the latest status snapshot (or null until the first event).
 */
import { useEffect, useRef, useState } from "react";

export interface CaseBuildProgress {
  /** "extracting" | "anchoring" | "writing" | "done" */
  phase: string;
  detail: string;
}

export interface CaseStatusEvent {
  stage: string;
  ingestion_complete: boolean;
  ledger_complete: boolean;
  finalized: boolean;
  documents: { id: string; filename: string; status: string }[];
  extracted: number;
  total: number;
  build: CaseBuildProgress | null;
}

export function useCaseStream(
  caseId: string,
  enabled: boolean,
  /** Bump to force-reopen the stream — e.g. after a document is added to an
   *  already-complete case, so the rebuild animates live (the server closes the
   *  stream once a case is settled). */
  reopenKey = 0,
): CaseStatusEvent | null {
  const [status, setStatus] = useState<CaseStatusEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // reopenKey is intentionally in deps: bumping it forces a teardown + re-subscribe
  // to the case event stream (used after a run completes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reopenKey drives re-subscription, not referenced in the body
  useEffect(() => {
    if (!enabled || !caseId) return;

    const src = new EventSource(
      `/api/case/${encodeURIComponent(caseId)}/events`,
    );
    sourceRef.current = src;

    const close = () => {
      src.close();
      if (sourceRef.current === src) sourceRef.current = null;
    };

    src.addEventListener("status", (e: MessageEvent) => {
      try {
        setStatus(JSON.parse(e.data) as CaseStatusEvent);
      } catch {
        // ignore malformed frames
      }
    });
    // The server sends "done" and closes once the case is settled; just stop.
    src.addEventListener("done", close);
    src.onerror = close;

    return close;
    // reopenKey is intentionally a dependency: bumping it forces the effect to
    // tear down and re-subscribe to the case event stream (used after a run).
    // biome-ignore lint/correctness/useExhaustiveDependencies: reopenKey drives re-subscription, not used in the body
  }, [caseId, enabled, reopenKey]);

  return status;
}
