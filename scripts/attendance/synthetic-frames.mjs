// Synthetic "frames" for the attendance verifier's TEST engine: JSON descriptions of five facial
// landmarks projected from a 3-D head model, plus an identity label. No image of any person exists in
// these tests. Mirrors services/attendance-verifier/tests/synthetic.py.

const HEAD = [
  [-32, 0, 0], // subject's right eye (image left)
  [32, 0, 0], // subject's left eye
  [0, 38, 32], // nose tip, in front of the eye plane
  [-25, 70, 6], // right mouth corner
  [25, 70, 6], // left mouth corner
];

function project(points, { yaw = 0, pitch = 0, distance = 520, f = 620, cx = 320, cy = 200 } = {}) {
  const a = (yaw * Math.PI) / 180;
  const b = (pitch * Math.PI) / 180;
  return points.map(([x0, y0, z0]) => {
    const y1 = y0 - 35;
    // yaw about the vertical axis, then pitch about the horizontal axis
    const x = x0 * Math.cos(a) + z0 * Math.sin(a);
    const z = -x0 * Math.sin(a) + z0 * Math.cos(a);
    const y = y1 * Math.cos(b) - z * Math.sin(b);
    const z2 = y1 * Math.sin(b) + z * Math.cos(b);
    const depth = distance - z2;
    return [cx + (f * x) / depth, cy + (f * y) / depth];
  });
}

/** A printed photo of the frontal face: the same 2-D layout, flat (z = 0). */
function flatPhoto() {
  return project(HEAD).map(([u, v]) => [((u - 320) * 520) / 620, ((v - 200) * 520) / 620 + 35, 0]);
}

function box(landmarks) {
  const xs = landmarks.map((p) => p[0]);
  const ys = landmarks.map((p) => p[1]);
  const w = (Math.max(...xs) - Math.min(...xs)) * 1.9;
  const h = (Math.max(...ys) - Math.min(...ys)) * 1.9;
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  return [mx - w / 2, Math.min(...ys) - h * 0.35, w, h];
}

function frame(faces) {
  const doc = { synthetic: 1, faces: faces.map(({ landmarks, identity }) => ({ box: box(landmarks), landmarks: landmarks.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), score: 0.98, identity })) };
  return Buffer.from(JSON.stringify(doc)).toString("base64");
}

const POSE = { left: [28, 0], right: [-28, 0], up: [0, 22] };

/**
 * Frames for a challenge: neutral, then each step held, with a neutral frame between.
 * Options: identity, flat (photo attack), moveIdentity (another person after the neutral frames), extra (a second face).
 */
export function framesFor(steps, { identity = "employee-a", flat = false, moveIdentity = null, neutral = 4, extra = false, scale = 1 } = {}) {
  const points = flat ? flatPhoto() : HEAD;
  const poses = Array.from({ length: neutral }, () => [0, 0]);
  for (const step of steps) {
    const [yaw, pitch] = POSE[step].map((v) => v * scale);
    poses.push([yaw / 2, pitch / 2], [yaw, pitch], [yaw, pitch], [yaw, pitch], [yaw, pitch], [0, 0]);
  }
  return poses.map(([yaw, pitch], i) => {
    const who = i >= neutral && moveIdentity ? moveIdentity : identity;
    const faces = [{ landmarks: project(points, { yaw, pitch }), identity: who }];
    if (extra && i === neutral + 1) faces.push({ landmarks: project(HEAD, { cx: 470 }), identity: "visitor" });
    return frame(faces);
  });
}
