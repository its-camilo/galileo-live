import jwt
from fastapi import Header, HTTPException

from .config import get_settings
from .db import connect

MAX_TOKEN_LIFETIME = 600


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
            "INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)",
            (claims["sub"], claims["sub"], claims.get("name")),
        )
    return claims
