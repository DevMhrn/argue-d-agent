import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lumen — Subrogation Recovery Intelligence",
  description:
    "AI Subrogation Recovery Officer — investigates a claim, argues both sides, and produces a ready-to-send recovery packet.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans text-text">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-6 border-b border-border bg-panel/60 px-6 py-3 backdrop-blur">
          <Link href="/" className="flex items-center gap-3 no-underline">
            <span
              aria-hidden
              className="relative h-9 w-9 rounded-[9px] shadow-[0_6px_18px_rgba(91,140,255,0.35)]"
              style={{
                background:
                  "conic-gradient(from 140deg, var(--color-accent), var(--color-accent-2), var(--color-agent-verifier), var(--color-accent))",
              }}
            >
              <span className="absolute inset-[9px] rounded bg-bg" />
            </span>
            <span className="flex flex-col leading-none">
              <span className="text-[19px] font-semibold tracking-tight">Lumen</span>
              <span className="mt-1 text-[11px] uppercase tracking-[0.08em] text-muted">
                Subrogation Recovery Console
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-[13px] text-muted">
            <Link href="/" className="hover:text-text">
              Cases
            </Link>
            <Link
              href="/cases/new"
              className="rounded-[9px] border border-border bg-panel-2 px-3 py-1.5 text-text hover:border-accent"
            >
              + New case
            </Link>
          </nav>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
