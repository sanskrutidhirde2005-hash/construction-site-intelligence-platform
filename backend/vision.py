"""Real site-video analysis (CPU-only, no model downloads).

Pipeline per uploaded clip:
  1. Sample frames evenly (~1 fps, capped) with cv2.VideoCapture.
  2. Person detection = HOG people detector FUSED with motion-blob
     proposals (MOG2 background subtraction filtered to person-like
     shapes). HOG finds still/posed workers, motion blobs catch walking /
     crouched / side-view workers HOG misses. Either source can propose a
     box; near-duplicates are merged by IoU.
  3. Simple centroid tracker across samples -> unique persons seen.
   4. Helmet check per person (3-state): HSV segmentation over an expanded
      hard-hat colour set (yellow/white/red/orange/blue) in the head
      region -> 'helmet' | 'no_helmet' | 'unclear' (too dark/tiny/ambiguous
      to judge). White-driven evidence must be a large solid dome or it
      goes to 'unclear' — HSV cannot tell white cloth from a white helmet,
      and false-review beats false-SAFE.
   5. Motion energy -> site activity score. Frames with >30% foreground
      (handheld/panning camera) skip motion proposals to avoid background
      false person boxes, and are counted as unreliable_frames.
  6. Annotated frames (green = helmet, red = no helmet, yellow = unclear).

Nothing here is mocked: counts, timelines, compliance and alerts all come
from the actual pixels of the uploaded video.
"""

import os

import cv2
import numpy as np

# HSV ranges for hard-hat colours. White range is deliberately wide so
# shaded/dusty helmets still match; blue added for industrial sites, teal
# for cyan-green helmets (missed teal = missed compliance on real sites).
HELMET_RANGES = [
    ((20, 100, 100), (35, 255, 255)),  # yellow
    ((0, 0, 150), (180, 70, 255)),  # white / light grey
    ((0, 100, 100), (10, 255, 255)),  # red
    ((160, 100, 100), (180, 255, 255)),  # red (hue wrap)
    ((10, 100, 100), (20, 255, 255)),  # orange
    ((90, 80, 80), (130, 255, 255)),  # blue
    ((80, 80, 80), (95, 255, 255)),  # teal / cyan-green
]

_hog = None
_hog_unavailable = False


def get_detector():
    """Lazily build the HOG full-body people detector, or None if this
    OpenCV build lacks it (opencv>=5 removed cv2.HOGDescriptor).

    Callers MUST handle None by falling back to motion-blob proposals —
    a missing detector must degrade the pass, never 500 the analysis.
    """
    global _hog, _hog_unavailable
    if _hog is None and not _hog_unavailable:
        ctor = getattr(cv2, "HOGDescriptor", None)
        default_svm = getattr(cv2, "HOGDescriptor_getDefaultPeopleDetector", None)
        if ctor is None or default_svm is None:
            _hog_unavailable = True
            print("[vision] cv2.HOGDescriptor missing (removed in opencv 5.x) — "
                  "HOG disabled, motion-only degraded pass. "
                  "Fix: pip install \"opencv-python-headless>=4.14,<5\"")
            return None
        try:
            _hog = ctor()
            _hog.setSVMDetector(default_svm())
        except Exception as e:
            _hog_unavailable = True
            print(f"[vision] HOG init failed ({e}) — motion-only degraded pass.")
            return None
    return _hog


def hog_available():
    """True if this OpenCV build can run the HOG people detector."""
    return get_detector() is not None


def _hog_boxes(detector, gray, small, frame_shape, min_w, min_h,
               win_stride=(8, 8), scale=1.05):
    rects, weights = detector.detectMultiScale(
        gray, winStride=win_stride, padding=(8, 8), scale=scale
    )
    if len(rects) == 0:
        return []
    idxs = cv2.dnn.NMSBoxes(
        rects.tolist(), weights.flatten().tolist(), 0.3, 0.4
    )
    if len(idxs) == 0:
        return []
    sx = frame_shape[1] / float(small.shape[1])
    sy = frame_shape[0] / float(small.shape[0])
    boxes = []
    for (x, y, w, h) in rects[idxs.flatten()].tolist():
        if w > min_w and h > min_h:
            boxes.append((int(x * sx), int(y * sy), int(w * sx), int(h * sy)))
    return boxes


