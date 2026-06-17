# Lumen — AI Subrogation Recovery Officer
### Plan for the Band of Agents Hackathon (lablab.ai)

> **One-liner:** Insurance companies lose billions every year because chasing down money owed to them is too slow and manual. Lumen is a team of AI specialists that investigates a claim, argues both sides to pressure-test it, and produces a ready-to-send recovery package in minutes — so insurers actually collect the money instead of letting it slip away.

---

## 1. The hackathon facts (build to these)

| Thing | Detail |
|---|---|
| Event | Band of Agents Hackathon — lablab.ai. Free, fully online, global. |
| Dates | June 12 → **June 19, 2026**. Hard deadline **June 19 @ 8:30 PM IST**. |
| Our target | Submit by **end of June 18** (a day early). Don't trust the deadline. |
| Prize pool | $10,000+ overall. (We target the main Band prize; the AI/ML API + Featherless partner prizes are out — those APIs were unavailable to us.) |
| **The hard rule** | App must show **3+ unique specialized agents actively talking to each other.** Must go beyond a chatbot, a single agent, or a straight A→B→C script. |
| What to submit | (1) a **working prototype people can use online** (deployed), (2) a **~3-min demo video**, (3) a **pitch deck**. Original + MIT-licensed. |

**How it's judged (in priority order):**
1. **How well we use Band as the coordination layer** — real handoffs, shared context, role specialization, tracked task state, escalation. *Biggest lever.*
2. **Clarity** — a judge instantly gets the problem, the agent roles, what Band does, and the value.
3. **Creative multi-agent collaboration** — agents discover each other, divide work, review outputs, disagree, escalate.

---

## 2. The problem (plain English)

Someone runs a red light and hits your car. Your insurer pays to fix it right away. But it wasn't your fault — so your insurer should get that money back from the **other** driver's insurer. Chasing that money down is called **subrogation**.

It's slow, manual work: gather the police report, photos, repair bills, witness statements; read both policies; figure out who was at fault and by how much; write a formal demand letter; argue back and forth. Because it's so tedious, insurers **drop about half** the cases worth chasing. Industry-wide, that's an estimated **$15–20 billion a year** left uncollected.

## 3. Who we serve

The **recovery teams inside insurance companies** (State Farm, GEICO, Allstate, Progressive, etc.). They have thousands of staff doing this by hand and can't keep up.

## 4. What Lumen does

You hand it a crash claim. It produces a **complete, ready-to-send recovery package**:
- Fault analysis — who was at fault and by what %, every point backed by real evidence
- The dollar amount to demand
- A formal demand letter, ready to send
- The strongest opposing argument + our rebuttal (kept visible, not hidden)
- A human Approve/Reject step for big or uncertain cases

Work that takes a small team ~2 weeks comes out in minutes. The human still signs off — we hand them a finished first draft.

---

## 5. The agent team

> Built across **three independent model families** so the adversarial parts are genuinely independent — not one model arguing with itself. **Pitch line:** *"The Advocate (Claude) and the Opposing red team (GPT) argue; two adjudicators on different families (Claude vs Gemini) must agree. Band is what lets them collaborate."*

### Core team (must-have for the demo)

| # | Agent | Job | Provider / model | Why |
|---|---|---|---|---|
| 1 | **Intake Parser** | Pull who/what/where/when from the First Notice of Loss | OpenAI (gpt-4o-mini) | Fast, cheap structured extraction |
| 2 | **Evidence Aggregator** | OCR + classify police report, photos, invoices → build the **Evidence Ledger** | Google (gemini-2.5-flash) | Fast, long-context extraction |
| 3 | **Liability Advocate (our side)** | Build the strongest case that the other driver was at fault | Anthropic (claude-opus-4-8) | Legal reasoning core |
| 4 | **Opposing-Carrier Red-Team** | Attack our case, find every hole — like the other insurer would | OpenAI (gpt-4o) | A genuine adversary on a *different* family |
| 5 | **Adjudicator A (neutral referee)** | Weigh both sides, set fault % and recovery amount — **showing its math** | Anthropic (claude-opus-4-8) | Must be neutral; debaters don't decide |
| 6 | **Adjudicator B (independent)** | Re-decide on a different family; disagreement forces human review | Google (gemini-2.5-pro) | Cross-family consensus check |
| 7 | **Source-Alignment Verifier** | Audit every cited claim actually follows from its source fact | Google (gemini-2.5-flash) | Catches "cited but misrepresented" |
| 8 | **Demand Letter Drafter** | Compose the formal demand letter | Anthropic (claude-sonnet-4-6) | Drafting quality matters |

