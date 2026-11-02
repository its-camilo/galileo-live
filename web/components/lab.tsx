"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Plot } from "@/components/plot";
import { HoldToTalk } from "@/components/hold-to-talk";
import { api, apiBlob, errorKey } from "@/lib/api";
import { captureFrame, openCamera, stopStream } from "@/lib/camera";
import { experimentUi, isExperimentId, type ExperimentId } from "@/lib/catalog-ui";
import { t, type Dict, type Lang } from "@/lib/i18n";
import { speak } from "@/lib/speech";
import { useCountUp } from "@/lib/use-count-up";

type Phase = "setup" | "calibrate" | "record" | "processing" | "results";
type Series = { t: number[]; x: number[]; v: number[]; a: number[] };
type Result = {
  key_name: "a" | "g";
  key_value: number;
  ref_value: number | null;
  error_pct: number | null;
  r2: number;
  series?: Series;
};
type Session = {
  id: string;
  state: string;
  experiment: string | null;
  lang: Lang;
  px_per_m: number | null;
  result?: Result | null;
};
type Live = { say: string; show: string; done: boolean };
type Frame = { dataUrl: string; width: number; height: number };
type Tap = { x: number; y: number };

const CLIP_MS = 10_000;
const FRAME_MS = 2_000;

export function Lab({ sessionId, lang }: { sessionId: string; lang: Lang }) {
  const T = t(lang);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [distance, setDistance] = useState("");
  const [theta, setTheta] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const liveBusy = useRef(false);
  const lastSay = useRef("");

  const experiment: ExperimentId | null =
    session?.experiment && isExperimentId(session.experiment) ? session.experiment : null;

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ consented: boolean }>("/me");
        if (!me.consented) {
          router.replace("/consent");
          return;
        }
        const s = await api<Session>(`/sessions/${sessionId}`);
        setSession(s);
        if (s.state === "results" && s.result) {
          setResult(s.result);
          setPhase("results");
        } else if (s.state === "record") {
          setPhase("record");
        } else {
          setPhase("setup");
        }
      } catch (e) {
        setError(fail(e, T));
      }
    })();
    return () => {
      stopStream(streamRef.current);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const needCamera = phase === "record" || (phase === "calibrate" && !frame);
    if (!needCamera) {
      stopStream(streamRef.current);
      streamRef.current = null;
      return;
    }
    let cancelled = false;
    openCamera()
      .then((stream) => {
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch(() => setError(T.errCamera));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, frame]);

  useEffect(() => {
    if (phase !== "record" || recording) return;
    const id = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || liveBusy.current) return;
      liveBusy.current = true;
      try {
        const f = captureFrame(video, 640);
        const res = await api<Live>("/live", { json: { session_id: sessionId, frame: f.base64 } });
        setLive(res);
        if (res.say && res.say !== lastSay.current) {
          lastSay.current = res.say;
          speak(res.say, lang);
        }
      } catch {
        // Una revisión fallida no interrumpe la toma; se reintenta en el siguiente ciclo.
      } finally {
        liveBusy.current = false;
      }
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [phase, recording, sessionId, lang]);

  const countValue = useCountUp(phase === "results" && result ? result.key_value : null);

  async function askAssistant(text: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ say: string; actions: { type: string; id: string }[] }>("/agent", {
        json: { session_id: sessionId, text },
      });
      setNote(res.say);
      speak(res.say, lang);
      if (res.actions.length) {
        setSession(await api<Session>(`/sessions/${sessionId}`));
      }
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  function onTap(e: React.PointerEvent<HTMLDivElement>) {
    if (!frame || taps.length >= 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = frame.width / rect.width;
    setTaps((prev) => [...prev, { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale }]);
  }

  async function calibrate() {
    const d = Number(distance.replace(",", "."));
    if (!frame || taps.length !== 2 || !(d > 0)) return;
    setBusy(true);
    setError(null);
    try {
      await api("/calibrate", {
        json: {
          session_id: sessionId,
          p1: [taps[0].x, taps[0].y],
          p2: [taps[1].x, taps[1].y],
          distance_m: d,
        },
      });
      speak(T.calibrateSpoken, lang);
      setPhase("record");
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || recording) return;
    const mime = pickMime();
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const type = recorder.mimeType || mime || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
      setRecording(false);
      setPhase("processing");
      void measure(blob, type);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    tickRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    stopTimerRef.current = window.setTimeout(stopRecording, CLIP_MS);
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function measure(blob: Blob, type: string) {
    setBusy(true);
    setError(null);
    speak(T.processingSpoken, lang);
    const form = new FormData();
    form.append("session_id", sessionId);
    form.append("video", new File([blob], `clip.${type.includes("mp4") ? "mp4" : "webm"}`, { type }));
    if (theta.trim()) form.append("theta_deg", theta.trim());
    try {
      const res = await api<Result>("/measure", { form });
      setResult(res);
      setPhase("results");
      const label = res.key_name === "a" ? "a" : "g";
      speak(T.resultSpoken(label, res.key_value.toFixed(2)), lang);
    } catch (e) {
      setError(fail(e, T));
      setPhase("record");
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pdf_url: string }>("/report", { json: { session_id: sessionId } });
      const blob = await apiBlob(r.pdf_url);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `galileo-${sessionId.slice(0, 8)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <div className="panel">
        {error ? <p className="error" role="alert">{error}</p> : <p className="fine">{T.loading}</p>}
      </div>
    );
  }

  const ui = experiment ? experimentUi(experiment, lang) : null;
  const unit = "m/s²";

  return (
    <div className="lab">
      <header className="lab-head">
        <Link href="/start" className="link-button">
          {T.back}
        </Link>
        <span className="lab-title">{ui?.title ?? T.startTitle}</span>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase === "setup" && ui && (
        <section className="panel">
          <h1>{T.setupTitle}</h1>
          <p className="lede">{ui.summary}</p>
          <h2 className="sub">{T.materials}</h2>
          <ul className="materials">
            {ui.materials.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <h2 className="sub">{T.steps}</h2>
          <ol className="steps">
            {ui.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <h2 className="sub">{T.assistantTitle}</h2>
          <div className="row">
            <HoldToTalk lang={lang} label={T.askAssistant} onTranscript={askAssistant} onError={setError} />
          </div>
          {note && <p className="assistant-note">{note}</p>}
          <button type="button" className="btn btn-signal wide" onClick={() => setPhase("calibrate")} disabled={busy}>
            {T.imReady}
          </button>
        </section>
      )}

      {phase === "calibrate" && (
        <section className="panel">
          <h1>{T.calibrateTitle}</h1>
          {!frame ? (
            <>
              <p className="lede">{T.calibrateTapHint}</p>
              <div className="stage">
                <video ref={videoRef} autoPlay playsInline muted aria-label={T.calibrateCapture} />
              </div>
              <button
                type="button"
                className="btn btn-signal wide"
                onClick={() => {
                  if (videoRef.current) setFrame(captureFrame(videoRef.current, 640));
                }}
              >
                {T.calibrateCapture}
              </button>
            </>
          ) : (
            <>
              <p className="lede">{T.calibrateTapHint}</p>
              <div className="stage tap" onPointerDown={onTap} role="application" aria-label={T.calibrateTapHint}>
                <img src={frame.dataUrl} alt="" />
                <svg viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none" aria-hidden="true">
                  {taps.length === 2 && (
                    <line className="measure-line" x1={taps[0].x} y1={taps[0].y} x2={taps[1].x} y2={taps[1].y} />
                  )}
                  {taps.map((p, i) => (
                    <circle key={i} className="measure-dot" cx={p.x} cy={p.y} r={frame.width / 60} />
                  ))}
                </svg>
              </div>
              <p className="fine" aria-live="polite">
                {T.tapsCount(taps.length)}
              </p>
              <label className="field">
                <span>{T.distanceLabel}</span>
                <input
                  inputMode="decimal"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder="0,50"
                />
              </label>
              {experiment === "mrua_ramp" && (
                <label className="field">
                  <span>{T.thetaLabel}</span>
                  <input inputMode="decimal" value={theta} onChange={(e) => setTheta(e.target.value)} placeholder="5" />
                </label>
              )}
              <div className="row">
                <button type="button" className="btn ghost" onClick={() => { setFrame(null); setTaps([]); }}>
                  {T.retake}
                </button>
                <button type="button" className="btn ghost" onClick={() => setTaps([])} disabled={taps.length === 0}>
                  {T.clearTaps}
                </button>
              </div>
              <button
                type="button"
                className="btn btn-signal wide"
                onClick={calibrate}
                disabled={busy || taps.length !== 2 || !(Number(distance.replace(",", ".")) > 0)}
              >
                {busy ? T.calibrating : T.calibrate}
              </button>
            </>
          )}
        </section>
      )}

      {phase === "record" && (
        <section className="panel">
          <h1>{T.recordTitle}</h1>
          <div className="stage live">
            <video ref={videoRef} autoPlay playsInline muted aria-label={T.recordTitle} />
            {recording && <span className="rec-dot" aria-label={T.recordTimer(elapsed)} />}
            {live && (
              <div className="live-caption" aria-live="polite">
                <span className="live-label">{T.liveNow}</span>
                <span>{live.say || live.show}</span>
              </div>
            )}
          </div>
          <p className="fine">{recording ? T.recordTimer(elapsed) : T.recordHint}</p>
          <div className="record-controls">
            {recording ? (
              <button type="button" className="btn stop" onClick={stopRecording}>
                {T.recordStop}
              </button>
            ) : (
              <button type="button" className="btn record" onClick={startRecording} disabled={busy}>
                {T.recordStart}
              </button>
            )}
          </div>
          {!recording && (
            <button type="button" className="btn ghost wide" onClick={() => { setFrame(null); setTaps([]); setPhase("calibrate"); }}>
              {T.recalibrate}
            </button>
          )}
        </section>
      )}

      {phase === "processing" && (
        <section className="panel processing" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>{T.processing}</p>
        </section>
      )}

      {phase === "results" && result && (
        <section className="panel results">
          <h1>{T.resultTitle}</h1>
          <div className="readout-block">
            <span className="readout big" aria-live="polite">
              {result.key_name} = {countValue !== null ? countValue.toFixed(3) : "—"}
            </span>
            <span className="unit">{unit}</span>
          </div>
          <dl className="facts">
            <div>
              <dt>{T.refLabel}</dt>
              <dd>{result.ref_value !== null ? `${result.ref_value.toFixed(2)} ${unit}` : "—"}</dd>
            </div>
            <div>
              <dt>{T.errorLabel}</dt>
              <dd>{result.error_pct !== null ? `${result.error_pct.toFixed(1)} %` : "—"}</dd>
            </div>
            <div>
              <dt>{T.r2Label}</dt>
              <dd>{result.r2.toFixed(4)}</dd>
            </div>
          </dl>
          {result.series && (
            <div className="plots">
              <Plot t={result.series.t} y={result.series.x} label={T.plotX} unit="m" />
              <Plot t={result.series.t} y={result.series.v} label={T.plotV} unit="m/s" />
              <Plot t={result.series.t} y={result.series.a} label={T.plotA} unit={unit} />
            </div>
          )}
          <button type="button" className="btn btn-signal wide" onClick={downloadReport} disabled={busy}>
            {busy ? T.reportBusy : T.makeReport}
          </button>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setResult(null);
                setLive(null);
                lastSay.current = "";
                setPhase("record");
              }}
            >
              {T.anotherRun}
            </button>
            <button type="button" className="btn ghost" onClick={() => router.push("/start")}>
              {T.newExperiment}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of ["video/mp4", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return undefined;
}

function fail(e: unknown, T: Dict): string {
  const key = errorKey(e);
  return T[`err${key.charAt(0).toUpperCase()}${key.slice(1)}` as "errGeneric"] ?? T.errGeneric;
}
