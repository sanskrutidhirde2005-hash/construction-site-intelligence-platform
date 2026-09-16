import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { formatINRCompact, RISK_META } from "./budget";

/* Phase 9 — Budget intelligence (live, row-backed).
   Original / Spent / Predicted final / Overrun in Cr/Lakh, plus the WHY:
   spend drivers from inventory consumption, burn per progress point,
   committed-but-unspent liability and delay signals. Renders the
   budget-intel endpoint — computes nothing itself. */

function BudgetIntel({ projectId }) {
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/budget-intel`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((data) => {
        if (live) {
          setIntel(data);
          setLoading(false);
          setError("");
        }
      })
      .catch(() => {
        if (live) {
          setIntel(null);
          setLoading(false);
          setError("Budget intel unavailable — start the backend.");
        }
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  if (!projectId) return null;
  if (loading) return <p className="voice-note">Analysing spend drivers…</p>;
  if (error)
    return (
      <p className="voice-note" role="status">
        {error}
      </p>
    );
  if (!intel) return null;

  const riskMeta = RISK_META[intel.risk] || RISK_META.UNKNOWN;
  const overrun = intel.overrun != null && intel.overrun > 0;

  return (
    <div className="overall-progress-card">
      <div className="overall-progress-header">
        <div>
          <h2>
            <Icon name="wallet" /> Budget Intelligence — {intel.project_name}
          </h2>
          <p>
            Forecast connected to inventory consumption, progress and delay signals
            {intel.progress != null ? ` · progress ${intel.progress}%` : ""}
          </p>
        </div>
        <span>
          <Icon name="circle" style={{ color: riskMeta.color }} /> {riskMeta.label}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "12px",
          marginTop: "16px",
        }}
      >
        <div>
          <span>Original Budget</span>
          <br />
          <strong>{intel.formatted.original}</strong>
        </div>
        <div>
          <span>Spent</span>
          <br />
          <strong>{intel.formatted.spent}</strong>
        </div>
        <div>
          <span>Predicted Final</span>
          <br />
          <strong>{intel.formatted.predicted}</strong>
        </div>
        <div>
          <span>Expected Overrun</span>
          <br />
          <strong style={overrun ? { color: "#b91c1c" } : undefined}>
            {overrun && (
              <>
                <Icon name="alert" />{" "}
              </>
            )}
            {intel.formatted.overrun}
          </strong>
        </div>
      </div>

      <div className="voice-section">
        <h5>Why — contributors from project data</h5>
        <ul className="recurring-evidence">
          {intel.contributors.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>

      {intel.spend_drivers.length > 0 && (
        <div className="voice-section">
          <h5>Top spend drivers</h5>
          {intel.spend_drivers.map((d) => (
            <div className="project-row" key={d.name}>
              <div className="project-info">
                <strong>{d.name}</strong>
                <span>
                  {d.used_qty} {d.unit} @ {formatINRCompact(d.cost)}
                </span>
              </div>
              <div className="progress-area">
                <div className="progress-bar">
                  <div style={{ width: `${Math.min(100, d.share_pct)}%` }} />
                </div>
                <span>
                  {formatINRCompact(d.spend)} · {d.share_pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default BudgetIntel;