> Family balance: Anthropic powers the Advocate + Adjudicator A + Drafter; Google powers Evidence + Adjudicator B + Verifier; OpenAI powers Intake + Opposing. The Advocate-vs-Opposing debate and the A-vs-B consensus each span two different families — that's what makes the anti-collusion claim real.

---

## 6. The harness — how we keep it honest and adversarial

This is the engineering core. Two failure modes to kill: **(a)** agents making things up, **(b)** the two arguing agents being too agreeable and drifting into a soft compromise instead of building the strongest case.

### Anti-hallucination
- **One Evidence Ledger = single source of truth.** The extractor agents produce a structured list: each fact has an ID, the claim, the exact source (doc + line / photo region), and a confidence. Everyone argues **only** over this ledger.
- **Citation gate (code, not vibes).** Before any agent message enters the Band room, the harness checks that every factual claim cites a real fact ID `[F12]` or statute ID `[CA-1431.2]`. Uncited or invalid → rejected, sent back for a redo.
- **Quote, don't recite — for law/policy.** Statutes and policy clauses live in a small **hand-verified store**. Agents must quote the retrieved text verbatim with its source; reciting law from memory is forbidden. (Demo needs only 1–2 states.)
- **"Not in evidence" is allowed and rewarded.** Missing fact → say so → escalate to a human instead of inventing it.
- **Verifier agent** audits citations after the debate.

### Anti-collusion (keep the fight real)
- **The opponent is a red-team, not a negotiator.** No "settlement" turn. Its output is *attacks*, our side's output is *rebuttals*.
- **Separation of powers.** The agents who argue do **not** set the number. The neutral Adjudicator does.
- **Structured rounds, not free chat:** (1) Advocate states position → (2) Opponent attacks each point → (3) Advocate rebuts or concedes — **may only concede if it cites a fact/statute that defeats the point.** Stop. No "find common ground" round.
- **Draft independently first**, then exchange — prevents anchoring.
- **Different model per side** — two model families resist sycophantic convergence.
- **Fault % is computed, not vibed.** Adjudicator builds a table: fact → which side it favors → weight under statute → sum. Flags suspicious ~50/50 splits.
- **Dissent stays in the output** — best part of the demo.

### Why this plugs into Band (and scores point #1)
The citation gate and the turn protocol *are* the governance/rules layer Band provides. Encoding "no claim without a citation" and "no consensus round" as Band room rules is concrete proof we're using Band deeply. **Put this on a slide.**

### How we'll know it works
Author 3 test cases with known answers — and **make one a loser** (our side genuinely at fault). A correct system produces a *low* recovery or escalates, not a fake win. Being able to say *"it also tells you when NOT to pursue"* is a credibility win in Q&A.

---

## 7. Tech stack

- **Frontend (our clarity win, plays to a full-stack team):** web app with 3 panels — left: upload / "Load sample claim"; center: the live Band room as a color-coded chat where you *watch* agents argue and hand off; right: live "Decision State" panel (current fault %, recovery $, confidence, escalation flag + human Approve/Reject). Stream with websockets/SSE.
- **Backend:** orchestrates the agents (each = role + prompt + model), all registered in a Band room; relays the room to the UI; enforces the citation gate + turn protocol.
- **Models:** Anthropic (Claude) + Google (Gemini) + OpenAI (GPT), all via OpenAI-compatible endpoints.
- **Deploy:** frontend on Vercel, backend on Railway/Render/Fly. **"Load sample claim" button is mandatory** so judges try it in one click.
- **Data:** synthetic claims built on **public NHTSA crash-report formats** + real public state negligence statutes. No real personal data.

