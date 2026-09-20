"""
Library routes: book listing, reading, upload, delete.
"""
import os
import shutil
import subprocess
import sys

from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse

from . import (
    BOOKS_DIR,
    build_grouped_books,
    estimate_reading_time,
    format_reading_time,
    format_word_count,
    get_asset_version,
    get_book_word_count,
    get_db,
    load_book_cached,
    rewrite_chapter_image_paths,
    transliterate_for_sort,
    title_group_key,
)

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def library_view(request: Request):
    """Lists all available processed books."""
    books = []
    db = get_db()
    os.makedirs(BOOKS_DIR, exist_ok=True)

    for item in os.listdir(BOOKS_DIR):
        item_path = os.path.join(BOOKS_DIR, item)
        if os.path.isdir(item_path) and os.path.exists(os.path.join(item_path, "book.pkl")):
            book = load_book_cached(item)
            if book:
                folder_suffix = None
                if item.endswith(tuple(f"_{i}" for i in range(1, 100))):
                    suffix_num = item.split("_")[-1]
                    folder_suffix = f"Copy {suffix_num}"

                progress_data = db.get_progress(item)
                total_chapters = len(book.spine)
                progress_percent = 0
                current_chapter = None
                is_completed = False
                if progress_data:
                    current_chapter = progress_data['chapter_index']
                    is_completed = progress_data.get('is_completed', False)
                    progress_percent = int((current_chapter + 1) / total_chapters * 100)
                if is_completed:
                    progress_percent = 100

                estimated_word_count = get_book_word_count(item)
                title_sort_key = transliterate_for_sort(book.metadata.title)
                title_group = title_group_key(book.metadata.title)

                books.append({
                    "id": item,
                    "title": book.metadata.title,
                    "author": ", ".join(book.metadata.authors),
                    "chapters": total_chapters,
                    "estimated_word_count": estimated_word_count,
                    "estimated_word_count_display": format_word_count(estimated_word_count),
                    "reading_time_display": format_reading_time(estimate_reading_time(estimated_word_count)),
                    "folder_suffix": folder_suffix,
                    "cover": book.cover_image if hasattr(book, 'cover_image') else None,
                    "progress": current_chapter,
                    "progress_percent": progress_percent,
                    "is_completed": is_completed,
                    "title_sort_key": title_sort_key,
                    "title_group": title_group,
                })

    grouped_books = build_grouped_books(books)
    books = [book for group in grouped_books for book in group["books"]]
    library_asset_version = get_asset_version("static/js/library-app.js")

    from fastapi.templating import Jinja2Templates
    from . import BASE_DIR
    templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

    return templates.TemplateResponse(
        "library.html",
        {
            "request": request,
            "books": books,
            "grouped_books": grouped_books,
            "asset_version": library_asset_version,
        },
    )


@router.get("/read/{book_id}", response_class=HTMLResponse)
async def redirect_to_last_position(book_id: str):
    """Redirect to last read chapter or chapter 0 if new."""
    db = get_db()
    progress_data = db.get_progress(book_id)
    chapter_index = progress_data['chapter_index'] if progress_data else 0
    return RedirectResponse(url=f"/read/{book_id}/{chapter_index}", status_code=302)


@router.get("/read/{book_id}/images/{image_name}")
async def serve_image(book_id: str, image_name: str):
    """Serves images for a book."""
    if ".." in book_id or "/" in book_id or "\\" in book_id:
        raise HTTPException(status_code=400, detail="Invalid book ID")
    if ".." in image_name or "/" in image_name or "\\" in image_name:
        raise HTTPException(status_code=400, detail="Invalid image name")

    img_path = os.path.join(BOOKS_DIR, book_id, "images", image_name)
    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img_path)


