/**
 * Deterministic canned model outputs, keyed by case, so the whole pipeline runs
 * with NO API keys and NO network. runLumen() calls setMockCase(claim.caseId) at
 * the start of a run; mockChat() then serves that case's outputs.
 *
 * - CLEAN: strong liability → pursue/escalate. advocate_position#1 leaves one point
 *   uncited so the Citation Gate visibly rejects + fixes it.
 * - LOSER: our insured rear-ended a stopped car → the system should DECLINE
 *   (recovery not worth the cost). Proves Lumen isn't a rubber stamp.
 *
 * Note: currentCase is a module global — fine for the single-run demo server; a
 * concern only under truly concurrent runs in one process.
 */
const CLEAN = 'CLM-2026-0427';
const LOSER = 'CLM-2026-0588';

const MOCK_BY_CASE: Record<string, Record<string, unknown>> = {
  [CLEAN]: {
    intake: {
      parties: { insured: 'Alex Rivera (our insured, Driver A)', otherParty: 'Jordan Blake (Driver B)' },
      date: '2026-04-27',
      location: '5th Ave & Main St, San Jose, CA',
      damagesUsd: 42000,
    },
    ledger: {
      caseId: CLEAN,
      facts: [
        { id: 'F1', statement: 'Driver B entered the intersection against a steady red light.', source: 'police_report.pdf', verbatimQuote: 'Vehicle 2 (Blake) entered the intersection against a steady red signal', confidence: 0.9 },
        { id: 'F2', statement: 'A pedestrian witness estimated Driver B was traveling ~50 mph through the red.', source: 'witness_statements.pdf', verbatimQuote: 'The silver car blew through the red, going maybe 50.', confidence: 0.75 },
        { id: 'F3', statement: 'Driver A entered the intersection on a green light.', source: 'police_report.pdf', verbatimQuote: 'Vehicle 1 (Rivera), which had entered on a green signal', confidence: 0.85 },
        { id: 'F4', statement: 'Police cited Driver B for running a red light (CVC 21453).', source: 'police_report.pdf', verbatimQuote: 'Vehicle 2 driver cited under CVC 21453 for failing to stop at a red signal', confidence: 0.95 },
        { id: 'F5', statement: "Driver A's event data recorder shows Driver A traveling 40 mph in a 35 mph zone (5 mph over).", source: 'edr_readout.pdf', verbatimQuote: 'speed 40 mph in a posted 35 mph zone', confidence: 0.8 },
        { id: 'F6', statement: 'Total documented damages to Driver A: $42,000.', source: 'repair_invoice.pdf', verbatimQuote: 'Total documented damages: $42,000', confidence: 0.95 },
      ],
    },
    'advocate_position#1': { points: [
      { claim: 'Driver B ran a red light and is primarily liable for the collision.', citations: ['F1', 'F4', 'CVC-21453'] },
      { claim: 'Driver A lawfully entered the intersection on a green light.', citations: ['F3'] },
      { claim: "Our insured's damages total $42,000 and are fully recoverable.", citations: [] },
    ] },
    'advocate_position#2': { points: [
      { claim: 'Driver B ran a red light and is primarily liable for the collision.', citations: ['F1', 'F4', 'CVC-21453'] },
      { claim: 'Driver A lawfully entered the intersection on a green light.', citations: ['F3'] },
      { claim: "Our insured's damages total $42,000 and are fully recoverable.", citations: ['F6'] },
    ] },
    'opposing_independent#1': { points: [
      { claim: 'Driver A was speeding (5 mph over the limit), making A a contributing cause.', citations: ['F5', 'CA-1431.2'] },
    ] },
    'opposing_attack#1': { points: [
      { claim: "Driver A's green light does not excuse Driver A exceeding the speed limit; comparative fault must reduce recovery.", citations: ['F3', 'F5', 'CA-1431.2'] },
      { claim: 'Witness speed estimates of Driver B are low-confidence and cannot establish B speeding as a fault factor.', citations: ['F2'] },
    ] },
    'advocate_rebuttal#1': { responses: [
      { stance: 'concede', claim: 'Concede Driver A was 5 mph over the limit — a minor contributory factor.', citations: ['F5'] },
      { stance: 'rebut', claim: "Driver B's red-light entry is the proximate cause; a 5 mph overage is minor by comparison under comparative fault.", citations: ['F1', 'F4', 'CA-1431.2'] },
      { stance: 'rebut', claim: 'Even setting aside witness speed estimates, the red-light citation independently establishes B as primarily at fault.', citations: ['F4'] },
    ] },
    verifier: { results: [
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
    ] },
    adjudicator: {
      faultTable: [
        { factId: 'F1', favors: 'us', weight: 0.35 }, { factId: 'F4', favors: 'us', weight: 0.3 },
        { factId: 'F3', favors: 'us', weight: 0.1 }, { factId: 'F5', favors: 'them', weight: 0.15 },
        { factId: 'F2', favors: 'neutral', weight: 0.05 }, { factId: 'F6', favors: 'neutral', weight: 0.05 },
      ],
      otherDriverFaultPct: 85, confidence: 0.8,
      reasoning: "Driver B's red-light entry (F1) and citation (F4) make B the proximate cause; Driver A's green light (F3) supports A. Driver A's 5 mph overage (F5) is a minor contributory factor, allocated 15% under CA-1431.2. Witness speed of B (F2) is low-confidence and not weighted heavily. Net: B 85% at fault.",
    },
    adjudicator_b: {
      faultTable: [
        { factId: 'F4', favors: 'us', weight: 0.4 }, { factId: 'F1', favors: 'us', weight: 0.3 },
        { factId: 'F3', favors: 'us', weight: 0.05 }, { factId: 'F5', favors: 'them', weight: 0.1 },
        { factId: 'F2', favors: 'neutral', weight: 0.05 }, { factId: 'F6', favors: 'neutral', weight: 0.1 },
      ],
      otherDriverFaultPct: 85, confidence: 0.78,
      reasoning: "Negligence per se applies — the police citation under CVC 21453 (F4) is dispositive of B's primary fault. The red-light entry (F1) corroborates as proximate cause. Rivera's 5 mph overage (F5) is contributory but minor under CA-1431.2. I weight differently than Adjudicator A (citation-primary vs entry-primary) but converge on the same allocation. Net: B 85% at fault.",
    },
    drafter: { letter:
      'RE: Subrogation Demand — Claim CLM-2026-0427 (Rivera v. Blake)\n\n' +
      'Dear Claims Department,\n\n' +
      'Our insured, Alex Rivera, sustained $42,000 in damages in the April 27, 2026 collision at 5th Ave & Main St. ' +
      'The police report establishes that your insured, Jordan Blake, entered the intersection against a steady red light (F1) ' +
      'and was cited for the violation under CVC 21453 (F4), while our insured proceeded lawfully on a green light (F3).\n\n' +
      'Applying California comparative-fault principles (Civ. Code §1431.2), we assess your insured at 85% fault. ' +
      'Accordingly, we demand recovery of $35,700, representing 85% of our $42,000 in documented damages (F6).\n\n' +
      'Please remit payment or contact us within 30 days.\n\nRegards,\nSubrogation Recovery Unit',
    },
  },

  [LOSER]: {
    intake: {
      parties: { insured: 'Sam Carter (our insured, Driver A)', otherParty: 'Dana Lee (Driver B)' },
      date: '2026-05-14',
      location: 'Elm St & 2nd Ave, Oakland, CA',
      damagesUsd: 18000,
    },
    ledger: {
      caseId: LOSER,
      facts: [
        { id: 'F1', statement: 'Our insured (Driver A) struck Driver B from behind.', source: 'police_report.pdf', verbatimQuote: 'Vehicle 1 (Carter) struck Vehicle 2 (Lee) from behind', confidence: 0.95 },
        { id: 'F2', statement: 'Driver B was stopped at a steady red signal when struck.', source: 'police_report.pdf', verbatimQuote: 'Vehicle 2 (Lee) was stopped at a steady red signal', confidence: 0.95 },
        { id: 'F3', statement: 'Our insured was cited for following too closely (CVC 21703).', source: 'police_report.pdf', verbatimQuote: 'Carter cited under CVC 21703 for following too closely', confidence: 0.95 },
        { id: 'F4', statement: "Our insured's EDR shows no braking until 0.3s before impact.", source: 'edr_readout.pdf', verbatimQuote: 'no brake application until 0.3 seconds before impact', confidence: 0.85 },
        { id: 'F5', statement: 'The roadway was wet from light rain at the time of the collision.', source: 'weather_report.pdf', verbatimQuote: 'light rain, roadway wet', confidence: 0.7 },
        { id: 'F6', statement: "Our insured's documented damages: $18,000.", source: 'repair_invoice.pdf', verbatimQuote: 'Total documented damages: $18,000', confidence: 0.95 },
      ],
    },
    'advocate_position#1': { points: [
      { claim: 'Wet road conditions reduced available stopping distance, a mitigating factor for our insured.', citations: ['F5', 'CA-1431.2'] },
      { claim: 'Our insured sustained $18,000 in documented damages.', citations: ['F6'] },
    ] },
    'opposing_independent#1': { points: [
      { claim: 'Our insured struck a stopped vehicle from behind and was cited for following too closely; primary fault rests with our insured.', citations: ['F1', 'F2', 'F3', 'CVC-21703'] },
    ] },
    'opposing_attack#1': { points: [
      { claim: 'Wet road does not excuse following too closely — the EDR shows no braking until 0.3s before impact.', citations: ['F4', 'F5'] },
      { claim: 'Driver B was lawfully stopped at a red signal and could not have avoided the collision.', citations: ['F2'] },
    ] },
    'advocate_rebuttal#1': { responses: [
      { stance: 'concede', claim: 'Concede our insured was cited for following too closely and bears primary fault.', citations: ['F3'] },
      { stance: 'rebut', claim: 'Wet conditions are a minor mitigating factor warranting a small comparative share.', citations: ['F5', 'CA-1431.2'] },
    ] },
    verifier: { results: [
      { pointIndex: 0, pointSource: 'advocate_position', claim: 'Wet road conditions reduced available stopping distance, a mitigating factor for our insured.', citationId: 'F5', alignment: 'supported', reasoning: 'F5 establishes wet roadway; reduced stopping distance is a reasonable inference.' },
      { pointIndex: 1, pointSource: 'advocate_position', claim: 'Our insured sustained $18,000 in documented damages.', citationId: 'F6', alignment: 'supported', reasoning: 'F6 establishes the $18,000 damages figure.' },
      { pointIndex: 0, pointSource: 'opposing_independent', claim: 'Our insured struck a stopped vehicle from behind and was cited for following too closely; primary fault rests with our insured.', citationId: 'F1', alignment: 'supported', reasoning: 'F1 establishes our insured struck from behind.' },
      { pointIndex: 0, pointSource: 'opposing_independent', claim: 'Our insured struck a stopped vehicle from behind and was cited for following too closely; primary fault rests with our insured.', citationId: 'F2', alignment: 'supported', reasoning: 'F2 establishes Driver B was stopped.' },
      { pointIndex: 0, pointSource: 'opposing_independent', claim: 'Our insured struck a stopped vehicle from behind and was cited for following too closely; primary fault rests with our insured.', citationId: 'F3', alignment: 'supported', reasoning: 'F3 establishes the following-too-closely citation.' },
      { pointIndex: 0, pointSource: 'opposing_attack', claim: 'Wet road does not excuse following too closely — the EDR shows no braking until 0.3s before impact.', citationId: 'F4', alignment: 'supported', reasoning: 'F4 establishes the late braking.' },
      { pointIndex: 0, pointSource: 'opposing_attack', claim: 'Wet road does not excuse following too closely — the EDR shows no braking until 0.3s before impact.', citationId: 'F5', alignment: 'supported', reasoning: 'F5 establishes the wet road, accurately referenced.' },
      { pointIndex: 1, pointSource: 'opposing_attack', claim: 'Driver B was lawfully stopped at a red signal and could not have avoided the collision.', citationId: 'F2', alignment: 'supported', reasoning: 'F2 establishes B was stopped at a red signal.' },
      { pointIndex: 0, pointSource: 'advocate_rebuttal:concede', claim: 'Concede our insured was cited for following too closely and bears primary fault.', citationId: 'F3', alignment: 'supported', reasoning: 'Concession aligns with F3.' },
      { pointIndex: 1, pointSource: 'advocate_rebuttal:rebut', claim: 'Wet conditions are a minor mitigating factor warranting a small comparative share.', citationId: 'F5', alignment: 'supported', reasoning: 'F5 supports the wet-conditions mitigation, fairly characterized as minor.' },
    ] },
    adjudicator: {
      faultTable: [
        { factId: 'F1', favors: 'them', weight: 0.3 }, { factId: 'F2', favors: 'them', weight: 0.25 },
        { factId: 'F3', favors: 'them', weight: 0.25 }, { factId: 'F4', favors: 'them', weight: 0.1 },
        { factId: 'F5', favors: 'us', weight: 0.1 }, { factId: 'F6', favors: 'neutral', weight: 0.0 },
      ],
      otherDriverFaultPct: 10, confidence: 0.82,
      reasoning: 'Our insured struck a stopped vehicle from behind (F1, F2) and was cited for following too closely (F3); the EDR confirms late braking (F4). Driver B bears essentially no fault. Wet conditions (F5) are a slim mitigating factor. Net: the other driver is only ~10% at fault.',
    },
    adjudicator_b: {
      faultTable: [
        { factId: 'F1', favors: 'them', weight: 0.3 }, { factId: 'F2', favors: 'them', weight: 0.23 },
        { factId: 'F3', favors: 'them', weight: 0.25 }, { factId: 'F4', favors: 'them', weight: 0.1 },
        { factId: 'F5', favors: 'us', weight: 0.12 }, { factId: 'F6', favors: 'neutral', weight: 0.0 },
      ],
      otherDriverFaultPct: 12, confidence: 0.8,
      reasoning: 'Rear-end into a lawfully stopped vehicle with a following-too-closely citation (F3) makes our insured primarily at fault. The wet roadway (F5) supports a slightly larger mitigation than Adjudicator A. Net: the other driver is ~12% at fault.',
    },
    drafter: { letter:
      'RE: Subrogation Assessment — Claim CLM-2026-0588 (Carter v. Lee) — RECOMMEND CLOSING FILE\n\n' +
      'Internal recovery memo.\n\n' +
      'Our insured, Sam Carter, struck a vehicle that was lawfully stopped at a red signal (F2) and was cited for ' +
      'following too closely under CVC 21703 (F3); the event data recorder confirms late braking (F4). Although the ' +
      'roadway was wet (F5), that is at most a minor mitigating factor under California comparative fault (Civ. Code §1431.2).\n\n' +
      'The other party is assessed at only 11% fault, yielding a maximum recovery of $1,980 against $18,000 in documented ' +
      'damages (F6). This recovery does not justify the cost of pursuit. We recommend closing the file and not pursuing subrogation.\n\n' +
      'Regards,\nSubrogation Recovery Unit',
    },
  },
};

let currentCase = CLEAN;

export function setMockCase(caseId: string): void {
  currentCase = caseId in MOCK_BY_CASE ? caseId : CLEAN;
}

export function mockChat(key: string): string {
  const table = MOCK_BY_CASE[currentCase] ?? MOCK_BY_CASE[CLEAN];
  const value = key in table ? table[key] : MOCK_BY_CASE[CLEAN][key];
  if (value === undefined) {
    throw new Error(`No mock response for key "${key}". Add it to src/mockResponses.ts.`);
  }
  return JSON.stringify(value);
}
