"""The verification and enrollment decisions, shared by every engine.

A verification succeeds only when ALL of these hold for the frames of this one attempt:
  1. 8-40 decodable frames; no frame shows more than one relevant face; at most 40 % lack a face;
  2. a frontal baseline, then exactly the random challenge movements in order (geometry.py);
  3. each movement shows non-planar (3-D) motion of the nose against the eyes and mouth;
  4. the face does not jump or change size abruptly between frames;
  5. the baseline frames match the employee's enrolled reference (cosine >= match threshold);
  6. every frame with a face still resembles the reference (cosine >= consistency threshold), so a
     photo of the employee cannot be swapped for another person's live face mid-capture.

The verdict carries only aggregate numbers. Frames, embeddings and the decrypted reference exist
only in memory for the duration of the request.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field

import numpy as np

from . import crypto
from .engines import FrameAnalysis, FrameError, relevant_faces
from .geometry import FaceObservation, Thresholds, evaluate_challenge

MIN_FRAMES = 8
MAX_FRAMES = 40
MAX_MISSING_RATIO = 0.4
ENROLL_CHALLENGE = ["left", "right"]


@dataclass(frozen=True)
class Policy:
    # OpenCV's published SFace cosine threshold (same identity >= 0.363 on LFW). Provisional: the
    # real-camera trial measures genuine and impostor scores before any change.
    match: float = 0.363
    consistency: float = 0.28
    enroll_self_consistency: float = 0.55
    enroll_min_interocular_px: float = 28.0
    enroll_min_baseline_frames: int = 3
    geometry: Thresholds = field(default_factory=Thresholds)


@dataclass
class Keys:
    template_keys: dict[str, bytes]
    template_key_id: str
    result_key: bytes
    result_key_id: str


def _now_ms() -> int:
    return int(time.time() * 1000)


HINT_DARK = 70.0          # mean grey level below which "more light" is suggested
HINT_SMALL_FACE_PX = 30.0  # eye distance below which "come closer" is suggested


def _hint(reason: str | None, numbers: dict, analyses: list, observations: list, policy: "Policy") -> None:
    """Adds aggregate capture numbers and, for a failure, one short hint code the screen can show.
    Hints are advice for the person in front of the camera, never part of the decision."""
    levels = [a.brightness for a in analyses if getattr(a, "brightness", None) is not None]
    if levels:
        numbers["brightness"] = round(float(np.mean(levels)), 1)
    eyes = [float(np.hypot(*(o.landmarks[1] - o.landmarks[0]))) for o in observations if o is not None]
    if eyes:
        numbers["face_px"] = round(float(np.median(eyes)), 1)
    if reason is None:
        return
    turn = max(float(numbers.get("max_left", 0) or 0), float(numbers.get("max_right", 0) or 0))
    if levels and numbers["brightness"] < HINT_DARK and reason in ("no_face", "poor_quality", "challenge_failed", "liveness_failed"):
        numbers["hint"] = "more_light"
    elif reason in ("no_face", "poor_quality") or (eyes and numbers["face_px"] < HINT_SMALL_FACE_PX and reason == "challenge_failed"):
        numbers["hint"] = "come_closer"
    elif reason == "challenge_failed" and turn < policy.geometry.turn_yaw:
        numbers["hint"] = "turn_more"
    elif reason == "challenge_failed":
        numbers["hint"] = "follow_arrows"
    elif reason == "multiple_faces":
        numbers["hint"] = "one_person"


def _analyse(engine, frames: list[bytes], seen: list | None = None):
    """`seen` (optional) receives the decoded analyses even when the capture is refused, for hints."""
    if not MIN_FRAMES <= len(frames) <= MAX_FRAMES:
        return None, "upload_invalid"
    analyses: list[FrameAnalysis] = seen if seen is not None else []
    try:
        for data in frames:
            analyses.append(engine.analyse(data))
    except FrameError:
        return None, "upload_invalid"
    observations: list[FaceObservation | None] = []
    chosen = []
    for analysis in analyses:
        faces = relevant_faces(analysis.faces)
        if len(faces) > 1:
            return None, "multiple_faces"
        if not faces:
            observations.append(None)
            chosen.append(None)
            continue
        face = faces[0]
        observations.append(FaceObservation(landmarks=face.landmarks, box=face.box))
        chosen.append(face)
    missing = sum(1 for o in observations if o is None)
    if missing == len(observations) or missing / len(observations) > MAX_MISSING_RATIO:
        return None, "no_face"
    return (analyses, observations, chosen), None


def _extremes(target: dict, result) -> None:
    for key in ("max_left", "max_right", "max_up"):
        value = getattr(result, key, None)
        if value is not None:
            target[key] = value


def verify(engine, frames: list[bytes], material: dict, keys: Keys, policy: Policy = Policy()) -> dict:
    started = time.perf_counter()
    challenge = [str(s) for s in material["challenge"]]
    metrics: dict[str, object] = {"frames": len(frames), "challenge": ",".join(challenge)}
    reason = None

    seen: list = []
    analysed, reason = _analyse(engine, frames, seen)
    observations_for_hint: list = []
    if analysed is not None:
        analyses, observations, chosen = analysed
        observations_for_hint = observations
        metrics["faces_found"] = sum(1 for o in observations if o is not None)
        result = evaluate_challenge(observations, challenge, policy.geometry)
        metrics["observed"] = ",".join(result.observed)
        _extremes(metrics, result)
        if result.min_parallax is not None:
            metrics["parallax"] = round(result.min_parallax, 4)
        if not result.passed:
            reason = result.reason or "challenge_failed"
        else:
            try:
                reference = crypto.decrypt_template(keys.template_keys, material["employee_id"], material["reference_id"],
                                                    material["ciphertext"])
            except crypto.TemplateError:
                reference = None
                reason = "reference_unavailable"
            if reference is not None:
                baseline_idx = [i for i, o in enumerate(observations) if o is not None][: policy.geometry.min_neutral_frames + 1]
                scores = []
                for i, face in enumerate(chosen):
                    if face is None:
                        continue
                    scores.append((i, float(np.dot(engine.embed(analyses[i], face), reference))))
                baseline_scores = [s for i, s in scores if i in baseline_idx]
                match = float(np.median(baseline_scores)) if baseline_scores else -1.0
                lowest = min(s for _, s in scores)
                metrics["match_score"] = round(match, 4)
                metrics["min_frame_score"] = round(lowest, 4)
                metrics["liveness_score"] = metrics.get("parallax", 0)
                if match < policy.match:
                    reason = "face_mismatch"
                elif lowest < policy.consistency:
                    reason = "face_inconsistent"
                del reference
        del analyses
    _hint(reason, metrics, seen, observations_for_hint, policy)
    del seen
    metrics["processing_ms"] = int((time.perf_counter() - started) * 1000)
    metrics["match_threshold"] = policy.match
    metrics["consistency_threshold"] = policy.consistency
    metrics["parallax_threshold"] = policy.geometry.min_parallax

    outcome = "success" if reason is None else "failure"
    issued = _now_ms()
    capture_hash = crypto.capture_digest(frames)
    message = crypto.attempt_message(
        attempt_id=material["attempt_id"], nonce=material["nonce"], employee_id=material["employee_id"],
        reference_id=material["reference_id"], action=material["action"], challenge=challenge, outcome=outcome,
        reason=reason, engine=engine.name, issued_at_ms=issued, key_id=keys.result_key_id, capture_hash=capture_hash)
    result = {"outcome": outcome, "engine": engine.name, "issued_at_ms": str(issued), "key_id": keys.result_key_id,
              "capture_hash": capture_hash, "metrics": metrics}
    if reason is not None:
        result["reason"] = reason
    return {"result": result, "signature": crypto.sign(keys.result_key, message)}


def enroll(engine, frames: list[bytes], material: dict, keys: Keys, policy: Policy = Policy()) -> dict:
    started = time.perf_counter()
    quality: dict[str, object] = {"frames": len(frames)}
    seen: list = []
    analysed, reason = _analyse(engine, frames, seen)
    observations_for_hint: list = []
    ciphertext = None
    if analysed is not None:
        analyses, observations, chosen = analysed
        observations_for_hint = observations
        result = evaluate_challenge(observations, ENROLL_CHALLENGE, policy.geometry)
        quality["observed"] = ",".join(result.observed)
        _extremes(quality, result)
        if result.min_parallax is not None:
            quality["parallax"] = round(result.min_parallax, 4)
        if not result.passed:
            reason = result.reason or "challenge_failed"
        else:
            moving = {i for frames_ in result.movement_frames.values() for i in frames_}
            baseline = [i for i, o in enumerate(observations) if o is not None and i not in moving
                        and i < min(moving, default=len(observations))]
            good = [i for i in baseline if float(np.hypot(*(observations[i].landmarks[1] - observations[i].landmarks[0])))
                    >= policy.enroll_min_interocular_px and chosen[i].score >= 0.85]
            quality["baseline_frames"] = len(good)
            if len(good) < policy.enroll_min_baseline_frames:
                reason = "poor_quality"
            else:
                vectors = np.stack([engine.embed(analyses[i], chosen[i]) for i in good])
                mean = vectors.mean(axis=0)
                mean = mean / np.linalg.norm(mean)
                self_scores = vectors @ mean
                turned = [float(np.dot(engine.embed(analyses[i], chosen[i]), mean)) for i in sorted(moving) if chosen[i] is not None]
                quality["self_consistency"] = round(float(self_scores.min()), 4)
                quality["turned_min_score"] = round(min(turned), 4) if turned else None
                quality["interocular_px"] = round(float(np.median([np.hypot(*(observations[i].landmarks[1] - observations[i].landmarks[0])) for i in good])), 1)
                if float(self_scores.min()) < policy.enroll_self_consistency or (turned and min(turned) < policy.consistency):
                    reason = "face_inconsistent"
                else:
                    ciphertext = crypto.encrypt_template(keys.template_keys[keys.template_key_id], keys.template_key_id,
                                                         material["employee_id"], material["enrollment_id"], mean)
                del vectors, mean
        del analyses
    _hint(None if ciphertext is not None else (reason or "poor_quality"), quality, seen, observations_for_hint, policy)
    del seen
    quality["processing_ms"] = int((time.perf_counter() - started) * 1000)
    quality = {k: v for k, v in quality.items() if v is not None}
    issued = _now_ms()
    if ciphertext is None:
        return {"result": {"outcome": "failure", "reason": reason or "poor_quality", "engine": engine.name,
                           "issued_at_ms": str(issued), "key_id": keys.result_key_id, "quality": quality}}
    digest = hashlib.sha256(ciphertext).hexdigest()
    message = crypto.enroll_message(enrollment_id=material["enrollment_id"], nonce=material["nonce"],
                                    employee_id=material["employee_id"], ciphertext_sha256=digest, engine=engine.name,
                                    issued_at_ms=issued, key_id=keys.result_key_id)
    return {
        "result": {"outcome": "success", "engine": engine.name, "issued_at_ms": str(issued), "key_id": keys.result_key_id,
                   "quality": quality},
        "ciphertext": ciphertext,
        "signature": crypto.sign(keys.result_key, message),
    }
