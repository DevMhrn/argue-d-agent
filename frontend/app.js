/* Lumen web console — connects to the SSE run stream and renders the live
   Band room, the verification gates, and the recovery decision. Vanilla JS,
   no build step. */
"use strict";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const money = (n) => "$" + Number(n).toLocaleString("en-US");

// Map agent display names → role + CSS color var.
const AGENTS = {
  "Intake Parser": { role: "Extracts incident facts · Featherless", color: "var(--a-intake)" },
  "Evidence Aggregator": { role: "Builds the grounded ledger · Featherless", color: "var(--a-evidence)" },
  "Liability Advocate": { role: "Argues our insured's recovery · AI/ML API", color: "var(--a-advocate)" },
  "Opposing-Carrier Red Team": { role: "Attacks the case · AI/ML API", color: "var(--a-opposing)" },
  "Adjudicator A": { role: "Neutral referee · AI/ML API", color: "var(--a-adjA)" },
  "Adjudicator B": { role: "Independent referee · Featherless", color: "var(--a-adjB)" },
  "Source-Alignment Verifier": { role: "Audits cited claims · Featherless", color: "var(--a-verify)" },
  "Demand Letter Drafter": { role: "Drafts the demand letter · AI/ML API", color: "var(--a-drafter)" },
};

// Map an incoming posting → which assurance-rail stage it belongs to.
const STAGE_OF = {
  "Intake Parser": "intake",
  "Evidence Aggregator": "evidence",
  "Fact Gate": "evidence",
  "Liability Advocate": "debate",
  "Opposing-Carrier Red Team": "debate",
  "Citation Gate": "debate",
  "Adjudicator A": "adjudication",
  "Adjudicator B": "adjudication",
  "Math Gate": "adjudication",
  "Consensus Gate": "adjudication",
  "Source-Alignment Verifier": "alignment",
  "Demand Letter Drafter": "letter",
  "Letter Reconciliation": "letter",
};
const STAGE_ORDER = ["intake", "evidence", "debate", "adjudication", "alignment", "letter"];

let currentCaseId = null;
let evtSource = null;
let lastLetter = "";

/* ---------------------------------------------------------------- boot */
async function boot() {
  try {
    const r = await fetch("/api/cases");
    const { mock, cases } = await r.json();
    const badge = $("#modeBadge");
    badge.textContent = mock ? "Mock mode" : "Live";
    badge.className = "badge " + (mock ? "badge--mock" : "badge--live");

    const sel = $("#caseSelect");
    sel.innerHTML = "";
    for (const c of cases) {
      const o = el("option");
      o.value = c.id;
      o.textContent = c.title;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => loadCase(sel.value));
    $("#runBtn").addEventListener("click", run);
    if (cases.length) await loadCase(cases[0].id);
  } catch (e) {
    $("#modeBadge").textContent = "server offline";
  }
  wireDropzone();
}

async function loadCase(id) {
  currentCaseId = id;
  $("#runBtn").disabled = false;
  const r = await fetch("/api/case/" + id);
  const { claim } = await r.json();
  renderCaseFile(claim);
  resetRun();
}

function renderCaseFile(claim) {
  const m = $("#caseMeta");
  m.classList.remove("muted-block");
  m.innerHTML = `
    <div class="cm-title">${esc(claim.caseId)}</div>
    <div class="cm-row"><span>Insured</span><span>${esc(claim.insured)}</span></div>
    <div class="cm-row"><span>Other party</span><span>${esc(claim.otherParty)}</span></div>
    <div class="cm-row"><span>Jurisdiction</span><span>${esc(claim.jurisdiction)}</span></div>
    <div class="cm-row"><span>Documented damages</span><span class="cm-amount">${money(claim.damagesUsd)}</span></div>`;
  const list = $("#docList");
  list.innerHTML = "";
  for (const d of claim.documents || []) {
    list.appendChild(el("li", "", `<span class="dl-ic">▤</span> <span class="dl-kind">${esc(d.kind)}</span>`));
  }
}

