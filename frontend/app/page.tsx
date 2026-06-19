/**
 * Root route — the public marketing landing for Lumen.
 *
 * The cases workbench list lives at /cases. AppChrome early-returns on this
 * route so the landing owns its own status chrome (no double-stack).
 */
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata = {
  title: "Lumen — AI Subrogation Recovery, built on Band",
  description:
    "Eight specialist agents argue both sides of a subrogation claim in a real Band room. A six-gate harness — in code, not prompt — verifies the math and the evidence. Recovery in three minutes.",
};

export default function LandingRoute() {
  return <LandingPage />;
}
