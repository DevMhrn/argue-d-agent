from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

from .mock_responses import CLEAN, MOCK_BY_CASE
from .pipeline import CITE_GATE, FACT_GATE, _decision_outcome, run_lumen
from .room import Room
from .types import ClaimInput, EvidenceLedger, Statute


DATA = Path(__file__).resolve().parents[2] / "data"


class PipelineSafetyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        os.environ["LUMEN_MOCK"] = "1"
        os.environ["LUMEN_MOCK_DELAY_MS"] = "0"
        self.claim = ClaimInput.model_validate(
            json.loads((DATA / "sample_claim_clean.json").read_text())
        )
        self.statutes = [
            Statute.model_validate(s)
            for s in json.loads((DATA / "statutes.json").read_text())
        ]
        self.ledger = EvidenceLedger.model_validate(MOCK_BY_CASE[CLEAN]["ledger"])

    async def test_packet_scoped_citation_gate_retries_out_of_packet_redirect(self) -> None:
        room = Room(self.claim.caseId)

        result = await run_lumen(self.claim, self.statutes, room, ledger=self.ledger)

        rejections = [p.content for p in room.postings if p.agent == CITE_GATE]
        self.assertTrue(
            any("cites unknown id [F1]" in r or "cites unknown id [F4]" in r for r in rejections)
        )
        self.assertFalse(any("unresolved gate violations" in p.content for p in room.postings))
        self.assertFalse(
            any("Citation Gate rejected" in reason for reason in result.decision.escalateReasons)
        )

    async def test_fact_gate_failure_forces_human_review_reason(self) -> None:
        room = Room(self.claim.caseId)
        bad_facts = [
            self.ledger.facts[0].model_copy(update={"verbatimQuote": "not present in source documents"}),
            *self.ledger.facts[1:],
        ]
        bad_ledger = self.ledger.model_copy(update={"facts": bad_facts})

        result = await run_lumen(self.claim, self.statutes, room, ledger=bad_ledger)

        self.assertEqual(result.decision.outcome, "escalate")
        self.assertTrue(result.decision.escalate)
        self.assertIn(f"{FACT_GATE} rejected", "; ".join(result.decision.escalateReasons))


class DecisionOutcomeTests(unittest.TestCase):
    def test_decline_precedence_survives_safety_reasons(self) -> None:
        self.assertEqual(_decision_outcome(["gate warning"], pursue=False), "decline")


if __name__ == "__main__":
    unittest.main()
