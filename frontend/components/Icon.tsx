import type { CSSProperties, ReactNode } from "react";

/**
 * Lucide-style hairline icon set, ported from the Lumen design comp. Icons use
 * `currentColor` so they inherit text color; pass `size` / `strokeWidth` to tune.
 * Plain presentational component — safe in both server and client trees.
 */

export type IconName =
  | "intake"
  | "evidence"
  | "citation"
  | "adjudication"
  | "alignment"
  | "letter"
  | "copy"
  | "download"
  | "x"
  | "chevron"
  | "arrow"
  | "info"
  | "help"
  | "check"
  | "shield"
  | "book"
  | "layers"
  | "clock"
  | "gavel"
  | "upload";

const ICONS: Record<IconName, ReactNode> = {
  intake: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  evidence: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m21 21-4.3-4.3" />
      <path d="M9 11h4" />
      <path d="M11 9v4" />
    </>
  ),
  citation: (
    <>
      <path d="M8 7h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2v3l-3.5-3H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <path d="M7 11H5a1 1 0 0 0-1 1v4l2-1.5" />
    </>
  ),
  adjudication: (
    <>
      <path d="M12 3v18" />
      <path d="M7.5 7h9" />
      <path d="M5 21h14" />
      <path d="m7.5 7-3 6a3 3 0 0 0 6 0z" />
      <path d="m16.5 7 3 6a3 3 0 0 1-6 0z" />
    </>
  ),
  alignment: (
    <>
      <path d="M9.5 12h5" />
      <path d="M10 8.5H8.5a3.5 3.5 0 0 0 0 7H10" />
      <path d="M14 8.5h1.5a3.5 3.5 0 0 1 0 7H14" />
    </>
  ),
  letter: (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5" />
      <path d="m4 8 8 5 8-5" />
      <path d="M4 7v10a2 2 0 0 0 2 2h7" />
      <path d="m15 18 2 2 4-4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  x: <path d="M6 6 18 18M18 6 6 18" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.2 1.4c-.2 1.4-2.1 1.7-2.1 3" />
      <path d="M11.7 16.5h.01" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 6.5" />,
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4 3 7 7 8 4-1 7-4 7-8V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h11a1 1 0 0 1 1 1v13H6.5A1.5 1.5 0 0 0 5 20z" />
      <path d="M5 20a1.5 1.5 0 0 1 1.5-1.5H17" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  gavel: (
    <>
      <path d="m14 6-5 5" />
      <path d="m8.5 4.5 4 4" />
      <path d="m6.5 6.5 4 4" />
      <path d="m12 9 7 7" />
      <path d="m17 13-2 2" />
      <path d="M5 20h7" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 20h14" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      {ICONS[name]}
    </svg>
  );
}

/** The Lumen wordmark sigil — an eight-point star with an inner ring. */
export function Sigil({
  size = 22,
  color = "var(--color-money)",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      style={{ display: "block", flexShrink: 0, color }}
    >
      <path
        d="M12 1.6 13.9 9.4 21.2 7.3 15.8 12 21.2 16.7 13.9 14.6 12 22.4 10.1 14.6 2.8 16.7 8.2 12 2.8 7.3 10.1 9.4Z"
        fill="currentColor"
      />
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="0.8"
      />
    </svg>
  );
}

/**
 * The Band coordination sigil — an 8-dot grid (4 Claude warm / 4 GPT cool)
 * that makes the cross-family bench literal in the app chrome.
 */
export function BandSigil({ roomId = "a87f1c" }: { roomId?: string }) {
  const families: ("claude" | "gpt")[] = [
    "claude",
    "gpt",
    "claude",
    "gpt",
    "claude",
    "gpt",
    "claude",
    "gpt",
  ];
  return (
    <div
      title={`Band coordination layer — 8 member agents in room ${roomId}`}
      className="flex items-center gap-2.25 rounded-pill border border-border bg-panel px-2.75 py-1.5"
    >
      <div className="grid grid-cols-4 gap-0.75">
        {families.map((f, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed 8-dot decorative grid
            key={i}
            className="h-1.25 w-1.25 rounded-full"
            style={{
              background:
                f === "claude"
                  ? "var(--color-family-claude)"
                  : "var(--color-family-gpt)",
            }}
          />
        ))}
      </div>
      <div className="flex flex-col leading-[1.1]">
        <span className="text-[9px] text-muted-2 uppercase tracking-widest">
          band
        </span>
        <span className="font-mono text-[11px] text-text">{roomId}</span>
      </div>
      <span
        className="h-1.25 w-1.25 rounded-full bg-ok"
        style={{
          boxShadow: "0 0 6px var(--color-ok)",
          animation: "livePulse 1.8s infinite",
        }}
      />
    </div>
  );
}
