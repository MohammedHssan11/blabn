"""Synthetic checks for exact-capture fingerprinting. The database decides whether it was used.

This does not establish freshness or protect against modified/re-encoded frames or camera injection.
"""
import os
import unittest
import uuid

from tests import synthetic
from verifier import crypto, decide
from verifier.engines import SyntheticEngine


class ReplayResistanceTests(unittest.TestCase):
    def test_same_captured_frames_have_the_same_signed_digest_across_attempts(self):
        engine = SyntheticEngine()
        keys = decide.Keys(template_keys={"template": os.urandom(32)}, template_key_id="template",
                           result_key=os.urandom(32), result_key_id="result")
        employee = str(uuid.uuid4())
        reference = str(uuid.uuid4())
        enrolled = decide.enroll(engine, synthetic.sequence(["left", "right"], neutral=4),
                                 {"employee_id": employee, "enrollment_id": reference, "nonce": os.urandom(16).hex()}, keys)
        self.assertEqual(enrolled["result"]["outcome"], "success")
        frames = synthetic.sequence(["left", "right"])

        def attempt():
            return {"attempt_id": str(uuid.uuid4()), "nonce": os.urandom(16).hex(), "employee_id": employee,
                    "reference_id": reference, "action": "check_in", "challenge": ["left", "right"],
                    "ciphertext": enrolled["ciphertext"]}

        first = decide.verify(engine, frames, attempt(), keys)
        second = decide.verify(engine, frames, attempt(), keys)
        self.assertEqual(first["result"]["outcome"], "success")
        self.assertEqual(first["result"]["capture_hash"], second["result"]["capture_hash"])
        self.assertNotEqual(first["signature"], second["signature"])

    def test_frame_order_and_boundaries_are_part_of_the_digest(self):
        self.assertNotEqual(crypto.capture_digest([b"ab", b"c"]), crypto.capture_digest([b"a", b"bc"]))
        self.assertNotEqual(crypto.capture_digest([b"a", b"b"]), crypto.capture_digest([b"b", b"a"]))
