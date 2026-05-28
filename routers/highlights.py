"""
Highlight routes: CRUD endpoints and highlights view page.
"""
from datetime import datetime

from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from database import Highlight

from . import get_asset_version, get_db, load_book_cached

router = APIRouter()


class HighlightRequest(BaseModel):
    """Payload for creating a new highlight on a book chapter."""
    book_id: str
    chapter_index: int
    selected_text: str
    context_before: str = ""
    context_after: str = ""


@router.post("/api/highlight")
async def create_highlight(req: HighlightRequest):
    """Save a user highlight."""
    db = get_db()
    highlight = Highlight(
        book_id=req.book_id,
        chapter_index=req.chapter_index,
        selected_text=req.selected_text,
        context_before=req.context_before,
        context_after=req.context_after,
        created_at=datetime.now().isoformat(),
    )
    highlight_id = db.save_highlight(highlight)
    return {"highlight_id": highlight_id, "status": "success"}


@router.delete("/api/highlight/{highlight_id}")
async def delete_highlight(highlight_id: int):
    """Delete a highlight and any analyses attached to it."""
    db = get_db()
    try:
        db.delete_highlight(highlight_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/api/highlights/{book_id}/{chapter_index}")
async def get_highlights(book_id: str, chapter_index: int):
    """Get all highlights for a chapter."""
    db = get_db()
    highlights = db.get_highlights_for_chapter(book_id, chapter_index)
    for highlight in highlights:
        highlight["analyses"] = db.get_analyses_for_highlight(highlight["id"])
    return {"highlights": highlights}


@router.get("/highlights/{book_id}", response_class=HTMLResponse)
async def view_highlights(book_id: str, request: Request):
    """View all highlights for a book."""
    db = get_db()
    try:
        all_highlights = db.get_all_highlights_for_book(book_id)

        highlights_with_analyses = []
        for highlight in all_highlights:
            analyses = db.get_analyses_for_highlight(highlight["id"])
            if analyses:
                for analysis in analyses:
                    highlights_with_analyses.append({
                        **highlight,
                        "analysis_type": analysis["analysis_type"],
                        "response": analysis["response"],
                        "analysis_created_at": analysis["created_at"],
                    })
            else:
                highlights_with_analyses.append({
                    **highlight,
                    "analysis_type": None,
                    "response": None,
                    "analysis_created_at": None,
                })

        highlights_with_analyses.sort(key=lambda x: x["created_at"], reverse=True)

        stats = {
            "total": len(highlights_with_analyses),
            "fact_check": sum(
                1 for h in highlights_with_analyses if h["analysis_type"] == "fact_check"
            ),
            "discussion": sum(
                1 for h in highlights_with_analyses if h["analysis_type"] == "discussion"
            ),
            "comment": sum(
                1 for h in highlights_with_analyses if h["analysis_type"] == "comment"
            ),
        }

        book = load_book_cached(book_id)
        book_title = book.metadata.title if book else book_id.replace("_data", "").replace("_", " ")

        highlights_asset_version = get_asset_version("static/js/highlights-app.js")

        from fastapi.templating import Jinja2Templates
        from . import BASE_DIR
        templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

        return templates.TemplateResponse("highlights.html", {
            "request": request,
            "book_id": book_id,
            "book_title": book_title,
            "highlights": highlights_with_analyses,
            "stats": stats,
            "asset_version": highlights_asset_version,
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
