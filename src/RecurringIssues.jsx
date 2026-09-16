import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 5 — Recurring issue detection (live, DB-counted).
   Same issue + same location + ≥ N occurrences in the last D days.
   Counts come from GET /api/issues/recurring — the panel only renders
   them, it never computes or guesses. */

const WINDOWS = [7, 14, 30];

function RecurringIssues() {
  const [days, setDays] = useState(14);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState({});

  useEffect(() => {
    let live = true;
    fetch(`/api/issues/recurring?days=${days}&min_occurrences=3`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("request failed"))))
      .then((data) => {
        if (live) {
          setGroups(data.groups || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (live) {
          setGroups([]);
          setLoading(false);
          setError("Could not reach the recurrence check — start the backend to see live repeats.");
        }
      });
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <div className="panel recurring-panel">
      <div className="panel-header">
        <div>
          <h2>
            <Icon name="alert" /> Recurring Issues
          </h2>
          <p>
            Same issue, same location, repeated in the window — counted from the incident register.
          </p>
        </div>
        <label className="recurring-window">
          Window{" "}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setLoading(true);
              setError("");
            }}
          >
            {WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <>
          <div className="skeleton-block tall" aria-hidden="true" />
          <span className="voice-note" role="status">
            Checking the incident register…
          </span>
        </>
      )}
      {error && (
        <p className="voice-note" role="status">
          {error}
        </p>
      )}

      {!loading && !error && groups.length === 0 && (
        <p className="voice-note" role="status">
          No issue repeats 3+ times in one location over the last {days} days.
        </p>
      )}

      {groups.map((g) => {
        const key = `${g.project_id}-${g.category}-${g.issue}-${g.location}`;
        const expanded = !!open[key];
        return (
          <div className="alert-item danger" key={key}>
            <div className="alert-icon" aria-hidden="true">
              <Icon name="alert" />
            </div>
            <div>
              <strong>
                Recurring issue detected in {g.location} — {g.occurrences}× in {g.window_days} days
              </strong>
              <p>
                {g.exemplar} · {g.category} · {g.project_name}
                {" · first seen "}
                {g.first_seen ? g.first_seen.slice(0, 10) : "—"}
                {" · last seen "}
                {g.last_seen ? g.last_seen.slice(0, 10) : "—"}
              </p>
              <button
                type="button"
                className="link-button"
                onClick={() => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                aria-expanded={expanded}
              >
                {expanded
                  ? "Hide evidence"
                  : `Show evidence (${g.evidence.length})`}
              </button>
              {expanded && (
                <ul className="recurring-evidence">
                  {g.evidence.map((e) => (
                    <li key={e.id}>
                      #{e.id} · {e.reported_at ? e.reported_at.slice(0, 10) : "undated"} · [{e.severity}]{" "}
                      {e.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default RecurringIssues;
