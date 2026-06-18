# Lumen — Ingestion Pipeline: End-to-End

> A plain-English walkthrough of what happens when a user uploads a file to Lumen,
> where the bytes go, how they become text, where that text is stored, and how
> the orchestration eventually reads it back to argue a subrogation case.
>
> If you remember nothing else: **raw bytes live in Backblaze B2, derived text
> lives in Supabase Postgres, and every Fact the agents cite later must be a
> contiguous substring of text we stored deterministically.**

---

## 1. The big picture in one diagram

```mermaid
flowchart LR
    USER([User<br/>browser]) -->|drag-drop or pick| UI[Next.js UI<br/>/cases/new]

    UI -->|1. POST /api/ingest/case| API[FastAPI<br/>backend:8000]
    UI -->|2. POST /api/ingest/sign-upload<br/>case_id, filename, sha256| API
    UI -->|3. PUT bytes<br/>direct, signed URL| B2[(Backblaze B2<br/>lumen-case-files)]
    UI -->|4. POST /api/ingest/commit| API

    API -->|insert row,<br/>flip status| PG[(Supabase Postgres)]
    API -->|enqueue<br/>extract_document| REDIS[(Upstash Redis<br/>arq queue)]

    REDIS -->|pick up job| WORKER[arq worker]
    WORKER -->|GET object| B2
    WORKER -->|extract bytes → pages| EXT{extractor by MIME}

    EXT --> EX_PDF[pdfplumber<br/>+ ocrmypdf fallback]
    EX_PDF -. text per page .-> WORKER
    EXT --> EX_DOCX[python-docx]
    EX_DOCX -. text per heading .-> WORKER
    EXT --> EX_XLSX[python-calamine]
    EX_XLSX -. TSV per sheet .-> WORKER
    EXT --> EX_HTML[BeautifulSoup]
    EX_HTML -. clean text .-> WORKER
    EXT --> EX_TXT[plain text]
    EX_TXT -. as-is .-> WORKER
    EXT --> EX_AUDIO[Whisper API]
    EX_AUDIO -. transcript<br/>+ timestamps .-> WORKER
    EXT --> EX_IMG[Claude vision]
    EX_IMG -. OBSERVED block .-> WORKER

    WORKER -->|insert N rows<br/>into document_pages| PG
    WORKER -->|flip status='extracted',<br/>maybe finalize ingestion| PG
    WORKER -.->|hand off| LEDGER[ledger lane<br/>builds graph]
    LEDGER -->|nodes + edges| PG
```

That's everything. The rest of this document zooms in on each piece.

---

## 2. Where things live

Two storage systems, with **deliberate** separation:

```mermaid
flowchart TB
    subgraph B2[Backblaze B2 — raw bytes only]
        direction TB
        OBJECTS["cases/&lt;case_id&gt;/&lt;sha256&gt;-&lt;filename&gt;<br/>(PDF, DOCX, MP3, JPG, etc.)"]
    end

    subgraph PG[Supabase Postgres — all structure]
        direction TB
        CASES[cases<br/>id, case_id, title, jurisdiction,<br/>ingestion_complete, ledger_complete,<br/>finalized, metadata jsonb]
        DOCS[documents<br/>id, case_id, filename, sha256,<br/>storage_key, status, retry_count]
        PAGES[document_pages<br/>id, document_id, page_number,<br/>extracted_text, char_count,<br/>extraction_metadata jsonb]
        STATUTES[statutes<br/>statute_id, jurisdiction, title, text]
        NODES[nodes<br/>case_id, node_id F1/P1/...,<br/>type, verbatim_quote,<br/>source_document_id, source_page]
        EDGES[edges<br/>case_id, from_id, to_id, type,<br/>mentioned_in/corroborates/...]
        RUNS[runs<br/>id, case_id, mode, status,<br/>started_at, duration_ms]
        TRANSCRIPT[transcript<br/>run_id, seq, agent_name, kind, content]
        DECISIONS[decisions<br/>run_id, fault %, recovery $,<br/>fault_table, letter, audit_hash]
    end

    OBJECTS -.referenced by.-> DOCS
    DOCS -->|child rows| PAGES
    CASES -->|child| DOCS
    CASES -->|child| NODES
    CASES -->|child| EDGES
    CASES -->|child| RUNS
    RUNS -->|child| TRANSCRIPT
    RUNS -->|child| DECISIONS
    NODES -->|source_document_id FK| DOCS
```

