import { useState } from "react";
import { Icon } from "./icons";
import RecurringIssues from "./RecurringIssues";
import RiskScores from "./RiskScores";
import SiteHeatmap from "./SiteHeatmap";

function RiskAlerts() {
  // =========================================
  // DEMO RISK DATA
  // =========================================

  const [risks, setRisks] = useState([
    {
      id: 1,
      level: "HIGH",
      category: "Safety",
      title: "PPE Compliance Issue",
      project: "Green Valley Tower",
      location: "Site A",
      detected: "Today, 10:32 AM",
      description:
        "Some workers may require additional PPE verification.",
      status: "Open",
      source: "SiteVision AI",
    },

    {
      id: 2,
      level: "HIGH",
      category: "Inspection",
      title: "Overdue Safety Inspection",
      project: "Sunrise Residency",
      location: "Building B",
      detected: "Today, 09:15 AM",
      description:
        "Scheduled safety inspection requires site supervisor attention.",
      status: "Open",
      source: "Inspection System",
    },

    {
      id: 3,
      level: "MEDIUM",
      category: "Progress",
      title: "Progress Delay",
      project: "Sunrise Residency",
      location: "Floor 4",
      detected: "Today, 11:20 AM",
      description:
        "Current progress is below the expected project schedule.",
      status: "Open",
      source: "Progress Tracking",
    },

    {
      id: 4,
      level: "MEDIUM",
      category: "Material",
      title: "Material Handling Issue",
      project: "Green Valley Tower",
      location: "Storage Area",
      detected: "Today, 12:05 PM",
      description:
        "Material placement requires site supervisor verification.",
      status: "Open",
      source: "SiteVision AI",
    },

    {
      id: 5,
      level: "MEDIUM",
      category: "Maintenance",
      title: "Maintenance Task Overdue",
      project: "Metro Commercial Hub",
      location: "Main Building",
      detected: "Yesterday, 04:30 PM",
      description:
        "Scheduled maintenance activity has not been completed.",
      status: "Open",
      source: "Maintenance",
    },

    {
      id: 6,
      level: "LOW",
      category: "Progress",
      title: "Daily Update Missing",
      project: "Lakeview Heights",
      location: "Site Office",
      detected: "Yesterday, 06:00 PM",
      description:
        "Daily project update has not been submitted.",
      status: "Open",
      source: "Daily Updates",
    },

    {
      id: 7,
      level: "LOW",
      category: "Material",
      title: "Low Material Stock",
      project: "Green Valley Tower",
      location: "Material Store",
      detected: "Yesterday, 03:45 PM",
      description:
        "Material stock should be reviewed before the next work cycle.",
      status: "Open",
      source: "Materials",
    },

    {
      id: 8,
      level: "HIGH",
      category: "Safety",
      title: "Unsafe Work Area Observation",
      project: "Metro Commercial Hub",
      location: "Floor 2",
      detected: "2 days ago",
      description:
        "Site observation requires immediate supervisor verification.",
      status: "Resolved",
      source: "SiteVision AI",
    },

    {
      id: 9,
      level: "LOW",
      category: "Inspection",
      title: "Upcoming Inspection",
      project: "Lakeview Heights",
      location: "Building A",
      detected: "2 days ago",
      description:
        "An upcoming inspection should be scheduled and assigned.",
      status: "Resolved",
      source: "Inspection System",
    },

    {
      id: 10,
      level: "HIGH",
      category: "Budget",
      title:
        "Budget Overrun Forecast — Metro Commercial Hub: predicted ₹70L vs ₹50L budget",
      project: "Metro Commercial Hub",
      location: "Site Office",
      detected: "Today, 01:15 PM",
      description:
        "Forecasted spend of ₹70L exceeds the ₹50L budget by ₹20L (HIGH risk). Review costs and progress before overrun grows.",
      status: "Open",
      source: "Budget Prediction",
    },

    {
      id: 11,
      level: "MEDIUM",
      category: "Budget",
      title:
        "Budget Pressure — Sunrise Residency: spend trending above plan",
      project: "Sunrise Residency",
      location: "Building B",
      detected: "Today, 02:40 PM",
      description:
        "Current spend trend suggests the project may exceed its planned budget. Monitor material and labour costs closely.",
      status: "Open",
      source: "Budget Prediction",
    },
  ]);

  // =========================================
  // FILTER STATES
  // =========================================

  const [severityFilter, setSeverityFilter] =
    useState("All");

  const [categoryFilter, setCategoryFilter] =
    useState("All");

  const [statusFilter, setStatusFilter] =
    useState("All");

  const [selectedRisk, setSelectedRisk] =
    useState(null);

  // =========================================
  // RESOLVE RISK
  // =========================================

  const resolveRisk = (id) => {
    setRisks((previousRisks) =>
      previousRisks.map((risk) =>
        risk.id === id
          ? {
              ...risk,
              status: "Resolved",
            }
          : risk
      )
    );

    if (selectedRisk) {
      setSelectedRisk({
        ...selectedRisk,
        status: "Resolved",
      });
    }
  };

  // =========================================
  // FILTER RISKS
  // =========================================

  const filteredRisks = risks.filter((risk) => {
    const severityMatch =
      severityFilter === "All" ||
      risk.level === severityFilter;

    const categoryMatch =
      categoryFilter === "All" ||
      risk.category === categoryFilter;

    const statusMatch =
      statusFilter === "All" ||
      risk.status === statusFilter;

    return (
      severityMatch &&
      categoryMatch &&
      statusMatch
    );
  });

  // =========================================
  // SUMMARY COUNTS
  // =========================================

  const highCount = risks.filter(
    (risk) =>
      risk.level === "HIGH" &&
      risk.status === "Open"
  ).length;

  const mediumCount = risks.filter(
    (risk) =>
      risk.level === "MEDIUM" &&
      risk.status === "Open"
  ).length;

  const lowCount = risks.filter(
    (risk) =>
      risk.level === "LOW" &&
      risk.status === "Open"
  ).length;

  const resolvedCount = risks.filter(
    (risk) =>
      risk.status === "Resolved"
  ).length;

  // =========================================
  // RISK ICON
  // =========================================

  const getRiskIcon = (level) => {
    if (level === "HIGH") return <Icon name="circle" style={{ color: "#dc2626" }} />;
    if (level === "MEDIUM") return <Icon name="circle" style={{ color: "#ea580c" }} />;
    return <Icon name="circle" style={{ color: "#d97706" }} />;
  };

  // =========================================
  // CATEGORY ICON
  // =========================================

  const getCategoryIcon = (category) => {
    if (category === "Safety") return <Icon name="helmet" />;
    if (category === "Progress") return <Icon name="building" />;
    if (category === "Material") return <Icon name="package" />;
    if (category === "Inspection") return <Icon name="search" />;
    if (category === "Maintenance") return <Icon name="wrench" />;
    if (category === "Budget") return <Icon name="wallet" />;

    return <Icon name="alert" />;
  };

  return (
    <div className="risk-alerts-page">

      {/* =====================================
          HEADER
      ====================================== */}

      <div className="risk-alerts-header">

        <div>
          <h1><Icon name="alert" /> Risk & Alerts</h1>

          <p>
            Monitor construction risks,
            safety issues and project alerts
            in one place.
          </p>
        </div>

        <div className="risk-live-status">
          <span className="risk-live-dot"></span>
          Live Monitoring
        </div>

      </div>

      {/* =====================================
           RISK HEATMAP (live geography — where)
      ====================================== */}

      <SiteHeatmap />

      {/* =====================================
           LIVE RISK ENGINE (DB-computed scores + WHY)
      ====================================== */}

      <RiskScores />

      {/* =====================================
           RECURRING ISSUES (live, DB-counted)
           Own panel above the static demo list below.
      ====================================== */}

      <RecurringIssues />

      {/* =====================================
           SUMMARY CARDS
      ====================================== */}

      <div className="risk-summary-grid">

        <div className="risk-summary-card high">
          <div className="risk-summary-icon">
            <Icon name="circle" style={{ color: "#dc2626" }} />
          </div>

          <div>
            <span>High Risk</span>
            <strong>{highCount}</strong>
            <small>Open alerts</small>
          </div>
        </div>

        <div className="risk-summary-card medium">
          <div className="risk-summary-icon">
            <Icon name="circle" style={{ color: "#ea580c" }} />
          </div>

          <div>
            <span>Medium Risk</span>
            <strong>{mediumCount}</strong>
            <small>Open alerts</small>
          </div>
        </div>

        <div className="risk-summary-card low">
          <div className="risk-summary-icon">
            <Icon name="circle" style={{ color: "#d97706" }} />
          </div>

          <div>
            <span>Low Risk</span>
            <strong>{lowCount}</strong>
            <small>Open alerts</small>
          </div>
        </div>

        <div className="risk-summary-card resolved">
          <div className="risk-summary-icon">
            <Icon name="circle" style={{ color: "#16a34a" }} />
          </div>

          <div>
            <span>Resolved</span>
            <strong>{resolvedCount}</strong>
            <small>Completed alerts</small>
          </div>
        </div>

      </div>

      {/* =====================================
          FILTER SECTION
      ====================================== */}

      <div className="risk-filter-panel">

        <div className="risk-filter-title">
          <strong>Filter Alerts</strong>
          <span>
            {filteredRisks.length} alerts found
          </span>
        </div>

        <div className="risk-filter-row">

          {/* Severity */}

          <div className="risk-filter-group">

            <label>Severity</label>

            <select
              value={severityFilter}
              onChange={(e) =>
                setSeverityFilter(e.target.value)
              }
            >
              <option value="All">
                All Severities
              </option>

              <option value="HIGH">
                High
              </option>

              <option value="MEDIUM">
                Medium
              </option>

              <option value="LOW">
                Low
              </option>
            </select>

          </div>

          {/* Category */}

          <div className="risk-filter-group">

            <label>Category</label>

            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value)
              }
            >
              <option value="All">
                All Categories
              </option>

              <option value="Safety">
                Safety
              </option>

              <option value="Progress">
                Progress
              </option>

              <option value="Material">
                Material
              </option>

              <option value="Inspection">
                Inspection
              </option>

              <option value="Maintenance">
                Maintenance
              </option>

              <option value="Budget">
                Budget
              </option>
            </select>

          </div>

          {/* Status */}

          <div className="risk-filter-group">

            <label>Status</label>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value)
              }
            >
              <option value="All">
                All Status
              </option>

              <option value="Open">
                Open
              </option>

              <option value="Resolved">
                Resolved
              </option>
            </select>

          </div>

          {/* Reset */}

          <button
            className="risk-reset-btn"
            onClick={() => {
              setSeverityFilter("All");
              setCategoryFilter("All");
              setStatusFilter("All");
            }}
          >
            <Icon name="rotate" /> Reset
          </button>

        </div>

      </div>

      {/* =====================================
          ALERT LIST
      ====================================== */}

      <div className="risk-alerts-panel">

        <div className="risk-alerts-panel-header">

          <div>
            <h2>Active Risk Alerts</h2>

            <p>
              Issues detected across
              construction projects.
            </p>
          </div>

          <span className="risk-alert-count">
            {filteredRisks.length}
          </span>

        </div>

        <div className="risk-alert-list">

          {filteredRisks.length === 0 ? (

            <div className="risk-empty-state">

              <div><Icon name="check" /></div>

              <h3>
                No alerts found
              </h3>

              <p>
                Try changing your filters.
              </p>

            </div>

          ) : (

            filteredRisks.map((risk) => (

              <div
                className={`risk-alert-item ${risk.level.toLowerCase()} ${
                  risk.status === "Resolved"
                    ? "resolved-alert"
                    : ""
                }`}
                key={risk.id}
              >

                {/* Icon */}

                <div className="risk-alert-main-icon">

                  {getRiskIcon(risk.level)}

                </div>

                {/* Content */}

                <div className="risk-alert-content">

                  <div className="risk-alert-top">

                    <div>

                      <span className="risk-category">

                        {getCategoryIcon(
                          risk.category
                        )}{" "}

                        {risk.category}

                      </span>

                      <h3>
                        {risk.title}
                      </h3>

                    </div>

                    <span
                      className={`risk-severity-badge ${risk.level.toLowerCase()}`}
                    >
                      {risk.level}
                    </span>

                  </div>

                  <p className="risk-description">
                    {risk.description}
                  </p>

                  <div className="risk-meta">

                    <span>
                      <Icon name="building" /> {risk.project}
                    </span>

                    <span>
                      <Icon name="location" /> {risk.location}
                    </span>

                    <span>
                      <Icon name="clock" /> {risk.detected}
                    </span>

                    <span>
                      <Icon name="bot" /> {risk.source}
                    </span>

                  </div>

                  <div className="risk-alert-bottom">

                    <span
                      className={`risk-status-badge ${
                        risk.status === "Open"
                          ? "open"
                          : "resolved"
                      }`}
                    >
                      {risk.status === "Open"
                        ? (<><Icon name="circle" /> Open</>)
                        : (<><Icon name="check" /> Resolved</>)}
                    </span>

                    <div className="risk-actions">

                      <button
                        className="risk-view-btn"
                        onClick={() =>
                          setSelectedRisk(risk)
                        }
                      >
                        View Details
                      </button>

                      {risk.status === "Open" && (

                        <button
                          className="risk-resolve-btn"
                          onClick={() =>
                            resolveRisk(risk.id)
                          }
                        >
                          <Icon name="check" /> Resolve
                        </button>

                      )}

                    </div>

                  </div>

                </div>

              </div>

            ))

          )}

        </div>

      </div>

      {/* =====================================
          DETAILS MODAL
      ====================================== */}

      {selectedRisk && (

        <div
          className="risk-modal-overlay"
          onClick={() =>
            setSelectedRisk(null)
          }
        >

          <div
            className="risk-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <div className="risk-modal-header">

              <div>

                <span
                  className={`risk-severity-badge ${selectedRisk.level.toLowerCase()}`}
                >
                  {getRiskIcon(
                    selectedRisk.level
                  )}{" "}
                  {selectedRisk.level}
                </span>

                <h2>
                  {selectedRisk.title}
                </h2>

              </div>

              <button
                className="risk-modal-close"
                onClick={() =>
                  setSelectedRisk(null)
                }
              >
                <Icon name="xmark" />
              </button>

            </div>

            <div className="risk-modal-body">

              <div className="risk-detail-grid">

                <div>
                  <label>Category</label>
                  <strong>
                    {getCategoryIcon(
                      selectedRisk.category
                    )}{" "}
                    {selectedRisk.category}
                  </strong>
                </div>

                <div>
                  <label>Status</label>
                  <strong>
                    {selectedRisk.status}
                  </strong>
                </div>

                <div>
                  <label>Project</label>
                  <strong>
                    {selectedRisk.project}
                  </strong>
                </div>

                <div>
                  <label>Location</label>
                  <strong>
                    <Icon name="location" /> {selectedRisk.location}
                  </strong>
                </div>

                <div>
                  <label>Detected</label>
                  <strong>
                    {selectedRisk.detected}
                  </strong>
                </div>

                <div>
                  <label>Source</label>
                  <strong>
                    {selectedRisk.source}
                  </strong>
                </div>

              </div>

              <div className="risk-detail-description">

                <h3>
                  Risk Description
                </h3>

                <p>
                  {selectedRisk.description}
                </p>

              </div>

              <div className="risk-detail-note">

                <span><Icon name="alert" /></span>

                <p>
                  This alert is an observation
                  generated by the BuildSafe
                  monitoring system. Site
                  personnel should verify the
                  condition before taking
                  safety-critical action.
                </p>

              </div>

            </div>

            <div className="risk-modal-footer">

              <button
                className="risk-cancel-btn"
                onClick={() =>
                  setSelectedRisk(null)
                }
              >
                Close
              </button>

              {selectedRisk.status ===
                "Open" && (

                <button
                  className="risk-resolve-btn"
                  onClick={() =>
                    resolveRisk(
                      selectedRisk.id
                    )
                  }
                >
                  <Icon name="check" /> Mark as Resolved
                </button>

              )}

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default RiskAlerts;