"""LeafLens AI — application entrypoint.

Exposes the module-level ``app`` that Vercel's Python runtime (and WSGI
servers generally) load as the default entrypoint:

    app.py  ->  top-level  app  variable

The application itself is built by the existing factory in
``backend/app.py`` — this file only imports it; no app is duplicated.

If initialization ever fails in a constrained environment (e.g. a file
missing from the deployment bundle), the exception is logged server-side
and a loud, explicit 500 error state is served instead of crashing the
function — so the failure is diagnosable from runtime logs and never
silently replaced with fake data.
"""
import logging
import traceback

from flask import Flask, jsonify

from backend.app import create_app

logger = logging.getLogger(__name__)


def _fallback_app(init_error: Exception) -> Flask:
    """Minimal honest error app used only when create_app() itself fails."""
    fb = Flask(__name__)
    detail = f"{type(init_error).__name__}: {init_error}"

    @fb.route("/", defaults={"path": ""})
    @fb.route("/<path:path>")
    def deployment_error(path):  # noqa: ANN001, ANN202
        return (
            "<!doctype html><meta charset='utf-8'>"
            "<title>LeafLens AI — deployment error</title>"
            "<h1>Backend failed to initialize</h1>"
            "<p>The Flask application could not start in this environment. "
            "This is a deployment configuration error, not a normal application state.</p>"
            f"<pre>{detail}</pre>"
            "<p>Server-side logs contain the full traceback.</p>"
        ), 500

    @fb.get("/api/health")
    def health_error():
        return jsonify(ok=False, status="error", service="crop-disease-ai", error=detail), 500

    return fb


try:
    app = create_app()
    logger.info(
        "LeafLens AI initialized: %d routes",
        len(list(app.url_map.iter_rules())),
    )
except Exception as exc:  # noqa: BLE001 — last-resort guard for serverless cold start
    logger.error("Flask initialization failed:\n%s", traceback.format_exc())
    app = _fallback_app(exc)

if __name__ == "__main__":  # local development convenience
    app.run(host="127.0.0.1", port=5000, debug=True)
