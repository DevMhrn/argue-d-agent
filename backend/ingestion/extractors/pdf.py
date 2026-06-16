"""Native-PDF extractor.

Uses `pdfplumber` to extract text from each page of a native (non-scanned) PDF.
Scanned PDFs are explicitly out of scope; route those to an OCR pipeline later.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from .base import ExtractedDocument, ExtractedPage

if TYPE_CHECKING:  # pdfplumber is heavy; import lazily inside extract()
    pass


class PdfExtractor:
    mime_types = ("application/pdf",)

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        # Lazy import keeps the package light when PDF isn't needed.
        import io

        import pdfplumber  # type: ignore[import-not-found]

        pages: list[ExtractedPage] = []
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for idx, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                pages.append(
                    ExtractedPage(
                        page_number=idx,
                        text=text,
                        metadata={
                            "width": float(page.width),
                            "height": float(page.height),
                        },
                    )
                )
        return ExtractedDocument(
            pages=pages,
            document_metadata={"extractor": "pdf", "native": True},
        )
