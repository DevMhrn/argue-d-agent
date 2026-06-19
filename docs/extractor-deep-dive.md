# Lumen — Per-Format Parser Deep Dive

> Companion to `docs/ingestion-flow.md`. The flow doc shows you the *path*;
> this one zooms in and explains, in plain English, exactly what each
> parser does — what bytes go in, what transformations happen, what text
> comes out, and where every piece of it ends up in the database.
>
> The three formats that need careful attention are **images, audio, and
> scanned PDFs** because they involve external API calls or system binaries.
> The other five (native PDF, DOCX, Excel, HTML, markdown/plain text) are
> deterministic library calls and we cover those briefly at the end.

---

## Quick recap: the shape every parser produces

Every parser returns the same shape regardless of the input format:

```
  ExtractedDocument
  +-------------------------------------+
  |  pages: list of ExtractedPage       |
  |  document_metadata: dict (optional) |
  +-------------------------------------+

  ExtractedPage
  +-------------------------------------+
  |  page_number    : int (1-indexed)   |
  |  text           : str               |
  |  metadata       : dict (free-form)  |
  +-------------------------------------+
```

The `text` field is what the orchestration agents will read and what the
Fact Gate will substring-check against. The `metadata` field is the JSONB
escape hatch — format-specific extras live there (audio segment timestamps,
Excel sheet names, image dimensions, OCR confidence, the NOT_VISIBLE block
for images, and so on).

Each `ExtractedPage` becomes one row in the `document_pages` table:

```
  document_pages (Supabase Postgres)
  +-----------------------+
  | id (uuid)             |
  | document_id (uuid) FK |
  | page_number   (int)   |
  | extracted_text (text) |  <-- the ExtractedPage.text goes here
  | char_count    (int)   |
  | extraction_metadata   |  <-- the ExtractedPage.metadata goes here (JSONB)
  | created_at, updated_at|
  +-----------------------+
```

Now the deep dives.

---

## 1. Image parser — the trickiest one

### What we're solving

An image file — let's say `crash-scene.jpg`, 3.2 MB, 4032 × 3024 pixels —
contains no text. The downstream Fact Gate requires every Fact's
`verbatim_quote` to be a substring of `document_pages.extracted_text`. So
**we need to manufacture text** that:

1. Faithfully describes the image content.
2. Is deterministic enough that the LLM ledger builder can extract Facts
   from it.
3. Has a *syntactic* boundary between what's observed vs what's speculative —
   so the Fact Gate can mechanically catch attempts to cite speculation.

We use Claude Sonnet 4.6 vision and force the response into two blocks
(`OBSERVED:` and `NOT_VISIBLE:`). The OBSERVED block becomes the page text;
the NOT_VISIBLE block goes into metadata. A regex post-check can flag any
Fact whose `verbatim_quote` lands inside the NOT_VISIBLE region.

### The byte-by-byte path

