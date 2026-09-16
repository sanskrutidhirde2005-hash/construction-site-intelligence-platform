import { useState, useEffect } from "react";
import "./App.css";
import { Icon } from "./icons";
import { notify } from "./toast";
import VoiceUpdate from "./VoiceUpdate";

function DailyUpdates() {
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedProject, setSelectedProject] = useState("All Projects");
  const [updates, setUpdates] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  // Entry mode inside the form overlay: typed form vs voice recording.
  const [voiceTab, setVoiceTab] = useState("write");
  // Phase 3: typed handoff — the Write form composes transcript text and the
  // SAME extract → AI EXTRACTED review → Confirm & Save pipeline runs it.
  // Nothing reaches the database before the user confirms in review.
  const [typedHandoff, setTypedHandoff] = useState(null);
  const [formData, setFormData] = useState({
    project: "",
    date: "2026-09-12",
    location: "",
    workCompleted: "",
    progress: "",
    labour: "",
    material: "OK",
    safety: "Good",
    status: "On Track",
    issue: "",
    tomorrowPlan: "",
    photos: null,
  });

  // Load updates from backend
  useEffect(() => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((projects) => {
        if (!projects || projects.length === 0) {
          setLoading(false);
          setError("No projects found. Please create projects first.");
          return;
        }
        setProjects(projects);

        // Fetch related data for each project (missing endpoints resolve to [])
        const safeList = (url) =>
          fetch(url).then((res) => (res.ok ? res.json() : []));
        const fetchProjectData = async (project) => {
          const [inspections, safetyIssues, materials, risks, ppeViolations] = await Promise.all([
            safeList(`/api/inspections?project_id=${project.id}`),
            safeList(`/api/safety_issues?project_id=${project.id}`),
            safeList(`/api/materials?project_id=${project.id}`),
            safeList(`/api/risks?project_id=${project.id}`),
            safeList(`/api/ppe_violations?project_id=${project.id}`),
          ]);

          // Stock on hand = received − used. "Low" when nothing remains
          // or less than 20% of the requirement is left.
          const lowStockMaterials = materials.filter((m) => {
            const received = Number(m.received_qty) || 0;
            const used = Number(m.used_qty) || 0;
            const required = Number(m.required_qty) || 0;
            const remaining = received - used;
            if (remaining <= 0) return true;
            if (required > 0 && remaining / required < 0.2) return true;
            return false;
          });

          // Open safety items: anything not dismissed/resolved.
          const openSafety = safetyIssues.filter((s) => {
            const st = String(s.status || "").toLowerCase();
            return st !== "dismissed" && st !== "resolved";
          });
          const highSafety = openSafety.filter(
            (s) => String(s.severity || "").toLowerCase() === "high"
          );
          const attentionInspections = inspections.filter(
            (i) => String(i.status || "").toLowerCase() === "attention"
          );

          const safety = openSafety.length > 0 ? "Warning" : "Good";
          const status =
            attentionInspections.length > 0 || highSafety.length > 0
              ? "Attention"
              : "On Track";
          const issue =
            openSafety.length > 0
              ? `${openSafety.length} open safety issue${openSafety.length > 1 ? "s" : ""}`
              : attentionInspections.length > 0
                ? "Needs attention"
                : "None";

          return {
            id: `update-${project.id}-${Date.now()}`,
            date: new Date().toISOString().split("T")[0],
            project: project.name,
            location: project.location,
            progress: project.progress || 0,
            photos: inspections.length,
            material: lowStockMaterials.length > 0 ? "Low" : "OK",
            safety,
            status,
            issue,
            tomorrowPlan: "",
          };
        };

        Promise.all(projects.map(fetchProjectData))
                  .then((projectUpdates) => {
                    setUpdates(projectUpdates);
                    setLoading(false);
                  })
                  .catch((err) => {
                    console.error("Error fetching project data:", err);
                    setLoading(false);
                    setError("Failed to load daily updates. Please try again.");
                  });
              })
              .catch((err) => {
                console.error("Error fetching projects:", err);
                setLoading(false);
                setError("Failed to load projects. Please try again.");
              });
          }, []);

          // If no data loaded yet, show skeleton
          if (loading) {
            return (
              <div className="daily-updates-page">
                <div className="daily-loading">Loading daily updates...</div>
              </div>
            );
          }

          // Handle date change
          const handleDateChange = (e) => {
            setSelectedDate(e.target.value);
          };

          // Handle project change
          const handleProjectChange = (e) => {
            const projectName = e.target.value;
            setSelectedProject(projectName);
          };

          const filteredUpdates = updates.filter((item) => {
            const dateMatch = item.date === selectedDate;
            const projectMatch =
              selectedProject === "All Projects" || item.project === selectedProject;
            return dateMatch && projectMatch;
          });

          const totalProjects = filteredUpdates.length;

          const delayedProjects = filteredUpdates.filter(
            (item) => item.status === "Delayed"
          ).length;

          const missingPhotos = filteredUpdates.filter(
            (item) => item.photos === 0
          ).length;

          const materialIssues = filteredUpdates.filter(
            (item) => item.material === "Low"
          ).length;

          // Compose transcript text from the typed fields and hand it to the
          // shared AI pipeline (extract → AI EXTRACTED review → Confirm).
          // The old code POSTed /api/inspections here directly — no AI review,
          // no confirm step. That direct save is intentionally gone.
          const composeTypedTranscript = () => {
            const bits = [
              `Daily update for ${formData.project} on ${formData.date}, location ${formData.location}.`,
              formData.workCompleted && `Work completed: ${formData.workCompleted}`,
              formData.progress !== "" &&
                `Overall progress ${formData.progress} percent with ${formData.labour} labour present.`,
              formData.material === "Low" && "Materials running low.",
              formData.safety === "Warning" && "Safety needs attention.",
              formData.issue && `Issues: ${formData.issue}`,
              formData.tomorrowPlan && `Tomorrow's plan: ${formData.tomorrowPlan}`,
            ].filter(Boolean);
            return bits.join(" ");
          };

          // Handle form submission — validate, then enter the AI review loop.
          const handleFormSubmit = (e) => {
            e.preventDefault();

            if (
              !formData.project ||
              !formData.date ||
              !formData.location ||
              !formData.workCompleted ||
              !formData.progress ||
              !formData.labour
            ) {
              notify("Please fill all required fields.", "error");
              return;
            }

            const pid =
              projects.find((p) => p.name === formData.project)?.id ??
              projects[0]?.id ?? 1;
            setTypedHandoff({
              transcript: composeTypedTranscript(),
              projectId: pid,
              projectName: formData.project,
              logDate: formData.date,
            });
          };

          // Runs after the user presses Confirm & Save in the review step.
          const handleTypedSaved = () => {
            setUpdates((current) => current.map((update) =>
              update.project === formData.project
                ? {
                    ...update,
                    date: formData.date,
                    location: formData.location,
                    progress: Number(formData.progress),
                    labour: Number(formData.labour),
                    material: formData.material,
                    safety: formData.safety,
                    status: formData.status,
                    issue: formData.issue,
                    tomorrowPlan: formData.tomorrowPlan,
                  }
                : update
            ));
            setShowForm(false);
            setTypedHandoff(null);
            setFormData({
              project: "",
              date: "2026-09-12",
              location: "",
              workCompleted: "",
              progress: "",
              labour: "",
              material: "OK",
              safety: "Good",
              status: "On Track",
              issue: "",
              tomorrowPlan: "",
              photos: null,
            });
          };
  // =========================
  // FORM HANDLERS
  // =========================

  const handleFormChange = (e) => {
    const { name, value, files } = e.target;

    setFormData((prev) => ({
      ...prev,
      [name]: files ? files : value,
    }));
  };

  return (
    <div className="daily-updates-page">

      {/* ========================= */}
      {/* HEADER */}
      {/* ========================= */}

      <div className="daily-header">

        <div>
          <div className="title-with-icon">
            <span className="page-icon"><Icon name="calendar" /></span>
            <h1>Daily Updates</h1>
          </div>

          <p>
            Monitor daily construction activities across all projects.
          </p>
        </div>

        <button
          className="create-project-btn"
          onClick={() => { setVoiceTab("write"); setTypedHandoff(null); setShowForm(true); }}
        >
          <Icon name="plus" /> Add Daily Update
        </button>

      </div>


      {/* ========================= */}
      {/* ADD DAILY UPDATE FORM */}
      {/* ========================= */}

      {showForm && (
        <div className="daily-form-overlay">

          <div className="daily-form-card">

            <div className="daily-form-header">

              <div>
                <h2><Icon name="plus" /> Add Daily Update</h2>

                <p>
                  {typedHandoff
                    ? "AI read your update — check every section, edit what is wrong, then confirm to save."
                    : "Enter today's site activities, then review the AI-extracted update before it saves."}
                </p>
              </div>

              <button
                type="button"
                className="daily-form-close"
                onClick={() => { setShowForm(false); setTypedHandoff(null); }}
              >
                <Icon name="xmark" />
              </button>

            </div>

            {/* ENTRY MODE — typed form (unchanged) or voice recording */}
            <div className="voice-tabs" role="tablist" aria-label="Update entry mode">
              <button
                type="button"
                role="tab"
                aria-selected={voiceTab === "write"}
                className={`voice-tab${voiceTab === "write" ? " active" : ""}`}
                onClick={() => { setVoiceTab("write"); setTypedHandoff(null); }}
              >
                <Icon name="pen" /> Write Update
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={voiceTab === "voice"}
                className={`voice-tab${voiceTab === "voice" ? " active" : ""}`}
                onClick={() => setVoiceTab("voice")}
              >
                <Icon name="mic" /> Record Voice Update
              </button>
            </div>

            {voiceTab === "voice" ? (
              <VoiceUpdate
                projectId={
                  projects.find((p) => p.name === formData.project)?.id
                  ?? projects[0]?.id ?? 1
                }
                projectName={
                  formData.project || projects[0]?.name || "Site"
                }
                onSaved={() => { setShowForm(false); setVoiceTab("write"); }}
                onUseManual={() => setVoiceTab("write")}
              />
            ) : typedHandoff ? (
              <>
                <button
                  type="button"
                  className="voice-secondary-btn"
                  onClick={() => setTypedHandoff(null)}
                >
                  <Icon name="arrowLeft" /> Back to form
                </button>
                <VoiceUpdate
                  startMode="transcript"
                  initialTranscript={typedHandoff.transcript}
                  source="typed"
                  logDate={typedHandoff.logDate}
                  projectId={typedHandoff.projectId}
                  projectName={typedHandoff.projectName}
                  progressPct={Number(formData.progress)}
                  onSaved={handleTypedSaved}
                />
              </>
            ) : (

            <form onSubmit={handleFormSubmit}>

              {/* PROJECT + DATE */}

              <div className="daily-form-grid">

                <div className="daily-form-group">
                  <label>
                    Project <span>*</span>
                  </label>

                  <select
                    name="project"
                    value={formData.project}
                    onChange={handleFormChange}
                    required
                  >
                    <option value="">Select Project</option>
                    {(projects.length > 0
                      ? projects.map((p) => p.name)
                      : ["Green Valley Tower", "Sunrise Residency", "Metro Commercial Hub", "Lakeview Heights"]
                    ).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>


                <div className="daily-form-group">
                  <label>
                    Date <span>*</span>
                  </label>

                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleFormChange}
                    required
                  />
                </div>


                {/* LOCATION */}

                <div className="daily-form-group">
                  <label>
                    Site Location <span>*</span>
                  </label>

                  <input
                    type="text"
                    name="location"
                    placeholder="e.g. Solapur"
                    value={formData.location}
                    onChange={handleFormChange}
                    required
                  />
                </div>


                {/* PROGRESS */}

                <div className="daily-form-group">
                  <label>
                    Overall Progress (%) <span>*</span>
                  </label>

                  <input
                    type="number"
                    name="progress"
                    min="0"
                    max="100"
                    placeholder="e.g. 75"
                    value={formData.progress}
                    onChange={handleFormChange}
                    required
                  />
                </div>


                {/* LABOUR */}

                <div className="daily-form-group">
                  <label>
                    Labour Present <span>*</span>
                  </label>

                  <input
                    type="number"
                    name="labour"
                    min="0"
                    placeholder="e.g. 42"
                    value={formData.labour}
                    onChange={handleFormChange}
                    required
                  />
                </div>


                {/* MATERIAL */}

                <div className="daily-form-group">
                  <label>Material Status</label>

                  <select
                    name="material"
                    value={formData.material}
                    onChange={handleFormChange}
                  >
                    <option>OK</option>
                    <option>Low</option>
                  </select>
                </div>


                {/* SAFETY */}

                <div className="daily-form-group">
                  <label>Safety Status</label>

                  <select
                    name="safety"
                    value={formData.safety}
                    onChange={handleFormChange}
                  >
                    <option>Good</option>
                    <option>Warning</option>
                  </select>
                </div>


                {/* PROJECT STATUS */}

                <div className="daily-form-group">
                  <label>Project Status</label>

                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleFormChange}
                  >
                    <option>On Track</option>
                    <option>Attention</option>
                    <option>Delayed</option>
                  </select>
                </div>

              </div>


              {/* WORK COMPLETED */}

              <div className="daily-form-group full-width">
                <label>
                  Work Completed Today <span>*</span>
                </label>

                <textarea
                  name="workCompleted"
                  rows="4"
                  placeholder="Describe the construction work completed today..."
                  value={formData.workCompleted}
                  onChange={handleFormChange}
                  required
                ></textarea>
              </div>


              {/* ISSUE */}

              <div className="daily-form-group full-width">
                <label>Issues / Delays</label>

                <textarea
                  name="issue"
                  rows="3"
                  placeholder="Mention any material delay, labour issue, safety issue, etc."
                  value={formData.issue}
                  onChange={handleFormChange}
                ></textarea>
              </div>


              {/* TOMORROW PLAN */}

              <div className="daily-form-group full-width">
                <label>Tomorrow's Plan</label>

                <textarea
                  name="tomorrowPlan"
                  rows="3"
                  placeholder="What work is planned for tomorrow?"
                  value={formData.tomorrowPlan}
                  onChange={handleFormChange}
                ></textarea>
              </div>


              {/* PHOTOS */}

              <div className="daily-form-group full-width">
                <label>Site Photos</label>

                <input
                  type="file"
                  name="photos"
                  accept="image/*"
                  multiple
                  onChange={handleFormChange}
                />

                <small>
                  Upload construction site photos for today's update.
                </small>
              </div>


              {/* BUTTONS */}

              <div className="daily-form-actions">

                <button
                  type="button"
                  className="daily-cancel-btn"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="daily-submit-btn"
                >
                  <Icon name="sparkles" /> Extract with AI
                </button>

              </div>

            </form>
            )}

          </div>

        </div>
      )}


      {/* ========================= */}
      {/* FILTERS */}
      {/* ========================= */}

      <div className="daily-filter-bar">

        <div className="date-filter">
          <label>Date</label>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>


        <div className="project-filter-select">
          <label>Project</label>

          <select
            value={selectedProject}
            onChange={(e) =>
              setSelectedProject(e.target.value)
            }
          >
            <option>All Projects</option>
            {(projects.length > 0
              ? projects.map((p) => p.name)
              : ["Green Valley Tower", "Sunrise Residency", "Metro Commercial Hub", "Lakeview Heights"]
            ).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

      </div>


      {/* ========================= */}
      {/* SUMMARY */}
      {/* ========================= */}

      <div className="daily-summary">

        <div className="daily-summary-card">
          <span className="daily-summary-icon"><Icon name="building" /></span>

          <div>
            <p>Projects Updated</p>
            <h2>{totalProjects}</h2>
          </div>
        </div>


        <div className="daily-summary-card">
          <span className="daily-summary-icon"><Icon name="clock" /></span>

          <div>
            <p>Delayed Projects</p>
            <h2>{delayedProjects}</h2>
          </div>
        </div>


        <div className="daily-summary-card">
          <span className="daily-summary-icon"><Icon name="camera" /></span>

          <div>
            <p>Missing Photos</p>
            <h2>{missingPhotos}</h2>
          </div>
        </div>


        <div className="daily-summary-card">
          <span className="daily-summary-icon"><Icon name="package" /></span>

          <div>
            <p>Material Issues</p>
            <h2>{materialIssues}</h2>
          </div>
        </div>

      </div>


      {/* ========================= */}
      {/* TABLE */}
      {/* ========================= */}

      <div className="panel daily-table-panel">

        <div className="panel-header">

          <div>
            <h2>Daily Project Status</h2>

            <p>
              Updates for {selectedDate}
            </p>
          </div>

        </div>


        <div className="daily-table-wrapper">

          <table className="daily-table">

            <thead>
              <tr>
                <th>Project</th>
                <th>Progress</th>
                <th>Photos</th>
                <th>Material</th>
                <th>Safety</th>
                <th>Status</th>
                <th>Issue</th>
              </tr>
            </thead>


            <tbody>

              {filteredUpdates.map((item, index) => (

                <tr key={index}>

                  <td>
                    <strong>{item.project}</strong>
                    <small>{item.location}</small>
                  </td>


                  <td>
                    <div className="daily-progress">

                      <div className="daily-progress-bar">
                        <div
                          style={{
                            width: `${item.progress}%`,
                          }}
                        ></div>
                      </div>

                      <span>{item.progress}%</span>

                    </div>
                  </td>


                  <td>
                    {item.photos > 0 ? (
                      <span className="status-good">
                        <Icon name="camera" /> {item.photos}
                      </span>
                    ) : (
                      <span className="status-danger">
                        <Icon name="xmark" /> Missing
                      </span>
                    )}
                  </td>


                  <td>
                    {item.material === "OK" ? (
                      <span className="status-good">
                        <Icon name="circle" style={{ color: "#16a34a" }} /> OK
                      </span>
                    ) : (
                      <span className="status-warning">
                        <Icon name="circle" style={{ color: "#d97706" }} /> Low
                      </span>
                    )}
                  </td>


                  <td>
                    {item.safety === "Good" ? (
                      <span className="status-good">
                        <Icon name="circle" style={{ color: "#16a34a" }} /> Good
                      </span>
                    ) : (
                      <span className="status-warning">
                        <Icon name="circle" style={{ color: "#d97706" }} /> Warning
                      </span>
                    )}
                  </td>


                  <td>
                    {item.status === "On Track" && (
                      <span className="daily-badge green">
                        <Icon name="circle" /> On Track
                      </span>
                    )}

                    {item.status === "Attention" && (
                      <span className="daily-badge orange">
                        <Icon name="circle" /> Attention
                      </span>
                    )}

                    {item.status === "Delayed" && (
                      <span className="daily-badge red">
                        <Icon name="circle" /> Delayed
                      </span>
                    )}

                  </td>


                  <td>
                    {!item.issue || item.issue === "None" ? (
                      <span className="status-good">
                        No issue
                      </span>
                    ) : (
                      <span className="status-danger">
                        <Icon name="alert" /> {item.issue}
                      </span>
                    )}
                  </td>

                </tr>

              ))}

            </tbody>

          </table>


          {filteredUpdates.length === 0 && (
            <div className="no-updates">

              <div><Icon name="inbox" /></div>

              <h3>No daily update found</h3>

              <p>
                No update has been submitted for this
                date and project.
              </p>

            </div>
          )}

        </div>

      </div>


      {/* ========================= */}
      {/* ALERTS */}
      {/* ========================= */}

      <div className="daily-alert-section">

        <div className="panel">

          <div className="panel-header">

            <div>
              <h2><Icon name="alert" /> Action Required</h2>

              <p>
                Issues detected from today's updates
              </p>
            </div>

          </div>


          {filteredUpdates
            .filter(
              (item) =>
                item.photos === 0 ||
                item.material === "Low" ||
                item.status === "Delayed"
            )
            .map((item, index) => (

              <div
                className="daily-alert-item"
                key={index}
              >

                <div className="daily-alert-icon">
                  <Icon name="alert" />
                </div>

                <div>

                  <strong>
                    {item.project}
                  </strong>

                  <p>

                    {item.photos === 0 &&
                      "Today's site photos are missing. "}

                    {item.material === "Low" &&
                      "Material stock is low. "}

                    {item.status === "Delayed" &&
                      "Project is behind schedule. "}

                  </p>

                </div>

              </div>

            ))}

        </div>

      </div>

    </div>
  );
}

export default DailyUpdates;
