# Sample Upload Corpus (synthetic, for stress testing)

Fictional documents (no real PII) modeled on real subrogation artifacts: CHP 555
collision reports, CCC ONE / Mitchell repair estimates, Bosch CDR readouts,
ACORD 2 FNOL, insurer subrogation demand letters, and recorded statements.
Regenerate with `python scripts/gen_test_corpus.py`.

Each folder is one case. Create a case in the UI, fill the suggested fields, and
upload **all** files in the folder. Formats span every ingestion path: PDF, DOCX,
HTML, plain text.

| Folder | Scenario | Suggested case fields (insured / other / jurisdiction / damages) | Expected outcome |
|---|---|---|---|
| `case_pursue_redlight/` | Other driver ran a red light; our insured had green. Clear other-party fault. | Daniel Cho / Robert Hale / CA / **18470** | **pursue** unless another gate or confidence condition escalates |
| `case_decline_rearend/` | OUR insured rear-ended a stopped car (following too closely). We are at fault. | Megan Ross / Luis Ortega / CA / **3150** | **decline** (low recovery, our fault) |
| `case_escalate_leftturn/` | Disputed left-turn vs. alleged speeding. Conflicting accounts, ~50/50, no witness/camera. | Aisha Khan / Tyler Brooks / CA / **12900** | **escalate** (near 50/50, adjudicator disagreement) |

Files per case:

- **case_pursue_redlight/**: `collision_report_LA-2026-31882.pdf` (multi-page CHP 555),
  `repair_estimate_CCC.txt`, `cdr_readout_V2_ram.txt`, `subrogation_demand_letter.docx`
- **case_decline_rearend/**: `police_report.html`, `fnol_acord2.html`, `repair_estimate_insured_vehicle.txt`
- **case_escalate_leftturn/**: `collision_report_BUR-2026-5521.pdf`, `recorded_statement_insured_khan.docx`, `recorded_statement_other_brooks.txt`

Single-file quick test: `../sample_uploads/police_report_demo.txt` (one clean case).

All scenarios reference real California Vehicle Code sections that match `data/statutes.json`
(CVC 21453 red light, CVC 21703 following too closely) plus CVC 21801 (left-turn yield)
and CVC 22350 (basic speed law) for the disputed case.