**Plain-English rule:** Backblaze is the file cabinet — the original document
exactly as the user uploaded it, untouched, byte-for-byte. Supabase is the
research notebook — everything we derived from those files (the text, the
facts, the graph, the debate transcript, the final decision). Either side can
be rebuilt from the other if needed: Postgres without B2 means the agents
still have text to argue over; B2 without Postgres means we can re-extract
from scratch.

**The naming convention in B2** (`cases/<case_id>/<sha256>-<filename>`) gives
us three things for free:
- Files of the same case live in the same folder — easy to inspect manually.
- The SHA-256 prefix makes uploads idempotent — re-uploading the same file
  produces the same key, no duplicate storage.
- The original filename is preserved, so a human downloading the file later
  sees `police_report.pdf` not `a7f3e9c2.pdf`.

---

## 3. The journey of one file — sequence diagram

This is the timeline of what happens between a user dragging `police_report.pdf`
onto the UI and the case detail page showing "Extracted ✓ · 4 pages".

```mermaid
sequenceDiagram
    autonumber
    participant U as User browser
    participant N as Next.js UI
    participant API as FastAPI :8000
    participant B2 as Backblaze B2
    participant DB as Supabase
    participant R as Redis (arq)
    participant W as Worker

    U->>N: drop police_report.pdf
    N->>N: compute SHA-256 of the bytes<br/>(crypto.subtle.digest, in browser)
    N->>API: POST /api/ingest/sign-upload<br/>{case_id, filename, mime, size, sha256}
    API->>DB: INSERT documents row<br/>status='pending'
    API->>B2: presign PUT URL<br/>(valid 5 min)
    API-->>N: {document_id, upload_url, headers, storage_key}

    Note over N,B2: Backend is OUT of the upload path.<br/>The browser uploads directly to B2.
    N->>B2: PUT bytes<br/>Content-Type: application/pdf
    B2-->>N: 200 OK, ETag

    N->>API: POST /api/ingest/commit {document_id}
    API->>B2: HEAD object (confirm it exists)
    API->>DB: UPDATE documents<br/>status='uploaded'
    API->>R: enqueue extract_document(doc_id)
    API-->>N: 200 OK, status='uploaded'

    Note over N,API: UI now polls /api/ingest/status/{case_id} every 1.5s while non-terminal

    R->>W: pop job (extract_document)
    W->>DB: UPDATE documents status='extracting'
    W->>B2: GET object bytes
    B2-->>W: PDF bytes
    W->>W: route by MIME → PdfExtractor<br/>pdfplumber extracts 4 pages
    W->>DB: bulk INSERT 4 document_pages rows<br/>(page_number, extracted_text, metadata)
    W->>DB: UPDATE documents<br/>status='extracted', page_count=4,<br/>extraction_duration_ms, ingested_at
    W->>DB: maybe_finalize_ingestion(case_id)<br/>(WHERE-guarded UPDATE: only flips iff<br/>every doc in case is 'extracted')

    alt this was the LAST doc for the case
        DB-->>W: returns updated row<br/>ingestion_complete now TRUE
        W->>R: enqueue run_ledger_build(case_id)
    else more docs still extracting
        DB-->>W: no row (already true or some doc still pending)
    end

    Note over R,W: Ledger build is the NEXT lane<br/>(see backend/ledger/service.py)
```

The two-phase upload **(direct browser → B2, then a separate commit)** is on
purpose. If the backend streamed every file's bytes through itself, the
FastAPI process would chew through bandwidth and memory for nothing — and a
50 MB upload would stall the API event loop for seconds. Pre-signed PUT URLs
let the bytes go straight to the storage layer; the API only handles small
JSON requests.

