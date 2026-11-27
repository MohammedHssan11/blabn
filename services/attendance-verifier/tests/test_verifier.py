"""Unit tests for the verifier decision logic, run with synthetic landmarks only:

    python -I -m unittest discover -s services/attendance-verifier/tests -t services/attendance-verifier
"""

from __future__ import annotations

import hashlib
import os
import unittest
import uuid

import numpy as np

from tests import synthetic as syn
from verifier import crypto, decide, geometry
from verifier.engines import OpenCvEngine, ModelError, SyntheticEngine, relevant_faces, DetectedFace
from verifier.service import _summary


def obs(points):
    return geometry.FaceObservation(landmarks=points, box=tuple(syn.box(points)))


class LogPrivacyTests(unittest.TestCase):
    def test_summary_never_logs_face_scores_or_movements(self):
        self.assertEqual(_summary("success", {"match_score": 0.91, "parallax": 0.25, "observed": "left,right"}), "success")
        self.assertEqual(_summary("failure", None), "failure")


class PoseTests(unittest.TestCase):
    def test_turning_left_increases_yaw_and_right_decreases_it(self):
        base = geometry.pose(syn.project(syn.HEAD))
        left = geometry.pose(syn.project(syn.HEAD, yaw_deg=25))
        right = geometry.pose(syn.project(syn.HEAD, yaw_deg=-25))
        self.assertAlmostEqual(base.yaw, 0.0, places=6)
        self.assertGreater(left.yaw - base.yaw, 0.22)
        self.assertLess(right.yaw - base.yaw, -0.22)

    def test_looking_up_moves_the_nose_toward_the_eyes(self):
        base = geometry.pose(syn.project(syn.HEAD))
        up = geometry.pose(syn.project(syn.HEAD, pitch_deg=20))
        self.assertLess(up.pitch - base.pitch, -0.10)

    def test_head_roll_does_not_look_like_a_turn(self):
        base = geometry.pose(syn.project(syn.HEAD))
        rolled = geometry.pose(syn.project(syn.HEAD, roll_deg=20))
        self.assertLess(abs(rolled.yaw - base.yaw), 0.02)
        self.assertLess(abs(rolled.pitch - base.pitch), 0.02)

    def test_left_right_labels_of_the_detector_do_not_matter(self):
        turned = syn.project(syn.HEAD, yaw_deg=25)
        swapped = turned[[1, 0, 2, 4, 3]]
        self.assertAlmostEqual(geometry.pose(turned).yaw, geometry.pose(swapped).yaw, places=9)
        self.assertAlmostEqual(geometry.pose(turned).pitch, geometry.pose(swapped).pitch, places=9)
        neutral = syn.project(syn.HEAD)
        self.assertAlmostEqual(geometry.parallax(neutral, turned), geometry.parallax(neutral[[1, 0, 2, 4, 3]], swapped), places=9)

    def test_invalid_landmarks_are_refused(self):
        with self.assertRaises(ValueError):
            geometry.pose([[0, 0]] * 5)
        with self.assertRaises(ValueError):
            geometry.pose([[0, 0], [1, 1]])


class ParallaxTests(unittest.TestCase):
    def test_a_real_head_turn_shows_parallax(self):
        for yaw in (20, -20, 30, -30):
            p = geometry.parallax(syn.project(syn.HEAD), syn.project(syn.HEAD, yaw_deg=yaw))
            self.assertGreater(p, geometry.Thresholds().min_parallax, yaw)
        p = geometry.parallax(syn.project(syn.HEAD), syn.project(syn.HEAD, pitch_deg=20))
        self.assertGreater(p, geometry.Thresholds().min_parallax)

    def test_a_flat_photo_turned_tilted_or_moved_shows_almost_none(self):
        photo = syn.flat_photo()
        neutral = syn.project(photo)
        for kwargs in ({"yaw_deg": 35}, {"yaw_deg": -35}, {"pitch_deg": 30}, {"roll_deg": 15}, {"distance": 380},
                       {"shift": (40, -20)}):
            p = geometry.parallax(neutral, syn.project(photo, **kwargs))
            self.assertLess(p, geometry.Thresholds().min_parallax / 2, kwargs)


