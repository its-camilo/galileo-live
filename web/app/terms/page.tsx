import { LegalLayout } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Términos de servicio · Galileo Live" };

export default function TermsPage() {
  return (
    <LegalLayout title="Términos de servicio">
      <p>Última actualización: {LEGAL.updated}.</p>

      <h2>1. El servicio</h2>
      <p>
        {LEGAL.appName} es una herramienta educativa para guiar y analizar experimentos de física. {LEGAL.owner} la
        ofrece gratuitamente y sin garantías, sin perjuicio de los derechos que la Ley 1480 de 2011 (Estatuto del
        Consumidor) reconoce a los usuarios.
      </p>

      <h2>2. Precisión de los resultados</h2>
      <p>
        Los resultados y sugerencias son estimaciones con fines de aprendizaje. No los uses para decisiones que afecten la
        seguridad, la salud o las calificaciones sin verificarlos por tu cuenta.
      </p>

      <h2>3. Cuenta y requisitos</h2>
      <p>
        Inicias sesión con tu cuenta de Google. Debes ser mayor de 18 años o tener autorización de tu representante legal,
        y aceptar la política de privacidad. Eres responsable de la actividad realizada desde tu cuenta.
      </p>

      <h2>4. Uso aceptable</h2>
      <ul>
        <li>No grabes personas sin su consentimiento ni lugares privados o peligrosos.</li>
        <li>No envíes información personal sensible, confidencial ni de terceros que no sea necesaria para el experimento.</li>
        <li>No intentes acceder a datos de otros usuarios, ni abuses, automatices o sobrecargues el servicio.</li>
      </ul>

      <h2>5. Servicios de terceros</h2>
      <p>
        La app usa Google, Meta Model API, Vercel y Tailscale, y sus términos también aplican. Meta procesa el contenido
        enviado en el nivel Standard, según sus Términos de servicio de Meta Model API.
      </p>

      <h2>6. Disponibilidad</h2>
      <p>El servicio puede interrumpirse, cambiar o terminarse. Procuraremos avisar con anticipación cuando sea posible.</p>

      <h2>7. Responsabilidad</h2>
      <p>
        En la medida que la ley permita, el responsable no responde por daños indirectos o consecuenciales derivados del
        uso del servicio, sin afectar las garantías legales del consumidor.
      </p>

      <h2>8. Ley aplicable y jurisdicción</h2>
      <p>
        Estos términos se rigen por las leyes de la República de Colombia. Cualquier controversia se someterá a los jueces
        de Bogotá D.C., sin perjuicio de las competencias de la Superintendencia de Industria y Comercio.
      </p>

      <h2>9. Cambios</h2>
      <p>
        Podemos actualizar estos términos. Si el cambio es relevante, te pediremos aceptarlo de nuevo antes de seguir
        usando el servicio.
      </p>

      <h2>10. Contacto</h2>
      <p>
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </p>
    </LegalLayout>
  );
}
