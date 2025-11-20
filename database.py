"""
Database models for storing highlights and AI interactions.
"""
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict


@dataclass
class Highlight:
    """User highlight with position info."""
    id: Optional[int] = None
    book_id: str = ""
    chapter_index: int = 0
    selected_text: str = ""
    context_before: str = ""
    context_after: str = ""
    created_at: str = ""


@dataclass
class AIAnalysis:
    """AI analysis result (fact-check or discussion)."""
    id: Optional[int] = None
    highlight_id: int = 0
    analysis_type: str = ""  # 'fact_check' or 'discussion'
    prompt: str = ""
    response: str = ""
    created_at: str = ""


class Database:
    """Simple SQLite database for storing highlights and AI analyses."""
    
    def __init__(self, db_path: str = "reader_data.db"):
        self.db_path = db_path
        self.init_db()
    
    def init_db(self):
        """Create tables if they don't exist."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS highlights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id TEXT NOT NULL,
                chapter_index INTEGER NOT NULL,
                selected_text TEXT NOT NULL,
                context_before TEXT,
                context_after TEXT,
                created_at TEXT NOT NULL
            )
        """)
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ai_analyses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                highlight_id INTEGER NOT NULL,
                analysis_type TEXT NOT NULL,
                prompt TEXT NOT NULL,
                response TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (highlight_id) REFERENCES highlights (id)
            )
        """)
        
        conn.commit()
        conn.close()
    
    def save_highlight(self, highlight: Highlight) -> int:
        """Save a highlight and return its ID."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO highlights (book_id, chapter_index, selected_text, 
                                   context_before, context_after, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            highlight.book_id,
            highlight.chapter_index,
            highlight.selected_text,
            highlight.context_before,
            highlight.context_after,
            highlight.created_at or datetime.now().isoformat()
        ))
        
        highlight_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return highlight_id
    
    def save_analysis(self, analysis: AIAnalysis) -> int:
        """Save an AI analysis and return its ID."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO ai_analyses (highlight_id, analysis_type, prompt, response, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            analysis.highlight_id,
            analysis.analysis_type,
            analysis.prompt,
            analysis.response,
            analysis.created_at or datetime.now().isoformat()
        ))
        
        analysis_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return analysis_id
    
    def get_highlights_for_chapter(self, book_id: str, chapter_index: int) -> List[Dict]:
        """Get all highlights for a specific chapter."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM highlights 
            WHERE book_id = ? AND chapter_index = ?
            ORDER BY created_at DESC
        """, (book_id, chapter_index))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def get_all_highlights_for_book(self, book_id: str) -> List[Dict]:
        """Get all highlights for a book (all chapters)."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM highlights 
            WHERE book_id = ?
            ORDER BY created_at DESC
        """, (book_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def get_analyses_for_highlight(self, highlight_id: int) -> List[Dict]:
        """Get all AI analyses for a highlight."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT * FROM ai_analyses 
            WHERE highlight_id = ?
            ORDER BY created_at DESC
        """, (highlight_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]

    def update_analysis(self, analysis_id: int, response: str):
        """Update an existing analysis response (for editing comments)."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            UPDATE ai_analyses 
            SET response = ?
            WHERE id = ?
        """, (response, analysis_id))
        
        conn.commit()
        conn.close()
    
    def delete_analysis(self, analysis_id: int):
        """Delete an analysis and its highlight if no other analyses exist."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get the highlight_id before deleting
        cursor.execute("SELECT highlight_id FROM ai_analyses WHERE id = ?", (analysis_id,))
        result = cursor.fetchone()
        
        if result:
            highlight_id = result[0]
            
            # Delete the analysis
            cursor.execute("DELETE FROM ai_analyses WHERE id = ?", (analysis_id,))
            
            # Check if there are other analyses for this highlight
            cursor.execute("SELECT COUNT(*) FROM ai_analyses WHERE highlight_id = ?", (highlight_id,))
            count = cursor.fetchone()[0]
            
            # If no other analyses, delete the highlight too
            if count == 0:
                cursor.execute("DELETE FROM highlights WHERE id = ?", (highlight_id,))
        
        conn.commit()
        conn.close()
