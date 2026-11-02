"use client";

import { useRef, useState } from "react";
import { api, errorKey } from "@/lib/api";
import { t, type Lang } from "@/lib/i18n";
import { VoiceRecorder } from "@/lib/voice";

export function HoldToTalk({
  lang,
  label,
  onTranscript,
  onError,
}: {
  lang: Lang;
  label: string;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const T = t(lang);
  const recorder = useRef<VoiceRecorder | null>(null);
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);

  async function begin() {
    if (listening || sending) return;
    try {
      recorder.current = new VoiceRecorder();
      await recorder.current.start();
      setListening(true);
    } catch {
      onError(T.errCamera);
    }
  }

  async function end() {
    if (!listening || !recorder.current) return;
    setListening(false);
    setSending(true);
    const { blob, name } = await recorder.current.stop();
    try {
      const form = new FormData();
      form.append("audio", new File([blob], name, { type: blob.type }));
      form.append("lang_hint", lang);
      const res = await api<{ text: string }>("/stt", { form });
      if (res.text.trim()) onTranscript(res.text.trim());
      else onError(T.noSpeechHeard);
    } catch (e) {
      onError(T[`err${capitalize(errorKey(e))}` as "errGeneric"] ?? T.errGeneric);
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn talk ${listening ? "is-live" : ""}`}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      disabled={sending}
    >
      {sending ? T.voiceSending : listening ? "●" : label}
    </button>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
