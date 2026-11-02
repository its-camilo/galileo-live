import type { Lang } from "@/lib/i18n";

let unlocked = false;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

/** Los navegadores solo dejan hablar después de un gesto del usuario. */
export function unlockSpeech() {
  const s = synth();
  if (!s || unlocked) return;
  unlocked = true;
  const warm = new SpeechSynthesisUtterance(" ");
  warm.volume = 0;
  s.speak(warm);
}

function voiceFor(lang: Lang): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const prefix = lang === "es" ? "es" : "en";
  const voices = s.getVoices();
  return voices.find((v) => v.lang.toLowerCase().startsWith(prefix) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ?? null;
}

export function speak(text: string, lang: Lang) {
  const s = synth();
  if (!s || !text) return;
  s.cancel();
  if (s.paused) s.resume();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === "es" ? "es-ES" : "en-US";
  utterance.voice = voiceFor(lang);
  utterance.rate = 1.05;
  s.speak(utterance);
}
