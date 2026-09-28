"""LeafLens AI — application entrypoint.

Exposes the module-level ``app`` that Vercel's Python runtime (and WSGI
servers generally) load as the default entrypoint:

    app.py  ->  top-level  app  variable

The application itself is built by the existing factory in
``backend/app.py`` — this file only imports it; no app is duplicated.
"""
from backend.app import create_app

app = create_app()

if __name__ == "__main__":  # local development convenience
    app.run(host="127.0.0.1", port=5000, debug=True)
