import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { notify } from "./toast";
import "./Inspections.css";

function Inspections({ project, onBack }) {
  const [screen, setScreen] = useState("records");

  const [inspections, setInspections] = useState([
    {
      id: "INS-001",
      site: "ABC Construction",
      building: "Building A",
      floor: "Floor 3",
      type: "Structural",
      inspector: "Rajesh Patil",
      date: "12 Sep 2026",
      result: "Passed",
      issueCount: 0,
    },
    {
      id: "INS-002",
      site: "ABC Construction",
      building: "Building A",
      floor: "Floor 2",
      type: "Electrical",
      inspector: "Amit Sharma",
      date: "10 Sep 2026",
      result: "Failed",
      issueCount: 2,
    },
  ]);

  const [inspection, setInspection] = useState({
    site: project?.name || "ABC Construction",
    building: "",
    floor: "",
    type: "Structural",
    inspector: "",
  });

  const [checklist, setChecklist] = useState([
    {
      id: 1,
      name: "Structural Work",
      result: "",
    },
    {
      id: 2,
      name: "Electrical",
      result: "",
    },
    {
      id: 3,
      name: "Plumbing",
      result: "",
    },
    {
      id: 4,
      name: "Safety",
      result: "",
    },
    {
      id: 5,
      name: "Material Quality",
      result: "",
    },
  ]);

  const [issues, setIssues] = useState([]);

  const [issueForm, setIssueForm] = useState({
    issue: "",
    severity: "Medium",
    location: "",
    description: "",
    responsibleTeam: "",
    inspectionDate: "",
    dueDate: "",
    photo: null,
    photoPreview: "",
    photoDate: "",
    photoTime: "",
    photoLocation: "",
  });

  const [search, setSearch] = useState("");
  const [selectedReport, setSelectedReport] = useState(null);

  // GPS CAMERA
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [cameraLocation, setCameraLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState(
    "Getting GPS location..."
  );

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // -----------------------------
  // START NEW INSPECTION
  // -----------------------------

  const startNewInspection = () => {
    setInspection({
      site: project?.name || "ABC Construction",
      building: "",
      floor: "",
      type: "Structural",
      inspector: "",
    });

    setChecklist([
      { id: 1, name: "Structural Work", result: "" },
      { id: 2, name: "Electrical", result: "" },
      { id: 3, name: "Plumbing", result: "" },
      { id: 4, name: "Safety", result: "" },
      { id: 5, name: "Material Quality", result: "" },
    ]);

    setIssues([]);

    setIssueForm({
      issue: "",
      severity: "Medium",
      location: "",
      description: "",
      responsibleTeam: "",
      inspectionDate: "",
      dueDate: "",
      photo: null,
      photoPreview: "",
      photoDate: "",
      photoTime: "",
      photoLocation: "",
    });

    setScreen("new");
  };

  // -----------------------------
  // GENERAL FORM CHANGE
  // -----------------------------

  const handleInspectionChange = (e) => {
    setInspection({
      ...inspection,
      [e.target.name]: e.target.value,
    });
  };

  // -----------------------------
  // CHECKLIST
  // -----------------------------

  const updateChecklist = (id, result) => {
    setChecklist(
      checklist.map((item) =>
        item.id === id
          ? { ...item, result }
          : item
      )
    );
  };

  // -----------------------------
  // ISSUE FORM
  // -----------------------------

  const handleIssueChange = (e) => {
    setIssueForm({
      ...issueForm,
      [e.target.name]: e.target.value,
    });
  };

  // -----------------------------
  // GET GPS LOCATION
  // -----------------------------

  const getGPSLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error("Geolocation is not supported by this browser.")
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = position.coords.latitude;
          const longitude = position.coords.longitude;

          const location = {
            latitude,
            longitude,
          };

          setCameraLocation(location);
          setLocationStatus(
            `GPS Ready: ${latitude.toFixed(
              6
            )}, ${longitude.toFixed(6)}`
          );

          resolve(location);
        },
        () => {
          reject(
            new Error(
              "Location permission is required to capture GPS photo."
            )
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    });
  };

  // -----------------------------
  // OPEN GPS CAMERA
  // -----------------------------

  const openCamera = async () => {
    try {
      setLocationStatus("Getting GPS location...");

      const location = await getGPSLocation();

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: "environment",
            },
          },
          audio: false,
        });

      setCameraLocation(location);
      setCameraStream(stream);
      setCameraOpen(true);
    } catch (error) {
      notify(
        error.message ||
          "Unable to open camera. Please allow camera and location permissions."
      );
    }
  };

  // -----------------------------
  // CONNECT VIDEO STREAM
  // -----------------------------

  useEffect(() => {
    if (
      cameraOpen &&
      videoRef.current &&
      cameraStream
    ) {
      videoRef.current.srcObject = cameraStream;

      videoRef.current
        .play()
        .catch(() => {});
    }
  }, [cameraOpen, cameraStream]);

  // -----------------------------
  // CLOSE CAMERA
  // -----------------------------

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream
        .getTracks()
        .forEach((track) => track.stop());
    }

    setCameraStream(null);
    setCameraOpen(false);
  };

  // -----------------------------
  // CAMERA CLEANUP
  // -----------------------------

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  // -----------------------------
  // CAPTURE GPS PHOTO
  // -----------------------------

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    if (!cameraLocation) {
      notify("GPS location is not available.");
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    // Draw camera image
    ctx.drawImage(video, 0, 0, width, height);

    const now = new Date();

    const dateText = now.toLocaleDateString(
      "en-IN",
      {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }
    );

    const timeText = now.toLocaleTimeString(
      "en-IN",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }
    );

    const latitude =
      cameraLocation.latitude.toFixed(6);

    const longitude =
      cameraLocation.longitude.toFixed(6);

    // Bottom overlay
    const overlayHeight = Math.min(
      150,
      height * 0.22
    );

    const gradient = ctx.createLinearGradient(
      0,
      height - overlayHeight,
      0,
      height
    );

    gradient.addColorStop(
      0,
      "rgba(0,0,0,0)"
    );

    gradient.addColorStop(
      1,
      "rgba(0,0,0,0.82)"
    );

    ctx.fillStyle = gradient;

    ctx.fillRect(
      0,
      height - overlayHeight,
      width,
      overlayHeight
    );

    // BuildSafe title
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(
      20,
      width * 0.022
    )}px Arial`;

    ctx.fillText(
      "BuildSafe | Inspection Evidence",
      24,
      height - overlayHeight + 35
    );

    // Date
    ctx.font = `${Math.max(
      15,
      width * 0.016
    )}px Arial`;

    ctx.fillText(
      `Date: ${dateText}`,
      24,
      height - overlayHeight + 65
    );

    // Time
    ctx.fillText(
      `Time: ${timeText}`,
      24,
      height - overlayHeight + 92
    );

    // GPS
    ctx.fillText(
      `GPS: ${latitude}, ${longitude}`,
      24,
      height - overlayHeight + 119
    );

    const imageData = canvas.toDataURL(
      "image/jpeg",
      0.92
    );

    setIssueForm({
      ...issueForm,
      photo: imageData,
      photoPreview: imageData,
      photoDate: dateText,
      photoTime: timeText,
      photoLocation: `${latitude}, ${longitude}`,
    });

    closeCamera();
  };

  // -----------------------------
  // ADD ISSUE
  // -----------------------------

  const addIssue = () => {
    if (!issueForm.issue.trim()) {
      notify("Please enter the issue.");
      return;
    }

    if (!issueForm.location.trim()) {
      notify("Please enter the issue location.");
      return;
    }

    if (!issueForm.responsibleTeam) {
      notify(
        "Please select the responsible person / team."
      );
      return;
    }

    if (!issueForm.inspectionDate) {
      notify("Please select inspection date.");
      return;
    }

    if (!issueForm.dueDate) {
      notify("Please select due date.");
      return;
    }

    if (!issueForm.photoPreview) {
      notify(
        "Please capture a GPS camera photo for evidence."
      );
      return;
    }

    const newIssue = {
      id: Date.now(),
      issue: issueForm.issue,
      severity: issueForm.severity,
      location: issueForm.location,
      description: issueForm.description,
      responsibleTeam:
        issueForm.responsibleTeam,
      inspectionDate:
        issueForm.inspectionDate,
      dueDate: issueForm.dueDate,
      photo: issueForm.photo,
      photoPreview:
        issueForm.photoPreview,
      photoDate:
        issueForm.photoDate,
      photoTime:
        issueForm.photoTime,
      photoLocation:
        issueForm.photoLocation,
    };

    setIssues([
      ...issues,
      newIssue,
    ]);

    setIssueForm({
      issue: "",
      severity: "Medium",
      location: "",
      description: "",
      responsibleTeam: "",
      inspectionDate: "",
      dueDate: "",
      photo: null,
      photoPreview: "",
      photoDate: "",
      photoTime: "",
      photoLocation: "",
    });
  };

  // -----------------------------
  // REMOVE ISSUE
  // -----------------------------

  const removeIssue = (id) => {
    setIssues(
      issues.filter(
        (item) => item.id !== id
      )
    );
  };

  // -----------------------------
  // SUBMIT INSPECTION
  // -----------------------------

  const submitInspection = (e) => {
    e.preventDefault();

    if (
      !inspection.building ||
      !inspection.floor ||
      !inspection.inspector
    ) {
      notify(
        "Please complete Site, Building, Floor and Inspector."
      );
      return;
    }

    const incompleteChecklist =
      checklist.some(
        (item) => !item.result
      );

    if (incompleteChecklist) {
      notify(
        "Please complete all checklist items."
      );
      return;
    }

    const failedItems =
      checklist.filter(
        (item) =>
          item.result === "Fail"
      );

    const observationItems =
      checklist.filter(
        (item) =>
          item.result ===
          "Observation"
      );

    let result = "Passed";

    if (
      failedItems.length > 0 ||
      issues.length > 0
    ) {
      result = "Failed";
    } else if (
      observationItems.length > 0
    ) {
      result = "Observation";
    }

    // Use issue inspection date as report date
    const reportDate =
      issues.length > 0
        ? new Date(
            issues[0].inspectionDate
          ).toLocaleDateString(
            "en-GB",
            {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }
          )
        : new Date().toLocaleDateString(
            "en-GB",
            {
              day: "2-digit",
              month: "short",
              year: "numeric",
            }
          );

    const newInspection = {
      id: `INS-${String(
        inspections.length + 1
      ).padStart(3, "0")}`,

      site: inspection.site,

      building:
        inspection.building,

      floor:
        inspection.floor,

      type:
        inspection.type,

      inspector:
        inspection.inspector,

      date:
        reportDate,

      result,

      issueCount:
        issues.length,

      details: {
        ...inspection,

        checklist: [
          ...checklist,
        ],

        issues: [
          ...issues,
        ],
      },
    };

    setInspections([
      ...inspections,
      newInspection,
    ]);

    setSelectedReport(
      newInspection
    );

    setScreen("report");
  };

  // -----------------------------
  // FILTER
  // -----------------------------

  const filteredInspections =
    inspections.filter((item) =>
      `${item.id} ${item.site} ${item.building} ${item.floor} ${item.type} ${item.inspector} ${item.result}`
        .toLowerCase()
        .includes(
          search.toLowerCase()
        )
    );

  // -----------------------------
  // RECORDS SCREEN
  // -----------------------------

  if (screen === "records") {
    const total =
      inspections.length;

    const passed =
      inspections.filter(
        (i) =>
          i.result === "Passed"
      ).length;

    const failed =
      inspections.filter(
        (i) =>
          i.result === "Failed"
      ).length;

    const observations =
      inspections.filter(
        (i) =>
          i.result ===
          "Observation"
      ).length;

    return (
      <div className="inspections-page">

        <div className="inspections-header">

          <div>

            <button
              className="back-project-btn"
              onClick={onBack}
            >
              ← Back to Project
            </button>

            <h1>
              <Icon name="check" /> Inspections
            </h1>

            <p>
              {project?.name ||
                "Construction Project"}{" "}
              • Conduct site inspections
              and generate inspection
              reports
            </p>

          </div>

          <button
            className="primary-btn inspection-new-btn"
            onClick={
              startNewInspection
            }
          >
            + New Inspection
          </button>

        </div>


        {/* SUMMARY */}

        <div className="inspection-summary">

          <div className="inspection-stat">

            <div className="inspection-stat-icon">
              <Icon name="clipboard" />
            </div>

            <span>
              Total Inspections
            </span>

            <strong>
              {total}
            </strong>

          </div>


          <div className="inspection-stat passed-card">

            <div className="inspection-stat-icon">
              <Icon name="check" />
            </div>

            <span>
              Passed
            </span>

            <strong>
              {passed}
            </strong>

          </div>


          <div className="inspection-stat failed-card">

            <div className="inspection-stat-icon">
              <Icon name="xmark" />
            </div>

            <span>
              Failed
            </span>

            <strong>
              {failed}
            </strong>

          </div>


          <div className="inspection-stat observation-card">

            <div className="inspection-stat-icon">
              <Icon name="alert" />
            </div>

            <span>
              Observations
            </span>

            <strong>
              {observations}
            </strong>

          </div>

        </div>


        {/* RECORDS */}

        <div className="inspection-card">

          <div className="inspection-card-header">

            <div>

              <h2>
                Inspection Records
              </h2>

              <p>
                View completed and submitted
                inspections
              </p>

            </div>

            <input
              className="inspection-search"
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search inspections..."
            />

          </div>


          <div className="inspection-table">

            <div className="inspection-row inspection-heading">

              <span>ID</span>
              <span>
                Site / Location
              </span>
              <span>Type</span>
              <span>Inspector</span>
              <span>Date</span>
              <span>Result</span>
              <span>Action</span>

            </div>


            {filteredInspections.map(
              (item) => (

                <div
                  className="inspection-row"
                  key={item.id}
                >

                  <strong className="inspection-id">
                    {item.id}
                  </strong>


                  <div className="inspection-location">

                    <strong>
                      {item.building}
                    </strong>

                    <small>
                      {item.floor}
                    </small>

                  </div>


                  <span>
                    {item.type}
                  </span>


                  <span>
                    {item.inspector}
                  </span>


                  <span>
                    {item.date}
                  </span>


                  <span
                    className={`inspection-result ${item.result.toLowerCase()}`}
                  >
                    {item.result}
                  </span>


                  <button
                    className="view-report-btn"
                    onClick={() => {
                      setSelectedReport(
                        item
                      );

                      setScreen(
                        "report"
                      );
                    }}
                  >
                    View Report
                  </button>

                </div>

              )
            )}

          </div>

        </div>

      </div>
    );
  }


  // -----------------------------
  // NEW INSPECTION SCREEN
  // -----------------------------

  if (screen === "new") {
    return (
      <div className="inspections-page">

        <div className="inspection-form-header">

          <div>

            <button
              className="back-project-btn"
              onClick={() =>
                setScreen(
                  "records"
                )
              }
            >
              ← Back to Inspections
            </button>

            <h1>
              New Inspection
            </h1>

            <p>
              Complete site details,
              checklist and inspection
              findings
            </p>

          </div>

          <div className="inspection-step-badge">
            Step 1 → Inspection Details
          </div>

        </div>


        <form
          onSubmit={
            submitInspection
          }
        >

          {/* SITE DETAILS */}

          <div className="inspection-card">

            <div className="inspection-card-header">

              <div>

                <h2>
                  1. Site & Inspection
                  Details
                </h2>

                <p>
                  Select the exact
                  construction location
                </p>

              </div>

            </div>


            <div className="inspection-form-grid">

              <div className="inspection-form-group">

                <label>
                  Site
                </label>

                <select
                  name="site"
                  value={
                    inspection.site
                  }
                  onChange={
                    handleInspectionChange
                  }
                >

                  <option>
                    {project?.name ||
                      "ABC Construction"}
                  </option>

                  <option>
                    ABC Construction
                  </option>

                  <option>
                    Green Valley Tower
                  </option>

                  <option>
                    Sunrise Residency
                  </option>

                </select>

              </div>


              <div className="inspection-form-group">

                <label>
                  Building
                </label>

                <select
                  name="building"
                  value={
                    inspection.building
                  }
                  onChange={
                    handleInspectionChange
                  }
                >

                  <option value="">
                    Select Building
                  </option>

                  <option>
                    Building A
                  </option>

                  <option>
                    Building B
                  </option>

                  <option>
                    Building C
                  </option>

                </select>

              </div>


              <div className="inspection-form-group">

                <label>
                  Floor
                </label>

                <select
                  name="floor"
                  value={
                    inspection.floor
                  }
                  onChange={
                    handleInspectionChange
                  }
                >

                  <option value="">
                    Select Floor
                  </option>

                  <option>
                    Basement
                  </option>

                  <option>
                    Ground Floor
                  </option>

                  <option>
                    Floor 1
                  </option>

                  <option>
                    Floor 2
                  </option>

                  <option>
                    Floor 3
                  </option>

                  <option>
                    Floor 4
                  </option>

                  <option>
                    Floor 5
                  </option>

                  <option>
                    Terrace
                  </option>

                </select>

              </div>


              <div className="inspection-form-group">

                <label>
                  Inspection Type
                </label>

                <select
                  name="type"
                  value={
                    inspection.type
                  }
                  onChange={
                    handleInspectionChange
                  }
                >

                  <option>
                    Structural
                  </option>

                  <option>
                    Electrical
                  </option>

                  <option>
                    Plumbing
                  </option>

                  <option>
                    Safety
                  </option>

                  <option>
                    Material Quality
                  </option>

                  <option>
                    General
                  </option>

                </select>

              </div>


              <div className="inspection-form-group">

                <label>
                  Inspector
                </label>

                <input
                  name="inspector"
                  value={
                    inspection.inspector
                  }
                  onChange={
                    handleInspectionChange
                  }
                  placeholder="Enter inspector name"
                />

              </div>

            </div>

          </div>


          {/* CHECKLIST */}

          <div className="inspection-card">

            <div className="inspection-card-header">

              <div>

                <h2>
                  2. Inspection Checklist
                </h2>

                <p>
                  Mark each construction
                  category
                </p>

              </div>

            </div>


            <div className="checklist-container">

              {checklist.map(
                (item) => (

                  <div
                    className="checklist-row"
                    key={item.id}
                  >

                    <div className="checklist-name">

                      <span className="checklist-number">
                        {item.id}
                      </span>

                      <strong>
                        {item.name}
                      </strong>

                    </div>


                    <div className="checklist-options">

                      <button
                        type="button"
                        className={
                          item.result ===
                          "Pass"
                            ? "check-option pass active"
                            : "check-option pass"
                        }
                        onClick={() =>
                          updateChecklist(
                            item.id,
                            "Pass"
                          )
                        }
                      >
                        <Icon name="check" /> Pass
                      </button>


                      <button
                        type="button"
                        className={
                          item.result ===
                          "Fail"
                            ? "check-option fail active"
                            : "check-option fail"
                        }
                        onClick={() =>
                          updateChecklist(
                            item.id,
                            "Fail"
                          )
                        }
                      >
                        <Icon name="xmark" /> Fail
                      </button>


                      <button
                        type="button"
                        className={
                          item.result ===
                          "Observation"
                            ? "check-option observation active"
                            : "check-option observation"
                        }
                        onClick={() =>
                          updateChecklist(
                            item.id,
                            "Observation"
                          )
                        }
                      >
                        <Icon name="alert" /> Observation
                      </button>

                    </div>

                  </div>

                )
              )}

            </div>

          </div>


          {/* ADD ISSUE */}

          <div className="inspection-card">

            <div className="inspection-card-header">

              <div>

                <h2>
                  3. Add Issue /
                  Observation
                </h2>

                <p>
                  Record any problem found
                  during inspection
                </p>

              </div>

            </div>


            <div className="issue-form">


              {/* ISSUE */}

              <div className="inspection-form-group">

                <label>
                  Issue
                </label>

                <input
                  name="issue"
                  value={
                    issueForm.issue
                  }
                  onChange={
                    handleIssueChange
                  }
                  placeholder="Example: Wall Crack"
                />

              </div>


              {/* SEVERITY */}

              <div className="inspection-form-group">

                <label>
                  Severity
                </label>

                <select
                  name="severity"
                  value={
                    issueForm.severity
                  }
                  onChange={
                    handleIssueChange
                  }
                >

                  <option>
                    Low
                  </option>

                  <option>
                    Medium
                  </option>

                  <option>
                    High
                  </option>

                  <option>
                    Critical
                  </option>

                </select>

              </div>


              {/* LOCATION */}

              <div className="inspection-form-group">

                <label>
                  Issue Location
                </label>

                <input
                  name="location"
                  value={
                    issueForm.location
                  }
                  onChange={
                    handleIssueChange
                  }
                  placeholder="Example: Floor 3 - Room 302"
                />

              </div>


              {/* RESPONSIBLE TEAM */}

              <div className="inspection-form-group">

                <label>
                  Responsible Person /
                  Team
                </label>

                <select
                  name="responsibleTeam"
                  value={
                    issueForm.responsibleTeam
                  }
                  onChange={
                    handleIssueChange
                  }
                >

                  <option value="">
                    Select responsible
                    person / team
                  </option>

                  <option>
                    Civil Team
                  </option>

                  <option>
                    Electrical Team
                  </option>

                  <option>
                    Plumbing Team
                  </option>

                  <option>
                    Safety Officer
                  </option>

                  <option>
                    Site Supervisor
                  </option>

                  <option>
                    Project Manager
                  </option>

                </select>

              </div>


              {/* INSPECTION DATE */}

              <div className="inspection-form-group">

                <label>
                  Inspection Date
                </label>

                <input
                  type="date"
                  name="inspectionDate"
                  value={
                    issueForm.inspectionDate
                  }
                  onChange={
                    handleIssueChange
                  }
                />

              </div>


              {/* DUE DATE */}

              <div className="inspection-form-group">

                <label>
                  Due Date
                </label>

                <input
                  type="date"
                  name="dueDate"
                  value={
                    issueForm.dueDate
                  }
                  onChange={
                    handleIssueChange
                  }
                />

              </div>


              {/* DESCRIPTION */}

              <div className="inspection-form-group full-width">

                <label>
                  Description
                </label>

                <textarea
                  name="description"
                  value={
                    issueForm.description
                  }
                  onChange={
                    handleIssueChange
                  }
                  placeholder="Describe the issue observed on site..."
                  rows="4"
                />

              </div>


              {/* GPS CAMERA */}

              <div className="inspection-camera-section">

                <div className="inspection-camera-header">

                  <div>

                    <h3>
                      <Icon name="camera" /> GPS Photo Evidence
                    </h3>

                    <p>
                      Capture photo directly
                      from the camera with
                      date, time and GPS
                      location.
                    </p>

                  </div>

                </div>


                <div className="inspection-camera-status">

                  <Icon name="location" /> {locationStatus}

                </div>


                {!issueForm.photoPreview && (
                  <button
                    type="button"
                    className="primary-btn gps-camera-btn"
                    onClick={openCamera}
                  >
                    <Icon name="camera" /> Open GPS Camera
                  </button>
                )}


                {issueForm.photoPreview && (

                  <div className="inspection-photo-result">

                    <img
                      src={
                        issueForm.photoPreview
                      }
                      alt="GPS inspection evidence"
                    />


                    <div className="inspection-photo-meta">

                      <div>
                        <Icon name="calendar" />{" "}
                        <strong>
                          Date:
                        </strong>{" "}
                        {
                          issueForm.photoDate
                        }
                      </div>

                      <div>
                        <Icon name="clock" />{" "}
                        <strong>
                          Time:
                        </strong>{" "}
                        {
                          issueForm.photoTime
                        }
                      </div>

                      <div>
                        <Icon name="location" />{" "}
                        <strong>
                          GPS:
                        </strong>{" "}
                        {
                          issueForm.photoLocation
                        }
                      </div>

                    </div>


                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={openCamera}
                    >
                      <Icon name="rotate" /> Retake GPS Photo
                    </button>

                  </div>

                )}

              </div>


              {/* HIDDEN CANVAS */}

              <canvas
                ref={canvasRef}
                style={{
                  display: "none",
                }}
              />


              {/* ADD ISSUE BUTTON */}

              <div className="issue-add-action">

                <button
                  type="button"
                  className="secondary-btn"
                  onClick={addIssue}
                >
                  + Add Issue
                </button>

              </div>

            </div>


            {/* ADDED ISSUES */}

            {issues.length > 0 && (

              <div className="added-issues">

                <h3>
                  Added Issues (
                  {issues.length}
                  )
                </h3>


                {issues.map(
                  (item) => (

                    <div
                      className="issue-item"
                      key={item.id}
                    >

                      <div className="issue-item-main">

                        <div>

                          <strong>
                            {item.issue}
                          </strong>

                          <p>
                            <Icon name="location" />{" "}
                            {item.location}
                          </p>

                          <p>
                            <Icon name="user" />{" "}
                            {item.responsibleTeam}
                          </p>

                          <p>
                            <Icon name="calendar" /> Inspection:{" "}
                            {item.inspectionDate}
                          </p>

                          <p>
                            <Icon name="clock" /> Due:{" "}
                            {item.dueDate}
                          </p>

                          <small>
                            {item.description ||
                              "No description added"}
                          </small>

                        </div>


                        <span
                          className={`severity-badge ${item.severity.toLowerCase()}`}
                        >
                          {item.severity}
                        </span>

                      </div>


                      {item.photoPreview && (

                        <div className="issue-photo-with-meta">

                          <img
                            className="issue-thumbnail"
                            src={
                              item.photoPreview
                            }
                            alt="GPS inspection evidence"
                          />

                          <div className="issue-photo-meta">

                            <Icon name="calendar" />{" "}
                            {item.photoDate}
                            {"  •  "}
                            <Icon name="clock" />{" "}
                            {item.photoTime}
                            <br />

                            <Icon name="location" />{" "}
                            {item.photoLocation}

                          </div>

                        </div>

                      )}


                      <button
                        type="button"
                        className="remove-issue-btn"
                        onClick={() =>
                          removeIssue(
                            item.id
                          )
                        }
                      >
                        Remove
                      </button>

                    </div>

                  )
                )}

              </div>

            )}

          </div>


          {/* SUBMIT */}

          <div className="inspection-submit-bar">

            <button
              type="button"
              className="cancel-btn"
              onClick={() =>
                setScreen(
                  "records"
                )
              }
            >
              Cancel
            </button>


            <button
              type="submit"
              className="primary-btn submit-inspection-btn"
            >
              Submit Inspection →
            </button>

          </div>

        </form>


        {/* CAMERA MODAL */}

        {cameraOpen && (

          <div className="inspection-camera-overlay">

            <div className="inspection-camera-modal">

              <div className="inspection-camera-modal-header">

                <div>

                  <h2>
                    <Icon name="camera" /> GPS Camera
                  </h2>

                  <p>
                    Capture inspection
                    evidence
                  </p>

                </div>

                <button
                  type="button"
                  className="camera-close-btn"
                  onClick={
                    closeCamera
                  }
                >
                  <Icon name="xmark" />
                </button>

              </div>


              <div className="camera-location-live">

                <Icon name="location" />{" "}
                {cameraLocation
                  ? `${cameraLocation.latitude.toFixed(
                      6
                    )}, ${cameraLocation.longitude.toFixed(
                      6
                    )}`
                  : "Getting GPS..."}

              </div>


              <video
                ref={videoRef}
                className="inspection-camera-video"
                autoPlay
                playsInline
                muted
              />


              <div className="inspection-camera-actions">

                <button
                  type="button"
                  className="cancel-btn"
                  onClick={
                    closeCamera
                  }
                >
                  Cancel
                </button>


                <button
                  type="button"
                  className="primary-btn capture-camera-btn"
                  onClick={
                    capturePhoto
                  }
                >
                  <Icon name="camera" /> Capture Photo
                </button>

              </div>

            </div>

          </div>

        )}

      </div>
    );
  }


  // -----------------------------
  // REPORT SCREEN
  // -----------------------------

  if (
    screen === "report" &&
    selectedReport
  ) {
    const report =
      selectedReport.details || {
        site:
          selectedReport.site,
        building:
          selectedReport.building,
        floor:
          selectedReport.floor,
        type:
          selectedReport.type,
        inspector:
          selectedReport.inspector,
        date:
          selectedReport.date,
        checklist: [],
        issues: [],
      };

    return (
      <div className="inspections-page">

        <div className="report-header">

          <div>

            <button
              className="back-project-btn"
              onClick={() =>
                setScreen(
                  "records"
                )
              }
            >
              ← Back to Inspections
            </button>

            <h1>
              Inspection Report
            </h1>

            <p>
              Automatically generated
              inspection summary
            </p>

          </div>

          <div className="report-id">
            {selectedReport.id}
          </div>

        </div>


        {/* REPORT SUMMARY */}

        <div className="report-hero">

          <div>

            <span className="report-label">
              INSPECTION RESULT
            </span>

            <h2>
              {selectedReport.result}
            </h2>

            <p>
              {report.site} →{" "}
              {report.building} →{" "}
              {report.floor}
            </p>

          </div>


          <div
            className={`large-report-result ${selectedReport.result.toLowerCase()}`}
          >
            {selectedReport.result ===
            "Passed"
              ? (<Icon name="check" />)
              : selectedReport.result ===
                "Failed"
              ? (<Icon name="xmark" />)
              : (<Icon name="alert" />)}
          </div>

        </div>


        {/* INFO */}

        <div className="report-grid">

          <div className="report-info-card">
            <span>Site</span>
            <strong>
              {report.site}
            </strong>
          </div>

          <div className="report-info-card">
            <span>Building</span>
            <strong>
              {report.building}
            </strong>
          </div>

          <div className="report-info-card">
            <span>Floor</span>
            <strong>
              {report.floor}
            </strong>
          </div>

          <div className="report-info-card">
            <span>
              Inspection Type
            </span>
            <strong>
              {report.type}
            </strong>
          </div>

          <div className="report-info-card">
            <span>Inspector</span>
            <strong>
              {report.inspector}
            </strong>
          </div>

        </div>


        {/* CHECKLIST REPORT */}

        <div className="inspection-card">

          <div className="inspection-card-header">

            <div>

              <h2>
                Inspection Checklist
              </h2>

              <p>
                Results recorded during
                site inspection
              </p>

            </div>

          </div>


          {report.checklist &&
          report.checklist.length >
            0 ? (

            <div className="report-checklist">

              {report.checklist.map(
                (item) => (

                  <div
                    className="report-check-row"
                    key={item.id}
                  >

                    <strong>
                      {item.name}
                    </strong>

                    <span
                      className={`check-result ${item.result.toLowerCase()}`}
                    >
                      {item.result ===
                      "Pass"
                        ? (<><Icon name="check" /> Pass</>)
                        : item.result ===
                          "Fail"
                        ? (<><Icon name="xmark" /> Fail</>)
                        : (<><Icon name="alert" /> Observation</>)}
                    </span>

                  </div>

                )
              )}

            </div>

          ) : (

            <p className="empty-report">
              No checklist details
              available.
            </p>

          )}

        </div>


        {/* ISSUES REPORT */}

        <div className="inspection-card">

          <div className="inspection-card-header">

            <div>

              <h2>
                Issues & Observations
              </h2>

              <p>
                Problems recorded during
                inspection
              </p>

            </div>

            <strong className="issue-count">
              {report.issues?.length ||
                0}{" "}
              Issues
            </strong>

          </div>


          {report.issues &&
          report.issues.length >
            0 ? (

            <div className="report-issues">

              {report.issues.map(
                (item) => (

                  <div
                    className="report-issue"
                    key={item.id}
                  >

                    <div className="report-issue-content">

                      <div className="report-issue-title">

                        <strong>
                          {item.issue}
                        </strong>

                        <span
                          className={`severity-badge ${item.severity.toLowerCase()}`}
                        >
                          {item.severity}
                        </span>

                      </div>


                      <p>
                        <Icon name="location" />{" "}
                        {item.location}
                      </p>


                      <p>
                        <Icon name="user" /> Responsible:{" "}
                        {item.responsibleTeam}
                      </p>


                      <p>
                        <Icon name="calendar" /> Inspection Date:{" "}
                        {item.inspectionDate}
                      </p>


                      <p>
                        <Icon name="clock" /> Due Date:{" "}
                        {item.dueDate}
                      </p>


                      <small>
                        {item.description ||
                          "No description provided."}
                      </small>

                    </div>


                    {item.photoPreview && (

                      <div className="report-photo-wrapper">

                        <img
                          className="report-photo"
                          src={
                            item.photoPreview
                          }
                          alt="GPS inspection evidence"
                        />

                        <div className="report-photo-meta">

                          <Icon name="calendar" />{" "}
                          {item.photoDate}
                          {" • "}
                          <Icon name="clock" />{" "}
                          {item.photoTime}

                          <br />

                          <Icon name="location" />{" "}
                          {item.photoLocation}

                        </div>

                      </div>

                    )}

                  </div>

                )
              )}

            </div>

          ) : (

            <div className="no-report-issues">
              <Icon name="check" /> No issues were recorded
              during this inspection.
            </div>

          )}

        </div>


        {/* REPORT FOOTER */}

        <div className="report-footer">

          <div>

            <strong>
              Inspection Report
              Generated
            </strong>

            <p>
              This report was
              automatically generated
              from the submitted
              inspection data.
            </p>

          </div>


          <button
            className="primary-btn"
            onClick={() =>
              window.print()
            }
          >
            <Icon name="print" /> Print / Save Report
          </button>

        </div>

      </div>
    );
  }

  return null;
}

export default Inspections;