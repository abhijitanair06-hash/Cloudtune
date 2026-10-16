import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.limiter import limiter
from app.core.jwt import ACCESS_TOKEN_COOKIE

from app.api.routes.health import router as health_router
from app.api.routes.security import router as security_router
from app.api.routes.auth import router as auth_router
from app.api.routes.users import router as users_router
from app.api.routes.songs import router as songs_router
from app.api.routes.intelligence import router as intelligence_router
from app.api.routes.library import router as library_router
from app.api.routes.recommendations import router as recommendations_router
from app.api.routes.listener import router as listener_router
from app.api.routes.lyrics import router as lyrics_router

from app.core.config import settings

from app.core.errors import (
    CloudTuneError,
    cloudtune_error_handler,
)

from app.core.logging import setup_logging


setup_logging()

logger = logging.getLogger("cloudtune")


app = FastAPI(
    title=settings.app_name,
    description="Personal cloud music streaming platform",
    version=settings.app_version,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ============================================================
# CORS
# ============================================================

allowed_origins = [
    origin.strip().rstrip("/")
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def protect_cookie_authenticated_mutations(request: Request, call_next):
    # SameSite=Strict is the first CSRF layer. Check Origin too for browser
    # requests authenticated by the HttpOnly cookie. Bearer-authenticated API
    # clients (e.g. explicit scripts) keep their normal API workflow.
    unsafe_method = request.method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
    has_cookie_session = bool(request.cookies.get(ACCESS_TOKEN_COOKIE))
    has_explicit_bearer = request.headers.get("authorization", "").lower().startswith("bearer ")
    if unsafe_method and has_cookie_session and not has_explicit_bearer:
        origin = (request.headers.get("origin") or "").rstrip("/")
        same_api_origin = str(request.base_url).rstrip("/")
        if not origin or (origin not in allowed_origins and origin != same_api_origin):
            return JSONResponse(
                status_code=403,
                content={"detail": "Request origin is not allowed for cookie-authenticated changes."},
            )
    return await call_next(request)


# ============================================================
# ERROR HANDLER
# ============================================================

app.add_exception_handler(
    CloudTuneError,
    cloudtune_error_handler,
)


# ============================================================
# ROUTES
# ============================================================

app.include_router(health_router)
app.include_router(security_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(songs_router)
app.include_router(intelligence_router)
app.include_router(library_router)
app.include_router(recommendations_router)
app.include_router(listener_router)
app.include_router(lyrics_router)


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():
    logger.info(
        "Root endpoint requested"
    )

    return {
        "name": "CloudTune",
        "status": "alive",
        "message": "🎵 CloudTune backend is alive!",
    }