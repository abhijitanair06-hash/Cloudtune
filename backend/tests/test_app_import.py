"""Application import smoke tests: catch route/dependency wiring errors early."""

from app.main import app


def test_core_api_routes_are_registered():
    # Newer FastAPI versions keep included routers lazily in app.routes.
    # Generating OpenAPI resolves the complete registered path table.
    paths = set(app.openapi()["paths"])
    expected = {
        "/api/auth/login",
        "/api/auth/refresh",
        "/api/auth/logout",
        "/api/auth/sessions",
        "/api/auth/sessions/{session_id}",
        "/api/auth/change-password",
        "/api/songs/",
        "/api/songs/upload",
        "/api/songs/storage/usage",
    }
    assert expected <= paths
