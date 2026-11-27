"""HTTP interface of the attendance verifier.

Only the Balaban web server calls it, with a bearer token. It binds to 127.0.0.1 by default. It keeps
no state, writes no file and logs no request body, frame, score list, template or key: each log line
is the method, path, status, outcome code and duration.

  GET  /v1/health  -> {"ok": true, "engine": ...}
  POST /v1/verify  {"attempt": {...from app_attendance_attempt_material...}, "frames": ["<base64>", ...]}
  POST /v1/enroll  {"enrollment": {"enrollment_id", "nonce", "employee_id"}, "frames": [...]}
"""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import decide

MAX_BODY = 24 * 1024 * 1024
UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
HEX32 = re.compile(r"^[0-9a-f]{32}$")
STEPS = {"left", "right", "up"}


class BadRequest(Exception):
    pass


def _frames(body: dict) -> list[bytes]:
    frames = body.get("frames")
    if not isinstance(frames, list) or not frames or len(frames) > decide.MAX_FRAMES:
        raise BadRequest("frames")
    out = []
    for item in frames:
        if not isinstance(item, str) or len(item) > 600_000:
            raise BadRequest("frame")
        try:
            out.append(base64.b64decode(item, validate=True))
        except (binascii.Error, ValueError) as exc:
            raise BadRequest("frame") from exc
    return out


def _attempt(body: dict) -> dict:
    a = body.get("attempt")
    if not isinstance(a, dict):
        raise BadRequest("attempt")
    for key in ("attempt_id", "employee_id", "reference_id"):
        if not isinstance(a.get(key), str) or not UUID.match(a[key]):
            raise BadRequest(key)
    if not isinstance(a.get("nonce"), str) or not HEX32.match(a["nonce"]):
        raise BadRequest("nonce")
    if a.get("action") not in ("check_in", "check_out"):
        raise BadRequest("action")
    challenge = a.get("challenge")
    if not isinstance(challenge, list) or not 1 <= len(challenge) <= 4 or any(s not in STEPS for s in challenge):
        raise BadRequest("challenge")
    try:
        ciphertext = base64.b64decode(a.get("ciphertext", ""), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise BadRequest("ciphertext") from exc
    return {**a, "ciphertext": ciphertext}


def _enrollment(body: dict) -> dict:
    e = body.get("enrollment")
    if not isinstance(e, dict):
        raise BadRequest("enrollment")
    for key in ("enrollment_id", "employee_id"):
        if not isinstance(e.get(key), str) or not UUID.match(e[key]):
            raise BadRequest(key)
    if not isinstance(e.get("nonce"), str) or not HEX32.match(e["nonce"]):
        raise BadRequest("nonce")
    return e


def _summary(outcome: str, numbers: dict | None) -> str:
    """Log the outcome only; biometric match and movement measurements stay out of logs."""
    return outcome


def make_handler(engine, keys: decide.Keys, token: str, policy: decide.Policy):
    class Handler(BaseHTTPRequestHandler):
        server_version = "BalabanAttendanceVerifier/1"
        sys_version = ""

        def log_message(self, format: str, *args) -> None:  # noqa: A002 - silence the default access log
            pass

        def _log(self, status: int, outcome: str, started: float) -> None:
            sys.stderr.write(f"{self.command} {self.path.split('?')[0]} {status} {outcome} {int((time.perf_counter() - started) * 1000)}ms\n")

        def _send(self, status: int, payload: dict, outcome: str, started: float) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            self._log(status, outcome, started)

        def _authorized(self) -> bool:
            header = self.headers.get("Authorization", "")
            supplied = header[7:] if header.startswith("Bearer ") else ""
            return hmac.compare_digest(supplied.encode(), token.encode())

        def do_GET(self) -> None:  # noqa: N802
            started = time.perf_counter()
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"}, "unauthorized", started)
            if self.path == "/v1/health":
                return self._send(200, {"ok": True, "engine": engine.name}, "health", started)
            return self._send(404, {"error": "not_found"}, "not_found", started)

        def do_POST(self) -> None:  # noqa: N802
            started = time.perf_counter()
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"}, "unauthorized", started)
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY:
                return self._send(413, {"error": "body_size"}, "body_size", started)
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw)
                del raw
                if self.path == "/v1/verify":
                    verdict = decide.verify(engine, _frames(body), _attempt(body), keys, policy)
                    return self._send(200, verdict, _summary(verdict["result"].get("reason", "success"), verdict["result"].get("metrics")), started)
                if self.path == "/v1/enroll":
                    verdict = decide.enroll(engine, _frames(body), _enrollment(body), keys, policy)
                    if "ciphertext" in verdict:
                        verdict["ciphertext"] = base64.b64encode(verdict["ciphertext"]).decode()
                    return self._send(200, verdict, _summary(verdict["result"].get("reason", "success"), verdict["result"].get("quality")), started)
                return self._send(404, {"error": "not_found"}, "not_found", started)
            except (BadRequest, json.JSONDecodeError, UnicodeDecodeError) as exc:
                return self._send(400, {"error": "bad_request", "field": str(exc)[:40]}, "bad_request", started)
            except Exception:  # never echo internals
                return self._send(500, {"error": "verifier_error"}, "verifier_error", started)

    return Handler


def serve(engine, keys: decide.Keys, token: str, host: str, port: int, policy: decide.Policy = decide.Policy()) -> None:
    server = ThreadingHTTPServer((host, port), make_handler(engine, keys, token, policy))
    server.daemon_threads = True
    sys.stderr.write(f"attendance verifier listening on {host}:{port} with engine {engine.name}\n")
    server.serve_forever()
