from __future__ import annotations

import unittest

from .types import EvidenceLedger, Fact, Statute


class LedgerLookupToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = EvidenceLedger(
            caseId="CLM-TEST",
            facts=[
                Fact(
                    id="F1",
                    statement="Other driver ran a red light.",
                    source="police_report.pdf p.1",
                    verbatimQuote="ran a red light",
                    confidence=0.95,
                ),
                Fact(
                    id="F2",
                    statement="Our insured was 5 mph over the speed limit.",
                    source="edr.txt p.1",
                    verbatimQuote="5 mph over the speed limit",
                    confidence=0.75,
                ),
            ],
        )
        self.statutes = [
            Statute(
                id="CVC-21453",
                jurisdiction="CA",
                title="Red signal",
                text="A driver facing a steady circular red signal shall stop.",
            )
        ]

    def test_search_ledger_returns_matching_fact_snippets(self) -> None:
        from .orchestration_tools import LedgerLookupTool

        tool = LedgerLookupTool(self.ledger, self.statutes)

        results = tool.search_ledger("red signal")

        self.assertEqual([result.id for result in results], ["F1"])
        self.assertIn("ran a red light", results[0].quote)

    def test_get_node_returns_fact_by_id(self) -> None:
        from .orchestration_tools import LedgerLookupTool

        tool = LedgerLookupTool(self.ledger, self.statutes)

        result = tool.get_node("F2")

        self.assertIsNotNone(result)
        self.assertEqual(result.id, "F2")
        self.assertEqual(result.kind, "fact")

    def test_lookup_statute_returns_known_statute(self) -> None:
        from .orchestration_tools import LedgerLookupTool

        tool = LedgerLookupTool(self.ledger, self.statutes)

        result = tool.lookup_statute("CVC-21453")

        self.assertIsNotNone(result)
        self.assertEqual(result.id, "CVC-21453")
        self.assertEqual(result.kind, "statute")
        self.assertIn("steady circular red signal", result.text)


if __name__ == "__main__":
    unittest.main()
