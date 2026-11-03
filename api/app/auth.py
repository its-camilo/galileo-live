import jwt
from fastapi import Depends, Header, HTTPException

from .config import get_settings
from .db import connect

MAX_TOKEN_LIFETIME = 600
CONSENT_VERSION = "2026-11-04"


def require_user(authorization: str | None = Header(default=None)) -> dict:
    settings = get_settings()
    if not settings.jwt_secret:
        raise HTTPException(500, "server misconfigured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    try:
        claims = jwt.decode(
            authorization.removeprefix("Bearer "),
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid token")
    if claims["exp"] - claims["iat"] > MAX_TOKEN_LIFETIME:
        raise HTTPException(401, "token lifetime too long")
    with connect() as conn:
        conn.execute(
            "INSERT INTO users (id, email, name) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING",
            (claims["sub"], claims["sub"], claims.get("name")),
        )
    return claims


def require_consent(claims: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT consent_version FROM users WHERE id = ?", (claims["sub"],)).fetchone()
    if row is None or row["consent_version"] != CONSENT_VERSION:
        raise HTTPException(403, "consent required")
    return claims
