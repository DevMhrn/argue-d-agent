import { AGENTS, AgentDef } from './agents';
import { chat } from './providers';
import { checkPoints } from './citationGate';
import { checkLedgerAnchoring } from './factGate';
import { checkAdjudicatorMath } from './mathGate';
import { collectVerifierTasks, summarizeAlignment, VerifierTask } from './verifier';
import { validCitationIds, renderLedger, renderStatutes } from './ledger';
import { Room } from './room';
import { ESCALATE_USD } from './config';
import {
  ClaimInput, Statute, Point, FinalDecision, Decision,
  IntakeSchema, EvidenceLedgerSchema, PointsSchema, RebuttalSchema, DecisionSchema,
  AlignmentSchema,
  Intake, EvidenceLedger,
} from './types';

export interface LumenResult {
  intake: Intake;
  ledger: EvidenceLedger;
  decision: FinalDecision;
  letter: string;
}

const CITE_GATE = 'Citation Gate';
const FACT_GATE = 'Fact Gate';
const MATH_GATE = 'Math Gate';
const ALIGN_GATE = 'Source-Alignment Verifier';
const CONSENSUS_GATE = 'Consensus Gate';
const LETTER_GATE = 'Letter Reconciliation';
const SYS = 'System';

/** ±pp tolerance for the dual-adjudicator consensus check. */
const CONSENSUS_TOLERANCE_PP = 10;

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

  // 2b) Fact Gate — every fact's verbatim quote must appear in the source document.
  //     Code-enforced foundation check. If any fact fails, post a warning to the room
  //     but proceed (the demo continues; downstream agents can still see what slipped).
  const factCheck = checkLedgerAnchoring(ledger, claim);
  if (factCheck.ok) {
    room.post(FACT_GATE, 46, 'gate', `All ${ledger.facts.length} facts anchored to verbatim source quotes.`);
  } else {
    room.post(FACT_GATE, 196, 'gate',
      `REJECTED ${factCheck.violations.length} fact(s):\n   - ${factCheck.violations.join('\n   - ')}`);
  }

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

  // 7) Dual Adjudicator — two independent calls on DIFFERENT model families,
  //    each blind to the other, each math-gated separately. Disagreement -> escalation.
  const transcript =
    `Advocate opening:\n${fmt(advocatePoints)}\n\nOpposing independent theory:\n${fmt(opposingTheory)}\n\n` +
    `Opposing attacks:\n${fmt(attackPoints)}\n\nAdvocate rebuttal:\n${fmtRebuttal(rebuttal)}`;
  const adjPrompt = `${context}\n\nDEBATE TRANSCRIPT:\n${transcript}\n\nDecide the other driver's fault %.`;

  const adjResults = await Promise.allSettled([
    ask(AGENTS.adjudicator, adjPrompt, 'adjudicator'),
    ask(AGENTS.adjudicator_b, adjPrompt, 'adjudicator_b'),
  ]);

  const decA = parseDecisionOrNull(adjResults[0]);
  const decB = parseDecisionOrNull(adjResults[1]);

  // 7b) Math-gate each adjudicator independently. A pass-fail per adjudicator;
  //     downstream consensus only uses adjudicators that passed.
  const mathA = decA ? checkAdjudicatorMath(decA) : null;
  const mathB = decB ? checkAdjudicatorMath(decB) : null;

  if (decA) {
    room.post(AGENTS.adjudicator.name, AGENTS.adjudicator.color, 'decision',
      `Other driver ${decA.otherDriverFaultPct}% at fault (confidence ${decA.confidence}).\n   Basis: ${decA.reasoning}`);
    if (mathA?.ok) {
      room.post(MATH_GATE, 46, 'gate', `A ✓ table implies ${mathA.computedPct}%, stated ${mathA.statedPct}% (delta ${mathA.delta}pp).`);
    } else if (mathA) {
      room.post(MATH_GATE, 196, 'gate', `A REJECTED — ${mathA.violation}`);
    }
  } else {
    room.post(MATH_GATE, 196, 'gate', 'Adjudicator A failed to return a parseable decision.');
  }
  if (decB) {
    room.post(AGENTS.adjudicator_b.name, AGENTS.adjudicator_b.color, 'decision',
      `Other driver ${decB.otherDriverFaultPct}% at fault (confidence ${decB.confidence}).\n   Basis: ${decB.reasoning}`);
    if (mathB?.ok) {
      room.post(MATH_GATE, 46, 'gate', `B ✓ table implies ${mathB.computedPct}%, stated ${mathB.statedPct}% (delta ${mathB.delta}pp).`);
    } else if (mathB) {
      room.post(MATH_GATE, 196, 'gate', `B REJECTED — ${mathB.violation}`);
    }
  } else {
    room.post(MATH_GATE, 196, 'gate', 'Adjudicator B failed to return a parseable decision.');
  }

  // 7c) Consensus Gate — merge the two views (or fall back if one failed).
  const consensus = computeConsensus(decA, decB, mathA?.ok ?? false, mathB?.ok ?? false);
  if (!consensus) {
    throw new Error('Both adjudicators failed; cannot proceed without a decision.');
  }
  const { canonical, secondary, consensusType, consensusDelta } = consensus;

  if (consensusType === 'agreement') {
    room.post(CONSENSUS_GATE, 46, 'gate',
      `Adjudicators converged — A=${decA!.otherDriverFaultPct}%, B=${decB!.otherDriverFaultPct}% (delta ${consensusDelta}pp ≤ ${CONSENSUS_TOLERANCE_PP}pp). Using ${canonical.otherDriverFaultPct}%.`);
  } else if (consensusType === 'disagreement') {
    room.post(CONSENSUS_GATE, 196, 'gate',
      `DISAGREEMENT — A=${decA!.otherDriverFaultPct}%, B=${decB!.otherDriverFaultPct}% (delta ${consensusDelta}pp > ${CONSENSUS_TOLERANCE_PP}pp). Forcing human review.`);
  } else if (consensusType === 'single') {
    const which = decA && mathA?.ok ? 'A' : 'B';
    room.post(CONSENSUS_GATE, 214, 'gate',
      `Only Adjudicator ${which} passed math gate; using ${canonical.otherDriverFaultPct}% with reduced confidence.`);
  }

  // 7d) Source-Alignment Verifier — the FIFTH code gate. For every (claim, factId)
  //     pair in the transcript, the verifier checks whether the claim actually
  //     follows from the fact. Catches "cited but misrepresented" — the biggest
  //     remaining semantic hole the Citation Gate alone cannot detect.
  const verifierTasks = collectVerifierTasks({ advocatePoints, opposingTheory, attackPoints, rebuttal });
  let verifierContradicted = 0;
  if (verifierTasks.length === 0) {
    room.post(ALIGN_GATE, 214, 'gate', 'No fact citations in transcript — nothing to align.');
  } else {
    const verifierResult = await runVerifier(verifierTasks, context);
    if (verifierResult) {
      const summary = summarizeAlignment(verifierResult.results);
      verifierContradicted = summary.contradicted;
      const head = `${summary.supported}/${summary.total} supported, ${summary.overreach} overreach, ${summary.contradicted} contradicted.`;
      if (summary.contradicted === 0 && summary.overreach === 0) {
        room.post(ALIGN_GATE, 46, 'gate', head);
      } else if (summary.contradicted === 0) {
        const lines = summary.overreachDetails.map((r) => `   - overreach [${r.citationId}]: "${truncate(r.claim)}" — ${r.reasoning}`);
        room.post(ALIGN_GATE, 214, 'gate', `${head}\n${lines.join('\n')}`);
      } else {
        const lines = summary.contradictedDetails.map((r) => `   - CONTRADICTED [${r.citationId}]: "${truncate(r.claim)}" — ${r.reasoning}`);
        room.post(ALIGN_GATE, 196, 'gate', `${head}\n${lines.join('\n')}`);
      }
    } else {
      room.post(ALIGN_GATE, 214, 'gate', 'Verifier unavailable; skipping semantic alignment check.');
    }
  }

  const recoveryUsd = Math.round((claim.damagesUsd * canonical.otherDriverFaultPct) / 100);
  const nearFiftyFifty = Math.abs(50 - canonical.otherDriverFaultPct) < 10;
  const escalateReasons: string[] = [];
  if (recoveryUsd >= ESCALATE_USD) escalateReasons.push(`recovery $${recoveryUsd.toLocaleString()} ≥ $${ESCALATE_USD.toLocaleString()} threshold`);
  if (canonical.confidence < 0.6) escalateReasons.push(`confidence ${canonical.confidence} below 0.60`);
  if (nearFiftyFifty) escalateReasons.push(`fault split near 50/50 (${canonical.otherDriverFaultPct}%)`);
  if (mathA && !mathA.ok) escalateReasons.push(`Adjudicator A math gate violation (${mathA.delta}pp)`);
  if (mathB && !mathB.ok) escalateReasons.push(`Adjudicator B math gate violation (${mathB.delta}pp)`);
  if (consensusType === 'disagreement') escalateReasons.push(`adjudicator disagreement (${consensusDelta}pp > ${CONSENSUS_TOLERANCE_PP}pp)`);
  if (consensusType === 'single') escalateReasons.push(`only one adjudicator usable`);
  if (verifierContradicted > 0) escalateReasons.push(`source-alignment verifier flagged ${verifierContradicted} contradicted claim(s)`);
  const escalate = escalateReasons.length > 0;
  const finalDecision: FinalDecision = {
    ...canonical,
    recoveryUsd,
    escalate,
    escalateReasons,
    nearFiftyFifty,
    secondary,
    consensus: consensusType,
    consensusDelta,
  };

  if (escalate) {
    room.post(SYS, 196, 'decision', `ESCALATED TO HUMAN ADJUSTER — ${escalateReasons.join('; ')}. Awaiting Approve/Reject.`);
  }

  // 8) Demand letter ------------------------------------------------------------
  const letter = (safeJson(await ask(AGENTS.drafter, `${context}\n\nDecision: other driver ${canonical.otherDriverFaultPct}% at fault; recovery $${recoveryUsd}. Write the demand letter.`, 'drafter')) as { letter: string }).letter;
  room.post(AGENTS.drafter.name, AGENTS.drafter.color, 'message', 'Drafted the formal subrogation demand letter (full text in output).');

  // 8b) Letter Reconciliation — the letter must actually mention the decided
  //     fault % and recovery amount. Catches the worst-case failure where the
  //     dashboard says one number and the letter says another.
  const letterIssues = reconcileLetter(letter, finalDecision);
  if (letterIssues.length === 0) {
    room.post(LETTER_GATE, 46, 'gate', `Letter matches the adjudicator's ${canonical.otherDriverFaultPct}% / $${recoveryUsd.toLocaleString()}.`);
  } else {
    room.post(LETTER_GATE, 196, 'gate', `FAILED:\n   - ${letterIssues.join('\n   - ')}`);
  }

  return { intake, ledger, decision: finalDecision, letter };
}

