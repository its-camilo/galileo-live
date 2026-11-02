import type { Lang } from "@/lib/i18n";

export function speak(text: string, lang: Lang) {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === "es" ? "es-ES" : "en-US";
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}
