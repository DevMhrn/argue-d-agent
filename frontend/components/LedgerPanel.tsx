"use client";

import type { LegacyClaim } from "@/lib/types";

interface Props {
  claim: LegacyClaim | null;
  ledgerText?: string | null;
}

export function LedgerPanel({ claim, ledgerText }: Props) {
  return (
    <aside className="flex h-full flex-col gap-4 overflow-hidden rounded-card border border-border bg-panel p-5 shadow-card">
      <header className="flex items-baseline justify-between gap-3 border-border-soft border-b pb-3">
        <h2 className="font-semibold text-base tracking-tight">
          Evidence Ledger
        </h2>
        <span className="text-[11px] text-muted-2 uppercase tracking-wider">
          F1…Fn
        </span>
      </header>
      {claim ? (
        <>
          <section className="grid gap-1 text-[13px]">
            <Row k="Insured" v={claim.insured} />
            <Row k="Other party" v={claim.otherParty} />
            <Row k="Jurisdiction" v={claim.jurisdiction} />
            <Row
              k="Damages"
              v={`$${Number(claim.damagesUsd).toLocaleString("en-US")}`}
              mono
            />
          </section>
          <section>
            <div className="mb-1.5 text-[11px] text-muted-2 uppercase tracking-wider">
              Documents on file
            </div>
            <ul className="grid gap-1.5">
              {claim.documents.map((d) => (
                <li
                  key={`${d.kind}:${d.filename ?? "unnamed"}`}
                  className="flex items-center gap-2 rounded-md border border-border-soft bg-panel-2 px-2 py-1.5 text-[12px]"
                >
                  <span className="text-muted-2">▤</span>
                  <span>{d.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="text-[13px] text-muted">Loading case…</p>
      )}
      <section className="flex-1 overflow-auto rounded-pill border border-border-soft bg-panel-2 p-3 font-mono text-[12px] text-muted leading-relaxed">
        {ledgerText ??
          "The ledger is built and locked once analysis runs — every fact anchored to a verbatim source quote."}
      </section>
    </aside>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-2">{k}</span>
      <span className={mono ? "font-mono" : ""}>{v}</span>
    </div>
  );
}
