import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, lineHeight: 1.6 }}>
      <p>
        <a href="/">Galileo Live</a>
      </p>
      <h1>{title}</h1>
      {children}
      <hr />
      <p style={{ fontSize: 14, color: "#555" }}>
        <a href="/privacy">Privacy / Privacidad</a> · <a href="/terms">Terms / Términos</a> ·{" "}
        Contacto: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </p>
    </main>
  );
}
