import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.security import router as security_router
from app.api.routes.auth import router as auth_router
from app.api.routes.users import router as users_router
from app.api.routes.songs import router as songs_router
from app.api.routes.intelligence import router as intelligence_router
from app.api.routes.library import router as library_router
from app.api.routes.recommendations import router as recommendations_router

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


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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