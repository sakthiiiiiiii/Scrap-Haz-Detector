"""One-click launcher: press the Run button in VS Code, or `python run.py`.

Optional environment variables: HOST (default 127.0.0.1), PORT (8000),
RELOAD=1 (auto-reload on code changes), OPEN_BROWSER=0 (don't open a browser tab).
"""
import os
import threading
import webbrowser

import uvicorn

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8000"))

if __name__ == "__main__":
    if os.getenv("OPEN_BROWSER", "1") == "1":
        threading.Timer(2.5, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=os.getenv("RELOAD") == "1")
