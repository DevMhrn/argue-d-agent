# Deploying Lumen

Lumen deploys as **two web services on [Render](https://render.com)** from a single
blueprint (`render.yaml`):

| Service | What it is | Stack |
|---|---|---|
| `lumen-api` | Orchestration backend (the hearing + SSE stream) | FastAPI · Python |
| `lumen-web` | The console the judges click | Next.js 16 · Node |

`lumen-web` proxies every `/api/*` request to `lumen-api`, so the browser only
ever talks to one origin (no CORS, SSE streams straight through). The blueprint
wires the backend's URL into the frontend automatically — nothing to copy.

The default deploy runs in **mock mode**: deterministic content, no API keys, no
database, no Redis, no storage. The demo cases `clean` and `loser` run the full
8-agent hearing in-memory. It cannot break from a flaky live API call mid-demo.

---

## Deploy (≈ 10 minutes, one-time)

1. **Push the repo to GitHub** (already done): `github.com/DevMhrn/argue-d-agent`,
   branch `main`, with `render.yaml` at the root.

2. Go to **<https://dashboard.render.com>** → sign in (use **"Sign in with
   GitHub"** so Render can read the repo).

3. Click **New +** → **Blueprint**.

4. Select the **`argue-d-agent`** repository → Render detects `render.yaml` and
   shows two services (`lumen-api`, `lumen-web`). Click **Apply**.

5. Wait for both builds to go green (~3–5 min backend, ~3–5 min frontend). The
   backend finishes first; the frontend build waits for nothing — they build in
   parallel.

6. Open the **`lumen-web`** URL (e.g. `https://lumen-web.onrender.com`). That's
   the link to share / put in the deck and submission.

   > Quick check: open `https://lumen-api.onrender.com/api/cases` directly — it
   > should return JSON with the `clean` and `loser` demo cases. If that works,
   > the backend is healthy.

### Free-tier note
Free services sleep after ~15 min idle and cold-start (~50 s) on the next hit.
Before a live demo or judging, **open the URL once to wake it**, then it stays
warm. For zero cold starts, bump either service to the paid Starter plan in the
Render dashboard (no config change needed).

---

## Upgrade: real Band room (optional, after the URL works)

The deployed backend uses an in-memory room in mock mode. To make the deployed
hearing post to a **real Band room** (the #1 judging criterion, shown live):

1. In the Render dashboard → **`lumen-api`** → **Environment** → **Secret
   Files** → **Add Secret File**:
   - **Filename:** `band_config.yaml`
   - **Contents:** paste your local `band_config.yaml` (the 8 agents'
     `agent_id` + `api_key`). Render mounts it at the repo root, where
     `make_room()` looks for it.

2. Same page → **Environment Variables** → add:
   - `LUMEN_BAND` = `1`

3. (Optional, for **live model content** instead of mock) add:
   - `ANTHROPIC_API_KEY` = `…`
   - `OPENAI_API_KEY` = `…`
   - and **remove** `LUMEN_MOCK` (or set it to `0`).

   Leaving `LUMEN_MOCK=1` while `LUMEN_BAND=1` gives the best of both: a **real
   Band room** with **deterministic, reliable content** — recommended for a
   live demo.

4. **Save** → Render redeploys `lumen-api` automatically. Confirm the backend
   log banner says `mode: BAND`.

> `band_config.yaml` and `.env` are git-ignored and are **never** committed —
> credentials only ever live in Render's secret store.

---

## Alternatives

- **Railway** — same two-service shape. Create two services from the repo:
  backend (root `.`, start `python -m backend.app.run_server`), frontend (root
  `frontend`, build `pnpm install && pnpm build`, start `pnpm start`, env
  `LUMEN_API_BASE_URL=https://<backend>.up.railway.app`). Railway injects `PORT`.
- **Fly.io** — needs a Dockerfile per service; more setup. Render is faster here.

Do **not** use Vercel for the backend: the hearing streams over SSE and needs a
long-lived server, not request-scoped serverless functions. (The Next.js
frontend alone would be fine on Vercel, but keeping both on Render is simpler.)

---

## Verify a production build locally (optional pre-flight)

```bash
# backend, mock mode, on :8000
LUMEN_MOCK=1 ./run.sh server

# frontend, production build, in another terminal
cd frontend
LUMEN_API_BASE_URL=http://127.0.0.1:8000 pnpm build
LUMEN_API_BASE_URL=http://127.0.0.1:8000 pnpm start   # serves :3000
```

Open <http://localhost:3000>, run the `clean` case, and confirm the room
streams + the decision/letter render. If that works locally, Render will work.
