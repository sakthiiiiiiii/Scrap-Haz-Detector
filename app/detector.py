"""Thin wrapper around the trained YOLOv8n model."""
import threading
from pathlib import Path

import numpy as np
from PIL import Image


class Detector:
    def __init__(self, weights: Path, imgsz: int = 640, iou: float = 0.7, device=None):
        self.weights = Path(weights)
        self.imgsz, self.iou, self.device = imgsz, iou, device
        self.model = None
        self.error = None
        self._lock = threading.Lock()  # one inference at a time

    def load(self) -> None:
        """Load weights. Never raises: problems are stored in `self.error`."""
        if not self.weights.is_file():
            self.error = f"Model weights not found at {self.weights}. Copy best.pt there (see README)."
            return
        try:
            from ultralytics import YOLO  # imported lazily so the server starts fast

            self.model = YOLO(str(self.weights))
            blank = np.zeros((self.imgsz, self.imgsz, 3), np.uint8)  # warm-up run
            self.model.predict(blank, imgsz=self.imgsz, device=self.device, verbose=False)
            self.error = None
        except Exception as exc:  # noqa: BLE001
            self.model, self.error = None, f"Could not load model: {exc}"

    @property
    def loaded(self) -> bool:
        return self.model is not None

    @property
    def class_names(self) -> list:
        return list(self.model.names.values()) if self.model else []

    def predict(self, image: Image.Image, conf: float) -> list:
        with self._lock:
            result = self.model.predict(
                image, imgsz=self.imgsz, conf=conf, iou=self.iou, device=self.device, verbose=False
            )[0]
        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0])
            x1, y1, x2, y2 = box.xyxyn[0].tolist()  # normalised 0-1 coordinates
            detections.append({
                "label": result.names[class_id],
                "class_id": class_id,
                "confidence": round(float(box.conf[0]), 4),
                "box": {"x1": round(x1, 5), "y1": round(y1, 5), "x2": round(x2, 5), "y2": round(y2, 5)},
            })
        return sorted(detections, key=lambda d: -d["confidence"])
