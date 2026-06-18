"""The orchestration: structured debate, dual adjudication, consensus, all gates,
source-alignment, escalation, and the demand letter (ported from src/pipeline.ts).
"""
from __future__ import annotations
import asyncio
import json
import re
from dataclasses import dataclass

from .agents import AGENTS, AgentDef
from .config import ESCALATE_USD, PURSUE_MIN_USD, PURSUE_MIN_FAULT_PCT, USE_LEDGER_LANE
from .providers import chat
from .gates import check_points, check_ledger_anchoring, check_adjudicator_math, MathGateResult
from .verifier import collect_verifier_tasks, summarize_alignment, VerifierTask
from .ledger import valid_citation_ids, render_ledger, render_statutes
from .mock_responses import set_mock_case
from .room import Room
from ..ledger.builder import build_ledger, graph_to_evidence_ledger
from .types import (
    ClaimInput, Statute, Point, Points, Rebuttal, Decision, FinalDecision,
    Intake, EvidenceLedger, Alignment,
)

CITE_GATE = "Citation Gate"
FACT_GATE = "Fact Gate"
MATH_GATE = "Math Gate"
ALIGN_GATE = "Source-Alignment Verifier"
CONSENSUS_GATE = "Consensus Gate"
LETTER_GATE = "Letter Reconciliation"
SYS = "System"
CONSENSUS_TOLERANCE_PP = 10


@dataclass
class LumenResult:
    intake: Intake
    ledger: EvidenceLedger
    decision: FinalDecision
    letter: str


def _safe_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            return json.loads(m.group(0))
        raise ValueError(f"Expected JSON from model, got: {raw[:200]}")


def _fmt(points: list[Point]) -> str:
    return "\n".join(f"   {i + 1}. {p.claim}  [{', '.join(p.citations)}]" for i, p in enumerate(points))


def _fmt_rebuttal(r: Rebuttal) -> str:
    return "\n".join(
        f"   {i + 1}. ({x.stance.upper()}) {x.claim}  [{', '.join(x.citations)}]" for i, x in enumerate(r.responses)
    )


def _truncate(s: str, n: int = 64) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _usd(n: float) -> str:
    return f"${int(round(n)):,}"


async def _ask(agent: AgentDef, user: str, mock_key: str) -> str:
    return await chat(provider=agent.provider, model=agent.model, system=agent.system, user=user, mock_key=mock_key, json=True)


async def _produce_points(agent: AgentDef, room: Room, user: str, mock_key_base: str, valid_ids: set[str]) -> list[Point]:
    last_violations: list[str] = []
    for attempt in (1, 2):
        prompt = user if attempt == 1 else (
            f"{user}\n\nThe Citation Gate REJECTED your previous answer:\n- "
            + "\n- ".join(last_violations)
            + "\nReturn the same points but make EVERY point cite a valid id."
        )
        parsed = Points.model_validate(_safe_json(await _ask(agent, prompt, f"{mock_key_base}#{attempt}")))
        gate = check_points(parsed.points, valid_ids)
        if gate.ok:
            await room.post(agent.name, agent.color, "message", _fmt(parsed.points))
            return parsed.points
        last_violations = gate.violations
        await room.post(CITE_GATE, 196, "gate", f"REJECTED {agent.name} (attempt {attempt}):\n   - " + "\n   - ".join(gate.violations))
        if attempt == 2:
            await room.post(agent.name, agent.color, "message", _fmt(parsed.points) + "\n   (⚠ unresolved gate violations)")
            return parsed.points
    return []


