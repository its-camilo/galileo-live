from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .db import init_db
from .routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Galileo Live API", version="0.1.0", lifespan=lifespan)
app.include_router(router)


@app.exception_handler(httpx.HTTPError)
async def upstream_error(request: Request, exc: httpx.HTTPError):
    return JSONResponse(status_code=502, content={"detail": f"upstream error: {type(exc).__name__}"})


@app.get("/health")
def health():
    return {"ok": True}