/** Verifies the drafted letter actually contains the decision's headline numbers. */
function reconcileLetter(letter: string, decision: FinalDecision): string[] {
  const issues: string[] = [];
  const pctStr = `${decision.otherDriverFaultPct}%`;
  if (!letter.includes(pctStr)) {
    issues.push(`letter does not mention the ${pctStr} fault assessment`);
  }
  const recComma = `$${decision.recoveryUsd.toLocaleString()}`;
  const recPlain = `$${decision.recoveryUsd}`;
  if (!letter.includes(recComma) && !letter.includes(recPlain)) {
    issues.push(`letter does not mention the recovery amount ${recComma}`);
  }
  return issues;
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
    room.post(CITE_GATE, 196, 'gate', `REJECTED ${agent.name} (attempt ${attempt}):\n   - ${gate.violations.join('\n   - ')}`);
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
    room.post(CITE_GATE, 196, 'gate', `REJECTED ${agent.name} (attempt ${attempt}):\n   - ${gate.violations.join('\n   - ')}`);
  }
  return { responses: [] };
}

/** Parse a Promise.allSettled result into a Decision, or null if anything failed. */
function parseDecisionOrNull(r: PromiseSettledResult<string>): Decision | null {
  if (r.status !== 'fulfilled') return null;
  try {
    return DecisionSchema.parse(safeJson(r.value));
  } catch {
    return null;
  }
}

