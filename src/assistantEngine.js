/* BuildSafe assistant engine — client-side grounded answers over LIVE site data.
   Primary path is always POST /api/genai/query (LLM or backend offline mode).
   This module is the fallback + scope helper: same math as backend
   (_calc_budget / _shortfalls), zero fake demo numbers. */

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const inr = (v) =>
  v === null || v === undefined ? "—" : `₹${num(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

async function get(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch every collection the assistant can reason over. Never throws. */
export async function fetchSiteData(projectId) {
  const scope = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const [projects, materials, inspections, observations, summary, safetyIssues] = await Promise.all([
    get("/api/projects"),
    get(`/api/materials${scope}`),
    get("/api/inspections"),
    get(`/api/observations${scope}`),
    get("/api/dashboard/summary"),
    get(`/api/safety_issues${scope}`),
  ]);
  const reachable = [projects, materials, inspections, observations, summary, safetyIssues].some(
    (d) => d !== null && d !== undefined
  );
  const byProject = (rows, pid) =>
    (Array.isArray(rows) ? rows : []).filter(
      (r) => !pid || String(r.project_id) === String(pid)
    );
  return {
    projects: Array.isArray(projects) ? projects : [],
    materials: Array.isArray(materials) ? materials : [],
    inspections: byProject(inspections, projectId),
    observations: byProject(observations, projectId),
    safetyIssues: byProject(safetyIssues, projectId),
    summary: summary || null,
    reachable,
    recordCount:
      (Array.isArray(projects) ? projects.length : 0) +
      (Array.isArray(materials) ? materials.length : 0) +
      byProject(inspections, projectId).length +
      byProject(observations, projectId).length +
      byProject(safetyIssues, projectId).length,
  };
}

/* ---------- budget math (mirrors backend _calc_budget) ---------- */

export function spentFor(materials, projectId) {
  return materials
    .filter((m) => String(m.project_id) === String(projectId))
    .reduce((s, m) => s + num(m.cost) * num(m.used_qty), 0);
}

export function budgetCalc(project, spent) {
  const budget = num(project.total_budget);
  const prog = num(project.progress);
  const remaining = budget - spent;
  if (budget <= 0)
    return { budget, spent, prog, remaining, predicted: null, risk: "UNKNOWN" };
  if (prog <= 0)
    return { budget, spent, prog, remaining, predicted: null, risk: "UNKNOWN" };
  const predicted = (spent / prog) * 100;
  const overrun = predicted - budget;
  const pct = (overrun / budget) * 100;
  return {
    budget, spent, prog, remaining, predicted, overrun, overrunPct: pct,
    risk: pct > 10 ? "HIGH" : pct > 0 ? "WATCH" : "ON TRACK",
  };
}

export function shortfalls(materials) {
  return materials
    .map((m) => {
      const req = num(m.required_qty);
      const rec = num(m.received_qty);
      const used = num(m.used_qty);
      const unit = m.unit || "units";
      const where = `project ${m.project_id ?? "—"}`;
      if (req > 0 && rec < req)
        return { ...m, line: `${m.name} (${where}): required ${req}, received ${rec} — SHORT by ${req - rec} ${unit}`, bad: true };
      if (req > 0)
        return { ...m, line: `${m.name} (${where}): ${rec}/${req} ${unit} received, ${used} used — OK`, bad: false };
      return null;
    })
    .filter(Boolean);
}

const SAFETY_STRONG = ["no_helmet", "no helmet", "without helmet", "ppe", "unsafe", "hazard", "fall", "fail", "violation", "alert"];

export function safetySignals(site) {
  const hits = [];
  for (const o of site.observations) {
    const d = o.details && typeof o.details === "object" ? o.details : {};
    const blob = `${o.title || ""} ${o.area || ""} ${o.kind || ""} ${JSON.stringify(d)}`.toLowerCase();
    const noHelmet = num(d.no_helmet, 0) > 0;
    const lowCompliance = d.compliance_pct !== null && d.compliance_pct !== undefined && num(d.compliance_pct, 100) < 100;
    if (noHelmet || lowCompliance || SAFETY_STRONG.some((w) => blob.includes(w))) {
      const why = noHelmet
        ? `${d.no_helmet} without helmet`
        : lowCompliance
          ? `helmet compliance ${d.compliance_pct}%`
          : "flagged";
      hits.push(`• Observation #${o.id} [${o.area || "site"}]: ${o.title || o.kind || "flagged"} (${why})`);
    }
  }
  for (const i of site.inspections) {
    const s = String(i.status || "").toLowerCase();
    if (["fail", "failed", "attention", "delayed"].includes(s))
      hits.push(`• Inspection #${i.id} (project ${i.project_id}): ${i.status} — ${i.notes || "no notes"}`);
  }
  return hits;
}

