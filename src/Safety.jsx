import { useState } from "react";
import { Icon } from "./icons";
import { notify } from "./toast";
import "./Safety.css";

function Safety({ project, onBack }) {
  const [issues, setIssues] = useState([
    {
      id: 1,
      title: "Missing Safety Helmet",
      location: "Block A - Ground Floor",
      priority: "High",
      assigned: "Ramesh Kumar",
      status: "Open",
      date: "10 Sep 2026",
    },
    {
      id: 2,
      title: "Exposed Electrical Wiring",
      location: "Ground Floor - Electrical Room",
      priority: "Critical",
      assigned: "Amit Sharma",
      status: "In Progress",
      date: "09 Sep 2026",
    },
    {
      id: 3,
      title: "Unprotected Edge",
      location: "First Floor",
      priority: "High",
      assigned: "Suresh Patil",
      status: "Open",
      date: "08 Sep 2026",
    },
    {
      id: 4,
      title: "Wet / Slippery Surface",
      location: "Basement",
      priority: "Medium",
      assigned: "Rahul Singh",
      status: "Resolved",
      date: "07 Sep 2026",
    },
  ]);

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const [newIssue, setNewIssue] = useState({
    title: "",
    location: "",
    priority: "Medium",
    assigned: "",
    status: "Open",
  });

  const handleChange = (e) => {
    setNewIssue({
      ...newIssue,
      [e.target.name]: e.target.value,
    });
  };

  const handleAddIssue = (e) => {
    e.preventDefault();

    if (!newIssue.title.trim() || !newIssue.location.trim()) {
      notify("Please enter issue title and location.", "error");
      return;
    }

    const issue = {
      id: Date.now(),
      ...newIssue,
      date: new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
    };

    setIssues((prev) => [...prev, issue]);

    setNewIssue({
      title: "",
      location: "",
      priority: "Medium",
      assigned: "",
      status: "Open",
    });

    setShowForm(false);
  };

  const openIssues = issues.filter(
    (issue) => issue.status === "Open"
  ).length;

  const criticalIssues = issues.filter(
    (issue) => issue.priority === "Critical"
  ).length;

  const inProgressIssues = issues.filter(
    (issue) => issue.status === "In Progress"
  ).length;

  const resolvedIssues = issues.filter(
    (issue) => issue.status === "Resolved"
  ).length;

  const filteredIssues = issues.filter((issue) =>
    `${issue.title} ${issue.location} ${issue.assigned} ${issue.priority} ${issue.status}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="safety-page">

      {/* HEADER */}
      <div className="safety-header">
        <div>
          <button
            className="back-project-btn"
            onClick={onBack}
          >
            ← Back to Project
          </button>

          <h1><Icon name="helmet" /> Safety Management</h1>

          <p>
            {project?.name || "Construction Project"} • Monitor site safety,
            hazards and corrective actions
          </p>
        </div>

        <button
          className="primary-btn safety-report-btn"
          onClick={() => setShowForm(true)}
        >
          + Report Safety Issue
        </button>
      </div>

      {/* ADD ISSUE FORM */}
      {showForm && (
        <div className="safety-card add-safety-card">

          <div className="safety-card-header">
            <div>
              <h2>Report Safety Issue</h2>
              <p>
                Record a new safety hazard or site issue
              </p>
            </div>

            <button
              className="close-safety-btn"
              onClick={() => setShowForm(false)}
            >
              <Icon name="xmark" />
            </button>
          </div>

          <form
            className="safety-form"
            onSubmit={handleAddIssue}
          >

            <div className="safety-form-group">
              <label>Issue Title</label>

              <input
                name="title"
                value={newIssue.title}
                onChange={handleChange}
                placeholder="Example: Missing Safety Helmet"
              />
            </div>

            <div className="safety-form-group">
              <label>Location</label>

              <input
                name="location"
                value={newIssue.location}
                onChange={handleChange}
                placeholder="Example: Block A - Ground Floor"
              />
            </div>

            <div className="safety-form-group">
              <label>Priority</label>

              <select
                name="priority"
                value={newIssue.priority}
                onChange={handleChange}
              >
                <option>Critical</option>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </div>

            <div className="safety-form-group">
              <label>Assigned To</label>

              <input
                name="assigned"
                value={newIssue.assigned}
                onChange={handleChange}
                placeholder="Example: Site Supervisor"
              />
            </div>

            <div className="safety-form-group">
              <label>Status</label>

              <select
                name="status"
                value={newIssue.status}
                onChange={handleChange}
              >
                <option>Open</option>
                <option>In Progress</option>
                <option>Resolved</option>
              </select>
            </div>

            <div className="safety-form-actions">

              <button
                type="button"
                className="cancel-btn"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-btn"
              >
                Report Issue
              </button>

            </div>

          </form>
        </div>
      )}

      {/* SUMMARY CARDS */}
      <div className="safety-summary">

        <div className="safety-stat">
          <div className="stat-icon"><Icon name="alert" /></div>
          <span>Open Issues</span>
          <strong>{openIssues}</strong>
        </div>

        <div className="safety-stat critical-stat">
          <div className="stat-icon"><Icon name="siren" /></div>
          <span>Critical Issues</span>
          <strong>{criticalIssues}</strong>
        </div>

        <div className="safety-stat">
          <div className="stat-icon"><Icon name="wrench" /></div>
          <span>In Progress</span>
          <strong>{inProgressIssues}</strong>
        </div>

        <div className="safety-stat">
          <div className="stat-icon"><Icon name="check" /></div>
          <span>Resolved</span>
          <strong>{resolvedIssues}</strong>
        </div>

      </div>

      {/* SAFETY ISSUES TABLE */}
      <div className="safety-card">

        <div className="safety-card-header">

          <div>
            <h2>Active Safety Issues</h2>
            <p>
              Track hazards and corrective actions across the site
            </p>
          </div>

          <input
            className="safety-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search safety issue..."
          />

        </div>

        <div className="safety-table">

          <div className="safety-row safety-heading">
            <span>Safety Issue</span>
            <span>Location</span>
            <span>Priority</span>
            <span>Assigned To</span>
            <span>Status</span>
            <span>Date</span>
          </div>

          {filteredIssues.length === 0 ? (
            <div className="no-safety-issues">
              No safety issues found.
            </div>
          ) : (
            filteredIssues.map((issue) => (
              <div
                className="safety-row"
                key={issue.id}
              >

                <div className="safety-issue-name">
                  <strong>{issue.title}</strong>
                  <small>Safety Observation</small>
                </div>

                <span>{issue.location}</span>

                <span
                  className={`priority-badge ${issue.priority
                    .toLowerCase()
                    .replace(" ", "-")}`}
                >
                  {issue.priority}
                </span>

                <span>
                  {issue.assigned || "Unassigned"}
                </span>

                <span
                  className={`safety-status ${issue.status
                    .toLowerCase()
                    .replace(" ", "-")}`}
                >
                  {issue.status}
                </span>

                <span>{issue.date}</span>

              </div>
            ))
          )}

        </div>
      </div>

      {/* SAFETY ALERT */}
      <div className="safety-alert">

        <div className="safety-alert-icon">
          <Icon name="alert" />
        </div>

        <div>
          <strong>Safety Attention Required</strong>

          <p>
            {criticalIssues} critical issue(s) require immediate attention.
            Review and assign corrective actions.
          </p>
        </div>

        <button
          onClick={() => setSearch("Critical")}
        >
          Review Issues →
        </button>

      </div>

      {/* DAILY CHECKLIST */}
      <div className="safety-card">

        <div className="safety-card-header">

          <div>
            <h2>Daily Safety Checklist</h2>
            <p>
              Quick site safety verification
            </p>
          </div>

        </div>

        <div className="safety-checklist">

          <div>
            <span><Icon name="check" /></span>
            PPE compliance
          </div>

          <div>
            <span><Icon name="check" /></span>
            Fire extinguishers available
          </div>

          <div>
            <span><Icon name="check" /></span>
            Emergency exits clear
          </div>

          <div>
            <span><Icon name="check" /></span>
            Electrical connections inspected
          </div>

          <div>
            <span><Icon name="check" /></span>
            Work areas clean and safe
          </div>

        </div>

      </div>

    </div>
  );
}

export default Safety;