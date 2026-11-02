"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
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
      const key = errorKey(e);
      onError(T[`err${key.charAt(0).toUpperCase()}${key.slice(1)}` as "errGeneric"] ?? T.errGeneric);
    } finally {
      setSending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={listening ? "primary" : "secondary"}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      disabled={sending}
      className={listening ? "animate-pulse" : undefined}
    >
      {sending ? T.voiceSending : listening ? "●" : label}
    </Button>
  );
}
