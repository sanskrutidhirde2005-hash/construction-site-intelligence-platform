import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 13 — live alert counts, portfolio-wide. Open safety incidents from
   the incident register; inventory warnings summed from per-project
   consumption forecasts; plus the freshest attention rows. */

function DashAlerts({ navigateTo }) {
  const [safety, setSafety] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [attention, setAttention] = useState([]);

  useEffect(() => {
    let live = true;
    const get = (url) =>
      fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    (async () => {
      const [issues, inspections, projects] = await Promise.all([
        get("/api/safety_issues"),
        get("/api/inspections"),
        get("/api/projects"),
      ]);
      if (!live) return;
      const open = (Array.isArray(issues) ? issues : []).filter((r) => !r.resolved_at);
      setSafety(open);
      setAttention(
        (Array.isArray(inspections) ? inspections : [])
          .filter((r) => ["attention", "delayed", "fail", "failed"].includes((r.status || "").toLowerCase()))
          .slice(0, 2)
      );
      const lists = Array.isArray(projects) ? projects : [];
      const forecasts = await Promise.all(
        lists.map((p) => get(`/api/materials/forecast?project_id=${p.id}`))
      );
      if (!live) return;
      let total = 0;
      let top = null;
      for (const fc of forecasts) {
        if (!fc || !Array.isArray(fc.materials)) continue;
        for (const m of fc.materials) {
          if (m.predicted_shortage) {
            total += 1;
            if (!top) top = m;
          }
        }
      }
      setWarnings({ total, top });
    })();
    return () => {
      live = false;
    };
  }, []);

  const topSafety = safety && safety.length > 0 ? safety[0] : null;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Priority Alerts</h2>
          <p>Live counts across all projects</p>
        </div>
      </div>

      <div className="duo-grid">
        <div>
          <span>Safety Issues</span>
          <br />
          {safety === null ? (
            <div className="skeleton-block tall" aria-hidden="true" />
          ) : (
            <>
              <strong style={{ fontSize: "26px" }}>{safety.length}</strong>
              <br />
              <small>{topSafety ? `Latest: ${topSafety.title}` : "No open incidents"}</small>
            </>
          )}
        </div>
        <div>
          <span>Inventory Warnings</span>
          <br />
          {warnings === null ? (
            <div className="skeleton-block tall" aria-hidden="true" />
          ) : (
            <>
              <strong style={{ fontSize: "26px" }}>{warnings.total}</strong>
              <br />
              <small>{warnings?.top ? `Top: ${warnings.top.name} shortage` : "Stock covers needs"}</small>
            </>
          )}
        </div>
      </div>

      {topSafety && (
        <div className="alert-item danger">
          <div className="alert-icon" aria-hidden="true">
            <Icon name="alert" />
          </div>
          <div>
            <strong>Safety Issue</strong>
            <p>{topSafety.title}</p>
            <small>
              {topSafety.reported_at ? topSafety.reported_at.slice(0, 10) : "Date unrecorded"} ·{" "}
              {topSafety.severity}
            </small>
          </div>
        </div>
      )}

      {attention.map((r) => (
        <div className="alert-item info" key={r.id}>
          <div className="alert-icon" aria-hidden="true">
            <Icon name="check" />
          </div>
          <div>
            <strong>Needs attention</strong>
            <p>{(r.notes || "Inspection flagged").slice(0, 120)}</p>
            <small>
              Update #{r.id} · {r.log_date || "date unrecorded"}
            </small>
          </div>
        </div>
      ))}

      {safety !== null && safety.length === 0 && attention.length === 0 && (
        <p className="voice-note" role="status">
          Nothing needs attention right now.
        </p>
      )}

      <button className="view-button" onClick={() => navigateTo("risk")} style={{ marginTop: "8px" }}>
        Open Risk & Alerts <Icon name="arrowRight" />
      </button>
    </div>
  );
}

export default DashAlerts;
