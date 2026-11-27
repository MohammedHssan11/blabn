"""Head-pose, challenge and 3-D structure checks from five facial landmarks.

Everything here is plain arithmetic on landmark coordinates, so it is unit-tested with synthetic
landmarks (tests/test_geometry.py) and shared by the real OpenCV engine and the synthetic test engine.

Landmark order (YuNet): subject's right eye, subject's left eye, nose tip, subject's right mouth
corner, subject's left mouth corner, in raw (unmirrored) camera pixels. The subject's right eye
appears on the image left.

Conventions measured relative to the person's own neutral pose (the first frames of the capture):
  * yaw:   horizontal offset of the nose from the eye midpoint, in inter-ocular distances, in a frame
           rotated so the eyes are level (head roll removed). Turning to the subject's LEFT moves the
           nose toward the image right: yaw increases.
  * pitch: vertical position of the nose between the eye line (0) and the mouth line (1). Looking UP
           moves the nose toward the eye line: pitch decreases.
  * parallax: how far the nose moved away from where an affine (flat-picture) motion of the four
           other landmarks would put it, in inter-ocular distances. A flat photo or screen that is
           tilted or turned moves all five points affinely, so its parallax stays near 0; a real
           head turning moves the protruding nose differently from the eyes and mouth.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

Landmarks = np.ndarray  # shape (5, 2)


@dataclass(frozen=True)
class Thresholds:
    """Decision thresholds. Provisional until the real-camera trial (docs/phase13_14/ATTENDANCE.md)."""

    neutral_yaw: float = 0.12        # |yaw - baseline| below this counts as facing the camera
    neutral_pitch: float = 0.08
    turn_yaw: float = 0.22           # a left/right turn must move the nose this far (inter-ocular units)
    up_pitch: float = 0.10           # looking up must move the nose this far toward the eye line
    up_max_yaw: float = 0.18         # ... while staying roughly frontal
    min_run: int = 2                 # consecutive frames a movement must be held
    min_neutral_frames: int = 2      # frames at the start used as the baseline
    baseline_max_yaw: float = 0.20   # the baseline itself must face the camera
    min_parallax: float = 0.045      # non-planar motion required on each turn
    max_center_jump: float = 0.6     # face centre may move at most this many face widths between frames
    max_scale_jump: float = 0.35     # relative face-size change allowed between frames


@dataclass(frozen=True)
class Pose:
    yaw: float
    pitch: float
    interocular: float
    roll: float


def _as_points(points: Sequence[Sequence[float]]) -> Landmarks:
    arr = np.asarray(points, dtype=np.float64)
    if arr.shape != (5, 2) or not np.all(np.isfinite(arr)):
        raise ValueError("five finite (x, y) landmarks are required")
    return arr


def _canonical(p: Landmarks) -> Landmarks:
    """Eyes and mouth corners ordered by image x (see pose())."""
    eyes = sorted((p[0], p[1]), key=lambda q: q[0])
    mouth = sorted((p[3], p[4]), key=lambda q: q[0])
    return np.array([eyes[0], eyes[1], p[2], mouth[0], mouth[1]])


def pose(points: Sequence[Sequence[float]]) -> Pose:
    p = _as_points(points)
    # Order each pair by image position (raw, unmirrored frames: the subject's right eye is on the
    # image left), so the result never depends on a detector's left/right labelling convention.
    right_eye, left_eye = sorted((p[0], p[1]), key=lambda q: q[0])
    mouth_r, mouth_l = sorted((p[3], p[4]), key=lambda q: q[0])
    nose = p[2]
    eye_vec = left_eye - right_eye
    d = float(np.hypot(*eye_vec))
    if d < 1e-6:
        raise ValueError("eyes coincide")
    angle = float(np.arctan2(eye_vec[1], eye_vec[0]))
    c, s = np.cos(-angle), np.sin(-angle)
    rot = np.array([[c, -s], [s, c]])
    eye_mid = (right_eye + left_eye) / 2
    mouth_mid = (mouth_r + mouth_l) / 2
    n = rot @ (nose - eye_mid)
    m = rot @ (mouth_mid - eye_mid)
    if m[1] <= 1e-6:
        raise ValueError("mouth is not below the eyes")
    return Pose(yaw=float(n[0] / d), pitch=float(n[1] / m[1]), interocular=d, roll=angle)


def parallax(neutral: Sequence[Sequence[float]], moved: Sequence[Sequence[float]]) -> float:
    """Residual of the nose after fitting an affine map on the eyes and mouth corners."""
    a = _canonical(_as_points(neutral))
    b = _canonical(_as_points(moved))
    src = a[[0, 1, 3, 4]]
    dst = b[[0, 1, 3, 4]]
    design = np.hstack([src, np.ones((4, 1))])  # 4 x 3
    coeffs, *_ = np.linalg.lstsq(design, dst, rcond=None)  # 3 x 2
    predicted = np.array([a[2][0], a[2][1], 1.0]) @ coeffs
    d = float(np.hypot(*(b[1] - b[0])))
    if d < 1e-6:
        raise ValueError("eyes coincide")
    return float(np.hypot(*(b[2] - predicted)) / d)


def classify(p: Pose, base: Pose, t: Thresholds) -> str:
    dy = p.yaw - base.yaw
    dp = p.pitch - base.pitch
    if dy >= t.turn_yaw:
        return "left"
    if dy <= -t.turn_yaw:
        return "right"
    if dp <= -t.up_pitch and abs(dy) < t.up_max_yaw:
        return "up"
    if abs(dy) < t.neutral_yaw and abs(dp) < t.neutral_pitch:
        return "neutral"
    return "transition"


@dataclass(frozen=True)
class FaceObservation:
    """One frame: None when no single face was found."""

    landmarks: Landmarks
    box: tuple[float, float, float, float]  # x, y, w, h


@dataclass
class ChallengeResult:
    passed: bool
    reason: str | None
    observed: list[str]
    min_parallax: float | None
    baseline_frames: int
    movement_frames: dict[str, list[int]]
    # Calibration aids (relative to the baseline): the largest turn each way and the largest upward tilt.
    max_left: float | None = None
    max_right: float | None = None
    max_up: float | None = None


def _runs(labels: Iterable[str]) -> list[tuple[str, int, int]]:
    runs: list[tuple[str, int, int]] = []
    for i, label in enumerate(labels):
        if runs and runs[-1][0] == label:
            runs[-1] = (label, runs[-1][1], i)
        else:
            runs.append((label, i, i))
    return runs


def continuity_ok(faces: Sequence[FaceObservation | None], t: Thresholds) -> bool:
    """The face must not jump or change size abruptly between consecutive detected frames
    (a printed photo swapped for a live face in mid-capture would)."""
    previous: FaceObservation | None = None
    for face in faces:
        if face is None:
            continue
        if previous is not None:
            px, py, pw, ph = previous.box
            x, y, w, h = face.box
            width = max(pw, w, 1.0)
            jump = np.hypot((x + w / 2) - (px + pw / 2), (y + h / 2) - (py + ph / 2)) / width
            scale = abs(w - pw) / max(pw, 1.0)
            if jump > t.max_center_jump or scale > t.max_scale_jump:
                return False
        previous = face
    return True


def evaluate_challenge(
    faces: Sequence[FaceObservation | None],
    challenge: Sequence[str],
    t: Thresholds = Thresholds(),
) -> ChallengeResult:
    """Checks that the frames show: a frontal baseline, then exactly the challenge movements in the
    challenge order (each held for `min_run` frames), each turn with 3-D (non-planar) motion.

    Frames without a single face are treated as transitions (motion blur while turning); the caller
    decides separately whether too many frames lacked a face.
    """
    observed: list[str] = []
    movement_frames: dict[str, list[int]] = {}
    first = [f for f in faces[: max(t.min_neutral_frames + 2, 4)] if f is not None]
    if len(first) < t.min_neutral_frames:
        return ChallengeResult(False, "no_face", observed, None, len(first), movement_frames)
    try:
        poses = [pose(f.landmarks) if f is not None else None for f in faces]
    except ValueError:
        return ChallengeResult(False, "poor_quality", observed, None, 0, movement_frames)

    base_points = [f.landmarks for f in first[: t.min_neutral_frames]]
    base_poses = [pose(points) for points in base_points]
    base = Pose(
        yaw=float(np.median([b.yaw for b in base_poses])),
        pitch=float(np.median([b.pitch for b in base_poses])),
        interocular=float(np.median([b.interocular for b in base_poses])),
        roll=float(np.median([b.roll for b in base_poses])),
    )
    if abs(base.yaw) > t.baseline_max_yaw or any(abs(b.yaw - base.yaw) > t.neutral_yaw for b in base_poses):
        return ChallengeResult(False, "challenge_failed", observed, None, len(base_poses), movement_frames)
    base_landmarks = np.median(np.stack(base_points), axis=0)

    labels = [classify(p, base, t) if p is not None else "transition" for p in poses]
    yaws = [p.yaw - base.yaw for p in poses if p is not None]
    ups = [base.pitch - p.pitch for p in poses if p is not None]
    extremes = dict(max_left=round(max(yaws), 3), max_right=round(-min(yaws), 3), max_up=round(max(ups), 3))
    for label, start, end in _runs(labels):
        if label in ("neutral", "transition"):
            continue
        if end - start + 1 < t.min_run:
            continue
        observed.append(label)
        movement_frames.setdefault(label, []).extend(range(start, end + 1))

    # Collapse a movement held across a single dropped frame ("left, left") into one.
    collapsed: list[str] = []
    for label in observed:
        if not collapsed or collapsed[-1] != label:
            collapsed.append(label)
    if collapsed != list(challenge):
        return ChallengeResult(False, "challenge_failed", collapsed, None, len(base_poses), movement_frames, **extremes)

    parallaxes: list[float] = []
    for label in challenge:
        frames = movement_frames.get(label, [])
        # The strongest frame of the movement shows its 3-D structure best.
        best = max(frames, key=lambda i: abs(poses[i].yaw - base.yaw) + abs(poses[i].pitch - base.pitch))  # type: ignore[union-attr]
        parallaxes.append(parallax(base_landmarks, faces[best].landmarks))  # type: ignore[union-attr]
    min_par = min(parallaxes) if parallaxes else None
    if min_par is None or min_par < t.min_parallax:
        return ChallengeResult(False, "liveness_failed", collapsed, min_par, len(base_poses), movement_frames, **extremes)
    if not continuity_ok(faces, t):
        return ChallengeResult(False, "face_inconsistent", collapsed, min_par, len(base_poses), movement_frames, **extremes)
    return ChallengeResult(True, None, collapsed, min_par, len(base_poses), movement_frames, **extremes)
