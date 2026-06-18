"""CSV (.csv) extractor.

Subrogation case files routinely include CSV exports — payment histories,
line-item damage tabulations, claims ledgers from carrier systems, audit logs.
Treat them like a single-sheet Excel workbook: detect dialect + encoding,
render rows as TSV (LLMs parse TSV more reliably than CSV because unquoted
commas in cell values don't ambiguate row boundaries), head+tail truncate at
600 rows so a 100k-row export doesn't blow the downstream ledger context.

One CSV file → one `ExtractedPage`, mirroring the per-sheet shape of
`ExcelExtractor` (each worksheet there is one page; here, one CSV is one
"sheet").

Stdlib only — no new dependency. The `csv` module is purely deterministic, so
no mock path is needed; mock-mode and live-mode produce identical output for a
given byte sequence.
"""
from __future__ import annotations

import csv
import io
import logging

from .base import ExtractedDocument, ExtractedPage

log = logging.getLogger("lumen.ingestion.csv")

# Try common encodings in order. utf-8-sig handles a BOM transparently;
# cp1252 covers Excel-on-Windows exports; latin-1 never errors so it's the
# guaranteed-success final fallback.
_ENCODINGS: tuple[str, ...] = ("utf-8-sig", "utf-8", "utf-16", "cp1252", "latin-1")

# Delimiters Sniffer should consider — comma, semicolon (EU locales), tab,
# pipe (rare but seen in legal/insurance exports).
_DELIMITERS = ",;\t|"

# Match Excel's truncation contract so a 200 KB CSV and a 200 KB worksheet
# produce the same page-text shape downstream.
MAX_ROWS_FULL = 600
HEAD_ROWS = 500
TAIL_ROWS = 100


class CsvExtractor:
    mime_types = (
        "text/csv",
        "application/csv",
    )

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        text, encoding = _decode(file_bytes)
        dialect, has_header = _sniff(text)
        rows = _read_rows(text, dialect)
        rendered = _render(rows, filename)
        return ExtractedDocument(
            pages=[
                ExtractedPage(
                    page_number=1,
                    text=rendered,
                    metadata={
                        "encoding": encoding,
                        "delimiter": dialect.delimiter,
                        "has_header": has_header,
                        "row_count": len(rows),
                        "truncated": len(rows) > MAX_ROWS_FULL,
                        "source_location": f"csv:{filename}",
                        "extraction_method": "csv",
                    },
                )
            ]
        )


def _decode(file_bytes: bytes) -> tuple[str, str]:
    for enc in _ENCODINGS:
        try:
            return file_bytes.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return file_bytes.decode("latin-1", errors="replace"), "latin-1"


def _sniff(text: str):
    """Detect delimiter + header presence on a leading sample.

    Returns (dialect, has_header). Falls back to comma + assume-headered when
    sniffer can't decide — that's the right default for tabular evidence.
    """
    sample = text[:8192]
    sniffer = csv.Sniffer()
    try:
        dialect = sniffer.sniff(sample, delimiters=_DELIMITERS)
    except csv.Error:
        log.debug("csv dialect sniff failed; falling back to comma")
        dialect = csv.excel
    try:
        has_header = sniffer.has_header(sample)
    except csv.Error:
        has_header = True
    return dialect, has_header


def _read_rows(text: str, dialect) -> list[list[str]]:
    return [list(row) for row in csv.reader(io.StringIO(text), dialect=dialect)]


def _render(rows: list[list[str]], filename: str) -> str:
    header = f"# CSV: {filename}"
    if not rows:
        return f"{header}\n(empty file)"
    if len(rows) <= MAX_ROWS_FULL:
        body = "\n".join(_render_row(r) for r in rows)
        return f"{header}\n{body}"
    head = "\n".join(_render_row(r) for r in rows[:HEAD_ROWS])
    tail = "\n".join(_render_row(r) for r in rows[-TAIL_ROWS:])
    omitted = len(rows) - HEAD_ROWS - TAIL_ROWS
    marker = f"... {omitted:,} rows omitted ..."
    return f"{header}\n{head}\n{marker}\n{tail}"


def _render_row(row: list[str]) -> str:
    return "\t".join(_clean(c) for c in row)


def _clean(cell: str) -> str:
    """Strip tabs/newlines from a cell — they'd corrupt the TSV row boundary."""
    return cell.replace("\t", " ").replace("\n", " ").replace("\r", " ")
