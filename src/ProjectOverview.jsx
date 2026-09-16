import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 13 — live project overview. Progress, risk and budget-use come
   from the project row, the risk engine and budget intel for the selected
   project; the list below covers every project on record. Nothing here
   is hardcoded. */

function ProjectOverview({ navigateTo }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [risk, setRisk] = useState(null);
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        setProjects(list || []);
        if (list && list.length > 0) setProjectId(String(list[0].id));
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    Promise.all([
      fetch(`/api/risks/score?project_id=${encodeURIComponent(projectId)}`).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/projects/${encodeURIComponent(projectId)}/budget-intel`).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(([score, budget]) => {
        if (!live) return;
        setRisk(score);
        setIntel(budget);
        setLoading(false);
      })
      .catch(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  const selected = projects.find((p) => String(p.id) === String(projectId));
  const usedPct =
    intel && intel.original_budget > 0
      ? Math.min(100, Math.round((intel.spent / intel.original_budget) * 100))
      : null;

  return (
    <div className="panel project-panel">
      <div className="panel-header">
        <div>
          <h2>Project Overview</h2>
          <p>Live progress, risk and budget use per project</p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {projects.length > 0 && (
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setRisk(null);
                setIntel(null);
                setLoading(true);
              }}
              aria-label="Select project"
              style={{ padding: "6px 10px", borderRadius: "1px", border: "1px solid #c7bca1" }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button className="view-button" onClick={() => navigateTo("projects")}>
            View All <Icon name="arrowRight" />
          </button>
        </div>
      </div>

      {loading ? (
        <>
          <div className="skeleton-block tall" aria-hidden="true" />
          <div className="skeleton-block" aria-hidden="true" />
          <div className="skeleton-block" aria-hidden="true" />
          <span className="voice-note" role="status">
            Loading live project data…
          </span>
        </>
      ) : !selected ? (
        <p className="voice-note" role="status">
          No projects on record yet — create one from the Projects page.
        </p>
      ) : (
        <>
          <div className="trio-grid">
            <div>
              <span>Progress</span>
              <br />
              <strong>{selected.progress ?? 0}%</strong>
            </div>
            <div>
              <span>Risk</span>
              <br />
              <strong>{risk ? `${risk.scores.project}/100 (${risk.bands.project})` : "—"}</strong>
            </div>
            <div>
              <span>Budget used</span>
              <br />
              <strong>{usedPct === null ? "—" : `${usedPct}%`}</strong>
            </div>
          </div>

          {projects.map((p) => (
            <div className="project-row" key={p.id}>
              <div className="project-info">
                <strong>{p.name}</strong>
                <span>{p.status || "Active"}</span>
              </div>
              <div className="progress-area">
                <div className="progress-bar">
                  <div style={{ width: `${p.progress || 0}%` }}></div>
                </div>
                <span>{p.progress || 0}%</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default ProjectOverview;
