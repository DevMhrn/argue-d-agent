"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BandSigil, Icon, Sigil } from "./Icon";

/** Scroll distance (px) before the chrome may hide — roughly its own height. */
const HIDE_AFTER = 80;

const NAV: { label: string; href: string; match: (p: string) => boolean }[] = [
  {
    label: "Cases",
    href: "/cases",
    match: (p) =>
      p === "/cases" ||
      (p.startsWith("/cases/") && !p.startsWith("/cases/new")),
  },
  {
    label: "New case",
    href: "/cases/new",
    match: (p) => p.startsWith("/cases/new"),
  },
  // Tokens route stays reachable directly at /tokens — just hidden from
  // the top-bar nav per the design decision to keep design-system pages
  // accessible to engineers but invisible to product users.
  {
    label: "Storyboard",
    href: "/storyboard",
    match: (p) => p.startsWith("/storyboard"),
  },
];

/**
 * Global app chrome: a thin engine-status strip over a sticky bar carrying the
 * wordmark, a segmented route nav, the "How Lumen works" entry, and the Band
 * coordination sigil. Mirrors the design comp's two-row header.
 */
export function AppChrome() {
  const pathname = usePathname() ?? "/";
  const [howOpen, setHowOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  // The marketing landing at `/` owns its own status chrome — skip the app
  // chrome there so the two don't double-stack.
  const isLanding = pathname === "/";

  // Smart hide-on-scroll: the chrome slides up as soon as you scroll down past
  // its own height, and returns the moment you scroll up. rAF-throttled.
  useEffect(() => {
    let last = globalThis.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      globalThis.requestAnimationFrame(() => {
        const y = globalThis.scrollY;
        if (y < HIDE_AFTER) setHidden(false);
        else if (y > last + 4) setHidden(true);
        else if (y < last - 4) setHidden(false);
        last = y;
        ticking = false;
      });
    };
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);

  if (isLanding) return null;

  return (
    <>
      <div
        className={`sticky top-0 z-50 transition-transform duration-300 ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        {/* engine status strip */}
        <div className="flex h-6.5 items-center gap-2.5 border-border-soft border-b bg-[#100d0a] px-6 font-mono text-[9.5px] text-muted-2 uppercase tracking-[0.14em]">
          <span className="flex items-center gap-1.5 text-ok">
            <span
              className="h-1.25 w-1.25 rounded-full bg-ok"
              style={{
                boxShadow: "0 0 6px var(--color-ok)",
                animation: "livePulse 1.8s infinite",
              }}
            />
            Lumen engine
          </span>
          <span className="text-border">·</span>
          <span className="text-ok">Live</span>
          <span className="ml-auto text-muted-2">All systems operational</span>
        </div>

        {/* main chrome */}
        <header
          className="flex h-14 items-center gap-6 border-border border-b px-6 backdrop-blur-md"
          style={{ background: "rgba(21,18,14,0.86)" }}
        >
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <Sigil size={22} />
            <span className="font-semibold text-[14px] text-text tracking-[0.16em]">
              LUMEN
            </span>
            <span className="border-border border-l pl-2.5 text-[10.5px] text-muted-2 uppercase tracking-[0.14em]">
              Subrogation Recovery
            </span>
          </Link>

          <nav className="flex gap-0.5 rounded-pill border border-border bg-panel p-0.75">
            {NAV.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-[7px] px-3.25 py-1.5 font-medium text-[12.5px] no-underline transition-colors"
                  style={{
                    background: active ? "var(--color-panel-3)" : "transparent",
                    color: active
                      ? "var(--color-text)"
                      : "var(--color-muted-2)",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => setHowOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-2.75 py-1.5 text-[12px] text-muted hover:border-accent-dim hover:text-text"
            >
              <Icon name="help" size={13} />
              How Lumen works
            </button>
            <BandSigil />
          </div>
        </header>
      </div>

      {howOpen && <HowItWorks onClose={() => setHowOpen(false)} />}
    </>
  );
}

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Open the file",
    body: "Drop the claim documents. Lumen hashes, stores, and extracts every page — PDFs, spreadsheets, audio, photos.",
  },
  {
    n: "02",
    title: "Lock the ledger",
    body: "It builds a typed evidence graph — facts anchored to verbatim quotes, parties, statutes — then locks it so nothing changes mid-analysis.",
  },
  {
    n: "03",
    title: "Argue both sides",
    body: "Eight specialist agents from two model families argue recovery and the opposing carrier's defense over the locked file. Six code-enforced gates check every citation and the math.",
  },
  {
    n: "04",
    title: "Deliver the disposition",
    body: "An adjudicator sets fault, a different family double-checks it, and the recoverable amount, demand letter, and a tamper-evident seal settle below.",
  },
];

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-6">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default border-0 p-0"
        style={{ background: "rgba(10,8,5,0.66)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How Lumen works"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        // biome-ignore lint/a11y/noAutofocus: focus the dialog so Esc works immediately
        autoFocus
        className="relative w-full max-w-140 rounded-card border border-border bg-panel p-7 shadow-(--shadow-pop) outline-none"
      >
        <div className="mb-1 flex items-center justify-between">
          <div className="font-mono text-[10.5px] text-muted-2 uppercase tracking-[0.18em]">
            How Lumen works
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-2 hover:text-text"
            aria-label="Close"
          >
            <Icon name="x" size={16} strokeWidth={2} />
          </button>
        </div>
        <h2 className="mt-1 mb-5 font-semibold text-[19px] text-text">
          Evidence first, then argument, then recovery.
        </h2>
        <div className="flex flex-col gap-0.5">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="flex gap-3.5 border-border-soft border-b py-3.25 last:border-b-0"
            >
              <span className="mt-0.5 font-mono text-[11px] text-muted-2">
                {s.n}
              </span>
              <div>
                <div className="font-medium text-[14px] text-text">
                  {s.title}
                </div>
                <div className="mt-0.75 text-[12.5px] text-muted leading-[1.55]">
                  {s.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
