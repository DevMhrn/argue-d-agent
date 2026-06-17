"""End-to-end upload smoke test.

Drives the full ingestion flow against live Supabase + Backblaze + Redis,
exactly the way the frontend will:

    1. POST /api/ingest/case               — create a case shell
    2. POST /api/ingest/sign-upload        — reserve a row, get a signed POST
    3. POST multipart/form-data → B2       — the browser → object store step
    4. POST /api/ingest/commit             — flip status, enqueue extraction
    5. Poll GET /api/ingest/status/{id}    — wait for the worker to extract
    6. Verify a document_pages row exists  — direct asyncpg query

Run with the FastAPI server + arq worker running, then:
    .venv/bin/python -m scripts.probe_upload
"""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
import time
from pathlib import Path
from uuid import UUID

import asyncpg
import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / "backend" / ".env"
load_dotenv(ENV_PATH)

API_BASE = os.environ.get("LUMEN_API_BASE_URL", "http://127.0.0.1:8000")

# A trivially small plain-text "document" that exercises every layer without
# needing a real PDF on disk. The extractor for text/plain is in scope (§22).
TEST_BODY = (
    "Case: Rivera v. Blake — Probe Upload Test\n"
    "Date: 2026-06-18\n"
    "Insured: Alex Rivera\n"
    "Other party: Jordan Blake\n"
    "Jurisdiction: California\n\n"
    "This is a synthetic plain-text document used to verify the end-to-end\n"
    "ingestion flow lands bytes in Backblaze B2 and rows in Supabase.\n"
)
TEST_NAME = "probe-upload.txt"
TEST_MIME = "text/plain"


def green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def cyan(s: str) -> str:
    return f"\033[36m{s}\033[0m"


def step(n: int, label: str) -> None:
    print(f"\n{cyan(f'[{n}]')} {label}")


async def main() -> int:
    body = TEST_BODY.encode("utf-8")
    sha256 = hashlib.sha256(body).hexdigest()
    size = len(body)
    print(cyan(f"API base: {API_BASE}"))
    print(cyan(f"Probe file: {TEST_NAME!r} · {size} bytes · sha256={sha256[:12]}…"))

    async with httpx.AsyncClient(base_url=API_BASE, timeout=30.0) as client:
        # 1. Create the case shell ----------------------------------------------
        step(1, "POST /api/ingest/case")
        timestamp = int(time.time())
        case_resp = await client.post(
            "/api/ingest/case",
            json={
                "case_id": f"PROBE-{timestamp}",
                "title": "Probe upload smoke test",
                "jurisdiction": "CA",
                "summary": "End-to-end probe of the ingestion flow.",
                "insured_name": "Alex Rivera",
                "other_party_name": "Jordan Blake",
                "damages_usd": 42000,
            },
        )
        if case_resp.status_code >= 400:
            print(red(f"  ✗ {case_resp.status_code} {case_resp.text}"))
            return 1
        case_row = case_resp.json()
        case_uuid = case_row["id"]
        print(green(f"  ✓ case.id = {case_uuid}  case_id = {case_row['case_id']}"))

        # 2. Reserve a document + get the signed POST ---------------------------
        step(2, "POST /api/ingest/sign-upload")
        sign_resp = await client.post(
            "/api/ingest/sign-upload",
            json={
                "case_id": case_uuid,
                "filename": TEST_NAME,
                "mime_type": TEST_MIME,
                "size": size,
                "sha256": sha256,
                "document_kind": "probe",
            },
        )
        if sign_resp.status_code >= 400:
            print(red(f"  ✗ {sign_resp.status_code} {sign_resp.text}"))
            return 1
        signed = sign_resp.json()
        document_id = signed["document_id"]
        upload_url = signed["upload_url"]
        upload_method = signed["upload_method"]
        upload_headers = signed["upload_headers"]
        storage_key = signed["storage_key"]
        print(green(f"  ✓ document.id = {document_id}"))
        print(f"     storage_key   = {storage_key}")
        print(f"     {upload_method} {upload_url[:80]}…")
        print(f"     headers       = {upload_headers}")

        # 3. PUT the file bytes directly to B2 ---------------------------------
        step(3, f"{upload_method} bytes → B2 (browser-direct upload)")
        b2_resp = await client.request(
            upload_method,
            upload_url,
            content=body,
            headers=upload_headers,
            timeout=60.0,
        )
        if b2_resp.status_code >= 300:
            print(red(f"  ✗ B2 rejected: HTTP {b2_resp.status_code}"))
            print(red(f"     body: {b2_resp.text[:600]}"))
            return 1
        print(green(f"  ✓ B2 accepted: HTTP {b2_resp.status_code}"))
        if b2_resp.headers.get("etag"):
            print(f"     etag = {b2_resp.headers['etag']}")

        # 4. Commit — backend HEADs the object, flips status, enqueues -----------
        step(4, "POST /api/ingest/commit")
        commit_resp = await client.post(
            "/api/ingest/commit",
            json={"document_id": document_id},
        )
        if commit_resp.status_code >= 400:
            print(red(f"  ✗ {commit_resp.status_code} {commit_resp.text}"))
            return 1
        committed = commit_resp.json()
        print(green(f"  ✓ commit status = {committed['status']}"))

        # 5. Poll for extraction ------------------------------------------------
        step(5, "Poll GET /api/ingest/status/{case_id} until terminal")
        deadline = time.time() + 60
        terminal = False
        while time.time() < deadline:
            status_resp = await client.get(f"/api/ingest/status/{case_uuid}")
            if status_resp.status_code >= 400:
                print(red(f"  ✗ {status_resp.status_code} {status_resp.text}"))
                return 1
            status = status_resp.json()
            docs = status["documents"]
            doc = next((d for d in docs if d["id"] == document_id), None)
            if doc is None:
                print(red("  ✗ document missing from status response"))
                return 1
            print(
                f"     {time.strftime('%H:%M:%S')}  status={doc['status']}"
                f"  pages={doc.get('page_count')}"
                f"  retries={doc.get('retry_count')}"
                f"  error={doc.get('extraction_error') or '-'}"
            )
            if doc["status"] in ("extracted", "failed"):
                terminal = True
                if doc["status"] == "failed":
                    print(red(f"  ✗ extraction failed: {doc.get('extraction_error')}"))
                    return 1
                print(green(f"  ✓ extracted in {doc.get('extraction_duration_ms')} ms"))
                print(green(f"  ✓ ingestion_complete = {status['ingestion_complete']}"))
                break
            await asyncio.sleep(1.5)
        if not terminal:
            print(red("  ✗ extraction did not finish within 60s — is the arq worker running?"))
            return 1

    # 6. Verify the document_pages row in Supabase -----------------------------
    step(6, "Direct SELECT FROM document_pages")
    dsn = os.environ["DATABASE_URL"]
    conn = await asyncpg.connect(dsn, statement_cache_size=0)
    try:
        pages = await conn.fetch(
            "SELECT page_number, char_count, length(extracted_text) AS textlen "
            "FROM document_pages WHERE document_id = $1 ORDER BY page_number",
            UUID(document_id),
        )
        if not pages:
            print(red("  ✗ no document_pages rows for this document"))
            return 1
        for p in pages:
            print(
                green(
                    f"  ✓ page {p['page_number']}: char_count={p['char_count']} "
                    f"textlen={p['textlen']}"
                )
            )
    finally:
        await conn.close()

    print()
    print(green("══════ ALL GREEN — bytes in B2, rows in Supabase, worker extracted ══════"))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
