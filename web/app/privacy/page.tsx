import { LegalLayout } from "@/components/legal-layout";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: "Privacy Policy · Galileo Live" };

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy / Política de privacidad">
      <p>Last updated / Última actualización: {LEGAL.updated}</p>

      <h2>English</h2>
      <p>
        {LEGAL.appName} is an educational physics lab assistant developed by {LEGAL.owner}. This policy explains what
        data the app uses and why.
      </p>
      <h3>Data we use</h3>
      <ul>
        <li>
          <strong>Google account:</strong> your name and email address, only to sign you in. We request only the
          <code> openid</code>, <code>email</code> and <code>profile</code> scopes. We do not access your Gmail, Drive
          or other Google data.
        </li>
        <li>
          <strong>Experiment data:</strong> the experiment you chose, the language, the calibration value and the
          measurement results (for example acceleration, error and R²). This is stored with your account so you can see
          your history.
        </li>
        <li>
          <strong>Camera, microphone and video:</strong> when you use live guidance or record an experiment, camera
          frames, voice audio and short video clips (up to 10 seconds) are sent to our server and then to Meta Model
          API to be processed. We delete recorded videos after the measurement is done. We do not store camera frames or
          audio after they are processed.
        </li>
        <li>
          <strong>Reports:</strong> generated PDF reports are stored in a private storage service (Vercel Blob) and can
          only be downloaded by the account that created them.
        </li>
      </ul>
      <h3>Meta and AI processing</h3>
      <p>
        The app uses Meta Model API. We use the Contributor mode of the Muse Spark model. <strong>Under Contributor
        mode, the inputs and outputs of the app (including frames, audio and text) may be used by Meta to train and
        improve its AI models.</strong> Please do not show faces, personal documents or private places to the camera.
      </p>
      <h3>Who we share data with</h3>
      <ul>
        <li>Google (sign-in).</li>
        <li>Meta (AI processing, under the Contributor mode described above).</li>
        <li>Vercel (hosting of the web app and private report storage).</li>
        <li>Tailscale (secure network connection to our server).</li>
      </ul>
      <p>We do not sell your data and we do not use it for advertising.</p>
      <h3>Retention and deletion</h3>
      <p>
        Your account data and history remain until you ask us to delete them. To request deletion, write to{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> from the email address linked to your account.
      </p>
      <h3>Security</h3>
      <p>
        Secrets are kept on the server. Requests to our API must include a short-lived signed token, and we apply rate
        limits and access controls.
      </p>
      <h3>Google API Services User Data Policy</h3>
      <p>
        Galileo Live's use and transfer of information received from Google APIs adheres to the Google API Services User
        Data Policy, including the Limited Use requirements.
      </p>
      <h3>Contact</h3>
      <p>
        {LEGAL.owner} · <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </p>

      <h2>Español</h2>
      <p>
        {LEGAL.appName} es un asistente educativo de laboratorio de física desarrollado por {LEGAL.owner}. Esta política
        explica qué datos usa la aplicación y para qué.
      </p>
      <h3>Datos que usamos</h3>
      <ul>
        <li>
          <strong>Cuenta de Google:</strong> nombre y correo, solo para iniciar sesión. Solo pedimos los alcances
          <code> openid</code>, <code>email</code> y <code>profile</code>. No accedemos a Gmail, Drive ni otros datos de
          Google.
        </li>
        <li>
          <strong>Datos de experimentos:</strong> el experimento elegido, el idioma, el valor de calibración y los
          resultados de medición (por ejemplo aceleración, error y R²). Se guardan con tu cuenta para mostrarte tu
          historial.
        </li>
        <li>
          <strong>Cámara, micrófono y video:</strong> al usar la guía en vivo o grabar un experimento, los fotogramas de
          la cámara, el audio de voz y los clips cortos (hasta 10 segundos) se envían a nuestro servidor y luego a Meta
          Model API para procesarlos. Los videos grabados se borran al terminar la medición. Los fotogramas y el audio no
          se guardan después de procesarlos.
        </li>
        <li>
          <strong>Informes:</strong> los PDF generados se guardan en un almacenamiento privado (Vercel Blob) y solo los
          puede descargar la cuenta que los creó.
        </li>
      </ul>
      <h3>Meta e inteligencia artificial</h3>
      <p>
        La aplicación usa Meta Model API con el modo Contributor del modelo Muse Spark.{" "}
        <strong>
          En el modo Contributor, las entradas y salidas de la aplicación (incluidos fotogramas, audio y texto) pueden
          ser usadas por Meta para entrenar y mejorar sus modelos de IA.
        </strong>{" "}
        Por favor no muestres a la cámara rostros, documentos personales ni lugares privados.
      </p>
      <h3>Con quién compartimos datos</h3>
      <ul>
        <li>Google (inicio de sesión).</li>
        <li>Meta (procesamiento de IA, en el modo Contributor descrito arriba).</li>
        <li>Vercel (alojamiento de la web y almacenamiento privado de informes).</li>
        <li>Tailscale (conexión segura con nuestro servidor).</li>
      </ul>
      <p>No vendemos tus datos ni los usamos para publicidad.</p>
      <h3>Conservación y eliminación</h3>
      <p>
        Los datos de tu cuenta e historial se conservan hasta que pidas eliminarlos. Para solicitarlo escribe a{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> desde el correo vinculado a tu cuenta.
      </p>
      <h3>Seguridad</h3>
      <p>
        Los secretos se guardan en el servidor. Las peticiones a nuestra API requieren un token firmado de corta
        duración, y aplicamos límites de peticiones y controles de acceso.
      </p>
      <h3>Política de datos de los servicios API de Google</h3>
      <p>
        El uso y la transferencia de información recibida de las APIs de Google cumplen la Política de datos de usuario
        de los servicios API de Google, incluidos los requisitos de uso limitado.
      </p>
      <h3>Contacto</h3>
      <p>
        {LEGAL.owner} · <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </p>
    </LegalLayout>
  );
}
