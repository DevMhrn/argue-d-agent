/**
 * A lightweight stand-in for a BAND room. Agents "post" into a shared, ordered
 * transcript with shared context — exactly the coordination surface BAND provides.
 *
 * SWAP POINT: when the BAND SDK is wired in, `post()` becomes "send a message to
 * the BAND room" and the onPost subscription becomes "react to a teammate's
 * message / handoff". The rest of the pipeline does not change.
 */
export interface Posting {
  seq: number;
  agent: string;
  color: number;
  kind: 'message' | 'handoff' | 'gate' | 'decision' | 'system';
  content: string;
}

export class Room {
  readonly postings: Posting[] = [];
  private seq = 0;

  constructor(
    public readonly caseId: string,
    private readonly onPost?: (p: Posting) => void,
  ) {}

  post(agent: string, color: number, kind: Posting['kind'], content: string): Posting {
    const p: Posting = { seq: ++this.seq, agent, color, kind, content };
    this.postings.push(p);
    this.onPost?.(p);
    return p;
  }
}
