"""Provider, model, and threshold configuration (mirrors src/config.ts)."""
from __future__ import annotations
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class ProviderConfig:
    base_url: str
    api_key: str | None
    env_key: str
    label: str


PROVIDERS: dict[str, ProviderConfig] = {
    "aimlapi": ProviderConfig(
        base_url=os.getenv("AIMLAPI_BASE_URL", "https://api.aimlapi.com/v1"),
        api_key=os.getenv("AIMLAPI_API_KEY") or None,
        env_key="AIMLAPI_API_KEY",
        label="AI/ML API (frontier)",
    ),
    "featherless": ProviderConfig(
        base_url=os.getenv("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"),
        api_key=os.getenv("FEATHERLESS_API_KEY") or None,
        env_key="FEATHERLESS_API_KEY",
        label="Featherless (open-source)",
    ),
}

# Default model id per agent. PLACEHOLDERS — confirm exact ids in each provider's
# catalog before running live. Irrelevant in mock mode.
MODELS = {
    "intake": os.getenv("MODEL_INTAKE", "meta-llama/Meta-Llama-3.1-8B-Instruct"),
    "evidence": os.getenv("MODEL_EVIDENCE", "Qwen/Qwen2.5-72B-Instruct"),
    "advocate": os.getenv("MODEL_ADVOCATE", "claude-3-opus"),
    "opposing": os.getenv("MODEL_OPPOSING", "gpt-4o"),
    "adjudicator": os.getenv("MODEL_ADJUDICATOR", "claude-3-5-sonnet"),
    "adjudicator_b": os.getenv("MODEL_ADJUDICATOR_B", "meta-llama/Meta-Llama-3.1-70B-Instruct"),
    "verifier": os.getenv("MODEL_VERIFIER", "Qwen/Qwen2.5-72B-Instruct"),
    "drafter": os.getenv("MODEL_DRAFTER", "claude-3-5-sonnet"),
}

ESCALATE_USD = float(os.getenv("ESCALATE_USD", "25000"))

# Viability thresholds — below these, pursuing the recovery is not worth the cost,
# so Lumen recommends DECLINING (closing the file) instead of pursuing.
PURSUE_MIN_USD = float(os.getenv("PURSUE_MIN_USD", "2500"))
PURSUE_MIN_FAULT_PCT = float(os.getenv("PURSUE_MIN_FAULT_PCT", "25"))
