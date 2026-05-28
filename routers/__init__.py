"""
Shared dependencies for all routers.
"""
import os
import pickle
import re
from functools import lru_cache
from itertools import groupby
from pathlib import Path
from typing import Optional
from urllib.parse import unquote

from bs4 import BeautifulSoup

from reader3 import Book

try:
    from pypinyin import lazy_pinyin
except ImportError:
    lazy_pinyin = None

# ---- Paths ----

BASE_DIR = Path(__file__).resolve().parent.parent
BOOKS_DIR = str(BASE_DIR / "books")

# ---- Regex helpers ----

LATIN_WORD_RE = re.compile(r"\b\w+\b", re.UNICODE)
CJK_CHAR_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
LEADING_SYMBOL_RE = re.compile(r"^[^0-9A-Za-z\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+")
LEADING_ARTICLE_RE = re.compile(r"^(the|a|an)\s+", re.IGNORECASE)

# ---- Lazy imports (avoid circular) ----

_lazy = {"db": None, "ai_service": None}


def get_db():
    """Lazily initialize and return the shared Database singleton."""
    if _lazy["db"] is None:
        from database import Database
        _lazy["db"] = Database()
    return _lazy["db"]


def get_ai_service():
    """Lazily initialize and return the shared AIService singleton."""
    if _lazy["ai_service"] is None:
        try:
            from ai_service import AIService
            _lazy["ai_service"] = AIService()
        except ValueError as e:
            print(f"Warning: {e}")
    return _lazy["ai_service"]


# Runtime settings
_runtime_settings = {
    "provider_override": None,
}


# ---- Book loading ----

class _BookUnpickler(pickle.Unpickler):
    """Custom unpickler that redirects __main__ references to the reader3 module.

    Pickle files were originally created by running ``reader3.py`` directly,
    which saves classes as ``__main__.Book`` etc. When loaded from the server
    process, we need to resolve these to ``reader3.Book``.
    """

    def find_class(self, module, name):
        if module == "__main__":
            import reader3 as _reader3
            return getattr(_reader3, name)
        return super().find_class(module, name)


@lru_cache(maxsize=10)
def load_book_cached(folder_name: str) -> Optional[Book]:
    """Loads the book from the pickle file. Cached for performance."""
    file_path = os.path.join(BOOKS_DIR, folder_name, "book.pkl")
    if not os.path.exists(file_path):
        return None
    try:
        with open(file_path, "rb") as f:
            return _BookUnpickler(f).load()
    except (
        OSError, pickle.UnpicklingError, EOFError, AttributeError,
        ImportError, ModuleNotFoundError, TypeError, ValueError,
    ) as e:
        print(f"Error loading book {folder_name}: {e}")
        return None


# ---- Asset versioning ----

def get_asset_version(*relative_paths: str) -> int:
    """Return a stable cache-busting token based on asset modification times."""
    mtimes = []
    for relative_path in relative_paths:
        asset_path = BASE_DIR / relative_path
        if asset_path.exists():
            mtimes.append(asset_path.stat().st_mtime_ns)
    return max(mtimes, default=0)


# ---- Word count ----

def estimate_book_word_count(book: Book) -> int:
    """Estimate word count from parsed chapter text."""
    total_latin_words = 0
    total_cjk_chars = 0
    for chapter in book.spine:
        chapter_text = chapter.text or ""
        total_latin_words += len(LATIN_WORD_RE.findall(chapter_text))
        total_cjk_chars += len(CJK_CHAR_RE.findall(chapter_text))
    return total_latin_words + round(total_cjk_chars / 2)


def format_word_count(word_count: int) -> str:
    """Format a raw word count into a human-readable string like '123,456 words'."""
    return f"{word_count:,} words"


def estimate_reading_time(word_count: int, wpm: int = 230) -> int:
    """Estimate reading time in minutes from a word count.

    Uses 230 words-per-minute for mixed Chinese/English reading,
    roughly the average across CJK and Latin scripts.
    """
    return max(1, round(word_count / wpm))


def format_reading_time(minutes: int) -> str:
    """Format reading time as a human-readable string like '~3h 15m' or '~45 min'."""
    if minutes >= 60:
        h = minutes // 60
        m = minutes % 60
        return f"~{h}h {m}m" if m else f"~{h}h"
    return f"~{minutes} min"


# ---- Title sorting ----

def normalize_title_for_sort(title: str) -> str:
    """Strip leading symbols and articles (The/A/An) from a title for sorting."""
    cleaned_title = LEADING_SYMBOL_RE.sub("", (title or "").strip())
    cleaned_title = LEADING_ARTICLE_RE.sub("", cleaned_title)
    return cleaned_title or (title or "").strip() or "#"


def transliterate_for_sort(text: str) -> str:
    """Transliterate Chinese characters to pinyin for Latin-based sorting.

    Falls back to the original title case-folded if pypinyin is unavailable.
    """
    normalized_title = normalize_title_for_sort(text)
    if lazy_pinyin:
        transliterated = "".join(lazy_pinyin(normalized_title))
        if transliterated:
            return transliterated.casefold()
    return normalized_title.casefold()


def title_group_key(title: str) -> str:
    """Return the first letter of the sort key, or '#' for non-alphabetic titles.

    Used to group books into A-Z sections in the library view.
    """
    sort_key = transliterate_for_sort(title)
    if sort_key:
        first_char = sort_key[0].upper()
        if first_char.isalpha():
            return first_char
    return "#"


def build_grouped_books(books: list[dict]) -> list[dict]:
    """Group books into alphabetical sections (A-Z, #) for the library view."""
    sorted_books = sorted(
        books,
        key=lambda book: (
            book["title_group"] == "#",
            book["title_group"],
            book["title_sort_key"],
            book["title"].casefold(),
        ),
    )
    grouped_books = []
    for group_key, items in groupby(sorted_books, key=lambda book: book["title_group"]):
        grouped_books.append({
            "key": group_key,
            "label": group_key,
            "books": list(items),
        })
    return grouped_books


# ---- Image path rewriting ----

def rewrite_chapter_image_paths(content: str, image_map: dict[str, str]) -> str:
    """Normalize chapter image references for HTML and inline SVG content."""
    if not content or not image_map:
        return content

    soup = BeautifulSoup(content, "html.parser")

    def resolve_image_path(raw_ref: str) -> Optional[str]:
        if not raw_ref:
            return None
        ref_without_query = raw_ref.split("?", 1)[0].split("#", 1)[0]
        ref_decoded = unquote(ref_without_query)
        filename = os.path.basename(ref_decoded)
        if ref_decoded in image_map:
            return image_map[ref_decoded]
        if filename in image_map:
            return image_map[filename]
        return None

    for img in soup.find_all("img"):
        resolved_path = resolve_image_path(img.get("src", ""))
        if resolved_path:
            img["src"] = resolved_path

    for svg_image in soup.find_all("image"):
        for attr_name in ("xlink:href", "href"):
            resolved_path = resolve_image_path(svg_image.get(attr_name, ""))
            if resolved_path:
                svg_image[attr_name] = resolved_path
                break

    return str(soup)
