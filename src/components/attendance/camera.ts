/**
 * Camera helpers for the kiosk and the enrollment page (browser only).
 *
 * Privacy: frames live only in this page's memory as JPEG strings for the few seconds of one
 * challenge, are sent once to this site's server, and are dropped. Nothing is written to disk,
 * IndexedDB, localStorage or the console, and no video is recorded. The camera is switched on for an
 * attempt and switched off right after the capture.
 *
 * Nothing here decides anything: the server's verifier judges the frames.
 */

export type CameraProblem = "camera_permission_denied" | "camera_unavailable" | "camera_stopped";

export class CameraError extends Error {
  constructor(public readonly problem: CameraProblem) {
    super(problem);
  }
}

export interface Step {
  /** "neutral" or a challenge movement. */
  name: string;
  ms: number;
}

export const FRAME_INTERVAL_MS = 170;
export const FRAME_WIDTH = 640;
export const JPEG_QUALITY = 0.8;

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("camera_unavailable");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
  } catch (error) {
    const name = (error as { name?: string })?.name;
    throw new CameraError(name === "NotAllowedError" || name === "SecurityError" ? "camera_permission_denied" : "camera_unavailable");
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    closeCamera(stream, video);
    throw new CameraError("camera_unavailable");
  }
  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const wait = () => {
      if (video.videoWidth > 0) return resolve();
      if (Date.now() - started > 5000) return reject(new CameraError("camera_unavailable"));
      setTimeout(wait, 50);
    };
    wait();
  }).catch((error) => {
    closeCamera(stream, video);
    throw error;
  });
  return stream;
}

export function closeCamera(stream: MediaStream | null, video?: HTMLVideoElement | null): void {
  stream?.getTracks().forEach((track) => track.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * Captures JPEG frames through a sequence of timed steps, calling `onStep` as each step begins.
 * Fails with camera_stopped if the camera ends during the capture.
 */
export async function captureSteps(
  video: HTMLVideoElement,
  stream: MediaStream,
  steps: Step[],
  onStep: (step: Step, index: number) => void,
): Promise<string[]> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") throw new CameraError("camera_stopped");
  let stopped = false;
  const onEnded = () => { stopped = true; };
  track.addEventListener("ended", onEnded);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, FRAME_WIDTH / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new CameraError("camera_unavailable");
  const frames: string[] = [];
  try {
    for (const [index, step] of steps.entries()) {
      onStep(step, index);
      const end = performance.now() + step.ms;
      while (performance.now() < end) {
        if (stopped || track.readyState !== "live") throw new CameraError("camera_stopped");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const url = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        frames.push(url.slice(url.indexOf(",") + 1));
        await new Promise((resolve) => setTimeout(resolve, FRAME_INTERVAL_MS));
      }
    }
  } finally {
    track.removeEventListener("ended", onEnded);
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
  }
  return frames;
}

export function newRequestKey(): string {
  return crypto.randomUUID();
}
