"""Synthetic faces for tests: five 3-D points projected through a pinhole camera. No images of people.

Head coordinates (millimetres): x to the image right, y down, z toward the camera.
A positive yaw turns the head to the subject's LEFT; a positive pitch tilts the chin up (looking up).
"""

from __future__ import annotations

import base64
import json
import math

import numpy as np

HEAD = np.array([
    [-32.0, 0.0, 0.0],   # subject's right eye (image left)
    [32.0, 0.0, 0.0],    # subject's left eye
    [0.0, 38.0, 32.0],   # nose tip, in front of the eye plane
    [-25.0, 70.0, 6.0],  # subject's right mouth corner
    [25.0, 70.0, 6.0],   # subject's left mouth corner
])


def project(points: np.ndarray, *, yaw_deg=0.0, pitch_deg=0.0, roll_deg=0.0, distance=520.0, f=620.0,
            cx=320.0, cy=200.0, shift=(0.0, 0.0)) -> np.ndarray:
    a, b, c = (math.radians(v) for v in (yaw_deg, pitch_deg, roll_deg))
    ry = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
    rx = np.array([[1, 0, 0], [0, math.cos(b), -math.sin(b)], [0, math.sin(b), math.cos(b)]])
    rz = np.array([[math.cos(c), -math.sin(c), 0], [math.sin(c), math.cos(c), 0], [0, 0, 1]])
    centred = points - np.array([0.0, 35.0, 0.0])
    p = (rz @ rx @ ry @ centred.T).T
    z = distance - p[:, 2]
    return np.stack([cx + shift[0] + f * p[:, 0] / z, cy + shift[1] + f * p[:, 1] / z], axis=1)


def flat_photo() -> np.ndarray:
    """The frontal picture of the head printed on paper: the same 2-D layout, all at z = 0."""
    frontal = project(HEAD)
    # Back-project the frontal image onto a plane at the head's distance.
    return np.column_stack([(frontal[:, 0] - 320.0) * 520.0 / 620.0, (frontal[:, 1] - 200.0) * 520.0 / 620.0 + 35.0,
                            np.zeros(5)])


def box(landmarks: np.ndarray) -> list[float]:
    xs, ys = landmarks[:, 0], landmarks[:, 1]
    w = (xs.max() - xs.min()) * 1.9
    h = (ys.max() - ys.min()) * 1.9
    return [float(xs.mean() - w / 2), float(ys.min() - h * 0.35), float(w), float(h)]


def frame(landmarks_list: list[np.ndarray], identities: list[str]) -> bytes:
    faces = [{"box": box(l), "landmarks": l.round(2).tolist(), "score": 0.98, "identity": i}
             for l, i in zip(landmarks_list, identities)]
    return json.dumps({"synthetic": 1, "faces": faces}).encode()


def sequence(steps: list[str], *, points=HEAD, identity="employee-a", per_step=4, neutral=3, angle=28.0,
             identity_during_moves: str | None = None) -> list[bytes]:
    """Frames: neutral, then each step held `per_step` frames with a neutral frame in between."""
    poses = [(0.0, 0.0)] * neutral
    for step in steps:
        yaw, pitch = {"left": (angle, 0.0), "right": (-angle, 0.0), "up": (0.0, angle * 0.8)}[step]
        poses += [(yaw * 0.5, pitch * 0.5)] + [(yaw, pitch)] * per_step + [(0.0, 0.0)]
    frames = []
    for i, (yaw, pitch) in enumerate(poses):
        who = identity if (i < neutral or identity_during_moves is None) else identity_during_moves
        frames.append(frame([project(points, yaw_deg=yaw, pitch_deg=pitch)], [who]))
    return frames


def b64(frames: list[bytes]) -> list[str]:
    return [base64.b64encode(f).decode() for f in frames]