---

## 4. Format-by-format: what each extractor actually does

The `Extractor` protocol is intentionally tiny:

```python
class Extractor(Protocol):
    mime_types: tuple[str, ...]
    def extract(self, file_bytes: bytes, *, filename: str) -> ExtractedDocument: ...
```

`ExtractedDocument` is a list of `ExtractedPage(page_number, text, metadata)`.
Every format produces this same shape; the orchestration downstream doesn't
care which format the page came from.

```mermaid
flowchart LR
    BYTES[file bytes] --> MIME{MIME type}

    MIME -->|application/pdf| PDF[PdfExtractor]
    MIME -->|application/vnd.openxmlformats-officedocument.wordprocessingml.document| DOCX[DocxExtractor]
    MIME -->|application/vnd.openxmlformats-officedocument.spreadsheetml.sheet| XLSX[ExcelExtractor]
    MIME -->|text/html| HTML[HtmlExtractor]
    MIME -->|text/plain or text/markdown| TXT[TextExtractor]
    MIME -->|audio/*| AUDIO[AudioExtractor]
    MIME -->|image/*| IMG[ImageExtractor]

    PDF -->|page_text per PDF page| OUT[ExtractedDocument<br/>pages: list of ExtractedPage]
    DOCX -->|paragraphs grouped by H1| OUT
    XLSX -->|one page per sheet, TSV body| OUT
    HTML -->|cleaned text| OUT
    TXT -->|raw text, one page| OUT
    AUDIO -->|transcript + segments| OUT
    IMG -->|OBSERVED block| OUT
```

### 4.1 PDF (native — `pdfplumber`)

For a born-digital PDF (most subrogation paperwork), `pdfplumber` reads the
page object and returns the text exactly as it sits in the PDF's content
stream. One `ExtractedPage` per PDF page. `page_number` is 1-indexed and
matches what a human sees in Acrobat. `metadata` stores the page width/height
in PDF points, plus `extraction_method: "native"` so the UI can label it.

### 4.2 PDF (scanned — `pdfplumber` → `ocrmypdf` fallback)

Police reports are often faxed and re-scanned. They look like PDFs but the
"text" is just pixels. `pdfplumber` returns an empty string for those pages.

The extractor catches this:

```mermaid
flowchart TD
    START[PDF bytes arrive] --> NATIVE[pdfplumber pass]
    NATIVE --> CHECK{total chars &lt; 100<br/>OR &gt; 50% pages empty?}
    CHECK -->|no — clean digital PDF| EMIT_NATIVE[emit pages,<br/>extraction_method='native']
    CHECK -->|yes — looks scanned| HAS_OCR{ocrmypdf<br/>+ tesseract + gs<br/>installed?}
    HAS_OCR -->|no| FLAG[emit empty pages<br/>with warning in metadata]
    HAS_OCR -->|yes| OCR[ocrmypdf subprocess<br/>--rotate-pages --deskew --clean<br/>--skip-text]
    OCR --> RE_RUN[re-run pdfplumber<br/>on the OCR'd PDF]
    RE_RUN --> MERGE[per page: prefer native text if non-empty,<br/>otherwise OCR text]
    MERGE --> EMIT_HYBRID[emit pages,<br/>extraction_method='ocr' or 'hybrid']
```

`ocrmypdf` is a wrapper around Tesseract that produces a new PDF with the
OCR'd text **baked into the PDF itself** as an invisible text layer. We then
re-run pdfplumber against that new PDF, so the downstream code path is
identical to a native PDF. Each page records `extraction_method: "ocr"` (or
`"hybrid"` for PDFs that have some native text pages and some scanned pages).

The UI can show a small "OCR" badge on Fact cards whose source page is OCR'd,
so a human reviewer knows the substring anchor is one layer removed from raw
text.

### 4.3 DOCX (`python-docx`)

Word documents don't have natural "pages" until they're printed. We treat
each Heading 1 boundary as a page break. If the document has no H1s, the
whole thing is one page. Tables get rendered as TSV inline, same as Excel.

