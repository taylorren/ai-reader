"""Security tests: the upload endpoint must not trust client filenames."""

import os
import sys

from routers import BASE_DIR
from routers import library as library_module

TEMP_DIR = str(BASE_DIR / "temp")


def test_upload_sanitizes_traversal_filename(client, monkeypatch):
    recorded = []

    def fake_run(cmd, **kwargs):
        recorded.append(list(cmd))

        class Result:
            returncode = 0
            stderr = ""

        return Result()

    monkeypatch.setattr(library_module.subprocess, "run", fake_run)

    resp = client.post(
        "/upload",
        files={"file": ("../../evil.epub", b"not really an epub", "application/epub+zip")},
    )
    assert resp.status_code == 200, resp.text

    # The file handed to the processor must live in temp/ under a flat name.
    # cmd = [sys.executable, reader3.py, temp_epub_path]
    assert len(recorded) == 1
    temp_path = recorded[0][2]
    assert os.path.dirname(temp_path) == TEMP_DIR
    assert os.path.basename(temp_path) == "evil.epub"

    # Nothing may be written outside the temp dir.
    assert not os.path.exists(os.path.join(str(BASE_DIR), "evil.epub"))
    assert not os.path.exists(os.path.join(os.path.dirname(str(BASE_DIR)), "evil.epub"))


def test_upload_rejects_non_epub(client, monkeypatch):
    monkeypatch.setattr(library_module.subprocess, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("should not run")))
    resp = client.post(
        "/upload",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400


def test_upload_accepts_normal_name(client, monkeypatch):
    recorded = []

    def fake_run(cmd, **kwargs):
        recorded.append(list(cmd))

        class Result:
            returncode = 0
            stderr = ""

        return Result()

    monkeypatch.setattr(library_module.subprocess, "run", fake_run)
    resp = client.post(
        "/upload",
        files={"file": ("My Book.epub", b"not really an epub", "application/epub+zip")},
    )
    assert resp.status_code == 200, resp.text
    assert os.path.basename(recorded[0][2]) == "My Book.epub"
