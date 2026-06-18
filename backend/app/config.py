"""Provider, model, and threshold configuration (mirrors src/config.ts)."""
from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load env from both backend/.env and the repo-root .env (whichever you populated),
# regardless of where Python is invoked from. backend/app/config.py → parent.parent
# is backend/; one level up is the repo root. First value wins (override=False).
_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(dotenv_path=_BACKEND_DIR / ".env")
load_dotenv(dotenv_path=_BACKEND_DIR.parent / ".env")


@dataclass(frozen=True)
class ProviderConfig:
    base_url: str
    api_key: str | None
    env_key: str
    label: str


# Three direct providers, all reached through the OpenAI-compatible chat-completions
# surface (one client, different base_url + key per provider). Three different model
# FAMILIES — Anthropic, Google, OpenAI — which is what makes the cross-family debate
# and dual-adjudicator consensus genuinely independent.
PROVIDERS: dict[str, ProviderConfig] = {
    "anthropic": ProviderConfig(
        base_url=os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1/"),
        api_key=os.getenv("ANTHROPIC_API_KEY") or None,
        env_key="ANTHROPIC_API_KEY",
        label="Anthropic (Claude)",
    ),
    "gemini": ProviderConfig(
        base_url=os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"),
        api_key=os.getenv("GEMINI_API_KEY") or None,
        env_key="GEMINI_API_KEY",
        label="Google (Gemini)",
    ),
    "openai": ProviderConfig(
        base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        api_key=os.getenv("OPENAI_API_KEY") or None,
        env_key="OPENAI_API_KEY",
        label="OpenAI (GPT)",
    ),
}

# Default model id per agent. Confirm exact ids in each provider's catalog before
# running live (override via env). Irrelevant in mock mode.
MODELS = {
    "intake": os.getenv("MODEL_INTAKE", "gpt-4o-mini"),
    "evidence": os.getenv("MODEL_EVIDENCE", "gpt-5.4-mini"),
    "advocate": os.getenv("MODEL_ADVOCATE", "claude-opus-4-8"),
    "opposing": os.getenv("MODEL_OPPOSING", "gpt-4o"),
    "adjudicator": os.getenv("MODEL_ADJUDICATOR", "claude-opus-4-8"),
    "adjudicator_b": os.getenv("MODEL_ADJUDICATOR_B", "gpt-4o"),
    "verifier": os.getenv("MODEL_VERIFIER", "claude-sonnet-4-6"),
    "drafter": os.getenv("MODEL_DRAFTER", "claude-sonnet-4-6"),
}

ESCALATE_USD = float(os.getenv("ESCALATE_USD", "25000"))

# Viability thresholds — below these, pursuing the recovery is not worth the cost,
# so Lumen recommends DECLINING (closing the file) instead of pursuing.
PURSUE_MIN_USD = float(os.getenv("PURSUE_MIN_USD", "2500"))
PURSUE_MIN_FAULT_PCT = float(os.getenv("PURSUE_MIN_FAULT_PCT", "25"))

# Build the evidence ledger from the graph lane (backend/ledger) instead of the
# inline evidence agent. Set LUMEN_USE_LEDGER=0 to fall back to the inline agent.
USE_LEDGER_LANE = os.getenv("LUMEN_USE_LEDGER", "1") != "0"