### 4.4 Excel (`python-calamine`)

Spreadsheets are tabular — agents read them as TSV (tab-separated, one row
per line). Tabs instead of commas because money/dates/addresses routinely
contain commas, and quoting would break the substring invariant downstream.

One `ExtractedPage` per worksheet. Hidden sheets are still extracted (insurance
templates often hide working tabs that contain the actual numbers) but tagged
in metadata. Sheets with more than 600 rows get **head+tail truncation**: first
500 rows, an explicit `... 12,345 rows omitted ...` marker, last 100 rows.

Why python-calamine and not openpyxl: it's a Rust extension, 5–10× faster,
50× less memory, and always returns cached formula values (so a column of
`=SUM(...)` formulas shows the actual totals, not the formula strings).

### 4.5 HTML (`BeautifulSoup`)

Strip script/style tags, collapse whitespace, preserve heading structure.
One page per file (or per H1 if the document is huge).

### 4.6 Plain text & Markdown (`TextExtractor`)

Decode UTF-8, one page. Markdown is plain text from the LLM's perspective —
agents read `# Heading` and `- bullet` just fine. No renderer needed.

### 4.7 Audio (OpenAI Whisper — `whisper-1`)

Dispatch calls, recorded statements. The extractor sends the audio bytes to
OpenAI Whisper with `response_format=verbose_json, timestamp_granularities=[segment]`,
which gives us the transcript text PLUS a list of `(start_sec, end_sec, text)`
segments — typically 2-8 second chunks.

```mermaid
flowchart LR
    A[mp3/wav/m4a bytes] --> S{size &lt;= 25 MB?}
    S -->|yes| ONE[1 chunk<br/>upload as-is]
    S -->|no| TRANSCODE[ffmpeg → mono mp3 32 kbps]
    TRANSCODE --> S2{still &gt; 25 MB?}
    S2 -->|no| ONE
    S2 -->|yes| SEGMENT[ffmpeg segment_time=900s<br/>=15-min chunks]
    SEGMENT --> MANY[N chunks<br/>each with chunk_start_sec offset]
    ONE --> WHISPER[POST to Whisper API<br/>verbose_json + segments]
    MANY --> WHISPER
    WHISPER --> PAGES[1 page per chunk<br/>text = transcript<br/>metadata.segments = list]
```

Each page's metadata carries the full segment list. A Fact citing a quote
that lives in segment `{start: 222.4, end: 230.1, text: "Blake admits running the red"}`
resolves to `(222.4 sec, 230.1 sec)` in the original recording — and the UI
can build a "click to play this clip" feature on top of that pointer.

Limits: 25 MB Whisper hard cap (we chunk above that), 60-min hard cap on
total duration (a 4-hour upload by mistake would cost $1.44 in Whisper credits —
we reject those before sending). `prompt` parameter is preloaded with
insurance vocabulary ("CVC, comparative negligence, demand letter, etc.")
which biases Whisper toward correctly spelling proper nouns and statute codes.

### 4.8 Image (Claude Sonnet 4.6 vision)

Crash scene photos, damage photos, scanned forms, screenshots. The extractor
sends the image to Claude with a **forced two-block prompt** that returns:

```
OBSERVED:
- Silver sedan, front-end damage to driver-side wheel well.
- Traffic light visible, showing a red signal.
- Two vehicles in the intersection, near-perpendicular impact angle.
…

NOT_VISIBLE:
- Driver identity.
- Which vehicle entered the intersection first.
- Vehicle speeds at impact.
…
```

The `OBSERVED:` block becomes the page text. The `NOT_VISIBLE:` block is
stored in metadata.

