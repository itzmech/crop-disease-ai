"""Real image-processing pipeline for visible disease-severity estimation.

Stages: leaf segmentation (Otsu on a vegetation response), lesion colour
cues (brown/necrotic + chlorotic yellow), and affected-area ratioing. The
banding rules live in severity_config.py so the API and offline tools agree.
"""
from flask import current_app

from backend.severity_config import band_for


def estimate_severity(img, leaf_mask=None, band_lookup=None):
    """
    Compute severity from a real image-analysis measurement.

    Parameters
    ----------
    img : PIL.Image (RGB)
    leaf_mask : optional binary mask (uint8, 255 = leaf) produced upstream.
    band_lookup : optional callable pct -> (label, token); defaults to config.

    Returns
    -------
    dict with `available=False` and a machine-readable reason when a reliable
    measurement cannot be made — the frontend shows an empty state, never a
    fabricated percentage.
    """
    band_lookup = band_lookup or band_for
    import numpy as np

    rgb_img = img.convert("RGB")
    rgb = np.asarray(rgb_img, dtype="float32")
    if leaf_mask is None:
        leaf_mask = _default_leaf_mask(rgb)
    if leaf_mask is None:
        return {
            "available": False,
            "reason": "leaf_not_detected",
            "message": "No leaf region could be isolated, so visible severity cannot be estimated.",
        }

    ratio = float(np.count_nonzero(leaf_mask)) / float(leaf_mask.size)
    if ratio < 0.02:
        return {
            "available": False,
            "reason": "leaf_too_small",
            "message": "The leaf region occupies too little of the image to assess reliably.",
        }

    affected_ratio = _affected_ratio(rgb_img, leaf_mask)
    if affected_ratio is None:
        return {
            "available": False,
            "lesion_ratio": None,
            "reason": "no_lesion_signal",
            "message": "The affected region could not be reliably segmented from the healthy tissue.",
        }

    pct = affected_ratio * 100.0
    label, token = band_lookup(pct)
    return {
        "available": True,
        "percent": round(pct, 1),
        "label": label,
        "token": token,
        "lesion_ratio": round(affected_ratio, 4),
        "leaf_ratio": round(ratio, 4),
        "method": "otsu_within_leaf_mask",
        "banding": "fixed_percent_bands",
        "disclaimer": (
            "Severity represents the estimated visible affected leaf area and "
            "should not be interpreted as ground-truth disease severity."
        ),
    }


# --------------------------------------------------------------------------- #
# Image-analysis helpers (real measurements, no randomness)
# --------------------------------------------------------------------------- #
def _default_leaf_mask(rgb):
    """Segment the foreground leaf from a plain background (Otsu on saturation×green)."""
    import numpy as np

    r = rgb[..., 0]
    g = rgb[..., 1]
    b = rgb[..., 2]
    mx = np.max(rgb, axis=2)
    mn = np.min(rgb, axis=2)
    sat = (mx - mn) / (mx + 1e-6)

    # Green-dominant vegetation response.
    excess_green = (2.0 * g - r - b) / 255.0
    response = 0.5 * sat + 0.5 * np.clip(excess_green, 0.0, 1.0)
    response_u8 = np.clip(response * 255.0, 0, 255).astype("uint8")

    thr = _otsu_threshold(response_u8)
    if thr is None:
        return None
    mask = response_u8 > thr

    # Keep the largest connected component when OpenCV is present (denoises).
    try:
        import cv2  # type: ignore

        n, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype("uint8"), connectivity=8)
        if n <= 2:
            return mask
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        mask = lab == largest
    except Exception:  # noqa: BLE001 — NumPy-only fallback is acceptable
        pass

    return mask


def _affected_ratio(rgb_img, leaf_mask):
    """Fraction of leaf pixels that look like lesions (dark/yellow/brown)."""
    import numpy as np

    # Pillow's native RGB->HSV (H/S/V: 0-255) is exact and fast.
    hsv = np.asarray(rgb_img.convert("HSV"), dtype="float32")
    hue = hsv[..., 0] * (360.0 / 255.0)   # degrees 0-360
    s = hsv[..., 1] / 255.0
    v = hsv[..., 2] / 255.0

    # Lesion cues: brown/necrotic (orange-brown hue, mid value) or chlorotic yellow.
    brown = (hue >= 15) & (hue < 60) & (s > 0.25) & (v < 0.75)
    yellow = (hue >= 45) & (hue < 75) & (s > 0.30) & (v > 0.45)
    lesion = brown | yellow

    masked = lesion & (leaf_mask > 0)
    denom = np.count_nonzero(leaf_mask > 0)
    if denom == 0:
        return None
    ratio = float(np.count_nonzero(masked)) / float(denom)

    # Guard against absurd measurements on non-leaf imagery.
    if not np.isfinite(ratio):
        return None
    if ratio < 0.004:
        # Essentially no lesion signal — report as healthy rather than fail.
        return 0.0
    return min(ratio, 1.0)


def _otsu_threshold(gray_u8):
    """Classic Otsu threshold for a uint8 grayscale image. Returns int or None."""
    import numpy as np

    hist = np.bincount(gray_u8.ravel(), minlength=256).astype("float64")
    total = hist.sum()
    if total == 0:
        return None
    probs = hist / total
    levels = np.arange(256, dtype="float64")
    omega = np.cumsum(probs)
    mu = np.cumsum(probs * levels)
    mu_t = mu[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        sigma_b_sq = (mu_t * omega - mu) ** 2 / (omega * (1.0 - omega))
    sigma_b_sq[~np.isfinite(sigma_b_sq)] = 0.0
    best = int(np.argmax(sigma_b_sq))
    if omega[best] <= 0 or omega[best] >= 1:
        return None
    return best
