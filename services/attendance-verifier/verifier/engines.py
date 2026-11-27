"""Face detection and embedding engines.

OpenCvEngine runs the two OpenCV Zoo models (YuNet face detector, SFace recogniser) through the
OpenCV DNN module, in memory. Each model file is checked against its pinned SHA-256 before it is
loaded; a missing or different file stops the service (fail closed).

SyntheticEngine exists only for automated tests: a "frame" is a small JSON document that states the
face box, five landmarks and an identity label, so the full decision path can run without any image
of a person. Its name starts with "synthetic", which the database refuses unless a disposable test
database switches it on (app_private.attendance_config).
"""

from __future__ import annotations

import hashlib
import io
import json
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MAX_FRAME_BYTES = 400_000
MAX_SIDE = 1920

# Official OpenCV Zoo files (Hugging Face opencv/face_detection_yunet and opencv/face_recognition_sface,
# LFS object ids). YuNet: MIT licence. SFace: Apache-2.0 licence.
PINNED = {
    "yunet": ("face_detection_yunet_2023mar.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    "sface": ("face_recognition_sface_2021dec.onnx", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
}


class FrameError(Exception):
    pass


class ModelError(Exception):
    pass


@dataclass(frozen=True)
class DetectedFace:
    box: tuple[float, float, float, float]
    landmarks: np.ndarray  # (5, 2)
    score: float
    raw: object  # engine-specific handle used to compute the embedding


@dataclass
class FrameAnalysis:
    faces: list[DetectedFace]
    width: int
    height: int
    image: object  # engine-specific decoded frame; dropped after the request
    # Mean grey level 0-255 of the whole frame (for a "more light" hint); None for the test engine.
    brightness: float | None = None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def relevant_faces(faces: list[DetectedFace], min_score: float = 0.75, min_relative_width: float = 0.4) -> list[DetectedFace]:
    """Faces that count: confident and not tiny next to the largest one (a distant poster is ignored,
    a second person near the kiosk is not)."""
    strong = [f for f in faces if f.score >= min_score]
    if not strong:
        return []
    widest = max(f.box[2] for f in strong)
    return [f for f in strong if f.box[2] >= min_relative_width * widest]


class OpenCvEngine:
    name = "opencv-yunet2023mar-sface2021dec-v1"

    def __init__(self, yunet_path: str, sface_path: str) -> None:
        import cv2  # imported here so the synthetic test engine needs no OpenCV

        self._cv2 = cv2
        for key, path_text in (("yunet", yunet_path), ("sface", sface_path)):
            path = Path(path_text)
            if not path.is_file():
                raise ModelError(f"{key} model file is missing")
            digest = sha256_file(path)
            if digest != PINNED[key][1]:
                raise ModelError(f"{key} model file does not match its pinned SHA-256")
        self._detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), 0.6, 0.3, 50)
        self._recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
        self._lock = threading.Lock()  # the DNN objects are not thread-safe

    def analyse(self, data: bytes) -> FrameAnalysis:
        cv2 = self._cv2
        if not data or len(data) > MAX_FRAME_BYTES:
            raise FrameError("frame size")
        try:
            from PIL import Image  # header-only size check before a full decode

            with Image.open(io.BytesIO(data)) as header:
                if header.format not in ("JPEG", "PNG", "WEBP"):
                    raise FrameError("frame format")
                w, h = header.size
        except FrameError:
            raise
        except Exception as exc:
            raise FrameError("frame unreadable") from exc
        if w > MAX_SIDE or h > MAX_SIDE or w < 160 or h < 120:
            raise FrameError("frame dimensions")
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise FrameError("frame unreadable")
        with self._lock:
            self._detector.setInputSize((image.shape[1], image.shape[0]))
            _, rows = self._detector.detect(image)
        faces: list[DetectedFace] = []
        for row in rows if rows is not None else []:
            faces.append(DetectedFace(
                box=(float(row[0]), float(row[1]), float(row[2]), float(row[3])),
                landmarks=np.asarray(row[4:14], dtype=np.float64).reshape(5, 2),
                score=float(row[14]),
                raw=row,
            ))
        brightness = float(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).mean())
        return FrameAnalysis(faces=faces, width=image.shape[1], height=image.shape[0], image=image, brightness=brightness)

    def embed(self, frame: FrameAnalysis, face: DetectedFace) -> np.ndarray:
        with self._lock:
            aligned = self._recognizer.alignCrop(frame.image, face.raw)
            feature = self._recognizer.feature(aligned)
        vec = np.asarray(feature, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm < 1e-6:
            raise FrameError("embedding")
        return vec / norm


class SyntheticEngine:
    """Test-only engine. Never used with real people; refused by a production database."""

    name = "synthetic-test-v1"

    @staticmethod
    def identity_vector(label: str) -> np.ndarray:
        seed = int.from_bytes(hashlib.sha256(label.encode()).digest()[:8], "big")
        vec = np.random.default_rng(seed).normal(size=128).astype(np.float32)
        return vec / np.linalg.norm(vec)

    def analyse(self, data: bytes) -> FrameAnalysis:
        if not data or len(data) > MAX_FRAME_BYTES:
            raise FrameError("frame size")
        try:
            doc = json.loads(data.decode("utf-8"))
            assert doc.get("synthetic") == 1
            faces = [
                DetectedFace(
                    box=tuple(float(v) for v in face["box"]),  # type: ignore[arg-type]
                    landmarks=np.asarray(face["landmarks"], dtype=np.float64).reshape(5, 2),
                    score=float(face.get("score", 0.99)),
                    raw=str(face["identity"]),
                )
                for face in doc.get("faces", [])
            ]
        except Exception as exc:
            raise FrameError("frame unreadable") from exc
        return FrameAnalysis(faces=faces, width=640, height=480, image=None)

    def embed(self, frame: FrameAnalysis, face: DetectedFace) -> np.ndarray:
        base = self.identity_vector(str(face.raw))
        # A little pose-dependent noise so scores are realistic rather than exactly 1.0.
        jitter = self.identity_vector(f"{face.raw}|{face.landmarks.round(1).tobytes().hex()}")
        vec = base + 0.15 * jitter
        return (vec / np.linalg.norm(vec)).astype(np.float32)
