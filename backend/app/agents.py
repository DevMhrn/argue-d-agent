"""Agent definitions (ported from src/agents.ts). Each agent maps to a Band agent
identity (agent_id + api_key) loaded from band_config when running on real Band.
"""
from __future__ import annotations
from dataclasses import dataclass

from . import prompts as P
from .config import MODELS


@dataclass(frozen=True)
class AgentDef:
    key: str
    name: str
    role: str
    provider: str
    model: str
    system: str
    color: int  # ANSI 256 for the CLI; the web UI maps by name


AGENTS: dict[str, AgentDef] = {
    "intake": AgentDef("intake", "Intake Parser", "Extract the incident facts from the claim", "featherless", MODELS["intake"], P.INTAKE_PROMPT, 245),
    "evidence": AgentDef("evidence", "Evidence Aggregator", "Build the grounded Evidence Ledger", "featherless", MODELS["evidence"], P.EVIDENCE_PROMPT, 109),
    "advocate": AgentDef("advocate", "Liability Advocate", "Argue our insured is owed recovery", "aimlapi", MODELS["advocate"], P.ADVOCATE_PROMPT, 39),
    "opposing": AgentDef("opposing", "Opposing-Carrier Red Team", "Attack our case like the other insurer", "aimlapi", MODELS["opposing"], P.OPPOSING_PROMPT, 203),
    "adjudicator": AgentDef("adjudicator", "Adjudicator A", "Neutrally set fault % and recovery (frontier)", "aimlapi", MODELS["adjudicator"], P.ADJUDICATOR_PROMPT, 178),
    "adjudicator_b": AgentDef("adjudicator_b", "Adjudicator B", "Second independent adjudicator (OSS)", "featherless", MODELS["adjudicator_b"], P.ADJUDICATOR_PROMPT, 214),
    "verifier": AgentDef("verifier", "Source-Alignment Verifier", "Audit every cited claim against its source fact", "featherless", MODELS["verifier"], P.VERIFIER_PROMPT, 105),
    "drafter": AgentDef("drafter", "Demand Letter Drafter", "Write the formal demand letter", "aimlapi", MODELS["drafter"], P.DRAFTER_PROMPT, 141),
}
