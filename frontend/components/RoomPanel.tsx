"use client";

import { RoomTranscript } from "@/components/RoomTranscript";
import type { RoomPosting } from "@/lib/types";

interface Props {
  postings: RoomPosting[];
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  onRun: () => void;
  canRun: boolean;
  bandRoomId: string | null;
  activity?: { agent: string; content: string } | null;
}

type RoomStatus = Props["status"];

export function RoomPanel({
  postings,
  status,
  onRun,
  canRun,
  bandRoomId,
  activity = null,
}: Props) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <RoomPanelHeader
        status={status}
        bandRoomId={bandRoomId}
        canRun={canRun}
        onRun={onRun}
      />
      <RoomTranscript
        postings={postings}
        emptyAction="Run investigation"
        activity={activity}
      />
    </section>
  );
}

function RoomPanelHeader({
  status,
  bandRoomId,
  canRun,
  onRun,
}: {
  status: RoomStatus;
  bandRoomId: string | null;
  canRun: boolean;
  onRun: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-border-soft border-b p-5">
      <div>
        <h2 className="font-semibold text-base tracking-tight">
          Live Band Room
        </h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Agents post in turn. Gates fire on their own — they are code, not
          prompts.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <BandId bandRoomId={bandRoomId} />
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || isRunning(status)}
          className="rounded-pill border border-accent/40 bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
        >
          {roomActionLabel(status)}
        </button>
      </div>
    </header>
  );
}

function BandId({ bandRoomId }: { bandRoomId: string | null }) {
  if (!bandRoomId) return null;

  return (
    <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
      band: {bandRoomId.slice(0, 8)}…
    </span>
  );
}

function isRunning(status: RoomStatus) {
  return status === "streaming" || status === "connecting";
}

function roomActionLabel(status: RoomStatus) {
  if (isRunning(status)) return "Running…";
  if (status === "complete") return "Run again";
  return "Run investigation";
}
