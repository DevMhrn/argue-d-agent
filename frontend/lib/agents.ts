/**
 * Agent identity registry — the cross-family "anti-collusion, made visible"
 * model from the Lumen design comp, keyed by the EXACT backend display names
 * (`posting.agent`). Backend names are kept verbatim; only the visual identity
 * (family tint, avatar shape, monogram) is layered on.
 *
 * Family is derived from the real backend provider (backend/app/agents.py):
 *   anthropic → Claude family  → warm sand   (rounded-square avatar)
 *   openai    → GPT family     → cool steel  (circle avatar)
 *   procedural/system          → process     (diamond avatar)
 */

export type AgentFamily = "claude" | "gpt" | "code";
export type AgentShape = "rsq" | "circle" | "diamond";

export interface AgentIdentity {
  /** Exact backend display name (posting.agent). */
  name: string;
  /** Avatar monogram. */
  mono: string;
  family: AgentFamily;
  /** Per-agent tint (a slight variation off the family base). */
  tint: string;
  shape: AgentShape;
  /** One-line role, shown on first appearance in the transcript. */
  role: string;
  /** Short label for the bench cell. */
  benchName: string;
  /** Short role line for the bench cell. */
  benchRole: string;
}

const CLAUDE = "var(--color-family-claude)"; // #d8b888 warm sand
const GPT = "var(--color-family-gpt)"; // #8fb8bd cool steel

/** The procedural voice ("System" in the backend) shown as the Court Clerk. */
export const CLERK: AgentIdentity = {
  name: "Court Clerk",
  mono: "CC",
  family: "code",
  tint: "var(--color-muted)",
  shape: "diamond",
  role: "Runs the process — opens each round and seals the final record",
  benchName: "Clerk",
  benchRole: "runs the process",
};

export const AGENTS: Record<string, AgentIdentity> = {
  "Intake Parser": {
    name: "Intake Parser",
    mono: "IP",
    family: "gpt",
    tint: GPT,
    shape: "circle",
    role: "Extracts the incident facts from the claim",
    benchName: "Intake",
    benchRole: "extracts facts",
  },
  "Evidence Aggregator": {
    name: "Evidence Aggregator",
    mono: "EA",
    family: "gpt",
    tint: GPT,
    shape: "circle",
    role: "Builds the grounded Evidence Ledger",
    benchName: "Evidence",
    benchRole: "builds the ledger",
  },
  "Liability Advocate": {
    name: "Liability Advocate",
    mono: "LA",
    family: "claude",
    tint: CLAUDE,
    shape: "rsq",
    role: "Argues for recovery on behalf of our insured",
    benchName: "Advocate",
    benchRole: "argues for recovery",
  },
  "Opposing-Carrier Red Team": {
    name: "Opposing-Carrier Red Team",
    mono: "RT",
    family: "gpt",
    tint: GPT,
    shape: "circle",
    role: "Argues the at-fault carrier's defense, so nothing is missed",
    benchName: "Opposing",
    benchRole: "the other carrier's case",
  },
  "Adjudicator A": {
    name: "Adjudicator A",
    mono: "A",
    family: "claude",
    tint: "#cdb07f",
    shape: "rsq",
    role: "Weighs liability and sets fault % — Claude family (A)",
    benchName: "Adjudicator",
    benchRole: "fault % · family A",
  },
  "Adjudicator B": {
    name: "Adjudicator B",
    mono: "B",
    family: "gpt",
    tint: "#86b0c4",
    shape: "circle",
    role: "Independent second opinion from a different model family (B)",
    benchName: "Reviewer",
    benchRole: "second opinion · family B",
  },
  "Source-Alignment Verifier": {
    name: "Source-Alignment Verifier",
    mono: "SV",
    family: "claude",
    tint: "#cdb48a",
    shape: "rsq",
    role: "Checks every cited claim against the locked evidence ledger",
    benchName: "Checker",
    benchRole: "claims vs evidence",
  },
  "Demand Letter Drafter": {
    name: "Demand Letter Drafter",
    mono: "DR",
    family: "claude",
    tint: "#dab98c",
    shape: "rsq",
    role: "Writes the formal demand letter to the other carrier",
    benchName: "Drafter",
    benchRole: "writes the demand",
  },
  "Damages Analyst": {
    name: "Damages Analyst",
    mono: "DA",
    family: "claude",
    tint: "#d6c08a",
    shape: "rsq",
    role: "Reconciles the documented loss to recoverable dollars",
    benchName: "Damages",
    benchRole: "loss → dollars",
  },
};

/**
 * Bench order — the participants shown in the room header strip, in turn order.
 * Clerk leads; then the cross-family bench. Intake/Evidence are pre-room lanes
 * but kept on the bench so the full 8-agent coordination layer is literal.
 */
export const BENCH_ORDER: AgentIdentity[] = [
  CLERK,
  AGENTS["Liability Advocate"],
  AGENTS["Opposing-Carrier Red Team"],
  AGENTS["Adjudicator A"],
  AGENTS["Adjudicator B"],
  AGENTS["Source-Alignment Verifier"],
  AGENTS["Evidence Aggregator"],
  AGENTS["Demand Letter Drafter"],
];

/** Names treated as the procedural/clerk voice. */
const CLERK_ALIASES = new Set([
  "System",
  "Court Clerk",
  "Clerk",
  "Docket",
  "Citation Gate",
  "Fact Gate",
  "Math Gate",
  "Consensus Gate",
  "Letter Reconciliation",
  "Viability",
  "Human Review",
  "Intake Parse",
]);

/**
 * Resolve any `posting.agent` string to an identity. Unknown names (and every
 * procedural/gate voice) fall back to the Court Clerk so the UI never blanks.
 */
export function agentIdentity(name: string | undefined | null): AgentIdentity {
  if (!name) return CLERK;
  const direct = AGENTS[name];
  if (direct) return direct;
  if (CLERK_ALIASES.has(name)) return { ...CLERK, name };
  return { ...CLERK, name, benchName: name, benchRole: "" };
}

export function familyTint(family: AgentFamily): string {
  if (family === "claude") return CLAUDE;
  if (family === "gpt") return GPT;
  return "var(--color-muted)";
}

/** Family chip label used next to a speaker's name. */
export function familyLabel(family: AgentFamily): string {
  if (family === "claude") return "family A";
  if (family === "gpt") return "family B";
  return "process";
}

/** Soft background / border washes for a family-tinted avatar or chip. */
export function familyWash(family: AgentFamily): {
  bg: string;
  border: string;
} {
  if (family === "claude")
    return { bg: "rgba(216,184,136,0.14)", border: "rgba(216,184,136,0.4)" };
  if (family === "gpt")
    return { bg: "rgba(143,184,189,0.14)", border: "rgba(143,184,189,0.4)" };
  return { bg: "var(--color-panel-3)", border: "var(--color-border)" };
}

/** Avatar corner radius for an agent shape (diamond renders upright, not rotated). */
export function shapeRadius(shape: AgentShape): string {
  if (shape === "circle") return "50%";
  if (shape === "diamond") return "7px";
  return "9px";
}