---

## 8. Six-day plan (June 13–18, submit early)

| Day | Goal |
|---|---|
| **Day 1 — Sat 6/13** | Accounts: Band + model keys (Claude / Gemini / OpenAI). **Read Band's quickstart end-to-end.** Repo scaffold + MIT license. Goal: 2 agents talking in a Band room about a sample claim. Lock the ONE sample case for the demo. |
| **Day 2 — Sun 6/14** | Intake Parser + Evidence Aggregator (GPT / Gemini) → produce the structured Evidence Ledger from synthetic docs. |
| **Day 3 — Mon 6/15** | Liability Advocate (Claude) + Opposing Red-Team (GPT) + Adjudicators (Claude / Gemini). Build the citation gate + turn protocol. Load 1–2 real state statutes. |
| **Day 4 — Tue 6/16** | Demand Letter Drafter + escalation gate. Add stretch agents if ahead. Polish the Band handoffs. |
| **Day 5 — Wed 6/17** | Frontend 3-panel UI + deploy live. End-to-end run on 3 cases (clean win, disputed, loser). **Cache the demo run** so a flaky API can't break the video. |
| **Day 6 — Thu 6/18** | Record the 3-min video, finish the deck + README, confirm the live link + sample button work for a stranger. **Submit by Thursday evening.** |
| **Fri 6/19** | Buffer only. Final check, confirm submission landed. |

---

## 9. Demo video (~3 min)

1. **0:00–0:20 Problem** — insurers leave $15–20B/yr uncollected because recovery is manual.
2. **0:20–0:35 Idea** — a team of AI specialists that argue both sides and produce a ready-to-send recovery package, coordinated by Band.
3. **0:35–2:20 Live run** — load the sample claim; narrate the room: facts extracted → Advocate vs Opposing **disagree** → Adjudicator decides with shown math → big claim **escalates** → click Approve. Point at Band doing handoffs and enforcing "no claim without evidence."
4. **2:20–2:50 Why it's special** — different model per specialist, two providers, real disagreement, and it tells you when *not* to pursue.
5. **2:50–3:00 Close** — the dollar recovered, "coordinated on Band, with agents across Claude, Gemini, and GPT."

## 10. Pitch deck (8 slides)

Title → Problem ($15–20B) → Why one AI fails here → The team (agent diagram) → How Band coordinates + enforces the rules → Live screenshot: "$X recovered" → Tech (Band + both providers, said explicitly for the prizes) → Impact / what's next.

---

## 11. Risks & mitigations

- **Band learning curve** → tackle Day 1, first thing.
- **Live demo flakes** → pre-cache the sample run; never depend on a live API call in the video.
- **Looks like linear automation** → the visible disagreement + escalation + citation gate are the proof it isn't. Show them.
- **Scope creep** → ONE claim type, ONE sample case. Depth over breadth.
- **Domain depth in Q&A** → cite real statutes (e.g., California Civil Code §1431.2 on comparative fault); frame as a first-draft assistant for adjusters, not an autonomous filer.

## 12. To verify before relying on it
- Band access + exact quickstart/SDK (the one real unknown).
- Promo codes (`BANDHACK26`, `BOA26`) and partner-credit amounts — confirm on the official dashboard/Discord.
- Exact 1st-place prize split and the list of competing submissions — confirm on the lablab page once logged in.

## 13. Why this wins
- **Original** — insurance subrogation is untouched, by both the contest field and the broader AI-startup landscape.
- **Real value** — a concrete dollar amount on screen; touches every property/auto insurer.
- **Genuinely multi-agent** — separate departments + legal privilege make multiple agents *required*, not decorative.
- **Genuinely independent agents** — the debate and the dual-adjudicator consensus span three different model families (Claude / Gemini / GPT), so "diverse models resist collusion" is real, not cosmetic.
