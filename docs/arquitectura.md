# Arquitectura

Resumen de la especificación v1 (ver README para el estado actual).

## Capas

- **Cliente (PWA Next.js en el celular):** cámara, grabación con MediaRecorder, push-to-talk, voz de salida (speechSynthesis) y resultados.
- **Web (Next.js en Vercel + Auth.js):** login con Google y emisión de token corto HS256 para el VPS.
- **Backend (FastAPI en el VPS, Tailscale Funnel):** agente, STT, guía en vivo, calibración, medición e informe.
- **Modelos (Meta Model API):** `muse-spark-1.3-contributor` (agente, guía, diagnóstico), `sam-3.1` (regla y tracking), `muse-voice-transcribe-1.0` (voz), `muse-image-1.0` (diagrama).
- **Almacenamiento:** Vercel Blob privado (PDFs) y SQLite en el VPS (usuarios, sesiones, resultados, informes).

## Máquina de estados de la sesión

`choose → setup → calibrate → record → processing → results → report`

## Seguridad

- Las API keys de Meta, el token de Blob y los secretos de Google viven solo en el servidor.
- El VPS valida `Authorization: Bearer` con HS256 y audiencia `galileo-vps`.
- No se guardan videos: se borran tras la medición. Solo se conservan el PDF y los metadatos.

## Datos

- `users(id, email, name, created_at)`
- `sessions(id, user_id, experiment, lang, state, px_per_m, created_at)`
- `results(session_id, key_name, key_value, ref_value, error_pct, r2)`
- `reports(id, session_id, blob_url, created_at)`

## Layout del VPS

```
/data/galileo-live/
  app/       copia de api/app (desplegada por deploy/deploy_vps.sh)
  venv/      entorno de Python
  bin/       tectonic
  data/      galileo.db, plots/, reports/ y uploads/ temporales
  .env       secretos (600), no versionado
```
