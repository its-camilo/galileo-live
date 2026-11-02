import { LegalLayout } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Política de privacidad · Galileo Live" };

export default function PrivacyPage() {
  return (
    <LegalLayout title="Política de privacidad y tratamiento de datos personales">
      <p>Última actualización: {LEGAL.updated}. Versión del consentimiento: {LEGAL.consentVersion}.</p>
      <p>
        Esta política se rige por la Ley 1581 de 2012, el Decreto 1074 de 2015 y demás normas colombianas sobre
        protección de datos personales. Cuando usas Galileo Live, nos autorizas a tratar tus datos como se describe aquí.
      </p>

      <h2>1. Responsable del tratamiento</h2>
      <p>
        {LEGAL.owner}, {LEGAL.country}. Contacto: <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>

      <h2>2. Datos que tratamos</h2>
      <ul>
        <li>
          <strong>Cuenta de Google:</strong> nombre, correo electrónico e identificador de cuenta. Solo pedimos los
          alcances <code>openid</code>, <code>email</code> y <code>profile</code>. No accedemos a Gmail, Drive ni otros
          datos de Google.
        </li>
        <li>
          <strong>Datos del experimento:</strong> experimento elegido, objeto a seguir, idioma, valor de calibración,
          posiciones medidas del objeto y resultados (por ejemplo aceleración, error y R²).
          <strong> Historial de conversación:</strong> lo que escribes o dices al asistente en el modo libre se guarda
          para continuar la configuración del experimento.
        </li>
        <li>
          <strong>Video, imagen y voz:</strong> al medir grabas un video de hasta 10 segundos del experimento. Durante
          la guía se envía una imagen cada 3 segundos, y el audio de voz cuando usas el micrófono.
        </li>
        <li>
          <strong>Informes:</strong> los PDF generados, que contienen tu nombre y los datos del experimento.
        </li>
        <li>
          <strong>Datos técnicos:</strong> dirección IP, marcas de tiempo y registros de uso, necesarios para la seguridad
          y para limitar el número de peticiones.
        </li>
      </ul>

      <h2>3. Finalidades</h2>
      <p>
        Autenticarte, guiarte por voz y cámara durante el experimento, medir el movimiento, calcular resultados, generar
        tu informe PDF, mostrarte tu historial, proteger el servicio contra abusos y atender tus solicitudes.
      </p>

      <h2>4. Datos sensibles y de terceros</h2>
      <p>
        La cámara y el micrófono pueden captar rostros, voces u otros datos sensibles, incluidos los de otras personas.
        No estás obligado a usar la cámara ni el micrófono; puedes usar la app sin ellos. No grabes personas sin su
        consentimiento ni lugares privados. Si grabas a alguien, eres responsable de haber obtenido su autorización.
      </p>

      <h2>5. Menores de edad</h2>
      <p>
        El servicio está dirigido a personas mayores de 18 años. Un menor de edad solo puede usarlo si su representante
        legal lo autoriza expresamente, conforme al artículo 7 de la Ley 1581 de 2012. Al aceptar confirmas cumplir esta
        condición.
      </p>

      <h2>6. Encargados y transferencias internacionales</h2>
      <ul>
        <li>
          <strong>Meta Platforms (Meta Model API):</strong> procesa los fotogramas, el audio y el texto para generar las
          respuestas del asistente, el reconocimiento de voz, la detección del objeto en cada imagen y la generación del diagrama del montaje. Para el diagrama solo se envía el tipo de experimento del catálogo, nunca tu descripción ni tus datos. Usamos el nivel
          Standard del servicio. La única excepción es el texto del informe descrito en el punto 6 bis, y solo si lo autorizas. Según sus términos, en este nivel Meta actúa como procesador y no usa ese contenido para
          entrenar sus modelos. Meta puede usar datos técnicos de uso (metadatos de las peticiones, tiempos, errores y
          conteo de tokens) para mejorar sus servicios, y puede conservar el contenido el tiempo que necesite para
          prestar el servicio, cumplir la ley o revisar violaciones de sus políticas.
        </li>
        <li>
          <strong>Vercel:</strong> aloja la web y guarda los informes PDF en un almacenamiento privado.
        </li>
        <li>
          <strong>Google:</strong> inicio de sesión.
        </li>
        <li>
          <strong>Tailscale:</strong> conexión segura entre la web y nuestro servidor.
        </li>
      </ul>
      <p>
        Estos proveedores están en Estados Unidos y en otros países. Esto implica una transferencia internacional de
        datos, que autorizas expresamente al aceptar el consentimiento.
      </p>

      <h2>6 bis. Texto del informe con Meta en modo Contributor (opcional)</h2>
      <p>
        Solo si lo autorizas expresamente en el consentimiento, el texto de análisis y conclusión del informe PDF se genera
        con <strong>Muse Spark en modo Contributor</strong>. A Meta solo se envían los números del experimento (valor
        obtenido, referencia, error, R², ángulo de la rampa si lo indicaste) y el tipo de experimento del catálogo. No se
        envían tu nombre, tu correo, tu descripción libre, el objeto que seguiste ni imágenes.
      </p>
      <p>
        <strong>En modo Contributor, Meta puede usar ese texto para entrenar y mejorar sus modelos</strong>, y no ofrece una
        opción para excluirlo. Si no lo autorizas, el informe usa un texto fijo y no se llama a Meta para ello. Puedes
        decidirlo al aceptar el consentimiento.
      </p>

      <h2>7. Conservación y eliminación</h2>
      <ul>
        <li>
          El video se guarda solo mientras se analiza: lo subimos a Meta para detectar el objeto, y lo borramos de Meta y de nuestro servidor al terminar.
        </li>
        <li>Las imágenes de la guía y el audio se procesan y no se guardan en nuestro servidor.</li>
        <li>Las posiciones medidas y el historial de conversación se guardan con tu cuenta hasta que solicites su supresión.</li>
        <li>Tu cuenta, tu historial y tus informes se conservan hasta que solicites su supresión.</li>
        <li>Los proveedores pueden conservar datos según sus propias políticas, como se indicó en el punto 6.</li>
      </ul>

      <h2>8. Tus derechos como titular</h2>
      <p>
        Puedes conocer, actualizar, rectificar y suprimir tus datos; pedir prueba de la autorización; ser informado sobre
        su uso; revocar la autorización; y presentar quejas ante la Superintendencia de Industria y Comercio (SIC).
      </p>
      <p>
        Para ejercerlos, escribe a <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> desde el correo
        vinculado a tu cuenta. Responderemos las consultas en un máximo de 10 días hábiles y los reclamos en un máximo de
        15 días hábiles, según la ley.
      </p>

      <h2>9. Seguridad</h2>
      <p>
        Los secretos se guardan solo en el servidor. Las peticiones a nuestra API requieren un token firmado de corta
        duración, y aplicamos límites de peticiones y controles de acceso.
      </p>

      <h2>10. Cookies</h2>
      <p>Usamos una cookie de sesión de Auth.js, estrictamente necesaria para mantener tu inicio de sesión.</p>

      <h2>11. Cambios</h2>
      <p>
        Si cambiamos esta política de forma relevante, te pediremos autorizarla de nuevo antes de seguir usando el
        servicio.
      </p>

      <h2>12. Política de datos de usuario de las APIs de Google</h2>
      <p>
        El uso y la transferencia de información recibida de las APIs de Google cumplen la Política de datos de usuario
        de los servicios API de Google, incluidos los requisitos de uso limitado.
      </p>
    </LegalLayout>
  );
}
