# Scrap Haz Detector

A web app that uses your camera (live video or a captured photo) to detect **Shock Absorbers** and **Cylinders** in a scrap yard sorting line. It is built with **FastAPI** and a **YOLOv8n** model trained in `Scrap_Haz_Detection.ipynb`.

**Features**

- Live camera feed with bounding boxes and confidence badges, e.g. `Shock Absorber (96.4%)`. Green box = Shock Absorber, blue box = Cylinder.
- Status banner with routing instructions: shock absorber → *Depressurization Bin*, cylinder → *Metal Crusher*.
- Live session counters, one count per physical item rather than per frame.
- **Screen flash + audio chime** whenever a shock absorber (potential hazard) is flagged.
- Three input modes: live video, *Capture photo* (freeze a frame), and *Upload image*.
- Adjustable confidence threshold, with live FPS and latency readouts.

## Project structure

```
scrap-haz-detector/
├── README.md
├── requirements.txt          # runtime dependencies
├── requirements-dev.txt      # + pytest, httpx
├── run.py                    # one-click launcher (Run button in VS Code)
├── .vscode/                  # VS Code run/debug configs, tasks, settings
├── .gitignore
├── models/
│   └── best.pt               # <-- YOU add this file (trained weights, see Step 1)
├── app/
│   ├── main.py               # FastAPI app: serves the page + /api/health, /api/detect
│   ├── detector.py           # YOLO model wrapper
│   └── static/
│       ├── index.html        # the "Scrap Haz Detector" page
│       ├── css/style.css     # dark industrial theme
│       └── js/app.js         # camera, detection loop, overlay, counters, alerts
└── tests/
    └── test_api.py           # API tests (no weights needed)
```

## Quick start in VS Code

1. Install **Python 3.10 – 3.12** and **VS Code** with the *Python* extension (VS Code will offer it automatically).
2. Unzip the project and open the **`scrap-haz-detector`** folder: **File → Open Folder…**
3. Put your trained weights at **`models/best.pt`** (see Step 1 below).
4. Open the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on macOS) → **Tasks: Run Task** → **1. Setup: create .venv and install dependencies**. Wait until it finishes (a few minutes the first time).
5. Command Palette → **Python: Select Interpreter** → choose **`.venv`**.
6. Press **F5** (Run and Debug → *Scrap Haz Detector (run.py)*), or open `run.py` and click the ▶ Run button. Your browser opens at **http://localhost:8000**. If it doesn't, open that address yourself.

Other ways to run from VS Code:

