# Galileo Live

Asistente de laboratorio de física en vivo, por voz, para aficionados y estudiantes.
El celular graba el experimento, el agente guía el montaje, SAM 3.1 mide la posición
del objeto y el sistema entrega valores, gráficas y un informe PDF en LaTeX.

Hackathon: Meta Global AI Developer Hackathon · track Indie · tema Push the Frontier.
Especificación completa: `docs/` y el PDF *Galileo Live – Especificación v1*.

## Estructura

```
web/      PWA Next.js (App Router, Auth.js con Google). Emite el token HS256 para el VPS.
api/      FastAPI que corre en el VPS (agente, medición, informe).
  app/      código de la API (routes, measure, catalog, meta, reports, templates/)
  tests/    pruebas del cálculo, parser de SAM y catálogo
deploy/   script y unidad systemd para el VPS
docs/     arquitectura y guion de demo
```

## Arquitectura

| Capa | Tecnología | Dónde corre |
|---|---|---|
| Cliente | PWA Next.js, cámara, MediaRecorder, voz | Celular |
| Web | Next.js + Auth.js (login Google), `/api/vps-token` | Vercel |
| Backend | FastAPI, SQLite, ffmpeg, numpy/scipy, matplotlib, tectonic | VPS (`/data/galileo-live`) |
| Modelos | Muse Spark 1.3, SAM 3.1, Muse Voice Transcribe, Muse Image 1.0 | Meta Model API (`https://api.meta.ai/v1`) |
| Informe | Jinja2 → LaTeX → tectonic | VPS |
| Almacenamiento | Vercel Blob (privado) para PDFs, SQLite para historial | Vercel / VPS |

Flujo: celular → Vercel (login y token corto HS256) → VPS por HTTPS → Meta Model API → resultados y PDF → Vercel Blob.

Autenticación: Vercel firma un JWT HS256 (`sub` = email, `aud` = `galileo-vps`, 5 min) con
`APP_JWT_SECRET`. El VPS solo acepta tokens firmados con ese secreto.

## Medición

1. Calibración: dos puntos + distancia real (`POST /calibrate`) → px/m.
2. Clip → ffmpeg normaliza a mp4 H.264 de 640 px de ancho, se leen fps con ffprobe.
3. SAM 3.1 sigue el objeto (`"toy car"` o `"ball"`) → caja por frame → centroide.
4. Centroide → desplazamiento en metros (proyección sobre la dirección del movimiento).
5. Suavizado Savitzky-Golay → ajuste cuadrático `x(t) = x0 + v0 t + ½ a t²`.
   MRUA: `a`; caída libre: `g = 2·c2`. Error % frente a `g·sinθ` (MRUA, si se da θ) o 9,81 m/s².

## Endpoints (FastAPI)

Todos requieren `Authorization: Bearer <token>`, salvo `/health`.

| Método | Ruta | Estado |
|---|---|---|
| GET | `/health` | Listo |
| POST | `/sessions` | Listo (crea sesión; no está en la especificación, es necesario para el resto) |
| POST | `/stt` | Listo; respuesta de Voice Transcribe asumida (ver pendientes) |
| POST | `/live` | Listo; frame base64 JPEG → Muse Spark |
| POST | `/calibrate` | Listo con puntos + distancia; con frame (SAM) pendiente |
| POST | `/measure` | Listo: normaliza, SAM, cálculo, guarda resultados, borra el video |
| POST | `/agent` | Listo con herramienta `select_experiment`; resto pendiente |
| POST | `/report` | Compila PDF con tectonic; subida a Vercel Blob pendiente |
| GET | `/history` | Listo (desde SQLite) |

## Correr en local

```bash
cd api
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pytest
GALILEO_DATA_DIR=/tmp/galileo APP_JWT_SECRET=dev uvicorn app.main:app --port 8443
```

Requiere `ffmpeg`, `ffprobe` y `tectonic` en el PATH para los endpoints de video e informe.

```bash
cd web
cp .env.example .env.local   # completar secretos
npm install
npm run dev
```

## Despliegue en el VPS

```bash
./deploy/deploy_vps.sh
```

Copia `api/app` a `/data/galileo-live/app`, instala dependencias en `/data/galileo-live/venv` y
reinicia el servicio de usuario `galileo-live-api` (escucha en `127.0.0.1:8443`).
Los secretos viven en `/data/galileo-live/.env` (permisos 600) y no se versionan.

## Pendiente

- Credenciales: `MODEL_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, `AUTH_SECRET`.
- Exponer la API con Tailscale Funnel (puerto 8443).
- Decodificar máscaras de SAM para calibración automática con regla y para centroide por máscara.
- Subida a Vercel Blob (store privado) y URL firmada en `/history`.
- Diagrama del montaje con Muse Image y diagnóstico con Muse Spark en el informe.
- UI de la PWA (cámara, grabación, push-to-talk, resultados). Actualmente solo hay login y token.
- Stretch: péndulo, plano inclinado.

## Licencia

Pendiente de definir.
