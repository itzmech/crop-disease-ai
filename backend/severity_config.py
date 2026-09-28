"""Severity banding rules for the estimated visible affected-area percentage."""
from flask import current_app


def band_for(pct: float):
    """Return (label, css_token) for a percentage 0–100."""
    for lo, hi, label, token in current_app.config["SEVERITY_BANDS"]:
        if lo <= pct < hi:
            return label, token
    _, _, label, token = current_app.config["SEVERITY_BANDS"][-1]
    return label, token
