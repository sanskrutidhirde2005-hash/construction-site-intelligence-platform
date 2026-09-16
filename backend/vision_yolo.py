"""BuildSafe Vision v2 — YOLOv8-PPE + OpenCV plumbing (helmet-only v1).

Safety-engineering posture (world-class safety company, not a demo):
  * Never claim 100%. Single-frame mAP is bounded (~0.74-0.92 in published
    PPE work); system reliability comes from association + temporal voting +
    a low-confidence human-review queue, all auditable per track.
  * Fail-safe degradation: if the PPE checkpoint is missing/unloadable we
    raise so the caller falls back to legacy HOG+HSV and flags
    degraded=true / needs_review=true. Nothing is ever reported SAFE on a
    degraded path without human review.
  * Every result carries model_version + conf/iou thresholds + device so any
    observation row is reproducible in an incident review.
  * Sparse-upload tracking note: uploads are sampled at ~1fps by seeking, so
    motion continuity is broken. A Kalman/ByteTrack tracker is the wrong tool
    here (it assumes dense frames). We use an IoU-association tracker across
    samples + 2-of-3 temporal voting to kill single-frame flicker.
    ByteTrack (dense) is reserved for the future live RTSP phase.

Pipeline per clip:
  1. Sample frames evenly (~1fps, capped) with cv2.VideoCapture.
  2. YOLOv8-PPE inference (person + helmet / no_helmet).
  3. Person<->PPE association by head-zone overlap (top of person box), NOT
     colour blobs — hi-vis vests / yellow machines must not vote as helmets.
  4. IoU tracker across samples -> stable track IDs + per-track vote.
  5. OpenCV annotate (green=helmet, red=no_helmet, yellow=review) + save.
  6. Same JSON shape as legacy vision.py plus per_track[], model metadata.

Interim mode: if only a generic COCO checkpoint is available (person, no
helmet head), person boxes come from YOLO and helmet verdicts fall back to
the legacy HSV helmet_state() on the head band. Method string always says
which path ran.
"""

import os

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Config (env-overridable, logged into every result for audit)
# ---------------------------------------------------------------------------

CONF_DEFAULT = float(os.getenv("YOLO_CONF", "0.25"))
IOU_DEFAULT = float(os.getenv("YOLO_IOU", "0.45"))
IMGSZ_DEFAULT = int(os.getenv("YOLO_IMGSZ", "640"))
# Person-box threshold is SEPARATE from the PPE verdict threshold above.
# Rationale (measured on real site footage, yolov8n CPU): at conf 0.25 the
# person class fires 5-8 boxes/frame on scaffolding false positives;
# at 0.5 it stabilises at 2-4, matching dense-HOG range. Photos have no
# temporal vote to suppress flicker, and video counts sum per-frame boxes,
# so person counting defaults to 0.5 on both paths while PPE verdicts keep
# the wider 0.25 base + 0.25-0.5 human-review band below.
PERSON_CONF_DEFAULT = float(os.getenv("YOLO_PERSON_CONF", "0.5"))
# 0.25 < conf < 0.5 -> yellow review queue (blur / dark / tiny helmets).
REVIEW_LOW, REVIEW_HIGH = 0.25, 0.5
# Temporal voting: 2-of-3 frames must agree before a no_helmet alert sticks.
VOTE_WINDOW, VOTE_MIN = 3, 2
# Track association across sparse samples.
TRACK_IOU_MIN = 0.15

_MODEL = None
_MODEL_INFO = None


def _candidate_paths():
    env = os.getenv("YOLO_MODEL_PATH", "").strip()
    here = os.path.dirname(os.path.abspath(__file__))
    cands = []
    if env:
        cands.append(env if os.path.isabs(env) else os.path.join(here, "..", env))
        cands.append(env)
    cands += [
        os.path.join(here, "models", "ppe-yolov8s-v1.pt"),
        os.path.join(here, "..", "backend", "models", "ppe-yolov8s-v1.pt"),
        "ppe-yolov8s-v1.pt",
        # CPU default first: yolov8n is ~3x faster than -s per frame and its
        # person recall already dwarfs HOG (truncation/mask/small persons).
        # Weights live in backend/models/ so downloads don't depend on cwd.
        os.path.join(here, "models", "yolov8n.pt"),
        os.path.join(here, "..", "backend", "models", "yolov8n.pt"),
        "yolov8n.pt",
        os.path.join(here, "models", "yolov8s.pt"),
        "yolov8s.pt",  # generic fallback (person only -> interim HSV helmet)
    ]
    return cands


