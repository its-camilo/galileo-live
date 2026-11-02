"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HoldToTalk } from "@/components/hold-to-talk";
import { Plot } from "@/components/plot";
import { api, apiBlob, errorKey } from "@/lib/api";
import { captureFrame, openCamera, stopStream } from "@/lib/camera";
import { customSteps, experimentUi, isExperimentId, type ExperimentId } from "@/lib/catalog-ui";
import { t, type Dict, type Lang } from "@/lib/i18n";
import { speak } from "@/lib/speech";
import { useCountUp } from "@/lib/use-count-up";

type Phase = "chat" | "setup" | "calibrate" | "run" | "results";
type Series = { t: number[]; x: number[]; v: number[]; a: number[] };
type Result = {
  key_name: "a" | "g";
  key_value: number;
  ref_value: number | null;
  error_pct: number | null;
  r2: number;
  series?: Series;
};
type RunReply = { state: string; detected: boolean; x_m: number | null; event: string | null; result: Result | null };
type Session = {
  id: string;
  state: string;
  experiment: string | null;
  object_prompt: string | null;
  description: string | null;
  lang: Lang;
  px_per_m: number | null;
  run_state: string;
  result?: Result | null;
};
type Live = { say: string; show: string; done: boolean };
type Frame = { dataUrl: string; base64: string; width: number; height: number };
type Tap = { x: number; y: number };
type Msg = { role: "user" | "assistant"; text: string };

const FRAME_MS = 200;
const GUIDE_MS = 3000;

