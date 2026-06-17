"""Model provider client + mock switch (mirrors src/providers.ts).

Both AI/ML API and Featherless are OpenAI-compatible, so the live path is one
AsyncOpenAI client per provider. Mock mode returns deterministic canned content
so the whole pipeline runs with no keys and no network.
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
        "temperature": temperature,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if json:
        kwargs["response_format"] = {"type": "json_object"}
    res = await client.chat.completions.create(**kwargs)  # type: ignore[attr-defined]
    return res.choices[0].message.content or ""
