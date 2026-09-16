import { useState } from "react";
import { Icon } from "./icons";

/* Phase 10 — pending AI incident review.
   The model proposes, a supervisor disposes: Confirm (verified violation,
   joins the risk engine as fact) or Dismiss (closed, kept for audit).
   Nothing here claims the AI is correct — that is the reviewer's call. */

function PendingIncidentCard({ incidentId, summary, area }) {
  const [state, setState] = useState("pending"); // pending|working|confirmed|dismissed
  const [armDismiss, setArmDismiss] = useState(false);
  const [error, setError] = useState("");

  if (!incidentId) return null;

  const decide = async (action) => {
    // Dismiss is a write that closes the finding — require a second tap.
    if (action === "dismiss" && !armDismiss) {
      setArmDismiss(true);
      return;
    }
    setArmDismiss(false);
    setState("working");
    setError("");
    try {
      const res = await fetch(`/api/safety_issues/${incidentId}/${action}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `Could not ${action} the incident.`);
      setState(data.status === "dismissed" ? "dismissed" : "confirmed");
    } catch (err) {
      setError(err.message);
      setState("pending");
    }
  };

  return (
    <div
      className="alert-item warning"
      role="status"
      style={{ marginTop: "12px" }}
    >
      <div className="alert-icon" aria-hidden="true">
        <Icon name={state === "confirmed" ? "check" : state === "dismissed" ? "xmark" : "alert"} />
      </div>
      <div>
        {state === "pending" || state === "working" ? (
          <>
            <strong>
              {summary} — pending incident #{incidentId} needs your confirmation
            </strong>
            <p>
              Detected in {area || "Site"}. The AI proposes, you dispose: confirm it as a
              verified violation, or dismiss it. Either way the decision is recorded.
            </p>
            {error && (
              <p className="voice-error" role="alert">
                {error}
              </p>
            )}
            <div className="voice-controls">
              <button
                type="button"
                className="voice-primary-btn"
                disabled={state === "working"}
                onClick={() => decide("confirm")}
              >
                <Icon name="check" /> Confirm violation
              </button>
              <button
                type="button"
                className="voice-secondary-btn"
                disabled={state === "working"}
                onClick={() => decide("dismiss")}
              >
                <Icon name="xmark" /> {armDismiss ? "Click again to dismiss" : "Dismiss"}
              </button>
            </div>
          </>
        ) : state === "confirmed" ? (
          <>
            <strong>Incident #{incidentId} confirmed</strong>
            <p>Verified violation — it now feeds risk scores, recurrence and the heatmap.</p>
          </>
        ) : (
          <>
            <strong>Incident #{incidentId} dismissed</strong>
            <p>Rejected by a supervisor — closed, kept for audit.</p>
          </>
        )}
      </div>
    </div>
  );
}

export default PendingIncidentCard;
