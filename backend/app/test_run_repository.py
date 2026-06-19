from __future__ import annotations

import unittest
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from .run_repository import RunRepository


class RunRepositoryMappingTests(unittest.TestCase):
    def test_decision_mapper_preserves_decline_outcome(self) -> None:
        now = datetime.now(timezone.utc)
        row = {
            "id": uuid4(),
            "case_id": uuid4(),
            "run_id": uuid4(),
            "other_driver_fault_pct": Decimal("11.00"),
            "confidence": Decimal("0.80"),
            "recovery_usd": Decimal("1980.00"),
            "escalate": False,
            "escalate_reasons": [],
            "outcome": "decline",
            "pursue": False,
            "decline_reason": "recovery below threshold",
            "near_fifty_fifty": False,
            "consensus_type": "agreement",
            "consensus_delta": Decimal("2.00"),
            "fault_table": [{"factId": "F1", "favors": "them", "weight": 0.3}],
            "reasoning": "not viable",
            "secondary_decision": None,
            "letter": "Internal close-file memo",
            "audit_hash": "abc",
            "finalized_at": now,
            "created_at": now,
            "updated_at": now,
        }

        decision = RunRepository._row_to_decision(row)

        self.assertEqual(decision.outcome, "decline")
        self.assertFalse(decision.pursue)
        self.assertEqual(decision.decline_reason, "recovery below threshold")


if __name__ == "__main__":
    unittest.main()
