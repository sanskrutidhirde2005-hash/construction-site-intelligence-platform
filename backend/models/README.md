# BuildSafe PPE weights (versioned, safety-critical)

This directory holds versioned YOLOv8 PPE checkpoints. Never overwrite a
released checkpoint in place — add a new `vN` file and point
`YOLO_MODEL_PATH` at it so every observation row stays traceable via
`details.model_version`.

## Layout

- `ppe-yolov8s-v1.pt` — v1 helmet-only baseline (YOLOv8s 640, laptop CPU/GPU hybrid).
- `ppe-yolov8m-v2.pt` — (future) server-accuracy promotion (YOLOv8m 640-896).

## Where to get v1 starter weights

Option A (recommended, helmet volume): fine-tune or direct-use a public PPE
checkpoint, then rename to `ppe-yolov8s-v1.pt`:

- Ultralytics Construction-PPE starter set (1416 imgs, 11 classes incl.
  hardhat / no-hardhat / person):
  https://github.com/ultralytics/ultralytics/blob/main/docs/en/datasets/detect/construction-ppe.md
- SHEL5K (5000 imgs, helmet/head/person — fixes person mis-labels):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8950768
- CHV real-site set (1330 imgs, 4 helmet colours + vest + person):
  https://github.com/ZijianWang-ZW/PPE_detection

Option B (cold start, no weights file present): the API **fail-safes** to the
legacy HOG+HSV engine (`backend/vision.py`) and returns
`method=legacy + degraded=true + needs_review=true` so nothing is ever
reported as SAFE on a degraded path without human review.

## Safety rules (ML engineer sign-off)

1. Every checkpoint ships with: training dataset hash, `imgsz`, per-class
   AP, confusion matrix, and hold-out result (200 site frames,
   mAP@0.5 >= 0.85 overall / >= 0.88 helmet) before it becomes `vN`.
2. `model_version` + `conf_thresh` + `iou_thresh` + `device` are written into
   every observation `details` JSON — audit trail is mandatory.
3. Retrain monthly on site failures (false positives from hi-vis vests /
   yellow machines, false negatives on dark / tiny / blurred helmets).
4. Never claim 100%. System reliability comes from temporal voting (2-of-3
   per track) + low-conf review queue (0.25 < conf < 0.5), not single-frame
   perfection.

## Env

```bash
YOLO_MODEL_PATH=backend/models/ppe-yolov8s-v1.pt
YOLO_CONF=0.25
YOLO_IOU=0.45
YOLO_IMGSZ=640
```
