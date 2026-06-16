"""Diagnostic: can NON-creator agents post to a room created by the system agent?
Run: .venv/bin/python -m lumen_py.probe_band2
"""
from __future__ import annotations
import asyncio

from thenvoi_rest import AsyncRestClient
from band import AgentTools

from .room import BandConfig


async def try_send(label: str, tools: AgentTools, content: str, mention: str | None) -> None:
    try:
        msg = await tools.send_message(content, mentions=[mention] if mention else None)
        print(f"   ✓ {label} posted OK: {getattr(msg, 'id', msg)}")
    except Exception as e:
        print(f"   ✗ {label} FAILED: {repr(e)[:200]}")


async def main() -> None:
    cfg = BandConfig()
    adj = cfg.agents["adjudicator"]
    adv = cfg.agents["advocate"]
    intake = cfg.agents["intake"]

    adj_rest = AsyncRestClient(base_url=cfg.rest_url, api_key=adj.api_key)
    adv_rest = AsyncRestClient(base_url=cfg.rest_url, api_key=adv.api_key)
    intake_rest = AsyncRestClient(base_url=cfg.rest_url, api_key=intake.api_key)

    print("Create room as Adjudicator A (system agent)…")
    room_id = await AgentTools(room_id="", rest=adj_rest).create_chatroom()
    print("   room_id:", room_id)

    adj_tools = AgentTools(room_id=room_id, rest=adj_rest)
    print("Add advocate + intake as participants (by agent_id)…")
    for name, creds in [("advocate", adv), ("intake", intake)]:
        try:
            r = await adj_tools.add_participant(creds.agent_id, "member")
            print(f"   ✓ added {name}: {r}")
        except Exception as e:
            print(f"   ✗ add {name} FAILED: {repr(e)[:160]}")

    # resolve handles
    parts = await adj_tools.get_participants()
    by_id = {getattr(p, "id", None): getattr(p, "handle", None) for p in parts}
    print("   participants:", by_id)
    adj_h = "@" + (by_id.get(adj.agent_id) or "")
    adv_h = "@" + (by_id.get(adv.agent_id) or "")

    print("Send AS adjudicator (creator) mentioning advocate…")
    await try_send("adjudicator", adj_tools, "Adjudicator online.", adv_h)

    print("Send AS advocate (added participant) mentioning adjudicator…")
    adv_tools = AgentTools(room_id=room_id, rest=adv_rest)
    await try_send("advocate", adv_tools, "Advocate online.", adj_h)

    print("Send AS intake (added participant) mentioning adjudicator…")
    intake_tools = AgentTools(room_id=room_id, rest=intake_rest)
    await try_send("intake", intake_tools, "Intake online.", adj_h)

    print("\n--- FIX TEST: hydrate advocate's participant cache, then retry ---")
    adv_parts = await adv_tools.get_participants()
    print("   advocate sees participants:", [getattr(p, "handle", None) for p in adv_parts])
    await try_send("advocate (after hydrate)", adv_tools, "Advocate online, take 2.", adj_h)

    print("\nRoom to inspect in dashboard:", room_id)


if __name__ == "__main__":
    asyncio.run(main())
