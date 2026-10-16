"""Application import smoke tests: catch route/dependency wiring errors early."""

from app.main import app


def test_core_api_routes_are_registered():
    paths = {route.path for route in app.routes}
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