async def _produce_rebuttal(agent: AgentDef, room: Room, user: str, mock_key_base: str, valid_ids: set[str]) -> Rebuttal:
    last_violations: list[str] = []
    for attempt in (1, 2):
        prompt = user if attempt == 1 else (
            f"{user}\n\nThe Citation Gate REJECTED your previous answer:\n- "
            + "\n- ".join(last_violations)
            + "\nEvery response must cite a valid id."
        )
        parsed = _parse_rebuttal(await _ask(agent, prompt, f"{mock_key_base}#{attempt}"))
        as_points = [Point(claim=r.claim, citations=r.citations) for r in parsed.responses]
        gate = check_points(as_points, valid_ids)
        if gate.ok or attempt == 2:
            await room.post(agent.name, agent.color, "message", _fmt_rebuttal(parsed))
            return parsed
        last_violations = gate.violations
        await room.post(CITE_GATE, 196, "gate", f"REJECTED {agent.name} (attempt {attempt}):\n   - " + "\n   - ".join(gate.violations))
    return Rebuttal(responses=[])


def _parse_decision_or_none(raw: str | BaseException) -> Decision | None:
    if isinstance(raw, BaseException):
        return None
    try:
        return Decision.model_validate(_safe_json(raw))
    except Exception:
        return None


def _parse_rebuttal(raw: str) -> Rebuttal:
    data = _safe_json(raw)
    if "responses" in data:
        return Rebuttal.model_validate(data)
    if "points" in data:
        responses = []
        for point in data["points"]:
            claim = str(point.get("claim", ""))
            responses.append({
                "stance": "concede" if "concede" in claim.lower() else "rebut",
                "claim": claim,
                "citations": point.get("citations", []),
            })
        return Rebuttal.model_validate({"responses": responses})
    return Rebuttal.model_validate(data)


def _parse_intake(raw: str, claim: ClaimInput) -> Intake:
    data = _safe_json(raw)
    try:
        return Intake.model_validate(data)
    except Exception:
        parties = data.get("parties") if isinstance(data.get("parties"), dict) else {}
        return Intake.model_validate(
            {
                "parties": {
                    "insured": str(parties.get("insured") or claim.insured),
                    "otherParty": str(parties.get("otherParty") or claim.otherParty),
                },
                "date": str(data.get("date") or "not in evidence"),
                "location": str(data.get("location") or "not in evidence"),
                "damagesUsd": claim.damagesUsd,
            }
        )


def _parse_letter(raw: str) -> str:
    try:
        parsed = _safe_json(raw)
        letter = parsed.get("letter")
        if isinstance(letter, str) and letter.strip():
            return letter
    except Exception:
        pass

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    match = re.search(r'"letter"\s*:\s*"(?P<letter>[\s\S]*)"\s*\}?$', text)
    if match:
        return match.group("letter").replace(r"\n", "\n").replace(r"\"", '"')
    return text


@dataclass
class ConsensusResult:
    canonical: Decision
    secondary: Decision | None
    consensus_type: str  # agreement | disagreement | single | none
    consensus_delta: float


def _compute_consensus(dec_a: Decision | None, dec_b: Decision | None, a_ok: bool, b_ok: bool) -> ConsensusResult | None:
    a_usable = dec_a is not None and a_ok
    b_usable = dec_b is not None and b_ok
    if a_usable and b_usable:
        delta = abs(dec_a.otherDriverFaultPct - dec_b.otherDriverFaultPct)
        if delta <= CONSENSUS_TOLERANCE_PP:
            avg = round((dec_a.otherDriverFaultPct + dec_b.otherDriverFaultPct) / 2)
            canonical = dec_a.model_copy(update={
                "otherDriverFaultPct": avg,
                "confidence": min(dec_a.confidence, dec_b.confidence),
                "reasoning": f"[Consensus of A and B, delta {delta}pp] {dec_a.reasoning}",
            })
            return ConsensusResult(canonical, dec_b, "agreement", delta)
        return ConsensusResult(dec_a, dec_b, "disagreement", delta)
    if a_usable:
        return ConsensusResult(dec_a.model_copy(update={"confidence": dec_a.confidence * 0.8}), dec_b, "single", 0)
    if b_usable:
        return ConsensusResult(dec_b.model_copy(update={"confidence": dec_b.confidence * 0.8}), dec_a, "single", 0)
    return None


