# LeafLens AI

**AI-Based Crop Disease Detection and Severity Assessment Using Deep Learning and Explainable AI**
— final-year B.Tech project website + Flask-connected web interface.

Modern agricultural-AI frontend (custom design system, Chart.js) served by a Flask REST backend
that performs **real** inference, Grad-CAM explanation and image-processing severity estimation.
**No fake results anywhere:** when a model, metric or dataset file is missing, the UI shows an
honest empty/error state — never a fabricated number.

---

## 1. Quick start

```bash
# from the project root
python -m venv .venv
source .venv/Scripts/activate        # Windows Git Bash  (.venv\Scripts\activate on cmd)
pip install -r requirements.txt      # Flask + NumPy + Pillow (+ optional opencv)

python run.py                        # http://127.0.0.1:5000
```

For **live inference and Grad-CAM** also install the ML stack:

```bash
pip install tensorflow               # ~2 GB; only needed to serve models
```

> The site runs fully without TensorFlow — every AI feature then renders a proper
> "model unavailable" state, which is exactly what the no-fake-results policy requires.

## 2. Deploying to Vercel

The repository root contains **`app.py`**, which exposes the module-level `app` variable that
Vercel's Python runtime loads as the default entrypoint (`app.py:app`). It simply imports the
existing factory — the application is not duplicated anywhere.

1. Import this repo into Vercel (no build settings needed; `requirements.txt` supplies the deps).
2. Deploy. Routes, templates, static files and the `/api/*` endpoints all work as-is.

Vercel-specific limitations:

- **Serverless filesystem is read-only** — handled automatically: directory creation is skipped
  and no route writes to disk (uploads are processed fully in memory).
- **TensorFlow is not in `requirements.txt`** — on Vercel, `/api/predict` and `/api/gradcam`
  return honest `model_unavailable` states until you extend the runtime; the severity pipeline
  and the whole dashboard work without it.
- **Model/evaluation files are git-ignored** — register them in the repo or via `MODEL_DIR` if
  you want the comparison dashboard populated on Vercel.
- First request after a cold start may be slower (function cold boot).

## 3. Project layout

```
run.py                     dev server entrypoint
backend/
  app.py                   Flask app factory + page routes
  api.py                   /api/* blueprint (predict, severity, gradcam, comparison…)
  config.py                registry, paths, severity bands
  models.py                model registry, lazy TF loading, real inference
  gradcam.py               Grad-CAM (heatmap + overlay, JET colourmap)
  severity.py              Otsu leaf mask + lesion colour cues → affected-area %
  severity_config.py       severity band rules
  evaluation.py            loads evaluation/history/confusion JSON files
  errors.py                JSON error handlers
frontend/
  templates/base.html      layout, glass navbar, mobile nav, footer
  templates/pages/*.html   index, detect, severity, explainable, compare, research, about, 404
  static/css/leaflens.css  full design system (forest green / cream palette)
  static/js/               api.js, ui.js, nav.js + one script per page
  static/img/hero-leaf.svg hero artwork
models/
  artifacts/               <- put trained .keras models + labels.json here
  evaluation/              <- <model>.json test metrics
  history/                 <- <model>.json training history
  confusion/               <- <model>.json confusion matrix
data/
  dataset_info.template.json  copy to dataset_info.json and fill in
  uploads/                 runtime uploads (git-ignored)
```

## 4. Serving your trained models

Drop Keras files into `models/artifacts/` using the registered filenames
(configurable in `backend/config.py`):

| Model id        | File                    |
|-----------------|-------------------------|
| `cnn`           | `custom_cnn.keras`      |
| `resnet50`      | `resnet50.keras`        |
| `mobilenetv2`   | `mobilenet_v2.keras`    |
| `efficientnetb0`| `efficientnet_b0.keras` |

Add `models/artifacts/labels.json` — either a list
`["Tomato - Early Blight", …]` or `{"0": "Tomato - Early Blight", …}`.
Labels are split on ` - `, `___` or `__` into crop + disease for display.

Verify with:

```bash
curl http://127.0.0.1:5000/api/status
```

## 5. API reference

