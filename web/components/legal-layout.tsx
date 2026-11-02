import type { ReactNode } from "react";
import { LEGAL } from "@/lib/legal";

export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal">
      <p className="legal-back">
        <a href="/">Galileo Live</a>
      </p>
      <h1>{title}</h1>
      {children}
      <footer className="legal-footer">
        <a href="/privacy">Privacidad</a> · <a href="/terms">Términos</a> · Contacto:{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </footer>
    </main>
  );
}