async def _run_verifier(tasks: list[VerifierTask], context: str) -> Alignment | None:
    task_list = "\n".join(
        f"{i + 1}. [pointIndex={t.pointIndex} source={t.pointSource}] claim=\"{t.claim}\"  cites=[{t.citationId}]"
        for i, t in enumerate(tasks)
    )
    prompt = f"{context}\n\nVERIFY THESE CITED CLAIMS — for each row return one alignment result, echoing pointIndex, pointSource, claim, citationId:\n{task_list}"
    for attempt in (1, 2):
        try:
            raw = await _ask(AGENTS["verifier"], prompt, "verifier" if attempt == 1 else "verifier#retry")
            return Alignment.model_validate(_safe_json(raw))
        except Exception:
            if attempt == 2:
                return None
    return None


def _reconcile_letter(letter: str, decision: FinalDecision) -> list[str]:
    issues: list[str] = []
    pct = f"{decision.otherDriverFaultPct}%"
    pct_int = f"{int(decision.otherDriverFaultPct)}%"
    if pct not in letter and pct_int not in letter:
        issues.append(f"letter does not mention the {pct_int} fault assessment")
    if _usd(decision.recoveryUsd) not in letter and f"${decision.recoveryUsd}" not in letter:
        issues.append(f"letter does not mention the recovery amount {_usd(decision.recoveryUsd)}")
    return issues


