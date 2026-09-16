"""BuildSafe backend package. Enables `python -m uvicorn backend.main:app` from the
project root AND keeps `main:app --app-dir backend` working (see _vision() in
main.py, which tries absolute, top-level and relative imports in order)."""