/* ---------------------------------------------------------------- run */
function resetRun() {
  $("#feed").innerHTML = "";
  $("#feed").appendChild(buildEmpty());
  $("#decision").hidden = true;
  $("#decisionEmpty").hidden = false;
  $("#ledger").innerHTML = "The ledger is built and locked once analysis runs — every fact anchored to a verbatim source quote.";
  $("#ledger").classList.add("muted-block");
  $("#ledgerStatus").hidden = true;
  document.querySelectorAll(".stage").forEach((s) => (s.className = "stage"));
}

function buildEmpty() {
  const d = el("div", "feed__empty");
  d.id = "feedEmpty";
  d.innerHTML = `<div class="feed__empty-mark"></div><h3>No active session</h3>
    <p>Choose a case file and run the recovery analysis to convene the agent band.</p>`;
  return d;
}

function run() {
  if (!currentCaseId || evtSource) return;
  resetRun();
  $("#feed").innerHTML = "";
  const btn = $("#runBtn");
  btn.disabled = true;
  btn.classList.add("is-running");
  btn.querySelector(".btn__dot");

  evtSource = new EventSource("/api/run/" + currentCaseId);
  evtSource.addEventListener("posting", (e) => onPosting(JSON.parse(e.data)));
  evtSource.addEventListener("result", (e) => onResult(JSON.parse(e.data)));
  evtSource.addEventListener("error", (e) => {
    try { onError(JSON.parse(e.data)); } catch { /* connection close */ }
  });
  evtSource.addEventListener("done", endRun);
}

function endRun() {
  if (evtSource) { evtSource.close(); evtSource = null; }
  const btn = $("#runBtn");
  btn.disabled = false;
  btn.classList.remove("is-running");
  markAllStagesDone();
}

function onError(d) {
  const feed = $("#feed");
  feed.appendChild(el("div", "post post--gate fail",
    `<span class="gate__ic">⛔</span><div><div class="gate__name">Run error</div><div class="gate__body">${esc(d.message || "unknown")}</div></div>`));
  endRun();
}

/* ---------------------------------------------------------------- postings */
function onPosting(p) {
  const feed = $("#feed");
  const empty = $("#feedEmpty");
  if (empty) empty.remove();
  feed.appendChild(renderPosting(p));
  feed.scrollTop = feed.scrollHeight;
  advanceStage(p);
}

function renderPosting(p) {
  const kind = p.kind;
  if (kind === "gate") {
    const fail = /\b(REJECTED|FAILED)\b/.test(p.content);
    return el("div", "post post--gate " + (fail ? "fail" : "ok"),
      `<span class="gate__ic">${fail ? "⛔" : "✓"}</span>
       <div><div class="gate__name">${esc(p.agent)}</div><div class="gate__body">${highlight(p.content)}</div></div>`);
  }
  if (kind === "handoff" || kind === "system") {
    return el("div", "post post--" + kind, `<span>${esc(p.content)}</span>`);
  }
  if (kind === "decision") {
    const a = AGENTS[p.agent] || {};
    const node = el("div", "post post--decision");
    node.style.setProperty("--agent", a.color || "var(--gold)");
    node.innerHTML = `<div class="post__head"><span class="post__dot"></span>
        <span class="post__name">⚖ ${esc(p.agent)}</span></div>
      <div class="post__body">${highlight(p.content)}</div>`;
    return node;
  }
  // message
  const a = AGENTS[p.agent] || { role: "", color: "var(--accent)" };
  const node = el("div", "post post--message");
  node.style.setProperty("--agent", a.color);
  node.innerHTML = `<div class="post__head"><span class="post__dot"></span>
      <span class="post__name">${esc(p.agent)}</span><span class="post__role">${esc(a.role)}</span></div>
    <div class="post__body">${highlight(p.content)}</div>`;
  return node;
}