async def run_lumen(claim: ClaimInput, statutes: list[Statute], room: Room, ledger: EvidenceLedger | None = None) -> LumenResult:
    # Select this case's canned outputs for mock mode (no-op in live mode).
    set_mock_case(claim.caseId)
    docs_text = "\n\n".join(f"### {d.name} ({d.kind})\n{d.text}" for d in claim.documents)

    await room.post(SYS, 250, "system", f"Claim {claim.caseId} opened. Jurisdiction {claim.jurisdiction}. Documented damages {_usd(claim.damagesUsd)}.")

    # 1) Intake
    intake_prompt = (
        "CASE METADATA:\n"
        f"caseId: {claim.caseId}\n"
        f"insured: {claim.insured}\n"
        f"otherParty: {claim.otherParty}\n"
        f"jurisdiction: {claim.jurisdiction}\n"
        f"documented damages usd: {claim.damagesUsd}\n\n"
        f"CLAIM DOCUMENTS:\n{docs_text}"
    )
    intake = _parse_intake(await _ask(AGENTS["intake"], intake_prompt, "intake"), claim)
    await room.post(AGENTS["intake"].name, AGENTS["intake"].color, "message",
                    f"{intake.parties.insured} vs {intake.parties.otherParty} | {intake.date} | {intake.location} | damages {_usd(intake.damagesUsd)}")

    # 2) Evidence ledger — three sources, in priority order:
    #    (a) a ledger passed in (real cases: loaded from the graph the ledger lane
    #        already persisted to nodes/edges — we run the debate on it, not rebuild),
    #    (b) the ledger lane building the typed graph from the claim now, or
    #    (c) the inline evidence agent when the lane is disabled.
    if ledger is not None:
        await room.post(AGENTS["evidence"].name, AGENTS["evidence"].color, "message",
                        f"Evidence ledger loaded from the persisted graph — {len(ledger.facts)} facts:\n" +
                        "\n".join(f"   [{f.id}] {f.statement}  ({f.source})" for f in ledger.facts))
    elif USE_LEDGER_LANE:
        graph = await build_ledger(claim, statutes)
        ledger = graph_to_evidence_ledger(graph)
        await room.post(AGENTS["evidence"].name, AGENTS["evidence"].color, "message",
                        f"Evidence-ledger graph built — {len(graph.nodes)} nodes, {len(graph.edges)} edges → {len(ledger.facts)} facts:\n" +
                        "\n".join(f"   [{f.id}] {f.statement}  ({f.source})" for f in ledger.facts))
    else:
        ledger = EvidenceLedger.model_validate(_safe_json(await _ask(AGENTS["evidence"], f"Build the evidence ledger from:\n{docs_text}", "ledger")))
        await room.post(AGENTS["evidence"].name, AGENTS["evidence"].color, "message",
                        f"Evidence Ledger — {len(ledger.facts)} facts:\n" + "\n".join(f"   [{f.id}] {f.statement}  ({f.source})" for f in ledger.facts))

    # 2b) Fact Gate
    fact_check = check_ledger_anchoring(ledger, claim)
    if fact_check.ok:
        await room.post(FACT_GATE, 46, "gate", f"All {len(ledger.facts)} facts anchored to verbatim source quotes.")
    else:
        await room.post(FACT_GATE, 196, "gate", f"REJECTED {len(fact_check.violations)} fact(s):\n   - " + "\n   - ".join(fact_check.violations))

    await room.post(SYS, 250, "handoff", "Ledger locked. RULE NOW ACTIVE: every argument must cite a fact id or statute id, or the Citation Gate rejects it.")

    valid_ids = valid_citation_ids(ledger, statutes)
    context = f"EVIDENCE LEDGER:\n{render_ledger(ledger)}\n\nSTATUTES:\n{render_statutes(statutes)}"

    # 3) Advocate opens (independent)
    advocate_points = await _produce_points(AGENTS["advocate"], room, f"{context}\n\nMake your strongest opening case that the other driver is at fault.", "advocate_position", valid_ids)
    # 4) Opposing independent theory
    opposing_theory = await _produce_points(AGENTS["opposing"], room, f"{context}\n\nIndependently build your own theory of how OUR insured shares fault. Do not respond to anyone yet.", "opposing_independent", valid_ids)
    # 5) Opposing attacks advocate
    attack_points = await _produce_points(AGENTS["opposing"], room, f"{context}\n\nThe Advocate argued:\n{_fmt(advocate_points)}\n\nAttack each of these points.", "opposing_attack", valid_ids)
    # 6) Advocate rebuts/concedes
    rebuttal = await _produce_rebuttal(AGENTS["advocate"], room, f"{context}\n\nThe opposing carrier attacked:\n{_fmt(attack_points)}\n\nRebut or concede each. Concede ONLY with a citation.", "advocate_rebuttal", valid_ids)

    await room.post(SYS, 250, "handoff", "Debate closed — no consensus round. Neutral Adjudicator now decides from the transcript.")

    # 7) Dual adjudicator (independent, different model families, in parallel)
    transcript = (
        f"Advocate opening:\n{_fmt(advocate_points)}\n\nOpposing independent theory:\n{_fmt(opposing_theory)}\n\n"
        f"Opposing attacks:\n{_fmt(attack_points)}\n\nAdvocate rebuttal:\n{_fmt_rebuttal(rebuttal)}"
    )
    adj_prompt = f"{context}\n\nDEBATE TRANSCRIPT:\n{transcript}\n\nDecide the other driver's fault %."
    raw_a, raw_b = await asyncio.gather(
        _ask(AGENTS["adjudicator"], adj_prompt, "adjudicator"),
        _ask(AGENTS["adjudicator_b"], adj_prompt, "adjudicator_b"),
        return_exceptions=True,
    )
    dec_a = _parse_decision_or_none(raw_a)
    dec_b = _parse_decision_or_none(raw_b)

    # 7b) Math-gate each adjudicator
    math_a = check_adjudicator_math(dec_a) if dec_a else None
    math_b = check_adjudicator_math(dec_b) if dec_b else None

    if dec_a:
        await room.post(AGENTS["adjudicator"].name, AGENTS["adjudicator"].color, "decision",
                        f"Other driver {dec_a.otherDriverFaultPct}% at fault (confidence {dec_a.confidence}).\n   Basis: {dec_a.reasoning}")
        if math_a and math_a.ok:
            await room.post(MATH_GATE, 46, "gate", f"A ✓ table implies {math_a.computed_pct}%, stated {math_a.stated_pct}% (delta {math_a.delta}pp).")
        elif math_a:
            await room.post(MATH_GATE, 196, "gate", f"A REJECTED — {math_a.violation}")
    else:
        await room.post(MATH_GATE, 196, "gate", "Adjudicator A failed to return a parseable decision.")
    if dec_b:
        await room.post(AGENTS["adjudicator_b"].name, AGENTS["adjudicator_b"].color, "decision",
                        f"Other driver {dec_b.otherDriverFaultPct}% at fault (confidence {dec_b.confidence}).\n   Basis: {dec_b.reasoning}")
        if math_b and math_b.ok:
            await room.post(MATH_GATE, 46, "gate", f"B ✓ table implies {math_b.computed_pct}%, stated {math_b.stated_pct}% (delta {math_b.delta}pp).")
        elif math_b:
            await room.post(MATH_GATE, 196, "gate", f"B REJECTED — {math_b.violation}")
    else:
        await room.post(MATH_GATE, 196, "gate", "Adjudicator B failed to return a parseable decision.")

    # 7c) Consensus
    consensus = _compute_consensus(dec_a, dec_b, math_a.ok if math_a else False, math_b.ok if math_b else False)
    if consensus is None:
        raise RuntimeError("Both adjudicators failed; cannot proceed without a decision.")
    canonical = consensus.canonical

    if consensus.consensus_type == "agreement":
        await room.post(CONSENSUS_GATE, 46, "gate",
                        f"Adjudicators converged — A={dec_a.otherDriverFaultPct}%, B={dec_b.otherDriverFaultPct}% (delta {consensus.consensus_delta}pp ≤ {CONSENSUS_TOLERANCE_PP}pp). Using {canonical.otherDriverFaultPct}%.")
    elif consensus.consensus_type == "disagreement":
        await room.post(CONSENSUS_GATE, 196, "gate",
                        f"DISAGREEMENT — A={dec_a.otherDriverFaultPct}%, B={dec_b.otherDriverFaultPct}% (delta {consensus.consensus_delta}pp > {CONSENSUS_TOLERANCE_PP}pp). Forcing human review.")
    elif consensus.consensus_type == "single":
        which = "A" if (dec_a and math_a and math_a.ok) else "B"
        await room.post(CONSENSUS_GATE, 214, "gate", f"Only Adjudicator {which} passed math gate; using {canonical.otherDriverFaultPct}% with reduced confidence.")

    # 7d) Source-Alignment Verifier
    verifier_tasks = collect_verifier_tasks(advocate_points, opposing_theory, attack_points, rebuttal)
    verifier_contradicted = 0
    if not verifier_tasks:
        await room.post(ALIGN_GATE, 214, "gate", "No fact citations in transcript — nothing to align.")
    else:
        verifier_result = await _run_verifier(verifier_tasks, context)
        if verifier_result:
            s = summarize_alignment(verifier_result.results)
            verifier_contradicted = s.contradicted
            head = f"{s.supported}/{s.total} supported, {s.overreach} overreach, {s.contradicted} contradicted."
            if s.contradicted == 0 and s.overreach == 0:
                await room.post(ALIGN_GATE, 46, "gate", head)
            elif s.contradicted == 0:
                lines = "\n".join(f"   - overreach [{r.citationId}]: \"{_truncate(r.claim)}\" — {r.reasoning}" for r in s.overreach_details)
                await room.post(ALIGN_GATE, 214, "gate", f"{head}\n{lines}")
            else:
                lines = "\n".join(f"   - CONTRADICTED [{r.citationId}]: \"{_truncate(r.claim)}\" — {r.reasoning}" for r in s.contradicted_details)
                await room.post(ALIGN_GATE, 196, "gate", f"{head}\n{lines}")
        else:
            await room.post(ALIGN_GATE, 214, "gate", "Verifier unavailable; skipping semantic alignment check.")

    # escalation
    recovery_usd = round((claim.damagesUsd * canonical.otherDriverFaultPct) / 100)
    near_5050 = abs(50 - canonical.otherDriverFaultPct) < 10
    reasons: list[str] = []
    if recovery_usd >= ESCALATE_USD:
        reasons.append(f"recovery {_usd(recovery_usd)} ≥ {_usd(ESCALATE_USD)} threshold")
    if canonical.confidence < 0.6:
        reasons.append(f"confidence {canonical.confidence} below 0.60")
    if near_5050:
        reasons.append(f"fault split near 50/50 ({canonical.otherDriverFaultPct}%)")
    if math_a and not math_a.ok:
        reasons.append(f"Adjudicator A math gate violation ({math_a.delta}pp)")
    if math_b and not math_b.ok:
        reasons.append(f"Adjudicator B math gate violation ({math_b.delta}pp)")
    if consensus.consensus_type == "disagreement":
        reasons.append(f"adjudicator disagreement ({consensus.consensus_delta}pp > {CONSENSUS_TOLERANCE_PP}pp)")
    if consensus.consensus_type == "single":
        reasons.append("only one adjudicator usable")
    if verifier_contradicted > 0:
        reasons.append(f"source-alignment verifier flagged {verifier_contradicted} contradicted claim(s)")

    # Viability: is pursuing this recovery worth the cost? If not, recommend DECLINE
    # (close the file) — proving Lumen knows when NOT to chase, not just how to win.
    pursue = recovery_usd >= PURSUE_MIN_USD and canonical.otherDriverFaultPct >= PURSUE_MIN_FAULT_PCT
    decline_reason = None
    if not pursue:
        bits: list[str] = []
        if recovery_usd < PURSUE_MIN_USD:
            bits.append(f"recovery {_usd(recovery_usd)} below the {_usd(PURSUE_MIN_USD)} pursuit threshold")
        if canonical.otherDriverFaultPct < PURSUE_MIN_FAULT_PCT:
            bits.append(f"other-driver fault {canonical.otherDriverFaultPct}% below the {int(PURSUE_MIN_FAULT_PCT)}% viability floor")
        decline_reason = "; ".join(bits)
        outcome = "decline"
    elif reasons:
        outcome = "escalate"
    else:
        outcome = "pursue"

    final = FinalDecision(
        **canonical.model_dump(),
        recoveryUsd=recovery_usd,
        escalate=len(reasons) > 0,
        escalateReasons=reasons,
        nearFiftyFifty=near_5050,
        secondary=consensus.secondary,
        consensus=consensus.consensus_type,
        consensusDelta=consensus.consensus_delta,
        outcome=outcome,
        pursue=pursue,
        declineReason=decline_reason,
    )

    if outcome == "decline":
        await room.post(SYS, 196, "decision", f"RECOMMENDATION: DO NOT PURSUE — {decline_reason}. Recommend closing the file.")
    elif final.escalate:
        await room.post(SYS, 196, "decision", f"ESCALATED TO HUMAN ADJUSTER — {'; '.join(reasons)}. Awaiting Approve/Reject.")

    # 8) Demand letter
    letter = _parse_letter(await _ask(AGENTS["drafter"], f"{context}\n\nDecision: other driver {canonical.otherDriverFaultPct}% at fault; recovery ${recovery_usd}. Write the demand letter.", "drafter"))
    await room.post(AGENTS["drafter"].name, AGENTS["drafter"].color, "message", "Drafted the formal subrogation demand letter (full text in output).")

    # 8b) Letter reconciliation
    issues = _reconcile_letter(letter, final)
    if not issues:
        await room.post(LETTER_GATE, 46, "gate", f"Letter matches the adjudicator's {canonical.otherDriverFaultPct}% / {_usd(recovery_usd)}.")
    else:
        await room.post(LETTER_GATE, 196, "gate", "FAILED:\n   - " + "\n   - ".join(issues))

    return LumenResult(intake=intake, ledger=ledger, decision=final, letter=letter)
