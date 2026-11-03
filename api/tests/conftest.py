import os

import pytest

os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:test@127.0.0.1:55432/galileo"))


@pytest.fixture(autouse=True)
def fresh_db():
    from app import config
    from app.db import reset_db_for_tests

    config.get_settings.cache_clear()
    reset_db_for_tests()
    yield
    config.get_settings.cache_clear()
