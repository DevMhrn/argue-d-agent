/**
 * Deterministic canned model outputs so the entire pipeline runs with NO API keys
 * and NO network. Each key matches a `mockKey` passed by the pipeline. The content
 * is written to tell one coherent case so the demo is believable end-to-end.
 *
 * Note: advocate_position#1 deliberately leaves one point uncited so you can SEE
 * the citation gate reject it and the agent fix it on #2.
 */
const MOCK: Record<string, unknown> = {
  intake: {
    parties: { insured: 'Alex Rivera (our insured, Driver A)', otherParty: 'Jordan Blake (Driver B)' },
    date: '2026-04-27',
    location: '5th Ave & Main St, San Jose, CA',
    damagesUsd: 42000,
  },

  ledger: {
    caseId: 'CLM-2026-0427',
    facts: [
      {
        id: 'F1',
        statement: 'Driver B entered the intersection against a steady red light.',
        source: 'police_report.pdf',
        verbatimQuote: 'Vehicle 2 (Blake) entered the intersection against a steady red signal',
        confidence: 0.9,
      },
      {
        id: 'F2',
        statement: 'A pedestrian witness estimated Driver B was traveling ~50 mph through the red.',
        source: 'witness_statements.pdf',
        verbatimQuote: 'The silver car blew through the red, going maybe 50.',
        confidence: 0.75,
      },
      {
        id: 'F3',
        statement: 'Driver A entered the intersection on a green light.',
        source: 'police_report.pdf',
        verbatimQuote: 'Vehicle 1 (Rivera), which had entered on a green signal',
        confidence: 0.85,
      },
      {
        id: 'F4',
        statement: 'Police cited Driver B for running a red light (CVC 21453).',
        source: 'police_report.pdf',
        verbatimQuote: 'Vehicle 2 driver cited under CVC 21453 for failing to stop at a red signal',
        confidence: 0.95,
      },
      {
        id: 'F5',
        statement: "Driver A's event data recorder shows Driver A traveling 40 mph in a 35 mph zone (5 mph over).",
        source: 'edr_readout.pdf',
        verbatimQuote: 'speed 40 mph in a posted 35 mph zone',
        confidence: 0.8,
      },
      {
        id: 'F6',
        statement: 'Total documented damages to Driver A: $42,000.',
        source: 'repair_invoice.pdf',
        verbatimQuote: 'Total documented damages: $42,000',
        confidence: 0.95,
      },
    ],
  },

  // Advocate's independent opening — attempt #1 leaves point 3 uncited (gate will reject).
  'advocate_position#1': {
    points: [
      { claim: 'Driver B ran a red light and is primarily liable for the collision.', citations: ['F1', 'F4', 'CVC-21453'] },
      { claim: 'Driver A lawfully entered the intersection on a green light.', citations: ['F3'] },
      { claim: "Our insured's damages total $42,000 and are fully recoverable.", citations: [] },
    ],
  },
  // Attempt #2 fixes the uncited point.
  'advocate_position#2': {
    points: [
      { claim: 'Driver B ran a red light and is primarily liable for the collision.', citations: ['F1', 'F4', 'CVC-21453'] },
      { claim: 'Driver A lawfully entered the intersection on a green light.', citations: ['F3'] },
      { claim: "Our insured's damages total $42,000 and are fully recoverable.", citations: ['F6'] },
    ],
  },

  // Opposing red team's independent theory (blind, before seeing our points).
  'opposing_independent#1': {
    points: [
      { claim: 'Driver A was speeding (5 mph over the limit), making A a contributing cause.', citations: ['F5', 'CA-1431.2'] },
    ],
  },

  // Opposing red team attacks our specific points.
  'opposing_attack#1': {
    points: [
      { claim: "Driver A's green light does not excuse Driver A exceeding the speed limit; comparative fault must reduce recovery.", citations: ['F3', 'F5', 'CA-1431.2'] },
      { claim: 'Witness speed estimates of Driver B are low-confidence and cannot establish B speeding as a fault factor.', citations: ['F2'] },
    ],
  },

  // Advocate rebuts or concedes each attack (concession must cite evidence).
  'advocate_rebuttal#1': {
    responses: [
      { stance: 'concede', claim: 'Concede Driver A was 5 mph over the limit — a minor contributory factor.', citations: ['F5'] },
      { stance: 'rebut', claim: "Driver B's red-light entry is the proximate cause; a 5 mph overage is minor by comparison under comparative fault.", citations: ['F1', 'F4', 'CA-1431.2'] },
      { stance: 'rebut', claim: 'Even setting aside witness speed estimates, the red-light citation independently establishes B as primarily at fault.', citations: ['F4'] },
    ],
  },

  // Source-Alignment Verifier — audits every (claim, fact-citation) pair from the transcript.
  // Mock-data convention: most pairs are 'supported'; one is 'overreach' (the Advocate's
  // "fully recoverable" claim under F6 — F6 establishes the damages amount, not the
  // recoverability share) so the demo shows the verifier doing nuanced work, not rubber-stamping.
  verifier: {
    results: [
      { pointIndex: 0, pointSource: 'advocate_position', claim: 'Driver B ran a red light and is primarily liable for the collision.', citationId: 'F1', alignment: 'supported', reasoning: 'F1 directly establishes Blake entered against a red signal; "primarily liable" is a fair opening-advocacy inference.' },
      { pointIndex: 0, pointSource: 'advocate_position', claim: 'Driver B ran a red light and is primarily liable for the collision.', citationId: 'F4', alignment: 'supported', reasoning: 'F4 corroborates via the police citation under CVC 21453.' },
      { pointIndex: 1, pointSource: 'advocate_position', claim: 'Driver A lawfully entered the intersection on a green light.', citationId: 'F3', alignment: 'supported', reasoning: 'F3 directly establishes Rivera entered on a green signal.' },
      { pointIndex: 2, pointSource: 'advocate_position', claim: "Our insured's damages total $42,000 and are fully recoverable.", citationId: 'F6', alignment: 'overreach', reasoning: 'F6 establishes the $42,000 damages amount. "Fully recoverable" assumes 100% fault, which is not established by F6 alone — it is an advocacy overreach.' },
      { pointIndex: 0, pointSource: 'opposing_independent', claim: 'Driver A was speeding (5 mph over the limit), making A a contributing cause.', citationId: 'F5', alignment: 'supported', reasoning: 'F5 establishes the 5 mph overage; "contributing cause" is a reasonable inference.' },
      { pointIndex: 0, pointSource: 'opposing_attack', claim: "Driver A's green light does not excuse Driver A exceeding the speed limit; comparative fault must reduce recovery.", citationId: 'F3', alignment: 'supported', reasoning: 'F3 establishes the green light, accurately referenced by the attack.' },
      { pointIndex: 0, pointSource: 'opposing_attack', claim: "Driver A's green light does not excuse Driver A exceeding the speed limit; comparative fault must reduce recovery.", citationId: 'F5', alignment: 'supported', reasoning: 'F5 establishes the speed overage, accurately invoked.' },
      { pointIndex: 1, pointSource: 'opposing_attack', claim: 'Witness speed estimates of Driver B are low-confidence and cannot establish B speeding as a fault factor.', citationId: 'F2', alignment: 'supported', reasoning: 'F2 is marked confidence 0.75; the attack accurately characterizes it as low-confidence.' },
      { pointIndex: 0, pointSource: 'advocate_rebuttal:concede', claim: 'Concede Driver A was 5 mph over the limit — a minor contributory factor.', citationId: 'F5', alignment: 'supported', reasoning: 'Concession aligns with F5.' },
      { pointIndex: 1, pointSource: 'advocate_rebuttal:rebut', claim: "Driver B's red-light entry is the proximate cause; a 5 mph overage is minor by comparison under comparative fault.", citationId: 'F1', alignment: 'supported', reasoning: 'F1 establishes the red-light entry as the rebuttal claims.' },
      { pointIndex: 1, pointSource: 'advocate_rebuttal:rebut', claim: "Driver B's red-light entry is the proximate cause; a 5 mph overage is minor by comparison under comparative fault.", citationId: 'F4', alignment: 'supported', reasoning: 'F4 corroborates the red-light citation.' },
      { pointIndex: 2, pointSource: 'advocate_rebuttal:rebut', claim: 'Even setting aside witness speed estimates, the red-light citation independently establishes B as primarily at fault.', citationId: 'F4', alignment: 'supported', reasoning: 'F4 is the police citation under CVC 21453, supporting the claim.' },
    ],
  },

  adjudicator: {
    faultTable: [
      { factId: 'F1', favors: 'us', weight: 0.35 },
      { factId: 'F4', favors: 'us', weight: 0.3 },
      { factId: 'F3', favors: 'us', weight: 0.1 },
      { factId: 'F5', favors: 'them', weight: 0.15 },
      { factId: 'F2', favors: 'neutral', weight: 0.05 },
      { factId: 'F6', favors: 'neutral', weight: 0.05 },
    ],
    otherDriverFaultPct: 85,
    confidence: 0.8,
    reasoning:
      "Driver B's red-light entry (F1) and citation (F4) make B the proximate cause; Driver A's green light (F3) supports A. Driver A's 5 mph overage (F5) is a minor contributory factor, allocated 15% under CA-1431.2. Witness speed of B (F2) is low-confidence and not weighted heavily. Net: B 85% at fault.",
  },

  // Second, independent adjudicator (Featherless OSS). Same conclusion, different
  // reasoning path — proves independence without breaking the existing letter.
  adjudicator_b: {
    faultTable: [
      { factId: 'F4', favors: 'us', weight: 0.4 },
      { factId: 'F1', favors: 'us', weight: 0.3 },
      { factId: 'F3', favors: 'us', weight: 0.05 },
      { factId: 'F5', favors: 'them', weight: 0.1 },
      { factId: 'F2', favors: 'neutral', weight: 0.05 },
      { factId: 'F6', favors: 'neutral', weight: 0.1 },
    ],
    otherDriverFaultPct: 85,
    confidence: 0.78,
    reasoning:
      "Negligence per se applies — the police citation under CVC 21453 (F4) is dispositive of B's primary fault. The red-light entry (F1) corroborates as proximate cause. Rivera's 5 mph overage (F5) is contributory but minor under CA-1431.2. I weight differently than Adjudicator A (citation-primary vs entry-primary) but converge on the same allocation. Net: B 85% at fault.",
  },

  drafter: {
    letter:
      'RE: Subrogation Demand — Claim CLM-2026-0427 (Rivera v. Blake)\n\n' +
      'Dear Claims Department,\n\n' +
      'Our insured, Alex Rivera, sustained $42,000 in damages in the April 27, 2026 collision at 5th Ave & Main St. ' +
      'The police report establishes that your insured, Jordan Blake, entered the intersection against a steady red light (F1) ' +
      'and was cited for the violation under CVC 21453 (F4), while our insured proceeded lawfully on a green light (F3).\n\n' +
      'Applying California comparative-fault principles (Civ. Code §1431.2), we assess your insured at 85% fault. ' +
      'Accordingly, we demand recovery of $35,700, representing 85% of our $42,000 in documented damages (F6).\n\n' +
      'Please remit payment or contact us within 30 days.\n\nRegards,\nSubrogation Recovery Unit',
  },
};

export function mockChat(key: string): string {
  if (!(key in MOCK)) {
    throw new Error(`No mock response for key "${key}". Add it to src/mockResponses.ts.`);
  }
  return JSON.stringify(MOCK[key]);
}
