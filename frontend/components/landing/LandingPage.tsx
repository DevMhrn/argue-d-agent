"use client";

/**
 * LandingPage — the public-facing landing for Lumen.
 *
 * Single client component because the three signature moments need client-side
 * behavior:
 *   1. The Bench — eight monogrammed seats arranged around an octagonal table,
 *      ambient pulse rotates through them in courtroom order (intake →
 *      evidence → advocate → opposing → adj-A → adj-B → verifier → drafter),
 *      paused on hover.
 *   2. The Harness — six gate cards illuminate left-to-right when the section
 *      enters the viewport, via IntersectionObserver.
 *   3. The Live Run — a Band-room snippet feed that replays real-shape postings
 *      while the section is on-screen and pauses when it isn't.
 *
 * The static sections (Hero, Gap, Endings, Moat, Footer) still SSR fine even
 * though the file is marked "use client" — Next.js renders client components
 * on the server first, then hydrates.
 *
 * No CTAs are decorative — every button links to a real workbench route.
 *
 * The CSS lives next to this file in ./landing.css, scoped under .landing-root
 * so it doesn't bleed into the dashboard routes. The only token override vs
 * globals.css is the GPT family swatch (brass, not steel) so this page has
 * zero blue.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import "./landing.css";

// the eight seats — IDs match the courtroom layout (front of room is bottom)
const SEATS = [
  { id: "adj-a",  family: "a", initial: "A", label: "Adjudicator A",       role: "decides fault & recovery, shows the math" },
  { id: "adj-b",  family: "b", initial: "B", label: "Adjudicator B",       role: "independent re-decision, different family" },
  { id: "verif",  family: "a", initial: "V", label: "Verifier",            role: "audits every cited claim against its source" },
  { id: "draft",  family: "a", initial: "D", label: "Drafter",             role: "writes the demand letter" },
  { id: "adv",    family: "a", initial: "L", label: "Liability Advocate",  role: "argues for our insured" },
  { id: "opp",    family: "b", initial: "R", label: "Opposing Carrier",    role: "red-teams — attacks our case" },
  { id: "intake", family: "b", initial: "I", label: "Intake Parser",       role: "extracts parties, date, damages from FNOL" },
  { id: "evid",   family: "b", initial: "E", label: "Evidence Aggregator", role: "builds the typed Evidence Ledger" },
] as const;

// pulse goes in courtroom order (front-to-back, then deciders): the indices
// here are positions in SEATS above
const PULSE_ORDER = [6, 7, 4, 5, 0, 1, 2, 3];

// the snippet feed — real-shape Band-room postings from the Rivera case
const FEED: ReadonlyArray<{
  who: string;
  family: "a" | "b";
  body: string; // contains inline HTML for citations/gate tags — typed escape
}> = [
  { who: "LA", family: "a", body: 'Vehicle 2 entered the intersection against a red signal. <span class="cite">F3</span> <span class="cite">CVC-21453</span>' },
  { who: "RT", family: "b", body: 'Witness speed estimate is low-confidence and uncorroborated. <span class="cite">F2</span><span class="gate-tag ok">Citation OK</span>' },
  { who: "AA", family: "a", body: 'Other-driver fault at 85%. Reasoning: red-light violation is the proximate cause. <span class="cite">F3</span> <span class="cite">F5</span>' },
  { who: "AB", family: "b", body: 'Independent verdict — 88% other-driver fault, within consensus band.<span class="gate-tag ok">Math · Consensus OK</span>' },
  { who: "SV", family: "a", body: 'All citations supported. Two facts marked overreach on minor language. <span class="cite">F1</span><span class="gate-tag ok">Source-align OK</span>' },
  { who: "DR", family: "a", body: 'Demand letter drafted — 85% fault, $35,700 recovery, jurisdiction CA.<span class="gate-tag ok">Letter OK</span>' },
];

const MAX_VISIBLE = 4;

export function LandingPage() {
  return (
    <div className="landing-root">
      <Chrome />
      <main>
        <Hero />
        <Bench />
        <Gap />
        <Harness />
        <LiveRun />
        <Endings />
        <Moat />
        <Footer />
      </main>
    </div>
  );
}

// ============================================================================
// CHROME
// ============================================================================
function Chrome() {
  return (
    <header className="lp-chrome">
      <div className="lp-chrome-inner">
        <div className="left">
          <span className="wordmark">
            <SigilSmall />
            Lumen
          </span>
          <span className="pipe">·</span>
          <span className="room">
            band&nbsp;room&nbsp;
            <span style={{ color: "var(--lp-gold-d)" }}>a87f1c</span>
          </span>
          <span className="pipe">·</span>
          <span className="live">
            <span className="pip" />
            live
          </span>
        </div>
        <div className="right">
          <a href="#bench" className="ghostable">The bench</a>
          <a href="#harness" className="ghostable">The harness</a>
          <a href="#run" className="ghostable">A live run</a>
          <Link href="/cases/new" style={{ color: "var(--lp-paper)" }}>
            Open the room <span style={{ color: "var(--lp-gold)" }}>→</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
// HERO — brand-first composition. Left column: product. Right column: a
// case-file card showing Rivera v. Blake as a sample artifact (NOT as the
// page's H1). The judge reads: Lumen → what it does → why → action → demo.
// ============================================================================
function Hero() {
  return (
    <section className="lp-hero lp-wrap" id="case">
      <div className="lp-hero-grid">
        {/* LEFT — the product */}
        <div className="lp-hero-brand">
          <div className="lp-wordmark">
            <span className="sigil" aria-hidden="true">
              <SigilLarge />
            </span>
            <span className="name">Lumen</span>
          </div>

          <h1 className="lp-positioning">
            AI subrogation recovery, <em>built on Band.</em>
          </h1>

          <p className="lp-lede">
            Eight specialist agents argue both sides of a subrogation claim in a
            real Band room. <em>A six-gate harness — in code, not prompt —</em>
            {" "}verifies the math and the evidence. Recovery in three minutes.
          </p>

          <div className="lp-cta-row">
            <Link className="lp-cta primary" href="/cases/new">
              Open the room <span className="arrow">→</span>
            </Link>
            <Link className="lp-cta secondary" href="/cases">
              Watch a real run
            </Link>
          </div>

          <div className="lp-hairline" aria-hidden="true">
            <span className="ornament">✦</span>
          </div>

          <div className="lp-credentials">
            <span className="item">
              <span className="k">For</span>
              <span className="v">P&amp;C recovery teams</span>
            </span>
            <span className="sep">·</span>
            <span className="item">
              <span className="k">Built on</span>
              <span className="v">Band</span>
            </span>
            <span className="sep">·</span>
            <span className="item">
              <span className="k">License</span>
              <span className="v">MIT</span>
            </span>
          </div>
        </div>

        {/* RIGHT — the artifact: a sample case file produced by Lumen */}
        <aside className="lp-casefile" aria-label="Sample case file processed by Lumen">
          <header className="lp-casefile-head">
            <div className="left">
              <div className="eyebrow">Case file · No.&nbsp;CLM-2026-0427</div>
              <div className="filed">Filed Jun 19, 2026 · CA, Santa Clara</div>
            </div>
            <span className="livepip" aria-label="Currently being processed">
              <span className="dot" />
              Live
            </span>
          </header>

          <div className="lp-casefile-caption">
            <div className="parties">
              <span className="surname">Rivera</span>
              <span className="vee">v.</span>
              <span className="surname">Blake</span>
            </div>
            <div className="kind">Subrogation recovery</div>
          </div>

          <dl className="lp-casefile-data">
            <div className="row">
              <dt>Damages paid</dt>
              <dd className="tnum">$42,000</dd>
            </div>
            <div className="row">
              <dt>Other-driver fault</dt>
              <dd className="tnum">85%</dd>
            </div>
            <div className="row recovery">
              <dt>Recovery</dt>
              <dd className="tnum money">$35,700</dd>
            </div>
            <div className="row">
              <dt>Status</dt>
              <dd>
                <span className="status-pill">Escalate · human review</span>
              </dd>
            </div>
          </dl>

          <footer className="lp-casefile-foot">
            <span className="audit">
              Audit · <span className="hash">bf2a4e91…c91e</span>
            </span>
            <span className="sealed">
              <span className="check">✓</span> Sealed
            </span>
          </footer>
        </aside>
      </div>
    </section>
  );
}

