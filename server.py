import os
import pickle
from functools import lru_cache
from typing import Optional
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import shutil
import subprocess

from reader3 import Book, BookMetadata, ChapterContent, TOCEntry
from database import Database, Highlight, AIAnalysis
from ai_service import AIService

# Load .env file at startup
def load_env():
    """Load environment variables from .env file."""
    env_path = Path(".env")
    if env_path.exists():
        print("Loading .env file...")
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ[key.strip()] = value.strip()
        print(f"✓ Loaded API configuration: {os.getenv('OPENAI_BASE_URL', 'Not set')}")
    else:
        print("⚠ Warning: .env file not found. AI features will not work.")

load_env()

app = FastAPI()
templates = Jinja2Templates(directory="templates")

# Initialize database and AI service
db = Database()
ai_service = None  # Will be initialized on first use

def get_ai_service():
    """Lazy initialization of AI service."""
    global ai_service
    if ai_service is None:
        try:
            ai_service = AIService()
        except ValueError as e:
            print(f"Warning: {e}")
    return ai_service


# Request models
class HighlightRequest(BaseModel):
    book_id: str
    chapter_index: int
    selected_text: str
    context_before: str = ""
    context_after: str = ""


class AIRequest(BaseModel):
    highlight_id: int
    analysis_type: str  # 'fact_check' or 'discussion'
    selected_text: str
    context: str = ""

# Where are the book folders located?
BOOKS_DIR = "books"

@lru_cache(maxsize=10)
def load_book_cached(folder_name: str) -> Optional[Book]:
    """
    Loads the book from the pickle file.
    Cached so we don't re-read the disk on every click.
    """
    file_path = os.path.join(BOOKS_DIR, folder_name, "book.pkl")
    if not os.path.exists(file_path):
        return None

    try:
        with open(file_path, "rb") as f:
            book = pickle.load(f)
        return book
    except Exception as e:
        print(f"Error loading book {folder_name}: {e}")
        return None

@app.get("/", response_class=HTMLResponse)
async def library_view(request: Request):
    """Lists all available processed books."""
    books = []

    # Create books directory if it doesn't exist
    os.makedirs(BOOKS_DIR, exist_ok=True)

    # Scan directory for folders that have a book.pkl
    for item in os.listdir(BOOKS_DIR):
        item_path = os.path.join(BOOKS_DIR, item)
        # Check if it's a directory and has book.pkl
        if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path, "book.pkl")):
            # Try to load it to get the title
            book = load_book_cached(item)
            if book:
                # Extract folder suffix if it exists (e.g., "_1", "_2")
                folder_suffix = None
                # Check if there's a number suffix
                if item.endswith(tuple(f"_{i}" for i in range(1, 100))):
                    suffix_num = item.split("_")[-1]
                    folder_suffix = f"Copy {suffix_num}"
                
                # Get reading progress
                progress_data = db.get_progress(item)
                total_chapters = len(book.spine)
                progress_percent = 0
                current_chapter = None
                if progress_data:
                    current_chapter = progress_data['chapter_index']
                    progress_percent = int((current_chapter + 1) / total_chapters * 100)
                
                books.append({
                    "id": item,
                    "title": book.metadata.title,
                    "author": ", ".join(book.metadata.authors),
                    "chapters": total_chapters,
                    "folder_suffix": folder_suffix,
                    "cover": book.cover_image if hasattr(book, 'cover_image') else None,
                    "progress": current_chapter,
                    "progress_percent": progress_percent
                })
    return templates.TemplateResponse("library.html", {"request": request, "books": books})

@app.get("/read/{book_id}", response_class=HTMLResponse)
async def redirect_to_last_position(book_id: str):
    """Redirect to last read chapter or chapter 0 if new."""
    from fastapi.responses import RedirectResponse
    progress_data = db.get_progress(book_id)
    chapter_index = progress_data['chapter_index'] if progress_data else 0
    return RedirectResponse(url=f"/read/{book_id}/{chapter_index}", status_code=302)

