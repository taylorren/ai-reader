"""
Parses an EPUB file into a structured object that can be used to serve the book via a web interface.
"""

import os
import pickle
import shutil
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from datetime import datetime
from urllib.parse import unquote

import ebooklib
from ebooklib import epub
from bs4 import BeautifulSoup, Comment

# Patch ebooklib: _parse_nav crashes with IndexError when a NAV document
# exists but has no <nav epub:type="toc"> element (non-standard EPUBs).
# The page-list case already handles missing nodes gracefully; mirror that
# behaviour for the toc case.
_original_parse_nav = epub.EpubReader._parse_nav

def _patched_parse_nav(self, data, base_path, navtype="toc"):
    if navtype == "toc":
        from ebooklib.utils import parse_html_string
        html_node = parse_html_string(data)
        if not html_node.xpath("//nav[@*='toc']"):
            return
    _original_parse_nav(self, data, base_path, navtype)

epub.EpubReader._parse_nav = _patched_parse_nav

# --- Data structures ---

@dataclass
class ChapterContent:
    """
    Represents a physical file in the EPUB (Spine Item).
    A single file might contain multiple logical chapters (TOC entries).
    """
    id: str           # Internal ID (e.g., 'item_1')
    href: str         # Filename (e.g., 'part01.html')
    title: str        # Best guess title from file
    content: str      # Cleaned HTML with rewritten image paths
    text: str         # Plain text for search/LLM context
    order: int        # Linear reading order


@dataclass
class TOCEntry:
    """Represents a logical entry in the navigation sidebar."""
    title: str
    href: str         # original href (e.g., 'part01.html#chapter1')
    file_href: str    # just the filename (e.g., 'part01.html')
    anchor: str       # just the anchor (e.g., 'chapter1'), empty if none
    children: List['TOCEntry'] = field(default_factory=list)


@dataclass
class BookMetadata:
    """Metadata"""
    title: str
    language: str
    authors: List[str] = field(default_factory=list)
    description: Optional[str] = None
    publisher: Optional[str] = None
    date: Optional[str] = None
    identifiers: List[str] = field(default_factory=list)
    subjects: List[str] = field(default_factory=list)


@dataclass
class Book:
    """The Master Object to be pickled."""
    metadata: BookMetadata
    spine: List[ChapterContent]  # The actual content (linear files)
    toc: List[TOCEntry]          # The navigation tree
    images: Dict[str, str]       # Map: original_path -> local_path

    # Meta info
    source_file: str
    processed_at: str
    cover_image: Optional[str] = None  # Cover image filename


def rewrite_embedded_image_paths(soup: BeautifulSoup, image_map: Dict[str, str]) -> None:
    """Rewrite both HTML and SVG image references to extracted local paths."""

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

    for img in soup.find_all('img'):
        resolved_path = resolve_image_path(img.get('src', ''))
        if resolved_path:
            img['src'] = resolved_path

    for svg_image in soup.find_all('image'):
        for attr_name in ('xlink:href', 'href'):
            resolved_path = resolve_image_path(svg_image.get(attr_name, ''))
            if resolved_path:
                svg_image[attr_name] = resolved_path
                break
    version: str = "3.0"


# --- Utilities ---

def clean_html_content(soup: BeautifulSoup) -> BeautifulSoup:
    """Remove unsafe and irrelevant HTML tags/comments from parsed chapter content."""

    # Remove dangerous/useless tags
    for tag in soup(['script', 'style', 'iframe', 'video', 'nav', 'form', 'button']):
        tag.decompose()

    # Remove HTML comments
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()

    # Remove input tags
    for tag in soup.find_all('input'):
        tag.decompose()

    return soup


def extract_plain_text(soup: BeautifulSoup) -> str:
    """Extract clean text for LLM/Search usage."""
    text = soup.get_text(separator=' ')
    # Collapse whitespace
    return ' '.join(text.split())


def parse_toc_recursive(toc_list, depth=0) -> List[TOCEntry]:
    """Recursively parse ebooklib TOC structures into TOCEntry objects."""
    result = []

    for item in toc_list:
        # ebooklib TOC items are either `Link` objects or tuples (Section, [Children])
        if isinstance(item, tuple):
            section, children = item
            entry = TOCEntry(
                title=section.title,
                href=section.href,
                file_href=section.href.split('#')[0],
                anchor=section.href.split('#')[1] if '#' in section.href else "",
                children=parse_toc_recursive(children, depth + 1)
            )
            result.append(entry)
        elif isinstance(item, epub.Link):
            entry = TOCEntry(
                title=item.title,
                href=item.href,
                file_href=item.href.split('#')[0],
                anchor=item.href.split('#')[1] if '#' in item.href else ""
            )
            result.append(entry)
        # Note: ebooklib sometimes returns direct Section objects without children
        elif isinstance(item, epub.Section):
            entry = TOCEntry(
                title=item.title,
                href=item.href,
                file_href=item.href.split('#')[0],
                anchor=item.href.split('#')[1] if '#' in item.href else ""
            )
            result.append(entry)

    return result