**Why the two-block split is the magic trick:** in a single-block prompt,
the model might smuggle in speculation ("the silver car appears to have been
speeding"). The Fact Gate would happily substring-match that quote — speculation
laundered as observation. With the split, any Fact whose `verbatim_quote`
substring-matches inside `NOT_VISIBLE:` is **caught by code** in a quick
regex post-check, not by trusting the model's discipline.

Preprocessing: Pillow resizes images > 2000px on the long side (Anthropic
charges per-image tokens which scale with dimensions; resizing is free token
savings without quality loss). Images with transparency are saved as PNG;
everything else as JPEG quality 85.

---

## 5. Where derived data ends up — table by table

```mermaid
erDiagram
    cases ||--o{ documents : has
    documents ||--o{ document_pages : has
    cases ||--o{ runs : has
    runs ||--o{ transcript : has
    runs ||--|| decisions : produces
    cases ||--o{ nodes : has
    cases ||--o{ edges : has
    nodes }o--|| documents : "anchored to (source_document_id)"

    cases {
        uuid id PK
        text case_id
        text title
        text jurisdiction
        bool ingestion_complete
        bool ledger_complete
        bool finalized
        jsonb metadata
    }
    documents {
        uuid id PK
        uuid case_id FK
        text filename
        text sha256
        text storage_key
        text status
        int page_count
        text extraction_error
    }
    document_pages {
        uuid id PK
        uuid document_id FK
        int page_number
        text extracted_text
        int char_count
        jsonb extraction_metadata
    }
    nodes {
        uuid id PK
        uuid case_id FK
        text node_id
        text type
        text verbatim_quote
        uuid source_document_id FK
        int source_page_number
        jsonb props
    }
```

For every uploaded file, the system writes:

1. **One `documents` row.** Carries the SHA-256, the B2 storage key, the
   filename, the status, retry count, page count, errors.
2. **N `document_pages` rows.** One per logical page. Carries the actual
   extracted text + format-specific metadata in JSONB.
3. **(Later, after the ledger lane runs)** **N more `nodes` rows** for Facts
   extracted from those pages, each with a `verbatim_quote` and a foreign
   key back to the source `documents` row + the page number.

The `extraction_metadata` JSONB column on `document_pages` is the escape
hatch — every format puts different things there:

| Format | Typical `extraction_metadata` |
|---|---|
| PDF (native) | `{width, height, extraction_method:"native", source_location:"p. 4"}` |
| PDF (scanned) | `{extraction_method:"ocr", ocr_engine:"tesseract", source_location:"p. 4 (OCR'd)"}` |
| Excel | `{sheet_name:"Line Items", row_count:42, hidden:false, truncated:false, source_location:"sheet:Line Items"}` |
| Audio | `{model:"whisper-1", language:"english", duration_sec:412.3, segments:[{start,end,text},…], chunk_start_sec:0.0, source_location:"00:00-06:52 in dispatch.mp3"}` |
| Image | `{vision_model:"claude-sonnet-4-6", image_size_px:[1600,1200], not_visible:"- Driver identity\\n- …", refusal_detected:false, source_location:"image:scene.jpg"}` |

Notice `source_location` appears on every format. It's a **single human-readable
pointer** back to where in the original file the page text came from — `"p. 4"`,
`"sheet:Line Items"`, `"00:32-04:18 in dispatch.mp3"`, `"image:scene.jpg"`.
The UI uses this string when rendering Fact cards: a citation `[F3]` will show
`F3 · police_report.pdf · p. 4` next to the verbatim quote.

---

## 6. The Fact Gate — why the source-anchoring guarantee matters

The whole point of putting deterministic text in `document_pages.extracted_text`
is that **downstream, when agents argue about the case, every Fact they cite
must contain a verbatim quote that is a contiguous substring of that text.**

```mermaid
flowchart LR
    PAGES[document_pages.extracted_text]
    LEDGER[ledger lane<br/>LLM extracts Fact nodes]
    FACT["Fact node F3:<br/>verbatim_quote = 'Vehicle 2 (Blake)<br/>entered the intersection<br/>against a steady red signal'"]
    GATE{Fact Gate<br/>code, not prompt}

    PAGES --> LEDGER
    LEDGER --> FACT
    FACT --> GATE
    PAGES -.is the quote a substring?.-> GATE
    GATE -->|YES, contiguous substring| OK[fact accepted<br/>agents can cite it]
    GATE -->|NO| REJECT[fact rejected,<br/>ledger fails,<br/>case escalates]
```

In Python it's literally `normalize(verbatim_quote) in normalize(page_text)`.
No LLM call, no fuzzy matching. The model can't talk its way past it.

**This is why every new format has to produce DETERMINISTIC TEXT first.** If
we let the LLM see the audio bytes directly and emit Facts about them, there'd
be no `extracted_text` to anchor against. So we always go:

```
raw bytes → deterministic extraction → page text → orchestration sees text only
```

For images and audio there's no native text — so we adopt the **production
RAG pattern** (Harvey, Casetext, Hebbia, GraphRAG): the model's deterministic
description IS the canonical page text, and citations substring-anchor against
the description. The Fact Gate's guarantee shifts from "this quote exists in
the file" to "this quote exists in what the vision/transcription model
deterministically said the file contains" — weaker, but still code-enforced,
still consistent across formats, still not subject to the agent's discretion.

The two-block image prompt makes this even better: it catches speculation by
syntax (`verbatim_quote` matching inside `NOT_VISIBLE:` = gate violation),
not by trusting the model not to speculate.

---

## 7. The read path — how the orchestration loads a case

When the user clicks "Open the room" on a case, the orchestration needs all
this back as a coherent `ClaimInput`:

```mermaid
flowchart LR
    UI[user clicks<br/>Open the room]
    API[GET /api/run/&lt;case_uuid&gt;]
    ADAPTER[load_run_inputs case_uuid]
    REPO[IngestionRepository]
    LEDGER_REPO[Ledger reader]

    UI --> API
    API --> ADAPTER
    ADAPTER --> REPO
    REPO -->|SELECT * FROM cases WHERE id=?| PG1[(cases)]
    REPO -->|SELECT * FROM documents WHERE case_id=?| PG2[(documents)]
    REPO -->|SELECT extracted_text FROM document_pages<br/>JOIN documents ON …| PG3[(document_pages)]
    REPO -->|SELECT * FROM statutes WHERE jurisdiction=?| PG4[(statutes)]
    ADAPTER --> LEDGER_REPO
    LEDGER_REPO -->|SELECT * FROM nodes WHERE case_id=?| PG5[(nodes)]
    LEDGER_REPO -->|projection: nodes type='Fact' → Fact list| EVL[EvidenceLedger]
    ADAPTER --> CLAIM[ClaimInput:<br/>caseId, insured, otherParty,<br/>documents: per-doc concatenated text]
    CLAIM --> RUN[run_lumen]
    EVL --> RUN
    RUN -->|stream postings via SSE<br/>persist to transcript table| PG6[(runs, transcript, decisions)]
```

Three plain-English steps:

1. **Reconstruct the claim shape from the database.** Loop over the documents,
   join their pages in `page_number` order, concatenate the text per doc.
   Each `Document(name=filename, kind=document_kind, text=joined_pages)`.
2. **Project the locked ledger graph into an `EvidenceLedger`.** Read all
   `nodes` rows for the case, filter to type='Fact', map each Fact's
   `verbatim_quote` + `source_document.filename` into the flat `Fact(id,
   statement, source, verbatimQuote, confidence)` shape the orchestration
   consumes.
3. **Run the orchestration.** Eight agents debate over the in-memory
   `ClaimInput` + `EvidenceLedger`. Every fact ID they cite is verified by
   the Citation Gate (must be in the ledger); every claim's verbatim_quote
   was already verified by the Fact Gate when the ledger was built.

The agents never see Backblaze. The agents never see image bytes or audio
files. They only see the extracted page text and the Fact graph derived from
it.

---

## 8. Failure modes — what happens when things go wrong

The pipeline has explicit failure paths at every step. Each one preserves
audit-ability and lets the case keep moving instead of getting stuck.

| Where it can fail | What happens | What the user sees |
|---|---|---|
| Browser → B2 PUT fails | `xhr.onerror` fires, frontend marks the file `stage='failed'` with the network error | Red "Failed" badge with the network error inline |
| `/api/ingest/commit` HEAD returns 404 | Service raises `LookupError` → routes returns HTTP 404 | Red "Failed" badge: "Object not found in storage — was the upload completed?" |
| Worker extractor raises (corrupt PDF, unsupported MIME) | Service classifies as transient or permanent. Transient → arq retries (up to 3) with backoff. Permanent → status='failed', error stored on the row | UI polls and shows "Failed" with the specific error |
| Audio file > 25 MB AND no ffmpeg | `RuntimeError("ffmpeg required for files > 25 MB")` → permanent failure | "Failed: ffmpeg required" — clear actionable error |
| Scanned PDF AND ocrmypdf unavailable | Pages return empty native text; document is still inserted, but `extraction_metadata.warning` flags it | Document is "Extracted" but with `0 chars`; human reviewer notices and can re-upload after installing OCR deps |
| Whisper API down | httpx raises → service marks transient → arq retries with backoff (1s, 2s, 4s) | UI shows "Extracting" with `retry_count: 2` indicator |
| Claude vision refuses ("I cannot identify people in this image") | The OBSERVED block contains the refusal text; the extractor detects this with a regex and sets `metadata.refusal_detected: true` | Page is extracted but tagged so the ledger lane can skip it; future UI shows a yellow "vision refused" pill |
| Ledger build fails after ingestion | `ingestion_complete=true` stays, `ledger_complete=false` stays; the Argument Room stays locked with a clear "ledger build failed, retry?" CTA | User sees ingestion done but room locked; can re-trigger ledger build |
| Orchestration run cancelled mid-debate (user closes tab) | `asyncio.CancelledError` caught in `drive()` → `run_repo.complete_run(status='failed', error='cancelled (client disconnected)')` via `asyncio.shield` | Next page load shows the run as "FAILED · cancelled (client disconnected)" — no zombie 'running' rows |
| Stuck 'running' run (process died hard) | Self-healing sweep in `list_runs_for_case` marks any `running` run older than 3 minutes as `failed (stale)` on the next read | UI auto-recovers on next page load |

---

## 9. The quick-reference cheat sheet

**Where do raw uploaded bytes live?** Backblaze B2, keyed by
`cases/<case_id>/<sha256>-<filename>`. Original bytes, unmodified.

**Where does derived text live?** Supabase Postgres, in `document_pages.extracted_text`.
One row per logical page.

**Where does format-specific extra information live?** `document_pages.extraction_metadata`
JSONB. Audio segments, sheet names, OCR confidence, image dimensions, vision
model used, NOT_VISIBLE blocks — all in there.

**Where does the knowledge graph live?** `nodes` + `edges` tables. Each Fact
node has a `verbatim_quote` that's a contiguous substring of a page's
`extracted_text`, plus a foreign key back to the source document.

**Where do agent debates live?** Each run is one `runs` row + N `transcript`
rows (in posting order) + one `decisions` row.

**Where does the demand letter live?** `decisions.letter` (full text) +
`decisions.audit_hash` (SHA-256 of the persisted transcript + decision rows,
tamper-evident).

**What's the single architectural rule that ties this together?**
*Every Fact agents cite in the debate must contain a verbatim_quote that's a
contiguous substring of some page's deterministically-extracted text.* Every
format we add must respect this. The audit chain — Fact → quote → page →
document → B2 object — never breaks.

---

*End of doc. If you want to trace one specific file in production, the
fastest path is:*
1. *Find the document's row: `SELECT * FROM documents WHERE filename = '…'`*
2. *Read its pages: `SELECT page_number, char_count FROM document_pages WHERE document_id = '…' ORDER BY page_number`*
3. *Find every Fact derived from it: `SELECT n.* FROM nodes n WHERE n.source_document_id = '…'`*
4. *Pull the raw bytes from B2 if needed: `aws s3 cp s3://lumen-case-files/cases/<id>/<sha>-<name> .`*
