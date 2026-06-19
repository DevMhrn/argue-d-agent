"""The coordination room.

`Room` is the interface the pipeline talks to. `LocalRoom` is the in-process
implementation (runs today, no Band needed). `BandRoom` mirrors real-agent
messages into Band through the SDK. The database transcript remains Lumen's
audit source of truth; Band is the live coordination surface.

Persistence: an optional `persist` async callback (PostingSink) writes each
Posting to the `transcript` table BEFORE the SSE callback fires. That ordering
means a frontend reloading the page can replay the same sequence the live SSE
saw - no consistency gap. Persistence failures raise; the orchestrator catches
them and marks the run status='failed' so we never end up with an ambiguous
half-persisted run.

SWAP: the pipeline calls `await room.post(...)`. LocalRoom just records + streams to
the UI. BandRoom does that AND sends to Band. Activate by filling band_config.yaml.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, asdict, field
from typing import Awaitable, Callable, Optional

import yaml

from .agents import AGENTS


@dataclass
class Posting:
    seq: int
    agent: str
    color: int
    kind: str  # message | handoff | gate | decision | system
    content: str
    metadata: dict[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


PostCallback = Callable[[Posting], None]
PostingSink = Callable[[Posting], Awaitable[None]]


class Room:
    def __init__(
        self,
        case_id: str,
        on_post: Optional[PostCallback] = None,
        persist: Optional[PostingSink] = None,
    ):
        self.case_id = case_id
        self._on_post = on_post
        self._persist = persist
        self.postings: list[Posting] = []
        self._seq = 0

    async def post(
        self,
        agent: str,
        color: int,
        kind: str,
        content: str,
        metadata: Optional[dict[str, object]] = None,
    ) -> Posting:
        self._seq += 1
        p = Posting(self._seq, agent, color, kind, content, metadata or {})
        self.postings.append(p)
        # Persist FIRST so a frontend reload sees the same sequence the SSE
        # callback is about to fire. If the DB write fails we propagate; the
        # orchestrator marks the run failed rather than silently losing audit.
        if self._persist is not None:
            await self._persist(p)
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
    handle: str | None = None


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

    def __init__(
        self,
        case_id: str,
        cfg: BandConfig,
        on_post: Optional[PostCallback] = None,
        persist: Optional[PostingSink] = None,
    ):
        super().__init__(case_id, on_post, persist)
        self.cfg = cfg
        self._tools: dict[str, object] = {}  # agent key -> AgentTools
        self._handle_by_key: dict[str, str] = {}  # agent key -> "@username/agent"
        self._room_id: Optional[str] = cfg.room_id
        self._ready = False

    @property
    def room_id(self) -> Optional[str]:
        return self._room_id

    async def ensure_ready(self) -> None:
        """Create REST clients + AgentTools per agent, a room if none given, add all
        participants, then resolve each agent's @mention handle from the room."""
        if self._ready:
            return
        from thenvoi_rest import AsyncRestClient
        from band import AgentTools

        rests: dict[str, AsyncRestClient] = {
            key: AsyncRestClient(base_url=self.cfg.rest_url, api_key=creds.api_key)
            for key, creds in self.cfg.agents.items()
        }

        sys_key = self.cfg.system_agent_key
        if not self._room_id:
            self._room_id = await AgentTools(room_id="", rest=rests[sys_key]).create_chatroom()

        for key, rest in rests.items():
            self._tools[key] = AgentTools(room_id=self._room_id, rest=rest)

        # Add every agent as a participant (idempotent), identified by agent_id.
        sys_tools = self._tools[sys_key]
        for key, creds in self.cfg.agents.items():
            if key == sys_key:
                continue
            try:
                await sys_tools.add_participant(creds.agent_id, "member")  # type: ignore[attr-defined]
            except Exception:
                pass

        # Band resolves @mentions against the SENDER's OWN cached participant list,
        # so every agent must load participants once or its sends fail with
        # "Unknown participant ... Available handles: []". Hydrate each agent's cache
        # (after all adds) and build the key->handle map from the results.
        by_id: dict[str, str] = {}
        for tools in self._tools.values():
            try:
                parts = await tools.get_participants()  # type: ignore[attr-defined]
                for p in parts:
                    pid, handle = getattr(p, "id", None), getattr(p, "handle", None)
                    if pid and handle:
                        by_id[pid] = handle
            except Exception:
                pass
        for key, creds in self.cfg.agents.items():
            handle = by_id.get(creds.agent_id) or (creds.handle or "").lstrip("@")
            if handle:
                self._handle_by_key[key] = "@" + handle

        self._ready = True

    async def _deliver(self, p: Posting) -> None:
        # Option B: ONLY real agents post to Band, so the Band room reads as a clean
        # agent-to-agent debate. Gate/system/handoff narration (authored by "System"
        # or a gate name, not a real agent) stays in the Lumen UI as our verification
        # overlay. (For "everything in Band", drop this guard.)
        if p.agent not in _NAME_TO_KEY:
            return
        await self.ensure_ready()
        sys_key = self.cfg.system_agent_key
        sender_key = _NAME_TO_KEY[p.agent]
        tools = self._tools.get(sender_key)
        if tools is None:
            return
        # Band requires every message to mention a participant. Route to the
        # coordinator, or to the drafter when the coordinator itself is speaking.
        target_key = sys_key if sender_key != sys_key else "drafter"
        mention = self._handle_by_key.get(target_key)
        if not mention:
            mention = next((h for k, h in self._handle_by_key.items() if k != sender_key), None)
        try:
            await tools.send_message(p.content, mentions=[mention] if mention else None)  # type: ignore[attr-defined]
        except Exception as e:
            if os.environ.get("LUMEN_BAND_DEBUG") == "1":
                print(f"[BandRoom] send FAILED — agent='{p.agent}' as={sender_key} mention={mention}: {repr(e)[:200]}")
            # never let a transport hiccup break the local run / UI


def make_room(
    case_id: str,
    on_post: Optional[PostCallback] = None,
    persist: Optional[PostingSink] = None,
) -> Room:
    """Factory: BandRoom when band_config.yaml exists and BAND is on; else LocalRoom."""
    use_band = os.getenv("LUMEN_BAND") == "1" and os.path.exists("band_config.yaml")
    if use_band:
        return BandRoom(case_id, BandConfig(), on_post, persist)
    return LocalRoom(case_id, on_post, persist)