def get_device():
    """cuda > mps > cpu. Safe to call without torch installed."""
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        mps = getattr(torch.backends, "mps", None)
        if mps is not None and mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _normalize_cls(name):
    """Map the zoo of public PPE label names to canonical helmet-only set.

    Handles: helmet / hardhat / hard_hat / hard-hat / helmet_on / with_helmet
    vs no_helmet / no-hardhat / without_helmet / helmet_off, plus SHEL5K
    bare-'head' (= evidence of NO helmet) and plain 'person'.
    """
    n = str(name).strip().lower().replace("-", "_").replace(" ", "_")
    n_nospace = n.replace("_", "")
    if n in ("person", "people", "pedestrian") or n_nospace == "person":
        return "person"
    if "person" in n_nospace and "helmet" not in n_nospace and "hardhat" not in n_nospace:
        return "person"
    is_headwear = (
        "helmet" in n_nospace or "hardhat" in n_nospace or "hardhat" in n or "helmet" in n
    )
    if n in ("head", "barehead", "head_no_helmet", "headnohelmet"):
        return "no_helmet"
    if is_headwear:
        neg = (
            "no" in n.split("_")
            or n_nospace.startswith("no")
            or "without" in n_nospace
            or "missing" in n_nospace
            or "absent" in n_nospace
            or n_nospace.endswith("off")
            or "_off" in n
        )
        return "no_helmet" if neg else "helmet"
    if n_nospace in ("head", "barehead"):
        return "no_helmet"
    return None  # vest/gloves/mask/boots/etc — ignored in helmet-only v1


def is_yolo_available():
    """True if `ultralytics` imports (weights may still need download)."""
    try:
        import ultralytics  # noqa: F401

        return True
    except Exception:
        return False


def get_model():
    """Lazy-load YOLO singleton. Returns (model, info). Raises on failure."""
    global _MODEL, _MODEL_INFO
    if _MODEL is not None:
        return _MODEL, _MODEL_INFO
    try:
        from ultralytics import YOLO
    except Exception as e:
        raise RuntimeError(f"ultralytics not installed: {e}")
    last_err = None
    for p in _candidate_paths():
        try:
            m = YOLO(p)
            names = getattr(m, "names", {}) or {}
            canon = {_normalize_cls(v) for v in names.values()}
            has_helmet = bool({"helmet", "no_helmet"} & canon)
            has_person = "person" in canon
            device = get_device()
            try:
                m.to(device)
            except Exception:
                device = "cpu"
            _MODEL = m
            _MODEL_INFO = {
                "model_path": str(p),
                "model_version": os.path.splitext(os.path.basename(str(p)))[0],
                "device": device,
                "classes": list(names.values())[:24],
                "has_helmet_head": bool(has_helmet),
                "has_person": bool(has_person),
                "interim_hsv_helmet": bool(has_person and not has_helmet),
            }
            return _MODEL, _MODEL_INFO
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"No YOLO weights loadable (tried candidates): {last_err}")