def helmet_state(frame_bgr, box, threshold=0.06, white_solo_min=0.12):
    """'helmet' | 'no_helmet' | 'unclear' for a person box.

    Searches a band reaching above the box top (detector boxes often cut
    off at the neck) while excluding most of the torso, so hi-vis vests
    cannot masquerade as helmets.

    Fail-safe white rule: HSV cannot distinguish a white cloth turban from
    a white helmet. Distinctive colours (yellow/red/orange/blue) above
    threshold vote 'helmet'; white-driven evidence must form a large SOLID
    dome (>= white_solo_min) to vote 'helmet', otherwise 'unclear' so a
    human decides. False-review is always preferable to false-SAFE.
    """
    x, y, w, h = box
    H, W = frame_bgr.shape[:2]
    y0 = max(0, y - int(0.45 * h))
    y1 = min(H, y + int(0.15 * h))
    x0, x1 = max(0, x), min(W, x + w)
    region = frame_bgr[y0:y1, x0:x1]
    if region.size == 0:
        return "unclear"
    rh, rw = region.shape[:2]
    if rh < 10 or rw < 10:
        return "unclear"
    if float(np.mean(cv2.cvtColor(region, cv2.COLOR_BGR2GRAY))) < 35:
        return "unclear"  # too dark to judge honestly
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    total = rh * rw
    kernel = np.ones((3, 3), np.uint8)
    white_lo, white_hi = HELMET_RANGES[1]  # white / light grey (ambiguous)
    white = cv2.morphologyEx(
        cv2.inRange(hsv, np.array(white_lo, dtype=np.uint8),
                    np.array(white_hi, dtype=np.uint8)),
        cv2.MORPH_OPEN, kernel)
    colored = None
    for lo, hi in HELMET_RANGES[:1] + HELMET_RANGES[2:]:  # distinctive colours
        part = cv2.inRange(
            hsv, np.array(lo, dtype=np.uint8), np.array(hi, dtype=np.uint8)
        )
        colored = part if colored is None else cv2.bitwise_or(colored, part)
    colored = cv2.morphologyEx(colored, cv2.MORPH_OPEN, kernel)
    ratio = cv2.countNonZero(cv2.bitwise_or(white, colored)) / float(total)
    if ratio <= threshold:
        return "no_helmet"
    if cv2.countNonZero(colored) / float(total) > threshold:
        return "helmet"  # distinctive helmet colour present
    if cv2.countNonZero(white) / float(total) >= white_solo_min:
        # Compactness gate: a real white dome is textured and bounded, but
        # pale SKY or walls fill the whole head zone uniformly bright.
        # Measured on site footage: sky fills score gradient-energy <20 at
        # V>220 with white-frac ~1.0, while true headwear scores 60+.
        # A uniform fill is not evidence — a human decides.
        white_frac = cv2.countNonZero(white) / float(total)
        if white_frac < 0.99 and min(rh, rw) >= 20:
            g = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
            gx = cv2.Sobel(g, cv2.CV_64F, 1, 0, ksize=3)
            gy = cv2.Sobel(g, cv2.CV_64F, 0, 1, ksize=3)
            if float(np.mean(np.sqrt(gx * gx + gy * gy))) < 25:
                return "unclear"  # uniform pale fill (sky/wall), not a dome
        elif white_frac >= 0.99:
            return "unclear"  # zone is entirely pale — no bounded object
        return "helmet"  # large solid white dome
    return "unclear"  # scrappy white: white helmet or cloth — human decides


