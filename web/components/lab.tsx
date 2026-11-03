"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Spinner } from "@/components/base/spinner/spinner";
import { Textarea } from "@/components/base/textarea/textarea";
import { toast } from "@/components/base/toast/toast";
import { HoldToTalk } from "@/components/hold-to-talk";
import { Plot } from "@/components/plot";
import { api, apiBlob, errorKey } from "@/lib/api";
import { captureFrame, openCamera, stopStream } from "@/lib/camera";
import { customSteps, experimentUi, isExperimentId, type ExperimentId } from "@/lib/catalog-ui";
import { t, type Dict, type Lang } from "@/lib/i18n";
import { speak } from "@/lib/speech";
import { useCountUp } from "@/lib/use-count-up";

type Phase = "chat" | "setup" | "calibrate" | "record" | "processing" | "results";
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
  object_prompt: string | null;
  description: string | null;
  lang: Lang;
  px_per_m: number | null;
  result?: Result | null;
};
type Live = { say: string; show: string; done: boolean };
type Frame = { dataUrl: string; base64: string; width: number; height: number };
type Tap = { x: number; y: number };
type Msg = { role: "user" | "assistant"; text: string };

const CLIP_MS = 10_000;
const GUIDE_MS = 3000;

export function Lab({ sessionId, lang }: { sessionId: string; lang: Lang }) {
  const T = t(lang);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>("chat");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ url: string; name: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [distance, setDistance] = useState("");
  const [theta, setTheta] = useState("");
  const [objectText, setObjectText] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [guide, setGuide] = useState<Live | null>(null);

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
        setObjectText(s.object_prompt ?? "");
        if (s.state === "results" && s.result) {
          setResult(s.result);
          setPhase("results");
        } else if (!s.experiment) {
          setPhase("chat");
          setMessages([{ role: "assistant", text: T.freeIntro }]);
          speak(T.freeIntro, lang);
        } else if (s.px_per_m !== null) {
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
        setGuide(res);
        if (res.say && res.say !== lastSay.current) {
          lastSay.current = res.say;
          speak(res.say, lang);
        }
      } catch {
        // La guía es opcional; si falla, la grabación sigue.
      } finally {
        liveBusy.current = false;
      }
    }, GUIDE_MS);
    return () => window.clearInterval(id);
  }, [phase, recording, sessionId, lang]);

  async function askAssistant(text: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ say: string; actions: unknown[] }>("/agent", {
        json: { session_id: sessionId, text },
      });
      setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: res.say }]);
      speak(res.say, lang);
      await refreshSession();
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  async function sendChat(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setDraft("");
    await askAssistant(clean);
  }

  async function refreshSession() {
    const s = await api<Session>(`/sessions/${sessionId}`);
    setSession(s);
    setObjectText(s.object_prompt ?? "");
    return s;
  }

  async function saveObject() {
    const value = objectText.trim();
    if (!value || value === (session?.object_prompt ?? "")) return;
    if (!/^[A-Za-z][A-Za-z \-]{1,59}$/.test(value)) {
      setError(T.objectHint);
      return;
    }
    try {
      await api("/session/object", { json: { session_id: sessionId, object_prompt: value } });
      await refreshSession();
    } catch (e) {
      setError(fail(e, T));
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
    setError(null);
    const mime = pickMime();
    const opts: MediaRecorderOptions = { videoBitsPerSecond: 8_000_000 };
    if (mime) opts.mimeType = mime;
    const recorder = new MediaRecorder(stream, opts);
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
      void analyze(blob, type, theta);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    speak(T.recordingSpoken, lang);
    tickRef.current = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    stopTimerRef.current = window.setTimeout(stopRecording, CLIP_MS);
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  async function analyze(blob: Blob, type: string, thetaText: string) {
    setBusy(true);
    setError(null);
    speak(T.processingSpoken, lang);
    const form = new FormData();
    form.append("session_id", sessionId);
    form.append("video", new File([blob], `clip.${type.includes("mp4") ? "mp4" : "webm"}`, { type }));
    if (thetaText.trim()) form.append("theta_deg", thetaText.trim());
    try {
      const res = await api<Result>("/measure", { form });
      setResult(res);
      setPhase("results");
      speak(T.resultSpoken(res.key_name, res.key_value.toFixed(2)), lang);
    } catch (e) {
      setError(fail(e, T));
      setPhase("record");
    } finally {
      setBusy(false);
    }
  }

  // Dos pasos: generar el informe y luego descargarlo con un toque real del usuario.
  // iOS Safari ignora a.click() si llega después de una espera larga (sin gesto del usuario).
  async function generateReport() {
    if (report) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ pdf_url: string }>("/report", { json: { session_id: sessionId } });
      const blob = await apiBlob(r.pdf_url);
      setReport({ url: URL.createObjectURL(blob), name: `galileo-${sessionId.slice(0, 8)}.pdf` });
      toast(T.reportDone);
    } catch (e) {
      setError(fail(e, T));
    } finally {
      setBusy(false);
    }
  }

  function clearReport() {
    if (report) URL.revokeObjectURL(report.url);
    setReport(null);
  }

  if (!session) {
    return (
      <div className="panel">
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <Spinner size="md" aria-label={T.loading} />
        )}
      </div>
    );
  }

  const ui = experiment ? experimentUi(experiment, lang) : null;
  const title = ui?.title ?? (session.description || T.modeFree);
  const unit = "m/s²";

  return (
    <div className="lab">
      <header className="lab-head">
        <ButtonLink href="/start" variant="ghost" size="small">
          {T.back}
        </ButtonLink>
        <span className="lab-title">{title}</span>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {phase === "chat" && (
        <section className="panel">
          <h1>{T.modeFree}</h1>
          <ol className="thread" aria-live="polite">
            {messages.map((m, i) => (
              <li key={i} className={`bubble ${m.role}`}>
                <span className="who">{m.role === "user" ? T.chatYou : T.chatAssistant}</span>
                <span>{m.text}</span>
              </li>
            ))}
          </ol>
          {busy && <AgentThinking label={T.chatAssistant} variant="wave" />}
          {session.experiment ? (
            <div className="ready">
              <p>{T.freeReady}</p>
              {isCustom && session.description && <p className="fine">{session.description}</p>}
              <Button type="button" variant="primary" className="w-full" onClick={() => setPhase("setup")}>
                {T.continueSetup}
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                aria-label={T.chatPlaceholder}
                rows={2}
                value={draft}
                placeholder={T.chatPlaceholder}
                onChange={setDraft}
              />
              <div className="row">
                <HoldToTalk lang={lang} label={T.askAssistant} onTranscript={(v) => void sendChat(v)} onError={setError} />
                <Button type="button" variant="primary" disabled={busy || !draft.trim()} onClick={() => sendChat(draft)}>
                  {T.chatSend}
                </Button>
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
          <Button type="button" variant="primary" className="w-full" onClick={() => setPhase("calibrate")} disabled={busy}>
            {T.imReady}
          </Button>
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
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => {
                  if (videoRef.current) setFrame(captureFrame(videoRef.current, 640));
                }}
              >
                {T.calibrateCapture}
              </Button>
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
              <Input label={T.distanceLabel} inputMode="decimal" value={distance} onChange={setDistance} placeholder="0,50" />
              {experiment === "mrua_ramp" && (
                <Input label={T.thetaLabel} inputMode="decimal" value={theta} onChange={setTheta} placeholder="5" />
              )}
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => { setFrame(null); setTaps([]); }}>
                  {T.retake}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setTaps([])} disabled={taps.length === 0}>
                  {T.clearTaps}
                </Button>
              </div>
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={calibrate}
                disabled={busy || taps.length !== 2 || !(Number(distance.replace(",", ".")) > 0)}
              >
                {busy ? T.calibrating : T.calibrate}
              </Button>
            </>
          )}
        </section>
      )}

      {phase === "record" && (
        <section className="panel">
          <h1>{T.recordTitle}</h1>
          <p className="fine">{T.recordHint}</p>
          <Input
            label={T.objectLabel}
            value={objectText}
            onChange={setObjectText}
            onBlur={saveObject}
            placeholder="toy car"
            isDisabled={recording}
          />
          <div className="stage live">
            <video ref={videoRef} autoPlay playsInline muted aria-label={T.recordTitle} />
            {recording && <span className="rec-dot" aria-hidden="true" />}
            {(guide || recording) && (
              <div className="live-caption" aria-live="polite">
                <span className="live-label">{T.liveNow}</span>
                <span>{guide?.say || (recording ? T.recordingNow(elapsed) : "")}</span>
              </div>
            )}
          </div>
          <div className="record-controls">
            {recording ? (
              <Button type="button" variant="secondary" className="mx-auto size-24 rounded-full" onClick={stopRecording}>
                {T.recordStop}
              </Button>
            ) : (
              <Button type="button" variant="primary" className="mx-auto size-24 rounded-full" onClick={startRecording} disabled={busy}>
                {T.recordStart}
              </Button>
            )}
          </div>
          <div className="row">
            <Button type="button" variant="secondary" onClick={() => speak(T.voiceTest, lang)}>
              {T.voiceTestButton}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setFrame(null); setTaps([]); setPhase("calibrate"); }} disabled={recording}>
              {T.recalibrate}
            </Button>
          </div>
        </section>
      )}

      {phase === "processing" && (
        <section className="panel processing" aria-live="polite">
          <Spinner size="lg" aria-label={T.processing} />
          <p>{T.processing}</p>
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
          {report ? (
            <ButtonLink variant="primary" className="w-full" href={report.url} download={report.name} target="_blank" rel="noopener">
              {T.reportDownload}
            </ButtonLink>
          ) : (
            <Button type="button" variant="primary" className="w-full" onClick={generateReport} disabled={busy}>
              {busy ? T.reportBusy : T.makeReport}
            </Button>
          )}
          <div className="row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                clearReport();
                setResult(null);
                setPhase("record");
              }}
            >
              {T.anotherRun}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/start")}>
              {T.newExperiment}
            </Button>
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
