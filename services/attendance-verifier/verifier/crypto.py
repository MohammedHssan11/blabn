"""Face-reference encryption and verdict signing.

* A face reference (the mean of L2-normalised SFace embeddings, 128 float32) is encrypted with
  AES-256-GCM under the template key, which only this service holds. The associated data binds the
  ciphertext to its employee and reference id, so a ciphertext copied to another row or employee
  does not decrypt.
* A verdict is signed with HMAC-SHA256 under the result key, which the database also holds
  (app_private.attendance_signing_keys). The canonical strings below must match
  supabase/migrations/20261129090000_attendance.sql exactly.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import struct

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"BLT1"
EMBEDDING_DIM = 128


class TemplateError(Exception):
    """A reference that cannot be decrypted or parsed. Never includes key or template material."""


def _aad(employee_id: str, reference_id: str) -> bytes:
    return f"balaban-attendance-template|v1|{employee_id.lower()}|{reference_id.lower()}".encode()


def encrypt_template(key: bytes, key_id: str, employee_id: str, reference_id: str, embedding: np.ndarray) -> bytes:
    vec = np.asarray(embedding, dtype=np.float32).reshape(-1)
    if vec.shape != (EMBEDDING_DIM,) or not np.all(np.isfinite(vec)):
        raise TemplateError("bad embedding shape")
    kid = key_id.encode()
    if not 1 <= len(kid) <= 64:
        raise TemplateError("bad key id")
    nonce = os.urandom(12)
    sealed = AESGCM(key).encrypt(nonce, vec.tobytes(), _aad(employee_id, reference_id))
    return MAGIC + struct.pack("B", len(kid)) + kid + nonce + sealed


def decrypt_template(keys: dict[str, bytes], employee_id: str, reference_id: str, blob: bytes) -> np.ndarray:
    try:
        if blob[:4] != MAGIC:
            raise TemplateError("unknown format")
        n = blob[4]
        kid = blob[5 : 5 + n].decode()
        nonce = blob[5 + n : 17 + n]
        sealed = blob[17 + n :]
        key = keys.get(kid)
        if key is None:
            raise TemplateError("unknown template key")
        raw = AESGCM(key).decrypt(nonce, sealed, _aad(employee_id, reference_id))
    except TemplateError:
        raise
    except Exception as exc:  # InvalidTag, IndexError, UnicodeDecodeError: never echo details
        raise TemplateError("reference could not be decrypted") from exc
    vec = np.frombuffer(raw, dtype=np.float32)
    if vec.shape != (EMBEDDING_DIM,):
        raise TemplateError("bad reference length")
    return vec.copy()


def sign(key: bytes, message: str) -> str:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).hexdigest()


def capture_digest(frames: list[bytes]) -> str:
    """Digest the exact ordered frame bytes with unambiguous lengths; no pixels are retained here."""
    digest = hashlib.sha256(b"balaban-attendance-capture-v1\x00")
    for frame in frames:
        digest.update(len(frame).to_bytes(8, "big"))
        digest.update(frame)
    return digest.hexdigest()


def attempt_message(*, attempt_id: str, nonce: str, employee_id: str, reference_id: str, action: str,
                    challenge: list[str], outcome: str, reason: str | None, engine: str, issued_at_ms: int,
                    key_id: str, capture_hash: str) -> str:
    return "|".join([
        "balaban-attendance", "attempt", "v2", attempt_id.lower(), nonce.lower(), employee_id.lower(),
        reference_id.lower(), action, ",".join(challenge), capture_hash.lower(), outcome, reason or "", engine, str(issued_at_ms), key_id,
    ])


def enroll_message(*, enrollment_id: str, nonce: str, employee_id: str, ciphertext_sha256: str, engine: str,
                   issued_at_ms: int, key_id: str) -> str:
    return "|".join([
        "balaban-attendance", "enroll", "v1", enrollment_id.lower(), nonce.lower(), employee_id.lower(),
        ciphertext_sha256.lower(), "success", engine, str(issued_at_ms), key_id,
    ])
