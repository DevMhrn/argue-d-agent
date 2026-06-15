import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Room, Posting } from './room';
import { runLumen } from './pipeline';
import { isMock } from './providers';
import { ClaimInput, Statute } from './types';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

function c(n: number, s: string): string {
  return `\x1b[38;5;${n}m${s}\x1b[0m`;
}
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function printPosting(p: Posting): void {
  const tag = `${p.agent}`;
  if (p.kind === 'gate') {
    const isFail = /\b(REJECTED|FAILED)\b/.test(p.content);
    const icon = isFail ? '⛔' : '✓';
    const col = isFail ? 196 : p.color;
    console.log('\n' + c(col, bold(`  ${icon} ${tag}`)));
    console.log(c(col, indent(p.content)));
  } else if (p.kind === 'decision') {
    console.log('\n' + c(p.color, bold(`  ⚖  ${tag}`)));
    console.log(c(p.color, indent(p.content)));
  } else if (p.kind === 'system' || p.kind === 'handoff') {
    console.log('\n' + dim(`  — ${p.content}`));
  } else {
    console.log('\n' + c(p.color, bold(`  ${tag}`)));
    console.log(indent(p.content));
  }
}

function indent(s: string): string {
  return s.split('\n').map((l) => (l.startsWith('   ') ? l : '   ' + l)).join('\n');
}

function rule(label = ''): void {
  console.log('\n' + dim('─'.repeat(72)) + (label ? ' ' + bold(label) : ''));
}

async function main(): Promise<void> {
  const claim = JSON.parse(readFileSync(join(dataDir, 'sample_claim_clean.json'), 'utf8')) as ClaimInput;
  const statutes = JSON.parse(readFileSync(join(dataDir, 'statutes.json'), 'utf8')) as Statute[];

  console.log(bold('\n  LUMEN — AI Subrogation Recovery Officer'));
  console.log(dim(`  Mode: ${isMock() ? 'MOCK (no keys / no network)' : 'LIVE (real model calls)'}  |  Case: ${claim.caseId}`));
  rule('BAND ROOM — live transcript');

  const room = new Room(claim.caseId, printPosting);
  const result = await runLumen(claim, statutes, room);

  rule('RECOVERY PACKET');
  const d = result.decision;
  console.log(`\n  ${bold('Other driver fault:')} ${c(178, d.otherDriverFaultPct + '%')}   ${bold('Confidence:')} ${d.confidence}`);
  console.log(`  ${bold('Recovery demand:')}   ${c(46, bold('$' + d.recoveryUsd.toLocaleString()))}  (of $${result.intake.damagesUsd.toLocaleString()} damages)`);
  console.log(`  ${bold('Status:')}           ${d.escalate ? c(196, 'NEEDS HUMAN APPROVAL — ' + d.escalateReasons.join('; ')) : c(46, 'AUTO-CLEARED')}`);

  console.log('\n  ' + bold('Fault table:'));
  for (const r of d.faultTable) {
    const col = r.favors === 'us' ? 39 : r.favors === 'them' ? 203 : 245;
    console.log(`     [${r.factId}] ${c(col, r.favors.padEnd(7))} weight ${r.weight}`);
  }

  rule('DEMAND LETTER');
  console.log('\n' + result.letter.split('\n').map((l) => '  ' + l).join('\n'));
  rule();
  console.log(dim('\n  Done. Flip to live by adding keys to .env (LUMEN_MOCK=0).\n'));
}

main().catch((e) => {
  console.error('\n[runDemo] error:', e);
  process.exit(1);
});
