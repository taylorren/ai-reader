"""Regression tests for reading-progress handling (see database.py)."""

import os

import pytest

from database import Database


@pytest.fixture
def db(tmp_path):
    return Database(str(tmp_path / "test.db"))


def test_save_progress_does_not_reset_completed(db):
    """A scroll/progress save must not undo the completed flag.

    Regression: the ON CONFLICT clause used to write is_completed back from
    the insert values (always 0), silently un-completing books on every
    progress save.
    """
    db.save_progress("book-1", 1, 10)
    db.set_completed("book-1", True)

    # Simulate the client saving progress again (scroll, chapter change).
    db.save_progress("book-1", 2, 20)

    progress = db.get_progress("book-1")
    assert progress["is_completed"] is True
    assert progress["chapter_index"] == 2


def test_new_progress_defaults_to_not_completed(db):
    db.save_progress("book-1", 0, 0)
    assert db.get_progress("book-1")["is_completed"] is False


def test_set_completed_unset(db):
    db.save_progress("book-1", 3, 40)
    db.set_completed("book-1", True)
    db.set_completed("book-1", False)
    assert db.get_progress("book-1")["is_completed"] is False


def test_get_progress_missing_book(db):
    assert db.get_progress("nope") is None


def test_save_progress_anchor_and_percent_roundtrip(db):
    import json

    anchor = json.dumps({"p": [["div", 2], ["p", 5]], "o": 0})
    db.save_progress("book-1", 3, 0.42, anchor)
    progress = db.get_progress("book-1")
    assert progress["chapter_index"] == 3
    assert progress["scroll_percent"] == pytest.approx(0.42)
    assert json.loads(progress["anchor"]) == {"p": [["div", 2], ["p", 5]], "o": 0}

    # Updating again replaces both fields.
    db.save_progress("book-1", 4, 0.9)
    progress = db.get_progress("book-1")
    assert progress["chapter_index"] == 4
    assert progress["scroll_percent"] == pytest.approx(0.9)
    assert progress["anchor"] is None


def test_migration_adds_columns_to_legacy_db(tmp_path):
    """A pre-existing DB without the new columns must be migrated in place."""
    import sqlite3

    legacy_path = str(tmp_path / "legacy.db")
    conn = sqlite3.connect(legacy_path)
    conn.execute("""
        CREATE TABLE reading_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL UNIQUE,
            chapter_index INTEGER NOT NULL,
            scroll_position INTEGER DEFAULT 0,
            is_completed INTEGER NOT NULL DEFAULT 0,
            last_read_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "INSERT INTO reading_progress (book_id, chapter_index, scroll_position,"
        " is_completed, last_read_at) VALUES ('b', 2, 1234, 1, '2025-01-01')"
    )
    conn.commit()
    conn.close()

    db = Database(legacy_path)
    progress = db.get_progress("b")
    assert progress["is_completed"] is True          # legacy data preserved
    assert progress["scroll_percent"] is None        # new columns are NULL
    assert progress["anchor"] is None

    db.save_progress("b", 3, 0.5)
    assert db.get_progress("b")["scroll_percent"] == pytest.approx(0.5)


def test_progress_api_roundtrip(client):
    """/api/progress persists percent + anchor; readable via get_progress."""
    import json

    from database import Database

    anchor = json.dumps({"p": [["div", 1], ["p", 3]], "o": 0})
    resp = client.post(
        "/api/progress",
        params={
            "book_id": "some-book",
            "chapter_index": "2",
            "scroll_percent": "0.37",
            "anchor": anchor,
        },
    )
    assert resp.status_code == 200

    db = Database("reader_data.db")  # relative to CWD, isolated to tmp dir
    progress = db.get_progress("some-book")
    assert progress["chapter_index"] == 2
    assert progress["scroll_percent"] == pytest.approx(0.37)
    assert json.loads(progress["anchor"]) == {"p": [["div", 1], ["p", 3]], "o": 0}


def test_highlight_and_analysis_roundtrip(db):
    highlight_id = db.save_highlight(type("H", (), {
        "book_id": "b", "chapter_index": 0, "selected_text": "sel",
        "context_before": "", "context_after": "", "created_at": None,
    })())
    assert highlight_id > 0

    analysis_id = db.save_analysis(type("A", (), {
        "highlight_id": highlight_id, "analysis_type": "fact_check",
        "prompt": "p", "response": "r", "created_at": None,
    })())
    assert analysis_id > 0

    highlights = db.get_highlights_for_chapter("b", 0)
    assert len(highlights) == 1
    analyses = db.get_analyses_for_highlight(highlight_id)
    assert analyses[0]["response"] == "r"

    db.delete_highlight(highlight_id)
    assert db.get_highlights_for_chapter("b", 0) == []
    assert db.get_analyses_for_highlight(highlight_id) == []
