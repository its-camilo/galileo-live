export type Lang = "en" | "es";

export const dictionaries = {
  en: {
    title: "Galileo Live",
    subtitle: "Live physics lab assistant, by voice.",
    signIn: "Sign in with Google",
    signOut: "Sign out",
    start: "Start an experiment",
    history: "My reports",
    needLogin: "Sign in to record experiments.",
  },
  es: {
    title: "Galileo Live",
    subtitle: "Asistente de laboratorio de física en vivo, por voz.",
    signIn: "Entrar con Google",
    signOut: "Salir",
    start: "Iniciar un experimento",
    history: "Mis informes",
    needLogin: "Inicia sesión para grabar experimentos.",
  },
} as const;

export function pickLang(acceptLanguage: string | null): Lang {
  return acceptLanguage?.toLowerCase().startsWith("es") ? "es" : "en";
}
