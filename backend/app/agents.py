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


# Provider assignment is deliberate: the Advocate (Claude) debates the Opposing
# red team (GPT), and Adjudicator A (Claude) is checked against Adjudicator B
# (Gemini) — different model families, so the consensus check is truly independent.
AGENTS: dict[str, AgentDef] = {
    "intake": AgentDef("intake", "Intake Parser", "Extract the incident facts from the claim", "openai", MODELS["intake"], P.INTAKE_PROMPT, 245),
    "evidence": AgentDef("evidence", "Evidence Aggregator", "Build the grounded Evidence Ledger", "gemini", MODELS["evidence"], P.EVIDENCE_PROMPT, 109),
    "advocate": AgentDef("advocate", "Liability Advocate", "Argue our insured is owed recovery", "anthropic", MODELS["advocate"], P.ADVOCATE_PROMPT, 39),
    "opposing": AgentDef("opposing", "Opposing-Carrier Red Team", "Attack our case like the other insurer", "openai", MODELS["opposing"], P.OPPOSING_PROMPT, 203),
    "adjudicator": AgentDef("adjudicator", "Adjudicator A", "Neutrally set fault % and recovery (Claude)", "anthropic", MODELS["adjudicator"], P.ADJUDICATOR_PROMPT, 178),
    "adjudicator_b": AgentDef("adjudicator_b", "Adjudicator B", "Independent adjudicator on a different family (Gemini)", "gemini", MODELS["adjudicator_b"], P.ADJUDICATOR_PROMPT, 214),
    "verifier": AgentDef("verifier", "Source-Alignment Verifier", "Audit every cited claim against its source fact", "gemini", MODELS["verifier"], P.VERIFIER_PROMPT, 105),
    "drafter": AgentDef("drafter", "Demand Letter Drafter", "Write the formal demand letter", "anthropic", MODELS["drafter"], P.DRAFTER_PROMPT, 141),
}
