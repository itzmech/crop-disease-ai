"""Evaluation, training-history and confusion-matrix data loading.

All files are user-provided (produced by your training scripts). Nothing here
generates or embellishes numbers: a missing file yields a structured
"not available" payload that the frontend renders as an empty state.
"""
import json
import logging
import os
import re

from flask import current_app

logger = logging.getLogger(__name__)

_NORM_RE = re.compile(r"[^a-z0-9]+")


def _norm(s: str) -> str:
    return _NORM_RE.sub("", (s or "").lower())


def _first_file(directory, model_id, extensions):
    """Find `<model_id>.<ext>` or a file whose normalised stem matches."""
    if not os.path.isdir(directory):
        return None
    direct = os.path.join(directory, f"{model_id}.json")
    if os.path.isfile(direct):
        return direct
    for name in sorted(os.listdir(directory)):
        if not name.lower().endswith(tuple(extensions)):
            continue
        stem = os.path.splitext(name)[0]
        if _norm(stem) == _norm(model_id):
            return os.path.join(directory, name)
    return None


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not parse %s: %s", path, exc)
        return None
    if not isinstance(data, dict):
        logger.warning("Ignoring %s: expected a JSON object", path)
        return None
    return data


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and x not in (float("inf"), float("-inf")) else None  # NaN/inf guard


# --------------------------------------------------------------------------- #
# Model comparison
# --------------------------------------------------------------------------- #
def comparison() -> dict:
    rows = []
    for model_id, entry in current_app.config["MODEL_REGISTRY"].items():
        path = _first_file(current_app.config["EVALUATION_DIR"], model_id, (".json",))
        if not path:
            rows.append({"id": model_id, "label": entry["label"], "available": False})
            continue
        data = _read_json(path)
        if data is None:
            rows.append({"id": model_id, "label": entry["label"], "available": False, "error": "invalid_file"})
            continue

        acc = _num(data.get("accuracy") or data.get("test_accuracy"))
        prec = _num(data.get("precision"))
        rec = _num(data.get("recall"))
        f1 = _num(data.get("f1") or data.get("f1_score"))
        it = _num(data.get("inference_time_ms") or data.get("inference_ms"))
        size = data.get("model_size_mb", data.get("size_mb"))
        size = _num(size) if not isinstance(size, str) else None
        params = _num(data.get("parameters") or data.get("params"))

        # A row counts as available only if at least one real metric exists.
        if None in (acc, prec, rec, f1):
            rows.append({"id": model_id, "label": entry["label"], "available": False, "error": "incomplete_metrics"})
            continue

        rows.append(
            {
                "id": model_id,
                "label": entry["label"],
                "available": True,
                "accuracy": round(acc, 4) if acc is not None else None,
                "precision": round(prec, 4) if prec is not None else None,
                "recall": round(rec, 4) if rec is not None else None,
                "f1": round(f1, 4) if f1 is not None else None,
                "inference_time_ms": round(it, 1) if it is not None else None,
                "model_size_mb": round(size, 2) if size is not None else None,
                "parameters": int(params) if params is not None else None,
                "evaluated_on": data.get("evaluated_on") or data.get("dataset_split") or None,
            }
        )
    return {
        "ok": True,
        "any_available": any(r["available"] for r in rows),
        "models": rows,
    }


def evaluation_for(model_id: str):
    comp = comparison()
    for row in comp["models"]:
        if row["id"] == model_id:
            return row
    return None


# --------------------------------------------------------------------------- #
# Training history
# --------------------------------------------------------------------------- #
def history(model_id: str) -> dict:
    entry = current_app.config["MODEL_REGISTRY"].get(model_id)
    if not entry:
        return {"ok": False, "error": "unknown_model", "message": "Unknown model id."}

    path = _first_file(current_app.config["HISTORY_DIR"], model_id, (".json",))
    if not path:
        return {
            "ok": False,
            "error": "history_not_available",
            "message": f"No training history has been recorded for {entry['label']}.",
        }
    data = _read_json(path)
    if data is None:
        return {"ok": False, "error": "history_invalid", "message": "The history file could not be parsed."}

    hist = data.get("history", data)  # accept raw Keras history or {"history": {...}}
    if not isinstance(hist, dict):
        return {"ok": False, "error": "history_invalid", "message": "The history file has an unexpected structure."}

    def series(*keys):
        for k in keys:
            v = hist.get(k)
            if isinstance(v, list) and v:
                return [round(_num(x), 4) if _num(x) is not None else None for x in v]
        return []

    acc = series("accuracy", "acc")
    val_acc = series("val_accuracy", "val_acc")
    loss = series("loss")
    val_loss = series("val_loss")

    if not any([acc, val_acc, loss, val_loss]):
        return {"ok": False, "error": "history_empty", "message": "The history file contains no usable series."}

    return {
        "ok": True,
        "model": {"id": model_id, "label": entry["label"]},
        "epochs": len(max((s for s in (acc, val_acc, loss, val_loss) if s), key=len, default=[])),
        "series": {"accuracy": acc, "val_accuracy": val_acc, "loss": loss, "val_loss": val_loss},
    }


def available_history_models() -> list:
    out = []
    for model_id, entry in current_app.config["MODEL_REGISTRY"].items():
        h = history(model_id)
        if h.get("ok"):
            out.append({"id": model_id, "label": entry["label"]})
    return out


# --------------------------------------------------------------------------- #
# Confusion matrix
# --------------------------------------------------------------------------- #
def confusion_matrix(model_id: str) -> dict:
    entry = current_app.config["MODEL_REGISTRY"].get(model_id)
    if not entry:
        return {"ok": False, "error": "unknown_model", "message": "Unknown model id."}

    path = _first_file(current_app.config["CONFUSION_DIR"], model_id, (".json",))
    if not path:
        return {
            "ok": False,
            "error": "matrix_not_available",
            "message": f"No confusion matrix has been recorded for {entry['label']}.",
        }
    data = _read_json(path)
    if data is None:
        return {"ok": False, "error": "matrix_invalid", "message": "The confusion-matrix file could not be parsed."}

    matrix = data.get("matrix")
    labels = data.get("labels")
    if not isinstance(matrix, list) or not matrix or not all(isinstance(r, list) for r in matrix):
        return {"ok": False, "error": "matrix_invalid", "message": "Confusion matrix must be a 2-D array."}

    n = len(matrix)
    if any(len(r) != n for r in matrix):
        return {"ok": False, "error": "matrix_invalid", "message": "Confusion matrix must be square."}

    if isinstance(labels, list) and len(labels) == n:
        clean = [str(x) for x in labels]
    elif isinstance(labels, dict):
        clean = [str(labels.get(i, f"Class {i}")) for i in range(n)]
    else:
        clean = [f"Class {i}" for i in range(n)]

    flat = [_num(v) for r in matrix for v in r]
    if any(v is None for v in flat):
        return {"ok": False, "error": "matrix_invalid", "message": "Confusion matrix must contain only numbers."}

    total = sum(flat)
    row_totals = [sum(float(v) for v in r) for r in matrix]

    return {
        "ok": True,
        "model": {"id": model_id, "label": entry["label"]},
        "labels": clean,
        "matrix": matrix,
        "total": total,
        "row_normalized": [
            [round(float(v) / rt, 4) if rt > 0 else 0.0 for v in r] for r, rt in zip(matrix, row_totals)
        ],
        "evaluated_on": data.get("evaluated_on") or data.get("dataset_split") or None,
    }
