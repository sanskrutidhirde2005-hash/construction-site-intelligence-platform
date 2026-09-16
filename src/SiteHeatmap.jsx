import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 7 — Risk heatmap (live, DB-attributed).
   Site → Building → Floor → Area tree; each area dot shows its computed
   risk band. Clicking an area opens everything recorded there: incidents,
   observations, recurring issues, latest updates, AI detections, the area
   risk score with reasons, and recommended actions. Locations matching no
   modelled area are listed under Unmapped — never forced into an area. */

const DOT = {
  HIGH: "#dc2626",
  MEDIUM: "#ea580c",
  LOW: "#eab308",
  MINIMAL: "#1a7f37",
};

function AreaChip({ area, selected, onSelect }) {
  const band = area.risk.band;
  return (
    <button
      type="button"
      className={`heat-area${selected ? " selected" : ""}`}
      onClick={() => onSelect(area)}
      aria-pressed={selected}
      title={`${area.name}: ${area.risk.score}/100 (${band})`}
    >
      <span
        className="heat-dot"
        style={{ background: DOT[band] || DOT.MINIMAL }}
        aria-hidden="true"
      />
      <span className="heat-area-name">{area.name}</span>
      <span className="heat-area-score">{area.risk.score}</span>
    </button>
  );
}

function DetailList({ title, items, render, empty }) {
  return (
    <div className="voice-section">
      <h5>{title}</h5>
      {items.length === 0 ? (
        <p className="voice-empty">{empty}</p>
      ) : (
        <ul className="recurring-evidence">
          {items.map(render)}
        </ul>
      )}
    </div>
  );
}

function AreaDetail({ path, area, onClose }) {
  const d = area.detail;
  return (
    <div className="panel heat-detail" role="region" aria-label={`Details for ${area.name}`}>
      <div className="panel-header">
        <div>
          <h2>
            <Icon name="location" /> {path} — {area.risk.score}/100 ({area.risk.band})
          </h2>
          <p>{d.reasons.join(" · ")}</p>
        </div>
        <button type="button" className="voice-secondary-btn" onClick={onClose}>
          <Icon name="xmark" /> Close
        </button>
      </div>

      <div className="voice-section">
        <h5>Recommended actions</h5>
        <ul className="recurring-evidence">
          {d.actions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>

      <DetailList
        title={`Incidents (${area.counts.incidents_open} open)`}
        items={d.incidents}
        empty="No incidents recorded here."
        render={(r) => (
          <li key={r.id}>
            #{r.id} · [{r.severity}]{r.resolved ? " (resolved)" : ""} {r.title}
          </li>
        )}
      />

      <DetailList
        title={`Recurring issues (${area.counts.recurring})`}
        items={d.recurring}
        empty="No repeats detected here."
        render={(g, i) => <li key={i}>{g.message}</li>}
      />

      <DetailList
        title={`Latest updates (${area.counts.updates})`}
        items={d.updates}
        empty="No daily updates tagged here."
        render={(u) => (
          <li key={u.id}>
            #{u.id} · {u.log_date || "undated"} · {u.status} · {(u.notes || "").slice(0, 120)}
          </li>
        )}
      />

      <DetailList
        title={`AI detections (${area.counts.ai_detections})`}
        items={d.ai}
        empty="No AI-analysed photos or clips tagged here."
        render={(a) => (
          <li key={a.observation_id}>
            Observation #{a.observation_id} · {a.kind} · compliance{" "}
            {a.compliance == null ? "—" : `${Math.round(a.compliance)}%`}
          </li>
        )}
      />

      <DetailList
        title={`Observations (${area.counts.observations})`}
        items={d.observations}
        empty="No observations tagged here."
        render={(o) => (
          <li key={o.id}>
            #{o.id} · {o.kind} · {o.title}
          </li>
        )}
      />
    </div>
  );
}

function SiteHeatmap() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(null);

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
    fetch(`/api/sites/heatmap?project_id=${encodeURIComponent(projectId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((data) => {
        if (live) {
          setMap(data);
          setSel(null);
          setLoading(false);
          setError("");
        }
      })
      .catch(() => {
        if (live) {
          setMap(null);
          setLoading(false);
          setError("Could not reach the heatmap — start the backend for live locations.");
        }
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  const pick = (site, building, floor, area) => {
    const bits = [site?.name, building?.name, floor?.name].filter(Boolean);
    setSel({ path: bits.length ? `${bits.join(" / ")} / ${area.name}` : area.name, area });
  };

  return (
    <div className="panel recurring-panel">
      <div className="panel-header">
        <div>
          <h2>
            <Icon name="location" /> Risk Heatmap
          </h2>
          <p>Where are the issues occurring — every area, scored from its own signals.</p>
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

      {loading && <p className="voice-note">Loading site geography…</p>}
      {error && (
        <p className="voice-note" role="status">
          {error}
        </p>
      )}

      {map && map.sites.length === 0 && (
        <p className="voice-note" role="status">
          No sites modelled for {map.project_name} yet — register Sites, Buildings, Floors and
          Areas to light up the hierarchy. Free-text locations from existing records appear under
          Unmapped below.
        </p>
      )}

      {map &&
        map.sites.map((s) => (
          <div className="heat-site" key={s.id}>
            <h4 className="heat-site-name">
              <Icon name="building" /> {s.name}
              {s.site_general_incidents > 0 && (
                <span className="heat-site-note">
                  · {s.site_general_incidents} site-wide incident(s)
                </span>
              )}
            </h4>
            {s.buildings.map((b) => (
              <div className="heat-building" key={b.id}>
                <h5 className="heat-building-name">{b.name}</h5>
                {b.floors.map((f) => (
                  <div className="heat-floor" key={f.id}>
                    <span className="heat-floor-name">{f.name}</span>
                    <span className="heat-areas">
                      {f.areas.map((a) => (
                        <AreaChip
                          key={a.id}
                          area={a}
                          selected={sel?.area.id === a.id}
                          onSelect={(area) => pick(s, b, f, area)}
                        />
                      ))}
                    </span>
                  </div>
                ))}
                {b.direct_areas.map((a) => (
                  <div className="heat-floor" key={`direct-${a.id}`}>
                    <span className="heat-floor-name">—</span>
                    <span className="heat-areas">
                      <AreaChip
                        area={a}
                        selected={sel?.area.id === a.id}
                        onSelect={(area) => pick(s, b, null, area)}
                      />
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {s.site_areas.map((a) => (
              <div className="heat-floor" key={`site-${a.id}`}>
                <span className="heat-floor-name">Site</span>
                <span className="heat-areas">
                  <AreaChip
                    area={a}
                    selected={sel?.area.id === a.id}
                    onSelect={(area) => pick(s, null, null, area)}
                  />
                </span>
              </div>
            ))}
          </div>
        ))}

      {map && map.unmapped.length > 0 && (
        <div className="voice-section">
          <h5>Unmapped locations (records match no modelled area)</h5>
          <ul className="recurring-evidence">
            {map.unmapped.map((u) => (
              <li key={u.label}>
                {u.label} — {u.counts.incidents} incident(s), {u.counts.observations}{" "}
                observation(s), {u.counts.updates} update(s)
              </li>
            ))}
          </ul>
        </div>
      )}

      {sel && <AreaDetail path={sel.path} area={sel.area} onClose={() => setSel(null)} />}
    </div>
  );
}

export default SiteHeatmap;
