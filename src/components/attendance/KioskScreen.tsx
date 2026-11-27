"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureSteps, CameraError, closeCamera, newRequestKey, openCamera, type Step } from "./camera";

/**
 * The attendance kiosk. The employee types their ID (on-screen keypad or keyboard) and presses حضور or
 * انصراف. The camera warms up while the ID is typed; the server answers with two random head turns; the
 * frames go to the server, whose verifier decides. This component shows only what the server answered,
 * and receives every text already translated (it imports no application module).
 */

export interface KioskMessages {
  title: string;
  device: string;
  idLabel: string;
  checkIn: string;
  checkOut: string;
  clear: string;
  erase: string;
  starting: string;
  lookAtCamera: string;
  steps: Record<string, string>;
  checking: string;
  recordedIn: string;
  recordedOut: string;
  hello: string;
  currentIn: string;
  currentOut: string;
  tryAgain: string;
  again: string;
  cancel: string;
  privacy: string;
  reasons: Record<string, string>;
  hints: Record<string, string>;
  failed: string;
  connection: string;
  deviceProblem: string;
  cameraWarming: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; text: string }
  | { kind: "capture"; text: string; step: string; index: number; steps: string[] }
  | { kind: "result"; ok: boolean; title: string; detail?: string; hint?: string; elapsed?: number }
  | { kind: "retry"; text: string };

interface View {
  attempt_id?: string;
  status?: string;
  reason?: string;
  hint?: string;
  action?: "check_in" | "check_out";
  challenge?: string[];
  employee_first_name?: string;
  event?: { kind: "check_in" | "check_out"; local: string };
  current_state?: { kind: "check_in" | "check_out"; local: string };
  error?: string;
}

const OK_RESET_MS = 3000;
const FAIL_RESET_MS = 6000;
const IDLE_CAMERA_OFF_MS = 20_000;
const NEUTRAL_MS = 800;
const STEP_MS = 1500;
const END_MS = 300;
// New IDs have three digits (101-999); a few more are accepted for IDs kept from before that rule.
const MAX_CODE = 6;
/** Longer than the server's own wait for the verifier (20 s), so the server answers first when it can. */
const REQUEST_TIMEOUT_MS = 45_000;
const ARROWS: Record<string, string> = { left: "⬅", right: "➡", up: "⬆" };

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

function timeOf(local: string | undefined): string {
  return local && local.length >= 19 ? local.slice(11, 19) : "";
}

async function post(url: string, body: unknown): Promise<{ status: number; view: View }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let view: View = {};
  try {
    view = (await response.json()) as View;
  } catch {
    /* an empty or non-JSON answer is handled as a failure below */
  }
  return { status: response.status, view };
}

