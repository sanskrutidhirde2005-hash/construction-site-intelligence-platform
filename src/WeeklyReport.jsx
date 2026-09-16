import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 12 — AI Weekly Report (live, engine-aggregated).
   Generate gathers the week across updates, safety, repeats, inventory,
   budget, schedule, risks and alerts, then snapshots the numbers so the
   next report shows honest deltas. History re-opens past snapshots. */

function Headline({ label, value, warn }) {
  return (
    <div>
      <span>{label}</span>
      <br />
      <strong style={warn ? { color: "#b91c1c" } : undefined}>{value}</strong>
    </div>
  );
}

function ReportView({ r }) {
  const p = r.progress;
  const delta =
    p.delta_vs_last_report === null || p.delta_vs_last_report === undefined
      ? "baseline established"
      : `${p.delta_vs_last_report > 0 ? "+" : ""}${p.delta_vs_last_report}% vs last report`;
  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "12px",
          marginTop: "16px",
        }}
      >
        <Headline label="Progress" value={`${p.current}% (${delta})`} />
        <Headline label="Daily updates" value={r.daily_updates.count} />
        <Headline
          label="Safety incidents"
          value={r.safety.reported_in_week}
          warn={r.safety.reported_in_week > 0}
        />
        <Headline
          label="Recurring issues"
          value={r.recurring.length}
          warn={r.recurring.length > 0}
        />
        <Headline
          label="Inventory warnings"
          value={r.inventory.warnings}
          warn={r.inventory.warnings > 0}
        />
        <Headline
          label="Budget variance"
          value={r.budget ? r.budget.formatted.overrun : "—"}
          warn={r.budget && (r.budget.overrun || 0) > 0}
        />
        <Headline
          label="Schedule"
          value={
            r.schedule
              ? `${r.schedule.band} (${r.schedule.score}/100)`
              : "—"
          }
          warn={r.schedule && r.schedule.score >= 50}
        />
        <Headline label="Risks raised" value={r.risks.raised_in_week} />
      </div>

      <div className="voice-section">
        <h5>Top risks</h5>
        {r.top_risks.length === 0 ? (
          <p className="voice-empty">None recorded this week.</p>
        ) : (
          <ol className="recurring-evidence">
            {r.top_risks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        )}
      </div>

      <div className="voice-section">
        <h5>Recommended actions</h5>
        <ul className="recurring-evidence">
          {r.recommended_actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>
    </>
  );
}

function WeeklyReport({ projectId, projectName }) {
  const [report, setReport] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = () => {
    if (!projectId) return;
    fetch(`/api/reports/weekly?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => setHistory(Array.isArray(list) ? list : []))
      .catch(() => {});
  };

  useEffect(loadHistory, [projectId]);

  const generate = async () => {
    if (!projectId || loading) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/reports/weekly?project_id=${encodeURIComponent(projectId)}&days=7`,
        { method: "POST" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not generate the report.");
      setReport(data);
      loadHistory();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  if (!projectId) return null;

  return (
    <div className="overall-progress-card">
      <div className="overall-progress-header">
        <div>
          <h2>
            <Icon name="file" /> Weekly Project Report — {projectName || "Project"}
          </h2>
          <p>
            Gathered across daily updates, safety, repeats, inventory, budget,
            schedule, risks and alerts — then snapshotted for next week's deltas.
          </p>
        </div>
        <button
          type="button"
          className="voice-primary-btn"
          onClick={generate}
          disabled={loading}
        >
          <Icon name="sparkles" />
          {loading ? "Gathering…" : "Generate Weekly Report"}
        </button>
      </div>

      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <>
          <p className="voice-note">
            Week {report.week_start} → {report.week_end} · saved as report #{report.report_id}
          </p>
          <ReportView r={report} />
        </>
      )}

      {history.length > 0 && (
        <div className="voice-section">
          <h5>Past reports</h5>
          <ul className="recurring-evidence">
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setReport(h.payload)}
                >
                  Report #{h.id}
                </button>{" "}
                · week of {h.week_start} · generated {h.created_at}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default WeeklyReport;
