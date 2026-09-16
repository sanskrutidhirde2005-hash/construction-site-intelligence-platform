import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 8 — Inventory intelligence (live, consumption-based).
   Stock, daily burn measured from confirmed daily updates, days remaining,
   upcoming requirement and a shortage verdict with its reason. Unknown burn
   renders as unknown — never as zero. This panel forecasts; it never edits. */

function fmt(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function InventoryForecast({ projectId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    fetch(`/api/materials/forecast?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((fc) => {
        if (live) {
          setData(fc);
          setLoading(false);
          setError("");
        }
      })
      .catch(() => {
        if (live) {
          setData(null);
          setLoading(false);
          setError("Forecast unavailable — start the backend for live predictions.");
        }
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  if (!projectId) return null;
  if (loading)
    return (
      <>
        <div className="skeleton-block tall" aria-hidden="true" />
        <span className="voice-note" role="status">
          Forecasting from daily consumption…
        </span>
      </>
    );
  if (error)
    return (
      <p className="voice-note" role="status">
        {error}
      </p>
    );
  if (!data || data.materials.length === 0) return null;

  return (
    <div className="panel recurring-panel">
      <div className="panel-header">
        <div>
          <h2>
            <Icon name="chart" /> Inventory Forecast
          </h2>
          <p>
            Burn measured over the last {data.window_days} days of confirmed updates
            {data.shortage_count > 0
              ? ` — ${data.shortage_count} shortage(s) predicted.`
              : " — stock covers requirements."}
          </p>
        </div>
      </div>

      {data.materials.map((m) => (
        <div className={`alert-item ${m.predicted_shortage ? "danger" : "info"}`} key={m.material_id}>
          <div className="alert-icon" aria-hidden="true">
            <Icon name={m.predicted_shortage ? "alert" : "package"} />
          </div>
          <div>
            <strong>
              {m.name}
              {m.predicted_shortage ? (
                <>
                  {" — "}
                  <Icon name="alert" /> SHORTAGE PREDICTED
                </>
              ) : (
                ""
              )}
            </strong>
            <p>
              Stock: {fmt(m.stock)} {m.unit} · Daily:{" "}
              {m.daily_consumption == null ? "unknown" : `${fmt(m.daily_consumption)} ${m.unit}`} ·
              Days left: {m.days_remaining == null ? "unknown" : `~${m.days_remaining}`} ·
              Needs {fmt(m.upcoming_requirement)} more {m.unit}
            </p>
            <small>{m.reason}</small>
          </div>
        </div>
      ))}
    </div>
  );
}

export default InventoryForecast;
