"use client";

/**
 * useRunStream — wraps EventSource for /api/run/{caseId}.
 *
 * Returns the rolling state of a debate run: the transcript so far, which
 * gates have fired, the streaming letter (assembled chunk-by-chunk), and the
 * final decision when the `result` event lands. Designed to be the single
 * source of truth for the case-detail panels.
 */
import { useEffect, useReducer, useRef } from "react";
import type { DecisionResult, RoomPosting } from "./types";

export type RunState = {
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  caseId: string | null;
  activeRunId: string | null;
  lastSeq: number | null;
  postings: RoomPosting[];
  letter: string;
  decision: DecisionResult | null;
  bandRoomId: string | null;
  error: string | null;
};

type Action =
  | { type: "start"; caseId: string }
  | { type: "stream_start"; caseId: string; runId: string | null }
  | { type: "post"; posting: RoomPosting }
  | { type: "letter_chunk"; text: string }
  | { type: "result"; decision: DecisionResult }
  | { type: "error"; message: string }
  | { type: "reset" }
  | {
      type: "seed";
      caseId: string;
      runId?: string | null;
      postings: RoomPosting[];
      decision: DecisionResult | null;
      letter: string;
      status: "complete" | "streaming" | "error";
    };

interface RunDecisionEvent
  extends Omit<
    DecisionResult,
    "otherFaultPct" | "recoveryUsd" | "consensusDeltaPp"
  > {
  otherFaultPct?: number;
  otherDriverFaultPct?: number;
  recoveryUsd?: number;
  recovery_usd?: number;
  consensusDeltaPp?: number;
  consensusDelta?: number;
  decline_reason?: string | null;
}

interface RunResultEvent {
  decision: RunDecisionEvent;
  letter?: string;
  auditHash?: string;
  bandRoomId?: string | null;
  runId?: string | null;
}

interface RunStartEvent {
  caseId: string;
  runId?: string | null;
}

type ActionReducers = {
  [K in Action["type"]]: (
    state: RunState,
    action: Extract<Action, { type: K }>,
  ) => RunState;
};

const initial: RunState = {
  status: "idle",
  caseId: null,
  activeRunId: null,
  lastSeq: null,
  postings: [],
  letter: "",
  decision: null,
  bandRoomId: null,
  error: null,
};

const ACTION_REDUCERS: ActionReducers = {
  start: (_state, action) => ({
    ...initial,
    status: "connecting",
    caseId: action.caseId,
  }),
  stream_start: (state, action) => ({
    ...state,
    status: "streaming",
    caseId: action.caseId,
    activeRunId: action.runId,
  }),
  post: (state, action) => ({
    ...state,
    status: "streaming",
    postings: [...state.postings, action.posting],
    lastSeq: action.posting.seq ?? state.lastSeq,
  }),
  letter_chunk: (state, action) => ({
    ...state,
    letter: state.letter + action.text,
  }),
  result: (state, action) => ({
    ...state,
    status: "complete",
    decision: action.decision,
    bandRoomId: action.decision.bandRoomId ?? null,
    letter: action.decision.letter ?? state.letter,
  }),
  error: (state, action) => ({
    ...state,
    status: "error",
    error: action.message,
  }),
  reset: () => initial,
  seed: (_state, action) => ({
    ...initial,
    caseId: action.caseId,
    activeRunId: action.runId ?? null,
    lastSeq: lastPostingSeq(action.postings),
    postings: action.postings,
    decision: action.decision,
    letter: action.letter,
    status: action.status,
    bandRoomId: action.decision?.bandRoomId ?? null,
  }),
};

function reducer(s: RunState, a: Action): RunState {
  const applyAction = ACTION_REDUCERS[a.type] as (
    state: RunState,
    action: Action,
  ) => RunState;
  return applyAction(s, a);
}

