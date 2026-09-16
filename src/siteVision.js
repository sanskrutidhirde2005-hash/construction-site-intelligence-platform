/**
 * Shared SiteVision helpers — single source of truth for turning raw
 * vision API responses into UI-ready risk/analysis objects.
 * Used by both SiteVision.jsx (GPS camera + video) and SiteVisionAI.jsx
 * (project upload) so the two panels can never disagree on wording,
 * severity, or safety copy.
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // backend cap: 15MB
export const MAX_VIDEO_BYTES = 150 * 1024 * 1024; // backend cap: 150MB

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Pre-upload guard for site photos. Returns an error string or null. */
export function validateImageFile(file) {
  if (!file) return "Please choose a site photo first.";
  const extOk = /\.(jpe?g|png|webp)$/i.test(file.name || "");
  if (!IMAGE_TYPES.includes(file.type) && !extOk) {
    return "Please upload a JPG, PNG or WEBP site photo.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `Photo is ${(file.size / 1048576).toFixed(1)} MB — max 15 MB. Retake at lower resolution.`;
  }
  return null;
}

/** Pre-upload guard for site videos. Returns an error string or null. */
export function validateVideoFile(file) {
  if (!file) return "Choose a site video file first.";
  const looksVideo =
    (file.type || "").startsWith("video/") ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(file.name || "");
  if (!looksVideo) return "Please upload a video file (MP4/MOV/AVI/MKV/WEBM).";
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video is ${(file.size / 1048576).toFixed(0)} MB — max 150 MB. Trim the clip and retry.`;
  }
  return null;
}

/**
 * Build the risk-alert list for a single-photo analysis response.
 * Mirrors backend severity posture: red only for judged no-helmet
 * evidence; everything provisional stays amber until a human clears it.
 */
export function buildPhotoRisks(data = {}) {
  const workers = data.workers ?? 0;
  const noHelmet = data.no_helmet ?? 0;
  const unclear = data.unclear ?? 0;
  const compliance = data.compliance_pct;
  const modelTag = `model ${data.model || "unknown"}${data.degraded ? ", DEGRADED — verify manually" : ""}`;

  const risks = [];
  if (workers === 0) {
    risks.push({
      level: "MEDIUM",
      title: "No workers detected",
      description:
        "No workers found in this frame — site may be idle, on break, or the camera view is obstructed. Recheck at an active work front.",
    });
  }
  if (noHelmet > 0) {
    risks.push({
      level: "HIGH",
      title: "PPE Compliance Issue",
      description:
        `${noHelmet} worker(s) without a detectable helmet (${modelTag}). ` +
        `Stop work for them and verify PPE before resuming. Review the annotated photo.`,
    });
  }
  if (unclear > 0 || data.degraded) {
    risks.push({
      level: "MEDIUM",
      title: "Human review needed",
      description:
        `${unclear} sighting(s) too low-confidence to judge (blur/dark/small head-covering)` +
        `${data.degraded ? " on a degraded fallback engine" : ""} — excluded from compliance, check yellow boxes.`,
    });
  }
  if (risks.length === 0) {
    risks.push({
      level: "LOW",
      title: "No helmet violations detected",
      description:
        compliance != null
          ? `All judged detections show helmets (${compliance}% compliance). Unclear cases: ${unclear}.`
          : "No judgable detections in this frame.",
    });
  }
  return risks;
}

/**
 * Build the full analysis object for a single-photo response
 * (SiteVisionAI panel shape).
 */
export function summarizeImageAnalysis(data = {}) {
  const workers = data.workers ?? 0;
  const helmets = data.helmets ?? 0;
  const noHelmet = data.no_helmet ?? 0;
  const unclear = data.unclear ?? 0;
  const compliance = data.compliance_pct;
  const judged = helmets + noHelmet;
  const risky = noHelmet > 0;
  const needsReview = unclear > 0 || !!data.degraded;

  return {
    riskLevel: risky ? "High" : needsReview ? "Medium" : "Low",
    confidence:
      compliance != null
        ? `${compliance}% helmet compliance (${helmets}/${judged} judged)`
        : workers === 0
          ? "No workers detected"
          : `${unclear} unclear — needs review`,
    detectedObjects: [
      `${workers} worker(s)`,
      `${helmets} helmet(s)`,
      ...(noHelmet ? [`${noHelmet} without helmet`] : []),
      ...(unclear ? [`${unclear} needs review`] : []),
    ],
    issues: [
      ...(noHelmet
        ? [{
            title: "Worker(s) without helmet",
            severity: "High",
            description:
              `${noHelmet} worker(s) without a detectable helmet. ` +
              `Verify PPE immediately (observation #${data.observation_id}).`,
          }]
        : []),
      ...(unclear || data.degraded
        ? [{
            title: "Human review required",
            severity: "Medium",
            description:
              `${unclear} low-confidence sighting(s)${data.degraded ? " on a degraded (fallback) engine" : ""} — ` +
              `a supervisor must clear the yellow review-queue boxes before sign-off.`,
          }]
        : []),
      ...(workers === 0
        ? [{
            title: "No workers detected",
            severity: "Low",
            description:
              "No workers found — site may be idle or the view is obstructed. Recheck at an active work front.",
          }]
        : []),
    ],
    recommendations: [
      ...(risky ? ["Stop work for unhelmeted workers and verify PPE before resuming."] : []),
      ...(needsReview ? ["A supervisor must clear the yellow review-queue boxes."] : []),
      "Verify PPE compliance for all workers on every shift (toolbox talk).",
      "Maintain clear access paths and housekeeping around the work front.",
    ],
    annotatedUrl: data.annotated_url || null,
    boxes: data.boxes || [],
    model: data.model || null,
    engine: data.engine || null,
    degraded: !!data.degraded,
    observationId: data.observation_id || null,
    // Phase 10: pending-AI-incident review (null when no violation fired).
    incidentId: data.incident_id ?? null,
    alertId: data.alert_id ?? null,
    safetyFlag: !!data.safety_flag,
    noHelmet: noHelmet,
  };
}

