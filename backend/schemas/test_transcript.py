from __future__ import annotations

import unittest
from datetime import datetime, timezone
from uuid import uuid4

from .transcript import TranscriptCreate, TranscriptRow


class TranscriptMetadataTests(unittest.TestCase):
    def test_create_and_row_accept_metadata(self) -> None:
        payload = TranscriptCreate(
            case_id=uuid4(),
            run_id=uuid4(),
            seq=1,
            agent_name="Court Clerk",
            color=250,
            kind="system",
            content="Docket opened.",
            metadata={"phase": "docket", "turn_type": "open"},
        )

        self.assertEqual(payload.metadata["phase"], "docket")

        now = datetime.now(timezone.utc)
        row = TranscriptRow(
            id=uuid4(),
            case_id=payload.case_id,
            run_id=payload.run_id,
            seq=payload.seq,
            agent_name=payload.agent_name,
            color=payload.color,
            kind=payload.kind,
            content=payload.content,
            metadata=payload.metadata,
            posted_at=now,
            created_at=now,
            updated_at=now,
        )

        self.assertEqual(row.metadata["turn_type"], "open")


if __name__ == "__main__":
    unittest.main()