export function useRunStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const sourceRef = useRef<EventSource | null>(null);

  const start = (caseId: string) => {
    // Tear down any previous stream first.
    sourceRef.current?.close();
    dispatch({ type: "start", caseId });

    const src = new EventSource(`/api/run/${encodeURIComponent(caseId)}`);
    let receivedResult = false;
    sourceRef.current = src;

    src.addEventListener("start", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as RunStartEvent;
        dispatch(streamStartAction(data));
      } catch {
        // ignore malformed
      }
    });

    const handlePosting = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as RoomPosting;
        dispatch({ type: "post", posting: data });
      } catch {
        // ignore malformed
      }
    };

    src.addEventListener("post", handlePosting);
    src.addEventListener("posting", handlePosting);

    src.addEventListener("letter", (e: MessageEvent) => {
      try {
        const { chunk } = JSON.parse(e.data) as { chunk: string };
        if (chunk) dispatch({ type: "letter_chunk", text: chunk });
      } catch {
        // ignore
      }
    });

    src.addEventListener("result", (e: MessageEvent) => {
      try {
        receivedResult = true;
        const payload = JSON.parse(e.data) as RunResultEvent;
        dispatch({ type: "result", decision: normalizeRunResult(payload) });
      } catch (err) {
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      src.close();
      sourceRef.current = null;
    });

    src.onerror = () => {
      // The backend closes the connection cleanly on completion; only surface
      // an error if we never received a result.
      if (!receivedResult) {
        dispatch({ type: "error", message: "Stream interrupted" });
      }
      src.close();
      sourceRef.current = null;
    };
  };

  const stop = () => {
    sourceRef.current?.close();
    sourceRef.current = null;
    dispatch({ type: "reset" });
  };

  /**
   * Hydrate the hook with a previously persisted run (postings + optional
   * decision). Used by the case-detail page to replay the last debate from
   * the `transcript` + `decisions` tables on mount, so refresh preserves
   * what the user already saw.
   *
   * If an SSE stream is already open (the user clicked "Open the room" while
   * the replay's API chain was still loading), this is a no-op — the live run
   * is the user's current intent and replaying a prior result would close the
   * stream mid-debate (and the backend's CancelledError handler would mark the
   * fresh run as "failed (client disconnected)" — the bug this guards against).
   */
  const seed = (input: {
    caseId: string;
    runId?: string | null;
    postings: RoomPosting[];
    decision: DecisionResult | null;
    letter?: string;
    status?: "complete" | "streaming" | "error";
  }) => {
    if (sourceRef.current) return;
    dispatch({
      type: "seed",
      caseId: input.caseId,
      runId: input.runId,
      postings: input.postings,
      decision: input.decision,
      letter: input.letter ?? input.decision?.letter ?? "",
      status: input.status ?? (input.decision ? "complete" : "streaming"),
    });
  };

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  return { state, start, stop, seed };
}

/**
 * Map a persisted-DecisionRow JSON blob (snake_case from /api/runs/.../transcript)
 * into the camelCase DecisionResult shape the UI components consume. Returns
 * null if no decision row exists yet (run still in progress, or failed early).
 */
export function decisionFromPersisted(
  raw: Record<string, unknown> | null,
): DecisionResult | null {
  if (!raw) return null;
  const get = <T>(...keys: string[]): T | undefined => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null) return v as T;
    }
    return undefined;
  };
  return {
    outcome: (get<string>("outcome") ??
      (get<boolean>("escalate") ? "escalate" : "pursue")) as
      | "pursue"
      | "escalate"
      | "decline",
    otherFaultPct: Number(
      get("otherDriverFaultPct", "other_driver_fault_pct") ?? 0,
    ),
    recoveryUsd: Number(get("recoveryUsd", "recovery_usd") ?? 0),
    confidence: Number(get("confidence") ?? 0),
    escalate: Boolean(get("escalate") ?? false),
    pursue: get<boolean>("pursue"),
    declineReason: get<string | null>("declineReason", "decline_reason"),
    consensus: get<DecisionResult["consensus"]>("consensus", "consensus_type"),
    consensusDeltaPp: Number(get("consensusDeltaPp", "consensus_delta") ?? 0),
    faultTable: get(
      "faultTable",
      "fault_table",
    ) as DecisionResult["faultTable"],
    reasoning: get<string>("reasoning"),
    letter: get<string>("letter"),
    auditHash: get<string>("auditHash", "audit_hash"),
    bandRoomId:
      (get("bandRoomId", "band_room_id") as string | null | undefined) ?? null,
    secondaryDecision: get<unknown>("secondaryDecision", "secondary_decision"),
  };
}

function normalizeRunResult(payload: RunResultEvent): DecisionResult {
  const decision = payload.decision;

  return {
    ...decision,
    otherFaultPct: firstDefined(
      [decision.otherFaultPct, decision.otherDriverFaultPct],
      0,
    ),
    recoveryUsd: firstDefined([decision.recoveryUsd, decision.recovery_usd], 0),
    consensusDeltaPp: firstDefined([
      decision.consensusDeltaPp,
      decision.consensusDelta,
    ]),
    declineReason: firstDefined([
      decision.declineReason,
      decision.decline_reason,
    ]),
    letter: firstDefined([decision.letter, payload.letter]),
    auditHash: firstDefined([decision.auditHash, payload.auditHash]),
    bandRoomId: firstDefined([decision.bandRoomId, payload.bandRoomId], null),
  };
}

function lastPostingSeq(postings: RoomPosting[]): number | null {
  const seq = postings.at(-1)?.seq;
  return seq === undefined ? null : seq;
}

function streamStartAction(data: RunStartEvent): Action {
  return {
    type: "stream_start",
    caseId: data.caseId,
    runId: data.runId ?? null,
  };
}

function firstDefined<T>(values: Array<T | undefined>, fallback: T): T;
function firstDefined<T>(values: Array<T | undefined>): T | undefined;
function firstDefined<T>(values: Array<T | undefined>, fallback?: T) {
  const value = values.find((item): item is T => item !== undefined);
  return value === undefined ? fallback : value;
}