- **Tasks: Run Task → 2. Run server** starts the server without the debugger.
- **Run and Debug → Scrap Haz Detector (uvicorn --reload)** restarts the server whenever you edit Python code.
- **Run and Debug → Run tests (pytest)** runs the tests.
- In the integrated terminal (open it with <kbd>Ctrl</kbd>+<kbd>`</kbd>) you can also run `python run.py`.

The steps below explain the same process from a plain terminal.

## How to run (terminal)

### Prerequisites

- **Python 3.10 – 3.12** (check with `python --version`)
- A webcam, or a phone/tablet camera, or just photos to upload
- The trained model file (`best.pt`) from your Colab notebook

### Step 1 – Get the trained model (`best.pt`)

The notebook saves the weights to Google Drive. The selected model path is printed in **Step 8** of the notebook, e.g.:

```
/content/drive/MyDrive/Shock_Cylinder_Results/experiment_.../training/YOLOv8n/weights/best.pt
```

Download that `best.pt` from Google Drive and put it here:

```
scrap-haz-detector/models/best.pt
```

> The app starts without the file, but the page shows **"Model offline"** until the file is added.

### Step 2 – Create a virtual environment

```bash
cd scrap-haz-detector

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
```

### Step 3 – Install dependencies

```bash
pip install -r requirements.txt
```

This installs PyTorch through `ultralytics`, so the first install can take a few minutes. A GPU is **not** required; YOLOv8n runs fine on CPU.

### Step 4 – Start the FastAPI server

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Add `--reload` while developing. On startup you should see `Model loaded: best.pt classes=['Cylinder', 'Shock Absorber']`.

### Step 5 – Open the web page
Go to **http://localhost:8000** in Chrome, Edge, Firefox or Safari.


1. Click **Start camera** and allow camera access (or click **Upload image**).
2. Hold a shock absorber or cylinder in view. Boxes and badges appear on the feed.
3. Click **Capture photo** to freeze a frame and analyse it, then **Resume live** to go back.
4. Use **Test alert** to check your speakers and the flash effect. Browsers only allow sound after you click something on the page.

### Using the camera from a phone or another computer

Browsers only allow camera access on `localhost` or **HTTPS**. To use a phone on the same Wi-Fi, run the server with a self-signed certificate:

```bash
mkdir certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=scrap-haz"

uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile certs/key.pem --ssl-certfile certs/cert.pem
```

Then open `https://<your-computer-IP>:8000` on the phone and accept the certificate warning. *Upload image* works over plain HTTP without any of this.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `MODEL_PATH` | `models/best.pt` | Path to the trained weights |
| `IMGSZ` | `640` | Inference size (same as training) |
| `DEFAULT_CONF` | `0.25` | Default confidence threshold |
| `IOU` | `0.7` | NMS IoU threshold |
| `DEVICE` | auto | `cpu`, `0` (first GPU), `mps`, ... |
| `MAX_UPLOAD_MB` | `10` | Largest accepted image |

Example: `MODEL_PATH=/data/best.pt DEVICE=cpu uvicorn app.main:app --port 8000`

## API

`POST /api/detect` takes a multipart form with `file` (image) and optional `conf` (0.01–0.99).

```bash
curl -F "file=@photo.jpg" -F "conf=0.25" http://localhost:8000/api/detect
```

```json
{
  "is_shock_absorber": true,
  "detections": [
    {"label": "Shock Absorber", "class_id": 1, "confidence": 0.964,
     "box": {"x1": 0.21, "y1": 0.18, "x2": 0.64, "y2": 0.87}}
  ],
  "image": {"width": 800, "height": 600},
  "inference_ms": 21.4
}
```

Box coordinates are **normalised (0–1)**. `GET /api/health` reports whether the model is loaded.

> FastAPI also serves an optional auto-generated API page at `/docs`. It loads its scripts from a public CDN (cdn.jsdelivr.net), so it shows a blank page if you are offline or that host is blocked. It isn't needed to use the app; the `curl` example above does the same job.

## Run the tests

```bash
pip install -r requirements-dev.txt
pytest
```

## Troubleshooting

| Problem | Fix |
|---|---|
| VS Code doesn't show `.venv` as an interpreter | Run the Setup task first, then **Python: Select Interpreter** → *Enter interpreter path…* → `.venv/bin/python` (Windows: `.venv\Scripts\python.exe`). |
| PowerShell blocks `Activate.ps1` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or just use the Setup task / F5, which don't need activation. |
| Page says **Model offline** | `models/best.pt` is missing or unreadable. The banner shows the exact reason. |
| "Camera access needs HTTPS or localhost" | Open `http://localhost:8000`, or use the HTTPS steps above. |
| Camera permission denied or camera busy | Allow the camera in the browser's site settings and close other apps using it. |
| No alert sound | Click **Test alert** once; keep **Alert sound** ticked; check the tab isn't muted. |
| `Address already in use` | Use another port: `--port 8001`. |
| Slow detection | Normal on weak CPUs. Lower the camera resolution, or set `DEVICE=0` if you have an NVIDIA GPU. |
| Counts look too high or low | Tune `CONFIRM_HITS`, `MAX_MISSED` and `IOU_MATCH` at the top of `app/static/js/app.js`. |

## Notes on model accuracy

The numbers below are from your notebook (YOLOv8n):

| Split | mAP50 | mAP50-95 | Shock Absorber mAP50 |
|---|---|---|---|
| Validation (37 imgs) | 0.605 | 0.414 | 0.487 |
| Test (16 imgs) | 0.445 | 0.275 | 0.356 |

This is a **proof-of-concept level** detector trained on 262 images. Expect missed items and false alarms, especially for shock absorbers (only 7 in the test split). Treat the output as decision support. A human must confirm every item before it is crushed, cut or punctured. To improve it, add more varied labelled images (different lighting, angles, backgrounds, and "empty" background images), retrain in the notebook, and replace `models/best.pt`.

**Counting:** an item is counted once it persists for 3 consecutive frames and is tracked by box overlap. Fast-moving or overlapping items may be missed or double-counted. Each *captured or uploaded photo* counts its detections once.