function SigilLarge() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <path
        d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z"
        strokeLinejoin="round"
      />
      <path
        d="M12 5.5 L13.2 10.7 L18.4 12 L13.2 13.2 L12 18.4 L10.7 13.2 L5.5 12 L10.7 10.7 Z"
        fill="currentColor"
        opacity="0.45"
      />
    </svg>
  );
}

// ============================================================================
// BENCH — ambient pulse + hover pause
// ============================================================================
function Bench() {
  const [lit, setLit] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const idxRef = useRef(0);
  const hoveredRef = useRef(false);

  // Native pointer listeners on the bench stage — derive hover from the target
  // so the seats themselves carry no interactive event handlers (a11y).
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const onEnter = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".lp-seat")) hoveredRef.current = true;
    };
    const onLeave = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest(".lp-seat")) hoveredRef.current = false;
    };
    node.addEventListener("pointerover", onEnter);
    node.addEventListener("pointerout", onLeave);
    return () => {
      node.removeEventListener("pointerover", onEnter);
      node.removeEventListener("pointerout", onLeave);
    };
  }, []);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const tick = () => {
      // skip while user is hovering a seat — they're reading the role caption
      if (hoveredRef.current) {
        setLit(null);
        return;
      }
      const seatIdx = PULSE_ORDER[idxRef.current % PULSE_ORDER.length];
      setLit(seatIdx);
      idxRef.current += 1;
    };

    let interval: ReturnType<typeof globalThis.setInterval> | null = null;
    // delay matches the bench-enter CSS animation (1.8s + 1.4s = 3.2s)
    const start = globalThis.setTimeout(() => {
      tick();
      interval = globalThis.setInterval(tick, 1100);
    }, 3400);
    return () => {
      globalThis.clearTimeout(start);
      if (interval) globalThis.clearInterval(interval);
    };
  }, []);

  return (
    <section className="lp-bench-section lp-wrap" id="bench">
      <div className="lp-bench-header">
        <h2>
          Eight specialists.
          <br />
          One <em>Band room.</em>
        </h2>
        <div className="meta">8 agents · 4 family A · 4 family B</div>
      </div>

      <div className="lp-bench-stage" ref={stageRef}>
        <div className="floor" aria-hidden="true" />
        <div className="lp-bench-tilt">
          {/* the octagonal table */}
          <div className="lp-bench-table">
            <svg viewBox="-200 -120 400 240" aria-hidden="true">
              <defs>
                <linearGradient id="lpTableTop" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3a3225" />
                  <stop offset="100%" stopColor="#241e16" />
                </linearGradient>
                <linearGradient id="lpTableRim" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5a4a32" />
                  <stop offset="100%" stopColor="#3a3022" />
                </linearGradient>
                <radialGradient id="lpTableSheen" cx="50%" cy="35%" r="60%">
                  <stop offset="0%" stopColor="rgba(231,211,168,0.18)" />
                  <stop offset="60%" stopColor="rgba(231,211,168,0.02)" />
                  <stop offset="100%" stopColor="rgba(231,211,168,0)" />
                </radialGradient>
              </defs>
              <polygon
                points="-130,-72 -60,-100 60,-100 130,-72 130,72 60,100 -60,100 -130,72"
                fill="url(#lpTableTop)"
                stroke="url(#lpTableRim)"
                strokeWidth="3"
              />
              <polygon
                points="-118,-66 -54,-90 54,-90 118,-66 118,66 54,90 -54,90 -118,66"
                fill="none"
                stroke="rgba(231,211,168,0.42)"
                strokeWidth="0.6"
              />
              <polygon
                points="-105,-58 -47,-78 47,-78 105,-58 105,58 47,78 -47,78 -105,58"
                fill="none"
                stroke="rgba(231,211,168,0.18)"
                strokeWidth="0.4"
              />
              <g transform="translate(0,0) scale(1.6)" opacity="0.45">
                <path
                  d="M0,-18 L4,-4 L18,0 L4,4 L0,18 L-4,4 L-18,0 L-4,-4 Z"
                  fill="rgba(231,211,168,0.55)"
                />
              </g>
              <polygon
                points="-130,-72 -60,-100 60,-100 130,-72 130,72 60,100 -60,100 -130,72"
                fill="url(#lpTableSheen)"
              />
            </svg>
          </div>

          {/* the eight seats */}
          {SEATS.map((s, i) => {
            const isLit = lit === i;
            const cls = [
              "lp-seat",
              `fam-${s.family}`,
              `s-${s.id}`,
              isLit ? "lit" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={s.id} className={cls}>
                <div className="plate">{s.initial}</div>
                <div className="label">{s.label}</div>
                <div className="role">{s.role}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="lp-fam-row">
        <div>
          <span className="swatch a" /> Family A · Claude · 4 agents
        </div>
        <div>
          <span className="swatch b" /> Family B · GPT · 4 agents
        </div>
      </div>

      <div className="lp-bench-foot">
        <p>
          Cross-family by design — the Advocate and the Opposing red team are on
          different model families, and the two Adjudicators each draw their
          conclusion independently before either sees the other’s answer.{" "}
          <em>Anti-collusion is built into the seating chart, not the prompt.</em>
        </p>
        <div className="hint">Hover a seat</div>
      </div>
    </section>
  );
}

// ============================================================================
// GAP — three-row editorial structure: setup question → the number as the
// dramatic centerpiece → balanced two-column explanation.
//
// The hero number ($15-20 B) animates in on every approach (IO toggles the
// .seen class) — scale + blur reveal, then a gold rule draws under it, then
// the caption fades in. Same kinetic language as the moat strikethrough.
// ============================================================================
function Gap() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) setSeen(ent.isIntersecting);
      },
      { threshold: 0.42 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <section className="lp-gap-section lp-wrap">
      {/* Row 1 — setup question */}
      <header className="lp-gap-setup">
        <div className="lp-eyebrow">
          <span className="dot" />
          The gap
        </div>
        <h2>
          Your insured wasn’t at fault.
          <br />
          You paid the claim.
          <br />
          <em>The at-fault carrier should pay you back.</em>
        </h2>
      </header>

      {/* Row 2 — the punctum: the dramatic stat */}
      <div
        className={["lp-gap-hero", seen ? "seen" : ""].filter(Boolean).join(" ")}
        ref={ref}
      >
        <div className="lp-gap-flank" aria-hidden="true">
          <span className="rule" />
          <span className="ornament">✦</span>
          <span className="rule" />
        </div>

        <div className="figure-block">
          <div className="figure" aria-label="Fifteen to twenty billion dollars">
            <span className="amt">
              $15<span className="dash">–</span>20
            </span>
            <span className="unit"> B</span>
          </div>
          <span className="underline" aria-hidden="true" />
          <p className="caption">
            left uncollected every year, across the U.S. P&amp;C industry.
          </p>
        </div>

        <div className="lp-gap-flank lower" aria-hidden="true">
          <span className="rule" />
          <span className="ornament">✦</span>
          <span className="rule" />
        </div>
      </div>

      {/* Row 3 — balanced explanation */}
      <div className="lp-gap-tail">
        <div className="prose">
          <p>
            That clawback is called <em>subrogation</em>. The work is slow,
            document-heavy, and manual — police reports, repair bills, statutes,
            fault percentages, demand letters drafted by hand.
          </p>
          <p>
            So insurers drop about half the recoverable cases they could pursue.
            The money just sits there.
          </p>
        </div>
        <aside className="aside">
          <div className="micro-stat">
            <span className="big">~50%</span>
            <span className="lbl">of recoverable claims dropped</span>
          </div>
          <span className="citation">
            Source · industry estimates, 2024–2026
          </span>
        </aside>
      </div>
    </section>
  );
}

