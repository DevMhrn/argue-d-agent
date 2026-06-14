import { AGENTS, AgentDef } from './agents';
import { chat } from './providers';
import { checkPoints } from './citationGate';
import { validCitationIds, renderLedger, renderStatutes } from './ledger';
import { Room } from './room';
import { ESCALATE_USD } from './config';
import {
  ClaimInput, Statute, Point, FinalDecision,
  IntakeSchema, EvidenceLedgerSchema, PointsSchema, RebuttalSchema, DecisionSchema,
  Intake, EvidenceLedger,
} from './types';

export interface LumenResult {
  intake: Intake;
  ledger: EvidenceLedger;
  decision: FinalDecision;
  letter: string;
}

const GATE = 'Citation Gate';
const SYS = 'System';

export async function runLumen(claim: ClaimInput, statutes: Statute[], room: Room): Promise<LumenResult> {
  const docsText = claim.documents.map((d) => `### ${d.name} (${d.kind})\n${d.text}`).join('\n\n');

  room.post(SYS, 250, 'system',
    `Claim ${claim.caseId} opened. Jurisdiction ${claim.jurisdiction}. Documented damages $${claim.damagesUsd.toLocaleString()}.`);

  // 1) Intake (Featherless) ----------------------------------------------------
  const intake = IntakeSchema.parse(safeJson(await ask(AGENTS.intake, `CLAIM DOCUMENTS:\n${docsText}`, 'intake')));
  room.post(AGENTS.intake.name, AGENTS.intake.color, 'message',
    `${intake.parties.insured} vs ${intake.parties.otherParty} | ${intake.date} | ${intake.location} | damages $${intake.damagesUsd.toLocaleString()}`);

  // 2) Evidence Ledger (Featherless) -------------------------------------------
  const ledger = EvidenceLedgerSchema.parse(safeJson(await ask(AGENTS.evidence, `Build the evidence ledger from:\n${docsText}`, 'ledger')));
  room.post(AGENTS.evidence.name, AGENTS.evidence.color, 'message',
    `Evidence Ledger — ${ledger.facts.length} facts:\n` + ledger.facts.map((f) => `   [${f.id}] ${f.statement}  (${f.source})`).join('\n'));
  room.post(SYS, 250, 'handoff',
    'Ledger locked. RULE NOW ACTIVE: every argument must cite a fact id or statute id, or the Citation Gate rejects it.');

  const validIds = validCitationIds(ledger, statutes);
  const context = `EVIDENCE LEDGER:\n${renderLedger(ledger)}\n\nSTATUTES:\n${renderStatutes(statutes)}`;

  // 3) Advocate opens — independent / blind ------------------------------------
  const advocatePoints = await producePoints(AGENTS.advocate, room, `${context}\n\nMake your strongest opening case that the other driver is at fault.`, 'advocate_position', validIds);

  // 4) Opposing red team's own theory — independent / blind --------------------
  const opposingTheory = await producePoints(AGENTS.opposing, room, `${context}\n\nIndependently build your own theory of how OUR insured shares fault. Do not respond to anyone yet.`, 'opposing_independent', validIds);

  // 5) Opposing attacks the advocate's points ----------------------------------
  const attackPoints = await producePoints(AGENTS.opposing, room, `${context}\n\nThe Advocate argued:\n${fmt(advocatePoints)}\n\nAttack each of these points.`, 'opposing_attack', validIds);

  // 6) Advocate rebuts or concedes (concession needs a citation) ---------------
  const rebuttal = await produceRebuttal(AGENTS.advocate, room, `${context}\n\nThe opposing carrier attacked:\n${fmt(attackPoints)}\n\nRebut or concede each. Concede ONLY with a citation.`, 'advocate_rebuttal', validIds);

  room.post(SYS, 250, 'handoff', 'Debate closed — no consensus round. Neutral Adjudicator now decides from the transcript.');

  // 7) Adjudicator decides (neutral; debaters do not decide) -------------------
  const transcript =
    `Advocate opening:\n${fmt(advocatePoints)}\n\nOpposing independent theory:\n${fmt(opposingTheory)}\n\n` +
    `Opposing attacks:\n${fmt(attackPoints)}\n\nAdvocate rebuttal:\n${fmtRebuttal(rebuttal)}`;
  const decision = DecisionSchema.parse(safeJson(await ask(AGENTS.adjudicator, `${context}\n\nDEBATE TRANSCRIPT:\n${transcript}\n\nDecide the other driver's fault %.`, 'adjudicator')));

  const recoveryUsd = Math.round((claim.damagesUsd * decision.otherDriverFaultPct) / 100);
  const nearFiftyFifty = Math.abs(50 - decision.otherDriverFaultPct) < 10;
  const escalateReasons: string[] = [];
  if (recoveryUsd >= ESCALATE_USD) escalateReasons.push(`recovery $${recoveryUsd.toLocaleString()} ≥ $${ESCALATE_USD.toLocaleString()} threshold`);
  if (decision.confidence < 0.6) escalateReasons.push(`confidence ${decision.confidence} below 0.60`);
  if (nearFiftyFifty) escalateReasons.push(`fault split near 50/50 (${decision.otherDriverFaultPct}%)`);
  const escalate = escalateReasons.length > 0;
  const finalDecision: FinalDecision = { ...decision, recoveryUsd, escalate, escalateReasons, nearFiftyFifty };

  room.post(AGENTS.adjudicator.name, AGENTS.adjudicator.color, 'decision',
    `Other driver ${decision.otherDriverFaultPct}% at fault (confidence ${decision.confidence}). Recovery = $${recoveryUsd.toLocaleString()}.\n   Basis: ${decision.reasoning}`);
  if (escalate) {
    room.post(SYS, 196, 'decision', `ESCALATED TO HUMAN ADJUSTER — ${escalateReasons.join('; ')}. Awaiting Approve/Reject.`);
  }

  // 8) Demand letter ------------------------------------------------------------
  const letter = (safeJson(await ask(AGENTS.drafter, `${context}\n\nDecision: other driver ${decision.otherDriverFaultPct}% at fault; recovery $${recoveryUsd}. Write the demand letter.`, 'drafter')) as { letter: string }).letter;
  room.post(AGENTS.drafter.name, AGENTS.drafter.color, 'message', 'Drafted the formal subrogation demand letter (full text in output).');

  return { intake, ledger, decision: finalDecision, letter };
}

