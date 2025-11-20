# Reader3 - EPUB Reader with AI Analysis

A lightweight, self-hosted EPUB reader with integrated AI analysis capabilities.

## Features

- 📚 **EPUB Reading** - Clean three-column layout (TOC, Content, AI Panel)
- 🤖 **AI Analysis** - Right-click on text for fact-checking or discussion (DeepSeek)
- � **Paersonal Comments** - Add your own notes without AI (no API cost)
- 💾 **Manual Save** - Choose what to save to avoid clutter
- ✨ **Visual Highlights** - Saved analyses automatically highlighted with icons (📋 💡 💬)
- 📝 **Highlights View** - See all your notes and analyses for each book in one page
- 🎨 **Markdown Support** - AI responses render with proper formatting
- 🗂️ **Organized Storage** - All books in `books/` directory, data in SQLite
- 🌐 **Web Upload** - Upload EPUB files directly from browser
- 🖼️ **Cover Images** - Automatic cover extraction and display

## Quick Start

### 1. Configure API Key

Edit `.env` file:
```bash
OPENAI_API_KEY=your_deepseek_key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-chat
```

Get your key from: https://platform.deepseek.com/api_keys

### 2. Add Books

**Option A: Upload via Web Interface (Easiest)**
1. Start server: `uv run server.py`
2. Open http://127.0.0.1:8123
3. Click the "+" card
4. Select EPUB file
5. Wait for automatic processing

**Option B: Command Line**
```bash
uv run reader3.py your_book.epub
```

### 3. Start Server

```bash
uv run server.py
```

### 4. Read and Analyze

1. Open http://127.0.0.1:8123
2. Select a book
3. Right-click on text → Choose analysis type
4. Review AI response in side panel
5. Save if important
6. Highlights appear on next visit!

## Usage

### AI Analysis
- Select text → Right-click → Choose:
  - **📋 Fact Check** - Verify facts and get context
  - **💡 Discussion** - Deep analysis and insights
  - **💬 Add Comment** - Your personal notes (no AI)
- View response in right panel
- Click "Save" for important insights

### Highlights
- **Yellow highlights** (📋 💡) - AI analyses
- **Green highlights** (💬) - Your comments
- Click any highlight to view/edit
- Comments are editable and deletable

### View All Highlights
- Click ⋮ menu on any book → "📝 View Highlights"
- See all your notes and analyses in one page
- Filter by type (Fact Check, Discussion, Comment)
- Jump directly to any chapter

## Project Structure

```
reader3/
├── reader3.py          # EPUB processor
├── server.py           # Web server
├── database.py         # SQLite operations
├── ai_service.py       # AI integration
├── books/              # All book data here
│   └── book_name_data/
│       ├── book.pkl
│       └── images/
├── templates/          # HTML templates
├── reader_data.db      # SQLite database
└── .env                # API configuration
```

## Data Management

### View Your Highlights
- Click ⋮ menu on any book → "📝 View Highlights"
- See all notes, comments, and analyses in one page
- Filter by type and jump to chapters

### View Database (Advanced)
```bash
uv run check_database.py
```

### Backup
```bash
# Double-click: backup.bat
# Or manually:
copy reader_data.db backups\reader_data_backup.db
```

## Tools

- `check_database.py` - View raw database contents (advanced)
- `backup.bat` - Quick database backup

## Why DeepSeek?

- ✅ Cost-effective (¥1/M tokens input, ¥2/M output)
- ✅ Excellent Chinese language support
- ✅ Fast response in China
- ✅ OpenAI-compatible API

## Troubleshooting

### API Key Error
1. Check `.env` file exists and has correct key
2. Run `uv run test_env.py` to verify
3. Restart server

### No Highlights Showing
1. Check browser console (F12) for errors
2. Verify data exists: `uv run check_database.py`
3. Refresh page

### Server Won't Start
1. Check if port 8123 is available
2. Verify `.env` configuration
3. Run `uv run debug_server.py` for details



## License

MIT

---

**Note**: This project is designed to be simple and hackable. Ask your LLM to modify it however you like!