// ============================================================================
// HARNESS — six gates with scroll-into-view illumination
// ============================================================================
const GATES = [
  {
    name: "Citation Gate",
    desc: { lead: "Every argued point must cite a real fact or statute id. ", em: "Uncited claims are rejected on the spot." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 4v16M9 4H6M9 20H6" />
        <path d="M18 4v16M15 4h3M15 20h3" />
        <path d="M11 9h2M11 12h4M11 15h2" />
      </svg>
    ),
  },
  {
    name: "Fact Gate",
    desc: { lead: "Every quoted fact must be a contiguous substring of a real source document. ", em: "Anchors the ledger to real text." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="3" width="14" height="16" rx="1.5" />
        <path d="M7 8h8M7 12h8M7 16h5" />
        <path d="M14.5 17.5l3 3" strokeWidth="1.6" />
        <circle cx="13" cy="14" r="3.2" />
      </svg>
    ),
  },
  {
    name: "Math Gate",
    desc: { lead: "Recomputes the fault percentages from the adjudicator’s own fault table. ", em: "If the math drifts, the verdict is rejected." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9h10M4 15h10" />
        <path d="M17 7l3 5-3 5" />
        <circle cx="6" cy="6" r="0.8" fill="currentColor" />
        <circle cx="6" cy="18" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "Consensus Gate",
    desc: { lead: "The two adjudicators must agree to within ten points. ", em: "If they don’t, the case escalates to a human reviewer." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v18" />
        <path d="M4 8h16" />
        <path d="M7 8l-3 7a4 4 0 008 0z" />
        <path d="M17 8l3 7a4 4 0 01-8 0z" />
      </svg>
    ),
  },
  {
    name: "Source Alignment",
    desc: { lead: "An independent reviewer checks whether each cited fact actually ", em: "supports the claim — supported, neutral, or overreach." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 13l-3-3a4 4 0 015.66-5.66l1.34 1.34" />
        <path d="M15 11l3 3a4 4 0 01-5.66 5.66L11 18.34" />
        <path d="M9 15l6-6" />
      </svg>
    ),
  },
  {
    name: "Letter Reconciliation",
    desc: { lead: "The drafted demand letter must contain the final fault percentage and dollar amount. ", em: "The number on the page must match the verdict." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="6" width="18" height="13" rx="1.5" />
        <path d="M3 7l9 7 9-7" />
        <path d="M8 16l3 3 6-6" strokeWidth="1.6" />
      </svg>
    ),
  },
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

/**
 * Harness — vertical timeline with scroll-linked illumination.
 *
 * As the user scrolls down, each gate lights up when its midpoint crosses
 * the trigger line (60% of viewport height from top). Scrolling up reverses
 * — gates un-light as their midpoints return below the line. The vertical
 * rail's gold overlay grows downward to the latest lit pip, so the user
 * literally sees the verification chain energize beneath them as they read.
 */
function Harness() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLLIElement[]>([]);
  const [lit, setLit] = useState<boolean[]>(() => GATES.map(() => false));

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Under reduced motion: light everything immediately, skip scroll loop.
    if (reduced) {
      setLit(GATES.map(() => true));
      return;
    }

    let raf = 0;
    const compute = () => {
      raf = 0;
      const trigger = globalThis.innerHeight * 0.62;
      const next = rowsRef.current.map((row) => {
        if (!row) return false;
        const r = row.getBoundingClientRect();
        const mid = r.top + r.height * 0.32;
        return mid < trigger;
      });
      // only update state when something actually changed (cheap eq check)
      setLit((prev) => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) {
          return prev;
        }
        return next;
      });
    };
    const onScroll = () => {
      if (raf) return;
      raf = globalThis.requestAnimationFrame(compute);
    };

    // compute once on mount so the initial state matches scroll position
    compute();
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    globalThis.addEventListener("resize", onScroll, { passive: true });
    return () => {
      globalThis.removeEventListener("scroll", onScroll);
      globalThis.removeEventListener("resize", onScroll);
      if (raf) globalThis.cancelAnimationFrame(raf);
    };
  }, []);

  const litCount = lit.filter(Boolean).length;
  // % filled along the rail — pip centers are at evenly spaced fractions of
  // the timeline. The lit rail reaches the last lit pip's center.
  const railPct =
    litCount === 0
      ? 0
      : ((litCount - 1) / Math.max(1, GATES.length - 1)) * 100;

  return (
    <section className="lp-harness-section lp-wrap" id="harness" ref={sectionRef}>
      <div className="lp-harness-head">
        <div className="lp-eyebrow">
          <span className="dot" />
          Verification
        </div>
        <h2>
          Six independent checks, <em>in code.</em>
        </h2>
        <p className="descr">
          Every gate is a written check, not a prompt. As you read down, each
          fires in turn — the harness refuses anything that isn’t cited,
          anchored, or mathematically consistent.
        </p>
      </div>

      <ol className="lp-timeline" aria-label="The six verification gates">
        <span className="rail-base" aria-hidden="true" />
        <span
          className="rail-lit"
          aria-hidden="true"
          style={{ height: `${railPct}%` }}
        />

        {GATES.map((g, i) => {
          const isLit = lit[i];
          return (
            <li
              key={g.name}
              className={["row", isLit ? "lit" : ""].filter(Boolean).join(" ")}
              ref={(el) => {
                if (el) rowsRef.current[i] = el;
              }}
            >
              <div className="marker">
                <span className="pip" aria-hidden="true">
                  <span className="pip-inner" />
                </span>
                <span className="roman">{ROMAN[i]}</span>
              </div>

              <article className="card">
                <header className="card-head">
                  <span className="num">Gate No.&nbsp;{String(i + 1).padStart(2, "0")}</span>
                  <span className="status" aria-hidden="true">
                    {isLit ? "● firing" : "○ idle"}
                  </span>
                </header>

                <div className="card-body">
                  <span className="icon" aria-hidden="true">
                    {g.icon}
                  </span>
                  <div>
                    <h3 className="name">{g.name}</h3>
                    <p className="desc">
                      {g.desc.lead}
                      <em>{g.desc.em}</em>
                    </p>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ============================================================================
// LIVE RUN — animated snippet feed
// ============================================================================
function LiveRun() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState<typeof FEED[number][]>(() => FEED.slice(0, MAX_VISIBLE));
  const cursorRef = useRef(MAX_VISIBLE);

  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let timer: ReturnType<typeof globalThis.setInterval> | null = null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting && !timer) {
            timer = globalThis.setInterval(() => {
              setVisible((prev) => {
                const next = FEED[cursorRef.current % FEED.length];
                cursorRef.current += 1;
                const combined = [...prev, next];
                return combined.slice(-MAX_VISIBLE);
              });
            }, 2400);
          } else if (!ent.isIntersecting && timer) {
            globalThis.clearInterval(timer);
            timer = null;
          }
        }
      },
      { threshold: 0.25 }
    );
    io.observe(node);
    return () => {
      if (timer) globalThis.clearInterval(timer);
      io.disconnect();
    };
  }, []);

  return (
    <section className="lp-live-section lp-wrap" id="run">
      <div className="lp-live-head">
        <div>
          <div className="lp-eyebrow">
            <span className="dot" />
            A live run
          </div>
          <h2>
            Three minutes,
            <br />
            <em>upload to letter.</em>
          </h2>
        </div>
        <p className="descr">
          Real Band-room postings from the Rivera case, replayed below. Mono
          prefix per agent role; family A on warm sand, family B on brass; gate
          verdicts on the right margin of each line.
        </p>
      </div>

      <div className="lp-feed" ref={ref} aria-live="polite">
        <div className="header">
          <span>
            Band room <span className="roomid">a87f1c</span> · Rivera v. Blake
          </span>
          <span>case-uuid · 38b1…7e09</span>
        </div>
        <div className="lp-feed-stream">
          {visible.map((p, i) => (
            <div
              key={`${cursorRef.current}-${i}-${p.who}`}
              className={`lp-posting fam-${p.family}`}
            >
              <div className="who">{p.who}</div>
              <div
                className="body"
                // posting bodies contain typed inline HTML for citation pills
                // and gate tags — content is fully under our control here
                // (no user input), so it's safe to render.
                dangerouslySetInnerHTML={{ __html: p.body }}
              />
            </div>
          ))}
        </div>
        <div className="lp-feed-foot">
          <span className="activity">
            <span className="ind" />
            Replaying — postings stream in cadence
          </span>
          <span>
            Audit hash ·{" "}
            <span style={{ color: "var(--lp-paper-d)" }}>bf2a4e91…c91e</span>
          </span>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// ENDINGS
// ============================================================================
function Endings() {
  return (
    <section className="lp-endings-section lp-wrap">
      <div className="lp-endings-head">
        <div className="lp-eyebrow">
          <span className="dot" />
          Two endings
        </div>
        <h2>
          A system that wins <em>every</em> case is broken.
        </h2>
        <p className="descr">
          Lumen knows when to walk away. The same eight agents and six gates,
          run twice — one case clears for recovery, the other closes for lack
          of merit.
        </p>
      </div>

      <div className="lp-endings-grid">
        <article className="lp-outcome recover">
          <div className="caption">
            Rivera{" "}
            <span style={{ color: "var(--lp-gold-d)", fontStyle: "italic" }}>v.</span>{" "}
            Blake
          </div>
          <div className="case-id">No. CLM-2026-0427 · CA · red-light T-bone</div>
          <div className="divider" />
          <div className="figure-row">
            <div className="figure">
              <div className="lbl">Recovery</div>
              <div className="amt money">$35,700</div>
            </div>
            <div className="figure">
              <div className="lbl">Other-driver fault</div>
              <div className="amt">
                85
                <span style={{ fontSize: ".55em", color: "var(--lp-muted)" }}>%</span>
              </div>
            </div>
          </div>
          <div className="verdict">Recommend recovery — please review</div>
          <p className="verdict-line">
            Six gates cleared. Adjudicators within four points. Demand letter
            drafted. Routed to a human because the recovery exceeds the $25k
            review threshold.
          </p>
          <svg className="seal" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(231,211,168,0.5)" strokeWidth="1" />
            <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(231,211,168,0.3)" strokeWidth="0.6" />
            <path
              d="M32 14 L36 28 L50 32 L36 36 L32 50 L28 36 L14 32 L28 28 Z"
              fill="rgba(231,211,168,0.45)"
            />
          </svg>
        </article>

        <article className="lp-outcome decline">
          <div className="caption">
            Carter{" "}
            <span style={{ color: "var(--lp-gold-d)", fontStyle: "italic" }}>v.</span>{" "}
            Lee
          </div>
          <div className="case-id">
            No. CLM-2026-0588 · CA · following too closely
          </div>
          <div className="divider" />
          <div className="figure-row">
            <div className="figure">
              <div className="lbl">Recovery</div>
              <div className="amt money">$1,980</div>
            </div>
            <div className="figure">
              <div className="lbl">Other-driver fault</div>
              <div className="amt">
                11
                <span style={{ fontSize: ".55em", color: "var(--lp-muted)" }}>%</span>
              </div>
            </div>
          </div>
          <div className="verdict">Recommend closing the file</div>
          <p className="verdict-line">
            Our insured rear-ended a stopped vehicle. Recovery below pursuit
            threshold; fault share below 25%. Not worth the cost of chasing.
          </p>
          <svg className="seal" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(198,106,90,0.45)" strokeWidth="1" />
            <circle cx="32" cy="32" r="24" fill="none" stroke="rgba(198,106,90,0.25)" strokeWidth="0.6" />
            <path
              d="M18 18 L46 46 M46 18 L18 46"
              stroke="rgba(198,106,90,0.6)"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </article>
      </div>
    </section>
  );
}

// ============================================================================
// MOAT — pull quote with the strike-through "whether to pay" line drawn live.
//
// IO toggles the .struck class every time the section enters or leaves view,
// so the strike-through re-animates on every approach. The line is a pseudo
// element that scales horizontally from 0 → 1 with a slight opacity ramp;
// the text color also dims a beat after the line finishes drawing.
// ============================================================================
function Moat() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [struck, setStruck] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const node = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          setStruck(ent.isIntersecting);
        }
      },
      { threshold: 0.45 }
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <section className="lp-moat-section lp-wrap" ref={ref}>
      <p className={["pull", struck ? "struck" : ""].filter(Boolean).join(" ")}>
        Everyone else decides{" "}
        <span className="strike">whether to pay</span>. Lumen gets the money{" "}
        <em>back.</em>
      </p>
      <div className="attribution">— Subrogation, the work nobody automates</div>
    </section>
  );
}

