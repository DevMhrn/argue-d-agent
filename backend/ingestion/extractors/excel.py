"""Excel (.xlsx) extractor.

Uses python-calamine (Rust-backed) — significantly faster + lower memory than
openpyxl, and it always returns cached values so we don't have to fiddle with
a `data_only` flag.

One ExtractedPage per worksheet. The page text is a TSV rendering with a
`# Sheet: <name>` header so the Fact-Gate's verbatim-quote check has clean
content to substring-anchor against. Tabs instead of commas because cell
values frequently contain commas (addresses, money, prose) and TSV requires
no quoting — quoting noise would break the substring invariant.

For sheets with > MAX_ROWS_FULL data rows we emit a head + tail with an
explicit `... <N rows omitted> ...` marker (which is itself substring-quotable
so an agent can cite "the truncation happened here" if relevant).
"""
from __future__ import annotations

import io
import logging
from datetime import date, datetime
from typing import Any

from .base import ExtractedDocument, ExtractedPage

log = logging.getLogger("lumen.ingestion.excel")

# Tunables. If a sheet has more data rows than MAX_ROWS_FULL, we emit only
# the head + tail and a marker — keeps even a 50k-row spreadsheet from
# blowing the LLM context window the downstream ledger lane will use.
MAX_ROWS_FULL = 600   # below this, emit every row
HEAD_ROWS = 500       # truncated sheets keep first N rows
TAIL_ROWS = 100       # ... and last N rows


class ExcelExtractor:
    mime_types = (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        # Lazy import: keeps the module importable even when calamine isn't
        # installed (e.g. on a fresh checkout without `pip install -r ...`),
        # so the rest of the registry can still load.
        try:
            from python_calamine import CalamineWorkbook
        except ImportError as e:
            raise RuntimeError(
                "python-calamine is required for Excel extraction. "
                "Run: pip install python-calamine"
            ) from e

        wb = CalamineWorkbook.from_filelike(io.BytesIO(file_bytes))
        pages: list[ExtractedPage] = []

        for idx, sheet_name in enumerate(wb.sheet_names, start=1):
            sheet = wb.get_sheet_by_name(sheet_name)
            hidden = _is_hidden(sheet)

            try:
                rows: list[list[Any]] = sheet.to_python()
            except Exception as e:  # noqa: BLE001
                log.warning("calamine failed on sheet %r in %s: %s", sheet_name, filename, e)
                continue

            rows = _strip_empty_border(rows)
            if not rows:
                # Skip blank sheets entirely — they pollute the graph.
                continue

            text = _render_sheet_as_tsv(sheet_name, rows)
            pages.append(
                ExtractedPage(
                    page_number=idx,
                    text=text,
                    metadata={
                        "extractor": "excel",
                        "sheet_name": sheet_name,
                        "row_count": len(rows),
                        "col_count": max((len(r) for r in rows), default=0),
                        "hidden": hidden,
                        "truncated": len(rows) > MAX_ROWS_FULL,
                        "source_location": f"sheet:{sheet_name}",
                    },
                )
            )

        if not pages:
            # Every sheet was empty or unreadable — emit a single placeholder
            # page so the document_pages FK chain isn't broken.
            pages.append(
                ExtractedPage(
                    page_number=1,
                    text=f"# {filename}\n# (workbook contained no readable sheets)",
                    metadata={"extractor": "excel", "empty_workbook": True},
                )
            )

        return ExtractedDocument(
            pages=pages,
            document_metadata={
                "extractor": "excel",
                "sheet_count": len(pages),
            },
        )


def _is_hidden(sheet: Any) -> bool:
    """python-calamine exposes sheet visibility on the sheet metadata.
    Defensive: different versions surface it differently; default False."""
    for attr in ("visible", "visibility"):
        v = getattr(sheet, attr, None)
        if isinstance(v, bool):
            return not v
        if isinstance(v, str) and v.lower() != "visible":
            return True
    return False


def _strip_empty_border(rows: list[list[Any]]) -> list[list[Any]]:
    """Drop fully-blank leading and trailing rows (common in templates),
    plus fully-blank trailing columns from each retained row."""
    def is_blank_row(r: list[Any]) -> bool:
        return all(_cell_str(c) == "" for c in r)

    # leading blanks
    while rows and is_blank_row(rows[0]):
        rows = rows[1:]
    # trailing blanks
    while rows and is_blank_row(rows[-1]):
        rows = rows[:-1]
    return rows


def _render_sheet_as_tsv(sheet_name: str, rows: list[list[Any]]) -> str:
    """Header line + TSV body, with head/tail truncation for huge sheets.

    The header line is `# Sheet: <name>`. If truncated, we add a second
    comment line with the row range so the LLM can cite it accurately.
    """
    n = len(rows)
    lines: list[str] = [f"# Sheet: {sheet_name}"]
    if n > MAX_ROWS_FULL:
        omitted = n - HEAD_ROWS - TAIL_ROWS
        lines.append(f"# Rows 1-{HEAD_ROWS} of {n} (head)")
        for r in rows[:HEAD_ROWS]:
            lines.append(_row_to_tsv(r))
        lines.append(f"# ... {omitted} rows omitted ...")
        lines.append(f"# Rows {n - TAIL_ROWS + 1}-{n} of {n} (tail)")
        for r in rows[-TAIL_ROWS:]:
            lines.append(_row_to_tsv(r))
    else:
        for r in rows:
            lines.append(_row_to_tsv(r))
    return "\n".join(lines)


def _row_to_tsv(row: list[Any]) -> str:
    return "\t".join(_cell_str(c) for c in row)


def _cell_str(cell: Any) -> str:
    """Normalize a cell value to a substring-friendly string."""
    if cell is None:
        return ""
    if isinstance(cell, bool):
        return "true" if cell else "false"
    if isinstance(cell, datetime):
        return cell.isoformat(sep=" ", timespec="seconds")
    if isinstance(cell, date):
        return cell.isoformat()
    if isinstance(cell, float):
        # Drop trailing .0 on whole numbers — they're noise for LLMs reading TSV
        if cell.is_integer():
            return str(int(cell))
        return f"{cell:.6g}"
    # int, str, anything else → str()
    s = str(cell)
    # Tabs and newlines in cells would corrupt the TSV; substitute lightly
    return s.replace("\t", " ").replace("\r\n", " ").replace("\n", " ")
