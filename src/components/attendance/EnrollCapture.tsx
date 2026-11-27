"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureSteps, CameraError, closeCamera, openCamera, type Step } from "./camera";

/**
 * Face enrollment, run by an administrator with the employee present. The administrator records which
 * identity document was checked and the employee's consent; the employee then looks at the camera and
 * turns left and right (the server refuses a flat photo). The server's verifier builds and encrypts the
 * reference; this page never sees it and keeps no frame. When the turns were too small the capture is
 * repeated once automatically.
 */

export interface EnrollMessages {
  document: string;
  documents: Record<string, string>;
  consent: string;
  start: string;
  lookAtCamera: string;
  steps: Record<string, string>;
  sending: string;
  done: string;
  doneReplaced: string;
  failed: string;
  reasons: Record<string, string>;
  hints: Record<string, string>;
  autoRetry: string;
  back: string;
  again: string;
}

const STEPS: Step[] = [
  { name: "neutral", ms: 1400 },
  { name: "left", ms: 1800 },
  { name: "neutral", ms: 500 },
  { name: "right", ms: 1800 },
  { name: "neutral", ms: 300 },
];
const ARROWS: Record<string, string> = { left: "⬅", right: "➡" };

type State =
  | { kind: "form" }
  | { kind: "capture"; text: string; step: string }
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string; hint?: string };

export function EnrollCapture({ employee, messages, backHref }: { employee: string; messages: EnrollMessages; backHref: string }) {
  const [document, setDocument] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "form" });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRetried = useRef(false);

  useEffect(() => () => closeCamera(streamRef.current, videoRef.current), []);

  const run = useCallback(async (): Promise<void> => {
    if (!document || !consent || !videoRef.current) return;
    setState({ kind: "capture", text: messages.lookAtCamera, step: "neutral" });
    let frames: string[] = [];
    try {
      streamRef.current = await openCamera(videoRef.current);
      frames = await captureSteps(videoRef.current, streamRef.current, STEPS, (step) =>
        setState({ kind: "capture", step: step.name, text: step.name === "neutral" ? messages.lookAtCamera : messages.steps[step.name] ?? "" }));
    } catch (error) {
      closeCamera(streamRef.current, videoRef.current);
      streamRef.current = null;
      const problem = error instanceof CameraError ? error.problem : "camera_unavailable";
      return setState({ kind: "failed", text: messages.reasons[problem] ?? messages.failed });
    }
    closeCamera(streamRef.current, videoRef.current);
    streamRef.current = null;
    setState({ kind: "busy", text: messages.sending });
    try {
      const response = await fetch("/api/attendance/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employee, identity_document: document, consent: true, frames }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      frames = [];
      const result = (await response.json()) as { status?: string; reason?: string; replaced?: boolean; error?: string; quality?: { hint?: string } };
      if (result.status === "completed") return setState({ kind: "done", text: result.replaced ? messages.doneReplaced : messages.done });
      const hint = result.quality?.hint;
      // Small turns are the usual cause: try once more by itself.
      if (hint === "turn_more" && !autoRetried.current) {
        autoRetried.current = true;
        setState({ kind: "busy", text: messages.autoRetry });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return run();
      }
      const reason = result.reason ?? result.error ?? "";
      setState({ kind: "failed", text: messages.reasons[reason] ?? messages.failed, hint: hint ? messages.hints[hint] : undefined });
    } catch {
      setState({ kind: "failed", text: messages.reasons.connection_lost ?? messages.failed });
    }
  }, [consent, document, employee, messages]);

  const capturing = state.kind === "capture";
  return (
    <div className="stack enroll-capture" data-enroll-state={state.kind}>
      <div className={`kiosk-frame${capturing ? " is-capturing" : ""}`} hidden={!capturing}>
        <video ref={videoRef} className="kiosk-video" muted playsInline aria-hidden="true" />
        <div className="kiosk-oval" aria-hidden="true" />
        {capturing && state.step !== "neutral" ? (
          <div className={`kiosk-arrow-big step-${state.step}`} aria-hidden="true">{ARROWS[state.step]}</div>
        ) : null}
      </div>
      {capturing ? <p className="kiosk-instruction">{state.text}</p> : null}
      {state.kind === "busy" ? <p className="kiosk-instruction"><span className="kiosk-spinner" aria-hidden="true" /> {state.text}</p> : null}
      {state.kind === "done" ? (
        <div className="kiosk-result ok" role="status" data-result="ok">
          <span className="kiosk-result-icon" aria-hidden="true">✓</span>
          <p className="kiosk-result-title">{state.text}</p>
        </div>
      ) : null}
      {state.kind === "failed" ? (
        <div className="kiosk-result bad" role="alert" data-result="bad">
          <p className="kiosk-result-title">{state.text}</p>
          {state.hint ? <p className="kiosk-hint">{state.hint}</p> : null}
        </div>
      ) : null}
      {state.kind === "form" || state.kind === "failed" ? (
        <form className="stack" onSubmit={(event) => { event.preventDefault(); autoRetried.current = false; void run(); }} data-form="enroll">
          <label>
            {messages.document}
            <select value={document} onChange={(event) => setDocument(event.target.value)} required name="identity_document">
              <option value="" />
              {Object.entries(messages.documents).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="checks">
            <span>
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} name="consent" required />{" "}
              {messages.consent}
            </span>
          </label>
          <p className="row-actions">
            <button type="submit" disabled={!document || !consent} data-action="enroll">
              {state.kind === "failed" ? messages.again : messages.start}
            </button>
          </p>
        </form>
      ) : null}
      <p><a href={backHref}>{messages.back}</a></p>
    </div>
  );
}
