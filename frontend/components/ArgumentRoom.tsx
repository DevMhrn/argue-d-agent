"use client";

import { RoomTranscript } from "@/components/RoomTranscript";
import type { RoomPosting } from "@/lib/types";

interface Props {
  status: "idle" | "connecting" | "streaming" | "complete" | "error";
  postings: RoomPosting[];
  bandRoomId: string | null;
  canRun: boolean;
  lockedReason: string | null;
  onRun: () => void;
}

type RoomStatus = Props["status"];

const ROOM_BADGE_TONE = {
  locked: "border-warn/40 bg-warn/10 text-warn",
  complete: "border-ok/40 bg-ok/10 text-ok",
  running: "border-accent/40 bg-accent/10 text-accent",
  ready: "border-ok/40 bg-ok/10 text-ok",
} as const;

export function ArgumentRoom({
  status,
  postings,
  bandRoomId,
  canRun,
  lockedReason,
  onRun,
}: Props) {
  const isLocked = !canRun;
  const running = status === "streaming" || status === "connecting";

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-card border border-border bg-panel shadow-card">
      <ArgumentRoomHeader
        status={status}
        bandRoomId={bandRoomId}
        isLocked={isLocked}
        running={running}
        onRun={onRun}
      />
      <ArgumentRoomBody
        postings={postings}
        isLocked={isLocked}
        lockedReason={lockedReason}
      />
    </section>
  );
}

function ArgumentRoomHeader({
  status,
  bandRoomId,
  isLocked,
  running,
  onRun,
}: {
  status: RoomStatus;
  bandRoomId: string | null;
  isLocked: boolean;
  running: boolean;
  onRun: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-border-soft border-b p-5">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base tracking-tight">
            Argument Room
          </h2>
          <RoomBadge status={status} isLocked={isLocked} running={running} />
        </div>
        <p className="mt-1 text-[12px] text-muted">
          Agents convene over the locked Evidence Ledger. Gates fire on their
          own — they are code, not prompts.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <BandId bandRoomId={bandRoomId} />
        <button
          type="button"
          onClick={onRun}
          disabled={isLocked || running}
          className="rounded-pill border border-accent/40 bg-accent/15 px-4 py-2 text-accent text-sm hover:bg-accent/25 disabled:opacity-50"
        >
          {roomActionLabel(status, running)}
        </button>
      </div>
    </header>
  );
}

function ArgumentRoomBody({
  postings,
  isLocked,
  lockedReason,
}: {
  postings: RoomPosting[];
  isLocked: boolean;
  lockedReason: string | null;
}) {
  if (isLocked && postings.length === 0) {
    return <LockedRoomNotice reason={lockedReason} />;
  }

  return (
    <RoomTranscript
      postings={postings}
      emptyAction="Open the room"
      tone="argument"
    />
  );
}

function LockedRoomNotice({ reason }: { reason: string | null }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md rounded-card border border-border-soft bg-panel-2 p-6 text-center">
        <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-warn border-dashed" />
        <h3 className="font-medium text-sm">Room not yet in session</h3>
        <p className="mt-1.5 text-[12.5px] text-muted leading-relaxed">
          {reason ?? "Waiting for the ledger to be built."}
        </p>
      </div>
    </div>
  );
}

function RoomBadge({
  status,
  isLocked,
  running,
}: {
  status: RoomStatus;
  isLocked: boolean;
  running: boolean;
}) {
  const badge = roomBadge(status, isLocked, running);

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${ROOM_BADGE_TONE[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

function roomBadge(status: RoomStatus, isLocked: boolean, running: boolean) {
  if (isLocked) return { label: "Locked", tone: "locked" as const };
  if (status === "complete")
    return { label: "Adjourned", tone: "complete" as const };
  if (running) return { label: "In session", tone: "running" as const };
  return { label: "Ready", tone: "ready" as const };
}

function BandId({ bandRoomId }: { bandRoomId: string | null }) {
  if (!bandRoomId) return null;

  return (
    <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 font-mono text-[11px] text-accent">
      band: {bandRoomId.slice(0, 8)}…
    </span>
  );
}

function roomActionLabel(status: RoomStatus, running: boolean) {
  if (running) return "In session…";
  if (status === "complete") return "Reconvene the band";
  return "Open the room";
}