def get_model_info():
    try:
        _, info = get_model()
        return {"available": True, **info}
    except Exception as e:
        return {"available": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Geometry helpers (pure, unit-testable)
# ---------------------------------------------------------------------------

def _iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + bh, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _head_zone(person_box, frame_shape):
    """Head search zone: top of person box, reaching above the box top since
    detectors often cut at the neck, clipped to frame."""
    x, y, w, h = person_box
    H, W = frame_shape[:2]
    y0 = max(0, int(y - 0.18 * h))
    y1 = min(H, int(y + 0.32 * h))
    x0, x1 = max(0, int(x)), min(W, int(x + w))
    return (x0, y0, max(0, x1 - x0), max(0, y1 - y0))


def _overlap_score(ppe_box, head_zone):
    """max(IoU, containment-weighted) so small helmets inside a big head zone
    still associate even when raw IoU is modest."""
    iou = _iou(ppe_box, head_zone)
    _, _, pw, ph = ppe_box
    ppe_area = max(1, pw * ph)
    hx, hy, hw, hh = head_zone
    x1, y1 = max(ppe_box[0], hx), max(ppe_box[1], hy)
    x2, y2 = min(ppe_box[0] + pw, hx + hw), min(ppe_box[1] + ph, hy + hh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    containment = inter / float(ppe_area)
    return max(iou, 0.5 * containment)


def _associate(persons, ppes, frame_shape):
    """Per-person verdict from head-zone-overlapping PPE boxes.

    persons: [(x,y,w,h), ...]; ppes: [{box, kind, conf}].
    Fail-safe: no overlapping PPE evidence -> 'unclear' (needs review),
    never 'helmet'. Low-conf evidence (0.25-0.5) -> 'unclear' + review flag.
    """
    out = []
    for pb in persons:
        hz = _head_zone(pb, frame_shape)
        best_h = best_n = None
        for p in ppes:
            s = _overlap_score(p["box"], hz)
            if s < 0.08:
                continue
            if p["kind"] == "helmet" and (best_h is None or p["conf"] > best_h["conf"]):
                best_h = p
            elif p["kind"] == "no_helmet" and (best_n is None or p["conf"] > best_n["conf"]):
                best_n = p
        ch = best_h["conf"] if best_h else 0.0
        cn = best_n["conf"] if best_n else 0.0
        if best_h is None and best_n is None:
            out.append({"verdict": "unclear", "conf": 0.0, "needs_review": True})
        elif ch >= REVIEW_HIGH and ch >= cn:
            out.append({"verdict": "helmet", "conf": float(ch), "needs_review": False})
        elif cn >= REVIEW_HIGH and cn > ch:
            out.append({"verdict": "no_helmet", "conf": float(cn), "needs_review": False})
        else:
            out.append({
                "verdict": "unclear",
                "conf": float(max(ch, cn)),
                "needs_review": True,
            })
    return out


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def _predict_frame(model, frame_bgr, conf, iou, imgsz, person_conf=None):
    """Run one frame. Returns (persons, ppes) with pixel boxes.

    Single inference at min(conf, person_conf); persons then filtered to
    person_conf, PPE boxes to conf — one NMS, two calibrated thresholds.
    """
    pconf = conf if person_conf is None else float(person_conf)
    res = model.predict(frame_bgr, conf=min(float(conf), pconf),
                        iou=iou, imgsz=imgsz, verbose=False)
    if not res:
        return [], []
    r = res[0]
    names = getattr(r, "names", getattr(model, "names", {})) or {}
    persons, ppes = [], []
    boxes = getattr(r, "boxes", None)
    if boxes is None:
        return [], []
    try:
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)
    except Exception:
        return [], []
    H, W = frame_bgr.shape[:2]
    for (x1, y1, x2, y2), cf, ci in zip(xyxy, confs, clss):
        raw = names.get(int(ci), str(ci)) if isinstance(names, dict) else str(ci)
        kind = _normalize_cls(raw)
        if kind is None:
            continue
        x1i, y1i = max(0, int(x1)), max(0, int(y1))
        x2i, y2i = min(W, int(x2)), min(H, int(y2))
        if x2i <= x1i or y2i <= y1i:
            continue
        box = (x1i, y1i, x2i - x1i, y2i - y1i)
        if kind == "person":
            if float(cf) < pconf:
                continue
            if box[2] < 12 or box[3] < 24:
                continue
            persons.append(box)
        else:
            ppes.append({"box": box, "kind": kind, "conf": float(cf), "raw": str(raw)})
    return persons, ppes


def _legacy_hsv_verdicts(frame_bgr, persons):
    """Interim path: YOLO person boxes + legacy HSV helmet judge."""
    try:
        from backend.vision import helmet_state as _hsv
    except ImportError:
        try:
            from vision import helmet_state as _hsv  # type: ignore
        except ImportError:
            return [{"verdict": "unclear", "conf": 0.0,
                     "needs_review": True, "interim": True} for _ in persons]
    out = []
    for pb in persons:
        try:
            v = _hsv(frame_bgr, pb)
        except Exception:
            v = "unclear"
        out.append({
            "verdict": v,
            "conf": 0.0,
            "needs_review": v == "unclear",
            "interim": True,
        })
    return out


def _track_and_vote(tracks, persons, verdicts, next_id):
    """Greedy IoU association across sparse samples + history.

    tracks: [{id, box, history:[verdicts], verdict, conf}].
    Returns (assignments [(person_idx, track_id, voted_verdict, voted_conf)],
             next_id). Vote = majority of last VOTE_WINDOW; ties keep current.
    """
    order = sorted(range(len(persons)),
                   key=lambda i: persons[i][2] * persons[i][3], reverse=True)
    used = set()
    assign = {}
    for i in order:
        best, best_s = None, TRACK_IOU_MIN
        for tr in tracks:
            if tr["id"] in used:
                continue
            s = _iou(persons[i], tr["box"])
            if s > best_s:
                best, best_s = tr, s
        if best is None:
            tr = {"id": next_id, "box": persons[i], "history": [],
                  "conf_hist": [], "verdict": verdicts[i]["verdict"], "conf": 0.0}
            tracks.append(tr)
            assign[i] = tr
            next_id += 1
        else:
            best["box"] = persons[i]
            assign[i] = best
            used.add(best["id"])
    out = []
    for i in range(len(persons)):
        tr = assign[i]
        tr["history"].append(verdicts[i]["verdict"])
        tr["history"] = tr["history"][-VOTE_WINDOW:]
        tr.setdefault("conf_hist", []).append(float(verdicts[i]["conf"]))
        tr["conf_hist"] = tr["conf_hist"][-VOTE_WINDOW:]
        hist = tr["history"]
        # majority vote; require VOTE_MIN agreement to flip to no_helmet
        counts = {v: hist.count(v) for v in set(hist)}
        voted = max(counts, key=lambda v: (counts[v], hist[::-1].index(v)))
        if voted == "no_helmet" and counts[voted] < min(VOTE_MIN, len(hist)):
            voted = verdicts[i]["verdict"] if verdicts[i]["verdict"] != "no_helmet" else "unclear"
        tr["verdict"] = voted
        # voted conf = mean conf of window frames agreeing with vote
        cfs = [c for vv, c in zip(hist, tr["conf_hist"]) if vv == voted]
        tr["conf"] = float(sum(cfs) / len(cfs)) if cfs else float(verdicts[i]["conf"])
        out.append((i, tr["id"], voted, tr["conf"]))
    return out, next_id


_COLORS = {"helmet": (0, 200, 0), "no_helmet": (0, 0, 255), "unclear": (0, 215, 255)}


def _annotate(frame, persons, verdicts, track_ids):
    for (x, y, w, h), v, tid in zip(persons, verdicts, track_ids):
        color = _COLORS.get(v["verdict"], (0, 215, 255))
        cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
        label = f"{v['verdict'].replace('_', ' ')} {v['conf']:.2f} #{tid}"
        if v.get("needs_review"):
            label += " REVIEW"
        cv2.putText(frame, label, (x, max(0, y - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)


def analyze_video(path, out_dir=None, url_prefix="", max_samples=36,
                   max_saved_frames=8, conf=None, iou=None, imgsz=None,
                   person_conf=None):
    """YOLOv8 video analysis. Same outer shape as legacy vision.analyze_video
    plus per_track[], model/version/device/threshold metadata."""
    conf = CONF_DEFAULT if conf is None else float(conf)
    iou = IOU_DEFAULT if iou is None else float(iou)
    imgsz = IMGSZ_DEFAULT if imgsz is None else int(imgsz)
    person_conf = (PERSON_CONF_DEFAULT if person_conf is None
                   else float(person_conf))
    model, info = get_model()  # raises -> caller fail-safes to legacy

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("Could not open video file for analysis.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = (total / fps) if fps else 0.0
    if total <= 0:
        cap.release()
        raise ValueError("Video contains no readable frames.")
    n = max(1, min(max_samples, total))
    indices = [int(round(i * (total - 1) / max(1, n - 1))) for i in range(n)]
    if n == 1:
        indices = [0]
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    interim = bool(info.get("interim_hsv_helmet"))
    tracks, next_id = [], 1
    timeline, saved, alerts = [], [], []
    persons_tot = helmets = no_helmets = unclear = review_n = 0
    motion_vals, prev_small = [], None
    save_every = max(1, n // max_saved_frames)

    for k, idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        t_sec = idx / fps if fps else 0.0
        persons, ppes = _predict_frame(model, frame, conf, iou, imgsz,
                                       person_conf)
        if interim:
            verdicts = _legacy_hsv_verdicts(frame, persons)
        else:
            assoc = _associate(persons, ppes, frame.shape)
            verdicts = [{**a, "needs_review": a["verdict"] == "unclear"} for a in assoc]
        assignments, next_id = _track_and_vote(tracks, persons, verdicts, next_id)
        # voted verdicts drive everything downstream (flicker-free)
        voted_by_person = {i: (v, c) for i, _, v, c in assignments}
        tids = [assignments[j][1] if j < len(assignments) else 0 for j in range(len(persons))]
        final = []
        for j, vd in enumerate(verdicts):
            vv, vc = voted_by_person.get(j, (vd["verdict"], vd["conf"]))
            final.append({"verdict": vv, "conf": float(vc),
                          "needs_review": vv == "unclear"})
        _annotate(frame, persons, final, tids)

        n_h = sum(1 for v in final if v["verdict"] == "helmet")
        n_no = sum(1 for v in final if v["verdict"] == "no_helmet")
        n_un = sum(1 for v in final if v["verdict"] == "unclear")
        persons_tot += len(persons)
        helmets += n_h
        no_helmets += n_no
        unclear += n_un
        review_n += sum(1 for v in final if v.get("needs_review"))

        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (320, 180))
        mv = float(np.mean(cv2.absdiff(small, prev_small))) if prev_small is not None else 0.0
        prev_small = small
        motion_vals.append(mv)
        timeline.append({"t": round(t_sec, 1), "workers": len(persons),
                         "helmets": n_h, "no_helmet": n_no,
                         "unclear": n_un, "motion": round(mv, 1)})
        if n_no > 0:
            alerts.append({"t": round(t_sec, 1),
                           "issue": (f"{n_no} worker(s) without helmet after "
                                     f"{VOTE_WINDOW}-frame vote — verify PPE at ~{round(t_sec, 1)}s")})
        if out_dir and (k % save_every == 0) and len(saved) < max_saved_frames:
            fname = f"frame_{k:03d}_t{int(t_sec)}s.jpg"
            cv2.imwrite(os.path.join(out_dir, fname), frame,
                        [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            url = f"{url_prefix}/{fname}" if url_prefix else fname
            saved.append((url, t_sec))
    cap.release()
    if not timeline:
        raise ValueError("No frames could be decoded from this video.")
    for a in alerts:
        if saved:
            a["frame"] = min(saved, key=lambda s: abs(s[1] - a["t"]))[0]

    samples = len(timeline)
    judged = helmets + no_helmets
    compliance = round(100.0 * helmets / judged, 1) if judged else None
    avg_workers = round(persons_tot / samples, 1)
    peak_workers = max(s["workers"] for s in timeline)
    avg_motion = float(np.mean(motion_vals)) if motion_vals else 0.0
    activity = int(round(100.0 * min(1.0, avg_motion / 12.0)))

    per_track = [{"track_id": tr["id"], "verdict": tr["verdict"],
                  "conf": round(float(tr.get("conf", 0.0)), 3),
                  "frames_seen": len(tr["history"])} for tr in tracks]

    events = []
    if persons_tot == 0:
        events.append("No workers detected in sampled frames — site may be idle or the camera view is obstructed.")
    else:
        events.append(f"Workers present in {sum(1 for s in timeline if s['workers'])} of {samples} "
                      f"samples (peak {peak_workers}, {len(tracks)} unique individual(s) tracked).")
        if interim:
            events.append("Interim engine: YOLO person boxes + HSV helmet judge (PPE checkpoint not loaded) — treat as provisional, review yellow boxes.")
        if compliance is not None and compliance < 80:
            events.append(f"⚠️ Safety review: helmet compliance {compliance}% is below the 80% site threshold ({no_helmets} voted no-helmet sighting(s)).")
        elif compliance == 100 and judged:
            events.append("Full helmet compliance observed in all judged detections (after temporal vote).")
        if unclear:
            events.append(f"{unclear} sighting(s) need human review (low-conf / no PPE evidence) — excluded from compliance, check yellow boxes.")
    if activity >= 60:
        events.append(f"High site activity (score {activity}/100) — active work in progress.")
    elif activity <= 15 and persons_tot:
        events.append(f"Low movement (score {activity}/100) with workers present — possible briefing, break or idle time.")

    method = ("YOLOv8-PPE (person+helmet/no_helmet) + head-zone association + "
              f"{VOTE_WINDOW}-frame vote; " + ("interim HSV helmet judge; " if interim else "") +
              "green=helmet, red=no_helmet (voted), yellow=needs review.")
    return {
        "duration_sec": round(duration, 1), "fps": round(float(fps), 1),
        "samples": samples, "avg_workers": avg_workers, "peak_workers": peak_workers,
        "unique_persons": len(tracks), "motion_added_sightings": 0,
        "activity_score": activity, "helmet_compliance_pct": compliance,
        "persons_detected": persons_tot, "helmets_detected": helmets,
        "no_helmet_detected": no_helmets, "unclear_detected": unclear,
        "needs_review": review_n, "timeline": timeline, "alerts": alerts,
        "events": events, "frames": [u for u, _ in saved],
        "per_track": per_track, "model": info["model_version"],
        "model_path": info["model_path"], "device": info["device"],
        "conf_thresh": conf, "iou_thresh": iou,
        "person_conf_thresh": person_conf, "interim_hsv_helmet": interim,
        "degraded": False, "method": method,
    }


def analyze_image(image_bgr, out_path=None, url=None, conf=None, iou=None, imgsz=None,
                  person_conf=None):
    """Single-photo inference. Returns boxes + verdicts + annotated save.

    Defaults to a larger inference size than video (960 vs 640): small /
    distant workers that vanish at 640 survive at 960 on a single CPU
    photo at acceptable cost. Override with YOLO_IMGSZ_PHOTO.
    Person counting uses person_conf (default 0.5, calibrated) — photos
    have no temporal vote, so the 0.25 base would overcount scaffolding.
    """
    conf = CONF_DEFAULT if conf is None else float(conf)
    iou = IOU_DEFAULT if iou is None else float(iou)
    person_conf = (PERSON_CONF_DEFAULT if person_conf is None
                   else float(person_conf))
    if imgsz is None:
        try:
            imgsz = int(os.getenv("YOLO_IMGSZ_PHOTO", "960"))
        except Exception:
            imgsz = 960
    else:
        imgsz = int(imgsz)
    model, info = get_model()
    interim = bool(info.get("interim_hsv_helmet"))
    persons, ppes = _predict_frame(model, image_bgr, conf, iou, imgsz,
                                   person_conf)
    if interim:
        verdicts = _legacy_hsv_verdicts(image_bgr, persons)
    else:
        verdicts = _associate(persons, ppes, image_bgr.shape)
    annotated = image_bgr.copy()
    tids = list(range(1, len(persons) + 1))
    _annotate(annotated, persons, verdicts, tids)
    if out_path:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        cv2.imwrite(out_path, annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    boxes = [{"box": list(map(int, b)), "verdict": v["verdict"],
              "conf": round(float(v["conf"]), 3),
              "needs_review": bool(v.get("needs_review"))}
             for b, v in zip(persons, verdicts)]
    n_h = sum(1 for v in verdicts if v["verdict"] == "helmet")
    n_no = sum(1 for v in verdicts if v["verdict"] == "no_helmet")
    n_un = sum(1 for v in verdicts if v["verdict"] == "unclear")
    judged = n_h + n_no
    return {
        "workers": len(persons), "helmets": n_h, "no_helmet": n_no, "unclear": n_un,
        "needs_review": sum(1 for v in verdicts if v.get("needs_review")),
        "compliance_pct": round(100.0 * n_h / judged, 1) if judged else None,
        "boxes": boxes, "annotated_url": url,
        "model": info["model_version"], "device": info["device"],
        "conf_thresh": conf, "iou_thresh": iou,
        "person_conf_thresh": person_conf,
        "interim_hsv_helmet": interim, "degraded": False,
    }
