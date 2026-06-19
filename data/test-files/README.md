# Test files for ingestion smoke-testing

A curated set of 22 real, public-domain or CC-licensed files covering every
format the ingestion pipeline supports. All files are well under the per-file
caps (10 MB documents/images, 50 MB audio) and the per-case file-count caps
(50 documents, 15 images, 10 audio).

## Quick start

```bash
bash scripts/fetch_test_files.sh
```

Idempotent — skips files that already exist. Drag the resulting files into
`/cases/new` in the frontend, or upload via the `/api/ingest/*` endpoints.

## File-format coverage

| Category | Count | Sizes | What it exercises |
|---|---|---|---|
| audio (.mp3) | 5 | 158 KB – 5.1 MB | AudioExtractor — Whisper-1 segments + Claude EVENTS pass |
| images (.jpg) | 6 | 774 KB – 6.4 MB | ImageExtractor — Claude vision three-block prompt (OBSERVED / NOT_VISIBLE / EVENTS) |
| excel (.xlsx) | 3 | 31 – 66 KB | ExcelExtractor — python-calamine, multi-sheet (one file has 3 sheets, one has 2) |
| csv (.csv) | 2 | 5 – 177 KB | CsvExtractor — dialect sniffing, encoding fallback, header detection |
| pdf (.pdf) | 3 | 278 KB – 3.85 MB | PdfExtractor — native pdfplumber path; OCR fallback can be exercised with a separate scanned-PDF upload |
| docx (.docx) | 1 | 16 KB | DocxExtractor — python-docx, H1 page boundaries |
| html (.html) | 1 | 26 KB | HtmlExtractor — BeautifulSoup, whitespace collapse |
| md (.md) | 1 | < 5 KB | TextExtractor (markdown route) — case-notes example |

**Total:** 22 files, ~25 MB on disk.

## Sources and licenses

### Audio (Archive.org public-records collections)

| File | Source | License |
|---|---|---|
| 01-kathy-white-911.mp3 | archive.org/details/911Call-KathyWhiteAccident | Public records |
| 02-i40-school-bus-911.mp3 | archive.org/details/911FromSchoolBusChaseAndAccident | Public records |
| 03-citizen-app-collision.mp3 | archive.org Citizen app collection | Public domain |
| 04-stockton-pursuit-2009.mp3 | archive.org Stockton police scanner | Public records |
| 05-san-joaquin-pursuit-2011.mp3 | archive.org scan-stockton police scanner | Public records |

### Images (Wikimedia Commons)

| File | License |
|---|---|
| 01-tesla-rear-end-damage.jpg | CC BY 4.0 |
| 02-moscow-rear-end.jpg | CC0 |
| 03-rock-quarry-two-car.jpg | CC BY 2.0 |
| 04-kent-police-scene.jpg | CC BY 2.0 |
| 05-rollover-italy.jpg | CC BY-SA 3.0 |
| 06-car-accident-generic.jpg | CC BY 3.0 |

### Excel (FHWA Highway Statistics 2022)

US Federal Highway Administration open data — federal-government work, public
domain. The three files exercise multi-sheet workbook extraction:

- `mv1.xlsx` — single sheet, state vehicle registrations
- `dl22.xlsx` — 3 sheets (Males / Females / Total)
- `dv1c.xlsx` — 2 sheets

### CSV (state open-data portals)

| File | Source | License |
|---|---|---|
| 01-ny-dfs-auto-complaints.csv | data.ny.gov (DFS auto-insurance complaints) | NY State public data |
| 02-oregon-wc-cycle-times.csv | data.oregon.gov (workers-comp claim cycle times) | OR State public data |

The NY DFS file is particularly useful — it contains NAIC IDs, premium volumes,
and complaint counts per carrier, which is exactly the kind of enrichment data
a subrogation desk would reference when negotiating against a specific
tortfeasor's carrier.

### PDF

- **01-ntsb-highway-accident-report.pdf** — NTSB Report HAR-21-02. Real
  federal accident investigation, 3.85 MB. Federal work, public domain.
- **02-ca-dmv-sr1-accident.pdf** — California DMV SR-1 party-filed accident
  report form. State government, public.
- **03-ny-dmv-mv104-accident.pdf** — New York DMV MV-104 motor vehicle
  accident report form. State government, public.

### DOCX

- **01-ca-courts-demand-letter.docx** — California Judicial Branch sample
  stop-payment demand letter. Structurally identical to a subrogation demand
  letter (caption, parties, dollar amount, demand language, response
  deadline). Public, California Courts Self-Help Center.

### HTML

- **01-cornell-subrogation-wex.html** — Cornell Law School Wex entry on
  subrogation doctrine. Useful as a citation-gate source and statute-context
  reference. Cornell LII content is freely distributable.

### Markdown

- **01-case-notes-example.md** — Hand-authored case-notes stub for the
  Rivera v. Blake (CLM-2026-0427) scenario. Realistic shape for an adjuster's
  internal notes; references the same fact pattern as the demo case.

## Gaps and substitutes

The research surfaced three gaps worth knowing about:

1. **Texas CR-3 crash report**: not publicly downloadable — TxDOT restricts
   to law enforcement. Substituted with NY MV-104.
2. **Real CCC/Mitchell repair estimate XLSX**: none are public. The three
   FHWA Excel files exercise multi-sheet extraction logic but aren't shaped
   like a repair estimate. If you need a true repair-estimate XLSX, hand-
   author one based on a CCC ONE PDF.
3. **NTSB cockpit/dispatch audio**: NTSB policy is no public release of
   recordings. All audio in this set is Archive.org police-scanner / 911
   public-records material instead, which is closer to what a subrogation
   desk would actually receive.

## Why this set works for the demo

- Every supported extractor gets at least one real file to exercise.
- Multi-sheet Excel is covered (catches single-sheet assumption regressions).
- CSV dialect sniffing is covered (the NY file is comma-delimited UTF-8;
  test the EU-locale path separately if needed).
- Images include rear-end (most common subrogation pattern), multi-vehicle,
  rollover, and a clear-fault scene — good range for the vision model.
- Audio is short enough to be cheap on Whisper (5 × under 6 MB each).
- File-count totals: 5 audio (cap 10) · 6 images (cap 15) · 11 documents
  (cap 50) — well inside the per-case caps for a single combined upload.
