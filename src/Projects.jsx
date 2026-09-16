import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { notify } from "./toast";
import ProjectDetails from "./ProjectDetails";
import { calcBudget, formatINR, RISK_META } from "./budget";

// Offline demo fallback (kept): used only when the backend cannot be
// reached. When online, the list below is replaced by live DB rows scoped
// to the signed-in account (admin sees all, members see assigned + open).
const DEMO_PROJECTS = [
  {
      id: 1,
      name: "Green Valley Tower",
      location: "Solapur",
      client: "ABC Developers",
      manager: "Rahul Patil",
      progress: 82,
      status: "Active",
      start: "Jan 2025",
      end: "Dec 2026",
      icon: "building",
      total_budget: 5000000,
      actual_spent: 3900000,
    },
    {
      id: 2,
      name: "Sunrise Residency",
      location: "Pune",
      client: "Sunrise Builders",
      manager: "Priya Shah",
      progress: 64,
      status: "Active",
      start: "Mar 2025",
      end: "Feb 2027",
      icon: "building",
      total_budget: 8000000,
      actual_spent: 5400000,
    },
    {
      id: 3,
      name: "Metro Commercial Hub",
      location: "Mumbai",
      client: "Metro Infra",
      manager: "Amit Joshi",
      progress: 48,
      status: "Active",
      start: "Jun 2025",
      end: "May 2027",
      icon: "building",
      total_budget: 12000000,
      actual_spent: 8400000,
    },
    {
      id: 4,
      name: "Lakeview Heights",
      location: "Nashik",
      client: "Lakeview Builders",
      manager: "Sneha Deshmukh",
      progress: 35,
      status: "Active",
      start: "Aug 2025",
      end: "Jul 2027",
      icon: "building",
      total_budget: 6000000,
      actual_spent: 1800000,
    },
];

