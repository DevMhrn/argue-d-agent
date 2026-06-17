"""Deterministic offline graphs for the sample cases, so the ledger lane runs with
no LLM/keys/Supabase. Verbatim quotes are exact substrings of the sample documents
(data/sample_claim_*.json), so validate_graph() passes the Fact-anchor check.
"""
from __future__ import annotations

from .graph import LedgerGraph, LedgerNode, LedgerEdge

CLEAN = "CLM-2026-0427"
LOSER = "CLM-2026-0588"


def _edges(pairs: list[tuple[str, str, str]]) -> list[LedgerEdge]:
    return [LedgerEdge(edge_id=f"E{i+1}", from_id=a, to_id=b, type=t) for i, (a, b, t) in enumerate(pairs)]


_CLEAN = LedgerGraph(
    caseId=CLEAN,
    nodes=[
        LedgerNode(node_id="F1", type="Fact", props={"label": "Driver B ran the red light"}, verbatim_quote="Vehicle 2 (Blake) entered the intersection against a steady red signal", source_document="police_report.pdf", source_page_number=1, confidence=0.9),
        LedgerNode(node_id="F2", type="Fact", props={"label": "Witness: B ~50 mph"}, verbatim_quote="The silver car blew through the red, going maybe 50.", source_document="witness_statements.pdf", source_page_number=1, confidence=0.75),
        LedgerNode(node_id="F3", type="Fact", props={"label": "Driver A had a green light"}, verbatim_quote="Vehicle 1 (Rivera), which had entered on a green signal", source_document="police_report.pdf", source_page_number=1, confidence=0.85),
        LedgerNode(node_id="F4", type="Fact", props={"label": "B cited under CVC 21453"}, verbatim_quote="Vehicle 2 driver cited under CVC 21453 for failing to stop at a red signal", source_document="police_report.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="F5", type="Fact", props={"label": "A was 5 mph over"}, verbatim_quote="speed 40 mph in a posted 35 mph zone", source_document="edr_readout.pdf", source_page_number=1, confidence=0.8),
        LedgerNode(node_id="F6", type="Fact", props={"label": "Damages $42,000"}, verbatim_quote="Total documented damages: $42,000", source_document="repair_invoice.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="P1", type="Party", props={"label": "Alex Rivera", "role": "our insured", "driver": "A"}),
        LedgerNode(node_id="P2", type="Party", props={"label": "Jordan Blake", "role": "other driver", "driver": "B"}),
        LedgerNode(node_id="V1", type="Vehicle", props={"label": "Rivera vehicle"}),
        LedgerNode(node_id="V2", type="Vehicle", props={"label": "Blake vehicle"}),
        LedgerNode(node_id="EV1", type="Event", props={"label": "Intersection collision", "date": "2026-04-27"}),
        LedgerNode(node_id="L1", type="Location", props={"label": "5th Ave & Main St, San Jose, CA"}),
        LedgerNode(node_id="D1", type="Damage", props={"label": "Vehicle + medical", "amountUsd": 42000}),
        LedgerNode(node_id="S1", type="Statute", props={"label": "CVC 21453 — steady red signal", "statute_id": "CVC-21453"}),
        LedgerNode(node_id="S2", type="Statute", props={"label": "Civ. Code 1431.2 — comparative fault", "statute_id": "CA-1431.2"}),
        LedgerNode(node_id="DOC1", type="Document", props={"label": "police_report.pdf", "kind": "police report"}),
        LedgerNode(node_id="DOC2", type="Document", props={"label": "witness_statements.pdf", "kind": "witness statements"}),
        LedgerNode(node_id="DOC3", type="Document", props={"label": "edr_readout.pdf", "kind": "event data recorder"}),
        LedgerNode(node_id="DOC4", type="Document", props={"label": "repair_invoice.pdf", "kind": "repair and medical billing"}),
        LedgerNode(node_id="DOC5", type="Document", props={"label": "fnol.txt", "kind": "First Notice of Loss"}),
    ],
    edges=_edges([
        ("F1", "DOC1", "mentioned_in"), ("F2", "DOC2", "mentioned_in"), ("F3", "DOC1", "mentioned_in"),
        ("F4", "DOC1", "mentioned_in"), ("F5", "DOC3", "mentioned_in"), ("F6", "DOC4", "mentioned_in"),
        ("F1", "P2", "attributed_to"), ("F4", "P2", "attributed_to"), ("F3", "P1", "attributed_to"), ("F5", "P1", "attributed_to"),
        ("F4", "F1", "corroborates"), ("F2", "F1", "corroborates"),
        ("EV1", "S1", "governed_by"), ("EV1", "S2", "governed_by"),
        ("EV1", "D1", "caused"),
        ("EV1", "P1", "involves"), ("EV1", "P2", "involves"),
        ("EV1", "L1", "occurred_at"),
        ("P1", "V1", "drives"), ("P2", "V2", "drives"),
    ]),
)

_LOSER = LedgerGraph(
    caseId=LOSER,
    nodes=[
        LedgerNode(node_id="F1", type="Fact", props={"label": "Our insured rear-ended B"}, verbatim_quote="Vehicle 1 (Carter) struck Vehicle 2 (Lee) from behind", source_document="police_report.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="F2", type="Fact", props={"label": "B was stopped at a red"}, verbatim_quote="Vehicle 2 (Lee) was stopped at a steady red signal", source_document="police_report.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="F3", type="Fact", props={"label": "A cited under CVC 21703"}, verbatim_quote="Carter cited under CVC 21703 for following too closely", source_document="police_report.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="F4", type="Fact", props={"label": "A braked late"}, verbatim_quote="no brake application until 0.3 seconds before impact", source_document="edr_readout.pdf", source_page_number=1, confidence=0.85),
        LedgerNode(node_id="F5", type="Fact", props={"label": "Roadway was wet"}, verbatim_quote="light rain, roadway wet", source_document="weather_report.pdf", source_page_number=1, confidence=0.7),
        LedgerNode(node_id="F6", type="Fact", props={"label": "Damages $18,000"}, verbatim_quote="Total documented damages: $18,000", source_document="repair_invoice.pdf", source_page_number=1, confidence=0.95),
        LedgerNode(node_id="P1", type="Party", props={"label": "Sam Carter", "role": "our insured", "driver": "A"}),
        LedgerNode(node_id="P2", type="Party", props={"label": "Dana Lee", "role": "other driver", "driver": "B"}),
        LedgerNode(node_id="V1", type="Vehicle", props={"label": "Carter vehicle"}),
        LedgerNode(node_id="V2", type="Vehicle", props={"label": "Lee vehicle"}),
        LedgerNode(node_id="EV1", type="Event", props={"label": "Rear-end collision", "date": "2026-05-14"}),
        LedgerNode(node_id="L1", type="Location", props={"label": "Elm St & 2nd Ave, Oakland, CA"}),
        LedgerNode(node_id="D1", type="Damage", props={"label": "Front-end repair", "amountUsd": 18000}),
        LedgerNode(node_id="S1", type="Statute", props={"label": "CVC 21703 — following too closely", "statute_id": "CVC-21703"}),
        LedgerNode(node_id="S2", type="Statute", props={"label": "Civ. Code 1431.2 — comparative fault", "statute_id": "CA-1431.2"}),
        LedgerNode(node_id="DOC1", type="Document", props={"label": "police_report.pdf", "kind": "police report"}),
        LedgerNode(node_id="DOC2", type="Document", props={"label": "edr_readout.pdf", "kind": "event data recorder"}),
        LedgerNode(node_id="DOC3", type="Document", props={"label": "weather_report.pdf", "kind": "weather report"}),
        LedgerNode(node_id="DOC4", type="Document", props={"label": "repair_invoice.pdf", "kind": "repair and medical billing"}),
        LedgerNode(node_id="DOC5", type="Document", props={"label": "fnol.txt", "kind": "First Notice of Loss"}),
    ],
    edges=_edges([
        ("F1", "DOC1", "mentioned_in"), ("F2", "DOC1", "mentioned_in"), ("F3", "DOC1", "mentioned_in"),
        ("F4", "DOC2", "mentioned_in"), ("F5", "DOC3", "mentioned_in"), ("F6", "DOC4", "mentioned_in"),
        ("F1", "P1", "attributed_to"), ("F3", "P1", "attributed_to"), ("F2", "P2", "attributed_to"),
        ("F3", "F1", "corroborates"), ("F4", "F1", "corroborates"),
        ("EV1", "S1", "governed_by"), ("EV1", "S2", "governed_by"),
        ("EV1", "D1", "caused"),
        ("EV1", "P1", "involves"), ("EV1", "P2", "involves"),
        ("EV1", "L1", "occurred_at"),
        ("P1", "V1", "drives"), ("P2", "V2", "drives"),
    ]),
)

MOCK_GRAPHS: dict[str, LedgerGraph] = {CLEAN: _CLEAN, LOSER: _LOSER}