export function Lab({ sessionId, lang }: { sessionId: string; lang: Lang }) {
  const T = t(lang);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("chat");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [distance, setDistance] = useState("");
  const [theta, setTheta] = useState("");
  const [runActive, setRunActive] = useState(false);
  const [runState, setRunState] = useState<string>("idle");
  const [detected, setDetected] = useState(true);
  const [livePts, setLivePts] = useState<{ t: number; x: number }[]>([]);
  const [guide, setGuide] = useState<Live | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runStartRef = useRef(0);
  const inflight = useRef(0);
  const stoppingRef = useRef(false);
  const lastSay = useRef("");

  const experiment: ExperimentId | null =
    session?.experiment && isExperimentId(session.experiment) ? session.experiment : null;
  const isCustom = session?.experiment === "custom";
  const countX = useCountUp(result ? result.key_value : null);

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
        } else if (!s.experiment) {
          setPhase("chat");
          setMessages([{ role: "assistant", text: T.freeIntro }]);
        } else if (s.px_per_m !== null) {
          setPhase("run");
        } else {
          setPhase("setup");
        }
      } catch (e) {
        setError(fail(e, T));
      }
    })();
    return () => stopStream(streamRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    const needCamera = phase === "run" || (phase === "calibrate" && !frame);
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
    if (!runActive || phase !== "run") return;
    const id = window.setInterval(() => void sendFrame(), FRAME_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runActive, phase]);

  useEffect(() => {
    if (!runActive || phase !== "run" || runState !== "waiting") return;
    const id = window.setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      try {
        const f = captureFrame(video, 640);
        const res = await api<Live>("/live", { json: { session_id: sessionId, frame: f.base64 } });
        setGuide(res);
        if (res.say && res.say !== lastSay.current) {
          lastSay.current = res.say;
          speak(res.say, lang);
        }
      } catch {
        // La guía es opcional; si falla, la medición sigue.
      }
    }, GUIDE_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runActive, phase, runState, sessionId, lang]);

  async function sendFrame() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || inflight.current >= 2 || stoppingRef.current) return;
    inflight.current += 1;
    try {
      const f = captureFrame(video, 640);
      const t = Number(((performance.now() - runStartRef.current) / 1000).toFixed(3));
      const r = await api<RunReply>("/run/frame", {
        json: { session_id: sessionId, t, height: f.height, frame: f.base64 },
      });
      onReply(r, t);
    } catch (e) {
      setError(fail(e, T));
    } finally {
      inflight.current -= 1;
    }
  }

  function onReply(r: RunReply, t: number) {
    setRunState(r.state);
    setDetected(r.detected);
    if (r.state === "measuring" && r.x_m !== null) {
      const x = r.x_m;
      setLivePts((prev) => [...prev, { t, x }]);
    }
    if (r.event === "moving") speak(T.eventMoving, lang);
    if (r.event === "left_frame") speak(T.eventLeft, lang);
    if (r.event === "timeout") speak(T.eventTimeout, lang);
    if (r.event === "too_few") {
      setError(T.errTooFew);
      setRunActive(false);
      setRunState("idle");
    }
    if (r.result) finishRun(r.result);
  }

  function finishRun(res: Result) {
    setRunActive(false);
    setRunState("idle");
    setResult(res);
    setPhase("results");
    speak(T.resultSpoken(res.key_name, res.key_value.toFixed(2)), lang);
  }

  async function startRun() {
    setBusy(true);
    setError(null);
    try {
      await api("/run/start", { json: { session_id: sessionId } });
      runStartRef.current = performance.now();
      setLivePts([]);
      setGuide(null);
      lastSay.current = "";
      setRunState("waiting");
      setRunActive(true);
      speak(T.runWaiting, lang);
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  async function stopRun() {
    stoppingRef.current = true;
    setBusy(true);
    try {
      const r = await api<RunReply>("/run/stop", { json: { session_id: sessionId } });
      setRunActive(false);
      if (r.result) finishRun(r.result);
      else setRunState("idle");
    } catch (e) {
      setError(fail(e, T));
      setRunActive(false);
    } finally {
      stoppingRef.current = false;
      setBusy(false);
    }
  }

  async function refreshSession() {
    const s = await api<Session>(`/sessions/${sessionId}`);
    setSession(s);
    return s;
  }

  async function sendChat(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", text: clean }]);
    setDraft("");
    try {
      const res = await api<{ say: string; actions: unknown[] }>("/agent", {
        json: { session_id: sessionId, text: clean },
      });
      setMessages((prev) => [...prev, { role: "assistant", text: res.say }]);
      speak(res.say, lang);
      await refreshSession();
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
      await refreshSession();
      speak(T.calibrateSpoken, lang);
      setPhase("run");
    } catch (e) {
      setError(fail(e, T));
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
  const title = ui?.title ?? (session.description || T.modeFree);
  const unit = "m/s²";
  const lastX = livePts.length ? livePts[livePts.length - 1].x : null;
  const status =
    runState === "waiting"
      ? T.runWaiting
      : runState === "measuring"
        ? detected
          ? T.runMeasuring
          : T.runNotDetected
        : null;

  return (
    <div className="lab">
      <header className="lab-head">
        <Link href="/start" className="link-button">
          {T.back}
        </Link>
        <span className="lab-title">{title}</span>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase === "chat" && (
        <section className="panel chat">
          <h1>{T.modeFree}</h1>
          <ol className="thread" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`bubble ${m.role}`}>
                <span className="who">{m.role === "user" ? T.chatYou : T.chatAssistant}</span>
                <span>{m.text}</span>
              </li>
            ))}
          </ol>
          {session.experiment ? (
            <div className="ready">
              <p>{T.freeReady}</p>
              {isCustom && session.description && <p className="fine">{session.description}</p>}
              <button type="button" className="btn btn-signal wide" onClick={() => setPhase("setup")}>
                {T.continueSetup}
              </button>
            </div>
          ) : (
            <>
              <label className="field">
                <span className="sr-only">{T.chatPlaceholder}</span>
                <textarea
                  rows={2}
                  value={draft}
                  placeholder={T.chatPlaceholder}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <div className="row">
                <HoldToTalk
                  lang={lang}
                  label={T.askAssistant}
                  onTranscript={(v) => void sendChat(v)}
                  onError={setError}
                />
                <button type="button" className="btn btn-signal" disabled={busy || !draft.trim()} onClick={() => sendChat(draft)}>
                  {T.chatSend}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {phase === "setup" && (
        <section className="panel">
          <h1>{T.setupTitle}</h1>
          {ui && <p className="lede">{ui.summary}</p>}
          {isCustom && session.description && <p className="lede">{session.description}</p>}
          {isCustom && session.object_prompt && (
            <p className="fine">
              {T.objectLabel}: {session.object_prompt}
            </p>
          )}
          <h2 className="sub">{T.materials}</h2>
          <ul className="materials">
            {(ui ? ui.materials : []).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <h2 className="sub">{T.steps}</h2>
          <ol className="steps">
            {(ui ? ui.steps : customSteps(lang)).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
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
                <input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="0,50" />
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

      {phase === "run" && (
        <section className="panel">
          <h1>{T.runTitle}</h1>
          <div className="stage live">
            <video ref={videoRef} autoPlay playsInline muted aria-label={T.runTitle} />
            {runActive && <span className="rec-dot" aria-hidden="true" />}
            {(status || guide) && (
              <div className="live-caption" aria-live="polite">
                <span className="live-label">{T.liveNow}</span>
                <span>{status ?? guide?.say}</span>
              </div>
            )}
          </div>
          <p className="readout-line">
            <span className="readout">x = {lastX !== null ? `${lastX.toFixed(3)} m` : "—"}</span>
          </p>
          {livePts.length >= 2 ? (
            <Plot t={livePts.map((p) => p.t)} y={livePts.map((p) => p.x)} label={T.runLive} unit="m" />
          ) : (
            <p className="fine">{T.runLiveEmpty}</p>
          )}
          <div className="record-controls">
            {runActive ? (
              <button type="button" className="btn stop" onClick={stopRun} disabled={busy}>
                {T.runStop}
              </button>
            ) : (
              <button type="button" className="btn record" onClick={startRun} disabled={busy}>
                {T.runStart}
              </button>
            )}
          </div>
          {!runActive && (
            <button type="button" className="btn ghost wide" onClick={() => { setFrame(null); setTaps([]); setPhase("calibrate"); }}>
              {T.recalibrate}
            </button>
          )}
        </section>
      )}

      {phase === "results" && result && (
        <section className="panel results">
          <h1>{T.resultTitle}</h1>
          <div className="readout-block">
            <span className="readout big" aria-live="polite">
              {result.key_name} = {countX !== null ? countX.toFixed(3) : "—"}
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
                setLivePts([]);
                setPhase("run");
              }}
            >
              {T.runAgain}
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

function fail(e: unknown, T: Dict): string {
  const key = errorKey(e);
  return T[`err${key.charAt(0).toUpperCase()}${key.slice(1)}` as "errGeneric"] ?? T.errGeneric;
}
