from app.main import app


def _route_map():
    # Newer FastAPI versions may store included routers lazily in app.routes;
    # OpenAPI resolves the full router tree and exposes the actual public paths.
    paths = app.openapi()["paths"]
    return {
        (method.upper(), path)
        for path, operations in paths.items()
        for method in operations
        if method.lower() in {"get", "post", "put", "patch", "delete", "options", "head"}
    }


def test_expected_auth_and_music_routes_are_registered():
    expected = {
        ("POST", "/api/auth/register"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/auth/refresh"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/auth/sessions"),
        ("DELETE", "/api/auth/sessions/{session_id}"),
        ("POST", "/api/auth/change-password"),
        ("GET", "/api/songs/"),
        ("GET", "/api/songs/{song_id}"),
        ("GET", "/api/songs/{song_id}/stream"),
        ("GET", "/api/users/me"),
    }

    missing = expected - _route_map()
    assert not missing, f"Missing expected routes: {sorted(missing)}"


def test_duplicate_public_user_creation_route_is_removed():
    assert ("POST", "/api/users/") not in _route_map()
