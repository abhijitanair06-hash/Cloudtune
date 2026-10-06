from fastapi import APIRouter

router = APIRouter(
    prefix="/api/security",
    tags=["Security"]
)


@router.get("/test")
async def security_test():
    return {
        "status": "ok",
        "message": "Security system is working"
    }