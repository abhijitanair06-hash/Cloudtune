"""Shared dependency exports.

Authentication is implemented in app.core.jwt so token validation stays
consistent across API routers.
"""

from app.core.jwt import get_current_user

__all__ = ["get_current_user"]
