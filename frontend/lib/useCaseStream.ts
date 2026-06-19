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
): CaseStatusEvent | null {
  const [status, setStatus] = useState<CaseStatusEvent | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

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
    // The server sends "done" and closes once the ledger is locked; just stop.
    src.addEventListener("done", close);
    src.onerror = close;

    return close;
  }, [caseId, enabled]);

  return status;
}