// Highlight fact/statute citations like [F1] or [CA-1431.2].
function highlight(text) {
  return esc(text).replace(/\[([A-Z]+[\w.\-]*(?:,\s*[A-Z]+[\w.\-]*)*)\]/g,
    '[<span class="cite">$1</span>]');
}

/* ---------------------------------------------------------------- rail */
function advanceStage(p) {
  const stage = STAGE_OF[p.agent];
  if (!stage) return;
  const idx = STAGE_ORDER.indexOf(stage);
  document.querySelectorAll(".stage").forEach((node) => {
    const s = node.dataset.stage;
    const i = STAGE_ORDER.indexOf(s);
    if (i < idx) { node.classList.add("is-done"); node.classList.remove("is-active"); }
    else if (i === idx) { node.classList.add("is-active"); }
  });
  // gate failures flag the current stage
  if (p.kind === "gate" && /\b(REJECTED|FAILED)\b/.test(p.content)) {
    const node = document.querySelector(`.stage[data-stage="${stage}"]`);
    if (node) node.classList.add("has-warn");
  }
}
function markAllStagesDone() {
  document.querySelectorAll(".stage").forEach((s) => {
    s.classList.remove("is-active");
    s.classList.add("is-done");
  });
}

/* ---------------------------------------------------------------- result */
function onResult(res) {
  const d = res.decision;
  $("#decisionEmpty").hidden = true;
  $("#decision").hidden = false;

  $("#recoveryAmount").textContent = money(d.recoveryUsd);
  $("#recoverySub").textContent = `${d.otherDriverFaultPct}% fault × ${money(res.intake.damagesUsd)} documented damages`;

  const outcome = d.outcome || (d.escalate ? "escalate" : "pursue");
  const recLabel = document.querySelector(".recovery__label");
  if (recLabel) recLabel.textContent = outcome === "decline" ? "Maximum recoverable (not pursued)" : "Recommended recovery demand";
  $("#recoveryAmount").classList.toggle("recovery__amount--muted", outcome === "decline");

  $("#faultPctLabel").textContent = `${d.otherDriverFaultPct}% / ${100 - d.otherDriverFaultPct}%`;
  $("#splitFill").style.width = d.otherDriverFaultPct + "%";

  const confPct = Math.round((d.confidence || 0) * 100);
  $("#confLabel").textContent = confPct + "%";
  $("#confFill").style.width = confPct + "%";

  renderConsensus(d);
  renderRecommendation(res, d, outcome);
  renderFaultTable(d.faultTable || []);
  renderLedger(res.ledger);

  lastLetter = res.letter || "";
  $("#letter").textContent = lastLetter;
  $("#downloadLetter").onclick = (ev) => { ev.preventDefault(); downloadLetter(res); };

  if (res.bandRoomId) {
    $("#bandRoom").hidden = false;
    const bc = $("#bandRoomId");
    bc.textContent = res.bandRoomId;
    bc.onclick = () => navigator.clipboard?.writeText(res.bandRoomId);
  }

  if (res.auditHash) {
    $("#audit").hidden = false;
    const code = $("#auditHash");
    code.textContent = res.auditHash;
    code.onclick = () => navigator.clipboard?.writeText(res.auditHash);
  }
}

function renderConsensus(d) {
  const c = $("#consensus");
  c.className = "consensus " + (d.consensus || "");
  const sec = d.secondary ? ` · A & B reviewed` : "";
  if (d.consensus === "agreement") c.innerHTML = `✓ Adjudicators converged (Δ${d.consensusDelta}pp)${sec}`;
  else if (d.consensus === "disagreement") c.innerHTML = `⚠ Adjudicators disagreed (Δ${d.consensusDelta}pp) — forced human review`;
  else if (d.consensus === "single") c.innerHTML = `⚠ One adjudicator usable — reduced confidence`;
  else c.innerHTML = `Adjudication complete`;
}

