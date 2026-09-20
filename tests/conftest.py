import os
import sys

import pytest
from fastapi.testclient import TestClient

# Make repo-root imports (server, routers, database) work regardless of CWD.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


@pytest.fixture
def client(tmp_path, monkeypatch):
    """TestClient for the real app, isolated from the developer's database.

    The database path is relative to the CWD, so chdir into a tmp dir first.
    """
    import routers as routers_pkg

    monkeypatch.chdir(tmp_path)
    routers_pkg._lazy["db"] = None
    import server

    with TestClient(server.app) as test_client:
        yield test_client
    routers_pkg._lazy["db"] = None
