"""HTML extractor.

Uses BeautifulSoup to strip markup. Splits at top-level <h1>/<h2> boundaries
into logical pages, same convention as the DOCX extractor.
"""
from __future__ import annotations

from .base import ExtractedDocument, ExtractedPage


class HtmlExtractor:
    mime_types = ("text/html", "application/xhtml+xml")

    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument:
        from bs4 import BeautifulSoup  # type: ignore[import-not-found]

        text = file_bytes.decode("utf-8", errors="replace")
        soup = BeautifulSoup(text, "html.parser")

        # Remove non-content tags.
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        # Walk top-level children, breaking pages at h1/h2.
        groups: list[list[str]] = [[]]
        for el in soup.body.descendants if soup.body else soup.descendants:
            name = getattr(el, "name", None)
            if name in ("h1", "h2") and groups[-1]:
                groups.append([])
            if name and el.get_text(strip=True):
                groups[-1].append(el.get_text(" ", strip=True))

        pages = [
            ExtractedPage(page_number=i + 1, text="\n".join(lines).strip())
            for i, lines in enumerate(groups)
            if lines
        ]
        if not pages:
            pages = [ExtractedPage(page_number=1, text=soup.get_text(" ", strip=True))]

        return ExtractedDocument(
            pages=pages,
            document_metadata={"extractor": "html"},
        )
