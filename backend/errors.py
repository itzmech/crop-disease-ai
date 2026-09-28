"""Central JSON error handlers so the frontend always gets parseable JSON."""
from flask import jsonify, render_template
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge


def register_error_handlers(app):
    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_e):
        return (
            jsonify(
                ok=False,
                error="upload_too_large",
                message="The uploaded image exceeds the server's size limit (12 MB).",
            ),
            413,
        )

    @app.errorhandler(404)
    def not_found(e):
        # API routes get JSON; page routes get the styled 404 page.
        if request_wants_json():
            return jsonify(ok=False, error="not_found", message="Resource not found."), 404
        return render_template("pages/404.html", page="404"), 404

    @app.errorhandler(405)
    def bad_method(e):
        if request_wants_json():
            return jsonify(ok=False, error="method_not_allowed", message="HTTP method not allowed."), 405
        return e

    @app.errorhandler(500)
    def server_error(e):
        if request_wants_json():
            return jsonify(ok=False, error="server_error", message="An unexpected server error occurred."), 500
        return e

    @app.errorhandler(HTTPException)
    def http_exception(e):
        if request_wants_json():
            return jsonify(ok=False, error="http_error", message=e.description), e.code
        return e


def request_wants_json() -> bool:
    from flask import request

    best = request.accept_mimetypes.best_match(["application/json", "text/html"])
    return best == "application/json" and request.path.startswith("/api/")
