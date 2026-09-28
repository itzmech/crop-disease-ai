"""Grad-CAM / Grad-CAM++ explainability (TensorFlow, lazily imported).

Produces a real saliency heatmap from the actual model's activations and
gradients — never a synthetic or static image. When TF or the model is
absent, returns a structured `available=False` payload the frontend renders
as an honest empty state.
"""
import logging

import numpy as np
from flask import current_app
from PIL import Image

from backend import models as model_layer

logger = logging.getLogger(__name__)


def generate(img, model_id: str, overlay_alpha: float = 0.40):
    """
    Compute a Grad-CAM heatmap + overlay for the given PIL image.

    Returns (payload_dict, http_status). The payload never contains a
    fabricated heatmap: on failure it is {"available": False, ...}.
    """
    entry = model_layer.registry().get(model_id)
    if not entry:
        return {"available": False, "reason": "unknown_model", "message": "Unknown model id."}, 400

    model = model_layer.get_model(model_id)
    if model is None:
        reason = (
            "TensorFlow is not installed on the server."
            if not model_layer.tf_available()
            else f"The trained model file '{entry['file']}' was not found on the server."
        )
        return {"available": False, "reason": "model_unavailable", "message": reason}, 503

    tf = model_layer._tensorflow()
    if tf is None:
        return {"available": False, "reason": "model_unavailable", "message": "TensorFlow is not installed."}, 503

    if not current_app.config["GRADCAM_ENABLED"]:
        return {
            "available": False,
            "reason": "gradcam_disabled",
            "message": "Grad-CAM is disabled in the server configuration.",
        }, 503

    size = tuple(entry["input"])
    x = model_layer.preprocess(img, size)

    # --- Locate the last convolutional layer ------------------------------- #
    layer_name = current_app.config["GRADCAM_LAYER_OVERRIDE"]
    if not layer_name:
        layer_name = _find_last_conv_layer(model)
    if not layer_name:
        return {
            "available": False,
            "reason": "no_conv_layer",
            "message": "No convolutional layer was found in this model, so Grad-CAM cannot be computed.",
        }, 503

    try:
        heatmap, used_layer = _compute_gradcam(tf, model, x, layer_name, size)
    except Exception as exc:  # noqa: BLE001 — surface a clean error, never fake data
        logger.exception("Grad-CAM computation failed for '%s'", model_id)
        return {
            "available": False,
            "reason": "gradcam_failed",
            "message": f"Grad-CAM computation failed: {exc}",
        }, 500

    # --- Colourise + overlay ------------------------------------------------ #
    jet = _apply_jet(heatmap)
    overlay = _overlay(img, jet, size, overlay_alpha)

    return {
        "available": True,
        "model": {"id": model_id, "label": entry["label"]},
        "layer": used_layer,
        "method": "gradcam",
        "images": {
            "original": _to_data_url(img.convert("RGB")),
            "heatmap": _to_data_url(jet),
            "overlay": _to_data_url(overlay),
        },
        "input_size": list(size),
    }, 200


# --------------------------------------------------------------------------- #
# Core maths
# --------------------------------------------------------------------------- #
def _compute_gradcam(tf, model, x, layer_name, size):
    """Run the guided gradient pass and return (heatmap 2-D in [0,1], layer name)."""
    grad_model = tf.keras.models.Model(
        model.inputs, [model.get_layer(layer_name).output, model.output]
    )

    with tf.GradientTape() as tape:
        conv_out, preds = grad_model(x, training=False)
        pred_index = int(np.argmax(preds[0]))
        class_channel = preds[:, pred_index]

    grads = tape.gradient(class_channel, conv_out)
    if grads is None:
        raise RuntimeError("gradients are None (check model graph)")

    weights = tf.reduce_mean(grads, axis=(0, 1, 2))
    cam = tf.reduce_sum(conv_out[0] * weights, axis=-1)

    cam = cam.numpy()
    cam = np.maximum(cam, 0)
    mx = float(cam.max())
    cam = cam / mx if mx > 0 else np.zeros_like(cam)

    cam_img = Image.fromarray((cam * 255).astype("uint8")).resize(size, model_layer.image_resample())
    return np.asarray(cam_img, dtype="float32") / 255.0, layer_name


def _find_last_conv_layer(model) -> str | None:
    """Heuristic: last 4-D-output layer, preferring common conv names."""
    preferred = ("conv5_block16_2_conv", "block_16_expand", "block_7b_project_conv", "conv2d")
    names = [L.name for L in model.layers]
    for want in preferred:
        for n in reversed(names):
            if want in n:
                return n
    for L in reversed(model.layers):
        try:
            if L.output.shape.ndims == 4:
                return L.name
        except Exception:  # noqa: BLE001 — nested models may not expose shape
            continue
    return None


# --------------------------------------------------------------------------- #
# Colour mapping (pure NumPy/Pillow — works even without matplotlib/cv2)
# --------------------------------------------------------------------------- #
def _apply_jet(heatmap):
    """Map a 2-D [0,1] heatmap to the classic JET colours, alpha-composited on white."""
    x = np.clip(heatmap, 0.0, 1.0)
    r = np.clip(1.5 - np.abs(4.0 * x - 3.0), 0, 1)
    g = np.clip(1.5 - np.abs(4.0 * x - 2.0), 0, 1)
    b = np.clip(1.5 - np.abs(4.0 * x - 1.0), 0, 1)
    rgb = (np.stack([r, g, b], axis=-1) * 255).astype("uint8")

    # Fade the low-activation background toward white so the PNG reads cleanly.
    alpha = np.clip(x * 1.6, 0.15, 1.0)[..., None]
    white = np.full_like(rgb, 255)
    out = (rgb * alpha + white * (1 - alpha)).astype("uint8")
    return Image.fromarray(out, mode="RGB")


def _overlay(img, jet_img, size, alpha):
    base = img.convert("RGB").resize(size, model_layer.image_resample())
    return Image.blend(base, jet_img.convert("RGB"), alpha)


def _to_data_url(pil_img) -> str:
    import base64
    import io

    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
