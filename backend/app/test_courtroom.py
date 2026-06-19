from __future__ import annotations

import unittest

from .types import EvidenceLedger, Fact, Statute


class CourtroomPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ledger = EvidenceLedger(
            caseId="CLM-TEST",
            facts=[
                Fact(
                    id="F1",
                    statement="Other driver entered against a red light.",
                    source="police_report.pdf p.1",
                    verbatimQuote="entered against a red light",
                    confidence=0.95,
                ),
                Fact(
                    id="F2",
                    statement="Our insured was traveling 40 mph in a 35 mph zone.",
                    source="edr.txt p.1",
                    verbatimQuote="40 mph in a 35 mph zone",
                    confidence=0.8,
                ),
                Fact(
                    id="F3",
                    statement="Documented repair damages are $12,500.",
                    source="estimate.pdf p.2",
                    verbatimQuote="Documented repair damages are $12,500",
                    confidence=0.9,
                ),
            ],
        )
        self.statutes = [
            Statute(
                id="CVC-21453",
                jurisdiction="CA",
                title="California Vehicle Code §21453(a) — Steady Red Signal",
                text="A driver facing a steady circular red signal shall stop.",
            ),
            Statute(
                id="CA-1431.2",
                jurisdiction="CA",
                title="California Civil Code §1431.2 — Comparative Fault Allocation",
                text="A plaintiff's recovery is reduced by the plaintiff's own proportionate share of fault.",
            )
        ]

    def test_build_courtroom_plan_creates_bounded_issues_from_ledger(self) -> None:
        from .courtroom import build_courtroom_plan

        plan = build_courtroom_plan(self.ledger, self.statutes)

        self.assertEqual(plan.case_id, "CLM-TEST")
        self.assertLessEqual(len(plan.issues), 4)
        issue_keys = [issue.key for issue in plan.issues]
        self.assertEqual(
            issue_keys,
            ["primary_liability", "comparative_fault", "damages", "legal_basis"],
        )
        self.assertEqual(plan.issues[0].fact_ids, ["F1"])
        self.assertEqual(plan.issues[0].statute_ids, ["CVC-21453"])
        self.assertEqual(plan.issues[1].fact_ids, ["F2"])
        self.assertEqual(plan.issues[1].statute_ids, ["CA-1431.2"])
        self.assertEqual(plan.issues[2].fact_ids, ["F3"])
        self.assertEqual(plan.issues[3].statute_ids, ["CVC-21453", "CA-1431.2"])

    def test_render_issue_context_is_compact_and_source_anchored(self) -> None:
        from .courtroom import build_courtroom_plan, render_issue_context

        plan = build_courtroom_plan(self.ledger, self.statutes)
        context = render_issue_context(plan.issues[0], self.ledger, self.statutes)

        self.assertIn("Issue: Primary liability", context)
        self.assertIn("[F1] Other driver entered against a red light.", context)
        self.assertIn("Quote: entered against a red light", context)
        self.assertNotIn("[F2]", context)
        self.assertNotIn("[F3]", context)


if __name__ == "__main__":
    unittest.main()
