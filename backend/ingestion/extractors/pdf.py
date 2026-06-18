"""PDF extractor with OCR fallback for scanned documents.

Strategy:
  1. Run pdfplumber against the bytes (native text extraction). Fast, free.
  2. If the result looks empty (total chars across all pages < EMPTY_THRESHOLD,
     OR more than HALF_THRESHOLD of pages are individually empty), the PDF is
     almost certainly scanned. Run `ocrmypdf` to produce a new PDF with an
     embedded OCR text layer, then re-run pdfplumber against THAT.
  3. Each ExtractedPage carries `extraction_method` ∈ {native, ocr, hybrid}
     so the downstream Fact-Gate UI can render a small "OCR'd" badge on
     citations whose source is one indirection-step removed from raw text.

Why this shape works: ocrmypdf bakes the OCR text into the PDF's content
stream, so the same pdfplumber-based downstream code handles both flavors.
No new "page text" abstraction; the gate still substring-anchors.

System dependencies: ocrmypdf requires `tesseract` and `ghostscript` on PATH.
If they're missing OR if `ocrmypdf` itself isn't installed, we degrade
gracefully: emit the empty pdfplumber output with a clear extraction_error
in the document metadata. The case keeps moving; the agent layer can flag.
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess
import tempfile
from typing import Any

from .base import ExtractedDocument, ExtractedPage

log = logging.getLogger("lumen.ingestion.pdf")

# Heuristics for "this PDF needs OCR".
EMPTY_CHAR_THRESHOLD = 100      # total chars across all pages below this → scanned
EMPTY_PAGE_RATIO = 0.5          # fraction of empty pages above which we OCR
PAGE_EMPTY_CHARS = 20           # a page with fewer chars than this counts as empty


class PdfExtractor:
    mime_types = ("application/pdf",)

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        # 1. Native pdfplumber pass.
        native_pages, dims = _extract_with_pdfplumber(file_bytes)
        total_chars = sum(len(p.text) for p in native_pages)
        empty_pages = sum(1 for p in native_pages if len(p.text) < PAGE_EMPTY_CHARS)
        empty_ratio = empty_pages / max(len(native_pages), 1)

        needs_ocr = (
            total_chars < EMPTY_CHAR_THRESHOLD
            or empty_ratio > EMPTY_PAGE_RATIO
        )

        if not needs_ocr:
            return _wrap_native(native_pages, dims)

        # 2. Try OCR fallback.
        log.info(
            "pdf %s looks scanned (total_chars=%d, empty_ratio=%.2f) — attempting OCR",
            filename, total_chars, empty_ratio,
        )
        ocr_result = _try_ocrmypdf(file_bytes)
        if ocr_result is None:
            # OCR not available or failed — return the empty native pages with
            # a flag so the worker marks the document failed.
            return ExtractedDocument(
                pages=native_pages,
                document_metadata={
                    "extractor": "pdf",
                    "extraction_method": "native",
                    "needs_ocr": True,
                    "ocr_available": _ocr_available(),
                    "warning": (
                        "PDF appears scanned but OCR is unavailable. "
                        "Install ocrmypdf + tesseract + ghostscript."
                    ),
                },
            )

        ocr_pages, ocr_dims = _extract_with_pdfplumber(ocr_result)
        # Sometimes only SOME pages were image-only — merge: prefer OCR text
        # where native was empty, keep native text where it was non-empty.
        merged_pages: list[ExtractedPage] = []
        any_native = False
        any_ocr = False
        for idx in range(max(len(native_pages), len(ocr_pages))):
            native = native_pages[idx] if idx < len(native_pages) else None
            ocr = ocr_pages[idx] if idx < len(ocr_pages) else None
            page_number = idx + 1

            native_text = native.text if native else ""
            ocr_text = ocr.text if ocr else ""

            if len(native_text) >= PAGE_EMPTY_CHARS:
                # Native had real text; trust it.
                merged_pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        text=native_text,
                        metadata={
                            **(native.metadata if native else {}),
                            "extraction_method": "native",
                            "source_location": f"p. {page_number}",
                        },
                    )
                )
                any_native = True
            else:
                merged_pages.append(
                    ExtractedPage(
                        page_number=page_number,
                        text=ocr_text,
                        metadata={
                            **(ocr.metadata if ocr else {}),
                            "extraction_method": "ocr",
                            "ocr_engine": "tesseract",
                            "source_location": f"p. {page_number} (OCR'd)",
                        },
                    )
                )
                any_ocr = True

        method = "hybrid" if (any_native and any_ocr) else ("ocr" if any_ocr else "native")
        return ExtractedDocument(
            pages=merged_pages,
            document_metadata={
                "extractor": "pdf",
                "extraction_method": method,
                "ocr_engine": "tesseract" if any_ocr else None,
            },
        )


# ----- pdfplumber wrapper -----------------------------------------------------

def _extract_with_pdfplumber(
    file_bytes: bytes,
) -> tuple[list[ExtractedPage], list[tuple[float, float]]]:
    """Return (pages, dimensions). Dimensions kept separately so the OCR path
    can reuse them on its second pass."""
    import pdfplumber  # type: ignore[import-not-found]

    pages: list[ExtractedPage] = []
    dims: list[tuple[float, float]] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            w, h = float(page.width), float(page.height)
            dims.append((w, h))
            pages.append(
                ExtractedPage(
                    page_number=idx,
                    text=text,
                    metadata={
                        "width": w,
                        "height": h,
                    },
                )
            )
    return pages, dims


def _wrap_native(
    pages: list[ExtractedPage], _dims: list[tuple[float, float]]
) -> ExtractedDocument:
    out_pages = [
        ExtractedPage(
            page_number=p.page_number,
            text=p.text,
            metadata={
                **p.metadata,
                "extraction_method": "native",
                "source_location": f"p. {p.page_number}",
            },
        )
        for p in pages
    ]
    return ExtractedDocument(
        pages=out_pages,
        document_metadata={"extractor": "pdf", "extraction_method": "native"},
    )


# ----- OCR fallback ------------------------------------------------------------

def _ocr_available() -> bool:
    """Both the Python lib AND the system binaries must be present."""
    try:
        import ocrmypdf  # noqa: F401 — presence check only
    except ImportError:
        return False
    return shutil.which("tesseract") is not None and shutil.which("gs") is not None


def _try_ocrmypdf(file_bytes: bytes) -> bytes | None:
    """Run ocrmypdf on the PDF bytes; return new PDF bytes (with embedded
    OCR layer) or None if anything went wrong. We invoke as a subprocess
    rather than the Python API because the CLI is more battle-tested and
    handles its own resource lifecycle."""
    if not _ocr_available():
        return None
    with tempfile.TemporaryDirectory(prefix="lumen-ocr-") as tmp:
        in_path = os.path.join(tmp, "in.pdf")
        out_path = os.path.join(tmp, "out.pdf")
        with open(in_path, "wb") as f:
            f.write(file_bytes)
        try:
            subprocess.run(
                [
                    "ocrmypdf",
                    "--skip-text",      # leave already-text pages alone
                    "--rotate-pages",   # auto-rotate based on text orientation
                    "--deskew",         # straighten skewed scans
                    "--clean",          # noise removal
                    "--quiet",
                    "--output-type", "pdf",
                    in_path, out_path,
                ],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as e:
            log.warning("ocrmypdf failed: %s", e.stderr.decode("utf-8", errors="replace")[:400])
            return None
        try:
            with open(out_path, "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None
