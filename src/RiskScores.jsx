import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 6 — Explainable risk scores (live, DB-computed).
   Bars show GET /api/risks/score numbers; the WHY list quotes the row
   counts behind them. This panel never scores anything itself. */

const DIMS = [
  ["project", "Project Risk"],
  ["safety", "Safety Risk"],
  ["inventory", "Inventory Risk"],
  ["budget", "Budget Risk"],
  ["schedule", "Schedule Risk"],
];

const BAND_COLOR = {
  HIGH: "#dc2626",
  MEDIUM: "#ea580c",
  LOW: "#eab308",
  MINIMAL: "#1a7f37",
};

function RiskScores() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    fetch(`/api/risks/score?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((data) => {
        if (live) {
          setReport(data);
          setLoading(false);
          setError("");
        }
      })
      .catch(() => {
        if (live) {
          setReport(null);
          setLoading(false);
          setError("Could not reach the risk engine — start the backend for live scores.");
        }
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  return (
    <div className="panel recurring-panel">
      <div className="panel-header">
        <div>
          <h2>
            <Icon name="chart" /> Risk Scores
          </h2>
          <p>Computed from live incidents, stock, budget and schedule signals — with reasons.</p>
        </div>
        {projects.length > 0 && (
          <label className="recurring-window">
            Project{" "}
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setLoading(true);
                setError("");
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && (
        <>
          <div className="skeleton-block tall" aria-hidden="true" />
          <div className="skeleton-block" aria-hidden="true" />
          <span className="voice-note" role="status">
            Scoring live project data…
          </span>
        </>
      )}
      {error && (
        <p className="voice-note" role="status">
          {error}
        </p>
      )}

      {report && (
        <>
          {report.hotspot.label && (
            <div className="alert-item danger">
              <div className="alert-icon" aria-hidden="true">
                <Icon name="alert" />
              </div>
              <div>
                <strong>
                  {report.hotspot.level} RISK — {report.hotspot.label}
                </strong>
                <p>
                  {report.hotspot.open_incidents} open incident(s)
                  {report.hotspot.recurring_occurrences > 0 &&
                    ` · worst repeat ${report.hotspot.recurring_occurrences}× in 14 days`}
                </p>
              </div>
            </div>
          )}

          {DIMS.map(([key, label]) => (
            <div className="project-row" key={key}>
              <div className="project-info">
                <strong>{label}</strong>
                <span>{report.bands[key]}</span>
              </div>
              <div className="progress-area">
                <div className="progress-bar">
                  <div
                    style={{
                      width: `${report.scores[key]}%`,
                      background: BAND_COLOR[report.bands[key]] || "#1a7f37",
                    }}
                  />
                </div>
                <span>{report.scores[key]}/100</span>
              </div>
            </div>
          ))}

          <div className="voice-section">
            <h5>Reasons</h5>
            <ul className="recurring-evidence">
              {report.top_reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export default RiskScores;