```
                                                    backend/ingestion/extractors/image.py
   raw bytes (e.g. 3.2 MB JPEG)
        |
        |  1.  Pillow opens the bytes
        v
   +-----------------------------+
   |  PIL.Image.open(io.BytesIO) |
   |  --> img.size = (4032, 3024)|
   +-----------------------------+
        |
        |  2.  Resize the longer side to 2000 px (LANCZOS)
        |      Why: Anthropic charges per-image tokens that scale
        |      with image dimensions. 2000 px is the sweet spot
        |      where vision quality is preserved but tokens drop.
        v
   +-----------------------------+
   |  new size: 2000 x 1500      |
   +-----------------------------+
        |
        |  3.  Re-encode: PNG if image has alpha,
        |      else JPEG quality=85
        v
   +-----------------------------+
   |  out_bytes (~ 350 KB)       |
   |  media_type = "image/jpeg"  |
   +-----------------------------+
        |
        |  4.  Wrap as base64 + build Anthropic message
        v
   +--------------------------------------------------+
   | POST https://api.anthropic.com/v1/messages       |
   |   x-api-key: <ANTHROPIC_API_KEY>                 |
   |   anthropic-version: 2023-06-01                  |
   |                                                  |
   |   {                                              |
   |     "model": "claude-sonnet-4-6",                |
   |     "max_tokens": 1024,                          |
   |     "system": <SYSTEM_PROMPT, see below>,        |
   |     "messages": [{                               |
   |       "role": "user",                            |
   |       "content": [                               |
   |         { "type": "image",                       |
   |           "source": {                            |
   |             "type": "base64",                    |
   |             "media_type": "image/jpeg",          |
   |             "data": "<base64-encoded bytes>"     |
   |           } },                                   |
   |         { "type": "text",                        |
   |           "text": "Describe this evidence ..." } |
   |       ]                                          |
   |     }]                                           |
   |   }                                              |
   +--------------------------------------------------+
        |
        |  5.  Claude reads system prompt + image + user text
        v
   +-------------------------------------------------------+
   |  API response, content blocks                          |
   |  --> we concat all the "text" type blocks              |
   |      and get one big string                            |
   +-------------------------------------------------------+
        |
        |  6.  Split into OBSERVED / NOT_VISIBLE via regex
        |      ^\s*(OBSERVED|NOT_VISIBLE)\s*:\s*$
        v
   +-------------------------------------------------------+
   |  observed_text: "- Silver four-door sedan ..."         |
   |  not_visible : "- Driver identity ..."                 |
   +-------------------------------------------------------+
        |
        |  7.  Refusal detector: regex over observed_text for
        |      "I cannot", "I can't", "unable to interpret",
        |      "image is unreadable" + length < 30
        v
   +-------------------------------------------------------+
   |  refusal_detected: false                               |
   +-------------------------------------------------------+
        |
        v
   ExtractedDocument(
     pages=[ ExtractedPage(
                 page_number = 1,
                 text        = observed_text,
                 metadata    = {
                   "extractor"        : "image",
                   "vision_model"     : "claude-sonnet-4-6",
                   "image_size_px"    : (2000, 1500),
                   "not_visible"      : not_visible,
                   "refusal_detected" : false,
                   "source_location"  : "image:crash-scene.jpg"
                 }
             ) ],
     document_metadata={"extractor":"image", "vision_model":"claude-sonnet-4-6"}
   )
```

### The system prompt — the trick that makes the harness work

```
You analyze a single image submitted as evidence in a vehicle subrogation
claim.

Return EXACTLY two blocks, in this order, separated by one blank line.
Do not add a preamble or commentary outside these blocks.

OBSERVED:
- One short factual bullet per line. Describe ONLY what is visually present.
- Cover: vehicles (make/color/position), visible damage (location and
  severity), road conditions, traffic signals or signage if visible, weather
  indicators, license plates if readable (transcribe exactly), people if
  visible (count only, no identification), time-of-day cues.
- Each bullet must be a single sentence under 25 words. Use neutral
  language. No inferences.

NOT_VISIBLE:
- One short bullet per line stating what you CANNOT determine.
- Cover: driver identity, fault/cause, speed, who-entered-first, anything
  obscured, anything outside the frame.
- Be explicit; if a category does not apply write "n/a".

Refuse to speculate. If the image cannot be interpreted, reply with the
two blocks anyway and put "image is unreadable" as the only OBSERVED bullet.
```

