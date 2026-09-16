import { useState } from "react";
import "./Reports.css";
import { calcBudget, formatINR, RISK_META } from "./budget";
import { Icon } from "./icons";
import { notify } from "./toast";
import WeeklyReport from "./WeeklyReport";

function Reports({ project, onBack }) {
  const [showReport, setShowReport] = useState(false);
  const [reportType, setReportType] = useState("Project Summary");

  const progressData = [
    { phase: "Foundation", progress: 100 },
    { phase: "Ground Floor", progress: 85 },
    { phase: "First Floor", progress: 65 },
    { phase: "Electrical", progress: 40 },
    { phase: "Plumbing", progress: 25 },
    { phase: "Finishing", progress: 10 },
  ];

  const safetyData = [
    { label: "Open", value: 3, className: "orange" },
    { label: "Critical", value: 1, className: "red" },
    { label: "In Progress", value: 2, className: "blue" },
    { label: "Resolved", value: 8, className: "green" },
  ];

  const materialData = [
    { label: "Available", value: 2, className: "green" },
    { label: "Low Stock", value: 2, className: "orange" },
    { label: "Pending", value: 1, className: "red" },
  ];

  const inspectionData = [
    { label: "Passed", value: 7, className: "green" },
    { label: "Failed", value: 2, className: "red" },
    { label: "Pending", value: 2, className: "orange" },
    { label: "Observation", value: 3, className: "blue" },
  ];

  const healthData = [
    {
      name: "Project Progress",
      score: 82,
      status: "Good",
      className: "good",
    },
    {
      name: "Safety",
      score: 78,
      status: "Needs Attention",
      className: "warning",
    },
    {
      name: "Materials",
      score: 70,
      status: "Needs Attention",
      className: "warning",
    },
    {
      name: "Inspections",
      score: 85,
      status: "Good",
      className: "good",
    },
    {
      name: "AI Risk",
      score: 68,
      status: "Medium Risk",
      className: "warning",
    },
  ];

  const maxProgress = 100;

  const budgetInfo = calcBudget({
    total_budget: project?.total_budget ?? 5000000,
    actual_spent: project?.actual_spent ?? 3500000,
    progress: project?.progress ?? 50,
  });

  const budgetRiskMeta =
    RISK_META[budgetInfo.risk] || RISK_META.UNKNOWN;

  const budgetBarPct =
    budgetInfo.total_budget > 0
      ? Math.min(
          100,
          (budgetInfo.actual_spent /
            budgetInfo.total_budget) *
            100
        )
      : 0;

  const budgetBarColor =
    budgetInfo.risk === "HIGH"
      ? "#dc2626"
      : budgetInfo.risk === "MEDIUM"
        ? "#eab308"
        : budgetInfo.risk === "LOW"
          ? "#1a7f37"
          : "#78716c";

  return (
    <div className="reports-page">

      {/* HEADER */}
      <div className="reports-header">
        <div>
          <button
            className="back-project-btn"
            onClick={onBack}
          >
            <Icon name="arrowLeft" /> Back to Project
          </button>

          <h1><Icon name="chart" /> Project Reports & Analytics</h1>

          <p>
            {project?.name || "Construction Project"} •
            Performance, safety, material and inspection analytics
          </p>
        </div>

        <div className="reports-header-actions">

          <select
            className="report-select"
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
          >
            <option>Project Summary</option>
            <option>Progress Report</option>
            <option>Safety Report</option>
            <option>Materials Report</option>
            <option>Inspection Report</option>
            <option>AI Risk Report</option>
          </select>

          <button
            className="generate-report-btn"
            onClick={() => setShowReport(true)}
          >
            <Icon name="file" /> Generate Report
          </button>

        </div>
      </div>

      {/* Phase 12 — live weekly report across all engines (the mock KPIs below stay as-is) */}
      <WeeklyReport projectId={project?.id} projectName={project?.name} />

      {/* KPI CARDS */}
      <div className="report-kpi-grid">

        <div className="report-kpi-card progress-kpi">
          <div className="kpi-top">
            <span>Overall Progress</span>
            <div className="kpi-icon"><Icon name="chart" /></div>
          </div>

          <strong>{project?.progress || 82}%</strong>

          <div className="mini-progress">
            <div
              style={{
                width: `${project?.progress || 82}%`,
              }}
            ></div>
          </div>

          <small>Project completion</small>
        </div>

        <div className="report-kpi-card task-kpi">
          <div className="kpi-top">
            <span>Tasks Completed</span>
            <div className="kpi-icon"><Icon name="check" /></div>
          </div>

          <strong>42</strong>
          <small>Out of 58 total tasks</small>
        </div>

        <div className="report-kpi-card safety-kpi">
          <div className="kpi-top">
            <span>Safety Issues</span>
            <div className="kpi-icon"><Icon name="helmet" /></div>
          </div>

          <strong>3</strong>
          <small>Open issues</small>
        </div>

        <div className="report-kpi-card inspection-kpi">
          <div className="kpi-top">
            <span>Inspections</span>
            <div className="kpi-icon"><Icon name="check" /></div>
          </div>

          <strong>14</strong>
          <small>Completed & scheduled</small>
        </div>

        <div className="report-kpi-card budget-kpi">
          <div className="kpi-top">
            <span><Icon name="wallet" /> Budget Forecast</span>
            <div className="kpi-icon"><Icon name="wallet" /></div>
          </div>

          <strong>
            {budgetInfo.predicted === null
              ? "—"
              : `${formatINR(budgetInfo.predicted)} vs ${formatINR(budgetInfo.total_budget)}`}
          </strong>
          <small>
            <Icon name="circle" style={{ color: budgetRiskMeta.color }} /> {budgetInfo.risk} risk
          </small>
        </div>

      </div>

      {/* PROJECT OVERVIEW */}
      <div className="report-section">

        <div className="section-title">
          <div>
            <h2>Project Overview</h2>
            <p>Current project performance snapshot</p>
          </div>

          <span className="live-badge">
            <Icon name="circle" /> Live Project Data
          </span>
        </div>

        <div className="overview-grid">

          <div className="overview-item">
            <span>Project</span>
            <strong>{project?.name || "Green Valley Tower"}</strong>
          </div>

          <div className="overview-item">
            <span>Location</span>
            <strong>{project?.location || "Solapur"}</strong>
          </div>

          <div className="overview-item">
            <span>Project Manager</span>
            <strong>{project?.manager || "Rajesh Patil"}</strong>
          </div>

          <div className="overview-item">
            <span>Status</span>
            <strong className="status-active">
              <Icon name="circle" /> {project?.status || "Active"}
            </strong>
          </div>

        </div>

      </div>

      {/* PROGRESS GRAPH */}
      <div className="report-section">

        <div className="section-title">
          <div>
            <h2><Icon name="building" /> Construction Progress</h2>
            <p>Phase-wise construction completion</p>
          </div>
        </div>

        <div className="progress-chart">

          {progressData.map((item) => (
            <div
              className="progress-chart-row"
              key={item.phase}
            >

              <div className="phase-name">
                {item.phase}
              </div>

              <div className="chart-track">

                <div
                  className="chart-fill"
                  style={{
                    width: `${item.progress}%`,
                  }}
                ></div>

              </div>

              <strong>{item.progress}%</strong>

            </div>
          ))}

        </div>

      </div>

      {/* BUDGET VS FORECAST */}
      <div className="report-section">

        <div className="section-title">
          <div>
            <h2><Icon name="wallet" /> Budget vs Forecast</h2>
            <p>Budget utilisation and forecast</p>
          </div>
        </div>

        <div className="progress-chart">

          <div className="progress-chart-row">
            <div className="phase-name">
              Total Budget
            </div>
            <strong>
              {formatINR(budgetInfo.total_budget)}
            </strong>
          </div>

          <div className="progress-chart-row">
            <div className="phase-name">
              Actual Spent
            </div>
            <strong>
              {formatINR(budgetInfo.actual_spent)}
            </strong>
          </div>

          <div className="progress-chart-row">
            <div className="phase-name">
              Remaining
            </div>
            <strong>
              {formatINR(budgetInfo.remaining)}
            </strong>
          </div>

          <div className="progress-chart-row">
            <div className="phase-name">
              Predicted
            </div>
            <strong>
              {budgetInfo.predicted === null
                ? "—"
                : formatINR(budgetInfo.predicted)}
            </strong>
          </div>

          <div className="progress-chart-row">
            <div className="phase-name">
              Overrun
            </div>
            <strong>
              {budgetInfo.overrun === null
                ? "—"
                : `${formatINR(budgetInfo.overrun)} (${budgetInfo.risk})`}
            </strong>
          </div>

          <div className="progress-chart-row">
            <div className="phase-name">
              Actual vs Budget
            </div>

            <div className="chart-track">

              <div
                className="chart-fill"
                style={{
                  width: `${budgetBarPct}%`,
                  backgroundColor: budgetBarColor,
                }}
              ></div>

            </div>

            <strong>
              {Math.round(budgetBarPct)}%
            </strong>

          </div>

        </div>

      </div>

      {/* TWO COLUMN ANALYTICS */}
      <div className="analytics-grid">

        {/* SAFETY */}
        <div className="report-section analytics-card">

          <div className="section-title">
            <div>
              <h2><Icon name="helmet" /> Safety Analytics</h2>
              <p>Current safety issue distribution</p>
            </div>
          </div>

          <div className="donut-wrapper">

            <div className="fake-donut safety-donut">
              <div>
                <strong>14</strong>
                <span>Total</span>
              </div>
            </div>

            <div className="analytics-legend">

              {safetyData.map((item) => (
                <div
                  className="legend-item"
                  key={item.label}
                >
                  <span className={`legend-dot ${item.className}`}></span>

                  <span>{item.label}</span>

                  <strong>{item.value}</strong>
                </div>
              ))}

            </div>

          </div>

        </div>

        {/* MATERIALS */}
        <div className="report-section analytics-card">

          <div className="section-title">
            <div>
              <h2><Icon name="package" /> Materials Status</h2>
              <p>Inventory availability overview</p>
            </div>
          </div>

          <div className="material-bars">

            {materialData.map((item) => (
              <div
                className="material-row"
                key={item.label}
              >

                <div className="material-label">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>

                <div className="material-track">

                  <div
                    className={`material-fill ${item.className}`}
                    style={{
                      width: `${item.value * 20}%`,
                    }}
                  ></div>

                </div>

              </div>
            ))}

          </div>

        </div>

      </div>

      {/* INSPECTION ANALYTICS */}
      <div className="report-section">

        <div className="section-title">
          <div>
            <h2><Icon name="clipboard" /> Inspection Analytics</h2>
            <p>Inspection result distribution</p>
          </div>
        </div>

        <div className="inspection-chart">

          {inspectionData.map((item) => (
            <div
              className="inspection-column"
              key={item.label}
            >

              <div className="inspection-value">
                {item.value}
              </div>

              <div className="inspection-bar-container">

                <div
                  className={`inspection-bar ${item.className}`}
                  style={{
                    height: `${item.value * 20}px`,
                  }}
                ></div>

              </div>

              <span>{item.label}</span>

            </div>
          ))}

        </div>

      </div>

      {/* AI RISK */}
      <div className="ai-risk-section">

        <div className="ai-risk-main">

          <div className="ai-risk-icon">
            <Icon name="bot" />
          </div>

          <div>
            <span className="ai-label">
              SITEVISION AI
            </span>

            <h2>AI Site Risk Assessment</h2>

            <p>
              Computer vision analysis of recent construction
              site images.
            </p>
          </div>

        </div>

        <div className="ai-risk-score">

          <div className="risk-circle">
            <strong>68</strong>
            <span>/100</span>
          </div>

          <div>
            <span className="medium-risk">
              <Icon name="alert" /> Medium Risk
            </span>

            <p>
              2 issues detected • 3 recommendations
            </p>
          </div>

        </div>

      </div>

      {/* PROJECT HEALTH */}
      <div className="report-section">

        <div className="section-title">
          <div>
            <h2><Icon name="heart" /> Overall Project Health</h2>
            <p>Intelligent project performance indicators</p>
          </div>
        </div>

        <div className="health-list">

          {healthData.map((item) => (
            <div
              className="health-row"
              key={item.name}
            >

              <div className="health-name">
                <span>{item.name}</span>
                <strong>{item.score}%</strong>
              </div>

              <div className="health-track">

                <div
                  className={`health-fill ${item.className}`}
                  style={{
                    width: `${item.score}%`,
                  }}
                ></div>

              </div>

              <span
                className={`health-status ${item.className}`}
              >
                {item.status}
              </span>

            </div>
          ))}

        </div>

      </div>

      {/* REPORT PREVIEW MODAL */}
      {showReport && (

        <div className="report-modal-overlay">

          <div className="report-modal">

            <div className="modal-header">

              <div>
                <span>GENERATED REPORT</span>
                <h2><Icon name="file" /> {reportType}</h2>
              </div>

              <button
                className="modal-close"
                onClick={() => setShowReport(false)}
              >
                <Icon name="xmark" />
              </button>

            </div>

            <div className="generated-report">

              <div className="report-logo">
                <Icon name="building" /> BuildSafe
              </div>

              <h1>{reportType}</h1>

              <p>
                {project?.name || "Construction Project"}
              </p>

              <div className="report-divider"></div>

              <div className="generated-summary">

                <div>
                  <span>Project Progress</span>
                  <strong>{project?.progress || 82}%</strong>
                </div>

                <div>
                  <span>Open Safety Issues</span>
                  <strong>3</strong>
                </div>

                <div>
                  <span>Inspections</span>
                  <strong>14</strong>
                </div>

                <div>
                  <span>AI Risk</span>
                  <strong>68 / 100</strong>
                </div>

                <div>
                  <span>Budget Forecast</span>
                  <strong>
                    {budgetInfo.predicted === null
                      ? "—"
                      : `Predicted ${formatINR(budgetInfo.predicted)} · Overrun ${formatINR(budgetInfo.overrun)} · ${budgetInfo.risk}`}
                  </strong>
                </div>

              </div>

              <div className="report-note">

                <strong>Executive Summary</strong>

                <p>
                  The project is currently progressing according
                  to the available construction data. Foundation
                  work is complete, while structural, MEP and
                  finishing activities are progressing at different
                  stages.
                </p>

              </div>

              <div className="report-note">

                <strong>Key Recommendations</strong>

                <ul>
                  <li>Monitor low-stock construction materials.</li>
                  <li>Close open safety observations.</li>
                  <li>Complete pending inspections.</li>
                  <li>Review AI-detected site risks.</li>
                  <li>
                    {budgetInfo.predicted === null
                      ? "Budget forecast unavailable — record budget and progress to enable forecasting."
                      : `Budget forecast: predicted ${formatINR(budgetInfo.predicted)} vs ${formatINR(budgetInfo.total_budget)} budget (${budgetInfo.risk} risk) — review costs.`}
                  </li>
                </ul>

              </div>

            </div>

            <div className="modal-actions">

              <button
                className="cancel-btn"
                onClick={() => setShowReport(false)}
              >
                Close
              </button>

              <button
                className="generate-report-btn"
                onClick={() =>
                  notify(
                    "Report export will be connected to the backend in the next phase."
                  )
                }
              >
                <Icon name="download" /> Export Report
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}

export default Reports;