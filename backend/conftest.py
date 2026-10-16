"""Safe default settings for tests that do not contact external services."""

import os

os.environ.setdefault("JWT_SECRET", "test-only-" + ("x" * 64))
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test-only-key")
os.environ.setdefault("ACCESS_TOKEN_EXPIRE_MINUTES", "15")
