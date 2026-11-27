# Attendance verifier (Phases 13–14)

An isolated service that checks whether the face at the attendance kiosk matches the employee whose ID was typed and whether the submitted frames satisfy the movement challenge. It cannot establish that the frames were captured live during this attempt. The web application cannot make the verification decision and the kiosk browser is never asked: the database accepts a check-in or check-out only with this service's HMAC-signed verdict.

Full design, trust model, limits and test results: [docs/phase13_14/ATTENDANCE.md](../../docs/phase13_14/ATTENDANCE.md).

## What it does

| Endpoint | Input | Output |
|---|---|---|
| `GET /v1/health` | — | `{ok, engine}` |
| `POST /v1/enroll` | enrollment id, nonce and employee id issued by the database; 8–40 JPEG frames | AES-256-GCM encrypted face reference, aggregate quality numbers, HMAC signature |
| `POST /v1/verify` | the attempt's id, nonce, employee, reference, action, challenge and encrypted reference (from `app_attendance_attempt_material`); 8–40 JPEG frames | signed verdict: `success`, or `failure` with a reason, plus aggregate metrics |

Every request needs `Authorization: Bearer <ATTENDANCE_VERIFIER_TOKEN>`. The service binds to `127.0.0.1` by default, keeps no state, writes no file, and logs one line per request (method, path, status, outcome code, duration) — never a frame, score list, template or key.

Verification signs a digest of the ordered submitted frame bytes. The database keeps a separate keyed fingerprint for accepted captures and refuses byte-for-byte reuse in another attempt in the same organization. It cannot detect first-time playback, altered frames or a virtual camera. These privately stored fingerprints are biometric-derived metadata linked to attempts; retention and database fingerprint-key backup and rotation procedures remain to be decided. The verifier and migration `20261201090000_attendance_capture_replay.sql` use the v2 verdict protocol and must be deployed together after acceptance.

## Models

| Model | File | SHA-256 (pinned in `verifier/engines.py`) | Licence | Source |
|---|---|---|---|---|
| YuNet face detector (2023-03) | `face_detection_yunet_2023mar.onnx` | `8f2383e4…52fa4` | MIT | OpenCV Zoo, `opencv/face_detection_yunet` |
| SFace recogniser (2021-12) | `face_recognition_sface_2021dec.onnx` | `0ba9fbfa…7e79` | Apache-2.0 | OpenCV Zoo, `opencv/face_recognition_sface` |

The service refuses to start if a file is missing or its hash differs. Model files are not in Git. The SFace weights were trained on public face datasets; review their terms before commercial production use (see the attendance document). No presentation-attack (anti-spoofing) model is included: none with verifiable provenance was available (see the document).

## Configuration (environment, never committed)

| Variable | Meaning |
|---|---|
| `ATTENDANCE_VERIFIER_TOKEN` | Bearer token shared with the web server (≥ 32 characters) |
| `ATTENDANCE_TEMPLATE_KEYS` | `<id>:<base64 32-byte key>[,…]` — AES-256-GCM keys for face references. **Only this service holds them.** Keep old keys listed until every reference encrypted with them has been re-enrolled. |
| `ATTENDANCE_TEMPLATE_KEY_ID` | Key id used for new references |
| `ATTENDANCE_RESULT_KEY` / `_ID` | Base64 HMAC key (≥ 32 bytes) and its id; the same key is inserted into `app_private.attendance_signing_keys` |
| `ATTENDANCE_YUNET_MODEL`, `ATTENDANCE_SFACE_MODEL` | Paths to the two pinned model files |
| `ATTENDANCE_VERIFIER_HOST`, `ATTENDANCE_VERIFIER_PORT` | Default `127.0.0.1`, `8790` |

Generate keys with a cryptographic generator, for example `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`, and register the result key in the database once (operator, psql):

```sql
insert into app_private.attendance_signing_keys (key_id, secret) values ('<id>', decode('<hex of the same 32 bytes>', 'hex'));
-- rotation: insert the new key, switch the verifier to it, then: update app_private.attendance_signing_keys set retired_at = now() where key_id = '<old id>';
```

## Running

```powershell
python -m venv C:\balaban\verifier-venv
C:\balaban\verifier-venv\Scripts\python -m pip install -r services\attendance-verifier\requirements.txt
C:\balaban\verifier-venv\Scripts\python -I services\attendance-verifier\run.py
```

`--synthetic-test-engine` replaces the face engine with a test engine whose "frames" are JSON landmark descriptions. It exists for automated tests only; every database refuses its verdicts unless a disposable test database sets `app_private.attendance_config.allow_synthetic_engine = true`.

## Tests

```powershell
python -I -c "import sys; sys.path.insert(0, 'services/attendance-verifier'); import unittest; unittest.main(module=None, argv=['x', 'discover', '-s', 'services/attendance-verifier/tests', '-t', 'services/attendance-verifier'])"
```

The unit tests use a synthetic 3-D head model (five points), never an image of a person.
