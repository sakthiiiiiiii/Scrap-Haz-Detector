"""API tests. They use a fake detector, so the real weights are NOT needed."""
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import main


class FakeDetector:
    loaded, error, class_names = True, None, ["Cylinder", "Shock Absorber"]

    def load(self):
        pass

    def predict(self, image, conf):
        box = {"x1": 0.1, "y1": 0.1, "x2": 0.6, "y2": 0.7}
        return [{"label": "Shock Absorber", "class_id": 1, "confidence": 0.964, "box": box}]


def jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), "gray").save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "detector", FakeDetector())
    with TestClient(main.app) as c:
        yield c


def test_page_title(client):
    r = client.get("/")
    assert r.status_code == 200 and "<title>Scrap Haz Detector</title>" in r.text


def test_detect_ok(client):
    r = client.post("/api/detect", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}, data={"conf": "0.3"})
    body = r.json()
    assert r.status_code == 200 and body["is_shock_absorber"] is True
    assert body["detections"][0]["label"] == "Shock Absorber" and body["image"] == {"width": 64, "height": 48}


def test_detect_rejects_non_image(client):
    r = client.post("/api/detect", files={"file": ("a.txt", b"hello", "text/plain")})
    assert r.status_code == 400


def test_detect_rejects_bad_confidence(client):
    r = client.post("/api/detect", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")}, data={"conf": "5"})
    assert r.status_code == 422


def test_missing_weights_is_reported_not_fatal(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "detector", main.Detector(tmp_path / "nope.pt"))
    with TestClient(main.app) as c:
        health = c.get("/api/health").json()
        assert health["model_loaded"] is False and "not found" in health["error"]
        r = c.post("/api/detect", files={"file": ("a.jpg", jpeg_bytes(), "image/jpeg")})
        assert r.status_code == 503