class ChallengeTests(unittest.TestCase):
    def observations(self, steps, points=syn.HEAD, **kw):
        poses = [(0, 0)] * 3
        for step in steps:
            yaw, pitch = {"left": (28, 0), "right": (-28, 0), "up": (0, 22)}[step]
            poses += [(yaw / 2, pitch / 2), (yaw, pitch), (yaw, pitch), (yaw, pitch), (0, 0)]
        return [obs(syn.project(points, yaw_deg=y, pitch_deg=p, **kw)) for y, p in poses]

    def test_every_two_step_challenge_passes_when_performed(self):
        for a in ("left", "right", "up"):
            for b in ("left", "right", "up"):
                if a == b:
                    continue
                result = geometry.evaluate_challenge(self.observations([a, b]), [a, b])
                self.assertTrue(result.passed, (a, b, result))
                self.assertEqual(result.observed, [a, b])

    def test_wrong_order_missing_or_extra_movement_fails(self):
        self.assertEqual(geometry.evaluate_challenge(self.observations(["right", "left"]), ["left", "right"]).reason, "challenge_failed")
        self.assertEqual(geometry.evaluate_challenge(self.observations(["left"]), ["left", "right"]).reason, "challenge_failed")
        self.assertEqual(geometry.evaluate_challenge(self.observations(["left", "up", "right"]), ["left", "right"]).reason,
                         "challenge_failed")
        self.assertEqual(geometry.evaluate_challenge(self.observations([]), ["left", "up"]).reason, "challenge_failed")

    def test_a_single_frame_flick_is_not_a_held_movement(self):
        frames = [obs(syn.project(syn.HEAD))] * 3 + [obs(syn.project(syn.HEAD, yaw_deg=28))] + [obs(syn.project(syn.HEAD))] * 2 \
            + [obs(syn.project(syn.HEAD, yaw_deg=-28))] * 3
        self.assertEqual(geometry.evaluate_challenge(frames, ["left", "right"]).reason, "challenge_failed")

    def test_a_flat_photo_cannot_perform_the_challenge(self):
        photo = syn.flat_photo()
        result = geometry.evaluate_challenge(self.observations(["left", "right"], points=photo), ["left", "right"])
        self.assertFalse(result.passed)
        self.assertIn(result.reason, ("challenge_failed", "liveness_failed"))

    def test_baseline_must_face_the_camera_and_exist(self):
        turned = [obs(syn.project(syn.HEAD, yaw_deg=30))] * 10
        self.assertFalse(geometry.evaluate_challenge(turned, ["left", "right"]).passed)
        self.assertEqual(geometry.evaluate_challenge([None] * 10, ["left", "right"]).reason, "no_face")

    def test_a_jump_between_frames_is_refused(self):
        frames = self.observations(["left", "right"])
        jumped = geometry.FaceObservation(landmarks=frames[6].landmarks + 300, box=(frames[6].box[0] + 300,) + frames[6].box[1:])
        frames[6] = jumped
        result = geometry.evaluate_challenge(frames, ["left", "right"])
        self.assertFalse(result.passed)


class CryptoTests(unittest.TestCase):
    def setUp(self):
        self.key = os.urandom(32)
        self.emp, self.ref = str(uuid.uuid4()), str(uuid.uuid4())
        self.vec = SyntheticEngine.identity_vector("someone")

    def test_round_trip(self):
        blob = crypto.encrypt_template(self.key, "t1", self.emp, self.ref, self.vec)
        self.assertNotIn(self.vec.tobytes(), blob)
        out = crypto.decrypt_template({"t1": self.key}, self.emp, self.ref, blob)
        np.testing.assert_array_equal(out, self.vec)

    def test_bound_to_employee_reference_and_key(self):
        blob = crypto.encrypt_template(self.key, "t1", self.emp, self.ref, self.vec)
        for args in (({"t1": self.key}, str(uuid.uuid4()), self.ref), ({"t1": self.key}, self.emp, str(uuid.uuid4())),
                     ({"t1": os.urandom(32)}, self.emp, self.ref), ({"t2": self.key}, self.emp, self.ref)):
            with self.assertRaises(crypto.TemplateError):
                crypto.decrypt_template(args[0], args[1], args[2], blob)
        tampered = bytearray(blob)
        tampered[-1] ^= 1
        with self.assertRaises(crypto.TemplateError):
            crypto.decrypt_template({"t1": self.key}, self.emp, self.ref, bytes(tampered))

    def test_canonical_messages_match_the_database_format(self):
        msg = crypto.attempt_message(attempt_id="A", nonce="AB", employee_id="E", reference_id="R", action="check_in",
                                     challenge=["left", "up"], outcome="failure", reason="face_mismatch", engine="eng",
                                     issued_at_ms=1700000000000, key_id="k1")
        self.assertEqual(msg, "balaban-attendance|attempt|v1|a|ab|e|r|check_in|left,up|failure|face_mismatch|eng|1700000000000|k1")
        msg = crypto.enroll_message(enrollment_id="N", nonce="AB", employee_id="E", ciphertext_sha256="FF", engine="eng",
                                    issued_at_ms=1, key_id="k1")
        self.assertEqual(msg, "balaban-attendance|enroll|v1|n|ab|e|ff|success|eng|1|k1")


