import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/* Voice daily update — Record → Transcribe → AI extract → Review → Save.
   The Type path reuses this same pipeline via startMode="transcript":
   DailyUpdates composes the typed form into transcript text and hands it
   here, so typed updates get the identical AI-extract → user-review →
   Confirm & Save loop. Nothing ever saves before the user confirms. */

const MAX_SECONDS = 300;

const blankStructured = (summary = "") => ({
  progress: [],
  materials: [],
  material_low: [],
  safety: [],
  tomorrow: [],
  other: [],
  locations: { building: "", floor: "", area: "" },
  summary,
});

function fmtClock(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function storedUserName() {
  try {
    const u = JSON.parse(localStorage.getItem("buildsafe_user") || "null");
    return u?.name || u?.email || null;
  } catch {
    return null;
  }
}

function VoiceUpdate({
  projectId,
  projectName,
  onSaved,
  onUseManual,
  // Phase 3 typed handoff: startMode="transcript" skips recording and opens
  // the editable transcript step prefilled with initialTranscript.
  startMode = "record",
  initialTranscript = "",
  // Saved verbatim on the inspection row: 'voice' | 'typed'.
  source = "voice",
  // Typed form's date wins when provided; otherwise today.
  logDate = null,
  siteId = null,
  // Phase 4: explicit overall-progress % from the typed form. Voice leaves
  // this null — progress is never guessed from prose.
  progressPct = null,
}) {
  const typedMode = startMode === "transcript";
  const [phase, setPhase] = useState(typedMode ? "transcript" : "idle"); // idle|recording|transcript|extracting|review|saving|done
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [transcript, setTranscript] = useState(initialTranscript);
  const [transcribing, setTranscribing] = useState(false);
  const [structured, setStructured] = useState(null);
  const [engine, setEngine] = useState(null);
  const [extractNote, setExtractNote] = useState("");
  const [area, setArea] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const recogRef = useRef(null);
  const finalRef = useRef("");
  const timerRef = useRef(null);
  const elapsedRef = useRef(0);
  const audioBlobRef = useRef(null);
  // WhatsApp-style live waveform (Web Audio only — no key, no network).
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);

  const stopWaveform = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      audioCtxRef.current?.close();
    } catch {
      /* already closed */
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  const drawWaveform = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    // The canvas only mounts after the phase flips to "recording", so the
    // loop looks it up every frame instead of once at startup.
    const render = () => {
      const canvas = canvasRef.current;
      const live = analyserRef.current;
      if (!live) return;
      rafRef.current = requestAnimationFrame(render);
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const W = canvas.width;
      const H = canvas.height;
      const BARS = 48;
      live.getByteFrequencyData(data);
      ctx.clearRect(0, 0, W, H);
      const bw = W / BARS;
      ctx.fillStyle = "#2e7d32";
      for (let i = 0; i < BARS; i++) {
        const bucket = Math.floor((i / BARS) * data.length * 0.7);
        const level = data[bucket] / 255;
        const h = Math.max(3, level * (H - 4));
        const x = i * bw + bw * 0.2;
        const y = (H - h) / 2;
        const w = Math.max(2, bw * 0.6);
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, w / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, w, h);
        }
      }
    };
    render();
  };

  const startWaveform = (stream) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      drawWaveform();
    } catch {
      /* waveform is decoration — recording works without it */
    }
  };

  const stopTracks = () => {
    try {
      (streamRef.current?.getTracks() || []).forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    streamRef.current = null;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Never leave the mic open (unmount / navigation safety).
  useEffect(() => {
    return () => {
      try {
        recogRef.current?.abort();
      } catch {
        /* not running */
      }
      try {
        if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      } catch {
        /* not recording */
      }
      stopTimer();
      stopWaveform();
      stopTracks();
    };
  }, []);

  const startRecording = async () => {
    setError("");
    setNote("");
    setLiveText("");
    finalRef.current = "";
    chunksRef.current = [];
    audioBlobRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "This browser cannot access the microphone. Type the update instead — nothing is lost."
      );
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in the browser address bar and try again — or type the update instead."
          : "Could not start the microphone (no device found?). Type the update instead."
      );
      return;
    }
    streamRef.current = stream;
    startWaveform(stream);

    try {
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(500);
      recorderRef.current = rec;
    } catch {
      stopTracks();
      setError("Recording failed to start on this device. Type the update instead.");
      return;
    }

    // Live transcription in parallel (free, no API key). If the browser
    // lacks it, the audio blob goes to the server transcriber on stop.
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      try {
        const r = new SR();
        r.lang = "en-IN";
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (ev) => {
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
            const text = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) finalRef.current += `${text} `;
            else interim += text;
          }
          setLiveText(`${finalRef.current}${interim}`.trim());
        };
        r.onerror = () => {
          /* live text just stays empty; server fallback covers it */
        };
        r.start();
        recogRef.current = r;
        setNote("Live transcription is on — speak clearly, one point at a time.");
      } catch {
        recogRef.current = null;
      }
    } else {
      setNote(
        "This browser has no live transcription — your recording will be transcribed on the server after you stop."
      );
    }

    elapsedRef.current = 0;
    setElapsed(0);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= MAX_SECONDS) stopRecording();
    }, 1000);
    setPaused(false);
    setPhase("recording");
  };

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      if (paused) {
        if (rec.state === "paused") rec.resume();
        try {
          recogRef.current?.start();
        } catch {
          /* recognition unavailable — audio keeps recording */
        }
        setPaused(false);
      } else {
        if (rec.state === "recording") rec.pause();
        try {
          recogRef.current?.stop();
        } catch {
          /* already stopped */
        }
        setPaused(true);
      }
    } catch {
      setError("Pause failed — you can stop and re-record, or type the update.");
    }
  };

  const uploadForTranscription = async (blob) => {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "voice-update.webm");
      const res = await fetch("/api/stt/transcribe", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Transcription failed.");
      setTranscript(data.transcript || "");
      setNote("Transcribed on the server — check every line before continuing.");
      setPhase("transcript");
    } catch (err) {
      setError(
        `${err.message} You can still type (or paste) the update below and continue — nothing is lost.`
      );
      setTranscript("");
      setPhase("transcript");
    }
    setTranscribing(false);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    stopTimer();
    try {
      recogRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recogRef.current = null;
    if (!rec || rec.state === "inactive") {
      finishWithLiveText();
      return;
    }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || "audio/webm",
      });
      audioBlobRef.current = blob.size > 0 ? blob : null;
      stopTracks();
      finishWithLiveText();
    };
    try {
      rec.stop();
    } catch {
      finishWithLiveText();
    }
  };

  const finishWithLiveText = () => {
    stopTracks();
    stopWaveform();
    const text = (finalRef.current || liveText || "").trim();
    if (text) {
      setTranscript(text);
      setNote("Check every line — speech recognition makes mistakes on site terms.");
      setPhase("transcript");
    } else if (audioBlobRef.current) {
      uploadForTranscription(audioBlobRef.current);
    } else {
      setError("No speech was captured. Try again closer to the mic — or type the update instead.");
      setPhase("idle");
    }
  };

  const runExtraction = async () => {
    const text = transcript.trim();
    if (!text) {
      setError("The transcript is empty — say something or type the update first.");
      return;
    }
    setError("");
    setPhase("extracting");
    try {
      const res = await fetch("/api/voice-updates/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, project_id: projectId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "AI extraction failed.");
      applyStructured(data.structured, data.engine, data.note || "");
    } catch (err) {
      // Fall back to a blank-but-editable review so the user is never stuck.
      setStructured(blankStructured(text.slice(0, 140)));
      setEngine("manual");
      setError(
        `${err.message} Showing a blank review form — fill it in from the transcript and save anyway.`
      );
      setPhase("review");
    }
  };

  const applyStructured = (s, eng, note = "") => {
    const clean = { ...blankStructured(), ...(s || {}) };
    clean.locations = {
      building: s?.locations?.building || "",
      floor: s?.locations?.floor || "",
      area: s?.locations?.area || "",
    };
    setStructured(clean);
    setBuilding(clean.locations.building);
    setFloor(clean.locations.floor);
    setArea(clean.locations.area);
    setEngine(eng);
    setExtractNote(note);
    setPhase("review");
  };

  const setItem = (key, idx, value) => {
    setStructured((prev) => {
      const next = { ...prev, [key]: [...prev[key]] };
      next[key][idx] = value;
      return next;
    });
  };

  const removeItem = (key, idx) => {
    setStructured((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== idx),
    }));
  };

  const setMaterial = (idx, patch) => {
    setStructured((prev) => {
      const next = { ...prev, materials: [...prev.materials] };
      next.materials[idx] = { ...next.materials[idx], ...patch };
      return next;
    });
  };

  const setSafety = (idx, patch) => {
    setStructured((prev) => {
      const next = { ...prev, safety: [...prev.safety] };
      next.safety[idx] = { ...next.safety[idx], ...patch };
      return next;
    });
  };

  const confirmAndSave = async () => {
    setError("");
    setPhase("saving");
    const payload = {
      project_id: projectId,
      transcript: transcript.trim(),
      structured: {
        ...structured,
        locations: { building, floor, area },
      },
      area: area || null,
      building: building || null,
      floor: floor || null,
      log_date: logDate || new Date().toISOString().slice(0, 10),
      submitted_by: storedUserName(),
      source,
      site_id: siteId,
      progress_pct: progressPct,
    };
    try {
      const res = await fetch("/api/voice-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Could not save the update.");
      setResult(data);
      setPhase("done");
    } catch (err) {
      setError(`${err.message} Your transcript and edits are kept — try again.`);
      setPhase("review");
    }
  };

  const resetAll = () => {
    setPhase(typedMode ? "transcript" : "idle");
    setPaused(false);
    setElapsed(0);
    setLiveText("");
    setTranscript(typedMode ? initialTranscript : "");
    setStructured(null);
    setEngine(null);
    setExtractNote("");
    setArea("");
    setBuilding("");
    setFloor("");
    setError("");
    setNote("");
    setResult(null);
    finalRef.current = "";
    audioBlobRef.current = null;
  };

  return (
    <div className="voice-update">
      <p className="voice-context">
        <Icon name="mic" /> Voice update for <strong>{projectName}</strong>
        {onUseManual && (
          <>
            {" "}·{" "}
            <button type="button" className="link-button" onClick={onUseManual}>
              type it instead
            </button>
          </>
        )}
      </p>

      {error && (
        <p className="voice-error" role="alert">
          {error}
        </p>
      )}

      {/* ---------- IDLE ---------- */}
      {phase === "idle" && (
        <div className="voice-idle">
          <button
            type="button"
            className="voice-record-btn"
            onClick={startRecording}
          >
            <Icon name="mic" /> Record Voice Update
          </button>
          <p className="voice-hint">
            Speak the day&apos;s progress, materials used, safety observations
            and tomorrow&apos;s plan. You review everything before it saves.
          </p>
        </div>
      )}

      {/* ---------- RECORDING ---------- */}
      {phase === "recording" && (
        <div className="voice-recording">
          <div className="voice-rec-status" aria-live="polite">
            <span
              className={`voice-rec-dot${paused ? " paused" : ""}`}
              aria-hidden="true"
            />
            <strong>{paused ? "Paused" : "Recording"}… {fmtClock(elapsed)}</strong>
          </div>
          <canvas
            ref={canvasRef}
            className="voice-wave"
            width="280"
            height="56"
            aria-hidden="true"
          />
          {(liveText || null) && (
            <p className="voice-live-text">{liveText}</p>
          )}
          {note && <p className="voice-note">{note}</p>}
          <div className="voice-controls">
            <button
              type="button"
              className="voice-secondary-btn"
              onClick={togglePause}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className="voice-stop-btn"
              onClick={stopRecording}
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ---------- TRANSCRIPT ---------- */}
      {(phase === "transcript" || transcribing) && (
        <div className="voice-step">
          <h4>
            {typedMode
              ? "Your update — read and check it"
              : "Transcript — read and correct it"}
          </h4>
          {transcribing ? (
            <p className="voice-note">Transcribing your recording…</p>
          ) : (
            <>
              <textarea
                className="voice-textarea"
                rows="5"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={
                  typedMode
                    ? "Describe today's progress, materials, safety and tomorrow's plan…"
                    : "What you said appears here — fix any misheard words."
                }
              />
              <div className="voice-controls">
                {!typedMode && (
                  <button
                    type="button"
                    className="voice-secondary-btn"
                    onClick={resetAll}
                  >
                    Re-record
                  </button>
                )}
                <button
                  type="button"
                  className="voice-primary-btn"
                  onClick={runExtraction}
                  disabled={!transcript.trim()}
                >
                  <Icon name="sparkles" /> Extract with AI
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- EXTRACTING ---------- */}
      {phase === "extracting" && (
        <div className="voice-step">
          <p className="voice-note" aria-live="polite">
            AI is reading the transcript — pulling out progress, materials,
            safety and plans. It never invents what you didn&apos;t say.
          </p>
        </div>
      )}

      {/* ---------- REVIEW ---------- */}
      {phase === "review" && structured && (
        <div className="voice-step">
          <h4>
            <span className="voice-ai-badge">AI EXTRACTED</span>
            {" "}Daily Update — confirm before saving
          </h4>
          <p className="voice-note">
            Engine: {engine === "llm" ? "AI model" : engine === "heuristic" ? "on-device rules" : "manual entry"}
            {" "}· edit anything wrong. Nothing saves until you confirm.
          </p>
          {extractNote && (
            <p className="voice-note" role="status">
              {extractNote}
            </p>
          )}

          <div className="voice-locations">
            <label>
              Area
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. B"
              />
            </label>
            <label>
              Building
              <input
                type="text"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="e.g. A"
              />
            </label>
            <label>
              Floor
              <input
                type="text"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="e.g. 3"
              />
            </label>
          </div>

          <VoiceSection
            title="Progress"
            items={structured.progress}
            empty="Nothing detected — the transcript said nothing about completed work."
            render={(text, i) => (
              <input
                type="text"
                value={text}
                onChange={(e) => setItem("progress", i, e.target.value)}
              />
            )}
            onRemove={(i) => removeItem("progress", i)}
          />

          <div className="voice-section">
            <h5>Materials</h5>
            {structured.materials.length === 0 && (
              <p className="voice-empty">No material usage detected.</p>
            )}
            {structured.materials.map((m, i) => (
              <div className="voice-material-row" key={i}>
                <input
                  type="text"
                  value={m.name}
                  onChange={(e) => setMaterial(i, { name: e.target.value })}
                  aria-label="Material name"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={m.qty ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setMaterial(i, { qty: v === "" ? null : Number(v) || null });
                  }}
                  placeholder="qty"
                  aria-label="Quantity"
                />
                <input
                  type="text"
                  value={m.unit || ""}
                  onChange={(e) => setMaterial(i, { unit: e.target.value })}
                  placeholder="unit"
                  aria-label="Unit"
                />
                <button
                  type="button"
                  className="voice-remove-btn"
                  onClick={() => removeItem("materials", i)}
                  aria-label={`Remove material ${m.name}`}
                >
                  <Icon name="xmark" />
                </button>
              </div>
            ))}
            {structured.material_low.map((line, i) => (
              <p className="voice-flag" key={`low-${i}`}>
                Low stock: {line}
                <button
                  type="button"
                  className="voice-remove-btn"
                  onClick={() => removeItem("material_low", i)}
                  aria-label="Remove stock flag"
                >
                  <Icon name="xmark" />
                </button>
              </p>
            ))}
          </div>

          <div className="voice-section">
            <h5>Safety</h5>
            {structured.safety.length === 0 && (
              <p className="voice-empty">No safety issues detected.</p>
            )}
            {structured.safety.map((s, i) => (
              <div className="voice-safety-row" key={i}>
                <input
                  type="text"
                  value={s.title}
                  onChange={(e) => setSafety(i, { title: e.target.value })}
                  aria-label="Safety issue"
                />
                <select
                  value={s.severity}
                  onChange={(e) => setSafety(i, { severity: e.target.value })}
                  aria-label="Severity"
                >
                  <option>High</option>
                  <option>Medium</option>
                  <option>Low</option>
                </select>
                <button
                  type="button"
                  className="voice-remove-btn"
                  onClick={() => removeItem("safety", i)}
                  aria-label="Remove safety issue"
                >
                  <Icon name="xmark" />
                </button>
              </div>
            ))}
          </div>

          <VoiceSection
            title="Next Day Plan"
            items={structured.tomorrow}
            empty="No plan for tomorrow detected."
            render={(text, i) => (
              <input
                type="text"
                value={text}
                onChange={(e) => setItem("tomorrow", i, e.target.value)}
              />
            )}
            onRemove={(i) => removeItem("tomorrow", i)}
          />

          {structured.other.length > 0 && (
            <VoiceSection
              title="Other Noted"
              items={structured.other}
              empty=""
              render={(text, i) => (
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setItem("other", i, e.target.value)}
                />
              )}
              onRemove={(i) => removeItem("other", i)}
            />
          )}

          <div className="voice-controls">
            <button
              type="button"
              className="voice-secondary-btn"
              onClick={() => setPhase("transcript")}
            >
              <Icon name="pen" /> Edit Transcript
            </button>
            <button
              type="button"
              className="voice-primary-btn"
              onClick={confirmAndSave}
            >
              <Icon name="check" /> Confirm &amp; Save
            </button>
          </div>
        </div>
      )}

      {/* ---------- SAVING ---------- */}
      {phase === "saving" && (
        <p className="voice-note" aria-live="polite">
          Saving to the daily update register…
        </p>
      )}

      {/* ---------- DONE ---------- */}
      {phase === "done" && result && (
        <div className="voice-step">
          <p className="voice-success" role="status">
            <Icon name="check" /> Saved as daily update #{result.inspection_id}
            {result.progress_updated &&
              ` — project progress ${result.progress_updated.from}% → ${result.progress_updated.to}%`}
            {(result.inventory_applied?.length > 0) &&
              ` — stock used: ${result.inventory_applied.map((a) => `${a.name} +${a.added} ${a.unit}`).join(", ")}`}
            {result.safety_issue_ids?.length > 0 &&
              ` — ${result.safety_issue_ids.length} safety issue(s) sent to the safety register`}
            {result.risk_ids?.length > 0 &&
              ` — ${result.risk_ids.length} risk(s) flagged`}
            . Ask the AI assistant about it any time.
          </p>
          <div className="voice-controls">
            <button
              type="button"
              className="voice-secondary-btn"
              onClick={resetAll}
            >
              Record Another
            </button>
            <button
              type="button"
              className="voice-primary-btn"
              onClick={() => onSaved?.(result)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceSection({ title, items, empty, render, onRemove }) {
  return (
    <div className="voice-section">
      <h5>{title}</h5>
      {items.length === 0 && empty ? (
        <p className="voice-empty">{empty}</p>
      ) : null}
      {items.map((item, i) => (
        <div className="voice-item-row" key={i}>
          {render(item, i)}
          <button
            type="button"
            className="voice-remove-btn"
            onClick={() => onRemove(i)}
            aria-label={`Remove ${title} item ${i + 1}`}
          >
            <Icon name="xmark" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default VoiceUpdate;
