# Technical Challenges Solved

This document outlines the key technical challenges we encountered and solved while building this AI-powered EPUB reader.

## 1. EPUB Cover Image Extraction

**Challenge**: Cover images weren't being extracted from EPUB files. Some books had covers marked as `ITEM_COVER` type instead of `ITEM_IMAGE`, causing them to be skipped.

**Solution**: 
- Modified image extraction to handle both `ITEM_COVER` and `ITEM_IMAGE` types
- Implemented multi-method cover detection: check ITEM_COVER type → search by filename pattern → use first large image as fallback
- Added size filtering (>10KB) to avoid using small icons as covers

**Code**: `reader3.py` lines 190-230

## 2. Multi-Paragraph Text Highlighting

**Challenge**: When users highlighted text spanning multiple paragraphs, the highlight wouldn't display because wrapping `<p>` tags in a `<span>` creates invalid HTML that browsers reject.

**Solution**:
- Detect when highlighted text spans block elements
- Apply highlight class directly to the paragraph elements instead of wrapping
- Use Range API with whitespace-tolerant regex matching to handle text across multiple elements
- Normalize whitespace in search patterns to handle variations in HTML structure

**Code**: `templates/reader.html` - `applyHighlights()` and `findTextRange()` functions

## 3. FastAPI Route Ordering for Image Serving

**Challenge**: Image URLs like `/read/{book_id}/images/{image_name}` were returning 404 because the catch-all route `/read/{book_id}/{chapter_ref:path}` was matching first.

**Solution**:
- Moved the specific image route definition before the generic chapter route
- FastAPI matches routes in order, so more specific routes must come first
- Also fixed path handling to preserve spaces in book folder names (removed incorrect `os.path.basename()` usage)

**Code**: `server.py` - route ordering around line 125-175

## 4. Reading Progress with Precise Scroll Position

**Challenge**: 
- `scrollTop` was always returning 0 when read directly
- `beforeunload` event doesn't fire reliably
- Need to track exact scroll position within chapters, not just chapter numbers

**Solution**:
- Use scroll event listener to continuously track `currentScrollPosition` variable
- Intercept navigation clicks with `preventDefault()` to ensure save completes before navigation
- Add `pagehide` event as backup for mobile browsers
- Store both chapter index and scroll position in database
- Implement retry mechanism for scroll restoration to handle content loading delays

**Code**: `templates/reader.html` - scroll tracking and `saveProgress()` function

## 5. Database Schema Migration

**Challenge**: Adding `scroll_position` column to existing `reading_progress` table without breaking existing data.

**Solution**:
- Created migration script that checks if column exists before adding
- Used `ALTER TABLE ADD COLUMN` with `DEFAULT 0` for backward compatibility
- Gracefully handles both new installations and existing databases

**Code**: `migrate_progress.py`

## 6. AI Prompt Engineering for Reading Context

**Challenge**: Generic AI prompts weren't providing useful reading assistance. Needed different types of help for different reading scenarios.

**Solution**:
- Split into two distinct functions:
  - **解释说明 (Explanation)**: Quick lookups for terms, people, events, concepts
  - **深入讨论 (Discussion)**: Academic analysis with theoretical frameworks and critical thinking
- Structured prompts with clear dimensions (论点解析, 理论视角, 批判思考, 启发问题)
- Removed context parameter from fact-check to keep it focused and fast

**Code**: `ai_service.py` - `fact_check()` and `discuss()` methods

## 7. Dark Mode Implementation

**Challenge**: Implementing comprehensive dark mode across all pages with proper contrast and readability.

**Solution**:
- Used CSS class toggle (`body.dark-mode`) instead of media queries for user control
- Defined dark mode colors for every UI element including highlights, progress bars, modals
- Persisted theme preference in localStorage
- Synchronized theme across all pages (library, reader, highlights)
- Used `!important` for highlight colors to override inline styles

**Code**: All template files - CSS dark mode sections

## 8. TOC Auto-Scroll to Active Item

**Challenge**: When opening a book mid-way through, the TOC sidebar didn't show the current chapter, requiring manual scrolling.