interface ConsensusResult {
  canonical: Decision;
  secondary?: Decision;
  consensusType: 'agreement' | 'disagreement' | 'single' | 'none';
  consensusDelta: number;
}

/**
 * Merge two adjudicator decisions into a single canonical one.
 *
 * Both pass math + agree (≤ tolerance): average the percentages, take min confidence.
 * Both pass math + disagree (> tolerance): use A as canonical, expose B as secondary,
 *   mark disagreement (escalation kicks in upstream).
 * Only one passes math: use that one with confidence ×0.8 (we lost a check).
 * Neither passes: null — pipeline must escalate hard.
 */
function computeConsensus(
  decA: Decision | null,
  decB: Decision | null,
  aMathOk: boolean,
  bMathOk: boolean,
): ConsensusResult | null {
  const aUsable = decA && aMathOk;
  const bUsable = decB && bMathOk;

  if (aUsable && bUsable) {
    const delta = Math.abs(decA!.otherDriverFaultPct - decB!.otherDriverFaultPct);
    if (delta <= CONSENSUS_TOLERANCE_PP) {
      const avgPct = Math.round((decA!.otherDriverFaultPct + decB!.otherDriverFaultPct) / 2);
      const canonical: Decision = {
        ...decA!,
        otherDriverFaultPct: avgPct,
        confidence: Math.min(decA!.confidence, decB!.confidence),
        reasoning: `[Consensus of A and B, delta ${delta}pp] ${decA!.reasoning}`,
      };
      return { canonical, secondary: decB!, consensusType: 'agreement', consensusDelta: delta };
    }
    return { canonical: decA!, secondary: decB!, consensusType: 'disagreement', consensusDelta: delta };
  }

  if (aUsable) {
    return { canonical: { ...decA!, confidence: decA!.confidence * 0.8 }, secondary: decB ?? undefined, consensusType: 'single', consensusDelta: 0 };
  }
  if (bUsable) {
    return { canonical: { ...decB!, confidence: decB!.confidence * 0.8 }, secondary: decA ?? undefined, consensusType: 'single', consensusDelta: 0 };
  }
  return null;
}

/**
 * Call the Source-Alignment Verifier with the collected tasks. Retries once on
 * a parse failure, then gives up gracefully (returns null). The pipeline treats
 * a null verifier as "skip semantic check, post a warning" — never blocks.
 */
async function runVerifier(tasks: VerifierTask[], context: string) {
  const taskList = tasks
    .map((t, i) => `${i + 1}. [pointIndex=${t.pointIndex} source=${t.pointSource}] claim="${t.claim}"  cites=[${t.citationId}]`)
    .join('\n');
  const prompt = `${context}\n\nVERIFY THESE CITED CLAIMS — for each row return one alignment result, echoing pointIndex, pointSource, claim, citationId:\n${taskList}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await ask(AGENTS.verifier, prompt, attempt === 1 ? 'verifier' : 'verifier#retry');
      return AlignmentSchema.parse(safeJson(raw));
    } catch {
      if (attempt === 2) return null;
    }
  }
  return null;
}

function truncate(s: string, n = 64): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
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
