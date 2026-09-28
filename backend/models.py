"""Model discovery, loading and inference (TensorFlow/Keras, lazily imported).

The registry-driven design lets the app boot and serve the full UI even when
TensorFlow or model artifacts are absent — every consumer surfaces honest
"unavailable" states instead of fabricated predictions.
"""
import logging
import os
import time

from flask import current_app

logger = logging.getLogger(__name__)

_state = {
    "tf": None,              # cached tensorflow module (or False when absent)
    "keras_models": {},      # model_id -> loaded keras model
    "labels": None,          # class index -> human label
}


# --------------------------------------------------------------------------- #
# Labels
# --------------------------------------------------------------------------- #
def _labels_path() -> str:
    return os.path.join(current_app.config["MODEL_DIR"], "labels.json")


def load_labels():
    """Return {index: label} from models/artifacts/labels.json, or None."""
    if _state["labels"] is not None:
        return _state["labels"]
    path = _labels_path()
    if not os.path.isfile(path):
        logger.info("labels.json not found at %s", path)
        _state["labels"] = {}
        return _state["labels"]
    try:
        import json

        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        # Accept either a list or {"0": "Tomato ___", ...} mapping.
        if isinstance(data, list):
            labels = {i: str(name) for i, name in enumerate(data)}
        elif isinstance(data, dict):
            if "classes" in data and isinstance(data["classes"], list):
                labels = {i: str(n) for i, n in enumerate(data["classes"])}
            else:
                labels = {int(k): str(v) for k, v in data.items()}
        else:
            labels = {}
        _state["labels"] = labels
        return labels
    except Exception:  # noqa: BLE001 — never let label parsing kill the API
        logger.exception("Failed to parse labels.json")
        _state["labels"] = {}
        return _state["labels"]


def split_label(label: str):
    """Split 'Tomato - Early Blight' / 'Tomato___Early_blight' into crop, disease."""
    raw = (label or "").strip()
    for sep in (" - ", " — ", "___", "__", ": "):
        if sep in raw:
            crop, disease = raw.split(sep, 1)
            return crop.replace("_", " ").strip(), disease.replace("_", " ").strip()
    if " " in raw:
        # Fall back to first word as crop.
        parts = raw.split(" ", 1)
        return parts[0], parts[1].replace("_", " ").strip()
    return raw, ""


# --------------------------------------------------------------------------- #
# Registry / availability
# --------------------------------------------------------------------------- #
def registry():
    return current_app.config["MODEL_REGISTRY"]


def model_filepath(model_id: str):
    entry = registry().get(model_id)
    if not entry:
        return None
    path = entry["file"]
    return path if os.path.isabs(path) else os.path.join(current_app.config["MODEL_DIR"], path)


def model_available(model_id: str) -> bool:
    fp = model_filepath(model_id)
    return bool(fp) and os.path.isfile(fp)


def get_model(model_id: str):
    """Return the Keras model for model_id or None (missing artifact / TF)."""
    if model_id not in registry():
        return None
    if model_id in _state["keras_models"]:
        return _state["keras_models"][model_id]
    if not model_available(model_id):
        return None
    tf = _tensorflow()
    if tf is None:
        return None
    try:
        model = tf.keras.models.load_model(model_filepath(model_id), compile=False)
        _state["keras_models"][model_id] = model
        logger.info("Loaded model '%s' from %s", model_id, model_filepath(model_id))
        return model
    except Exception:  # noqa: BLE001
        logger.exception("Failed to load model '%s'", model_id)
        return None


def _tensorflow():
    """Import TensorFlow lazily; cache result (False = not installed)."""
    if _state["tf"] is not None:
        return _state["tf"]
    try:
        import tensorflow as tf  # type: ignore

        os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        _state["tf"] = tf
    except Exception as exc:  # noqa: BLE001 — ImportError and friends
        logger.warning("TensorFlow unavailable: %s", exc)
        _state["tf"] = False
    return _state["tf"]


def tf_available() -> bool:
    return _tensorflow() is not False


def status_payload() -> dict:
    reg = []
    for model_id, entry in registry().items():
        reg.append(
            {
                "id": model_id,
                "label": entry["label"],
                "available": model_available(model_id),
                "file": entry["file"],
            }
        )
    return {
        "tensorflow": tf_available(),
        "models": reg,
        "any_model_available": any(m["available"] for m in reg),
        "labels_loaded": bool(load_labels()),
        "gradcam_enabled": bool(current_app.config["GRADCAM_ENABLED"]),
        "severity_enabled": True,
    }


# --------------------------------------------------------------------------- #
# Inference
# --------------------------------------------------------------------------- #
def preprocess(img, size):
    """RGB float32 batch of shape (1, h, w, 3)."""
    img_resized = img.resize(size, image_resample())
    arr = np.asarray(img_resized, dtype="float32")
    return arr[None, ...]


def image_resample():
    """Pillow ≥10 moved ANTIALIAS to Resampling.LANCZOS; fall back gracefully."""
    from PIL import Image

    return getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def predict(model_id: str, img):
    """Run a real forward pass. Returns (result_dict, http_status)."""
    import numpy as np  # local import; only needed on the predict path

    entry = registry().get(model_id)
    if not entry:
        return {"ok": False, "error": "unknown_model", "message": "Unknown model id."}, 400

    model = get_model(model_id)
    if model is None:
        reason = (
            "TensorFlow is not installed on the server."
            if not tf_available()
            else f"The trained model file '{entry['file']}' was not found on the server."
        )
        return {
            "ok": False,
            "error": "model_unavailable",
            "message": reason + " Upload trained artifacts to enable predictions.",
        }, 503

    labels = load_labels()
    if not labels:
        return {
            "ok": False,
            "error": "labels_unavailable",
            "message": "Class labels (labels.json) were not found on the server.",
        }, 503

    size = tuple(entry["input"])
    x = preprocess(img, size)

    started = time.perf_counter()
    try:
        preds = model.predict(x, verbose=0)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Inference failed for model '%s'", model_id)
        return {"ok": False, "error": "inference_failed", "message": f"Model inference failed: {exc}"}, 500
    inference_ms = (time.perf_counter() - started) * 1000.0

    probs = np.asarray(preds[0], dtype="float64").ravel()
    total = float(probs.sum())
    if total <= 0 or not np.isfinite(total):
        return {"ok": False, "error": "inference_failed", "message": "Model produced an invalid probability distribution."}, 500
    probs = probs / total

    top_idx = int(np.argmax(probs))
    order = np.argsort(probs)[::-1][:5]
    top5 = [
        {
            "index": int(i),
            "label": labels.get(int(i), f"Class {int(i)}"),
            "confidence": round(float(probs[i]) * 100.0, 2),
        }
        for i in order
    ]

    label = labels.get(top_idx, f"Class {top_idx}")
    crop, disease = split_label(label)
    confidence = round(float(probs[top_idx]) * 100.0, 2)

    return {
        "ok": True,
        "prediction": {
            "class_index": top_idx,
            "label": label,
            "crop": crop,
            "disease": disease,
            "confidence": confidence,
        },
        "model": {"id": model_id, "label": entry["label"]},
        "top_predictions": top5,
        "inference_time_ms": round(inference_ms, 1),
        "input_size": list(size),
    }, 200
