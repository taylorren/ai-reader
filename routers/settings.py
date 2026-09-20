"""
Settings routes: progress tracking, provider overrides, book completion.
"""
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import _runtime_settings, get_db, load_book_cached

router = APIRouter()


class SettingsUpdate(BaseModel):
    """Payload for updating runtime settings like AI provider override."""
    provider_override: Optional[str] = None


@router.get("/api/settings")
async def get_settings():
    """Get current settings including provider override status."""
    return {
        "provider_override": _runtime_settings["provider_override"],
        "default_provider": os.getenv("OLLAMA_DEFAULT_PROVIDER", "ollama_cloud"),
        "status": "success",
    }


@router.post("/api/settings")
async def update_settings(settings: SettingsUpdate):
    """Update runtime settings (provider override, etc.)."""
    if settings.provider_override is not None:
        provider = settings.provider_override.lower()
        if provider not in ("ollama", "ollama_cloud"):
            raise HTTPException(
                status_code=400,
                detail="Invalid provider. Must be 'ollama' or 'ollama_cloud'",
            )
        _runtime_settings["provider_override"] = provider
        print(f"✓ Provider override set to: {provider}")
    else:
        _runtime_settings["provider_override"] = None
        print("✓ Provider override cleared, using default")

    return {
        "provider_override": _runtime_settings["provider_override"],
        "status": "success",
    }


@router.post("/api/progress")
async def save_reading_progress(
    book_id: str,
    chapter_index: int,
    scroll_percent: float = 0.0,
    anchor: str = "",
):
    """Save reading progress (scroll percent + optional text anchor JSON)."""
    db = get_db()
    try:
        db.save_progress(book_id, chapter_index, scroll_percent, anchor or None)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/api/books/{book_id}/completion")
async def update_book_completion(book_id: str, completed: bool):
    """Mark a book as completed or not completed."""
    book = load_book_cached(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    db = get_db()
    try:
        db.set_completed(book_id, completed)
        return {"status": "success", "book_id": book_id, "completed": completed}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
