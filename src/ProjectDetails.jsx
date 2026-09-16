import { useState } from "react";
import { Icon } from "./icons";
import ProgressTracking from "./ProgressTracking";
import Materials from "./Materials";
import Safety from "./Safety";
import Inspections from "./Inspections";
import Documents from "./Documents";
import SiteVisionAI from "./SiteVisionAI";
import Reports from "./Reports";
import GenAIAssistant from "./GenAIAssistant";
import BudgetIntel from "./BudgetIntel";
import { notify } from "./toast";

function ProjectDetails({ project, onBack, onUpdate, onAddUpdate }) {
  const [activeModule, setActiveModule] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const openEdit = () => {
    setEditForm({
      name: project.name || "",
      location: project.location || "",
      client: project.client || "",
      manager: project.manager || "",
      status: project.status || "Active",
      progress: project.progress ?? 0,
      total_budget: project.total_budget ?? "",
    });
    setEditing(true);
  };

  const saveEdit = (e) => {
    e.preventDefault();
    const name = (editForm.name || "").trim();
    if (!name) {
      notify("Project name is required.", "error");
      return;
    }
    const progress = Number(editForm.progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      notify("Progress must be between 0 and 100.", "error");
      return;
    }
    const budgetRaw = editForm.total_budget;
    const total_budget =
      budgetRaw === "" || budgetRaw === null ? 0 : Number(budgetRaw);
    if (!Number.isFinite(total_budget) || total_budget < 0) {
      notify("Total budget must be a non-negative number.", "error");
      return;
    }
    if (typeof onUpdate !== "function") {
      notify("Editing is not available here.", "error");
      return;
    }
    onUpdate({
      ...project,
      name,
      location: editForm.location,
      client: editForm.client,
      manager: editForm.manager,
      status: editForm.status,
      progress,
      total_budget,
    });
    setEditing(false);
    setEditForm(null);
    notify("Project updated.", "success");
  };

  /* ================================
     MODULE NAVIGATION
  ================================= */

  if (activeModule === "progress") {
    return (
      <ProgressTracking
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "materials") {
    return (
      <Materials
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "safety") {
    return (
      <Safety
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "inspections") {
    return (
      <Inspections
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "documents") {
    return (
      <Documents
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "sitevision") {
    return (
      <SiteVisionAI
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "reports") {
    return (
      <Reports
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  if (activeModule === "genai") {
    return (
      <GenAIAssistant
        project={project}
        onBack={() => setActiveModule(null)}
      />
    );
  }

  /* ================================
     PROJECT DETAILS PAGE
  ================================= */

  return (
    <div className="project-details-page">

      {/* HEADER */}

      <div className="details-header">

        <button
          className="back-project-btn"
          onClick={onBack}
        >
          ← Back to Projects
        </button>

        <div className="details-actions">

          <button className="outline-btn" onClick={openEdit}>
            Edit Project
          </button>

          <button
            className="primary-btn"
            onClick={() =>
              typeof onAddUpdate === "function"
                ? onAddUpdate()
                : notify("Open Daily Updates from the sidebar to log an update.", "info")
            }
          >
            + Add Update
          </button>

        </div>

      </div>


      {/* EDIT PROJECT FORM */}
      {editing && editForm && (
        <div className="project-form-overlay">

          <div className="project-form">

            <div className="form-title">

              <div>

                <h2>
                  Edit Project
                </h2>

                <p>
                  Update {project.name} details
                </p>

              </div>

              <button
                type="button"
                className="form-close"
                onClick={() => setEditing(false)}
                aria-label="Close edit form"
              >
                ×
              </button>

            </div>

            <form onSubmit={saveEdit}>

              <div className="form-grid">

                <div className="form-field">

                  <label>
                    Project Name
                  </label>

                  <input
                    name="name"
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm({ ...editForm, name: e.target.value })
                    }
                    placeholder="e.g. Green Valley Tower"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Location
                  </label>

                  <input
                    name="location"
                    value={editForm.location}
                    onChange={(e) =>
                      setEditForm({ ...editForm, location: e.target.value })
                    }
                    placeholder="e.g. Solapur"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Client Name
                  </label>

                  <input
                    name="client"
                    value={editForm.client}
                    onChange={(e) =>
                      setEditForm({ ...editForm, client: e.target.value })
                    }
                    placeholder="Client / Company"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Project Manager
                  </label>

                  <input
                    name="manager"
                    value={editForm.manager}
                    onChange={(e) =>
                      setEditForm({ ...editForm, manager: e.target.value })
                    }
                    placeholder="Manager name"
                  />

                </div>

                <div className="form-field">

                  <label>
                    Status
                  </label>

                  <select
                    name="status"
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({ ...editForm, status: e.target.value })
                    }
                  >
                    <option>Active</option>
                    <option>Pending</option>
                    <option>On Hold</option>
                    <option>Completed</option>
                  </select>

                </div>

                <div className="form-field">

                  <label>
                    Progress (%)
                  </label>

                  <input
                    type="number"
                    min="0"
                    max="100"
                    name="progress"
                    value={editForm.progress}
                    onChange={(e) =>
                      setEditForm({ ...editForm, progress: e.target.value })
                    }
                    placeholder="e.g. 75"
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
                    value={editForm.total_budget}
                    onChange={(e) =>
                      setEditForm({ ...editForm, total_budget: e.target.value })
                    }
                    placeholder="e.g. 5000000"
                  />

                </div>

              </div>

              <div className="form-buttons">

                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="save-btn"
                >
                  Save Changes
                </button>

              </div>

            </form>

          </div>

        </div>
      )}


      {/* PROJECT HERO */}

      <div className="project-hero">

        <div className="hero-icon">
          <Icon name={project.icon} />
        </div>

        <div className="hero-info">

          <div className="hero-title-row">

            <h1>
              {project.name}
            </h1>

            <span className="hero-status">
              ● {project.status}
            </span>

          </div>

          <p>
            <Icon name="location" /> {project.location}
          </p>

          <div className="hero-meta">

            <span>
              <b>Client</b>
              {project.client}
            </span>

            <span>
              <b>Project Manager</b>
              {project.manager}
            </span>

            <span>
              <b>Timeline</b>
              {project.start} – {project.end}
            </span>

          </div>

        </div>

      </div>


      {/* OVERALL PROJECT PROGRESS */}

      <div className="overall-progress-card">

        <div className="overall-progress-header">

          <div>

            <h2>
              Overall Project Progress
            </h2>

            <p>
              Current completion status across the project
            </p>

          </div>

          <strong>
            {project.progress}%
          </strong>

        </div>


        <div className="large-progress-bar">

          <div
            style={{
              width: `${project.progress}%`,
            }}
          ></div>

        </div>


        <div className="progress-footer">

          <span>
            Project started: {project.start}
          </span>

          <span>
            Expected completion: {project.end}
          </span>

        </div>

      </div>


      {/* BUDGET INTELLIGENCE — forecast + spend drivers, burn rate, delays (live).
          Single budget card: the old plain "Budget Prediction" summary was the
          same CPI math without the WHY, so it was removed to avoid doubles. */}

      <BudgetIntel projectId={project.id} />


      {/* =================================
          PROJECT MODULES
          ONLY PROJECT-RELATED MODULES
      ================================== */}

      <div className="project-modules">


        {/* PROGRESS TRACKING */}

        <div className="module-card progress-module">

          <div className="module-icon">
            <Icon name="chart" />
          </div>

          <h3>
            Progress Tracking
          </h3>

          <p>
            Track construction phases, tasks and site progress.
          </p>

          <button
            onClick={() =>
              setActiveModule("progress")
            }
          >
            Open Module →
          </button>

        </div>


        {/* MATERIALS */}

        <div className="module-card materials-module">

          <div className="module-icon">
            <Icon name="package" />
          </div>

          <h3>
            Materials
          </h3>

          <p>
            Monitor material inventory, usage and stock levels.
          </p>

          <button
            onClick={() =>
              setActiveModule("materials")
            }
          >
            Open Module →
          </button>

        </div>


        {/* SAFETY */}

        <div className="module-card safety-module">

          <div className="module-icon">
            <Icon name="helmet" />
          </div>

          <h3>
            Safety
          </h3>

          <p>
            Manage safety issues, hazards and corrective actions.
          </p>

          <button
            onClick={() =>
              setActiveModule("safety")
            }
          >
            Open Module →
          </button>

        </div>


        {/* INSPECTIONS */}

        <div className="module-card inspection-module">

          <div className="module-icon">
            <Icon name="check" />
          </div>

          <h3>
            Inspections
          </h3>

          <p>
            Schedule inspections and record site findings.
          </p>

          <button
            onClick={() =>
              setActiveModule("inspections")
            }
          >
            Open Module →
          </button>

        </div>


        {/* DOCUMENTS & PHOTOS */}

        <div className="module-card documents-module">

          <div className="module-icon">
            <Icon name="folder" />
          </div>

          <h3>
            Documents & Photos
          </h3>

          <p>
            Manage drawings, reports and construction photos.
          </p>

          <button
            onClick={() =>
              setActiveModule("documents")
            }
          >
            Open Module →
          </button>

        </div>


        {/* SITEVISION AI */}

        <div className="module-card sitevision-module">

          <div className="module-icon">
            <Icon name="eye" />
          </div>

          <h3>
            SiteVision AI
          </h3>

          <p>
            Analyze site photos for workers, helmets and risks.
          </p>

          <button
            onClick={() =>
              setActiveModule("sitevision")
            }
          >
            Open Module →
          </button>

        </div>


        {/* REPORTS */}

        <div className="module-card reports-module">

          <div className="module-icon">
            <Icon name="file" />
          </div>

          <h3>
            Reports
          </h3>

          <p>
            Generate the weekly project report from live site data.
          </p>

          <button
            onClick={() =>
              setActiveModule("reports")
            }
          >
            Open Module →
          </button>

        </div>


        {/* GENAI ASSISTANT */}

        <div className="module-card genai-module">

          <div className="module-icon">
            <Icon name="bot" />
          </div>

          <h3>
            GenAI Assistant
          </h3>

          <p>
            Ask questions answered from this project's data.
          </p>

          <button
            onClick={() =>
              setActiveModule("genai")
            }
          >
            Open Module →
          </button>

        </div>

      </div>


      {/* =================================
          QUICK STATS
      ================================== */}

      <div className="quick-stats">

        <div>

          <span>
            Tasks Completed
          </span>

          <strong>
            42
          </strong>

        </div>


        <div>

          <span>
            Open Safety Issues
          </span>

          <strong>
            3
          </strong>

        </div>


        <div>

          <span>
            Pending Inspections
          </span>

          <strong>
            2
          </strong>

        </div>


        <div>

          <span>
            Documents
          </span>

          <strong>
            128
          </strong>

        </div>

      </div>

    </div>
  );
}

export default ProjectDetails;