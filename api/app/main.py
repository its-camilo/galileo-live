import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import init_db
from .routes import router
from .security import MAX_BODY_BYTES, check_global, client_ip

log = logging.getLogger("galileo")
# Sin esto los log.info("measure: ...") no salen en los logs de Render (por defecto solo WARNING).
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    log.addHandler(_h)
log.setLevel(logging.INFO)

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


settings = get_settings()

app = FastAPI(
    title="Galileo Live API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
app.include_router(router)


@app.middleware("http")
async def guard(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "payload too large"})
    if not check_global(request):
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limit exceeded"},
            headers={"Retry-After": "60"},
        )
    try:
        response = await call_next(request)
    except Exception:
        # Se responde aquí (dentro de CORS) para que el navegador vea el 500 real
        # y no un "error de red" por falta de cabeceras CORS.
        log.exception("unhandled error on %s from %s", request.url.path, client_ip(request))
        response = JSONResponse(status_code=500, content={"detail": "internal error"})
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response


# CORS va de último para quedar por fuera de todo: así 413, 429 y 500 también
# llevan Access-Control-Allow-Origin y el navegador muestra el error real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
    allow_credentials=False,
    max_age=600,
)


@app.exception_handler(httpx.HTTPError)
async def upstream_error(request: Request, exc: httpx.HTTPError):
    log.warning("upstream error on %s: %s", request.url.path, type(exc).__name__)
    return JSONResponse(status_code=502, content={"detail": "upstream service error"})


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception):
    log.exception("unhandled error on %s from %s", request.url.path, client_ip(request))
    return JSONResponse(status_code=500, content={"detail": "internal error"})


@app.get("/health")
def health():
    return {"ok": True}
