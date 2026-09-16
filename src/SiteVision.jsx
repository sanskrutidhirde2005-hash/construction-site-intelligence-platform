import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildPhotoRisks,
  complianceTrend,
  isPlaceholderLocation,
  validateImageFile,
  validateVideoFile,
  visionErrorMessage,
  xhrVisionError,
  ZONE_PRESETS,
} from "./siteVision";
import { formatLatLon, parseExifFromFile } from "./exif";
import { Icon } from "./icons";
import { notify } from "./toast";
import PendingIncidentCard from "./PendingIncidentCard";

// Evidence lightbox — WAI-ARIA APG modal dialog pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal):
// role="dialog" + aria-modal + labelledby/describedby so screen readers
// announce it; Escape always closes; Tab cycles inside; background scroll
// locks; focus returns to the invoking thumbnail on close.
function EvidenceModal({ obs, onClose, onToggleCompare, compared, compareFull }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const titleId = `evidence-title-${obs.id}`;
  const descId = `evidence-desc-${obs.id}`;
  const d = obs.details || {};
  const comp = d.helmet_compliance_pct;
  const takenAt = d.photo_taken_at
    ? new Date(d.photo_taken_at).toLocaleString("en-IN")
    : null;
  const gps = d.photo_lat != null
    ? `${Number(d.photo_lat).toFixed(6)}, ${Number(d.photo_lon).toFixed(6)}`
    : null;
  const isExif = d.provenance_source === "exif";

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevActive = document.activeElement;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const els = dialogRef.current.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      if (prevActive && typeof prevActive.focus === "function") prevActive.focus();
    };
  }, [onClose]);

  return (
    <div className="evidence-modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="evidence-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="evidence-modal-header">
          <div>
            <h3 id={titleId}>
              <Icon name="camera" /> Evidence #{obs.id} · {obs.area || "Site"}
            </h3>
            <p id={descId} className="evidence-modal-sub">
              {obs.title}
              {takenAt && ` · taken ${takenAt}`}
              {gps && ` · GPS ${gps}`}
              {d.provenance_source &&
                ` (${isExif ? "from photo EXIF" : "upload-time"})`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="evidence-modal-close"
            onClick={onClose}
            aria-label="Close evidence dialog"
          >
            <Icon name="xmark" />
          </button>
        </div>

        <div className="evidence-badges">
          {comp != null && (
            <span
              className={`evidence-badge ${comp >= 80 ? "good" : "bad"}`}
            >
              <Icon name="helmet" /> {comp}% helmets
            </span>
          )}
          <span
            className={`evidence-badge ${isExif ? "good" : "neutral"}`}
            title={
              isExif
                ? "Timestamp + GPS read from inside the photo file"
                : "Upload-time evidence (no EXIF in file)"
            }
          >
            <Icon name={isExif ? "camera" : "phone"} />{" "}
            {isExif ? "EXIF-grade" : "upload-grade"}
          </span>
        </div>

        {d.original_url || d.annotated_url ? (
          <div className="evidence-grid">
            {d.original_url && (
              <figure>
                <figcaption>Clean evidence</figcaption>
                <img src={d.original_url} alt={`Original evidence photo #${obs.id}`} />
              </figure>
            )}
            {d.annotated_url && (
              <figure>
                <figcaption>
                  AI verdict (green = helmet · red = no helmet · yellow = review)
                </figcaption>
                <img src={d.annotated_url} alt={`Annotated AI verdict photo #${obs.id}`} />
              </figure>
            )}
          </div>
        ) : (
          <p className="evidence-empty">
            No image files stored for this observation — the record above is
            all that was filed.
          </p>
        )}

        <div className="evidence-modal-actions">
          <button
            type="button"
            className="sitevision-btn"
            style={{
              background: compared ? "#fffbeb" : "#e4ddcc",
              color: "#44403c",
              border: compared ? "1px solid #f59e0b" : "none",
            }}
            onClick={() => onToggleCompare(obs.id)}
            disabled={compareFull && !compared}
            title={
              compared
                ? "Remove from before/after compare"
                : compareFull
                  ? "Two photos already selected — clear the compare first"
                  : "Add to before/after compare"
            }
          >
            <Icon name="check" /> {compared ? "In compare ✓" : "Add to compare"}
          </button>
          {d.original_url && (
            <a
              href={d.original_url}
              download
              target="_blank"
              rel="noreferrer"
              className="sitevision-btn"
              style={{
                background: "#e4ddcc",
                color: "#44403c",
                textDecoration: "none",
              }}
            >
              <Icon name="download" /> Download original
            </a>
          )}
          {gps && (
            <a
              href={`https://www.google.com/maps?q=${d.photo_lat},${d.photo_lon}`}
              target="_blank"
              rel="noreferrer"
              className="sitevision-btn"
              style={{
                background: "#e4ddcc",
                color: "#44403c",
                textDecoration: "none",
              }}
            >
              <Icon name="location" /> Open GPS in Maps
            </a>
          )}
          <button
            type="button"
            className="sitevision-btn"
            style={{ background: "#e4ddcc", color: "#44403c" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteVision() {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const rawPhotoRef = useRef(null);
  // Live camera capture (primary) — file picker stays as fallback.
  const liveVideoRef = useRef(null);
  const liveStreamRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState("Getting location...");
  const [coords, setCoords] = useState(null);
  const [error, setError] = useState("");

  // Site context — shared by photo + video so observations are
  // attributed to the right project and zone (was hardcoded to id 1).
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("1");
  const [engineStatus, setEngineStatus] = useState(null);

  // AI states
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const [analysis, setAnalysis] = useState(null);

  // ================================
  // SITE VIDEO ANALYSIS
  // ================================

  const [mode, setMode] = useState("photo");
  const [videoFile, setVideoFile] = useState(null);
  const [videoArea, setVideoArea] = useState("Site");
  const [videoAnalyzing, setVideoAnalyzing] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [videoResult, setVideoResult] = useState(null);
  const [videoHistory, setVideoHistory] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const [analyzedArea, setAnalyzedArea] = useState("");
  const [copied, setCopied] = useState(false);

  // Photo provenance: the photo's OWN capture time + GPS from EXIF when
  // present (dispute-grade), else device GPS at upload time (weaker claim,
  // labelled honestly in the UI).
  const [provenance, setProvenance] = useState(null);

  // Site photo register (retrievable history, not a dead-end analysis).
  const [photoRegister, setPhotoRegister] = useState([]);
  const [selectedObs, setSelectedObs] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [raisedInspection, setRaisedInspection] = useState(null);
  const [raisingIssue, setRaisingIssue] = useState(false);

  const projectName =
    projects.find((p) => String(p.id) === String(projectId))?.name ||
    "Site Project";

  // Engine health + project list (fail silent — page works offline).
  useEffect(() => {
    fetch("/api/projects")
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          setProjects(list);
          if (!list.some((p) => String(p.id) === "1")) {
            setProjectId(String(list[0].id));
          }
        }
      })
      .catch(() => {});
    fetch("/api/vision/model-status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setEngineStatus(data);
      })
      .catch(() => {});
  }, []);

  const loadVideoHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/observations?project_id=${encodeURIComponent(projectId || "1")}`
      );
      if (res.ok) {
        setVideoHistory(await res.json());
      }
    } catch (err) {
      console.log(err);
    }
  }, [projectId]);

  // Site photo register: same observations endpoint, photo kind only.
  // This is what turns a one-off upload into a retrievable evidence
  // trail (Procore/OpenSpace pattern): every stamped photo stays
  // findable per project + zone with its compliance verdict.
  const loadPhotoRegister = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/observations?project_id=${encodeURIComponent(projectId || "1")}`
      );
      if (res.ok) {
        const all = await res.json();
        setPhotoRegister(
          Array.isArray(all) ? all.filter((o) => o.kind === "photo") : []
        );
      }
    } catch (err) {
      console.log(err);
    }
  }, [projectId]);

  useEffect(() => {
    if (mode === "photo") {
      loadPhotoRegister();
    }
  }, [mode, projectId, loadPhotoRegister]);

  useEffect(() => {
    if (mode === "video") {
      loadVideoHistory();
    }
  }, [mode, projectId, loadVideoHistory]);

  const analyzeVideoFile = async () => {
    const invalid = validateVideoFile(videoFile);
    if (invalid) {
      setVideoError(invalid);
      return;
    }

    setVideoAnalyzing(true);
    setVideoError("");
    setVideoResult(null);
    setUploadPct(0);
    setAnalyzedArea(videoArea || "Site");

    const form = new FormData();
    form.append("video", videoFile);
    form.append("project_id", projectId || "1");
    form.append("area", videoArea || "Site");

    // XMLHttpRequest (not fetch) so supervisors see upload progress
    // on large site clips instead of a frozen spinner.
    try {
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/vision/analyze-video");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadPct(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(
                new Error(
                  xhrVisionError(xhr.status, xhr.responseText, "Video analysis failed")
                )
              );
            }
          } else {
            reject(
              new Error(
                xhrVisionError(xhr.status, xhr.responseText, "Video analysis failed")
              )
            );
          }
        };
        xhr.onerror = () =>
          reject(new Error("Upload failed — check connection and retry."));
        xhr.send(form);
      });

      setVideoResult(data);
      loadVideoHistory();
    } catch (err) {
      setVideoError(err.message);
    }

    setVideoAnalyzing(false);
    setUploadPct(null);
  };

  // ================================
  // GET GPS LOCATION
  // ================================

  const getLocation = () => {
    if (!navigator.geolocation) {
      setLocation("GPS not supported");
      return;
    }

    setLocation("Getting GPS location...");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        setCoords(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          );

          const data = await response.json();
          const address = data.address || {};

          const city =
            address.city ||
            address.town ||
            address.village ||
            address.municipality ||
            address.county ||
            "Unknown Location";

          const state = address.state || "";

          setLocation(
            state ? `${city}, ${state}` : city
          );
        } catch (err) {
          setLocation(
            `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          );
        }
      },
      (err) => {
        console.log(err);

        if (err.code === 1) {
          setLocation("Location permission denied");
        } else {
          setLocation("Unable to get location");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // ================================
  // LIVE CAMERA (primary) — file picker is fallback.
  // GPS is re-asked on every open/capture via getLocation() (maximumAge: 0).
  // ================================

  const stopLiveCamera = () => {
    try {
      liveStreamRef.current?.getTracks()?.forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    liveStreamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  };

  const openLiveCamera = async () => {
    setCameraError("");
    setPhotoError("");
    // Ask for GPS on every camera open so a missing fix re-prompts.
    getLocation();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Live camera is not supported here — use Choose Photo from Files below.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      liveStreamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        const v = liveVideoRef.current;
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
        }
      });
    } catch {
      setCameraError("Camera blocked or unavailable — allow camera access or use Choose Photo from Files.");
    }
  };

  const closeLiveCamera = () => {
    stopLiveCamera();
    setCameraActive(false);
  };

  const captureFromLiveCamera = async () => {
    const video = liveVideoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError("Camera is still starting — wait a second and tap Capture again.");
      return;
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
    if (!blob) {
      setCameraError("Could not capture that frame — try again.");
      return;
    }
    const file = new File([blob], `site-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    closeLiveCamera();
    await handlePhotoFile(file);
    // No fix yet → ask again right after capture.
    if (isPlaceholderLocation(location)) getLocation();
  };

  // Never leave the live camera running on unmount.
  useEffect(() => {
    return () => {
      try {
        liveStreamRef.current?.getTracks()?.forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
    };
  }, []);

  // ================================
  // PHOTO UPLOAD (from files — no live camera)
  // ================================

  const stampPhoto = (img, provOverride) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Bound huge uploads so the evidence stamp stays legible
    // and the preview stays light.
    const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);

    // `prov` is passed explicitly so the first stamp uses freshly-parsed
    // EXIF even before the provenance state commit lands.
    const prov = provOverride !== undefined ? provOverride : provenance;
    const shotAt = prov?.takenAt ? new Date(prov.takenAt) : new Date();

    const date =
      shotAt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

    const time =
      shotAt.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    // ================================
    // WATERMARK — site evidence register:
    // project + zone + date/time + GPS. Never bake a placeholder
    // ("Getting location...") — fall back to raw coordinates.
    // ================================

    const boxHeight = 180;

    ctx.fillStyle =
      "rgba(0, 0, 0, 0.70)";

    ctx.fillRect(
      0,
      height - boxHeight,
      width,
      boxHeight
    );

    const exifGps = formatLatLon(prov?.lat, prov?.lon);

    const gpsLine = exifGps
      ? exifGps
      : isPlaceholderLocation(location) && coords
        ? coords
        : location;

    const secondLine = exifGps
      ? `Device: ${coords || "n/a"}`
      : `LatLon: ${coords || "unavailable"}`;

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";

    ctx.fillText(
      `BuildSafe | SiteVision${exifGps ? " · EXIF" : ""}`,
      20,
      height - 148
    );

    ctx.font = "18px Arial";

    ctx.fillText(
      `Project: ${projectName} | Zone: ${videoArea || "Site"}`,
      20,
      height - 122
    );

    ctx.fillText(
      `Date: ${date}`,
      20,
      height - 96
    );

    ctx.fillText(
      `Time: ${time}`,
      20,
      height - 70
    );

    ctx.fillText(
      `GPS: ${gpsLine}`,
      20,
      height - 44
    );

    ctx.fillText(
      secondLine,
      20,
      height - 18
    );

    const image =
      canvas.toDataURL(
        "image/jpeg",
        0.92
      );

    setPhoto(image);

    // Reset AI result for new photo
    setAnalysis(null);
    setAnalysisDone(false);
    setPhotoError("");
    setCopied(false);
  };

  const handlePhotoFile = async (file) => {
    setError("");

    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }

    // Photo's OWN provenance first (EXIF timestamp + GPS). Falls back
    // to device GPS at upload when the file carries none.
    const exif = await parseExifFromFile(file);
    const prov = {
      takenAt: exif.takenAt ? exif.takenAt.toISOString() : null,
      lat: exif.lat,
      lon: exif.lon,
      source: exif.lat != null || exif.takenAt ? "exif" : "device",
    };
    setProvenance(prov);

    // Start GPS lookup in parallel — the stamp uses whatever is
    // resolved; the user can re-stamp once GPS lands (button below).
    getLocation();

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      rawPhotoRef.current = img;
      stampPhoto(img, prov);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError("Could not read that image file. Try a JPG or PNG.");
    };
    img.src = url;
  };

  // Re-stamp the uploaded photo once GPS resolves (or zone changes).
  const refreshStamp = () => {
    if (rawPhotoRef.current) stampPhoto(rawPhotoRef.current);
  };

  // ================================
  // NEW PHOTO (back to the upload form)
  // ================================

  const retakePhoto = () => {
    stopLiveCamera();
    setCameraActive(false);
    setCameraError("");
    setPhoto(null);
    setAnalysis(null);
    setAnalysisDone(false);
    setPhotoError("");
    setCopied(false);
    setProvenance(null);
    setRaisedInspection(null);
    rawPhotoRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ================================
  // AI ANALYSIS
  // ================================

  const analyzePhoto = async () => {
    if (!photo) return;

    // No fix yet → re-ask GPS each time before analysis.
    if (isPlaceholderLocation(location)) getLocation();

    setAnalyzing(true);
    setAnalysisDone(false);
    setPhotoError("");

    // Real inference: POST the captured photo to YOLOv8-PPE (or legacy
    // fallback). Never a setTimeout mock — safety verdicts must come from
    // pixels + a versioned model, with degraded passes flagged.
    try {
      // Downscale phone captures (often 4000px+) to max 1600px before
      // upload — faster on site networks, no accuracy loss for PPE.
      const blob = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(
            1,
            1600 / Math.max(img.width, img.height)
          );
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(new Error("Could not prepare photo.")),
            "image/jpeg",
            0.85
          );
        };
        img.onerror = () =>
          reject(new Error("Could not read captured photo."));
        img.src = photo;
      });
      const form = new FormData();
      form.append("image", blob, "site-photo.jpg");
      form.append("project_id", projectId || "1");
      form.append("area", videoArea || "Site");
      // Provenance travels with the upload so the observation record
      // keeps EXIF-grade vs device-grade evidence honestly.
      if (provenance?.takenAt) form.append("photo_taken_at", provenance.takenAt);
      if (provenance?.lat != null) form.append("photo_lat", String(provenance.lat));
      if (provenance?.lon != null) form.append("photo_lon", String(provenance.lon));
      if (provenance?.source) form.append("provenance_source", provenance.source);
      if (coords) form.append("device_coords", coords);

      const res = await fetch("/api/vision/analyze-image", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(await visionErrorMessage(res, "Photo analysis failed"));
      }
      const data = await res.json();

      const workers = data.workers ?? 0;
      const helmets = data.helmets ?? 0;
      const noHelmet = data.no_helmet ?? 0;
      const unclear = data.unclear ?? 0;
      const compliance = data.compliance_pct;

      const risks = buildPhotoRisks(data);

      setAnalysis({
        workers,
        ppeCompliance: `${helmets} / ${workers}`,
        safetyIssues: noHelmet,
        progress: compliance != null ? `${compliance}%` : "—",
        materialIssues: unclear,
        risks,
        // Real-vision extras rendered below the cards:
        helmets,
        noHelmet,
        unclear,
        compliance,
        boxes: data.boxes || [],
        annotatedUrl: data.annotated_url || null,
        originalUrl: data.original_url || null,
        model: data.model || null,
        engine: data.engine || null,
        degraded: !!data.degraded,
        observationId: data.observation_id || null,
        zone: videoArea || "Site",
        extraSightings: data.extra_sightings ?? 0,
        provenance: data.provenance_source
          ? {
              source: data.provenance_source,
              takenAt: data.photo_taken_at || provenance?.takenAt || null,
              lat: data.photo_lat ?? provenance?.lat ?? null,
              lon: data.photo_lon ?? provenance?.lon ?? null,
            }
          : provenance,
      });
      setAnalysisDone(true);
      setRaisedInspection(null);
      loadPhotoRegister();
    } catch (err) {
      setPhotoError(err.message);
    }

    setAnalyzing(false);
  };

  // ================================
  // PHOTO ACTIONS — this is what makes an upload *useful* instead of a
  // dead-end analysis: file it, compare it, escalate it, share it.
  // (Procore pattern: every photo becomes an observation / punch item /
  // daily-log line in under 30s, with location + timestamp attached.)
  // ================================

  const provenanceLabel = (prov) => {
    if (!prov) return null;
    if (prov.source === "exif" && (prov.lat != null || prov.takenAt)) {
      const when = prov.takenAt
        ? new Date(prov.takenAt).toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "date in stamp";
      const where =
        prov.lat != null ? formatLatLon(prov.lat, prov.lon) : "GPS in stamp";
      return `Photo evidence: taken ${when} · GPS ${where} (from photo EXIF — dispute-grade)`;
    }
    return "Upload evidence: no EXIF in file (forwarded/edited copy?) — timestamp + device GPS at upload (weaker claim)";
  };

  const copyObservation = async () => {
    if (!analysis?.observationId) return;
    const prov = analysis.provenance || provenance;
    const text =
      `SiteVision observation #${analysis.observationId} · ${projectName} · ` +
      `Zone ${analysis.zone || videoArea || "Site"} · ${analysis.workers} worker(s), ` +
      `${analysis.compliance != null ? `${analysis.compliance}% helmet compliance` : "no judged detections"}` +
      `${prov?.takenAt ? ` · photo taken ${new Date(prov.takenAt).toLocaleString("en-IN")}` : ""}` +
      `${prov?.lat != null ? ` · GPS ${formatLatLon(prov.lat, prov.lon)} (${prov.source})` : ""}` +
      `${analysis.degraded ? " · DEGRADED ENGINE — human review required" : ""}` +
      `${analysis.originalUrl ? ` · evidence ${window.location.origin}${analysis.originalUrl}` : ""}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      notify(text);
    }
  };

  // One-click escalation: photo → tracked inspection (dashboard, search,
  // GenAI all read inspections). Manual even when auto-flag didn't fire.
  const raiseSafetyIssue = async () => {
    if (!analysis?.observationId || raisingIssue) return;
    setRaisingIssue(true);
    try {
      const res = await fetch("/api/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: Number(projectId) || 1,
          status: "attention",
          notes:
            `PPE review from SiteVision photo #${analysis.observationId} ` +
            `(${analysis.zone || videoArea || "Site"}): ` +
            `${analysis.noHelmet} no-helmet / ${analysis.unclear} needs-review, ` +
            `compliance ${analysis.compliance ?? "n/a"}%. ` +
            `Evidence: ${analysis.originalUrl || analysis.annotatedUrl || "see observation"}.`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not raise issue.");
      setRaisedInspection(data.id ?? data.inspection_id ?? true);
    } catch (err) {
      setPhotoError(err.message);
    }
    setRaisingIssue(false);
  };

  const toggleCompare = (id) => {
    setCompareIds((prev) =>
      prev.includes(id)
        ? prev.filter((c) => c !== id)
        : [...prev, id].slice(-2)
    );
  };

  // Stable identity so the modal's Escape/scroll-lock effect mounts once.
  const closeEvidence = useCallback(() => setSelectedObs(null), []);

  // Compare from inside the modal: completing the pair closes the dialog
  // to reveal the before/after panel underneath.
  const toggleCompareFromModal = (id) => {
    const willComplete = !compareIds.includes(id) && compareIds.length === 1;
    toggleCompare(id);
    if (willComplete) closeEvidence();
  };

  const compareObs = compareIds
    .map((id) => photoRegister.find((o) => o.id === id))
    .filter(Boolean);

  const downloadStamped = () => {
    if (!photo) return;
    const a = document.createElement("a");
    a.href = photo;
    a.download = `sitevision-${projectId}-${videoArea || "site"}-${Date.now()}.jpg`;
    a.click();
  };

  return (
    <div className="sitevision-page">

      {/* HEADER */}

      <div className="sitevision-header">

        <h1><Icon name="eye" /> SiteVision AI</h1>

        <p>
          Upload site photos with photo-verified GPS + time — each one is
          filed to the project record, comparable over time, and
          escalatable to a safety inspection in one click.
        </p>

      </div>

      {/* SITE CONTEXT BAR — project + zone + engine health */}

      <div
        className="sitevision-upload-card"
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          alignItems: "flex-end",
          marginBottom: "18px",
        }}
      >
        <div>
          <label style={{ fontSize: "12px", color: "#64748b" }}>
            Project (observations are filed here)
          </label>
          <br />
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              marginTop: "4px",
            }}
          >
            {projects.length === 0 && (
              <option value="1">Site Project</option>
            )}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontSize: "12px", color: "#64748b" }}>
            Site zone (stamped on evidence + records)
          </label>
          <br />
          <input
            type="text"
            value={videoArea}
            onChange={(e) => setVideoArea(e.target.value)}
            placeholder="e.g. Tower A · Floor 4"
            style={{
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid #d1d5db",
              marginTop: "4px",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {ZONE_PRESETS.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setVideoArea(z)}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                border: videoArea === z
                  ? "1px solid #f59e0b"
                  : "1px solid #d1d5db",
                background: videoArea === z ? "#fffbeb" : "#fff",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              {z}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", fontSize: "12px" }}>
          {engineStatus ? (
            <span
              title={engineStatus.note}
              style={{
                padding: "6px 10px",
                borderRadius: "999px",
                background:
                  engineStatus.engine === "yolo"
                    ? "#dcfce7"
                    : engineStatus.engine === "legacy"
                      ? "#fef3c7"
                      : "#fee2e2",
                color:
                  engineStatus.engine === "yolo"
                    ? "#166534"
                    : engineStatus.engine === "legacy"
                      ? "#92400e"
                      : "#b91c1c",
              }}
            >
              {engineStatus.engine === "yolo"
                ? <><Icon name="circle" style={{ color: "#16a34a" }} /> AI engine: full detection</>
                : engineStatus.engine === "legacy"
                  ? <><Icon name="circle" style={{ color: "#eab308" }} /> AI engine: degraded — review all verdicts</>
                  : <><Icon name="circle" style={{ color: "#dc2626" }} /> AI engine unavailable</>}
            </span>
          ) : (
            <span style={{ color: "#94a3b8" }}>
              Checking AI engine…
            </span>
          )}
        </div>
      </div>

      {/* MODE TOGGLE */}

      <div
        className="sitevision-buttons"
        style={{ marginBottom: "18px" }}
      >
        <button
          className="sitevision-btn sitevision-camera-btn"
          style={mode === "photo" ? {} : { background: "#e4ddcc", color: "#44403c" }}
          onClick={() => setMode("photo")}
        >
          <Icon name="camera" /> Photo
        </button>

        <button
          className="sitevision-btn sitevision-ai-btn"
          style={mode === "video" ? {} : { background: "#e4ddcc", color: "#44403c" }}
          onClick={() => setMode("video")}
        >
          <Icon name="video" /> Site Video
        </button>
      </div>

      {/* VIDEO ANALYSIS PANEL */}

      {mode === "video" && (
        <div className="sitevision-upload-card">

          <div className="sitevision-upload-area">
            <div style={{ fontSize: "55px" }}><Icon name="video" style={{ width: "55px", height: "55px" }} /></div>
            <h3>Site Video Analysis</h3>
            <p>
              Upload a clip of workers or site activity.
              Real computer vision counts workers, estimates
              helmet compliance and scores site activity —
              results are saved to the project record.
            </p>

            <div
              style={{
                display: "flex",
                gap: "10px",
                flexWrap: "wrap",
                justifyContent: "center",
                marginTop: "15px",
              }}
            >
              <input
                type="file"
                accept="video/*,.mp4,.mov,.avi,.mkv,.webm"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              />
            </div>

            <p style={{ color: "#64748b", fontSize: "12px", marginTop: "8px" }}>
              Filing to <strong>{projectName}</strong> · Zone{" "}
              <strong>{videoArea || "Site"}</strong> · max 150 MB
            </p>

            <div className="sitevision-buttons" style={{ marginTop: "15px" }}>
              <button
                className="sitevision-btn sitevision-ai-btn"
                onClick={analyzeVideoFile}
                disabled={videoAnalyzing || !videoFile}
              >
                {videoAnalyzing
                  ? uploadPct != null && uploadPct < 100
                    ? <><Icon name="upload" /> Uploading… {uploadPct}%</>
                    : <><Icon name="rotate" /> Analyzing video…</>
                  : <><Icon name="search" /> Analyze Video</>}
              </button>
            </div>

            {videoAnalyzing && uploadPct != null && uploadPct < 100 && (
              <div
                style={{
                  height: "8px",
                  background: "#e2e8f0",
                  borderRadius: "999px",
                  marginTop: "10px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${uploadPct}%`,
                    height: "100%",
                    background: "#f59e0b",
                  }}
                />
              </div>
            )}

            {videoFile && !videoAnalyzing && !videoResult && (
              <p style={{ color: "#57534e", marginTop: "10px" }}>
                Selected: {videoFile.name} ({(videoFile.size / 1048576).toFixed(1)} MB)
              </p>
            )}

            {videoError && (
              <p style={{ color: "#dc2626", marginTop: "15px" }}>{videoError}</p>
            )}
          </div>

          {/* VIDEO RESULT */}

          {videoResult && (
            <div className="sitevision-analysis" style={{ marginTop: "10px" }}>
              <div className="sitevision-analysis-header">
                <div>
                  <h3><Icon name="video" /> Video Analysis Result</h3>
                  <p>
                    {videoResult.duration_sec}s clip · {videoResult.samples} frames
                    sampled · {videoResult.method}
                  </p>
                </div>
                <span className="analysis-ready"><Icon name="check" /> Saved #{videoResult.observation_id}</span>
              </div>

              {/* Phase 10 — the model proposes a pending incident; a supervisor confirms. */}
              {videoResult.incident_id && (
                <PendingIncidentCard
                  incidentId={videoResult.incident_id}
                  summary={`${videoResult.no_helmet_detected ?? 0} worker(s) without helmets detected`}
                  area={videoArea || "Site"}
                />
              )}

              {(videoResult.degraded || videoResult.engine === "legacy") && (
                <p style={{ background: "#fef3c7", color: "#92400e", padding: "10px 12px", borderRadius: "8px" }}>
                  <Icon name="alert" /> Provisional result — vision ran on the degraded fallback engine
                  {videoResult.model ? ` (${videoResult.model})` : ""}. Do not treat as SAFE without human review.
                </p>
              )}

              <p style={{ color: "#64748b", fontSize: "12px", marginTop: "8px" }}>
                Engine: {videoResult.engine || "?"} ·{" "}
                {videoResult.model || "unknown model"}
                {videoResult.unreliable_frames > 0 &&
                  ` · ${videoResult.unreliable_frames} shaky-camera sample(s) excluded from motion detection`}
              </p>

              <div className="sitevision-analysis-grid">
                <div className="analysis-card">
                  <span><Icon name="user" /></span>
                  <strong>{videoResult.avg_workers}</strong>
                  <small>Avg Workers / Frame</small>
                </div>
                <div className="analysis-card">
                  <span><Icon name="chart" /></span>
                  <strong>{videoResult.peak_workers}</strong>
                  <small>Peak Workers</small>
                </div>
                <div className="analysis-card">
                  <span><Icon name="zap" /></span>
                  <strong>{videoResult.activity_score}/100</strong>
                  <small>Activity Score</small>
                </div>
                <div className="analysis-card">
                  <span><Icon name="helmet" /></span>
                  <strong>
                    {videoResult.helmet_compliance_pct === null
                      ? "—"
                      : `${videoResult.helmet_compliance_pct}%`}
                  </strong>
                  <small>Helmet Compliance</small>
                </div>
                <div className="analysis-card">
                  <span><Icon name="user" /></span>
                  <strong>{videoResult.unique_persons}</strong>
                  <small>Unique Persons Tracked</small>
                </div>
                <div className="analysis-card">
                  <span><Icon name="alert" /></span>
                  <strong>{videoResult.no_helmet_detected}</strong>
                  <small>No-Helmet Sightings</small>
                </div>
              </div>

              {(videoResult.alerts || []).length > 0 && (
                <div className="sitevision-risk-section">
                  <h3><Icon name="siren" /> Safety Alerts — review these moments</h3>
                  {(videoResult.alerts || []).map((a, i) => (
                    <div className="sitevision-risk-item high" key={i}>
                      <div className="risk-level"><Icon name="circle" style={{ color: "#dc2626" }} /> ALERT</div>
                      <div className="risk-content">
                        <strong>~{a.t}s · Zone {analyzedArea || videoArea || "Site"} — {a.issue}</strong>
                        {a.frame && (
                          <p>
                            <a href={a.frame} target="_blank" rel="noreferrer">
                              Open annotated frame
                            </a>
                          </p>
                        )}
                      </div>
                      <span className="risk-status">Open</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="sitevision-risk-section">
                <h3><Icon name="clipboard" /> Findings</h3>
                {(videoResult.events || []).length === 0 && (
                  <p style={{ color: "#64748b" }}>No findings recorded.</p>
                )}
                {(videoResult.events || []).map((ev, i) => (
                  <div className="sitevision-risk-item medium" key={i}>
                    <div className="risk-content"><p>{ev}</p></div>
                  </div>
                ))}
              </div>

              <h3 style={{ margin: "15px 0 8px" }}><Icon name="user" /> Workers Over Time</h3>
              <p style={{ color: "#64748b", fontSize: "12px" }}>
                Grey bars = shaky-camera samples (worker count kept, motion ignored).
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "3px",
                  height: "90px",
                  padding: "10px",
                  background: "#f5f1e8",
                  borderRadius: "1px",
                }}
              >
                {(videoResult.timeline || []).map((s, i) => (
                  <div
                    key={i}
                    title={`${s.t}s · ${s.workers} workers · motion ${s.motion}${s.unreliable ? " · shaky camera" : ""}`}
                    style={{
                      flex: 1,
                      height: `${videoResult.peak_workers
                        ? Math.max(8, (s.workers / videoResult.peak_workers) * 100)
                        : 8}%`,
                      background: s.unreliable
                        ? "#94a3b8"
                        : s.workers > 0
                          ? "#eab308"
                          : "#e2d9c2",
                      borderRadius: "3px",
                    }}
                  />
                ))}
              </div>

              {videoResult.frames?.length > 0 && (
                <>
                  <h3 style={{ margin: "15px 0 8px" }}><Icon name="image" /> Annotated Frames</h3>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: "10px",
                    }}
                  >
                    {videoResult.frames.map((f, i) => (
                      <img
                        key={i}
                        src={f}
                        alt={`Analysed frame ${i + 1}`}
                        style={{ width: "100%", borderRadius: "1px" }}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* VIDEO HISTORY */}

          {videoHistory.length > 0 && (
            <div style={{ marginTop: "20px" }}>
              <h3><Icon name="folder" /> Past Analyses</h3>
              {complianceTrend(videoHistory).length > 0 && (
                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    margin: "10px 0",
                  }}
                >
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    Helmet-compliance trend:
                  </span>
                  {complianceTrend(videoHistory).map((c) => (
                    <span
                      key={c.id}
                      title={`Observation #${c.id} · ${c.label || "undated"}`}
                      style={{
                        fontSize: "12px",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        background: c.compliance >= 80 ? "#dcfce7" : "#fee2e2",
                        color: c.compliance >= 80 ? "#166534" : "#b91c1c",
                      }}
                    >
                      #{c.id}: {c.compliance}%
                    </span>
                  ))}
                </div>
              )}
              {videoHistory.map((o) => (
                <div className="sitevision-risk-item medium" key={o.id}>
                  <div className="risk-content">
                    <strong>#{o.id} · {o.area}</strong>
                    <p>{o.title}</p>
                  </div>
                  <span className="risk-status">{(o.created_at || "").slice(0, 10)}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {/* CAMERA CARD */}

      <div
        className="sitevision-upload-card"
        style={{ display: mode === "photo" ? "block" : "none" }}
      >

        {/* PHOTO UPLOAD */}

        {!photo && (

          <div className="sitevision-upload-area">

            <div
              style={{
                fontSize: "55px",
              }}
            >
              <Icon name="camera" style={{ width: "55px", height: "55px" }} />
            </div>

            <h3>
              GPS Site Photo Capture
            </h3>

            <p>
              Capture from the camera — its <strong>live GPS fix</strong>{" "}
              is stamped on the evidence, filed to the project
              register, and comparable with earlier shots of the
              same zone. Files stay as fallback.
            </p>
            <p style={{ color: "#64748b", fontSize: "12px" }}>
              GPS permission is asked on every capture. If denied, allow
              location for this site and tap Retry GPS. For headcount,
              step back so workers' full bodies are visible.
            </p>

            {cameraActive ? (
              <div style={{ width: "100%", maxWidth: "560px" }}>
                <video
                  ref={liveVideoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    width: "100%",
                    maxHeight: "320px",
                    objectFit: "cover",
                    borderRadius: "8px",
                    background: "#000",
                  }}
                />
                <div className="sitevision-buttons" style={{ marginTop: "10px" }}>
                  <button
                    type="button"
                    className="sitevision-btn sitevision-camera-btn"
                    onClick={captureFromLiveCamera}
                  >
                    <Icon name="camera" /> Capture Photo
                  </button>
                  <button
                    type="button"
                    className="sitevision-btn"
                    style={{ background: "#e4ddcc", color: "#44403c" }}
                    onClick={closeLiveCamera}
                  >
                    Cancel
                  </button>
                </div>
                <p style={{ fontSize: "12px", color: "#57534e", marginTop: "8px" }} aria-live="polite">
                  GPS: {location}{" "}
                  {isPlaceholderLocation(location) && (
                    <button type="button" className="link-button" onClick={getLocation}>
                      Retry GPS
                    </button>
                  )}
                </p>
              </div>
            ) : (
              <div className="sitevision-buttons">
                <button
                  type="button"
                  className="sitevision-btn sitevision-camera-btn"
                  onClick={openLiveCamera}
                >
                  <Icon name="camera" /> Open Camera
                </button>

                <label
                  className="sitevision-btn sitevision-camera-btn"
                  style={{ cursor: "pointer", background: "#e4ddcc", color: "#44403c" }}
                >
                  <Icon name="upload" /> Choose from Files
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files?.[0]) {
                        handlePhotoFile(e.target.files[0]);
                      }
                    }}
                  />
                </label>
              </div>
            )}

            {(cameraError || error) && (
              <p
                style={{
                  color: "#dc2626",
                  marginTop: "15px",
                }}
              >
                {cameraError || error}
              </p>
            )}

            {!cameraActive && (
              <p style={{ fontSize: "12px", color: "#57534e", marginTop: "8px" }} aria-live="polite">
                GPS: {location}{" "}
                {isPlaceholderLocation(location) && (
                  <button type="button" className="link-button" onClick={getLocation}>
                    Retry GPS
                  </button>
                )}
              </p>
            )}

          </div>
        )}

        {/* HIDDEN CANVAS (evidence stamping) */}

        <canvas
          ref={canvasRef}
          style={{
            display: "none",
          }}
        />

        {/* UPLOADED PHOTO */}

        {photo && (

          <div className="sitevision-preview">

            <h3>
              <Icon name="camera" /> Stamped Site Photo
            </h3>

            <img
              src={photo}
              alt="Construction site"
            />

            {/* PHOTO INFORMATION */}

            <div className="sitevision-photo-info">

              <div>
                <Icon name="location" /> <strong>Location:</strong>{" "}
                {location}{" "}
                {isPlaceholderLocation(location) && (
                  <span style={{ fontSize: "12px", color: "#92400e" }}>
                    (resolving… stamp again once GPS lands)
                  </span>
                )}
              </div>

              <div>
                <Icon name="building" /> <strong>Filing to:</strong>{" "}
                {projectName} · Zone {videoArea || "Site"}
              </div>

              <div>
                <Icon name="bot" /> <strong>Status:</strong>{" "}
                Ready for AI Analysis
              </div>

            </div>

            {/* PROVENANCE BADGE — the honesty label that makes the stamp
                trustworthy: EXIF-grade vs upload-grade, never overstated. */}
            {provenance && (
              <p
                title={
                  provenance.source === "exif"
                    ? "Timestamp + GPS were read from inside the photo file itself"
                    : "File carried no EXIF — timestamp/GPS fall back to this upload"
                }
                style={{
                  marginTop: "10px",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  background:
                    provenance.source === "exif" ? "#dcfce7" : "#fef3c7",
                  color:
                    provenance.source === "exif" ? "#166534" : "#92400e",
                }}
              >
                {provenanceLabel(provenance)}
              </p>
            )}

            <div
              className="sitevision-buttons"
              style={{ marginTop: "10px" }}
            >
              <button
                className="sitevision-btn"
                style={{
                  background: "#e4ddcc",
                  color: "#44403c",
                  fontSize: "13px",
                }}
                onClick={refreshStamp}
                disabled={analyzing}
                title="Re-apply the evidence stamp with the latest GPS / zone"
              >
                <Icon name="location" /> Refresh GPS Stamp
              </button>
            </div>

            {/* ANALYZE BUTTON */}

            {photoError && (
              <p style={{ color: "#dc2626", marginTop: "15px" }}>{photoError}</p>
            )}

            {!analysisDone && (

              <div
                className="sitevision-buttons"
                style={{
                  marginTop: "18px",
                }}
              >

                <button
                  className="sitevision-btn sitevision-ai-btn"
                  onClick={analyzePhoto}
                  disabled={analyzing}
                >
                  {analyzing
                    ? <><Icon name="rotate" /> Analyzing Site…</>
                    : <><Icon name="search" /> Analyze with AI</>}
                </button>

                <button
                  className="sitevision-btn"
                  style={{
                    background: "#e4ddcc",
                    color: "#44403c",
                  }}
                  onClick={retakePhoto}
                  disabled={analyzing}
                >
                  <Icon name="rotate" /> Upload Different Photo
                </button>

              </div>

            )}

            {/* ================================
                AI ANALYSIS RESULT
            ================================= */}

            {analysisDone && analysis && (

              <div className="sitevision-analysis">

                <div className="sitevision-analysis-header">

                  <div>
                    <h3>
                      <Icon name="bot" /> AI Site Analysis
                    </h3>

                    <p>
                      {analysis.observationId
                        ? `Saved #${analysis.observationId} · model ${analysis.model || "unknown"} · engine ${analysis.engine || "?"}`
                        : "Analysis completed successfully"}
                    </p>
                  </div>

                  <span className="analysis-ready">
                    <Icon name="check" /> Ready
                  </span>

                </div>

                {analysis.degraded && (
                  <p style={{ background: "#fef3c7", color: "#92400e", padding: "10px 12px", borderRadius: "1px" }}>
                    <Icon name="alert" /> Provisional result — vision model degraded (legacy fallback). Do not treat as SAFE without human review.
                  </p>
                )}

                {analysis.extraSightings > 0 && (
                  <p style={{ background: "#eff6ff", color: "#1d4ed8", padding: "10px 12px", borderRadius: "8px" }}>
                    <Icon name="search" /> {analysis.extraSightings} extra worker sighting(s) found by close-up / small-person
                    proposers that the full-body detector missed — included in the count above.
                  </p>
                )}

                {/* ANALYSIS CARDS */}

                <div className="sitevision-analysis-grid">

                  <div className="analysis-card">
                    <span><Icon name="user" /></span>
                    <strong>
                      {analysis.workers}
                    </strong>
                    <small>
                      Workers Detected
                    </small>
                  </div>

                  <div className="analysis-card">
                    <span><Icon name="helmet" /></span>
                    <strong>
                      {analysis.ppeCompliance}
                    </strong>
                    <small>
                      PPE Observation
                    </small>
                  </div>

                  <div className="analysis-card">
                    <span><Icon name="alert" /></span>
                    <strong>
                      {analysis.safetyIssues}
                    </strong>
                    <small>
                      Safety Issues
                    </small>
                  </div>

                  <div className="analysis-card">
                    <span><Icon name="building" /></span>
                    <strong>
                      {analysis.progress}
                    </strong>
                    <small>
                      Helmet Compliance
                    </small>
                  </div>

                  <div className="analysis-card">
                    <span><Icon name="package" /></span>
                    <strong>
                      {analysis.materialIssues}
                    </strong>
                    <small>
                      Needs Review
                    </small>
                  </div>

                </div>

                {analysis.annotatedUrl && (
                  <>
                    <h3 style={{ margin: "15px 0 8px" }}><Icon name="image" /> Annotated Photo</h3>
                    <img
                      src={analysis.annotatedUrl}
                      alt="Annotated site photo with helmet detections"
                      style={{ width: "100%", borderRadius: "1px" }}
                    />
                  </>
                )}

                {/* RISK ALERTS */}

                {/* Phase 10 — pending AI incident review (auto-filed, needs a human). */}
                {analysis?.incidentId && (
                  <PendingIncidentCard
                    incidentId={analysis.incidentId}
                    summary={`${analysis.noHelmet ?? 0} worker(s) without helmets detected`}
                    area={analysis.zone || videoArea || "Site"}
                  />
                )}

                <div className="sitevision-risk-section">

                  <h3>
                    <Icon name="alert" /> Detected Risk Alerts
                  </h3>

                  {analysis.risks.map(
                    (risk, index) => (

                      <div
                        className={`sitevision-risk-item ${risk.level.toLowerCase()}`}
                        key={index}
                      >

                        <div className="risk-level">
                          {risk.level === "HIGH"
                            ? <Icon name="circle" style={{ color: "#dc2626" }} />
                            : risk.level === "LOW"
                              ? <Icon name="circle" style={{ color: "#16a34a" }} />
                              : <Icon name="circle" style={{ color: "#ea580c" }} />}{" "}
                          {risk.level}
                        </div>

                        <div className="risk-content">

                          <strong>
                            {risk.title}
                          </strong>

                          <p>
                            {risk.description}
                          </p>

                        </div>

                        <span className="risk-status">
                          Open
                        </span>

                      </div>

                    )
                  )}

                </div>

                {/* ACTION BUTTONS — every action files the photo somewhere
                    useful: inspection register, evidence download, daily log. */}

                <div
                  className="sitevision-buttons"
                  style={{
                    marginTop: "20px",
                  }}
                >

                  <button
                    className="sitevision-btn sitevision-camera-btn"
                    onClick={raiseSafetyIssue}
                    disabled={!analysis.observationId || raisingIssue || raisedInspection}
                    title="File this photo as a tracked safety inspection (surfaces on dashboard + search + GenAI)"
                  >
                    {raisedInspection
                      ? <><Icon name="check" /> Filed as inspection #{raisedInspection === true ? "" : raisedInspection}</>
                      : raisingIssue
                        ? "Filing…"
                        : <><Icon name="siren" /> Raise Safety Issue</>}
                  </button>

                  <button
                    className="sitevision-btn sitevision-camera-btn"
                    onClick={copyObservation}
                    disabled={!analysis.observationId}
                    title="Copy a filing reference for the Daily Update / inspection register"
                  >
                    {copied ? <><Icon name="check" /> Copied!</> : <><Icon name="send" /> Copy for Daily Update</>}
                  </button>

                  <button
                    className="sitevision-btn"
                    style={{
                      background: "#e4ddcc",
                      color: "#44403c",
                    }}
                    onClick={downloadStamped}
                    title="Download the GPS-stamped evidence photo"
                  >
                    <Icon name="download" /> Evidence JPG
                  </button>

                  {analysis.originalUrl && (
                    <a
                      href={analysis.originalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="sitevision-btn"
                      style={{
                        background: "#e4ddcc",
                        color: "#44403c",
                        textDecoration: "none",
                        display: "inline-block",
                        textAlign: "center",
                      }}
                      title="Open the untouched original (clean evidence, no AI boxes)"
                    >
                      <Icon name="image" /> Original
                    </a>
                  )}

                  <button
                    className="sitevision-btn"
                    style={{
                      background: "#e4ddcc",
                      color: "#44403c",
                    }}
                    onClick={retakePhoto}
                  >
                    <Icon name="camera" /> New Photo Upload
                  </button>

                </div>

                <p className="sitevision-demo-note">
                  Real YOLOv8-PPE inference{analysis.model ? ` · ${analysis.model}` : ""} — never 100%.
                  Low-confidence detections are excluded from compliance and need human review.
                </p>

              </div>

            )}

          </div>

        )}

        {/* SITE PHOTO REGISTER — the reason uploads are useful: every
            stamped photo stays retrievable per project + zone with its
            verdict, instead of dying in a camera roll. Select any two
            for a before/after progress compare. */}
        {mode === "photo" && (
          <div className="sitevision-upload-card" style={{ marginTop: "18px" }}>
            <h3><Icon name="folder" /> Site Photo Register — {projectName}</h3>
            <p style={{ color: "#64748b", fontSize: "12px" }}>
              {photoRegister.length === 0
                ? "No filed photos yet for this project. Analyze one above and it lands here with GPS + verdict."
                : `${photoRegister.length} filed photo(s). Tick any two for a before/after compare — best for concealed work (rebar/MEP before close-up) and progress claims.`}
            </p>

            {complianceTrend(photoRegister).length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                  margin: "10px 0",
                }}
              >
                <span style={{ fontSize: "12px", color: "#64748b" }}>
                  Helmet-compliance trend:
                </span>
                {complianceTrend(photoRegister).map((c) => (
                  <span
                    key={c.id}
                    title={`Observation #${c.id} · ${c.label || "undated"}`}
                    style={{
                      fontSize: "12px",
                      padding: "4px 10px",
                      borderRadius: "999px",
                      background: c.compliance >= 80 ? "#dcfce7" : "#fee2e2",
                      color: c.compliance >= 80 ? "#166534" : "#b91c1c",
                    }}
                  >
                    #{c.id}: {c.compliance}%
                  </span>
                ))}
              </div>
            )}

            {photoRegister.length > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "12px",
                  marginTop: "10px",
                }}
              >
                {photoRegister.map((o) => {
                  const d = o.details || {};
                  const thumb = d.original_url || d.annotated_url;
                  const comp = d.helmet_compliance_pct;
                  const taken = d.photo_taken_at
                    ? new Date(d.photo_taken_at).toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                      })
                    : (o.created_at || "").slice(0, 10);
                  return (
                    <div
                      key={o.id}
                      style={{
                        border:
                          compareIds.includes(o.id)
                            ? "2px solid #f59e0b"
                            : "1px solid #e2e8f0",
                        borderRadius: "10px",
                        overflow: "hidden",
                        background: "#fff",
                      }}
                    >
                      {thumb ? (
                        <button
                          type="button"
                          className="register-thumb-btn"
                          onClick={() => setSelectedObs(o)}
                          aria-label={`Open evidence #${o.id} (${o.area || "Site"})`}
                        >
                          <img
                            src={thumb}
                            alt=""
                          />
                        </button>
                      ) : (
                        <div
                          style={{
                            height: "120px",
                            background: "#f1f5f9",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#94a3b8",
                          }}
                        >
                          No preview
                        </div>
                      )}
                      <div style={{ padding: "8px 10px", fontSize: "12px" }}>
                        <div>
                          <strong>#{o.id}</strong> · {o.area || "Site"} · {taken}
                        </div>
                        <div style={{ color: "#475569", marginTop: "2px" }}>
                          {o.title}
                        </div>
                        <div
                          style={{
                            marginTop: "4px",
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {comp != null && (
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: "999px",
                                background:
                                  comp >= 80 ? "#dcfce7" : "#fee2e2",
                                color:
                                  comp >= 80 ? "#166534" : "#b91c1c",
                              }}
                            >
                              <Icon name="helmet" /> {comp}%
                            </span>
                          )}
                          {d.provenance_source === "exif" ? (
                            <span title="Timestamp + GPS from inside the photo file">
                              <Icon name="camera" /> EXIF
                            </span>
                          ) : (
                            <span title="Upload-time evidence (no EXIF in file)">
                              <Icon name="phone" /> upload
                            </span>
                          )}
                        </div>
                        <label
                          style={{
                            display: "flex",
                            gap: "6px",
                            alignItems: "center",
                            marginTop: "6px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={compareIds.includes(o.id)}
                            onChange={() => toggleCompare(o.id)}
                          />
                          Compare
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* BEFORE / AFTER COMPARE */}
            {compareObs.length === 2 && (
              <div
                style={{
                  marginTop: "16px",
                  padding: "12px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "10px",
                }}
              >
                <h4 style={{ margin: "0 0 8px" }}>
                  Before / After — #{compareObs[0].id} vs #{compareObs[1].id}
                  {" "}({compareObs[0].area || "Site"} · progress evidence)
                </h4>
                <div className="compare-grid">
                  {compareObs.map((o) => (
                    <div key={o.id}>
                      <img
                        src={
                          o.details?.original_url ||
                          o.details?.annotated_url
                        }
                        alt={`Compare #${o.id}`}
                        style={{ width: "100%", borderRadius: "8px" }}
                      />
                      <p style={{ fontSize: "12px", color: "#57534e" }}>
                        <strong>#{o.id}</strong> ·{" "}
                        {o.details?.photo_taken_at
                          ? new Date(
                              o.details.photo_taken_at
                            ).toLocaleString("en-IN")
                          : (o.created_at || "").slice(0, 10)}{" "}
                        · {o.title}
                        {o.details?.photo_lat != null &&
                          ` · GPS ${Number(o.details.photo_lat).toFixed(4)}, ${Number(o.details.photo_lon).toFixed(4)}`}
                      </p>
                    </div>
                  ))}
                </div>
                <button
                  className="sitevision-btn"
                  style={{
                    background: "#e4ddcc",
                    color: "#44403c",
                    fontSize: "13px",
                    marginTop: "8px",
                  }}
                  onClick={() => setCompareIds([])}
                >
                  Clear compare
                </button>
              </div>
            )}

            {/* EVIDENCE MODAL */}
            {selectedObs && (
              <EvidenceModal
                obs={selectedObs}
                onClose={closeEvidence}
                onToggleCompare={toggleCompareFromModal}
                compared={compareIds.includes(selectedObs.id)}
                compareFull={compareIds.length >= 2}
              />
            )}
          </div>
        )}

      </div>

    </div>
  );
}

export default SiteVision;