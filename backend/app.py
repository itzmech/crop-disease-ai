"""LeafLens AI — Flask application factory.

``create_app()`` tolerates read-only filesystems (e.g. Vercel serverless):
runtime directories that cannot be created there are skipped, and none of
the app's routes write to disk (uploads are processed fully in memory).
"""
import logging
import os

from flask import Flask, render_template

from backend.api import api
from backend.errors import register_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "templates"),
        static_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "static"),
        static_url_path="/static",
    )
    app.config.from_object("backend.config.Config")

    # Runtime directories are optional (read-only FS safe). The app never
    # writes to disk: uploaded images are processed entirely in memory.
    for d in (
        app.config["UPLOAD_FOLDER"],
        app.config["EVALUATION_DIR"],
        app.config["HISTORY_DIR"],
        app.config["CONFUSION_DIR"],
    ):
        try:
            os.makedirs(d, exist_ok=True)
        except (OSError, PermissionError):
            logging.getLogger(__name__).info(
                "Skipping directory creation for read-only filesystem: %s", d
            )

    app.register_blueprint(api)

    # ------------------------------ Pages ------------------------------ #
    PAGES = ["index", "detect", "severity", "explainable", "compare", "research", "about"]

    def _page(name):
        def view():
            return render_template(f"pages/{name}.html", page=name)
        view.__name__ = name
        return view

    for name in PAGES:
        app.add_url_rule(f"/{name if name != 'index' else ''}", endpoint=name, view_func=_page(name))

    @app.route("/healthz")
    def healthz():
        return {"status": "ok"}

    register_error_handlers(app)

    return app
