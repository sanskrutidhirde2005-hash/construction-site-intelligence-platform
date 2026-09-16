import { useState } from "react";
import "./App.css";
import { Icon } from "./icons";
import { notify } from "./toast";

function PastProjects() {
  const [selectedProject, setSelectedProject] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showAddMaintenance, setShowAddMaintenance] = useState(false);

  const [maintenanceHistory, setMaintenanceHistory] = useState({
    "Green Valley Tower": [
      {
        title: "Electrical System Inspection",
        category: "Inspection",
        date: "12 Aug 2026",
        priority: "Medium",
        status: "Completed",
        description: "Regular electrical system inspection completed.",
      },
      {
        title: "Plumbing Inspection",
        category: "Inspection",
        date: "20 Jul 2026",
        priority: "Low",
        status: "Completed",
        description: "Water supply and leakage inspection completed.",
      },
    ],

    "Sunrise Residency": [
      {
        title: "Lift Maintenance",
        category: "Repair",
        date: "05 Aug 2026",
        priority: "High",
        status: "Completed",
        description: "Regular lift maintenance and inspection.",
      },
      {
        title: "Fire Safety Check",
        category: "Safety",
        date: "15 Jun 2026",
        priority: "High",
        status: "Pending",
        description: "Fire safety equipment inspection is pending.",
      },
    ],

    "Metro Commercial Hub": [
      {
        title: "HVAC Maintenance",
        category: "Maintenance",
        date: "10 Jul 2026",
        priority: "Medium",
        status: "Completed",
        description: "HVAC system maintenance completed.",
      },
    ],

    "Lakeview Heights": [
      {
        title: "Water Tank Inspection",
        category: "Inspection",
        date: "18 Aug 2026",
        priority: "Low",
        status: "Completed",
        description: "Water tank inspection completed successfully.",
      },
    ],
  });

  const [formData, setFormData] = useState({
    title: "",
    category: "Maintenance",
    date: "",
    priority: "Medium",
    status: "Pending",
    description: "",
  });

  const projects = [
    {
      name: "Green Valley Tower",
      location: "Solapur",
      type: "Residential Tower",
      completionDate: "15 Dec 2025",
      maintenance: 2,
      overdue: 0,
      status: "Good",
    },
    {
      name: "Sunrise Residency",
      location: "Pune",
      type: "Residential Building",
      completionDate: "20 Aug 2024",
      maintenance: 5,
      overdue: 3,
      status: "Attention",
    },
    {
      name: "Metro Commercial Hub",
      location: "Mumbai",
      type: "Commercial Building",
      completionDate: "10 Mar 2024",
      maintenance: 4,
      overdue: 1,
      status: "Attention",
    },
    {
      name: "Lakeview Heights",
      location: "Nashik",
      type: "Residential Complex",
      completionDate: "05 Jan 2023",
      maintenance: 1,
      overdue: 0,
      status: "Good",
    },
  ];

  // ================================
  // FORM INPUT CHANGE
  // ================================

  const handleInputChange = (e) => {
    const { name, value } = e.target;

    setFormData({
      ...formData,
      [name]: value,
    });
  };

  // ================================
  // ADD MAINTENANCE
  // ================================

  const handleAddMaintenance = (e) => {
    e.preventDefault();

    if (!formData.title || !formData.date || !formData.description) {
      notify("Please fill all required fields.");
      return;
    }

    const projectName = selectedProject.name;

    const newMaintenance = {
      title: formData.title,
      category: formData.category,
      date: formData.date,
      priority: formData.priority,
      status: formData.status,
      description: formData.description,
    };

    setMaintenanceHistory((previousHistory) => ({
      ...previousHistory,
      [projectName]: [
        ...(previousHistory[projectName] || []),
        newMaintenance,
      ],
    }));

    setFormData({
      title: "",
      category: "Maintenance",
      date: "",
      priority: "Medium",
      status: "Pending",
      description: "",
    });

    setShowAddMaintenance(false);
    setShowHistory(true);

    notify("Maintenance added successfully!", "success");
  };

  // ================================
  // VIEW HISTORY
  // ================================

  const openHistory = () => {
    setShowHistory(true);
  };

  // ================================
  // CLOSE EVERYTHING
  // ================================

  const closeDetails = () => {
    setSelectedProject(null);
    setShowHistory(false);
    setShowAddMaintenance(false);
  };

  return (
    <div className="past-projects-page">

      {/* HEADER */}
      <div className="past-projects-header">
        <div>
          <div className="title-with-icon">
            <span className="page-icon"><Icon name="wrench" /></span>
            <h1>Past Projects & Maintenance</h1>
          </div>

          <p>
            Monitor completed projects, inspections and ongoing maintenance.
          </p>
        </div>
      </div>


      {/* SUMMARY */}
      <div className="maintenance-summary">

        <div className="maintenance-summary-card">
          <span><Icon name="building" /></span>
          <div>
            <p>Completed Projects</p>
            <h2>{projects.length}</h2>
          </div>
        </div>

        <div className="maintenance-summary-card">
          <span><Icon name="wrench" /></span>
          <div>
            <p>Active Maintenance</p>
            <h2>12</h2>
          </div>
        </div>

        <div className="maintenance-summary-card">
          <span><Icon name="alert" /></span>
          <div>
            <p>Overdue Tasks</p>
            <h2>4</h2>
          </div>
        </div>

        <div className="maintenance-summary-card">
          <span><Icon name="search" /></span>
          <div>
            <p>Upcoming Inspections</p>
            <h2>6</h2>
          </div>
        </div>

      </div>


      {/* PROJECT LIST */}
      <div className="panel past-project-panel">

        <div className="panel-header">
          <div>
            <h2>Completed Projects</h2>
            <p>Buildings currently under maintenance monitoring</p>
          </div>
        </div>


        <div className="past-project-grid">

          {projects.map((project, index) => (

            <div className="past-project-card" key={index}>

              <div className="past-project-card-top">

                <div className="past-project-building">
                  <Icon name="building" />
                </div>

                <span
                  className={
                    project.status === "Good"
                      ? "maintenance-status good"
                      : "maintenance-status attention"
                  }
                >
                  <Icon name="circle" /> {project.status}
                </span>

              </div>


              <h3>{project.name}</h3>

              <p className="past-project-location">
                <Icon name="location" /> {project.location}
              </p>


              <div className="past-project-info">

                <div>
                  <span>Building Type</span>
                  <strong>{project.type}</strong>
                </div>

                <div>
                  <span>Completed</span>
                  <strong>{project.completionDate}</strong>
                </div>

              </div>


              <div className="maintenance-mini-stats">

                <div>
                  <strong>
                    {maintenanceHistory[project.name]?.length || 0}
                  </strong>
                  <span>Maintenance</span>
                </div>

                <div>
                  <strong>{project.overdue}</strong>
                  <span>Overdue</span>
                </div>

              </div>


              <button
                className="view-maintenance-btn"
                onClick={() => {
                  setSelectedProject(project);
                  setShowHistory(false);
                  setShowAddMaintenance(false);
                }}
              >
                View Details <Icon name="arrowRight" />
              </button>

            </div>

          ))}

        </div>

      </div>


      {/* PROJECT DETAILS */}
      {selectedProject && !showHistory && !showAddMaintenance && (

        <div className="maintenance-modal-overlay">

          <div className="maintenance-modal">

            <div className="maintenance-modal-header">

              <div>
                <h2><Icon name="building" /> {selectedProject.name}</h2>
                <p>
                  <Icon name="location" /> {selectedProject.location}
                </p>
              </div>

              <button
                className="maintenance-close-btn"
                onClick={closeDetails}
              >
                <Icon name="xmark" />
              </button>

            </div>


            {/* OVERVIEW */}

            <div className="maintenance-detail-section">

              <h3>Building Overview</h3>

              <div className="maintenance-detail-grid">

                <div>
                  <span>Building Type</span>
                  <strong>{selectedProject.type}</strong>
                </div>

                <div>
                  <span>Completion Date</span>
                  <strong>{selectedProject.completionDate}</strong>
                </div>

                <div>
                  <span>Maintenance Tasks</span>
                  <strong>
                    {maintenanceHistory[selectedProject.name]?.length || 0}
                  </strong>
                </div>

                <div>
                  <span>Overdue Tasks</span>
                  <strong>
                    {selectedProject.overdue}
                  </strong>
                </div>

              </div>

            </div>


            {/* MAINTENANCE STATUS */}

            <div className="maintenance-detail-section">

              <h3><Icon name="wrench" /> Maintenance Status</h3>

              <div className="maintenance-task">

                <div>
                  <strong>Electrical System Inspection</strong>
                  <p>Regular electrical maintenance check</p>
                </div>

                <span className="task-completed">
                  <Icon name="check" /> Completed
                </span>

              </div>


              <div className="maintenance-task">

                <div>
                  <strong>Plumbing Inspection</strong>
                  <p>Check water supply and leakage issues</p>
                </div>

                <span className="task-pending">
                  <Icon name="circle" /> Pending
                </span>

              </div>


              <div className="maintenance-task">

                <div>
                  <strong>Fire Safety Inspection</strong>
                  <p>Fire equipment and emergency systems</p>
                </div>

                <span className="task-upcoming">
                  Upcoming
                </span>

              </div>

            </div>


            {/* INSPECTION */}

            <div className="maintenance-detail-section">

              <h3><Icon name="search" /> Inspections</h3>

              <div className="inspection-box">

                <div>
                  <span>Last Inspection</span>
                  <strong>12 Aug 2026</strong>
                </div>

                <div>
                  <span>Next Inspection</span>
                  <strong>12 Nov 2026</strong>
                </div>

                <div>
                  <span>Inspection Status</span>
                  <strong>Scheduled</strong>
                </div>

              </div>

            </div>


            {/* ACTION BUTTONS */}

            <div className="maintenance-modal-actions">

              <button
                className="secondary-maintenance-btn"
                onClick={openHistory}
              >
                <Icon name="clipboard" /> Maintenance History
              </button>

              <button
                className="primary-maintenance-btn"
                onClick={() => setShowAddMaintenance(true)}
              >
                <Icon name="plus" /> Add Maintenance
              </button>

            </div>

          </div>

        </div>

      )}


      {/* ================================
          MAINTENANCE HISTORY
      ================================= */}

      {selectedProject && showHistory && (

        <div className="maintenance-modal-overlay">

          <div className="maintenance-modal">

            <div className="maintenance-modal-header">

              <div>
                <h2><Icon name="clipboard" /> Maintenance History</h2>
                <p>
                  {selectedProject.name} • {selectedProject.location}
                </p>
              </div>

              <button
                className="maintenance-close-btn"
                onClick={closeDetails}
              >
                <Icon name="xmark" />
              </button>

            </div>


            <div className="maintenance-detail-section">

              <h3>
                Previous Maintenance Records
              </h3>

              {(maintenanceHistory[selectedProject.name] || []).length === 0 ? (

                <div className="maintenance-empty">
                  No maintenance records available.
                </div>

              ) : (

                (maintenanceHistory[selectedProject.name] || []).map(
                  (item, index) => (

                    <div
                      className="maintenance-history-item"
                      key={index}
                    >

                      <div className="maintenance-history-top">

                        <div>
                          <strong>{item.title}</strong>

                          <p>
                            {item.category} • {item.date}
                          </p>
                        </div>

                        <span
                          className={
                            item.status === "Completed"
                              ? "task-completed"
                              : "task-pending"
                          }
                        >
                          {item.status === "Completed"
                            ? <><Icon name="check" /> Completed</>
                            : <><Icon name="circle" /> Pending</>}
                        </span>

                      </div>


                      <p className="maintenance-history-description">
                        {item.description}
                      </p>


                      <div className="maintenance-history-meta">

                        <span>
                          Priority: <strong>{item.priority}</strong>
                        </span>

                        <span>
                          Status: <strong>{item.status}</strong>
                        </span>

                      </div>

                    </div>

                  )
                )

              )}

            </div>


            <div className="maintenance-modal-actions">

              <button
                className="secondary-maintenance-btn"
                onClick={() => setShowHistory(false)}
              >
                <Icon name="arrowLeft" /> Back
              </button>

              <button
                className="primary-maintenance-btn"
                onClick={() => {
                  setShowHistory(false);
                  setShowAddMaintenance(true);
                }}
              >
                <Icon name="plus" /> Add Maintenance
              </button>

            </div>

          </div>

        </div>

      )}


      {/* ================================
          ADD MAINTENANCE FORM
      ================================= */}

      {selectedProject && showAddMaintenance && (

        <div className="maintenance-modal-overlay">

          <div className="maintenance-modal">

            <div className="maintenance-modal-header">

              <div>
                <h2><Icon name="plus" /> Add Maintenance</h2>
                <p>
                  {selectedProject.name}
                </p>
              </div>

              <button
                className="maintenance-close-btn"
                onClick={closeDetails}
              >
                <Icon name="xmark" />
              </button>

            </div>


            <form onSubmit={handleAddMaintenance}>

              <div className="maintenance-form-grid">

                <div className="maintenance-form-group">

                  <label>
                    Maintenance Title *
                  </label>

                  <input
                    type="text"
                    name="title"
                    value={formData.title}
                    onChange={handleInputChange}
                    placeholder="e.g. Lift Inspection"
                  />

                </div>


                <div className="maintenance-form-group">

                  <label>
                    Category
                  </label>

                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                  >
                    <option>Maintenance</option>
                    <option>Inspection</option>
                    <option>Repair</option>
                    <option>Safety</option>
                    <option>Electrical</option>
                    <option>Plumbing</option>
                  </select>

                </div>


                <div className="maintenance-form-group">

                  <label>
                    Date *
                  </label>

                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleInputChange}
                  />

                </div>


                <div className="maintenance-form-group">

                  <label>
                    Priority
                  </label>

                  <select
                    name="priority"
                    value={formData.priority}
                    onChange={handleInputChange}
                  >
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                  </select>

                </div>


                <div className="maintenance-form-group">

                  <label>
                    Status
                  </label>

                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleInputChange}
                  >
                    <option>Pending</option>
                    <option>Completed</option>
                    <option>In Progress</option>
                  </select>

                </div>

              </div>


              <div className="maintenance-form-group">

                <label>
                  Description *
                </label>

                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Describe the maintenance work..."
                  rows="4"
                />

              </div>


              <div className="maintenance-modal-actions">

                <button
                  type="button"
                  className="secondary-maintenance-btn"
                  onClick={() => setShowAddMaintenance(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-maintenance-btn"
                >
                  <Icon name="check" /> Save Maintenance
                </button>

              </div>

            </form>

          </div>

        </div>

      )}

    </div>
  );
}

export default PastProjects;