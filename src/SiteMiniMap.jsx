import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 13 — portfolio site-risk map + recent AI observations. Area dots
   come straight from the heatmap endpoint (same scores as the Risk page);
   the observation feed merges AI analyses with pending AI incidents.
   Empty states stay honest — no invented activity. */

const DOT = {
  HIGH: "#dc2626",
  MEDIUM: "#ea580c",
  LOW: "#eab308",
  MINIMAL: "#1a7f37",
};

function SiteMiniMap({ navigateTo }) {
  const [groups, setGroups] = useState(null);
  const [feed, setFeed] = useState(null);

  useEffect(() => {
    let live = true;
    const get = (url) =>
      fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null);
    (async () => {
      const projects = await get("/api/projects");
      const lists = Array.isArray(projects) ? projects : [];
      const maps = await Promise.all(
        lists.map((p) => get(`/api/sites/heatmap?project_id=${p.id}`))
      );
      if (!live) return;
      const g = [];
      for (const m of maps) {
        if (!m || !Array.isArray(m.sites)) continue;
        const dots = [];
        for (const s of m.sites) {
          for (const b of s.buildings || []) {
            for (const f of b.floors || []) {
              for (const a of f.areas || []) dots.push(a);
            }
            for (const a of b.direct_areas || []) dots.push(a);
          }
          for (const a of s.site_areas || []) dots.push(a);
        }
        if (dots.length > 0) g.push({ project: m.project_name, dots });
      }
      setGroups(g);
      const [obs, pending] = await Promise.all([
        get("/api/observations"),
        get("/api/safety_issues?status=pending"),
      ]);
      if (!live) return;
      const items = [];
      for (const o of (Array.isArray(obs) ? obs : []).slice(0, 3)) {
        items.push({
          key: `o${o.id}`,
          icon: "eye",
          title: o.title,
          sub: `Observation #${o.id} · ${o.kind || "analysis"}`,
        });
      }
      for (const p of (Array.isArray(pending) ? pending : []).slice(0, 2)) {
        items.push({
          key: `p${p.id}`,
          icon: "alert",
          title: p.title,
          sub: `Pending AI incident #${p.id} — needs confirmation`,
        });
      }
      setFeed(items);
    })();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Site Risk Map</h2>
          <p>Every modelled area, scored from its own signals</p>
        </div>
      </div>

      {groups === null ? (
        <>
          <div className="skeleton-block tall" aria-hidden="true" />
          <span className="voice-note" role="status">
            Loading site geography…
          </span>
        </>
      ) : groups.length === 0 ? (
        <p className="voice-note" role="status">
          No sites modelled yet — register Sites, Buildings, Floors and Areas to light up this map.
        </p>
      ) : (
        groups.map((gp) => (
          <div key={gp.project} style={{ marginBottom: "10px" }}>
            <small style={{ color: "#57534e" }}>{gp.project}</small>
            <div className="heat-areas" style={{ marginTop: "4px" }}>
              {gp.dots.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="heat-area"
                  title={`${a.name}: ${a.risk.score}/100 (${a.risk.band}) — open on Risk page`}
                  onClick={() => navigateTo("risk")}
                >
                  <span
                    className="heat-dot"
                    style={{ background: DOT[a.risk.band] || DOT.MINIMAL }}
                    aria-hidden="true"
                  />
                  <span className="heat-area-name">{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      <div className="panel-header" style={{ marginTop: "14px" }}>
        <div>
          <h2>Recent AI Observations</h2>
          <p>Latest analyses and pending AI incidents</p>
        </div>
      </div>

      {feed === null ? (
        <p className="voice-note">Loading observations…</p>
      ) : feed.length === 0 ? (
        <p className="voice-note" role="status">
          No AI observations yet — analyse a site video or photo from SiteVision AI.
        </p>
      ) : (
        feed.map((item) => (
          <div className="alert-item warning" key={item.key}>
            <div className="alert-icon" aria-hidden="true">
              <Icon name={item.icon} />
            </div>
            <div>
              <strong>{item.title}</strong>
              <p>{item.sub}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default SiteMiniMap;
