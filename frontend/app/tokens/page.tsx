/**
 * Design-tokens reference — the Lumen system, rendered from the live theme
 * tokens in globals.css. Static page (no data fetching): every swatch uses the
 * real Tailwind v4 utility (e.g. `bg-money`, `bg-family-claude`) so the colors
 * shown are the actual generated values, not hardcoded paint. Mirrors the
 * design comp's tokens view (Lumen.dc.html lines 727-782).
 */
import type { CSSProperties } from "react";

interface Swatch {
  name: string;
  /** Tailwind v4 utility that paints the live token value. */
  bg: string;
  /** Hex shown as the data caption (matches the @theme block). */
  hex: string;
  note: string;
}

interface TypeRow {
  name: string;
  sample: string;
  spec: string;
  sampleStyle: CSSProperties;
}

// The 14 surface/text/state/family tokens, each rendered with its live utility.
const SWATCHES: Swatch[] = [
  { name: "bg", bg: "bg-bg", hex: "#15120e", note: "page" },
  { name: "panel", bg: "bg-panel", hex: "#1c1813", note: "card" },
  { name: "panel-2", bg: "bg-panel-2", hex: "#231e17", note: "nested" },
  { name: "panel-3", bg: "bg-panel-3", hex: "#2b261d", note: "inset" },
  { name: "text", bg: "bg-text", hex: "#ece6dc", note: "primary" },
  { name: "muted", bg: "bg-muted", hex: "#a59b8c", note: "secondary" },
  { name: "border", bg: "bg-border", hex: "#363027", note: "divider" },
  { name: "accent", bg: "bg-accent", hex: "#6f9bf0", note: "interactive" },
  { name: "ok", bg: "bg-ok", hex: "#6ea98a", note: "passed gate" },
  { name: "warn", bg: "bg-warn", hex: "#d4a44a", note: "review" },
  { name: "bad", bg: "bg-bad", hex: "#c66a5a", note: "violated" },
  { name: "money", bg: "bg-money", hex: "#e7d3a8", note: "recovery $" },
  {
    name: "family-claude",
    bg: "bg-family-claude",
    hex: "#d8b888",
    note: "warm sand",
  },
  {
    name: "family-gpt",
    bg: "bg-family-gpt",
    hex: "#8fb8bd",
    note: "cool steel",
  },
];

// The eight rows of the documented type scale (comp lines 1435-1444).
const TYPE_SCALE: TypeRow[] = [
  {
    name: "Display",
    sample: "Rivera v. Blake",
    spec: "Serif · 50/0.98 · 600",
    sampleStyle: {
      fontFamily: "var(--font-serif)",
      fontSize: "34px",
      fontWeight: 600,
      letterSpacing: "-0.015em",
      lineHeight: 1,
    },
  },
  {
    name: "H1",
    sample: "Cases",
    spec: "Sans · 30/1.05 · 600",
    sampleStyle: {
      fontFamily: "var(--font-sans)",
      fontSize: "26px",
      fontWeight: 600,
      letterSpacing: "-0.02em",
    },
  },
  {
    name: "H2",
    sample: "Argument Room",
    spec: "Sans · 19/1.2 · 600",
    sampleStyle: {
      fontFamily: "var(--font-sans)",
      fontSize: "19px",
      fontWeight: 600,
    },
  },
  {
    name: "H3",
    sample: "Disposition",
    spec: "Sans · 16/1.3 · 600",
    sampleStyle: {
      fontFamily: "var(--font-sans)",
      fontSize: "16px",
      fontWeight: 600,
    },
  },
  {
    name: "Body",
    sample: "Our insured held the right of way on a green signal.",
    spec: "Sans · 13.5/1.6 · 400",
    sampleStyle: {
      fontFamily: "var(--font-sans)",
      fontSize: "13.5px",
      lineHeight: 1.6,
    },
  },
  {
    name: "Caption",
    sample: "of $42,000 documented · 85% recoverable",
    spec: "Sans · 11.5/1.5 · 400",
    sampleStyle: {
      fontFamily: "var(--font-sans)",
      fontSize: "11.5px",
      color: "var(--color-muted)",
    },
  },
  {
    name: "Micro",
    sample: "SUBROGATION RECOVERY CASE",
    spec: "Mono · 10.5 · 0.22em",
    sampleStyle: {
      fontFamily: "var(--font-mono)",
      fontSize: "10.5px",
      letterSpacing: "0.22em",
      textTransform: "uppercase",
      color: "var(--color-muted-2)",
    },
  },
  {
    name: "Data",
    sample: "$35,700 · F3 · bf2a…c91e",
    spec: "Mono · tnum",
    sampleStyle: {
      fontFamily: "var(--font-mono)",
      fontSize: "14px",
      fontFeatureSettings: "'tnum'",
      color: "var(--color-money)",
    },
  },
];

