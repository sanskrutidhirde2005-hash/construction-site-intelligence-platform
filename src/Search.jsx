import { useEffect, useState } from "react";
import { Icon } from "./icons";

/* Phase 14 — natural-language retrieval over the agent tools.
   A time window is parsed from the prose ("last 2 weeks", "yesterday")
   or picked as a chip; the backend runs the same whitelisted tools with
   that window and answers from their outputs only. */

const EXAMPLES = [
  "Show safety issues from the last 2 weeks.",
  "What happened in Area B yesterday?",
  "Show recurring problems.",
  "Which materials are likely to run out?",
];

const WINDOWS = [
  { label: "24 hours", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
];

function Search() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [days, setDays] = useState(null);
  const [result, setResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        setProjects(list || []);
        if (list && list.length > 0) setProjectId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  const run = async (text = query) => {
    const q = (text || "").trim();
    if (!q || searching) return;
    setSearching(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/search/nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query_text: q,
          project_id: projectId ? parseInt(projectId, 10) : null,
          days,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Search failed.");
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
    setSearching(false);
  };

  return (
    <div className="daily-updates-page">
      <div className="daily-header">
        <div>
          <div className="title-with-icon">
            <span className="page-icon">
              <Icon name="search" />
            </span>
            <h1>Search</h1>
          </div>
          <p>Ask in plain words — time windows and places are understood.</p>
        </div>
        {projects.length > 0 && (
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            aria-label="Select project"
            style={{ padding: "8px 10px", borderRadius: "1px", border: "1px solid #c7bca1" }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="panel">
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={query}
            placeholder='Try: "What happened in Area B yesterday?"'
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            style={{ flex: 1, padding: "10px 12px", border: "1px solid #c7bca1", borderRadius: "1px" }}
            aria-label="Search query"
          />
          <button
            type="button"
            className="voice-primary-btn"
            onClick={() => run()}
            disabled={searching || !query.trim()}
          >
            <Icon name="search" /> {searching ? "Searching…" : "Search"}
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap", alignItems: "center" }}>
          <small style={{ color: "#57534e" }}>Window:</small>
          <button
            type="button"
            className={`voice-tab${days === null ? " active" : ""}`}
            onClick={() => setDays(null)}
          >
            From words
          </button>
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              className={`voice-tab${days === w.days ? " active" : ""}`}
              onClick={() => setDays(days === w.days ? null : w.days)}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="link-button"
              onClick={() => {
                setQuery(ex);
                run(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Results</h2>
              <p>
                {result.window
                  ? `${result.window.label} (${result.window.start} → ${result.window.end})`
                  : "All recorded time"}
                {result.tools_used?.length > 0 &&
                  ` · from: ${result.tools_used.map((s) => s.replace(/^get_/, "").replace(/_/g, " ")).join(" · ")}`}
              </p>
            </div>
          </div>
          <p style={{ whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: 1.7 }}>{result.answer}</p>
        </div>
      )}
    </div>
  );
}

export default Search;