function Projects({ navigateTo, role }) {
  const [projects, setProjects] = useState(DEMO_PROJECTS);
  // True once the list comes from the backend (scoped to the session).
  const [backendMode, setBackendMode] = useState(false);
  // Admin assignment panel state (admin-only, backend-only).
  const [assignProject, setAssignProject] = useState(null);
  const [pmList, setPmList] = useState([]);
  const [assignSel, setAssignSel] = useState([]);
  const [assignMsg, setAssignMsg] = useState("");

  const authHeaders = () => {
    const token = localStorage.getItem("buildsafe_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const toCard = (row, spent = 0, memberNames = []) => ({
    id: row.id,
    name: row.name,
    // DB rows carry no location/client/manager columns: unknowns stay
    // honest placeholders instead of invented values.
    location: row.description || "—",
    client: "—",
    manager: memberNames.length > 0 ? memberNames.join(", ") : "—",
    progress: Number(row.progress) || 0,
    status: row.status || "Active",
    start: "—",
    end: "—",
    icon: "building",
    total_budget: Number(row.total_budget) || 0,
    actual_spent: Number(spent) || 0,
    assigned_user_ids: row.assigned_user_ids || [],
  });

  // Live list (scoped server-side). Any failure keeps the offline demo.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/projects", { headers: authHeaders() });
        if (!res.ok) return;
        const rows = await res.json();
        if (!Array.isArray(rows)) return;
        const enriched = await Promise.all(
          rows.map(async (row) => {
            let spent = 0;
            try {
              const b = await fetch(`/api/projects/${row.id}/budget`);
              if (b.ok) {
                const data = await b.json();
                spent = Number(data.actual_spent) || 0;
              }
            } catch {
              /* card keeps spent 0 */
            }
            return toCard(row, spent);
          })
        );
        if (!cancelled && enriched) {
          setProjects(enriched);
          setBackendMode(true);
        }
      } catch {
        /* offline — demo list stays */
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Admin: pre-registered PM accounts for the assignment panel.
  useEffect(() => {
    if (role !== "Admin") return;
    fetch("/api/users?role=Project%20Manager", { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (Array.isArray(list)) setPmList(list);
      })
      .catch(() => {});
  }, [role]);

  const openAssign = (project) => {
    setAssignProject(project);
    setAssignSel(project.assigned_user_ids || []);
    setAssignMsg("");
  };

  const saveAssign = async () => {
    if (!assignProject) return;
    setAssignMsg("");
    try {
      const res = await fetch(
        `/api/projects/${assignProject.id}/assignments`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ user_ids: assignSel }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not save assignments.");
      const names = pmList
        .filter((u) => data.assigned_user_ids.includes(u.id))
        .map((u) => u.name);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === assignProject.id
            ? { ...p, assigned_user_ids: data.assigned_user_ids, manager: names.length > 0 ? names.join(", ") : "—" }
            : p
        )
      );
      setAssignProject(null);
      notify("Project assignments saved.", "success");
    } catch (err) {
      setAssignMsg(err.message);
    }
  };

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  // Selected project for Project Details page
  const [selectedProject, setSelectedProject] = useState(null);

  const [newProject, setNewProject] = useState({
    name: "",
    location: "",
    client: "",
    manager: "",
    total_budget: "",
  });

  const handleChange = (e) => {
    setNewProject({
      ...newProject,
      [e.target.name]: e.target.value,
    });
  };

  const createProject = async (e) => {
    e.preventDefault();

    if (
      !newProject.name ||
      !newProject.location ||
      !newProject.client ||
      !newProject.manager
    ) {
      notify("Please fill all fields");
      return;
    }

    if (
      newProject.total_budget !== "" &&
      newProject.total_budget !== null &&
      newProject.total_budget !== undefined &&
      (Number.isNaN(Number(newProject.total_budget)) ||
        Number(newProject.total_budget) < 0)
    ) {
      notify("Total Budget must be a non-negative number");
      return;
    }

    // Persist server-side first so assignments and scoping apply. A newly
    // created project is unassigned → visible to every account until an
    // admin assigns it. Offline failure keeps the old local-only path.
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: newProject.name,
          description: newProject.location,
          status: "Active",
          total_budget: Number(newProject.total_budget) || 0,
          progress: 0,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not save project.");
      setProjects((prev) => [
        ...prev,
        toCard({ ...data, description: newProject.location }),
      ]);
      setBackendMode(true);
    } catch {
      const project = {
        id: Date.now(),
        name: newProject.name,
        location: newProject.location,
        client: newProject.client,
        manager: newProject.manager,
        total_budget: Number(newProject.total_budget) || 0,
        actual_spent: 0,
        progress: 0,
        status: "Active",
        start: "Sep 2026",
        end: "2028",
        icon: "building",
      };
      setProjects([...projects, project]);
    }

    setNewProject({
      name: "",
      location: "",
      client: "",
      manager: "",
      total_budget: "",
    });

    setShowForm(false);
  };

  const filteredProjects = projects.filter((project) =>
    `${project.name} ${project.location} ${project.client}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const averageProgress =
    projects.length > 0
      ? Math.round(
          projects.reduce((sum, project) => sum + project.progress, 0) /
            projects.length
        )
      : 0;

  // -----------------------------------------
  // PROJECT DETAILS PAGE
  // -----------------------------------------
  if (selectedProject) {
    return (
      <ProjectDetails
        project={selectedProject}
        onBack={() => setSelectedProject(null)}
        onUpdate={(updated) => {
          setProjects((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p))
          );
          setSelectedProject(updated);
        }}
        onAddUpdate={
          typeof navigateTo === "function"
            ? () => navigateTo("dailyUpdates")
            : undefined
        }
      />
    );
  }

  return (
    <div className="projects-page">

      {/* PAGE HEADER */}
      <div className="projects-heading">

        <div>

          <div className="title-with-icon">

            <span className="page-icon">
              <Icon name="building" />
            </span>

            <h1>
              Projects
            </h1>

          </div>

          <p>
            Manage and monitor all construction projects
          </p>

        </div>

        <button
          className="create-project-btn"
          onClick={() => setShowForm(true)}
        >
          <span>＋</span>
          Create Project
        </button>

      </div>

      {/* SUMMARY CARDS */}
      <div className="project-summary">

        <div className="summary-card">

          <div className="summary-icon purple">
            <Icon name="building" />
          </div>

          <div>
            <span>
              Total Projects
            </span>

            <h2>
              {projects.length}
            </h2>
          </div>

        </div>

        <div className="summary-card">

          <div className="summary-icon green">
            <Icon name="check" />
          </div>

          <div>

            <span>
              Active Projects
            </span>

            <h2>
              {
                projects.filter(
                  (p) => p.status === "Active"
                ).length
              }
            </h2>

          </div>

        </div>

        <div className="summary-card">

          <div className="summary-icon blue">
            <Icon name="chart" />
          </div>

          <div>

            <span>
              Average Progress
            </span>

            <h2>
              {averageProgress}%
            </h2>

          </div>

        </div>

      </div>

      {/* CREATE PROJECT FORM */}
      {showForm && (
        <div className="project-form-overlay">

          <div className="project-form">

            <div className="form-title">

              <div>

                <h2>
                  Create New Project
                </h2>

                <p>
                  Add a new construction project
                </p>

              </div>

              <button
                className="form-close"
                onClick={() => setShowForm(false)}
              >
                ×
              </button>

            </div>

            <form onSubmit={createProject}>

              <div className="form-grid">

                <div className="form-field">

                  <label>
                    Project Name
                  </label>

                  <input
                    name="name"
                    value={newProject.name}
                    onChange={handleChange}
                    placeholder="e.g. Green Valley Tower"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Location
                  </label>

                  <input
                    name="location"
                    value={newProject.location}
                    onChange={handleChange}
                    placeholder="e.g. Solapur"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Client Name
                  </label>

                  <input
                    name="client"
                    value={newProject.client}
                    onChange={handleChange}
                    placeholder="Client / Company"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Project Manager
                  </label>

                  <input
                    name="manager"
                    value={newProject.manager}
                    onChange={handleChange}
                    placeholder="Manager name"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Total Budget (₹)
                  </label>

                  <input
                    type="number"
                    min="0"
                    name="total_budget"
                    value={newProject.total_budget}
                    onChange={handleChange}
                    placeholder="e.g. 5000000"
                  />

                </div>

              </div>

              <div className="form-buttons">

                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="save-btn"
                >
                  Create Project
                </button>

              </div>

            </form>

          </div>

        </div>
      )}

      {/* SEARCH / FILTER BAR */}
      <div className="project-filter">

        <div className="filter-search">

          <span>⌕</span>

          <input
            type="text"
            placeholder="Search projects by name, location or client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

        </div>

        <button className="status-filter">
          <Icon name="filter" /> &nbsp; All Status &nbsp;⌄
        </button>

      </div>

      {/* PROJECT LIST HEADER */}
      <div className="projects-list-header">

        <h2>
          All Projects
        </h2>

        <span>
          {filteredProjects.length} projects
        </span>

      </div>

      {/* PROJECT CARDS */}
      <div className="projects-grid">

        {filteredProjects.map((project) => {
          const budgetInfo = calcBudget({
            total_budget: project.total_budget,
            actual_spent: project.actual_spent,
            progress: project.progress,
          });
          const riskMeta = RISK_META[budgetInfo.risk] || RISK_META.UNKNOWN;
          return (

          <div
            className="project-card"
            key={project.id}
          >

            {/* CARD TOP */}
            <div className="project-card-top">

              <div className="project-building">
                <Icon name={project.icon} />
              </div>

              <div className="project-card-title">

                <h3>
                  {project.name}
                </h3>

                <span className="active-badge">
                  ● {project.status}
                </span>

              </div>

              <button className="three-dots">
                ⋮
              </button>

            </div>

            {/* PROJECT INFORMATION */}
            <div className="project-meta">

              <div>
                <span><Icon name="location" /></span>
                {project.location}
              </div>

              <div>
                <span><Icon name="building" /></span>
                Client: {project.client}
              </div>

              <div>
                <span><Icon name="user" /></span>
                Manager: {project.manager}
              </div>

            </div>

            {/* BUDGET */}
            <div
              className="card-budget"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                marginTop: "10px",
              }}
            >
              <span>
                <Icon name="wallet" /> {formatINR(project.actual_spent)} /{" "}
                {formatINR(project.total_budget)} spent
              </span>
              <span>
                <Icon name="circle" style={{ color: riskMeta.color }} /> {riskMeta.label}
              </span>
            </div>

            {/* PROGRESS */}
            <div className="card-progress">

              <div className="progress-label">

                <span>
                  Progress
                </span>

                <strong>
                  {project.progress}%
                </strong>

              </div>

              <div className="card-progress-bar">

                <div
                  style={{
                    width: `${project.progress}%`,
                  }}
                ></div>

              </div>

            </div>

            {/* CARD FOOTER */}
            <div className="project-card-footer">

              <div className="project-dates">

                <span>
                  ▣
                </span>

                Start: {project.start}

                <b>
                  |
                </b>

                End: {project.end}

              </div>

              {/* VIEW PROJECT BUTTON */}
              <button
                className="view-project-btn"
                onClick={() => setSelectedProject(project)}
              >
                View Project
                <span>→</span>
              </button>

              {role === "Admin" && backendMode && (
                <button
                  className="view-project-btn"
                  onClick={() => openAssign(project)}
                  title="Assign project managers"
                >
                  Assign{(project.assigned_user_ids || []).length > 0
                    ? ` (${project.assigned_user_ids.length})`
                    : ""}
                  <span>→</span>
                </button>
              )}

            </div>

          </div>
          );
        })}

      </div>

      {/* ASSIGN MANAGERS (admin-only) */}
      {assignProject && (
        <div className="project-form-overlay">

          <div className="project-form">

            <div className="form-title">

              <div>

                <h2>
                  Assign Managers
                </h2>

                <p>
                  {assignProject.name} — only selected managers see this project
                </p>

              </div>

              <button
                className="form-close"
                onClick={() => setAssignProject(null)}
              >
                ×
              </button>

            </div>

            {pmList.length === 0 ? (
              <p>No Project Manager accounts registered yet.</p>
            ) : (
              pmList.map((u) => (
                <label
                  key={u.id}
                  style={{ display: "block", margin: "6px 0", fontSize: "14px" }}
                >
                  <input
                    type="checkbox"
                    checked={assignSel.includes(u.id)}
                    onChange={(e) =>
                      setAssignSel((prev) =>
                        e.target.checked
                          ? [...prev, u.id]
                          : prev.filter((id) => id !== u.id)
                      )
                    }
                  />{" "}
                  {u.name} <small>({u.email})</small>
                </label>
              ))
            )}

            {assignMsg && (
              <p style={{ color: "#dc2626" }}>{assignMsg}</p>
            )}

            <div className="form-buttons">

              <button
                type="button"
                className="cancel-btn"
                onClick={() => setAssignProject(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="save-btn"
                onClick={saveAssign}
              >
                Save Assignments
              </button>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}

export default Projects;