"""Entry point: python -m backend.app.run_server  (honors PORT, LUMEN_MOCK, LUMEN_BAND)."""
from __future__ import annotations
import os

import uvicorn

from .providers import is_mock

if __name__ == "__main__":
    port = int(os.getenv("PORT", "3000"))
    band = os.getenv("LUMEN_BAND") == "1"
    mode = "BAND" if band else ("MOCK" if is_mock() else "LIVE")
    print(f"\n  Lumen web console → http://localhost:{port}   (mode: {mode})\n")
    uvicorn.run("backend.app.server:app", host="0.0.0.0", port=port, log_level="warning")
