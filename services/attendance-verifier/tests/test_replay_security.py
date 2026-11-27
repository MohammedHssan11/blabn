"""Security regression illustrating that attempt binding does not prove frame freshness.

All frames are synthetic landmark descriptions; this test stores no biometric data. It is an
expected failure until trusted capture or another effective replay defense is implemented.
"""
import os
import unittest
import uuid

from tests import synthetic
from verifier import decide
from verifier.engines import SyntheticEngine


class ReplayResistanceTests(unittest.TestCase):
    @unittest.expectedFailure
    def test_same_captured_frames_cannot_satisfy_a_fresh_attempt(self):
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

        self.assertEqual(decide.verify(engine, frames, attempt(), keys)["result"]["outcome"], "success")
        # Required behavior: frames previously captured for a different attempt must not suffice.
        self.assertEqual(decide.verify(engine, frames, attempt(), keys)["result"]["outcome"], "failure")