@app.get("/read/{book_id}/images/{image_name}")
async def serve_image(book_id: str, image_name: str):
    """
    Serves images specifically for a book.
    The HTML contains <img src="images/pic.jpg">.
    The browser resolves this to /read/{book_id}/images/pic.jpg.
    """
    # Security check: prevent path traversal
    if ".." in book_id or "/" in book_id or "\\" in book_id:
        raise HTTPException(status_code=400, detail="Invalid book ID")
    if ".." in image_name or "/" in image_name or "\\" in image_name:
        raise HTTPException(status_code=400, detail="Invalid image name")

    img_path = os.path.join(BOOKS_DIR, book_id, "images", image_name)

    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail="Image not found")

    return FileResponse(img_path)

@app.get("/read/{book_id}/{chapter_ref:path}", response_class=HTMLResponse)
async def read_chapter(request: Request, book_id: str, chapter_ref: str):
    """The main reader interface. Accepts either chapter index (0, 1, 2) or filename (part0008.html)."""
    
    # Try to parse as integer first
    try:
        chapter_index = int(chapter_ref)
    except ValueError:
        # It's a filename, need to find the corresponding chapter index
        book = load_book_cached(book_id)
        chapter_index = None
        
        # Search through spine to find matching filename
        for idx, item in enumerate(book.spine):
            if item.href == chapter_ref or item.href.endswith(chapter_ref):
                chapter_index = idx
                break
        
        if chapter_index is None:
            raise HTTPException(status_code=404, detail=f"Chapter file '{chapter_ref}' not found")
    
    # Now proceed with the chapter_index
    book = load_book_cached(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if chapter_index < 0 or chapter_index >= len(book.spine):
        raise HTTPException(status_code=404, detail="Chapter not found")

    current_chapter = book.spine[chapter_index]

    # Calculate Prev/Next links
    prev_idx = chapter_index - 1 if chapter_index > 0 else None
    next_idx = chapter_index + 1 if chapter_index < len(book.spine) - 1 else None

    # Get saved scroll position if returning to this chapter
    progress_data = db.get_progress(book_id)
    saved_scroll = 0
    if progress_data and progress_data['chapter_index'] == chapter_index:
        saved_scroll = progress_data['scroll_position']
    
    return templates.TemplateResponse("reader.html", {
        "request": request,
        "book": book,
        "current_chapter": current_chapter,
        "chapter_index": chapter_index,
        "book_id": book_id,
        "prev_idx": prev_idx,
        "next_idx": next_idx,
        "saved_scroll": saved_scroll
    })


# AI-related endpoints

@app.post("/api/progress")
async def save_reading_progress(book_id: str, chapter_index: int, scroll_position: int = 0):
    """Save reading progress."""
    try:
        db.save_progress(book_id, chapter_index, scroll_position)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/highlight")
async def create_highlight(req: HighlightRequest):
    """Save a user highlight."""
    highlight = Highlight(
        book_id=req.book_id,
        chapter_index=req.chapter_index,
        selected_text=req.selected_text,
        context_before=req.context_before,
        context_after=req.context_after,
        created_at=datetime.now().isoformat()
    )
    
    highlight_id = db.save_highlight(highlight)
    return {"highlight_id": highlight_id, "status": "success"}


@app.post("/api/ai/analyze")
async def analyze_text(req: AIRequest):
    """Perform AI analysis (fact-check or discussion) without saving."""
    service = get_ai_service()
    if not service:
        raise HTTPException(status_code=500, detail="AI service not configured. Please set OPENAI_API_KEY.")
    
    # Call appropriate AI function
    if req.analysis_type == "fact_check":
        response = await service.fact_check(req.selected_text, req.context)
    elif req.analysis_type == "discussion":
        response = await service.discuss(req.selected_text, req.context)
    else:
        raise HTTPException(status_code=400, detail="Invalid analysis type")

    return {
        "response": response,
        "status": "success"
    }


class SaveAnalysisRequest(BaseModel):
    highlight_id: int
    analysis_type: str
    prompt: str
    response: str


@app.post("/api/ai/save")
async def save_analysis(req: SaveAnalysisRequest):
    """Save AI analysis to database."""
    analysis = AIAnalysis(
        highlight_id=req.highlight_id,
        analysis_type=req.analysis_type,
        prompt=req.prompt,
        response=req.response,
        created_at=datetime.now().isoformat()
    )
    
    analysis_id = db.save_analysis(analysis)
    
    return {
        "analysis_id": analysis_id,
        "status": "success"
    }


@app.get("/api/highlights/{book_id}/{chapter_index}")
async def get_highlights(book_id: str, chapter_index: int):
    """Get all highlights for a chapter."""
    highlights = db.get_highlights_for_chapter(book_id, chapter_index)
    
    # Attach analyses to each highlight
    for highlight in highlights:
        highlight["analyses"] = db.get_analyses_for_highlight(highlight["id"])
    
    return {"highlights": highlights}


@app.get("/highlights/{book_id}")
async def view_highlights(book_id: str, request: Request):
    """View all highlights for a book."""
    try:
        # Get all highlights for this book
        all_highlights = db.get_all_highlights_for_book(book_id)
        
        # Attach analyses and flatten
        highlights_with_analyses = []
        for highlight in all_highlights:
            analyses = db.get_analyses_for_highlight(highlight["id"])
            if analyses:
                for analysis in analyses:
                    highlights_with_analyses.append({
                        **highlight,
                        "analysis_type": analysis["analysis_type"],
                        "response": analysis["response"],
                        "analysis_created_at": analysis["created_at"]
                    })
            else:
                # Highlight without analysis
                highlights_with_analyses.append({
                    **highlight,
                    "analysis_type": None,
                    "response": None,
                    "analysis_created_at": None
                })
        
        # Sort by creation date (newest first)
        highlights_with_analyses.sort(key=lambda x: x["created_at"], reverse=True)
        
        # Calculate stats
        stats = {
            "total": len(highlights_with_analyses),
            "fact_check": sum(1 for h in highlights_with_analyses if h["analysis_type"] == "fact_check"),
            "discussion": sum(1 for h in highlights_with_analyses if h["analysis_type"] == "discussion"),
            "comment": sum(1 for h in highlights_with_analyses if h["analysis_type"] == "comment")
        }
        
        # Get book title
        book_title = book_id.replace("_data", "").replace("_", " ")
        
        return templates.TemplateResponse("highlights.html", {
            "request": request,
            "book_id": book_id,
            "book_title": book_title,
            "highlights": highlights_with_analyses,
            "stats": stats
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/ai/update/{analysis_id}")
async def update_analysis(analysis_id: int, req: dict):
    """Update an existing analysis (for editing comments)."""
    try:
        db.update_analysis(analysis_id, req.get("response", ""))
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/ai/delete/{analysis_id}")
async def delete_analysis(analysis_id: int):
    """Delete an analysis (and its highlight if no other analyses exist)."""
    try:
        db.delete_analysis(analysis_id)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/delete/{book_id}")
async def delete_book(book_id: str):
    """Delete a book folder (but keep database entries)."""
    try:
        # Security check: ensure book_id doesn't contain path traversal
        if ".." in book_id or "/" in book_id or "\\" in book_id:
            raise HTTPException(status_code=400, detail="Invalid book ID")
        
        book_path = os.path.join(BOOKS_DIR, book_id)
        
        if not os.path.exists(book_path):
            raise HTTPException(status_code=404, detail="Book not found")
        
        # Delete the book folder
        shutil.rmtree(book_path)
        
        # Clear cache for this book
        load_book_cached.cache_clear()
        
        return {
            "message": f"Book deleted. Your highlights and analyses are preserved in the database.",
            "status": "success"
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload")
async def upload_book(file: UploadFile = File(...)):
    """Upload and process an EPUB file."""
    # Validate file type
    if not file.filename.endswith('.epub'):
        raise HTTPException(status_code=400, detail="Only EPUB files are supported")
    
    try:
        # Create temp directory if it doesn't exist
        temp_dir = "temp"
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save uploaded file
        temp_file_path = os.path.join(temp_dir, file.filename)
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Process the EPUB file using reader3.py with uv
        result = subprocess.run(
            ["uv", "run", "reader3.py", temp_file_path],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # Clean up temp file
        os.remove(temp_file_path)
        
        if result.returncode == 0:
            # Extract book title from output
            book_name = os.path.splitext(file.filename)[0]
            return {
                "message": f"Successfully processed '{book_name}'",
                "status": "success"
            }
        else:
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to process EPUB: {result.stderr}"
            )
    
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Processing timeout (file too large?)")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    print("Starting server at http://0.0.0.0:8123 (accessible externally if firewall/NAT allow)")
    uvicorn.run(app, host="0.0.0.0", port=8000)