// The @theme block as published in theme.css (comp lines 1392-1432).
const THEME_CSS = `@import "tailwindcss";

@theme {
  /* surfaces — warm charcoal, paper-adjacent */
  --color-bg:        #15120e;
  --color-panel:     #1c1813;
  --color-panel-2:   #231e17;
  --color-panel-3:   #2b261d;
  --color-border:    #363027;
  --color-border-soft:#29231b;

  /* text */
  --color-text:      #ece6dc;
  --color-muted:     #a59b8c;
  --color-muted-2:   #6e6657;

  /* interactive — desaturated electric blue (code, not chat) */
  --color-accent:        #6f9bf0;
  --color-accent-strong: #8cb0f7;

  /* gate states — verified / review / violated, not stoplight */
  --color-ok:   #6ea98a;   /* passed  — cool sage   */
  --color-warn: #d4a44a;   /* warning — warm amber  */
  --color-bad:  #c66a5a;   /* rejected— brick red   */

  /* the money — embossed currency, never warning */
  --color-money: #e7d3a8;

  /* cross-family agent identity */
  --color-family-claude: #d8b888;  /* warm sand  */
  --color-family-gpt:    #8fb8bd;  /* cool steel */

  /* type */
  --font-sans:  "Geist", system-ui, sans-serif;
  --font-serif: "Source Serif 4", Georgia, serif;
  --font-mono:  "Geist Mono", ui-monospace, monospace;

  /* radii */
  --radius-card: 0.8125rem; /* 13px — panels  */
  --radius-pill: 1.25rem;   /* 20px — chips   */
}`;

const EYEBROW =
  "font-mono text-[11px] text-muted-2 uppercase tracking-[0.14em]";

export default function TokensPage() {
  return (
    <div className="mx-auto w-full max-w-275 px-6 pt-9 pb-20">
      <div className={`${EYEBROW} mb-2.25`}>Design tokens</div>
      <h1 className="mb-2 font-semibold text-[32px] tracking-[-0.02em]">
        The Lumen system
      </h1>
      <p className="mb-9 max-w-155 text-[14px] text-muted leading-[1.6]">
        Warm-charcoal, paper-adjacent dark theme. Maps 1:1 to Tailwind v4{" "}
        <span className="font-mono text-accent">@theme</span>. Money is embossed
        currency, not warning; gates read verified/review/violated, not
        stoplight.
      </p>

      {/* ── Color ─────────────────────────────────────────────────────── */}
      <div className={`${EYEBROW} mb-3.5`}>Color</div>
      <div className="mb-10 grid grid-cols-4 gap-3">
        {SWATCHES.map((sw) => (
          <div
            key={sw.name}
            className="overflow-hidden rounded-card border border-border bg-panel"
          >
            <div className={`h-16 ${sw.bg}`} />
            <div className="px-3.25 py-2.75">
              <div className="font-semibold text-[12.5px]">{sw.name}</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-muted-2">
                {sw.hex}
              </div>
              <div className="mt-1 text-[10px] text-muted-2 leading-[1.4]">
                {sw.note}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Typography · Radii ────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-2 gap-6">
        <div>
          <div className={`${EYEBROW} mb-3.5`}>Typography</div>
          <div className="flex flex-col gap-4.5 rounded-card border border-border bg-panel p-5.5">
            <div>
              <div className="mb-1.25 font-mono text-[10px] text-muted-2">
                Geist · display / UI
              </div>
              <div className="font-semibold text-[30px] tracking-[-0.02em]">
                Rivera v. Blake
              </div>
            </div>
            <div>
              <div className="mb-1.25 font-mono text-[10px] text-muted-2">
                Source Serif 4 · the artifact
              </div>
              <div className="font-serif text-[18px]">
                We hereby demand recovery in the amount stated.
              </div>
            </div>
            <div>
              <div className="mb-1.25 font-mono text-[10px] text-muted-2">
                Geist Mono · IDs, money, hashes
              </div>
              <div className="tnum font-mono text-[18px] text-money">
                $35,700 · F3 · bf2a…c91e
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className={`${EYEBROW} mb-3.5`}>Radii · spacing</div>
          <div className="flex flex-col gap-4 rounded-card border border-border bg-panel p-5.5">
            <div className="flex items-center gap-3.5">
              <div
                className="h-10 w-13.5 border border-border bg-panel-3"
                style={{ borderRadius: "13px" }}
              />
              <div className="text-[12px]">
                <div className="font-medium">card · 13px</div>
                <div className="text-[11px] text-muted-2">panels, surfaces</div>
              </div>
            </div>
            <div className="flex items-center gap-3.5">
              <div
                className="h-6.5 w-13.5 border border-border bg-panel-3"
                style={{ borderRadius: "20px" }}
              />
              <div className="text-[12px]">
                <div className="font-medium">pill · 20px</div>
                <div className="text-[11px] text-muted-2">
                  chips, badges, buttons
                </div>
              </div>
            </div>
            <div className="text-[12px] text-muted leading-[1.6]">
              8px grid · gaps of 8/14/18/24/28 throughout. Hero surfaces breathe
              (26–30px padding); lists stay tight (8–12px).
            </div>
          </div>
        </div>
      </div>

      {/* ── Type scale ────────────────────────────────────────────────── */}
      <div className={`${EYEBROW} mb-3.5`}>Type scale</div>
      <div className="mb-10 overflow-hidden rounded-card border border-border bg-panel">
        {TYPE_SCALE.map((t) => (
          <div
            key={t.name}
            className="grid grid-cols-[120px_1fr_220px] items-baseline gap-5 border-border-soft border-b px-5 py-3.75 last:border-b-0"
          >
            <div className="font-mono text-[11px] text-muted-2">{t.name}</div>
            <div style={t.sampleStyle}>{t.sample}</div>
            <div className="tnum text-right font-mono text-[11px] text-muted-2">
              {t.spec}
            </div>
          </div>
        ))}
      </div>

      {/* ── theme.css ─────────────────────────────────────────────────── */}
      <div className={`${EYEBROW} mb-3.5`}>theme.css — Tailwind v4</div>
      <pre
        className="m-0 overflow-auto rounded-card border border-border p-5.5 font-mono text-[12px] leading-[1.65]"
        style={{ background: "#100d0a", color: "#c9c0b1" }}
      >
        {THEME_CSS}
      </pre>
    </div>
  );
}