@router.get("/read/{book_id}/{chapter_ref:path}", response_class=HTMLResponse)
async def read_chapter(request: Request, book_id: str, chapter_ref: str):
    """Render chapter by numeric index or by chapter filename."""
    try:
        chapter_index = int(chapter_ref)
    except ValueError as exc:
        book = load_book_cached(book_id)
        chapter_index = None
        for idx, item in enumerate(book.spine):
            if item.href == chapter_ref or item.href.endswith(chapter_ref):
                chapter_index = idx
                break
        if chapter_index is None:
            raise HTTPException(
                status_code=404,
                detail=f"Chapter file '{chapter_ref}' not found",
            ) from exc

    book = load_book_cached(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    if chapter_index < 0 or chapter_index >= len(book.spine):
        raise HTTPException(status_code=404, detail="Chapter not found")

    current_chapter = book.spine[chapter_index]
    current_chapter_content = rewrite_chapter_image_paths(current_chapter.content, book.images)
    spine_map = {chapter.href: chapter.order for chapter in book.spine}

    prev_idx = chapter_index - 1 if chapter_index > 0 else None
    next_idx = chapter_index + 1 if chapter_index < len(book.spine) - 1 else None

    db = get_db()
    progress_data = db.get_progress(book_id)
    saved_percent = 0.0
    saved_anchor = ""
    if progress_data and progress_data['chapter_index'] == chapter_index:
        saved_percent = progress_data.get('scroll_percent') or 0.0
        saved_anchor = progress_data.get('anchor') or ""

    target_highlight_id = request.query_params.get("highlight_id", "")

    reader_asset_version = get_asset_version("static/css/reader.css", "static/js/reader.js")

    from fastapi.templating import Jinja2Templates
    from . import BASE_DIR
    templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

    return templates.TemplateResponse("reader.html", {
        "request": request,
        "book": book,
        "current_chapter": current_chapter,
        "current_chapter_content": current_chapter_content,
        "chapter_index": chapter_index,
        "book_id": book_id,
        "spine_map": spine_map,
        "prev_idx": prev_idx,
        "next_idx": next_idx,
        "saved_percent": saved_percent,
        "saved_anchor": saved_anchor,
        "target_highlight_id": target_highlight_id,
        "asset_version": reader_asset_version,
    })


@router.post("/upload")
async def upload_book(file: UploadFile = File(...)):
    """Upload and process an EPUB file."""
    raw_filename = file.filename or ""
    # Only trust the basename: Starlette passes the multipart filename through
    # unmodified, so it could contain path separators (path traversal).
    safe_filename = os.path.basename(raw_filename.replace("\\", "/"))
    if not safe_filename.endswith('.epub'):
        raise HTTPException(status_code=400, detail="Only EPUB files are supported")

    try:
        from . import BASE_DIR
        temp_dir = str(BASE_DIR / "temp")
        os.makedirs(temp_dir, exist_ok=True)

        temp_file_path = os.path.join(temp_dir, safe_filename)
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        result = subprocess.run(
            [sys.executable, str(BASE_DIR / "reader3.py"), temp_file_path],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
            cwd=str(BASE_DIR),
        )

        os.remove(temp_file_path)

        if result.returncode == 0:
            book_name = os.path.splitext(file.filename)[0]
            return {"message": f"Successfully processed '{book_name}'", "status": "success"}
        else:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to process EPUB: {result.stderr}",
            )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(
            status_code=500,
            detail="Processing timeout (file too large?)",
        ) from exc
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/delete/{book_id}")
async def delete_book(book_id: str):
    """Delete a book folder (but keep database entries)."""
    if ".." in book_id or "/" in book_id or "\\" in book_id:
        raise HTTPException(status_code=400, detail="Invalid book ID")

    book_path = os.path.join(BOOKS_DIR, book_id)
    if not os.path.exists(book_path):
        raise HTTPException(status_code=404, detail="Book not found")

    shutil.rmtree(book_path)
    load_book_cached.cache_clear()
    from . import estimate_book_word_count_cached
    estimate_book_word_count_cached.cache_clear()

    return {
        "message": "Book deleted. Your highlights and analyses are preserved in the database.",
        "status": "success",
    }
