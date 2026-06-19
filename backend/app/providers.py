"""Model provider client + mock switch.

Active defaults use OpenAI + Anthropic through OpenAI-compatible chat endpoints.
Gemini remains in the provider registry only for explicit reassignment. Mock mode
returns deterministic canned content so the whole pipeline runs with no keys/network.
"""
from __future__ import annotations
import asyncio
import os

from .config import PROVIDERS
from .mock_responses import mock_chat


def is_mock() -> bool:
    flag = os.getenv("LUMEN_MOCK")
    if flag == "1":
        return True
    if flag == "0":
        return False
    return not any(p.api_key for p in PROVIDERS.values())


_clients: dict[str, object] = {}


def _client_for(provider: str):
    if provider not in _clients:
        cfg = PROVIDERS[provider]
        if not cfg.api_key:
            raise RuntimeError(
                f"Missing {cfg.env_key}. Set it in .env, or run in mock mode (leave keys blank)."
            )
        from openai import AsyncOpenAI

        _clients[provider] = AsyncOpenAI(base_url=cfg.base_url, api_key=cfg.api_key)
    return _clients[provider]


async def chat(
    *,
    provider: str,
    model: str,
    system: str,
    user: str,
    mock_key: str,
    temperature: float = 0.2,
    json: bool = True,
) -> str:
    if is_mock():
        # Optional pacing so the live web room is watchable.
        delay = float(os.getenv("LUMEN_MOCK_DELAY_MS", "0")) / 1000.0
        if delay > 0:
            await asyncio.sleep(delay)
        return mock_chat(mock_key)

    client = _client_for(provider)
    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if provider != "anthropic":
        kwargs["temperature"] = temperature
    if json and provider != "anthropic":
        kwargs["response_format"] = {"type": "json_object"}
    res = await client.chat.completions.create(**kwargs)  # type: ignore[attr-defined]
    return res.choices[0].message.content or ""
