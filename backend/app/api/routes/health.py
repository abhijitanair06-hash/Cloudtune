import logging

from fastapi import APIRouter


logger = logging.getLogger("cloudtune.health")


router = APIRouter(
    prefix="/api",
    tags=["Health"],
)


@router.get("/health")
def health_check():
    logger.info("Health check requested")

    return {
        "status": "healthy",
        "service": "cloudtune-api",
        "version": "0.1.0",
    }