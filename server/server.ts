import 'dotenv/config';
import express from 'express';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Room } from '../src/room';
import { runLumen } from '../src/pipeline';
import { isMock } from '../src/providers';
import type { ClaimInput, Statute } from '../src/types';

// Pace the mock so the live room is watchable. Real mode is paced by latency.
if (process.env.LUMEN_MOCK_DELAY_MS === undefined) process.env.LUMEN_MOCK_DELAY_MS = '650';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dataDir = join(root, 'data');
const webDir = join(root, 'frontend');

interface CaseMeta {
  id: string;
  title: string;
  summary: string;
  file: string;
  mockSupported: boolean;
}

function loadCases(): CaseMeta[] {
  return JSON.parse(readFileSync(join(dataDir, 'cases.json'), 'utf8'));
}

const app = express();
app.use(express.json());
app.use(express.static(webDir));

app.get('/api/cases', (_req, res) => {
  res.json({ mock: isMock(), cases: loadCases() });
});

app.get('/api/case/:id', (req, res) => {
  const meta = loadCases().find((c) => c.id === req.params.id);
  if (!meta) {
    res.status(404).json({ error: 'unknown case' });
    return;
  }
  const claim: ClaimInput = JSON.parse(readFileSync(join(dataDir, meta.file), 'utf8'));
  res.json({ meta, claim });
});

// Live run, streamed over Server-Sent Events. The Room posts each agent/gate
// event into the stream exactly as it happens — this is the live Band room.
app.get('/api/run/:id', async (req, res) => {
  const meta = loadCases().find((c) => c.id === req.params.id);
  if (!meta) {
    res.status(404).end();
    return;
  }
  const claim: ClaimInput = JSON.parse(readFileSync(join(dataDir, meta.file), 'utf8'));
  const statutes: Statute[] = JSON.parse(readFileSync(join(dataDir, 'statutes.json'), 'utf8'));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send('start', { caseId: claim.caseId, mock: isMock() });
  const room = new Room(claim.caseId, (p) => send('posting', p));

  try {
    const result = await runLumen(claim, statutes, room);
    // Tamper-evident audit hash over the full transcript + decision + letter.
    const auditHash = createHash('sha256')
      .update(JSON.stringify({ postings: room.postings, decision: result.decision, letter: result.letter }))
      .digest('hex');
    send('result', { ...result, auditHash });
    send('done', {});
  } catch (e) {
    send('error', { message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
});

// Records the human adjuster's approve/override on an escalated case.
app.post('/api/decision', (req, res) => {
  const { caseId, action } = (req.body ?? {}) as { caseId?: string; action?: string };
  console.log(`[human-in-the-loop] case=${caseId} action=${action}`);
  res.json({ ok: true, caseId, action });
});

// SEAM for the teammate's evidence ingestion pipeline (image OCR, audio ASR,
// large-document chunking). The UI posts uploaded evidence here; wire the
// ingestion service in to return a normalized document set for the ledger.
app.post('/api/ingest', (_req, res) => {
  res.json({
    ok: true,
    status: 'pending_pipeline',
    message:
      'Evidence ingestion (OCR / ASR / large-doc chunking) is handled by the ingestion service. Wire it in here.',
  });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`\n  Lumen web console → http://localhost:${PORT}   (mode: ${isMock() ? 'MOCK' : 'LIVE'})\n`);
});