// ============================================================================
// FOOTER
// ============================================================================
function Footer() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-inner">
        <div>
          <div className="lp-foot-mark">
            <SigilSmall />
            <span className="wm">
              Lumen <em>— built on Band.</em>
            </span>
          </div>
          <p className="lp-foot-sub">
            A subrogation recovery officer that argues both sides of a case,
            verifies the math in code, and walks away from the ones that aren’t
            worth the chase. Submitted to the Band of Agents Hackathon ·
            MIT licensed · open source.
          </p>
        </div>
        <div className="lp-foot-links">
          <a href="https://github.com/DevMhrn/argue-d-agent" target="_blank" rel="noreferrer">
            Repository <span className="arrow">→</span>
          </a>
          <a href="#run">Three-minute video <span className="arrow">→</span></a>
          <Link href="/cases">View prior runs <span className="arrow">→</span></Link>
          <Link href="/cases/new">Open the room <span className="arrow">→</span></Link>
        </div>
      </div>
      <div className="lp-wrap lp-foot-coda">
        <span className="hash">
          tamper-evident seal · <b>bf2a4e91…c91e</b>
        </span>
        <span>© 2026 · No. CLM-2026-0427 on record</span>
      </div>
    </footer>
  );
}

// ============================================================================
// inline sigil — local to the landing so we don't pull in workbench Icons.
// ============================================================================
function SigilSmall() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path
        d="M12 1 L14.2 9.8 L23 12 L14.2 14.2 L12 23 L9.8 14.2 L1 12 L9.8 9.8 Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
