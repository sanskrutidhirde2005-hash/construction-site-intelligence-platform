import { useEffect, useRef, useState } from "react";
import "./SiteVisionAI.css";
import {
  summarizeImageAnalysis,
  validateImageFile,
  visionErrorMessage,
  ZONE_PRESETS,
} from "./siteVision";
import { formatLatLon, parseExifFromFile } from "./exif";
import { Icon } from "./icons";
import PendingIncidentCard from "./PendingIncidentCard";

function SiteVisionAI({ project, onBack }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState("Site");
  // Supervisor sign-off — the human-in-the-loop step that closes the
  // site-evidence loop (frontend register until a backend table lands).
  const [signedBy, setSignedBy] = useState("");
  const [signedAt, setSignedAt] = useState(null);
  // Camera-first capture: live getUserMedia replaces the file picker as the
  // primary path. File input stays as a fallback (desktop / no camera).
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  // Device GPS at capture time. Requested fresh on every open/capture/analyze
  // (maximumAge: 0) so a missing fix re-prompts instead of silently sticking.
  const [gps, setGps] = useState({ lat: null, lon: null, status: "idle", message: "" });
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);

  const stopCamera = () => {
    try {
      streamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const requestGPS = () =>
    new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        setGps({ lat: null, lon: null, status: "unavailable", message: "GPS not supported on this device." });
        resolve(null);
        return;
      }
      setGps((p) => ({ ...p, status: "requesting", message: "Requesting GPS permission…" }));
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            status: "granted",
            message: "",
          };
          setGps(fix);
          resolve(fix);
        },
        (err) => {
          const denied = err?.code === 1;
          const fix = {
            lat: null,
            lon: null,
            status: denied ? "denied" : "unavailable",
            message: denied
              ? "GPS permission denied — allow location for this site and tap Retry GPS."
              : "Could not get GPS fix — try again in the open.",
          };
          setGps(fix);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });

  const openCamera = async () => {
    setCameraError("");
    setError("");
    // Ask for GPS on every open so a missing fix re-prompts.
    requestGPS();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is not supported here — choose a file below instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      // Attach on next paint — video element mounts with cameraActive.
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
      });
    } catch {
      setCameraError("Camera blocked or unavailable — allow camera access or choose a file below.");
    }
  };

  const closeCamera = () => {
    stopCamera();
    setCameraActive(false);
  };

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError("Camera is still starting — wait a second and tap Capture again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) {
      setCameraError("Could not capture that frame — try again.");
      return;
    }
    const file = new File([blob], `site-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(URL.createObjectURL(file));
    setAnalysis(null);
    setSignedAt(null);
    setError("");
    closeCamera();
    // No fix yet → ask again right after capture, before analysis.
    setGps((p) => {
      if (p.lat == null) requestGPS();
      return p;
    });
  };

  // Revoke object URLs — the old code leaked one per uploaded photo.
  // Also never leave the camera stream open on unmount / navigation.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
      try {
        streamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
    };
  }, [preview]);

  const handleImageChange = async (e) => {
    const file = e.target.files[0];

    if (!file) return;

    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(URL.createObjectURL(file));
    setAnalysis(null);
    setSignedAt(null);
    setError("");
    // File fallback carries no live fix — prefer the photo's own EXIF GPS
    // when present, else ask for device GPS each time it is missing.
    try {
      const exif = await parseExifFromFile(file);
      if (exif?.lat != null && exif?.lon != null) {
        setGps({ lat: exif.lat, lon: exif.lon, status: "granted", message: "" });
      } else {
        setGps((p) => {
          if (p.lat == null) requestGPS();
          return p;
        });
      }
    } catch {
      setGps((p) => {
        if (p.lat == null) requestGPS();
        return p;
      });
    }
  };

  const analyzeImage = async () => {
    if (!image) {
      setError("Please upload a construction site image first.");
      return;
    }

    setAnalyzing(true);
    setAnalysis(null);
    setSignedAt(null);
    setError("");

    // Real inference against YOLOv8-PPE (fail-safe legacy fallback).
    try {
      // GPS is evidence, not decoration: if we still have no fix, ask again
      // right before upload so each analysis re-prompts when missing.
      let fix = gps;
      if (fix.lat == null || fix.lon == null) {
        const fresh = await requestGPS();
        if (fresh) fix = { ...gps, ...fresh };
      }
      const form = new FormData();
      form.append("image", image);
      form.append("project_id", String(project?.id || 1));
      form.append("area", area || "Site");
      form.append("photo_taken_at", new Date().toISOString());
      if (fix.lat != null && fix.lon != null) {
        form.append("photo_lat", String(fix.lat));
        form.append("photo_lon", String(fix.lon));
        form.append("provenance_source", "device");
        form.append("device_coords", formatLatLon(fix.lat, fix.lon) || "");
      }

      const res = await fetch("/api/vision/analyze-image", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(await visionErrorMessage(res, "Photo analysis failed"));
      }
      const data = await res.json();

      setAnalysis({ ...summarizeImageAnalysis(data), zone: area || "Site" });
    } catch (err) {
      setError(err.message);
    }

    setAnalyzing(false);
  };

  const clearAnalysis = () => {
    if (preview) URL.revokeObjectURL(preview);
    closeCamera();
    if (fileInputRef.current) fileInputRef.current.value = "";
    setImage(null);
    setPreview("");
    setAnalysis(null);
    setSignedAt(null);
    setError("");
    setCameraError("");
  };

  return (
    <div className="sitevision-page">

      {/* HEADER */}

      <div className="sitevision-header">

        <div>
          <button
            className="back-project-btn"
            onClick={onBack}
          >
            <Icon name="arrowLeft" /> Back to Project
          </button>

          <h1><Icon name="eye" /> SiteVision AI</h1>

          <p>
            {project?.name || "Construction Project"} •
            AI-powered construction site image analysis
          </p>
        </div>

      </div>


      {/* INTRO */}

      <div className="sitevision-intro">

        <div className="sitevision-intro-icon">
          <Icon name="bot" />
        </div>

        <div>
          <h2>AI Construction Site Analysis</h2>

          <p>
            Upload a site image and analyze it for potential
            safety risks, construction conditions and site
            observations.
          </p>
        </div>

      </div>


      {/* UPLOAD + PREVIEW */}

      <div className="sitevision-grid">

        <div className="sitevision-card">

          <div className="sitevision-card-header">

            <div>
              <h2><Icon name="upload" /> Capture Site Photo</h2>

              <p>
                Open the camera, capture a site photo — GPS is stamped on analysis.
              </p>
            </div>

          </div>

          {!preview ? (
            cameraActive ? (
              <div className="camera-live">
                <video
                  ref={videoRef}
                  className="camera-video"
                  autoPlay
                  playsInline
                  muted
                />
                <div className="camera-actions">
                  <button
                    type="button"
                    className="analyze-ai-btn camera-capture"
                    onClick={capturePhoto}
                  >
                    <Icon name="camera" /> Capture Photo
                  </button>
                  <button
                    type="button"
                    className="change-image-btn"
                    onClick={closeCamera}
                  >
                    Cancel
                  </button>
                </div>
                {cameraError && (
                  <p className="camera-error" role="alert">{cameraError}</p>
                )}
                <p className="gps-line" aria-live="polite">
                  {gps.status === "granted" && gps.lat != null
                    ? `GPS locked: ${formatLatLon(gps.lat, gps.lon)}`
                    : gps.status === "requesting"
                      ? "Requesting GPS permission…"
                      : gps.message || "GPS will be asked when capturing."}{" "}
                  {(gps.lat == null) && gps.status !== "requesting" && (
                    <button type="button" className="link-button" onClick={requestGPS}>
                      Retry GPS
                    </button>
                  )}
                </p>
              </div>
            ) : (
              <div className="upload-area camera-first">
                <div className="upload-icon">
                  <Icon name="camera" />
                </div>

                <h3>
                  Capture From Camera
                </h3>

                <p>
                  Opens your camera — GPS permission is asked on every capture.
                </p>

                <button
                  type="button"
                  className="analyze-ai-btn camera-open"
                  onClick={openCamera}
                >
                  <Icon name="camera" /> Open Camera
                </button>

                {cameraError && (
                  <p className="camera-error" role="alert">{cameraError}</p>
                )}

                <p className="gps-line" aria-live="polite">
                  {gps.status === "granted" && gps.lat != null
                    ? `GPS locked: ${formatLatLon(gps.lat, gps.lon)}`
                    : gps.status === "requesting"
                      ? "Requesting GPS permission…"
                      : gps.message || "No GPS fix yet — it will be requested."}{" "}
                  {(gps.lat == null) && gps.status !== "requesting" && gps.message && (
                    <button type="button" className="link-button" onClick={requestGPS}>
                      Retry GPS
                    </button>
                  )}
                </p>

                <label className="file-fallback">
                  Or choose from files
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    onChange={handleImageChange}
                  />
                </label>
              </div>
            )

          ) : (

            <div className="image-preview-container">

              <img
                src={preview}
                alt="Construction site"
                className="site-image-preview"
              />

              <p className="gps-line" aria-live="polite">
                {gps.status === "granted" && gps.lat != null
                  ? `GPS stamped: ${formatLatLon(gps.lat, gps.lon)}`
                  : `No GPS fix yet — permission will be asked again on Analyze.`}{" "}
                {(gps.lat == null) && (
                  <button type="button" className="link-button" onClick={requestGPS}>
                    Retry GPS
                  </button>
                )}
              </p>

              <div className="preview-actions">
                <button
                  className="change-image-btn"
                  onClick={clearAnalysis}
                >
                  <Icon name="rotate" /> Retake (Camera)
                </button>
              </div>

            </div>

          )}

          <div style={{ marginBottom: "12px" }}>
            <label style={{ fontSize: "12px", color: "#64748b" }}>
              Site zone (filed on the observation record)
            </label>
            <br />
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="e.g. Tower A · Floor 4"
              style={{
                padding: "8px 10px",
                borderRadius: "8px",
                border: "1px solid #d1d5db",
                marginTop: "4px",
                width: "100%",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                marginTop: "6px",
              }}
            >
              {ZONE_PRESETS.map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => setArea(z)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: "999px",
                    border: area === z
                      ? "1px solid #f59e0b"
                      : "1px solid #d1d5db",
                    background: area === z ? "#fffbeb" : "#fff",
                    cursor: "pointer",
                    fontSize: "12px",
                  }}
                >
                  {z}
                </button>
              ))}
            </div>
          </div>

          <button
            className="analyze-ai-btn"
            onClick={analyzeImage}
            disabled={!image || analyzing}
          >

            {analyzing
              ? <><Icon name="rotate" /> AI Analyzing...</>
              : <><Icon name="bot" /> Analyze With AI</>}

          </button>

          {error && (
            <p style={{ color: "#dc2626", marginTop: "12px" }}>{error}</p>
          )}

        </div>


        {/* AI STATUS */}

        <div className="sitevision-card">

          <div className="sitevision-card-header">

            <div>
              <h2><Icon name="sparkles" /> AI Analysis</h2>

              <p>
                Intelligent site observations
              </p>
            </div>

          </div>

          {!analysis && !analyzing && (

            <div className="empty-ai-state">

              <div>
                <Icon name="search" />
              </div>

              <h3>
                No Analysis Yet
              </h3>

              <p>
                Upload an image and click
                <b> Analyze With AI </b>
                to start analysis.
              </p>

            </div>

          )}

          {analyzing && (

            <div className="analyzing-state">

              <div className="ai-spinner">
                AI
              </div>

              <h3>
                Analyzing Construction Image...
              </h3>

              <p>
                Detecting site objects and potential risks.
              </p>

              <div className="analysis-progress">
                <div></div>
              </div>

            </div>

          )}

          {analysis && (

            <div className="analysis-result">

              {analysis.degraded && (
                <p style={{ background: "#fef3c7", color: "#92400e", padding: "10px 12px", borderRadius: "1px" }}>
                   <Icon name="alert" /> Provisional result — vision model degraded (legacy fallback). Do not treat as SAFE without human review.
                </p>
              )}

              {analysis.annotatedUrl && (
                <div style={{ marginBottom: "12px" }}>
                  <img
                    src={analysis.annotatedUrl}
                    alt="Annotated site photo with helmet detections"
                    style={{ width: "100%", borderRadius: "1px" }}
                  />
                  <p style={{ color: "#57534e", fontSize: "12px", marginTop: "4px" }}>
                    Green = helmet · Red = no helmet · Yellow = needs review
                    {analysis.model ? ` · ${analysis.model} (${analysis.engine})` : ""}
                    {analysis.observationId ? ` · saved #${analysis.observationId}` : ""}
                  </p>
                </div>
              )}

              <div className="risk-summary">

                <div>
                  <span>Overall Risk</span>

                  <strong className="medium-risk">
                    <Icon name="alert" /> {analysis.riskLevel}
                  </strong>
                </div>

                <div>
                  <span>AI Confidence</span>

                  <strong>
                    {analysis.confidence}
                  </strong>
                </div>

              </div>


              <div className="detected-section">

                <h3>
                   <Icon name="search" /> Detected Objects
                </h3>

                {/* Phase 10 — pending AI incident review (auto-filed, needs a human). */}
                {analysis.incidentId && (
                  <PendingIncidentCard
                    incidentId={analysis.incidentId}
                    summary={`${analysis.noHelmet ?? 0} worker(s) without helmets detected`}
                    area={analysis.zone || "Site"}
                  />
                )}

                <div className="object-tags">

                  {analysis.detectedObjects.map(
                    (object, index) => (
                      <span key={index}>
                        <Icon name="check" /> {object}
                      </span>
                    )
                  )}

                </div>

              </div>

            </div>

          )}

        </div>

      </div>


      {/* DETECTED ISSUES */}

      {analysis && (

        <>

          <div className="sitevision-card issues-card">

            <div className="sitevision-card-header">

              <div>
                <h2><Icon name="alert" /> Detected Safety / Site Issues</h2>

                <p>
                  Potential issues identified during AI analysis
                </p>
              </div>

              <span className="issue-count">
                {analysis.issues.length} Issues
              </span>

            </div>


            <div className="ai-issues-list">

              {analysis.issues.map((issue, index) => (

                <div
                  className="ai-issue"
                  key={index}
                >

                  <div className="issue-number">
                    {index + 1}
                  </div>

                  <div className="issue-content">

                    <div className="issue-title-row">

                      <h3>
                        {issue.title}
                      </h3>

                      <span
                        className={`severity-badge ${issue.severity.toLowerCase()}`}
                      >
                        {issue.severity}
                      </span>

                    </div>

                    <p>
                      {issue.description}
                    </p>

                  </div>

                </div>

              ))}

            </div>

          </div>


          {/* RECOMMENDATIONS */}

          <div className="sitevision-card recommendations-card">

            <div className="sitevision-card-header">

              <div>
                <h2><Icon name="bulb" /> AI Recommendations</h2>

                <p>
                  Suggested actions based on detected conditions
                </p>
              </div>

            </div>

            <div className="recommendations-list">

              {analysis.recommendations.map(
                (recommendation, index) => (

                  <div
                    className="recommendation-item"
                    key={index}
                  >

                    <span>
                      {index + 1}
                    </span>

                    <p>
                      {recommendation}
                    </p>

                  </div>

                )
              )}

            </div>

          </div>


          {/* SUPERVISOR SIGN-OFF — human-in-the-loop close-out */}

          <div className="sitevision-card recommendations-card">

            <div className="sitevision-card-header">

              <div>
                <h2><Icon name="pen" /> Supervisor Sign-off</h2>

                <p>
                  {project?.name || "Construction Project"} · Zone{" "}
                  {analysis.zone || area || "Site"}
                  {analysis.observationId
                    ? ` · Observation #${analysis.observationId}`
                    : ""}
                </p>
              </div>

            </div>

            {signedAt ? (
              <p style={{ color: "#166534" }}>
                <Icon name="check" /> Reviewed by <strong>{signedBy}</strong> ·{" "}
                {new Date(signedAt).toLocaleString("en-IN")} · Risk marked{" "}
                <strong>{analysis.riskLevel}</strong>. Quote observation #
                {analysis.observationId} in the Daily Update register.
              </p>
            ) : (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <input
                  type="text"
                  value={signedBy}
                  onChange={(e) => setSignedBy(e.target.value)}
                  placeholder="Supervisor name"
                  style={{
                    padding: "8px 10px",
                    borderRadius: "8px",
                    border: "1px solid #d1d5db",
                  }}
                />
                <button
                  className="analyze-ai-btn"
                  style={{ width: "auto", padding: "8px 16px" }}
                  onClick={() => {
                    if (!signedBy.trim()) {
                      setError("Enter the reviewing supervisor's name to sign off.");
                      return;
                    }
                    setError("");
                    setSignedAt(new Date().toISOString());
                  }}
                >
                  <Icon name="check" /> Mark Reviewed
                </button>
              </div>
            )}

          </div>


          <div className="analysis-footer">

            <span>
              <Icon name="bot" /> Real YOLOv8-PPE inference{analysis.model ? ` · ${analysis.model}` : ""} — never 100%; review yellow boxes
            </span>

            <button onClick={clearAnalysis}>
              Analyze Another Image
            </button>

          </div>

        </>

      )}

    </div>
  );
}

export default SiteVisionAI;