def get_fallback_toc(epub_book) -> List[TOCEntry]:
    """Build a flat TOC from document items when the EPUB TOC is missing."""
    toc = []
    for item in epub_book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            name = item.get_name()
            # Try to guess a title from the content or ID.
            title = (
                item.get_name()
                .replace('.html', '')
                .replace('.xhtml', '')
                .replace('_', ' ')
                .title()
            )
            toc.append(TOCEntry(title=title, href=name, file_href=name, anchor=""))
    return toc


def extract_metadata_robust(epub_book) -> BookMetadata:
    """Extract metadata while handling both single and list-valued fields."""

    def get_list(key):
        data = epub_book.get_metadata('DC', key)
        return [x[0] for x in data] if data else []

    def get_one(key):
        data = epub_book.get_metadata('DC', key)
        return data[0][0] if data else None

    return BookMetadata(
        title=get_one('title') or "Untitled",
        language=get_one('language') or "en",
        authors=get_list('creator'),
        description=get_one('description'),
        publisher=get_one('publisher'),
        date=get_one('date'),
        identifiers=get_list('identifier'),
        subjects=get_list('subject')
    )


# --- Main Conversion Logic ---

def _check_drm(epub_path: str):
    """Raise an error early if the EPUB is DRM-protected."""
    import zipfile as _zf
    try:
        with _zf.ZipFile(epub_path) as z:
            if 'META-INF/encryption.xml' in z.namelist():
                enc = z.read('META-INF/encryption.xml').decode('utf-8', errors='replace')
                if 'adept' in enc.lower() or 'EncryptedData' in enc:
                    raise ValueError(
                        "This EPUB is protected by Adobe ADEPT DRM. "
                        "The content is encrypted and cannot be imported. "
                        "You need a DRM-free version of this file."
                    )
    except _zf.BadZipFile:
        pass  # Let ebooklib handle non-zip EPUBs


def process_epub(epub_path: str, output_dir: str) -> Book:
    """Convert an EPUB file into the project Book structure and extracted assets."""

    # 0. Fail fast if DRM-protected
    _check_drm(epub_path)

    # 1. Load Book
    print(f"Loading {epub_path}...")
    book = epub.read_epub(epub_path)

    # 2. Extract Metadata
    metadata = extract_metadata_robust(book)

    # 3. Prepare Output Directories
    if os.path.exists(output_dir):
        shutil.rmtree(output_dir)
    images_dir = os.path.join(output_dir, 'images')
    os.makedirs(images_dir, exist_ok=True)

    # 4. Extract Images & Build Map (including cover)
    print("Extracting images...")
    image_map = {} # Key: internal_path, Value: local_relative_path
    cover_image = None

    # Try to find cover image from metadata
    cover_item = None

    # Method 1: Check for ITEM_COVER type (most reliable)
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_COVER:
            cover_item = item
            print(f"✓ Found cover (type COVER): {item.get_name()}")
            break

    # Method 2: Look for images with 'cover' or 'cvi' in the name
    if not cover_item:
        for item in book.get_items():
            if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER):
                name_lower = item.get_name().lower()
                if 'cover' in name_lower or 'cvi' in name_lower:
                    cover_item = item
                    print(f"✓ Found cover (by name): {item.get_name()}")
                    break

    # Method 3: Use first large image as fallback (skip small icons/logos)
    if not cover_item:
        for item in book.get_items():
            if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER):
                # Skip very small images (likely icons)
                if len(item.get_content()) > 10000:  # > 10KB
                    cover_item = item
                    print(f"✓ Using first large image as cover: {item.get_name()}")
                    break

    saved_files = {}  # Track saved filenames to detect collisions

    for item in book.get_items():
        # Extract both ITEM_IMAGE and ITEM_COVER types
        if item.get_type() in (ebooklib.ITEM_IMAGE, ebooklib.ITEM_COVER):
            # Normalize filename
            original_fname = os.path.basename(item.get_name())
            # Sanitize filename for OS
            safe_fname = "".join(
                [c for c in original_fname if c.isalpha() or c.isdigit() or c in '._-']
            ).strip()

            # Handle filename collisions by adding a counter
            if safe_fname in saved_files:
                base, ext = os.path.splitext(safe_fname)
                collision_counter = 1
                while f"{base}_{collision_counter}{ext}" in saved_files:
                    collision_counter += 1
                safe_fname = f"{base}_{collision_counter}{ext}"
                print(f"Warning: Filename collision, renamed to {safe_fname}")

            # Save to disk
            local_path = os.path.join(images_dir, safe_fname)
            with open(local_path, 'wb') as f:
                f.write(item.get_content())

            saved_files[safe_fname] = item.get_name()

            # Map keys: We try both the full internal path and just the basename
            # to be robust against messy HTML src attributes
            rel_path = f"images/{safe_fname}"
            image_map[item.get_name()] = rel_path
            image_map[original_fname] = rel_path

            # Check if this is the cover image
            if cover_item and item.get_name() == cover_item.get_name():
                cover_image = safe_fname

    # 5. Process TOC
    print("Parsing Table of Contents...")
    toc_structure = parse_toc_recursive(book.toc)
    if not toc_structure:
        print("Warning: Empty TOC, building fallback from Spine...")
        toc_structure = get_fallback_toc(book)

    # 6. Process Content (Spine-based to preserve HTML validity)
    print("Processing chapters...")
    spine_chapters = []

    # We iterate over the spine (linear reading order)
    for i, spine_item in enumerate(book.spine):
        item_id, _linear = spine_item
        item = book.get_item_with_id(item_id)

        if not item:
            continue

        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            # Raw content — detect encoding from the HTML meta charset declaration,
            # falling back to UTF-8. This handles Big5/GB2312/etc. EPUBs correctly.
            raw_bytes = item.get_content()
            soup = BeautifulSoup(raw_bytes, 'html.parser')

            # A. Fix embedded image references in both HTML and SVG content.
            rewrite_embedded_image_paths(soup, image_map)

            # B. Clean HTML
            soup = clean_html_content(soup)

            # C. Extract Body Content only
            body = soup.find('body')
            if body:
                # Extract inner HTML of body
                final_html = "".join([str(x) for x in body.contents])
            else:
                final_html = str(soup)

            # D. Create Object
            chapter = ChapterContent(
                id=item_id,
                href=item.get_name(), # Important: This links TOC to Content
                title=f"Section {i+1}", # Fallback, real titles come from TOC
                content=final_html,
                text=extract_plain_text(soup),
                order=i
            )
            spine_chapters.append(chapter)

    # 7. Final Assembly
    final_book = Book(
        metadata=metadata,
        spine=spine_chapters,
        toc=toc_structure,
        images=image_map,
        source_file=os.path.basename(epub_path),
        processed_at=datetime.now().isoformat(),
        cover_image=cover_image
    )

    return final_book