/** If the question names a project (#id or name fragment), scope to it. */
export function matchProject(question, projects) {
  const q = question.toLowerCase();
  const idMatch = q.match(/#(\d+)/);
  if (idMatch) {
    const p = projects.find((p) => String(p.id) === idMatch[1]);
    if (p) return p;
  }
  return projects.find((p) => p.name && q.includes(String(p.name).toLowerCase())) || null;
}

/**
 * Answer from live site collections. Returns { text, sections }.
 * scopeProjectId pins materials/inspections/observations (sidebar or details page).
 */
export function answerLocally(question, site, scopeProjectId = null) {
  const q = question.toLowerCase();
  if (!site.reachable || site.recordCount === 0)
    return "Backend unreachable and no live site data is cached — I can't see any projects, materials, inspections or observations right now. Start the backend (port 8000) and ask again; I never guess from demo numbers.";

  const named = matchProject(question, site.projects);
  const scope = named ? named : site.projects.find((p) => String(p.id) === String(scopeProjectId)) || null;
  const scopeId = scope ? scope.id : scopeProjectId;
  const mats = scopeId ? site.materials.filter((m) => String(m.project_id) === String(scopeId)) : site.materials;
  const insp = scopeId ? site.inspections.filter((i) => String(i.project_id) === String(scopeId)) : site.inspections;
  const obs = scopeId ? site.observations.filter((o) => String(o.project_id) === String(scopeId)) : site.observations;
  const scoped = { ...site, materials: mats, inspections: insp, observations: obs };
  const where = scope ? ` for **${scope.name}** (#${scope.id})` : "";

  const wants = (...keys) => keys.some((k) => q.includes(k));
  const sections = [];

  if (wants("hello", "hi", "hey", "namaste") && q.trim().length < 20) {
    const s = site.summary || {};
    sections.push(
      `Hello! I can see **${site.projects.length} projects, ${site.materials.length} material lines, ${site.inspections.length} inspections and ${site.observations.length} site observations** live right now. Ask me about status, budgets, stock, inspections, safety signals or risks${scope ? ` — currently scoped to ${scope.name}` : ""}.`
    );
    return sections.join("\n\n");
  }

  if (wants("budget", "cost", "spent", "overrun", "exceed", "forecast", "money", "lakh", "crore")) {
    const list = scope ? [scope] : site.projects;
    if (!list.length) sections.push("Budgets:\nNo projects recorded yet.");
    else {
      const lines = list.map((p) => {
        const c = budgetCalc(p, spentFor(site.materials, p.id));
        if (c.predicted === null)
          return `• #${p.id} ${p.name}: budget ${inr(c.budget)}, spent ${inr(c.spent)}, progress ${c.prog}% — forecast UNKNOWN (need progress > 0 and a budget set)`;
        return `• #${p.id} ${p.name}: budget ${inr(c.budget)}, spent ${inr(c.spent)}, progress ${c.prog}%, predicted ${inr(c.predicted)} (overrun ${inr(c.overrun)} / ${c.overrunPct.toFixed(1)}%) — risk ${c.risk}`;
      });
      sections.push(`Budget breakdown${where} (predicted = spent ÷ progress):\n${lines.join("\n")}`);
    }
  }

  if (wants("material", "stock", "short", "cement", "steel", "brick", "sand", "inventor")) {
    const sf = shortfalls(mats);
    if (!sf.length) sections.push(`Materials${where}:\nNo material requirements recorded yet — add required/received quantities per project.`);
    else {
      const bad = sf.filter((s) => s.bad);
      sections.push(
        `Materials${where}: ${bad.length} shortfall${bad.length === 1 ? "" : "s"} of ${sf.length} tracked lines.\n` +
        sf.slice(0, 8).map((s) => `• ${s.line}`).join("\n") +
        (sf.length > 8 ? `\n…and ${sf.length - 8} more.` : "")
      );
    }
  }

  if (wants("inspect")) {
    if (!insp.length) sections.push(`Inspections${where}:\nNone recorded yet.`);
    else {
      const byStatus = {};
      insp.forEach((i) => { const s = i.status || "Unknown"; byStatus[s] = (byStatus[s] || 0) + 1; });
      const tally = Object.entries(byStatus).map(([s, c]) => `${s}: ${c}`).join(", ");
      const recent = insp.slice(0, 5).map((r) => `• #${r.id} (project ${r.project_id}): ${r.status} — ${r.notes || "no notes"}`);
      sections.push(`Inspections${where} (${insp.length} total — ${tally}):\n${recent.join("\n")}`);
    }
  }

  if (wants("video", "observation", "site photo", "photo", " Footage", " footage", "camera", "yolo", "detect")) {
    if (!obs.length) sections.push(`Site observations${where}:\nNone yet — analyse a photo or video from SiteVision.`);
    else {
      const recent = obs.slice(0, 3).map((r) => `• #${r.id} [${r.area || "site"}, ${r.kind || "clip"}]: ${r.title || "untitled"}`);
      sections.push(`Recent site observations${where} (${obs.length} total):\n${recent.join("\n")}`);
    }
  }

  if (wants("safety", "ppe", "helmet", "worker", "labour", "hazard")) {
    const hits = safetySignals(scoped);
    // Voice daily updates land here as safety_issues rows (plus Attention
    // inspections, already covered by safetySignals above).
    const si = scopeId
      ? (site.safetyIssues || []).filter((r) => String(r.project_id) === String(scopeId))
      : (site.safetyIssues || []);
    const siLines = si.slice(0, 5).map(
      (r) => `• Safety issue #${r.id} (project ${r.project_id}): ${r.title} [${r.severity || "Medium"}]${r.reported_at ? ` — reported ${String(r.reported_at).slice(0, 10)}` : ""}`
    );
    const all = [...hits.slice(0, 8), ...siLines];
    sections.push(
      all.length
        ? `Safety signals${where} (mined from live observations, inspections and reported safety issues):\n${all.join("\n")}\n\nNote: the Safety page itself is static demo content — the live evidence is above. Verify on-site with the safety officer.`
        : `Safety signals${where}:\nNo safety flags in live observations, inspections or reported issues right now. (The Safety page itself is static demo content, not live records.)`
    );
  }

  if (wants("risk", "danger", "alert", "delay", "problem", "threat", "blocker")) {
    const risks = [];
    const projs = scope ? [scope] : site.projects;
    for (const p of projs) {
      const c = budgetCalc(p, spentFor(site.materials, p.id));
      if (c.predicted !== null && c.overrunPct > 10)
        risks.push(`• Budget risk — #${p.id} ${p.name}: forecast ${c.overrunPct.toFixed(1)}% over budget (${inr(c.overrun)})`);
    }
    for (const i of insp) {
      const s = String(i.status || "").toLowerCase();
      if (["fail", "failed"].includes(s)) risks.push(`• Failed inspection #${i.id} (project ${i.project_id}) — ${i.notes || "no notes"}`);
      else if (["attention", "delayed", "pending"].includes(s)) risks.push(`• ${i.status} inspection #${i.id} (project ${i.project_id})`);
    }
    shortfalls(mats).filter((s) => s.bad).slice(0, 4).forEach((s) => risks.push(`• Stock risk — ${s.line}`));
    safetySignals(scoped).slice(0, 3).forEach((s) => risks.push(s));
    sections.push(risks.length ? `Risks${where} (ranked):\n${risks.slice(0, 10).join("\n")}` : `Risks${where}:\nNothing Risk-worthy in live data right now — no budget overruns >10%, no failed inspections, no stock shortfalls.`);
  }

  if (wants("project", "pending", "status", "active", "progress", "list", "how many", "summary", "report", "today", "overview", "going on", "happening") || sections.length === 0) {
    const byStatus = {};
    site.projects.forEach((p) => { const st = p.status || "Active"; byStatus[st] = (byStatus[st] || 0) + 1; });
    const tally = Object.entries(byStatus).map(([st, c]) => `${st}: ${c}`).join(", ") || "none";
    const lines = [`Projects: ${site.projects.length} total (${tally}).`];
    site.projects.slice(0, 6).forEach((p) =>
      lines.push(`• #${p.id} ${p.name} — ${p.status || "Active"}, ${num(p.progress)}% complete, budget ${inr(p.total_budget)}`)
    );
    if (site.projects.length > 6) lines.push(`…and ${site.projects.length - 6} more.`);
    if (site.summary) {
      lines.push(`\nSite-wide: ${site.summary.inspections_total ?? insp.length} inspections (${site.summary.inspections_attention ?? 0} need attention), ${site.summary.materials_total ?? site.materials.length} material lines, ${site.summary.observations_total ?? obs.length} observations.`);
      if (site.summary.budget_at_risk_count > 0) lines.push(`${site.summary.budget_at_risk_count} project(s) forecast >10% over budget.`);
    }
    const latest = obs[0];
    if (latest) lines.push(`Latest observation: #${latest.id} [${latest.area || "site"}] ${latest.title || ""}`.trim());
    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}
