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
  postings: RoomPosting[];
  letter: string;
  decision: DecisionResult | null;
  bandRoomId: string | null;
  error: string | null;
};

type Action =
  | { type: "start"; caseId: string }
  | { type: "post"; posting: RoomPosting }
  | { type: "letter_chunk"; text: string }
  | { type: "result"; decision: DecisionResult }
  | { type: "error"; message: string }
  | { type: "reset" };

const initial: RunState = {
  status: "idle",
  caseId: null,
  postings: [],
  letter: "",
  decision: null,
  bandRoomId: null,
  error: null,
};

function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case "start":
      return { ...initial, status: "connecting", caseId: a.caseId };
    case "post":
      return {
        ...s,
        status: "streaming",
        postings: [...s.postings, a.posting],
      };
    case "letter_chunk":
      return { ...s, letter: s.letter + a.text };
    case "result":
      return {
        ...s,
        status: "complete",
        decision: a.decision,
        bandRoomId: a.decision.bandRoomId ?? null,
        letter: a.decision.letter ?? s.letter,
      };
    case "error":
      return { ...s, status: "error", error: a.message };
    case "reset":
      return initial;
  }
}

export function useRunStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  const sourceRef = useRef<EventSource | null>(null);

  const start = (caseId: string) => {
    // Tear down any previous stream first.
    sourceRef.current?.close();
    dispatch({ type: "start", caseId });

    const src = new EventSource(`/api/run/${encodeURIComponent(caseId)}`);
    sourceRef.current = src;

    src.addEventListener("post", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as RoomPosting;
        dispatch({ type: "post", posting: data });
      } catch {
        // ignore malformed
      }
    });

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
        const decision = JSON.parse(e.data) as DecisionResult;
        dispatch({ type: "result", decision });
      } catch (err) {
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        src.close();
        sourceRef.current = null;
      }
    });

    src.onerror = () => {
      // The backend closes the connection cleanly on completion; only surface
      // an error if we never received a result.
      if (state.status !== "complete") {
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

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  return { state, start, stop };
}
