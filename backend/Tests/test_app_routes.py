from app.main import app


def test_expected_auth_and_music_routes_are_registered():
    route_map = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
    }

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

    assert expected.issubset(route_map)


def test_duplicate_public_user_creation_route_is_removed():
    route_map = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
    }

    assert ("POST", "/api/users/") not in route_map