class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.engine = SyntheticEngine()
        self.keys = decide.Keys(template_keys={"t1": os.urandom(32)}, template_key_id="t1", result_key=os.urandom(32),
                                result_key_id="r1")
        self.emp = str(uuid.uuid4())

    def enrolled(self, identity="employee-a"):
        enrollment = {"enrollment_id": str(uuid.uuid4()), "nonce": os.urandom(16).hex(), "employee_id": self.emp}
        out = decide.enroll(self.engine, syn.sequence(["left", "right"], identity=identity, neutral=4), enrollment, self.keys)
        self.assertEqual(out["result"]["outcome"], "success", out)
        return enrollment["enrollment_id"], out["ciphertext"]

    def material(self, ref, cipher, challenge):
        return {"attempt_id": str(uuid.uuid4()), "nonce": os.urandom(16).hex(), "employee_id": self.emp, "reference_id": ref,
                "action": "check_in", "challenge": challenge, "ciphertext": cipher}

    def check_signature(self, out, material):
        r = out["result"]
        msg = crypto.attempt_message(attempt_id=material["attempt_id"], nonce=material["nonce"], employee_id=self.emp,
                                     reference_id=material["reference_id"], action="check_in", challenge=material["challenge"],
                                     outcome=r["outcome"], reason=r.get("reason"), engine=r["engine"],
                                     issued_at_ms=int(r["issued_at_ms"]), key_id="r1")
        self.assertEqual(out["signature"], crypto.sign(self.keys.result_key, msg))

    def test_enrolled_person_performing_the_challenge_succeeds(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["up", "left"])
        out = decide.verify(self.engine, syn.sequence(["up", "left"]), m, self.keys)
        self.assertEqual(out["result"]["outcome"], "success", out)
        self.assertGreaterEqual(out["result"]["metrics"]["match_score"], decide.Policy().match)
        self.check_signature(out, m)
        # The verdict holds aggregate numbers only.
        for value in out["result"]["metrics"].values():
            self.assertIsInstance(value, (int, float, str))

    def test_another_person_with_the_employee_id_fails(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        out = decide.verify(self.engine, syn.sequence(["left", "right"], identity="employee-b"), m, self.keys)
        self.assertEqual(out["result"]["reason"], "face_mismatch")
        self.check_signature(out, m)

    def test_photo_of_employee_then_another_live_face_fails(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        out = decide.verify(self.engine, syn.sequence(["left", "right"], identity_during_moves="employee-b"), m, self.keys)
        self.assertEqual(out["result"]["reason"], "face_inconsistent")

    def test_flat_photo_of_the_employee_fails(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        out = decide.verify(self.engine, syn.sequence(["left", "right"], points=syn.flat_photo()), m, self.keys)
        self.assertIn(out["result"]["reason"], ("challenge_failed", "liveness_failed"))

    def test_wrong_challenge_fails(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "up"])
        self.assertEqual(decide.verify(self.engine, syn.sequence(["right", "up"]), m, self.keys)["result"]["reason"],
                         "challenge_failed")

    def test_multiple_faces_no_face_and_bad_uploads_fail(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        frames = syn.sequence(["left", "right"])
        two = syn.frame([syn.project(syn.HEAD), syn.project(syn.HEAD, shift=(150, 0))], ["employee-a", "visitor"])
        self.assertEqual(decide.verify(self.engine, frames[:3] + [two] + frames[4:], m, self.keys)["result"]["reason"],
                         "multiple_faces")
        empty = syn.frame([], [])
        self.assertEqual(decide.verify(self.engine, [empty] * 12, m, self.keys)["result"]["reason"], "no_face")
        self.assertEqual(decide.verify(self.engine, frames[:5], m, self.keys)["result"]["reason"], "upload_invalid")
        self.assertEqual(decide.verify(self.engine, frames[:-1] + [b"not a frame"], m, self.keys)["result"]["reason"],
                         "upload_invalid")

    def test_failures_carry_one_short_hint(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        small = decide.verify(self.engine, syn.sequence(["left", "right"], angle=12), m, self.keys)["result"]
        self.assertEqual((small["reason"], small["metrics"]["hint"]), ("challenge_failed", "turn_more"))
        swapped = decide.verify(self.engine, syn.sequence(["right", "left"]), m, self.keys)["result"]
        self.assertEqual(swapped["metrics"]["hint"], "follow_arrows")
        empty = decide.verify(self.engine, [syn.frame([], [])] * 12, m, self.keys)["result"]
        self.assertEqual(empty["metrics"]["hint"], "come_closer")
        ok = decide.verify(self.engine, syn.sequence(["left", "right"]), m, self.keys)["result"]
        self.assertNotIn("hint", ok["metrics"])

    def test_reference_of_another_employee_cannot_be_used(self):
        ref, cipher = self.enrolled()
        m = self.material(ref, cipher, ["left", "right"])
        m["employee_id"] = str(uuid.uuid4())
        self.assertEqual(decide.verify(self.engine, syn.sequence(["left", "right"]), m, self.keys)["result"]["reason"],
                         "reference_unavailable")

    def test_enrollment_refuses_a_flat_photo_and_two_people(self):
        enrollment = {"enrollment_id": str(uuid.uuid4()), "nonce": os.urandom(16).hex(), "employee_id": self.emp}
        out = decide.enroll(self.engine, syn.sequence(["left", "right"], points=syn.flat_photo(), neutral=4), enrollment, self.keys)
        self.assertEqual(out["result"]["outcome"], "failure")
        self.assertNotIn("ciphertext", out)
        out = decide.enroll(self.engine, syn.sequence(["left", "right"], neutral=4, identity_during_moves="employee-b"),
                            enrollment, self.keys)
        self.assertEqual(out["result"]["reason"], "face_inconsistent")

    def test_enrollment_signature_covers_the_ciphertext(self):
        enrollment = {"enrollment_id": str(uuid.uuid4()), "nonce": os.urandom(16).hex(), "employee_id": self.emp}
        out = decide.enroll(self.engine, syn.sequence(["left", "right"], neutral=4), enrollment, self.keys)
        msg = crypto.enroll_message(enrollment_id=enrollment["enrollment_id"], nonce=enrollment["nonce"], employee_id=self.emp,
                                    ciphertext_sha256=hashlib.sha256(out["ciphertext"]).hexdigest(),
                                    engine=self.engine.name, issued_at_ms=int(out["result"]["issued_at_ms"]), key_id="r1")
        self.assertEqual(out["signature"], crypto.sign(self.keys.result_key, msg))
        self.assertNotIn("[", str(out["result"]["quality"]))


class EngineTests(unittest.TestCase):
    def test_real_engine_refuses_missing_or_unpinned_models(self):
        with self.assertRaises(ModelError):
            OpenCvEngine("does-not-exist.onnx", "does-not-exist.onnx")
        here = os.path.abspath(__file__)
        with self.assertRaises(ModelError):
            OpenCvEngine(here, here)

    def test_small_background_faces_are_ignored_but_a_second_person_is_not(self):
        def face(w, score=0.95):
            return DetectedFace(box=(0, 0, w, w), landmarks=np.zeros((5, 2)), score=score, raw=None)
        self.assertEqual(len(relevant_faces([face(200), face(40)])), 1)
        self.assertEqual(len(relevant_faces([face(200), face(120)])), 2)
        self.assertEqual(len(relevant_faces([face(200), face(180, score=0.5)])), 1)


if __name__ == "__main__":
    unittest.main()