function renderRecommendation(res, d, outcome) {
  const box = $("#escalation");
  const head = document.querySelector(".escalation__head");
  const actions = document.querySelector(".escalation__actions");
  const ul = $("#escalationReasons");
  const note = $("#humanResult");
  ul.innerHTML = "";
  note.hidden = true;

  if (outcome === "decline") {
    // Lumen recommends NOT pursuing — close the file.
    box.hidden = false;
    box.className = "escalation escalation--decline";
    head.textContent = "✕ Recommendation: DO NOT PURSUE";
    (d.declineReason ? d.declineReason.split("; ") : []).forEach((r) => ul.appendChild(el("li", "", esc(r))));
    if (actions) actions.style.display = "none";
    note.hidden = false;
    note.className = "escalation__result no";
    note.textContent = "Recommend closing the file — recovery does not justify the cost of pursuit.";
    return;
  }

  if (actions) actions.style.display = "";
  if (outcome === "escalate") {
    box.hidden = false;
    box.className = "escalation";
    head.textContent = "⚑ Escalated to human adjuster";
    (d.escalateReasons || []).forEach((r) => ul.appendChild(el("li", "", esc(r))));
    $("#approveBtn").onclick = () => human(d, "approve");
    $("#rejectBtn").onclick = () => human(d, "reject");
  } else {
    // pursue — auto-cleared, no human gate needed
    box.hidden = true;
  }
}

async function human(_d, action) {
  try {
    await fetch("/api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: currentCaseId, action }),
    });
  } catch { /* demo: ignore */ }
  const r = $("#humanResult");
  r.hidden = false;
  if (action === "approve") { r.className = "escalation__result ok"; r.textContent = "✓ Demand approved by adjuster — cleared to send."; }
  else { r.className = "escalation__result no"; r.textContent = "✕ Overridden by adjuster — returned for review."; }
  $("#approveBtn").disabled = true;
  $("#rejectBtn").disabled = true;
}

function renderFaultTable(rows) {
  const t = $("#faultTable");
  t.innerHTML = "";
  for (const r of rows) {
    t.appendChild(el("tr", "",
      `<td class="ft-id">${esc(r.factId)}</td>
       <td class="ft-${esc(r.favors)}">${esc(r.favors)}</td>
       <td style="text-align:right;color:var(--muted)">w ${esc(r.weight)}</td>`));
  }
}

function renderLedger(ledger) {
  if (!ledger || !ledger.facts) return;
  const box = $("#ledger");
  box.classList.remove("muted-block");
  box.innerHTML = "";
  for (const f of ledger.facts) {
    const conf = Math.round((f.confidence || 0) * 100);
    box.appendChild(el("div", "fact",
      `<div class="fact__top"><span class="fact__id">${esc(f.id)}</span>
         <span class="fact__anchor">✓ anchored</span></div>
       <div class="fact__stmt">${esc(f.statement)}</div>
       <div class="fact__src">${esc(f.source)}</div>
       <div class="fact__conf"><i style="width:${conf}%"></i></div>`));
  }
  $("#ledgerStatus").hidden = false;
}

function downloadLetter(res) {
  const blob = new Blob([lastLetter], { type: "text/plain" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = `demand-letter-${res.decision ? currentCaseId : "case"}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------------------------------------------------------------- dropzone (ingestion seam) */
function wireDropzone() {
  const dz = $("#dropzone");
  if (!dz) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { stop(e); dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { stop(e); dz.classList.remove("is-over"); }));
  dz.addEventListener("drop", async () => {
    const hint = $("#ingestHint");
    hint.textContent = "Sending to ingestion pipeline…";
    try {
      const r = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json();
      hint.textContent = j.message || "Queued for ingestion.";
    } catch {
      hint.textContent = "Ingestion service not connected yet.";
    }
  });
}

boot();
