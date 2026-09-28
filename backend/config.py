"""
LeafLens AI — application configuration.

Values can be overridden with environment variables (12-factor style).
"""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bool_env(name: str, default: str = "0") -> bool:
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Flask ---
    SECRET_KEY = os.environ.get("SECRET_KEY", "lfa-dev-secret-change-me")
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB", "12")) * 1024 * 1024

    # --- Directories ---
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "data", "uploads")
    MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(BASE_DIR, "models", "artifacts"))
    EVALUATION_DIR = os.path.join(BASE_DIR, "models", "evaluation")
    HISTORY_DIR = os.path.join(BASE_DIR, "models", "history")
    CONFUSION_DIR = os.path.join(BASE_DIR, "models", "confusion")
    DATASET_INFO_PATH = os.environ.get(
        "DATASET_INFO_PATH", os.path.join(BASE_DIR, "data", "dataset_info.json")
    )

    # --- Grad-CAM ---
    GRADCAM_ENABLED = _bool_env("GRADCAM_ENABLED", "1")
    GRADCAM_LAYER_OVERRIDE = os.environ.get("GRADCAM_LAYER") or None
    GRADCAM_MAX_UPLOAD_DIM = int(os.environ.get("GRADCAM_MAX_DIM", "1024"))

    # --- Model registry (single source of truth for model ids) ---
    MODEL_REGISTRY = {
        "cnn":             {"label": "Custom CNN",     "file": "custom_cnn.keras",   "kind": "keras", "input": (224, 224)},
        "resnet50":        {"label": "ResNet50",       "file": "resnet50.keras",     "kind": "keras", "input": (224, 224)},
        "mobilenetv2":     {"label": "MobileNetV2",    "file": "mobilenet_v2.keras", "kind": "keras", "input": (224, 224)},
        "efficientnetb0":  {"label": "EfficientNetB0", "file": "efficientnet_b0.keras", "kind": "keras", "input": (224, 224)},
    }

    # --- Severity assessment ---
    # Bands for the estimated visible affected-area percentage.
    SEVERITY_BANDS = [
        (0.0, 5.0, "Healthy", "mild"),
        (5.0, 25.0, "Mild", "mild"),
        (25.0, 50.0, "Moderate", "moderate"),
        (50.0, 100.01, "Severe", "severe"),
    ]
