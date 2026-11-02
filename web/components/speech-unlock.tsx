"use client";

import { useEffect } from "react";
import { unlockSpeech } from "@/lib/speech";

export function SpeechUnlock() {
  useEffect(() => {
    const onGesture = () => unlockSpeech();
    document.addEventListener("pointerdown", onGesture, { once: true });
    document.addEventListener("keydown", onGesture, { once: true });
    return () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    };
  }, []);
  return null;
}
