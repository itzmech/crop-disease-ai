"""REST API consumed by the frontend. Every route returns parseable JSON."""
import json
import logging
import os

from flask import Blueprint, current_app, jsonify, request

from backend import evaluation, gradcam, models as model_layer, severity

logger = logging.getLogger(__name__)

api = Blueprint("api", __name__, url_prefix="/api")


def _ok(payload, status=200):
    payload.setdefault("ok", True)
    return jsonify(payload), status


def _err(code, message, status):
    return jsonify({"ok": False, "error": code, "message": message}), status


# --------------------------------------------------------------------------- #
# Health / status
# --------------------------------------------------------------------------- #
@api.get("/health")
def health():
    return _ok({"status": "healthy", "service": "LeafLens AI"})


@api.get("/status")
def status():
    return _ok(model_layer.status_payload())


# --------------------------------------------------------------------------- #
# Prediction
# --------------------------------------------------------------------------- #
def _read_upload():
    """Validate and open the uploaded image. Returns (PIL.Image, None) or (None, response)."""
    if "image" not in request.files:
        return None, _err("no_file", "No image file was provided. Send a multipart form field named 'image'.", 400)
    fs = request.files["image"]
    if not fs or not fs.filename:
        return None, _err("no_file", "The uploaded file has no filename.", 400)

    data = fs.read()
    if not data:
        return None, _err("empty_file", "The uploaded file is empty.", 400)

    try:
        from PIL import Image

        img = Image.open(io_bytes(data))
        img.load()
    except Exception:
        return None, _err("invalid_image", "The file could not be read as an image (JPG/PNG expected).", 400)

    fmt = (img.format or "").upper()
    if fmt not in {"JPEG", "JPG", "PNG"}:
        img = img.convert("RGB")  # accept HEIC/WebP/etc. by transcoding; flag it
    if img.mode not in {"RGB", "L"}:
        img = img.convert("RGB")

    # Downscale very large images for Grad-CAM / severity performance.
    max_dim = current_app.config["GRADCAM_MAX_UPLOAD_DIM"]
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), model_layer.image_resample())
    return img.convert("RGB"), None


def io_bytes(data: bytes):
    import io

    return io.BytesIO(data)


@api.post("/predict")
def predict():
    img, err = _read_upload()
    if err:
        return err
    model_id = (request.form.get("model") or "").strip().lower()
    if not model_id:
        return _err("model_required", "A 'model' form field is required (e.g. efficientnetb0).", 400)

    result, status = model_layer.predict(model_id, img)
    if status != 200:
        return jsonify(result), status

    # Severity piggybacks on the same call so the results dashboard is complete.
    severity_payload = severity.estimate_severity(img)
    result["severity"] = severity_payload
    return _ok(result)


@api.post("/severity")
def severity_endpoint():
    img, err = _read_upload()
    if err:
        return err
    payload = severity.estimate_severity(img)
    if payload.get("available"):
        return _ok(payload)
    return jsonify({"ok": False, **payload}), 422


# --------------------------------------------------------------------------- #
# Grad-CAM
# --------------------------------------------------------------------------- #
@api.post("/gradcam")
def gradcam_endpoint():
    img, err = _read_upload()
    if err:
        return err
    model_id = (request.form.get("model") or "").strip().lower()
    if not model_id:
        return _err("model_required", "A 'model' form field is required (e.g. efficientnetb0).", 400)

    payload, status = gradcam.generate(img, model_id)
    return jsonify(payload), status


# --------------------------------------------------------------------------- #
# Model comparison / history / confusion matrix
# --------------------------------------------------------------------------- #
@api.get("/models/comparison")
def models_comparison():
    return _ok(evaluation.comparison())


@api.get("/models/<model_id>/evaluation")
def model_evaluation(model_id):
    row = evaluation.evaluation_for(model_id)
    if row is None:
        return _err("unknown_model", "Unknown model id.", 404)
    if not row.get("available"):
        return jsonify({"ok": False, "error": "evaluation_not_available",
                        "message": "Train and evaluate this model to view results."}), 404
    return _ok(row)


@api.get("/models/<model_id>/history")
def model_history(model_id):
    payload = evaluation.history(model_id)
    return jsonify(payload), 200 if payload.get("ok") else 404


@api.get("/models/history/available")
def models_with_history():
    return _ok({"models": evaluation.available_history_models()})


@api.get("/models/<model_id>/confusion-matrix")
def model_confusion(model_id):
    payload = evaluation.confusion_matrix(model_id)
    return jsonify(payload), 200 if payload.get("ok") else 404


# --------------------------------------------------------------------------- #
# Dataset info
# --------------------------------------------------------------------------- #
@api.get("/dataset")
def dataset():
    path = current_app.config["DATASET_INFO_PATH"]
    if not os.path.isfile(path):
        return jsonify({
            "ok": False,
            "error": "dataset_info_unavailable",
            "message": "Dataset information has not been registered yet. Add data/dataset_info.json.",
        }), 404
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        return _err("dataset_info_invalid", f"dataset_info.json could not be parsed: {exc}", 500)
    if not isinstance(data, dict):
        return _err("dataset_info_invalid", "dataset_info.json must be a JSON object.", 500)
    return _ok(data)