**Why the two-block structure is load-bearing**: in a single-block prompt
the model might slip a speculative claim into the description ("the silver
car appears to have been speeding"). The Fact Gate would happily
substring-match a downstream Fact that cited that phrase — speculation
laundered as fact. With the split, **a Fact's quote landing inside
`NOT_VISIBLE:` is a regex-detectable gate violation in post-processing**.
The harness catches speculation by syntax, not by trusting the model's
discipline.

### What actually lands in the database

For one uploaded `crash-scene.jpg`, one `documents` row + one
`document_pages` row:

```
documents
+-------+------------+--------------+----------+-------+----------------------+
|  id   |  filename  |  mime_type   |  status  | pages | storage_key          |
+-------+------------+--------------+----------+-------+----------------------+
| 7a... | crash.jpg  | image/jpeg   | extract. |   1   | cases/<case>/<sha>-..|
+-------+------------+--------------+----------+-------+----------------------+

document_pages
+--------+------+--------------------------+--------+---------------------------+
| doc_id | page | extracted_text (excerpt) | chars  | extraction_metadata       |
+--------+------+--------------------------+--------+---------------------------+
| 7a...  |  1   | "- Silver four-door      |   ~280 | {                         |
|        |      |    sedan, front-end      |        |   "extractor":"image",    |
|        |      |    damage to driver-     |        |   "vision_model":         |
|        |      |    side wheel well.      |        |     "claude-sonnet-4-6",  |
|        |      |  - Traffic light visi-   |        |   "image_size_px":        |
|        |      |    ble, showing a red    |        |     [2000, 1500],         |
|        |      |    signal.               |        |   "not_visible":          |
|        |      |  - Two vehicles in the   |        |     "- Driver identity..." |
|        |      |    intersection ..."     |        |   "refusal_detected":     |
|        |      |                          |        |     false,                |
|        |      |                          |        |   "source_location":      |
|        |      |                          |        |     "image:crash.jpg"     |
|        |      |                          |        | }                         |
+--------+------+--------------------------+--------+---------------------------+
```

The **raw JPEG bytes stay in Backblaze B2** at the storage_key. They are
*never* mutated. If you want to swap vision models a year from now (Claude
5.0? Gemini 3.0?), re-run the extractor against the bytes still in B2 and
overwrite the `document_pages` row.

### Limits, costs, failure modes

- **Max input**: 10 MB base64 before sending. We auto-resize beyond
  2000 px; if the resized JPEG is still over 9 MB we drop quality to 65;
  if still over, we raise `RuntimeError("Image too large after resize")`
  and the document is marked failed.
- **Token cost**: ~$0.0035 input + ~$0.0015 output for a 1100 × 1100
  image at Sonnet 4.6 rates. About **half a cent per image**.
- **Refusal handling**: if Claude refuses or the OBSERVED block is
  shorter than 30 chars, `refusal_detected: true` is set in metadata.
  The document is still inserted (audit trail), but the ledger lane is
  expected to skip Facts from pages flagged this way.
- **Format support**: image/jpeg, image/png, image/webp, image/gif.
- **Mock mode** (no `ANTHROPIC_API_KEY`): returns a canned five-bullet
  OBSERVED block describing a fictional red-light T-bone scene. Useful for
  exercising the full pipeline without API spend.

---

## 2. Audio parser — chunking is the hard part

### What we're solving

A 22-minute dispatch call recording weighs in at, say, 38 MB. OpenAI's
Whisper API has a hard 25 MB upload limit. We need to:

1. Get the bytes under 25 MB.
2. Preserve the **timestamps** of the original recording (so a Fact citing
   "at 04:32 the driver admits running the red" resolves to a real point
   in the file).
3. Hard-cap the total duration to prevent surprise bills (Whisper is
   $0.006/min — a 4-hour upload by mistake is $1.44).

### The byte-by-byte path for a typical case (file under 25 MB)

The simple case first — most dispatch calls are 5-15 minutes and well
under 25 MB:

```
   raw bytes (12 MB mp3, ~20 min)
        |
        |  size check: 12 MB <= 25 MB --> no transcoding needed
        v
   +--------------------------------------------------+
   | POST https://api.openai.com/v1/audio/             |
   |      transcriptions                               |
   |   Authorization: Bearer <OPENAI_API_KEY>          |
   |                                                   |
   |   multipart/form-data:                            |
   |     file = (filename, audio_bytes, octet-stream)  |
   |     model = "whisper-1"                           |
   |     response_format = "verbose_json"              |
   |     timestamp_granularities[] = "segment"         |
   |     prompt = "Insurance subrogation claim;        |
   |               vehicles, intersection, traffic     |
   |               signal, CVC, CHP, fault..."         |
   |     temperature = "0"                             |
   +--------------------------------------------------+
        |
        |  Whisper transcribes (takes ~15-30 sec)
        v
   +--------------------------------------------------+
   |  Response (verbose_json):                         |
   |  {                                                |
   |    "task":"transcribe",                           |
   |    "language":"english",                          |
   |    "duration": 1203.42,                           |
   |    "text": "Dispatch, this is unit 12 ...         |
   |             we have a collision at 5th and ...    |
   |             Vehicle 2 driver admits running       |
   |             the red ...",                         |
   |    "segments": [                                  |
   |      {"id":0, "start":0.00, "end":6.40,           |
   |       "text":"Dispatch, this is unit 12."},       |
   |      {"id":1, "start":6.40, "end":14.72,          |
   |       "text":"We have a collision at 5th..."},    |
   |      ...                                          |
   |      {"id":42, "start":268.10, "end":272.30,      |
   |       "text":"Vehicle 2 driver admits..."}        |
   |    ]                                              |
   |  }                                                |
   +--------------------------------------------------+
        |
        |  Build ExtractedPage:
        |    text = response.text          (the full transcript)
        |    metadata.segments = list      (with start/end seconds)
        |    metadata.chunk_start_sec = 0  (one chunk, starts at 0)
        v
   ExtractedDocument(pages=[one page], document_metadata={...})
```

### The hard case: file > 25 MB

A 60-minute recording at high bitrate might be 80 MB. Two-step strategy:

```
   raw bytes (80 MB wav, 60 min)
        |
        v
   +-----------------------------------------+
   | Step A: transcode to mono mp3 32 kbps   |
   |   ffmpeg -i input.wav -ac 1 -ar 16000   |
   |     -b:a 32k compact.mp3                |
   +-----------------------------------------+
        |
        |  result: ~14 MB compact.mp3
        v
   +-----------------------------------------+
   | size check: 14 MB <= 25 MB --> done.    |
   | Send compact.mp3 to Whisper as one      |
   | chunk with chunk_start_sec = 0.0.       |
   +-----------------------------------------+
```

For *really* long files (compact still > 25 MB, e.g. a 3-hour recording):

```
   compact.mp3 (e.g. 32 MB, 90 min after transcode)
        |
        v
   +------------------------------------------------+
   | Step B: ffmpeg segment_time = 900 (15 minutes) |
   |   ffmpeg -i compact.mp3 -f segment             |
   |     -segment_time 900 -c copy chunk%03d.mp3    |
   +------------------------------------------------+
        |
        v
   +------------+  +------------+  +------------+  +------------+
   | chunk000   |  | chunk001   |  | chunk002   |  | chunk003   |
   | 0-900 sec  |  | 900-1800   |  | 1800-2700  |  | 2700-3600  |
   | ~5.3 MB    |  | ~5.3 MB    |  | ~5.3 MB    |  | ~5.3 MB    |
   +------------+  +------------+  +------------+  +------------+
        |              |               |               |
        v              v               v               v
   +-----------------------------------------+
   | Send each chunk to Whisper separately.  |
   | For chunk N, chunk_start_sec = N * 900. |
   | When merging segments, add the offset:  |
   |   global_start = chunk_segment.start    |
   |                  + chunk_start_sec      |
   +-----------------------------------------+
        |
        v
   ExtractedDocument(
     pages=[
       Page(page=1, text=chunk0_transcript, meta.chunk_start_sec=0.0),
       Page(page=2, text=chunk1_transcript, meta.chunk_start_sec=900.0),
       Page(page=3, text=chunk2_transcript, meta.chunk_start_sec=1800.0),
       Page(page=4, text=chunk3_transcript, meta.chunk_start_sec=2700.0),
     ],
     ...
   )
```

A 60-minute file caps at 4 pages. Each page records its own segments with
**globally-offset timestamps** — so a Fact's verbatim_quote that
substring-matches some segment's text always resolves back to a real
(start_sec, end_sec) window in the original recording.

### What lands in the database for a 22-min dispatch call

One documents row + one document_pages row (no chunking needed):

```
documents
+-------+--------------+--------------+----------+-------+
|  id   | filename     | mime_type    | status   | pages |
+-------+--------------+--------------+----------+-------+
| b3... | dispatch.mp3 | audio/mpeg   | extract. |   1   |
+-------+--------------+--------------+----------+-------+

document_pages
+--------+------+----------------------------+--------+----------------------------+
| doc_id | page | extracted_text (excerpt)   | chars  | extraction_metadata        |
+--------+------+----------------------------+--------+----------------------------+
| b3...  |  1   | "Dispatch, this is unit 12.|  ~6800 | {                          |
|        |      |  We have a collision at    |        |   "extractor":"audio",     |
|        |      |  5th Avenue and Main       |        |   "model":"whisper-1",     |
|        |      |  Street. Two vehicles      |        |   "language":"english",    |
|        |      |  involved. Vehicle 2       |        |   "duration_sec":1203.42,  |
|        |      |  driver admits running     |        |   "chunk_start_sec":0.0,   |
|        |      |  the red signal..."        |        |   "segments":[             |
|        |      |                            |        |     {"start":0.0,"end":6.4,|
|        |      |                            |        |      "text":"Dispatch,..."},|
|        |      |                            |        |     ... (200+ entries) ...,|
|        |      |                            |        |     {"start":268.1,        |
|        |      |                            |        |      "end":272.3,          |
|        |      |                            |        |      "text":"Vehicle 2     |
|        |      |                            |        |      driver admits..."}    |
|        |      |                            |        |   ],                       |
|        |      |                            |        |   "source_location":       |
|        |      |                            |        |     "00:00-20:03 in        |
|        |      |                            |        |      dispatch.mp3"         |
|        |      |                            |        | }                          |
+--------+------+----------------------------+--------+----------------------------+
```

When a Fact later substring-matches inside the segment
`{"start":268.1, "end":272.3, "text":"Vehicle 2 driver admits..."}`,
the UI can render a "play 04:28–04:32" button by reading those numbers
from `extraction_metadata.segments`.

### The vocabulary prompt — why it matters

Whisper's `prompt` parameter (max ~224 tokens) **biases the model's
vocabulary** for the rest of the transcription. By default Whisper would
transcribe "CVC twenty-one four fifty-three" as something approximating
those English words. With the prompt pre-loading insurance terms:

```
"Insurance subrogation claim; vehicles, intersection, traffic signal,
 police report, CVC, CHP, fault, comparative negligence, demand letter."
```

It correctly produces "CVC 21453" with the right punctuation, which lets
the ledger lane later create a `Statute` node that joins cleanly to the
`statutes` table.

### Limits, costs, failure modes

- **Whisper file size hard cap**: 25 MB. We transcode + chunk above that.
- **Duration hard cap**: 60 minutes (`MAX_DURATION_SEC`). Reject larger
  files upfront with a clear error. Worst-case cost = $0.36.
- **Cost**: $0.006/min. A typical 15-min dispatch call = $0.09. A
  60-minute recorded statement = $0.36.
- **ffmpeg dependency**: required only if the file > 25 MB. We
  `shutil.which("ffmpeg")` at chunk time and raise a clear error if it's
  missing. Files under 25 MB don't need ffmpeg at all.
- **Mock mode** (no `OPENAI_API_KEY`): returns a canned 5-sentence
  dispatch-call transcript with 3 fake segments. The full pipeline
  exercises end to end with zero spend.

---

## 3. Scanned PDF parser — the hybrid fallback

### What we're solving

In insurance, "PDFs" come in two flavors:

- **Native PDFs**: the kind a lawyer types in Word and exports. Text is
  embedded as glyph references in the content stream; pdfplumber reads it
  cleanly.
- **Scanned PDFs**: typically faxed police reports, photocopied insurance
  forms, or someone phone-photographed a paper document and saved as PDF.
  Each page is really an image; there is no "text" to extract.

Worse: some PDFs are **mixed** — a born-digital body with a scanned annex.
Page 1-3 are real text, pages 4-10 are scanned tables.

We need a parser that handles all three cases without the operator
choosing in advance.

### The byte-by-byte path

```
   PDF bytes
        |
        v
   +---------------------------------------+
   | Pass 1: try pdfplumber on every page  |
   |   pages_native = []                   |
   |   for page in pdf.pages:              |
   |     pages_native.append(              |
   |       page.extract_text() or "")      |
   +---------------------------------------+
        |
        v
   +------------------------------------------+
   | Compute heuristics:                      |
   |   total_chars  = sum(len(p) for p in     |
   |                       pages_native)      |
   |   empty_pages  = count of pages where    |
   |                  len(p) < 20             |
   |   empty_ratio  = empty_pages / total     |
   +------------------------------------------+
        |
        v
   +------------------------------------------+
   | needs_ocr = (total_chars < 100) OR       |
   |             (empty_ratio > 0.5)          |
   +------------------------------------------+
       /         \
      / no        \ yes
     v             v
+----------+   +-----------------------------+
| Done.    |   | Pass 2: OCR fallback        |
| Emit all |   +-----------------------------+
| pages    |              |
| with     |              |  check: ocrmypdf + tesseract + gs all on PATH?
| extr.    |              v
| method = |       +------------+    no      +-----------------------+
| "native".|       | available? |----------->| Emit empty pages with |
|          |       +------------+            | metadata.warning =    |
+----------+              | yes              | "PDF appears scanned  |
                          v                  |  but OCR unavailable" |
                  +-----------------------+  +-----------------------+
                  | Write bytes to temp:  |
                  |   /tmp/.../in.pdf     |
                  | subprocess.run([      |
                  |   "ocrmypdf",         |
                  |   "--skip-text",      |
                  |   "--rotate-pages",   |
                  |   "--deskew",         |
                  |   "--clean",          |
                  |   "--quiet",          |
                  |   in_pdf,             |
                  |   out_pdf,            |
                  | ])                    |
                  +-----------------------+
                          |
                          v
                  +-------------------------------+
                  | ocrmypdf produces a NEW PDF   |
                  | with an invisible OCR text    |
                  | layer baked into the content  |
                  | stream. Tesseract did the     |
                  | character recognition; gs     |
                  | (Ghostscript) repackages the  |
                  | PDF.                          |
                  +-------------------------------+
                          |
                          v
                  +-------------------------------+
                  | Pass 3: pdfplumber AGAIN, but |
                  | this time against the OCR'd   |
                  | PDF. Same code, same calls.   |
                  +-------------------------------+
                          |
                          v
                  +-------------------------------+
                  | Merge per page:               |
                  |   if pages_native[i] >= 20    |
                  |     chars: prefer native      |
                  |   else: use OCR'd text        |
                  | --> extraction_method per     |
                  |   page is "native" or "ocr"   |
                  | --> document-level method is  |
                  |   "hybrid" if mixed,          |
                  |   "ocr" if all-OCR            |
                  +-------------------------------+
                          |
                          v
                       ExtractedDocument(pages=[...])
```

The clever trick is in the **merge step**. For a mixed PDF (text body +
scanned annex):

```
  page 1 (born-digital)
    native chars: 1842   -->  prefer native  -->  extraction_method = "native"

  page 2 (born-digital)
    native chars: 2014   -->  prefer native  -->  extraction_method = "native"

  page 3 (born-digital)
    native chars: 1903   -->  prefer native  -->  extraction_method = "native"

  page 4 (scanned)
    native chars: 0  -->  use OCR'd text  -->  extraction_method = "ocr"

  page 5 (scanned)
    native chars: 0  -->  use OCR'd text  -->  extraction_method = "ocr"

  ...

  document-level extraction_method = "hybrid"
```

This is why `ocrmypdf` returning a **PDF with embedded text** (rather than
a plain text file) is the right shape — the downstream code path stays
identical between native and OCR'd PDFs, and you get per-page granularity
on what came from where.

### What lands in the database for a 6-page hybrid PDF

```
documents
+-------+----------------+------------+----------+-------+
|  id   |  filename      |  mime_type | status   | pages |
+-------+----------------+------------+----------+-------+
| f1... | police_rpt.pdf | applic/pdf | extract. |   6   |
+-------+----------------+------------+----------+-------+
| extraction_metadata at the document level:                |
|   { "extractor": "pdf",                                   |
|     "extraction_method": "hybrid",                        |
|     "ocr_engine": "tesseract" }                           |
+-----------------------------------------------------------+

document_pages
+--------+------+--------------------+--------+-----------------------------+
| doc_id | page | text (excerpt)     | chars  | extraction_metadata          |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  1   | "POLICE REPORT     |  1842  | { "width":612, "height":792, |
|        |      |  Case CLM-2026..." |        |   "extraction_method":       |
|        |      |                    |        |     "native",                |
|        |      |                    |        |   "source_location":"p. 1"}  |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  2   | "NARRATIVE         |  2014  | { "extraction_method":       |
|        |      |  At approximately  |        |     "native", ... }          |
|        |      |  1430 hours..."    |        |                              |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  3   | "STATEMENTS        |  1903  | { "extraction_method":       |
|        |      |  Witness 1: ..."   |        |     "native", ... }          |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  4   | "DIAGRAM —         |   456  | { "extraction_method":"ocr", |
|        |      |  Approximate       |        |   "ocr_engine":"tesseract",  |
|        |      |  Position Of       |        |   "source_location":         |
|        |      |  Vehicles..."      |        |     "p. 4 (OCR'd)" }         |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  5   | "PHOTOGRAPHS       |   217  | { "extraction_method":"ocr", |
|        |      |  Pho 1: Front      |        |     ... }                    |
|        |      |  view of veh..."   |        |                              |
+--------+------+--------------------+--------+-----------------------------+
| f1...  |  6   | "SIGNATURE         |   183  | { "extraction_method":"ocr", |
|        |      |  Officer: J.       |        |     ... }                    |
|        |      |  Rivera #4421..."  |        |                              |
+--------+------+--------------------+--------+-----------------------------+
```

The UI can show a small "OCR" pill on facts whose source page is OCR'd, so
a human reviewer knows the substring anchoring is one layer removed from
raw text.

### Detection thresholds — what we picked and why

- `total_chars < 100` → almost certainly a fully scanned doc. A
  born-digital one-page PDF has 1-3k chars even when sparse.
- `empty_ratio > 0.5` → more than half the pages are blank. Common in
  mixed PDFs where the scanned annex dominates page count.
- `PAGE_EMPTY_CHARS = 20` → a page with under 20 chars counts as empty.
  A header-only page (page number, date) has 30-50 chars; we don't want
  to flag those.

These thresholds are deliberately conservative — false negatives (failing
to OCR a scanned PDF) leave empty page text which the ledger lane will
notice; false positives (OCR-ing an already-text PDF) cost some time but
don't pollute data because the merge step prefers native text where it
exists.

### ocrmypdf flags — what each one does

```
ocrmypdf --skip-text --rotate-pages --deskew --clean --quiet in.pdf out.pdf
         |             |               |        |        |
         |             |               |        |        + suppress stdout noise
         |             |               |        +- ImageMagick noise removal
         |             |               +- straighten skewed scan
         |             +- auto-rotate based on detected text orientation
         +- DON'T re-OCR pages that already have a text layer (saves time
            and avoids double-OCR garbage)
```

### Limits, costs, failure modes

- **OCR is free** at runtime — Tesseract is a local binary. The cost is
  CPU time. A typical 4-page scanned PDF takes 5-15 seconds.
- **System dependencies**: `ocrmypdf` (pip), `tesseract` (Homebrew or
  apt), `ghostscript` (Homebrew or apt). We check all three are on PATH
  before invoking. If any is missing, we emit empty pages with a clear
  `extraction_metadata.warning`.
- **Handwriting**: Tesseract is roughly 80% accurate on clean printed
  scans, and **poor on handwriting**. For pages dominated by handwritten
  content (claimant statements, officer field notes), the right path is
  to fall through to the image extractor (Claude vision). That's a future
  refinement; today the OCR fallback handles printed scans well.
- **Mock mode**: no special path needed — the entire OCR pipeline runs
  locally, no API key.

---

## 4. The simpler formats — brief

The remaining five formats are deterministic library calls. They're
worth knowing but don't have the same architectural depth.

### 4.1 Native PDF (`PdfExtractor`, when no OCR fallback fires)

```
PDF bytes  -->  pdfplumber.open(io.BytesIO(...))  -->  loop pages
                                                         |
                                                         v
                                            page.extract_text() per page
                                                         |
                                                         v
                                              ExtractedPage per PDF page,
                                              text + (width, height) metadata
```

One `document_pages` row per PDF page. Page width/height in PDF points
(72 per inch) stored in metadata. `extraction_method = "native"`.

### 4.2 DOCX (`DocxExtractor`)

```
DOCX bytes  -->  docx.Document(io.BytesIO(...))  -->  iterate paragraphs
                                                       |
                                                       v
                                          split on Heading 1 boundaries
                                                       |
                                                       v
                                          one ExtractedPage per "page"
                                          (== H1 section, or whole doc
                                           if no H1 present)
```

DOCX has no native pages until printed — we use H1 boundaries as
synthetic page breaks. Tables get rendered as TSV inline.

### 4.3 Excel (`ExcelExtractor` via python-calamine)

```
XLSX bytes  -->  CalamineWorkbook.from_filelike(io.BytesIO(...))
                          |
                          v
                 for each sheet name:
                   sheet = wb.get_sheet_by_name(name)
                   rows  = sheet.to_python()   <-- cached values, no formulas
                   strip empty leading/trailing rows
                          |
                          v
                 render as TSV:
                          "# Sheet: <name>"
                          <header row TSV>
                          <data rows TSV>
                          (truncate head+tail if > 600 rows)
                          |
                          v
                 ExtractedPage per sheet
                   metadata: {sheet_name, row_count, hidden, truncated,
                              source_location: "sheet:<name>"}
```

python-calamine is a Rust extension — 5-10x faster than openpyxl, half
the memory, always returns cached values (so a `=SUM(B2:B40)` formula
shows the actual total, not the formula string).

**Truncation for huge sheets**: a 10,000-row spreadsheet would blow the
LLM context window. We emit the header + first 500 rows + an
explicit `# ... 9400 rows omitted ...` marker + the last 100 rows. The
omission marker is itself substring-quotable so an agent can cite "the
truncation happened here" if relevant.

### 4.4 HTML (`HtmlExtractor`)

```
HTML bytes  -->  BeautifulSoup(html, "html.parser")
                          |
                          v
                 remove <script> + <style> tags
                          |
                          v
                 .get_text(separator="\n", strip=True)
                          |
                          v
                 one ExtractedPage (whole file)
```

Simple. Strip noise, return readable text.

### 4.5 Plain text + Markdown (`TextExtractor`)

```
text/plain or text/markdown bytes
       -->  file_bytes.decode("utf-8", errors="replace")
                          |
                          v
                 one ExtractedPage, text = decoded string
                 metadata: {"extractor": "text"}
```

Markdown is plain text from the LLM's perspective. The agents read
`# Heading` and `- bullet` fine. No rendering pass needed.

---

## 5. Putting it all together — what gets stored, where, for what

To recap the full mental model:

```
                          UPLOAD TIME
                               |
                               v
   raw bytes  ---->  Backblaze B2  (untouched, content-addressed by SHA-256)
                               |
                               v
                       PARSING TIME
                               |
              (one of 8 parsers, routed by MIME)
                               |
                               v
   ExtractedDocument
   |
   +-- text per page  ---->  document_pages.extracted_text
   |                         (raw, faithful, deterministic)
   |
   +-- per-page meta  ---->  document_pages.extraction_metadata (JSONB)
                            +- audio:   segments, language, chunk_start_sec
                            +- image:   vision_model, not_visible, image_size
                            +- pdf:     extraction_method, page width/height
                            +- excel:   sheet_name, row_count, hidden
                            +- (all):   source_location
                               |
                               v
                       LEDGER TIME
                               |
              (LLM reads pages, emits Fact nodes)
                               |
                               v
   nodes (graph)
   |
   +-- verbatim_quote      <-- must be a substring of a page's extracted_text
   +-- source_document_id  <-- FK to documents row
   +-- source_page_number  <-- which page
                               |
                               v
                       DEBATE TIME
                               |
       (agents argue over nodes; every cited Fact's
       verbatim_quote is re-verified against the page text)
                               |
                               v
   runs + transcript + decisions  (the audit chain)
```

### The audit chain — readable left to right

```
   B2 object                 documents             document_pages       nodes
   (raw bytes)               (metadata)            (text + meta)        (Fact node)
   +----------+              +----------+          +-------------+      +-----------+
   |  pdf     |  storage_key |  doc id  |  doc id  |  page 4     |  FK  |  F12      |
   |  bytes   |<------------ |  sha     |<-------- |  text:      |<---- |  verbatim |
   |  intact  |              |  status  |          |    "Vehicle |      |  _quote:  |
   +----------+              |  ...     |          |     2 ran   |      |   "Vehicle|
                             +----------+          |     red"    |      |    2 ran  |
                                                   +-------------+      |    red"   |
                                                                        +-----------+
```

From any Fact in the graph, you can:
- Walk back to its source page (`nodes.source_document_id +
  nodes.source_page_number`), and
- Walk back to the raw bytes (`documents.storage_key` → B2 object), and
- Reproduce the entire extraction (re-run the extractor against the same
  bytes; the page text should be identical, modulo non-deterministic LLM
  calls in audio/image).

**This is the audit guarantee.** Every Fact agents cite later can be
traced — through code, not trust — back to a contiguous substring of
text we deterministically produced from a file we still hold the raw
bytes of. That's the load-bearing property of the Lumen ingestion
pipeline.

---

## Appendix: where to look in the code

| Concern | File |
|---|---|
| Extractor protocol | `backend/ingestion/extractors/base.py` |
| MIME → extractor routing | `backend/ingestion/extractors/registry.py` |
| Native PDF + OCR fallback | `backend/ingestion/extractors/pdf.py` |
| DOCX | `backend/ingestion/extractors/docx.py` |
| Excel | `backend/ingestion/extractors/excel.py` |
| HTML | `backend/ingestion/extractors/html.py` |
| Plain text + markdown | `backend/ingestion/extractors/text.py` |
| Audio (Whisper) | `backend/ingestion/extractors/audio.py` |
| Image (Claude vision) | `backend/ingestion/extractors/image.py` |
| Worker that calls extractors | `backend/ingestion/worker.py` |
| Service that orchestrates | `backend/ingestion/service.py` |
| Repository (writes rows) | `backend/ingestion/repository.py` |
| Storage (B2 / boto3) | `backend/ingestion/storage.py` |
| Schema definitions | `backend/db/migrations/001_initial.sql` |
| Pydantic mirrors | `backend/schemas/document.py`, `document_page.py` |