**Solution**:
- Calculate active TOC item position using `offsetTop`
- Scroll sidebar to center the active item in viewport
- Execute after DOM load to ensure elements are rendered

**Code**: `templates/reader.html` - TOC auto-scroll in DOMContentLoaded

## 9. Book Detection Without Naming Convention

**Challenge**: Initially required `_data` suffix in folder names, limiting flexibility and creating ugly folder names.

**Solution**:
- Changed detection from filename pattern matching to presence of `book.pkl` file
- Updated library scanning to check for file existence instead of name patterns
- Maintained backward compatibility with old `_data` folders

**Code**: `server.py` - `library_view()` function

## 10. Whitespace-Tolerant Text Matching

**Challenge**: Saved highlights couldn't be found when text spanned multiple paragraphs due to whitespace differences (newlines, multiple spaces).

**Solution**:
- Created regex pattern that replaces `\s+` in search text with `\s+` pattern
- Allows flexible matching of any whitespace sequence
- Escapes special regex characters in user text before pattern creation
- Falls back to exact match first for performance

**Code**: `templates/reader.html` - `findTextRange()` function

## 11. Mixed English/Chinese Library Sorting

**Challenge**: The library needed title-based navigation that felt natural for both English and Chinese books. A plain Unicode sort would scatter Chinese titles in a way that was hard to browse.

**Solution**:
- Normalized titles before sorting by stripping leading symbols and common English articles (`the`, `a`, `an`)
- Added pinyin transliteration for Chinese titles using `pypinyin`
- Derived a stable title-group key from the transliterated form so English and Chinese books share the same alphabet filter model
- Kept a fallback path when transliteration is unavailable so the library still renders safely

**Code**: `server.py` - `normalize_title_for_sort()`, `transliterate_for_sort()`, `title_group_key()`

## 12. Upload Processing Without Runtime `uv`

**Challenge**: Uploading books through the web UI failed in environments where the server was running correctly but the `uv` executable was not available in the request-time PATH.

**Solution**:
- Replaced the upload subprocess call from `uv run reader3.py ...` to `sys.executable reader3.py ...`
- Ensured uploaded books are processed by the exact same Python environment that is already running the FastAPI app
- Removed a brittle runtime dependency while keeping the normal CLI workflow intact

**Code**: `server.py` - `/upload` endpoint

## 13. Flat Library Navigation With Alphabet Filter

**Challenge**: Sectioned alphabetical grouping made the landing page feel heavier than necessary, but the library still needed faster navigation as the number of books grew.

**Solution**:
- Flattened the card grid back to a single list for simpler scanning
- Turned the alphabet bar into an active filter rather than a jump list
- Combined title-initial filtering with existing search and unfinished-only filtering in one client-side pass
- Moved less-frequently used controls into a collapsible settings panel to reduce clutter at the top of the page

**Code**: `templates/library.html` - alphabet filter UI and `filterBooks()`

---

## Key Technologies Used

- **FastAPI**: Async web framework with automatic API documentation
- **SQLite**: Lightweight database for highlights and progress
- **ebooklib**: EPUB parsing and extraction
- **BeautifulSoup**: HTML processing and cleaning
- **MathJax**: Mathematical equation rendering
- **Marked.js**: Markdown rendering for AI responses
- **Jinja2**: Server-side templating
- **Vanilla JavaScript**: No framework dependencies for frontend

## Architecture Decisions

1. **Server-side rendering** for initial page load (SEO-friendly, fast first paint)
2. **Client-side interactivity** for highlights and AI features (responsive UX)
3. **SQLite for data** (simple, portable, no separate database server)
4. **Pickle for book data** (fast serialization, preserves Python objects)
5. **localStorage for preferences** (theme, font settings persist across sessions)
6. **Event-driven progress saving** (reliable, doesn't interfere with reading)

## Performance Optimizations

- **LRU cache** for book loading (avoid repeated disk reads)
- **Lazy AI service initialization** (only load when needed)
- **Async/await** throughout (non-blocking I/O)
- **keepalive flag** on fetch requests (ensures completion on page unload)
- **Debounced scroll tracking** (via event listener, not polling)

---

*This document serves as a reference for understanding the technical depth and problem-solving approaches used in this project.*
