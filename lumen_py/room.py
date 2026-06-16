"""The coordination room.

`Room` is the interface the pipeline talks to. `LocalRoom` is the in-process
implementation (runs today, no Band needed). `BandRoom` posts every message into
a REAL Band room through the official SDK so the coordination genuinely happens on
Band — agents are real Band participants, handoffs are real @mention messages, and
the transcript is the system of record.

SWAP: the pipeline calls `await room.post(...)`. LocalRoom just records + streams to
the UI. BandRoom does that AND sends to Band. Activate by filling band_config.yaml.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, asdict
from typing import Callable, Optional

import yaml

from .agents import AGENTS


@dataclass
class Posting:
    seq: int
    agent: str
    color: int
    kind: str  # message | handoff | gate | decision | system
    content: str

    def to_dict(self) -> dict:
        return asdict(self)


PostCallback = Callable[[Posting], None]


class Room:
    def __init__(self, case_id: str, on_post: Optional[PostCallback] = None):
        self.case_id = case_id
        self._on_post = on_post
        self.postings: list[Posting] = []
        self._seq = 0

    async def post(self, agent: str, color: int, kind: str, content: str) -> Posting:
        self._seq += 1
        p = Posting(self._seq, agent, color, kind, content)
        self.postings.append(p)
        if self._on_post:
            self._on_post(p)
        await self._deliver(p)
        return p

    async def _deliver(self, p: Posting) -> None:  # overridden by BandRoom
        return None


class LocalRoom(Room):
    """In-process room — what mock mode and the offline demo use."""


# --------------------------------------------------------------------------- Band
# Display-name → agent key, so a Posting from "Liability Advocate" routes to the
# right Band agent identity. Non-agent voices (gates/system) use the system agent.
_NAME_TO_KEY = {a.name: key for key, a in AGENTS.items()}


@dataclass
class BandAgentCreds:
    agent_id: str
    api_key: str


class BandConfig:
    """Loads band_config.yaml: per-agent creds, optional pre-created room id, URLs."""

    def __init__(self, path: str = "band_config.yaml"):
        with open(path, "r") as f:
            raw = yaml.safe_load(f) or {}
        self.rest_url: str = raw.get("rest_url", "https://app.band.ai")
        self.ws_url: str = raw.get("ws_url", "wss://app.band.ai/api/v1/socket/websocket")
        self.room_id: Optional[str] = raw.get("room_id")
        self.system_agent_key: str = raw.get("system_agent_key", "adjudicator")
        self.agents: dict[str, BandAgentCreds] = {
            key: BandAgentCreds(**creds) for key, creds in (raw.get("agents") or {}).items()
        }


class BandRoom(Room):
    """Posts every message into a real Band room via the official band-sdk.

    Each of our agents is a distinct Band agent (its own AgentTools, authenticated
    with its own api_key). Handoffs become real @mention messages in the room.
    """

    def __init__(self, case_id: str, cfg: BandConfig, on_post: Optional[PostCallback] = None):
        super().__init__(case_id, on_post)
        self.cfg = cfg
        self._tools: dict[str, object] = {}  # agent key -> AgentTools
        self._room_id: Optional[str] = cfg.room_id
        self._ready = False

    async def ensure_ready(self) -> None:
        """Create REST clients + AgentTools per agent, and a room if none given."""
        if self._ready:
            return
        from thenvoi_rest import AsyncRestClient
        from band import AgentTools

        rests: dict[str, AsyncRestClient] = {}
        for key, creds in self.cfg.agents.items():
            rests[key] = AsyncRestClient(base_url=self.cfg.rest_url, api_key=creds.api_key)

        # Create the room with the system agent if one wasn't pre-created.
        sys_key = self.cfg.system_agent_key
        if not self._room_id:
            sys_tools_bootstrap = AgentTools(room_id="", rest=rests[sys_key])  # type: ignore[arg-type]
            self._room_id = await sys_tools_bootstrap.create_chatroom()

        # Bind per-agent tools to the room and add everyone as a participant.
        for key, rest in rests.items():
            self._tools[key] = AgentTools(room_id=self._room_id, rest=rest)
        sys_tools = self._tools[sys_key]
        for key, creds in self.cfg.agents.items():
            if key == sys_key:
                continue
            try:
                await sys_tools.add_participant(creds.agent_id, "member")  # type: ignore[attr-defined]
            except Exception:
                pass  # already a participant / idempotent
        self._ready = True

    async def _deliver(self, p: Posting) -> None:
        await self.ensure_ready()
        key = _NAME_TO_KEY.get(p.agent, self.cfg.system_agent_key)
        tools = self._tools.get(key) or self._tools.get(self.cfg.system_agent_key)
        if tools is None:
            return
        # Tag the next-handoff naturally: gate/system lines are spoken by the system
        # agent; agent messages are spoken as themselves.
        prefix = "" if p.kind == "message" else f"[{p.agent}] "
        try:
            await tools.send_message(prefix + p.content)  # type: ignore[attr-defined]
        except Exception:
            pass  # never let a transport hiccup break the local run/UI


def make_room(case_id: str, on_post: Optional[PostCallback] = None) -> Room:
    """Factory: BandRoom when band_config.yaml exists and BAND is on; else LocalRoom."""
    use_band = os.getenv("LUMEN_BAND") == "1" and os.path.exists("band_config.yaml")
    if use_band:
        return BandRoom(case_id, BandConfig(), on_post)
    return LocalRoom(case_id, on_post)
