"use client";

import type { RoomPosting } from "@/lib/types";

/**
 * The six harness gates light up as the pipeline fires them. We sniff the
 * incoming postings (kind='gate' or specific agent names) and bucket them
 * into stages so the rail stays in lockstep with the live debate.
 */
const STAGES = [
  { key: "intake", label: "Intake" },
  { key: "evidence", label: "Evidence + Fact Gate" },
  { key: "debate", label: "Debate + Citation Gate" },
  { key: "adjudication", label: "Adjudication + Math + Consensus" },
  { key: "alignment", label: "Source-Alignment" },
  { key: "letter", label: "Letter + Reconciliation" },
] as const;

const STAGE_OF: Record<string, (typeof STAGES)[number]["key"]> = {
  "Intake Parser": "intake",
  "Evidence Aggregator": "evidence",
  "Fact Gate": "evidence",
  "Liability Advocate": "debate",
  "Opposing-Carrier Red Team": "debate",
  "Citation Gate": "debate",
  "Adjudicator A": "adjudication",
  "Adjudicator B": "adjudication",
  "Math Gate": "adjudication",
  "Consensus Gate": "adjudication",
  "Source-Alignment Verifier": "alignment",
  "Demand Letter Drafter": "letter",
  "Letter Reconciliation": "letter",
};

export function GateRail({ postings }: { postings: RoomPosting[] }) {
  const reached = new Set<string>();
  let failed: string | null = null;
  for (const p of postings) {
    const k = STAGE_OF[p.agent];
    if (k) reached.add(k);
    if (p.kind === "gate" && /⛔|fail|reject/i.test(p.content)) {
      failed = k ?? failed;
    }
  }

  return (
    <ol className="flex w-full items-center gap-2 overflow-x-auto rounded-[14px] border border-border bg-panel/80 px-4 py-3">
      {STAGES.map((s, i) => {
        const active = reached.has(s.key);
        const isFailed = failed === s.key;
        return (
          <li key={s.key} className="flex flex-1 min-w-[120px] items-center gap-2">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-medium ${
                isFailed
                  ? "border-bad/60 bg-bad/15 text-bad"
                  : active
                    ? "border-ok/60 bg-ok/15 text-ok"
                    : "border-border bg-panel-2 text-muted-2"
              }`}
            >
              {isFailed ? "✕" : active ? "✓" : i + 1}
            </span>
            <span
              className={`text-[12px] ${
                isFailed ? "text-bad" : active ? "text-text" : "text-muted-2"
              }`}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
