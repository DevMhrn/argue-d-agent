# Product Context

This document is the shared mental model for contributors and coding agents. It explains the real-world problem Lumen is modeling, the core workflow roles, the safety rules, and this repository's ownership boundary.

## The Running Story

Use the Alex Rivera vs. Jordan Blake crash as the default example. Alex drives through an intersection on a green light. Jordan runs the red and hits Alex's driver-side door. Alex's car is totaled for $31,200, Alex has $10,800 in medical bills, and the total claim is $42,000.

Alex's insurer pays quickly so Alex can move on. But Alex did not cause the crash. Jordan's insurer should reimburse Alex's insurer. That recovery process is subrogation, or "subro" in insurance shorthand.

In the product narrative, subrogation is slow because recovery teams must gather police reports, witness statements, photos, repair invoices, medical bills, event data recorder information, policies, liability analysis, demand letters, negotiation records, and sometimes arbitration material. Because the work is document-heavy and time-sensitive, many viable cases are delayed or dropped. Lumen exists to make that recovery workflow fast enough to pursue more cases.

## What Lumen Builds

Lumen behaves like a specialized insurance recovery department. It reads a claim, organizes evidence, argues the carrier's recovery position, red-teams the opposing insurer's likely pushback, adjudicates fault with visible reasoning, and drafts a recovery demand package for human review.

The target user is an insurance recovery team. The product should feel like a practical workbench for adjusters, liability analysts, recovery specialists, and legal reviewers. It should not behave like a generic chatbot.

## Core Workflow Roles

1. **Intake Parser** reads the claim and extracts parties, date, location, loss facts, and damages. In the running story, it identifies Alex Rivera vs. Jordan Blake, April 27, 2026, 5th Ave & Main St, San Jose, CA, and $42,000 in damages.
2. **Evidence Aggregator** turns source documents into a numbered Evidence Ledger. Each fact has an ID, statement, source, and supporting reference. Example facts include Blake entering against a red light, Blake being cited, Rivera's pre-impact speed, and witness statements.
3. **Liability Advocate** builds the strongest recovery argument for our insured or carrier. Every factual point must cite existing fact IDs or statute IDs.
4. **Opposing-Carrier Red Team** attacks that argument as the other insurer would. It is adversarial, not conciliatory, and should expose comparative negligence, causation, coverage, and proof weaknesses.
5. **Adjudicator** weighs both sides, produces a fault table, sets the fault percentage, confidence, and recovery amount. For example, 85% fault against Blake yields a $35,700 recovery demand on a $42,000 loss.
6. **Demand Letter Drafter** writes the ready-to-review demand letter from the adjudicator's decision, citing the same evidence and matching the final fault and dollar figures.

The runtime implementation splits adjudication into Adjudicator A/B and adds the Source-Alignment Verifier, so the active agent roster has 8 agents. See `backend/app/agents.py` for the current execution roster.

## Safety Rules

Two rules are central to every change:

1. **No made-up facts.** Downstream agents must cite existing fact IDs or statute IDs. Code gates should reject uncited, missing, invalid, or internally inconsistent claims.
2. **Call a human.** High-value, low-confidence, close-liability, or gate-failed cases should escalate with the full packet for review.

The system should be comfortable saying "not in evidence" rather than inventing support. Escalation is a product feature, not a failure.

## Current Repository Boundary

This repository owns the active product prototype:

- production Python backend under `backend/`
- active Next.js console under `frontend/`
- ingestion, ledger, and orchestration lanes connected by database contracts
- mock/demo behavior for safe offline checks

The orchestration boundary still matters:

- agent sequencing and role definitions
- room and handoff behavior
- debate protocol
- citation, fact, and math gates
- adjudication flow
- demand package assembly

Do not bake in assumptions that make it hard to swap claim parsers, OCR pipelines, document stores, statute stores, or ledger producers. When in doubt, preserve the lane boundary: ingestion produces documents/pages, ledger produces the evidence graph, and orchestration runs the recovery debate over those inputs.