def save_to_pickle(book: Book, output_dir: str):
    """Serialize the processed Book object to a pickle file."""
    p_path = os.path.join(output_dir, 'book.pkl')
    with open(p_path, 'wb') as f:
        pickle.dump(book, f)
    print(f"Saved structured data to {p_path}")


# --- CLI ---

def sanitize_folder_name(name: str) -> str:
    """Sanitize folder names while preserving Unicode characters where possible."""
    # Characters not allowed in Windows filenames
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, '_')

    # Remove leading/trailing spaces and dots
    name = name.strip('. ')

    # Limit length to avoid path issues (Windows has 260 char limit)
    if len(name) > 100:
        name = name[:100]

    return name


if __name__ == "__main__":

    import sys
    if len(sys.argv) < 2:
        print("Usage: python reader3.py <file.epub>")
        sys.exit(1)

    epub_file = sys.argv[1]
    assert os.path.exists(epub_file), "File not found."

    # Fail fast if DRM-protected
    _check_drm(epub_file)

    # Create books directory if it doesn't exist
    BOOKS_DIR = "books"
    os.makedirs(BOOKS_DIR, exist_ok=True)

    # First, do a quick metadata extraction to get the real title
    print(f"Reading metadata from {epub_file}...")
    temp_book = epub.read_epub(epub_file)
    temp_metadata = extract_metadata_robust(temp_book)

    # Use the actual book title for folder name (supports Chinese!)
    book_title = temp_metadata.title or os.path.splitext(os.path.basename(epub_file))[0]
    safe_title = sanitize_folder_name(book_title)
    out_dir = os.path.join(BOOKS_DIR, safe_title)

    # If folder exists, add a number suffix
    if os.path.exists(out_dir):
        dir_counter = 1
        while os.path.exists(f"{out_dir}_{dir_counter}"):
            dir_counter += 1
        out_dir = f"{out_dir}_{dir_counter}"

    print(f"Output directory: {out_dir}")

    book_obj = process_epub(epub_file, out_dir)
    save_to_pickle(book_obj, out_dir)

    # Use safe printing to avoid Unicode errors on Windows
    try:
        print("\n--- Summary ---")
        print(f"Title: {book_obj.metadata.title}")
        print(f"Authors: {', '.join(book_obj.metadata.authors)}")
        print(f"Physical Files (Spine): {len(book_obj.spine)}")
        print(f"TOC Root Items: {len(book_obj.toc)}")
        print(f"Images extracted: {len(book_obj.images)}")
        print(f"\nBook data saved to: {out_dir}")
    except UnicodeEncodeError:
        # Fallback for Windows console encoding issues
        print("\n--- Summary ---")
        print("Title: [Unicode title]")
        print("Authors: [Unicode authors]")
        print(f"Physical Files (Spine): {len(book_obj.spine)}")
        print(f"TOC Root Items: {len(book_obj.toc)}")
        print(f"Images extracted: {len(book_obj.images)}")
        print(f"\nBook data saved to: {out_dir}")
