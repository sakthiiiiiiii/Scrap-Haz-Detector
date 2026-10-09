"""Scrap Haz Detector - FastAPI backend (serves the web page and the /api endpoints)."""
import io
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

from app.detector import Detector

log = logging.getLogger("scrap-haz")

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = Path(__file__).resolve().parent / "static"

# ---- Settings (override with environment variables) -------------------------
MODEL_PATH = Path(os.getenv("MODEL_PATH", "models/best.pt"))
if not MODEL_PATH.is_absolute():
    MODEL_PATH = BASE_DIR / MODEL_PATH
IMGSZ = int(os.getenv("IMGSZ", "640"))
DEFAULT_CONF = float(os.getenv("DEFAULT_CONF", "0.25"))
IOU = float(os.getenv("IOU", "0.7"))
DEVICE = os.getenv("DEVICE") or None  # e.g. "cpu", "0" (first GPU), "mps"
MAX_BYTES = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
SHOCK_LABEL = "shock absorber"

detector = Detector(MODEL_PATH, imgsz=IMGSZ, iou=IOU, device=DEVICE)


@asynccontextmanager
async def lifespan(_: FastAPI):
    detector.load()
    if detector.loaded:
        log.warning("Model loaded: %s classes=%s", MODEL_PATH.name, detector.class_names)
    else:
        log.warning(detector.error)
    yield


app = FastAPI(title="Scrap Haz Detector API", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_loaded": detector.loaded,
        "weights": MODEL_PATH.name,
        "classes": detector.class_names,
        "error": detector.error,
    }


@app.post("/api/detect")
def detect(file: UploadFile = File(...), conf: float = Form(DEFAULT_CONF, ge=0.01, le=0.99)):
    """Detect Cylinders / Shock Absorbers in one image (JPEG, PNG, WebP...)."""
    if not detector.loaded:
        raise HTTPException(503, detector.error or "Model is not loaded.")
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, f"Image is larger than {MAX_BYTES // 1024 // 1024} MB.")
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, "The uploaded file is not a valid image.")

    start = time.perf_counter()
    detections = detector.predict(image, conf)
    return {
        "is_shock_absorber": any(d["label"].lower() == SHOCK_LABEL for d in detections),
        "detections": detections,
        "image": {"width": image.width, "height": image.height},
        "inference_ms": round((time.perf_counter() - start) * 1000, 1),
    }