export function KioskScreen({ messages }: { messages: KioskMessages }) {
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [cameraLive, setCameraLive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const opening = useRef<Promise<MediaStream> | null>(null);
  const pending = useRef<{ attempt: string; frames: string[] } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const stopCamera = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    closeCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    opening.current = null;
    setCameraLive(false);
  }, []);

  /** Opens the camera once (warm-up while typing); later calls wait for the same opening. */
  const warmCamera = useCallback((): Promise<MediaStream> => {
    if (streamRef.current && streamRef.current.getVideoTracks()[0]?.readyState === "live") return Promise.resolve(streamRef.current);
    if (opening.current) return opening.current;
    const video = videoRef.current;
    if (!video) return Promise.reject(new CameraError("camera_unavailable"));
    opening.current = openCamera(video).then((stream) => {
      streamRef.current = stream;
      setCameraLive(true);
      return stream;
    }).catch((error) => {
      opening.current = null;
      throw error;
    });
    return opening.current;
  }, []);

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    stopCamera();
    pending.current = null;
    setCode("");
    setPhase({ kind: "idle" });
    inputRef.current?.focus();
  }, [stopCamera]);

  /** Typing keeps the camera warm; 20 s without a key switches it off and clears the ID. */
  const touch = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(reset, IDLE_CAMERA_OFF_MS);
    warmCamera().catch(() => { /* reported when the attempt starts */ });
  }, [reset, warmCamera]);

  const finish = useCallback((ok: boolean, title: string, detail?: string, hint?: string) => {
    stopCamera();
    pending.current = null;
    const elapsed = startedAt.current ? Math.round(performance.now() - startedAt.current) : undefined;
    setPhase({ kind: "result", ok, title, detail, hint, elapsed });
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(reset, ok ? OK_RESET_MS : FAIL_RESET_MS);
  }, [reset, stopCamera]);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    closeCamera(streamRef.current, videoRef.current);
  }, []);

  const showView = useCallback((view: View, status: number) => {
    if (status === 403 || status === 401) return finish(false, messages.deviceProblem);
    if (view.status === "succeeded" && view.event) {
      const title = fill(view.event.kind === "check_in" ? messages.recordedIn : messages.recordedOut, { time: timeOf(view.event.local) });
      return finish(true, title, view.employee_first_name ? fill(messages.hello, { name: view.employee_first_name }) : undefined);
    }
    const reason = view.reason ?? (view.status === "expired" ? "expired" : undefined);
    const text = (reason && messages.reasons[reason]) || messages.failed;
    let detail: string | undefined;
    if (view.current_state) {
      detail = fill(view.current_state.kind === "check_in" ? messages.currentIn : messages.currentOut, {
        time: `${view.current_state.local.slice(0, 10)} ${timeOf(view.current_state.local)}`,
      });
    }
    return finish(false, text, detail, view.hint ? messages.hints[view.hint] : undefined);
  }, [finish, messages]);

  const sendFrames = useCallback(async () => {
    const job = pending.current;
    if (!job) return;
    setPhase({ kind: "busy", text: messages.checking });
    try {
      const { status, view } = await post(`/api/attendance/kiosk/attempts/${job.attempt}/verify`, { frames: job.frames });
      if (status >= 500 && !view.status) {
        setPhase({ kind: "retry", text: messages.connection });
        return;
      }
      showView(view, status);
    } catch {
      // The connection dropped: the frames stay in memory for one more try of the same attempt.
      setPhase({ kind: "retry", text: messages.connection });
    }
  }, [messages, showView]);

  const reportFailure = useCallback(async (attempt: string, reason: string) => {
    try {
      const { status, view } = await post(`/api/attendance/kiosk/attempts/${attempt}/fail`, { reason });
      showView(view.status ? view : { reason }, status);
    } catch {
      finish(false, messages.reasons[reason] ?? messages.failed);
    }
  }, [finish, messages, showView]);

  const start = useCallback(async (action: "check_in" | "check_out") => {
    const id = code.trim();
    if (!id || phase.kind !== "idle") return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    startedAt.current = performance.now();
    setPhase({ kind: "busy", text: messages.starting });
    // The camera (already warming) and the attempt start in parallel.
    const camera = warmCamera();
    camera.catch(() => { /* handled below */ });
    let view: View;
    let status: number;
    try {
      ({ status, view } = await post("/api/attendance/kiosk/attempts", { request: newRequestKey(), code: id, action }));
    } catch {
      return finish(false, messages.connection);
    }
    if (status !== 200 || view.status !== "pending" || !view.attempt_id || !view.challenge) return showView(view, status);

    const attempt = view.attempt_id;
    const video = videoRef.current;
    if (!video) return reportFailure(attempt, "camera_unavailable");
    try {
      const stream = await camera;
      const names = view.challenge;
      const steps: Step[] = [{ name: "neutral", ms: NEUTRAL_MS }, ...names.map((name) => ({ name, ms: STEP_MS })), { name: "neutral", ms: END_MS }];
      const frames = await captureSteps(video, stream, steps, (step, index) => {
        const position = Math.min(Math.max(index - 1, 0), names.length);
        setPhase({ kind: "capture", step: step.name, index: index === 0 ? -1 : position, steps: names,
          text: step.name === "neutral" ? messages.lookAtCamera : messages.steps[step.name] ?? "" });
      });
      stopCamera();
      pending.current = { attempt, frames };
      await sendFrames();
    } catch (error) {
      stopCamera();
      const problem = error instanceof CameraError ? error.problem : "camera_unavailable";
      await reportFailure(attempt, problem);
    }
  }, [code, finish, messages, phase.kind, reportFailure, sendFrames, showView, stopCamera, warmCamera]);

  const cancelRetry = useCallback(async () => {
    const job = pending.current;
    pending.current = null;
    if (job) await reportFailure(job.attempt, "cancelled");
    else reset();
  }, [reportFailure, reset]);

  const press = useCallback((key: string) => {
    if (phase.kind !== "idle") return;
    touch();
    setCode((current) => (key === "erase" ? current.slice(0, -1) : key === "clear" ? "" : (current + key).slice(0, MAX_CODE)));
  }, [phase.kind, touch]);

  const capturing = phase.kind === "capture";
  const showPreview = cameraLive && (phase.kind === "idle" || capturing || phase.kind === "busy");
  return (
    <section className="kiosk-screen" data-kiosk-phase={phase.kind} aria-live="polite">
      <header className="kiosk-head">
        <strong>{messages.title}</strong>
        <span className="muted">{messages.device}</span>
      </header>

      <div className="kiosk-layout">
        <div className="kiosk-camera">
          <div className={`kiosk-frame${capturing ? " is-capturing" : ""}`}>
            <video ref={videoRef} className="kiosk-video" hidden={!showPreview} muted playsInline aria-hidden="true" />
            {!showPreview ? <div className="kiosk-placeholder" aria-hidden="true">◯</div> : null}
            {showPreview ? <div className="kiosk-oval" aria-hidden="true" /> : null}
            {capturing && phase.step !== "neutral" ? (
              <div className={`kiosk-arrow-big step-${phase.step}`} aria-hidden="true">{ARROWS[phase.step]}</div>
            ) : null}
          </div>
          {capturing ? (
            <>
              <p className="kiosk-instruction" data-step={phase.step}>{phase.text}</p>
              <ol className="kiosk-progress" aria-hidden="true">
                {phase.steps.map((name, i) => (
                  <li key={`${name}${i}`} className={i < phase.index ? "done" : i === phase.index ? "current" : ""}>
                    {i < phase.index ? "✓" : ARROWS[name]}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          {phase.kind === "busy" ? <p className="kiosk-instruction" data-busy="true"><span className="kiosk-spinner" aria-hidden="true" /> {phase.text}</p> : null}
          {phase.kind === "idle" && !cameraLive ? <p className="muted kiosk-privacy">{messages.privacy}</p> : null}
        </div>

        <div className="kiosk-panel">
          {phase.kind === "result" ? (
            <div className={`kiosk-result ${phase.ok ? "ok" : "bad"}`} role={phase.ok ? "status" : "alert"} data-result={phase.ok ? "ok" : "bad"}
              data-elapsed-ms={phase.elapsed ?? ""}>
              <span className="kiosk-result-icon" aria-hidden="true">{phase.ok ? "✓" : "!"}</span>
              {phase.ok && phase.detail ? <p className="kiosk-hello">{phase.detail}</p> : null}
              <p className="kiosk-result-title">{phase.title}</p>
              {!phase.ok && phase.hint ? <p className="kiosk-hint" data-hint="true">{phase.hint}</p> : null}
              {!phase.ok && phase.detail ? <p>{phase.detail}</p> : null}
              <button type="button" className="secondary" onClick={reset}>{phase.ok ? messages.clear : messages.again}</button>
            </div>
          ) : phase.kind === "retry" ? (
            <div className="kiosk-result bad" role="alert" data-result="retry">
              <span className="kiosk-result-icon" aria-hidden="true">!</span>
              <p className="kiosk-result-title">{phase.text}</p>
              <div className="row-actions">
                <button type="button" onClick={() => void sendFrames()} data-action="retry">{messages.tryAgain}</button>
                <button type="button" className="secondary" onClick={() => void cancelRetry()}>{messages.cancel}</button>
              </div>
            </div>
          ) : (
            <form className="kiosk-form" onSubmit={(event) => event.preventDefault()} aria-disabled={phase.kind !== "idle"}>
              <label className="kiosk-id">
                <span>{messages.idLabel}</span>
                <input
                  ref={inputRef}
                  name="employee_code"
                  value={code}
                  onChange={(event) => { touch(); setCode(event.target.value.replace(/\D+/g, "").slice(0, MAX_CODE)); }}
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  dir="ltr"
                  disabled={phase.kind !== "idle"}
                  data-field="employee-code"
                  placeholder="• • •"
                />
              </label>
              <div className="kiosk-keypad" dir="ltr">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                  <button key={d} type="button" className="key" onClick={() => press(d)} disabled={phase.kind !== "idle"} data-key={d}>{d}</button>
                ))}
                <button type="button" className="key key-soft" onClick={() => press("clear")} disabled={phase.kind !== "idle"} aria-label={messages.clear}>C</button>
                <button type="button" className="key" onClick={() => press("0")} disabled={phase.kind !== "idle"} data-key="0">0</button>
                <button type="button" className="key key-soft" onClick={() => press("erase")} disabled={phase.kind !== "idle"} aria-label={messages.erase}>⌫</button>
              </div>
              <div className="kiosk-actions">
                <button type="button" className="kiosk-in" onClick={() => void start("check_in")} disabled={!code.trim() || phase.kind !== "idle"} data-action="check_in">{messages.checkIn}</button>
                <button type="button" className="kiosk-out" onClick={() => void start("check_out")} disabled={!code.trim() || phase.kind !== "idle"} data-action="check_out">{messages.checkOut}</button>
              </div>
              {cameraLive && phase.kind === "idle" ? <p className="muted kiosk-privacy">{messages.cameraWarming}</p> : null}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
