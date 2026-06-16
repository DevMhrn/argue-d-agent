"""Incremental live Band connection probe. Run:  .venv/bin/python -m lumen_py.probe_band

Validates, step by step: auth → create room → add a participant → send a message.
Easier to debug than the full 8-agent pipeline.
"""
from __future__ import annotations
import asyncio

from thenvoi_rest import AsyncRestClient
from band import AgentTools

from .room import BandConfig


async def main() -> None:
    cfg = BandConfig()
    intake = cfg.agents["intake"]
    evidence = cfg.agents["evidence"]

    rest = AsyncRestClient(base_url=cfg.rest_url, api_key=intake.api_key)

    print("1) AUTH — get_agent_me() as intake-parser…")
    me = await rest.agent_api_identity.get_agent_me()
    print("   ✓ authenticated:", getattr(getattr(me, "data", me), "name", me))

    print("2) CREATE ROOM…")
    tools0 = AgentTools(room_id="", rest=rest)
    room_id = await tools0.create_chatroom()
    print("   ✓ room_id:", room_id)

    print("3) ADD PARTICIPANT — evidence-aggregator (by agent_id)…")
    tools = AgentTools(room_id=room_id, rest=rest)
    try:
        res = await tools.add_participant(evidence.agent_id, "member")
        print("   ✓ added:", res)
    except Exception as e:
        print("   ⚠ add_participant error:", repr(e))

    print("4) GET PARTICIPANTS (inspect handle shape)…")
    parts = await tools.get_participants()
    for p in parts:
        print("   participant:", {k: getattr(p, k, None) for k in ("id", "name", "handle", "username", "type")})

    print("5) SEND MESSAGE with a mention…")
    # Try @-prefixed handle first (per docs), then bare handle as fallback.
    for mention in ["@gowthamyadav023/evidence-aggregator", "gowthamyadav023/evidence-aggregator"]:
        try:
            msg = await tools.send_message(
                f"Lumen connection test — intake-parser online, handing off. (mention tried: {mention})",
                mentions=[mention],
            )
            print(f"   ✓ sent with mention '{mention}':", getattr(msg, "id", msg))
            break
        except Exception as e:
            print(f"   ✗ mention '{mention}' failed:", repr(e)[:160])

    print("\nALL GOOD. Room:", room_id)


if __name__ == "__main__":
    asyncio.run(main())
