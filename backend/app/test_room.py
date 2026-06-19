from __future__ import annotations

import unittest

from .room import Room


class RoomMetadataTests(unittest.IsolatedAsyncioTestCase):
    async def test_post_persists_metadata_before_stream_callback(self) -> None:
        calls: list[str] = []
        streamed: list[dict[str, object]] = []

        async def persist(posting) -> None:
            calls.append(f"persist:{posting.seq}")
            self.assertEqual(posting.metadata["phase"], "cross_examination")

        def on_post(posting) -> None:
            calls.append(f"stream:{posting.seq}")
            streamed.append(posting.to_dict())

        room = Room("CLM-TEST", on_post=on_post, persist=persist)

        posting = await room.post(
            "Opposing-Carrier Red Team",
            203,
            "message",
            "Cross on comparative fault.",
            metadata={"phase": "cross_examination", "issue_key": "comparative_fault"},
        )

        self.assertEqual(calls, ["persist:1", "stream:1"])
        self.assertEqual(posting.metadata["issue_key"], "comparative_fault")
        self.assertEqual(streamed[0]["metadata"]["phase"], "cross_examination")


if __name__ == "__main__":
    unittest.main()