def detect_people_hog(frame_bgr, sensitive=False):
    """Full-body HOG boxes in original-frame coordinates (high precision).

    Returns [] when this OpenCV build lacks HOG — the caller fuses with
    motion blobs, so an empty HOG set just means a motion-only pass.
    sensitive=True runs a denser pyramid (stride 4, scale 1.03) for the
    single-photo path where recall matters more than per-frame speed.
    """
    if get_detector() is None:
        return []
    small = frame_bgr
    if frame_bgr.shape[1] > 640:
        scale = 640.0 / frame_bgr.shape[1]
        small = cv2.resize(frame_bgr, (640, int(frame_bgr.shape[0] * scale)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    if sensitive:
        return _hog_boxes(get_detector(), gray, small, frame_bgr.shape,
                          25, 50, win_stride=(4, 4), scale=1.03)
    return _hog_boxes(get_detector(), gray, small, frame_bgr.shape, 25, 50)


def motion_boxes(frame_bgr, fg_mask, thresh=200):
    """Person-like moving-blob boxes.

    Shape filters allow stooped/bent workers; a hi-vis saturation gate
    rejects grey distractors (buckets, rebar, concrete) since site
    clothing is strongly saturated (orange/yellow vests, helmets).
    `thresh` adapts to the mask source (MOG2 vs median-diff).
    """
    H, W = frame_bgr.shape[:2]
    _, th = cv2.threshold(fg_mask, thresh, 255, cv2.THRESH_BINARY)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    th = cv2.dilate(th, np.ones((9, 9), np.uint8), iterations=1)
    found = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = found[0] if len(found) == 2 else found[1]
    sat = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w * h < 0.004 * W * H:
            continue
        if w * h > 0.08 * W * H:
            continue  # machinery / walls, not a person
        if w > 0.45 * W or h > 0.6 * H:
            continue
        if h < 0.8 * w:
            continue
        if not (0.07 * H < h < 0.95 * H):
            continue
        if w < 15:
            continue
        blob_sat = sat[y:y + h, x:x + w]
        if float(np.mean(blob_sat > 80)) < 0.12:
            continue  # grey object, not a worker
        boxes.append((int(x), int(y), int(w), int(h)))
    return boxes


def _iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + bh, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def _merge_boxes(hog_boxes, motion_boxes_list, iou_thresh=0.35):
    """Fuse both sources with full dedup: one box per person.

    HOG boxes win ties (higher precision); motion adds only genuinely
    new sightings. This also removes same-person duplicates that would
    otherwise double-count workers and produce conflicting helmet labels.
    """
    merged = [(b, "hog") for b in hog_boxes]
    added = 0
    for m in motion_boxes_list:
        if all(_iou(m, b) < iou_thresh for b, _ in merged):
            merged.append((m, "motion"))
            added += 1
    return merged, added


# ---------------------------------------------------------------------------
# Recall boosters: HOG provably misses (a) close-up / truncated workers —
# cropped torsos have no full silhouette (HOG evaluations note it "missed
# the obvious prediction of the person close to the camera ... one of the
# drawbacks of the HOG People Detector"); and (b) distant workers that
# shrink below HOG's minimum after the 640px downscale. Both are attacked
# with CPU-only, dependency-free proposers fused below:
#   * Denser HOG pyramid (stride 4, scale 1.03) in sensitive mode.
#   * Overlapping tiles at native resolution (SAHI pattern: 2x2 grid, 25%
#     overlap) — SAHI reports +5-7% AP from slicing alone on small-object
#     benchmarks.
#   * Haar face/profile cascades (shipped with OpenCV) — faces survive the
#     crops that kill HOG.
# Deliberately REJECTED (measured, do not re-add without ground truth):
#   * Haar upper/full-body cascades — 3-4 extra boxes/frame on real site
#     footage at any minNeighbors, mostly scaffolding/machinery rectangles.
#   * Saturated-helmet-dome search — 6-14 extra boxes/frame on brick sites
#     (red-brick walls fragment into dome-shaped patches); per-colour
#     rarity gating barely helped; YCrCb skin corroboration failed
#     calibration (brick/soil score up to 1.0 skin-fraction). Recall must
#     not come at the price of trust.
# Every proposer only ADDS boxes that no higher-priority source claimed
# (IoU dedup, plus intra-source dedup), so the fused count is monotonic:
# never below HOG-alone.
# ---------------------------------------------------------------------------

_cascades = {}


def _cascade(name):
    """Lazy Haar cascade singleton, or None if the XML is missing."""
    if name not in _cascades:
        try:
            c = cv2.CascadeClassifier(
                os.path.join(cv2.data.haarcascades, name))
            _cascades[name] = None if c.empty() else c
        except Exception:
            _cascades[name] = None
        if _cascades[name] is None:
            print(f"[vision] cascade {name} unavailable — proposer disabled.")
    return _cascades[name]


def _face_to_person(face, frame_shape):
    """Expand a face rect to an estimated person box (anthropometry:
    body ≈ 7x face height, ≈ 2.6x face width, face sits ~1.2 face-heights
    below the crown so the helmet band stays inside the box top)."""
    x, y, w, h = face
    H, W = frame_shape[:2]
    pw, ph = int(w * 2.6), int(h * 7.0)
    px = int(max(0, (x + w / 2) - pw / 2))
    py = int(max(0, y - 1.2 * h))
    pw = min(pw, W - px)
    ph = min(ph, H - py)
    if pw < 20 or ph < 60:
        return None
    return (px, py, pw, ph)


def _face_person_boxes(frame_bgr):
    """Person boxes derived from face detections (truncated-worker catcher)."""
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    out = []
    # minNeighbors=5 (conservative): face boxes feed the worker COUNT, so
    # precision first — scaffolding patterns already fool looser cascades.
    for name in ("haarcascade_frontalface_default.xml",
                 "haarcascade_profileface.xml"):
        c = _cascade(name)
        if c is None:
            continue
        try:
            found = c.detectMultiScale(
                gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24))
        except Exception:
            continue
        for (x, y, w, h) in found:
            p = _face_to_person((int(x), int(y), int(w), int(h)),
                                frame_bgr.shape)
            if p is not None:
                out.append(p)
    return out


def _dedup_boxes(boxes, iou_thresh=0.4):
    """Intra-source dedup: fragmented masks/cascades can fire several
    overlapping boxes for one person — keep the largest, drop the rest so
    one worker is never double-counted by a single proposer."""
    kept = []
    for b in sorted(boxes, key=lambda b: b[2] * b[3], reverse=True):
        if all(_iou(b, k) < iou_thresh for k in kept):
            kept.append(b)
    return kept


def _tiles(W, H, cols=2, rows=2, overlap=0.25):
    """Overlapping tile windows (x0, y0, x1, y1) over a WxH frame."""
    boxes = []
    tw, th = W / cols, H / rows
    ox, oy = tw * overlap, th * overlap
    for r in range(rows):
        for col in range(cols):
            x0 = int(max(0, col * tw - ox))
            y0 = int(max(0, r * th - oy))
            x1 = int(min(W, (col + 1) * tw + ox))
            y1 = int(min(H, (r + 1) * th + oy))
            boxes.append((x0, y0, x1, y1))
    return boxes


def _tiled_hog_boxes(frame_bgr):
    """Small-person catcher: HOG per overlapping tile at NATIVE resolution.

    Distant workers (e.g. roof crew) fall below HOG's 25x50px minimum after
    the 640px downscale; tiles keep them at detectable size. Skipped on
    small frames where the full-frame pass already sees everyone.
    """
    H, W = frame_bgr.shape[:2]
    if max(H, W) < 800 or get_detector() is None:
        return []
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    det = get_detector()
    out = []
    for (x0, y0, x1, y1) in _tiles(W, H):
        tile = gray[y0:y1, x0:x1]
        if tile.shape[1] < 100 or tile.shape[0] < 100:
            continue
        try:
            rects, weights = det.detectMultiScale(
                tile, winStride=(8, 8), padding=(8, 8), scale=1.05)
        except Exception:
            continue
        if len(rects) == 0:
            continue
        try:
            idxs = cv2.dnn.NMSBoxes(
                rects.tolist(), weights.flatten().tolist(), 0.3, 0.4)
        except Exception:
            continue
        if len(idxs) == 0:
            continue
        for (x, y, w, h) in rects[idxs.flatten()].tolist():
            if w >= 18 and h >= 40:
                out.append((x + x0, y + y0, w, h))
    return out


def _merge_fused(ranked, iou_thresh=0.35):
    """Fuse N proposers, highest-rank first.

    ranked: [([boxes], name), ...]. Returns (merged [(box, name)],
    {name: added_count}). Higher-rank boxes win ties; lower ranks only
    add genuinely new sightings — the fused count never drops below the
    top-ranked source alone.
    """
    merged, counts = [], {}
    for boxes, name in ranked:
        counts[name] = 0
        for b in boxes:
            if all(_iou(b, mb) < iou_thresh for mb, _ in merged):
                merged.append((b, name))
                counts[name] += 1
    return merged, counts


def detect_people_fused(frame_bgr, sensitive=True, include_tiles=True):
    """HOG + tiles + faces fusion for the single-photo path.

    Returns (merged [(box, source)], counts {source: added}). Monotonic:
    len(merged) >= len(HOG-alone) always — boosters can only add workers
    HOG missed, never remove or double-count (IoU dedup within + across
    sources).
    """
    hog = detect_people_hog(frame_bgr, sensitive=sensitive)
    tiles = _dedup_boxes(_tiled_hog_boxes(frame_bgr)
                         if (sensitive and include_tiles) else [])
    faces = _dedup_boxes(_face_person_boxes(frame_bgr))
    return _merge_fused([(hog, "hog"), (tiles, "tiles"), (faces, "face")])


def analyze_video(path, out_dir=None, url_prefix="", max_samples=36,
                  max_saved_frames=8):
    """Analyse a video file. Returns a JSON-serialisable result dict."""
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

    # Median background from spread-out frames. Unlike adaptive
    # subtractors (MOG2), a median needs no temporal continuity, so it
    # stays clean even though samples are reached by seeking.
    background = None
    try:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok0, probe = cap.read()
        if ok0 and probe is not None:
            PH, PW = probe.shape[:2]
            bw, bh = 320, max(1, int(probe.shape[0] * 320.0 / probe.shape[1]))
            med_n = min(24, total)
            stack = []
            for j in range(med_n):
                cap.set(cv2.CAP_PROP_POS_FRAMES,
                        int(round(j * (total - 1) / max(1, med_n - 1))))
                okm, fm = cap.read()
                if okm and fm is not None:
                    stack.append(cv2.resize(
                        cv2.cvtColor(fm, cv2.COLOR_BGR2GRAY), (bw, bh)))
            if stack:
                background = np.median(np.stack(stack), axis=0).astype(np.uint8)
    except Exception:
        background = None
    tracks = []  # dicts: id, cx, cy, last_k
    next_id = 1

    timeline = []
    saved = []  # (url, t)
    alerts = []
    prev_small = None
    persons = helmets = no_helmets = unclear = 0
    motion_added = 0
    unreliable_frames = 0
    motion_vals = []
    save_every = max(1, n // max_saved_frames)

    # Probe HOG once: a build without it (opencv>=5) runs a motion-only
    # degraded pass rather than crashing per frame.
    hog_ok = hog_available()

    for k, idx in enumerate(indices):
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        t_sec = idx / fps if fps else 0.0

        hog = detect_people_hog(frame) if hog_ok else []
        unreliable = False
        if background is not None:
            small_g = cv2.resize(
                cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY),
                (background.shape[1], background.shape[0]))
            diff_up = cv2.resize(
                cv2.absdiff(small_g, background),
                (frame.shape[1], frame.shape[0]))
            # Handheld/panning camera makes the whole frame "foreground" and
            # turns the mesh/scaffold into person boxes (false detections).
            # A few workers cover <10% of the frame; >30% means camera motion.
            if float(np.mean(diff_up > 25)) > 0.30:
                motion = []
                unreliable = True
                unreliable_frames += 1
            else:
                motion = motion_boxes(frame, diff_up, thresh=25)
        else:
            motion = []
        merged, added = _merge_boxes(hog, motion)
        motion_added += added

        # Track centroids across samples -> unique persons.
        centers = [(x + w / 2, y + h / 2) for (x, y, w, h), _ in merged]
        assigned = set()
        for ci, (cx, cy) in enumerate(centers):
            best, best_d = None, 150.0
            for tr in tracks:
                if tr["id"] in assigned or tr["last_k"] < k - 2:
                    continue
                d = ((cx - tr["cx"]) ** 2 + (cy - tr["cy"]) ** 2) ** 0.5
                if d < best_d:
                    best, best_d = tr, d
            if best is None:
                tracks.append({"id": next_id, "cx": cx, "cy": cy, "last_k": k})
                assigned.add(next_id)
                next_id += 1
            else:
                best.update(cx=cx, cy=cy, last_k=k)
                assigned.add(best["id"])

        states = []
        for (x, y, w, h), src in merged:
            st = helmet_state(frame, (x, y, w, h))
            states.append(st)
            color = {"helmet": (0, 200, 0), "no_helmet": (0, 0, 255),
                     "unclear": (0, 215, 255)}[st]
            cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(frame, st.replace("_", " "), (x, max(0, y - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        n_helmet = states.count("helmet")
        n_no = states.count("no_helmet")
        n_unclear = states.count("unclear")
        persons += len(merged)
        helmets += n_helmet
        no_helmets += n_no
        unclear += n_unclear

        small = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (320, 180))
        motion_v = (float(np.mean(cv2.absdiff(small, prev_small)))
                    if prev_small is not None else 0.0)
        prev_small = small
        motion_vals.append(motion_v)
        timeline.append({
            "t": round(t_sec, 1),
            "workers": len(merged),
            "helmets": n_helmet,
            "no_helmet": n_no,
            "unclear": n_unclear,
            "motion": round(motion_v, 1),
            "unreliable": unreliable,
        })

        if n_no > 0:
            alerts.append({
                "t": round(t_sec, 1),
                "issue": (f"{n_no} worker(s) without a detectable helmet — "
                          f"verify PPE at ~{round(t_sec, 1)}s"),
            })

        if out_dir and (k % save_every == 0) and len(saved) < max_saved_frames:
            fname = f"frame_{k:03d}_t{int(t_sec)}s.jpg"
            cv2.imwrite(os.path.join(out_dir, fname), frame,
                        [int(cv2.IMWRITE_JPEG_QUALITY), 82])
            url = f"{url_prefix}/{fname}" if url_prefix else fname
            saved.append((url, t_sec))

    cap.release()
    if not timeline:
        raise ValueError("No frames could be decoded from this video.")

    # Attach nearest saved frame to each alert for review.
    for a in alerts:
        if saved:
            a["frame"] = min(saved, key=lambda s: abs(s[1] - a["t"]))[0]

    samples = len(timeline)
    judged = helmets + no_helmets
    compliance = (round(100.0 * helmets / judged, 1) if judged else None)
    avg_workers = round(persons / samples, 1)
    peak_workers = max(s["workers"] for s in timeline)
    avg_motion = float(np.mean(motion_vals)) if motion_vals else 0.0
    activity = int(round(100.0 * min(1.0, avg_motion / 12.0)))

    events = []
    if not hog_ok:
        events.append("Degraded pass: HOG people detector unavailable in this OpenCV "
                      "build (opencv>=5 removed it) — motion-only detection misses "
                      "still workers. Re-run with opencv 4.x or YOLO weights, and "
                      "review all yellow boxes.")
    if persons == 0:
        events.append("No workers detected in sampled frames — site may be "
                      "idle or the camera view is obstructed.")
    else:
        events.append(f"Workers present in {sum(1 for s in timeline if s['workers'])} "
                      f"of {samples} samples (peak {peak_workers}, "
                      f"{next_id - 1} unique individual(s) tracked).")
        if motion_added:
            events.append(f"Motion tracking added {motion_added} worker sighting(s) "
                          f"the still-image detector missed.")
        if compliance is not None and compliance < 80:
            events.append(f"⚠️ Safety review: helmet compliance {compliance}% "
                          f"is below the 80% site threshold "
                          f"({no_helmets} unhelmeted sighting(s)).")
        elif compliance == 100 and judged:
            events.append("Full helmet compliance observed in all judged detections.")
        if unclear:
            events.append(f"{unclear} sighting(s) too dark/small/ambiguous to judge "
                          f"(incl. white head-coverings that HSV cannot tell from "
                          f"white helmets) — excluded from compliance, check yellow boxes.")
    if unreliable_frames:
        events.append(f"{unreliable_frames} of {samples} samples had camera motion "
                      f"(handheld/panning) — motion proposals skipped there to avoid "
                      f"background false detections; hold the camera steadier for "
                      f"better counts.")
    if activity >= 60:
        events.append(f"High site activity (score {activity}/100) — active work in progress.")
    elif activity <= 15 and persons:
        events.append(f"Low movement (score {activity}/100) with workers present — "
                      f"possible briefing, break or idle time.")

    return {
        "duration_sec": round(duration, 1),
        "fps": round(float(fps), 1),
        "samples": samples,
        "avg_workers": avg_workers,
        "peak_workers": peak_workers,
        "unique_persons": next_id - 1,
        "motion_added_sightings": motion_added,
        "activity_score": activity,
        "helmet_compliance_pct": compliance,
        "persons_detected": persons,
        "helmets_detected": helmets,
        "no_helmet_detected": no_helmets,
        "unclear_detected": unclear,
        "unreliable_frames": unreliable_frames,
        "timeline": timeline,
        "alerts": alerts,
        "events": events,
        "frames": [u for u, _ in saved],
        "method": ("Full-body HOG fused with saturated-motion-blob proposals + centroid "
                   "tracking; HSV hard-hat search above each box (helmet / no helmet / unclear); "
                   "frame-difference motion. Green box = helmet, red = no helmet, "
                   "yellow = unclear."
                   + ("" if hog_ok else " [HOG unavailable — motion-only degraded pass]")),
    }
