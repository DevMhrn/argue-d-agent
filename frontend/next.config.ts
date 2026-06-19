import type { NextConfig } from "next";

/**
 * Lumen frontend — Next.js 16 (App Router) + Tailwind v4.
 *
 * The FastAPI backend runs on :8000 (see backend/.env PORT). In dev, every
 * `/api/*` request from the browser is rewritten to the backend so the client
 * sees same-origin and there's no CORS to wrestle with. SSE works through this
 * proxy because Next preserves the streaming response body.
 *
 * In production, point LUMEN_API_BASE_URL at the deployed backend (or deploy
 * frontend + backend behind the same hostname and keep the rewrite).
 *
 * The value may be a full URL (`https://lumen-api.onrender.com`) or a bare
 * host (`lumen-api.onrender.com`). Render's blueprint `fromService` injects the
 * bare host, so we prepend `https://` when no scheme is present.
 */
const RAW_API_BASE = process.env.LUMEN_API_BASE_URL ?? "http://127.0.0.1:8000";
const API_BASE = /^https?:\/\//.test(RAW_API_BASE)
  ? RAW_API_BASE
  : `https://${RAW_API_BASE}`;

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't get confused by the root
  // pnpm-lock.yaml (which exists for the legacy Node demo at the repo root).
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_BASE}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