// --- helpers -----------------------------------------------------------------

async function ask(agent: AgentDef, user: string, mockKey: string): Promise<string> {
  return chat({ provider: agent.provider, model: agent.model, system: agent.system, user, json: true, mockKey });
}

/** Produce cited points, enforced by the citation gate with one redo on failure. */
async function producePoints(agent: AgentDef, room: Room, user: string, mockKeyBase: string, validIds: Set<string>): Promise<Point[]> {
  const maxAttempts = 2;
  let lastViolations: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = attempt === 1 ? user
      : `${user}\n\nThe Citation Gate REJECTED your previous answer:\n- ${lastViolations.join('\n- ')}\nReturn the same points but make EVERY point cite a valid id.`;
    const parsed = PointsSchema.parse(safeJson(await ask(agent, prompt, `${mockKeyBase}#${attempt}`)));
    const gate = checkPoints(parsed.points, validIds);
    if (gate.ok) {
      room.post(agent.name, agent.color, 'message', fmt(parsed.points));
      return parsed.points;
    }
    lastViolations = gate.violations;
    room.post(GATE, 196, 'gate', `REJECTED ${agent.name} (attempt ${attempt}):\n   - ${gate.violations.join('\n   - ')}`);
    if (attempt === maxAttempts) {
      room.post(agent.name, agent.color, 'message', fmt(parsed.points) + '\n   (⚠ unresolved gate violations)');
      return parsed.points;
    }
  }
  return [];
}

async function produceRebuttal(agent: AgentDef, room: Room, user: string, mockKeyBase: string, validIds: Set<string>) {
  const maxAttempts = 2;
  let lastViolations: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = attempt === 1 ? user
      : `${user}\n\nThe Citation Gate REJECTED your previous answer:\n- ${lastViolations.join('\n- ')}\nEvery response must cite a valid id.`;
    const parsed = RebuttalSchema.parse(safeJson(await ask(agent, prompt, `${mockKeyBase}#${attempt}`)));
    const asPoints = parsed.responses.map((r) => ({ claim: r.claim, citations: r.citations }));
    const gate = checkPoints(asPoints, validIds);
    if (gate.ok || attempt === maxAttempts) {
      room.post(agent.name, agent.color, 'message', fmtRebuttal(parsed));
      return parsed;
    }
    lastViolations = gate.violations;
    room.post(GATE, 196, 'gate', `REJECTED ${agent.name} (attempt ${attempt}):\n   - ${gate.violations.join('\n   - ')}`);
  }
  return { responses: [] };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`Expected JSON from model, got: ${raw.slice(0, 200)}`);
  }
}

function fmt(points: Point[]): string {
  return points.map((p, i) => `   ${i + 1}. ${p.claim}  [${p.citations.join(', ')}]`).join('\n');
}

function fmtRebuttal(r: { responses: { stance: string; claim: string; citations: string[] }[] }): string {
  return r.responses.map((x, i) => `   ${i + 1}. (${x.stance.toUpperCase()}) ${x.claim}  [${x.citations.join(', ')}]`).join('\n');
}
