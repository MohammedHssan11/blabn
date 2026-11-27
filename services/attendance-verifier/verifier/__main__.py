"""Starts the attendance verifier.

    python -I -m verifier                       # real OpenCV engine (models from the environment)
    python -I -m verifier --synthetic-test-engine   # automated tests only; refused by production databases

Environment (never committed; see services/attendance-verifier/README.md):
  ATTENDANCE_VERIFIER_TOKEN        bearer token shared with the web server (>= 32 characters)
  ATTENDANCE_TEMPLATE_KEYS         "<key id>:<base64 32-byte key>[,...]"  (AES-256-GCM, verifier only)
  ATTENDANCE_TEMPLATE_KEY_ID       key id used for new references
  ATTENDANCE_RESULT_KEY            base64 key (>= 32 bytes) shared with the database for verdict HMACs
  ATTENDANCE_RESULT_KEY_ID         its id, as stored in app_private.attendance_signing_keys
  ATTENDANCE_YUNET_MODEL           path to face_detection_yunet_2023mar.onnx (SHA-256 pinned)
  ATTENDANCE_SFACE_MODEL           path to face_recognition_sface_2021dec.onnx (SHA-256 pinned)
  ATTENDANCE_VERIFIER_HOST / _PORT default 127.0.0.1 / 8790
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import sys

from . import decide
from .engines import ModelError, OpenCvEngine, SyntheticEngine
from .service import serve


def _key(value: str, name: str) -> bytes:
    try:
        raw = base64.b64decode(value, validate=True)
    except Exception:
        sys.exit(f"{name} is not valid base64")
    if len(raw) < 32:
        sys.exit(f"{name} must be at least 32 bytes")
    return raw


def load_keys(env: dict) -> decide.Keys:
    template_keys: dict[str, bytes] = {}
    for part in filter(None, (env.get("ATTENDANCE_TEMPLATE_KEYS") or "").split(",")):
        kid, _, value = part.partition(":")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", kid):
            sys.exit("ATTENDANCE_TEMPLATE_KEYS has an invalid key id")
        key = _key(value, "template key")
        if len(key) != 32:
            sys.exit("template keys must be exactly 32 bytes (AES-256)")
        template_keys[kid] = key
    kid = env.get("ATTENDANCE_TEMPLATE_KEY_ID", "")
    if kid not in template_keys:
        sys.exit("ATTENDANCE_TEMPLATE_KEY_ID must name one of ATTENDANCE_TEMPLATE_KEYS")
    result_id = env.get("ATTENDANCE_RESULT_KEY_ID", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", result_id):
        sys.exit("ATTENDANCE_RESULT_KEY_ID is missing or invalid")
    return decide.Keys(template_keys=template_keys, template_key_id=kid,
                       result_key=_key(env.get("ATTENDANCE_RESULT_KEY", ""), "ATTENDANCE_RESULT_KEY"), result_key_id=result_id)


def main() -> None:
    parser = argparse.ArgumentParser(prog="verifier")
    parser.add_argument("--synthetic-test-engine", action="store_true",
                        help="automated tests only: frames are JSON descriptions, never images of people")
    args = parser.parse_args()
    env = os.environ
    token = env.get("ATTENDANCE_VERIFIER_TOKEN", "")
    if len(token) < 32:
        sys.exit("ATTENDANCE_VERIFIER_TOKEN must be at least 32 characters")
    keys = load_keys(env)
    if args.synthetic_test_engine:
        engine = SyntheticEngine()
    else:
        try:
            engine = OpenCvEngine(env.get("ATTENDANCE_YUNET_MODEL", ""), env.get("ATTENDANCE_SFACE_MODEL", ""))
        except ModelError as exc:
            sys.exit(f"verification models unavailable: {exc}")
    serve(engine, keys, token, env.get("ATTENDANCE_VERIFIER_HOST", "127.0.0.1"), int(env.get("ATTENDANCE_VERIFIER_PORT", "8790")))


if __name__ == "__main__":
    main()
