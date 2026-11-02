import { LegalLayout } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Terms of Service · Galileo Live" };

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of Service / Términos de servicio">
      <p>Last updated / Última actualización: {LEGAL.updated}</p>

      <h2>English</h2>
      <ol>
        <li>
          <strong>The service.</strong> {LEGAL.appName} is an educational tool to guide and analyze physics experiments.
          It is provided by {LEGAL.owner} free of charge, as is, without warranties of any kind.
        </li>
        <li>
          <strong>Accuracy.</strong> Results and suggestions are estimates for learning. Do not use them for decisions
          that affect safety, health, or grades without checking them yourself.
        </li>
        <li>
          <strong>Account.</strong> You sign in with Google. You are responsible for activity under your account.
        </li>
        <li>
          <strong>Acceptable use.</strong> Do not record people without their consent, do not record private or
          dangerous places, do not attempt to access other users' data, and do not abuse or overload the service.
        </li>
        <li>
          <strong>Third-party services.</strong> The app uses Google sign-in, Meta Model API and Vercel. Their terms
          also apply. Under Meta's Contributor mode, your inputs and outputs may be used to train Meta's models, as
          explained in the Privacy Policy.
        </li>
        <li>
          <strong>Availability.</strong> The service may be interrupted, changed, or discontinued at any time.
        </li>
        <li>
          <strong>Limitation of liability.</strong> To the extent allowed by law, the author is not liable for indirect
          or consequential damages arising from the use of the service.
        </li>
        <li>
          <strong>Changes.</strong> We may update these terms. Continued use means acceptance of the new terms.
        </li>
        <li>
          <strong>Contact.</strong> <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
        </li>
      </ol>

      <h2>Español</h2>
      <ol>
        <li>
          <strong>El servicio.</strong> {LEGAL.appName} es una herramienta educativa para guiar y analizar experimentos
          de física. {LEGAL.owner} la ofrece gratis, tal cual, sin garantías de ningún tipo.
        </li>
        <li>
          <strong>Precisión.</strong> Los resultados y sugerencias son estimaciones para aprender. No los uses para
          decisiones que afecten la seguridad, la salud o las calificaciones sin verificarlos tú mismo.
        </li>
        <li>
          <strong>Cuenta.</strong> Inicias sesión con Google. Eres responsable de la actividad de tu cuenta.
        </li>
        <li>
          <strong>Uso aceptable.</strong> No grabes personas sin su consentimiento, no grabes lugares privados o
          peligrosos, no intentes acceder a datos de otros usuarios y no abuses ni sobrecargues el servicio.
        </li>
        <li>
          <strong>Servicios de terceros.</strong> La aplicación usa inicio de sesión de Google, Meta Model API y Vercel.
          Sus términos también aplican. En el modo Contributor de Meta, tus entradas y salidas pueden usarse para
          entrenar los modelos de Meta, como explica la Política de privacidad.
        </li>
        <li>
          <strong>Disponibilidad.</strong> El servicio puede interrumpirse, cambiar o descontinuarse en cualquier momento.
        </li>
        <li>
          <strong>Limitación de responsabilidad.</strong> En la medida permitida por la ley, el autor no responde por
          daños indirectos o consecuenciales derivados del uso del servicio.
        </li>
        <li>
          <strong>Cambios.</strong> Podemos actualizar estos términos. Seguir usando el servicio implica aceptarlos.
        </li>
        <li>
          <strong>Contacto.</strong> <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
        </li>
      </ol>
    </LegalLayout>
  );
}