All endpoints return JSON. Errors use `{ "ok": false, "error": code, "message": … }`.

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/health` | liveness probe |
| GET  | `/api/status` | TF availability, registered models, flags |
| POST | `/api/predict` | multipart `image` + `model` → prediction, top-5, severity, latency |
| POST | `/api/severity` | multipart `image` → affected-area %, band, ratios |
| POST | `/api/gradcam` | multipart `image` + `model` → heatmap/overlay data-URLs |
| GET  | `/api/models/comparison` | all models' evaluation rows (availability flags) |
| GET  | `/api/models/<id>/evaluation` | one model's metrics |
| GET  | `/api/models/<id>/history` | training history series |
| GET  | `/api/models/history/available` | models that have history files |
| GET  | `/api/models/<id>/confusion-matrix` | matrix + labels + row-normalized view |
| GET  | `/api/dataset` | registered dataset facts |

### Response shapes

`POST /api/predict` (200):

```json
{
  "ok": true,
  "prediction": { "class_index": 3, "label": "Tomato - Early Blight",
                  "crop": "Tomato", "disease": "Early Blight", "confidence": 94.2 },
  "model": { "id": "efficientnetb0", "label": "EfficientNetB0" },
  "top_predictions": [ { "index": 3, "label": "Tomato - Early Blight", "confidence": 94.2 } ],
  "inference_time_ms": 141.7,
  "input_size": [224, 224],
  "severity": { "available": true, "percent": 18.6, "label": "Mild", "token": "mild",
                "lesion_ratio": 0.186, "leaf_ratio": 0.71,
                "method": "otsu_within_leaf_mask", "banding": "fixed_percent_bands",
                "disclaimer": "Severity represents the estimated visible affected leaf area …" }
}
```

Unavailability (503) — the frontend renders this as an honest error card:

```json
{ "ok": false, "error": "model_unavailable",
  "message": "The trained model file 'efficientnet_b0.keras' was not found on the server. …" }
```

## 6. Registering evaluation results (Model Comparison page)

`models/evaluation/<model_id>.json`:

```json
{
  "accuracy": 0.984, "precision": 0.981, "recall": 0.979, "f1": 0.980,
  "inference_time_ms": 41.3, "model_size_mb": 19.7, "parameters": 4300000,
  "evaluated_on": "test split (held-out 15%)"
}
```

`models/history/<model_id>.json` (Keras `History.history` accepted as-is):

```json
{ "history": {
    "accuracy": [0.71, 0.88, 0.93], "val_accuracy": [0.90, 0.94, 0.95],
    "loss": [0.92, 0.44, 0.28],     "val_loss": [0.41, 0.26, 0.21] } }
```

`models/confusion/<model_id>.json`:

```json
{ "labels": ["Tomato - Early Blight", "Tomato - Late Blight", "Tomato - Healthy"],
  "matrix": [[120, 3, 1], [2, 118, 4], [0, 2, 131]],
  "evaluated_on": "test split" }
```

`data/dataset_info.json` (copy from `data/dataset_info.template.json`):

```json
{ "name": "PlantVillage (subset)", "num_classes": 38, "num_images": 54305,
  "num_train": 38000, "num_val": 8000, "num_test": 8305 }
```

Filenames are matched loosely (e.g. `EfficientNetB0.json` works for `efficientnetb0`).

## 7. No-fake-results guarantees

- Prediction values, confidence, latency → **only** from `/api/predict` on the real model.
- Grad-CAM images → **only** from `/api/gradcam` (server-side autodiff), downloadable PNG.
- Severity → **only** from the image-processing pipeline; returns `available:false` with a
  reason when segmentation is unreliable.
- Comparison metrics, history, confusion matrices, dataset facts → **only** from the JSON
  files you register; missing files render "Evaluation not available" states.
- The home-page status strip reflects actual `/api/status` (TF installed? models present?).

## 8. Configuration

Environment variables (see `.env.example`): `SECRET_KEY`, `MAX_UPLOAD_MB`,
`MODEL_DIR`, `GRADCAM_ENABLED`, `GRADCAM_LAYER`, `GRADCAM_MAX_DIM`, `DATASET_INFO_PATH`.

Severity bands live in `backend/config.py` (`SEVERITY_BANDS`).

## 9. Tech stack

Flask 3 · Jinja2 · vanilla CSS design system (Sora/Inter/JetBrains Mono) ·
Chart.js 4 (CDN) · Pillow · NumPy · OpenCV (optional, better masks) · TensorFlow (optional,
serving only). No frontend framework, no build step.