/** Compliance chips for the trend strip: last N observations with judged data. */
export function complianceTrend(observations = [], limit = 5) {
  return observations
    .filter(
      (o) =>
        o &&
        o.details &&
        typeof o.details === "object" &&
        o.details.helmet_compliance_pct != null
    )
    .slice(0, limit)
    .map((o) => ({
      id: o.id,
      compliance: o.details.helmet_compliance_pct,
      label: (o.created_at || "").slice(0, 10),
    }));
}

/** True when the GPS label is still a placeholder — never bake it into evidence. */
export function isPlaceholderLocation(loc = "") {
  return /getting|gps not supported|denied|unable/i.test(loc || "");
}

/**
 * Turn any failed vision-API response into readable text — never throws,
 * never shows "[object Object]", never says "unreadable".
 * Handles JSON {detail}, FastAPI 422 detail arrays, proxy HTML pages,
 * and empty bodies (backend down mid-request).
 */
function messageFromBodyText(text, status, fallback) {
  if (!text) {
    return (
      `${fallback} (HTTP ${status}, empty response — ` +
      `the server may have dropped the connection. Check the backend is running and retry.)`
    );
  }
  try {
    const data = JSON.parse(text);
    const d = data?.detail ?? data?.message;
    if (Array.isArray(d)) {
      const parts = d
        .map((x) => (typeof x === "string" ? x : x?.msg || JSON.stringify(x)))
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    } else if (typeof d === "string" && d.trim()) {
      return d;
    } else if (d != null) {
      return JSON.stringify(d);
    }
    return `${fallback} (HTTP ${status})`;
  } catch {
    // Non-JSON: proxy/crash HTML page or plain text. Strip tags, keep a snippet.
    const stripped = text
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    return (
      `${fallback} (HTTP ${status})` +
      (stripped
        ? `: ${stripped}`
        : ` — server returned a non-JSON response. Check the backend is running and retry.`)
    );
  }
}

/** fetch-path twin: reads the body once, always resolves to a message. */
export async function visionErrorMessage(res, fallback) {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return `${fallback} — could not read the server response. Check connection and retry.`;
  }
  return messageFromBodyText(text, res.status, fallback);
}

/** XHR twin for the upload-progress path (can't use fetch there). */
export function xhrVisionError(status, responseText, fallback) {
  return messageFromBodyText(responseText || "", status, fallback);
}

export const ZONE_PRESETS = [
  "Tower A",
  "Tower B",
  "Floor 4",
  "Basement",
  "Storage Yard",
  "Main Gate",
];
