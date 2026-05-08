# Reader3 - EPUB Reader with AI Analysis

A lightweight, self-hosted EPUB reader with integrated AI analysis capabilities.

## Features

### Reading Experience
- 📚 **Clean Layout** - Three-column design (TOC, Content, AI Panel)
- 📖 **Sticky Navigation** - Top navigation bar stays visible while scrolling
- ⌨️ **Keyboard Shortcuts** - Arrow keys for prev/next chapter, ESC to close panels
- 🔗 **Internal Links** - Footnotes and author comments open in modal popups
- 🎯 **Clickable Covers** - Click book covers to start reading instantly

### AI & Annotations
- 🤖 **AI Analysis** - Right-click on text for fact-checking or discussion (Ollama local or Cloud)
- � ***Personal Comments** - Add your own notes without AI (no API cost)
- 💾 **Manual Save** - Choose what to save to avoid clutter
- ✨ **Color-Coded Highlights** - Yellow (fact check), Blue (discussion), Green (comments)
- 🏷️ **Smart Tooltips** - Hover over highlights to see type
- 🗑️ **Edit & Delete** - Manage all your highlights and comments
- 🎨 **Markdown Support** - AI responses render with proper formatting

### Library & Organization
- 📝 **Highlights View** - See all your notes and analyses for each book
- 📤 **Export to Markdown** - Export highlights with AI context warnings
- 🌐 **Web Upload** - Upload EPUB files via click or drag & drop
- 🖼️ **Cover Images** - Automatic cover extraction and display
- 🔍 **Search & Filters** - Search by title/author, filter by title initial, or show unfinished books only
- ✅ **Completion Tracking** - Mark books complete and keep completed titles visually distinct
- 🔤 **Mixed-Language Sorting** - English titles sort alphabetically, Chinese titles sort by pinyin initials
- 📏 **Estimated Word Count** - Each book card shows a quick reading-length estimate
- ⚙️ **Compact Library Settings** - AI provider and view controls are tucked into a collapsible settings panel
- 🗂️ **Organized Storage** - All books in `books/` directory, data in SQLite

## Quick Start

### 1. Configure Ollama

Edit `.env` file:
```bash
# Ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
OLLAMA_MODEL=llama3
OLLAMA_CLOUD_MODEL=gpt-oss:120b-cloud
```

Then sign your Ollama daemon into Ollama Cloud once:

```bash
ollama signin
```

### 2. Add Books

**Option A: Upload via Web Interface (Recommended)**
1. Start server: `uv run server.py`
2. Open http://127.0.0.1:8123
3. Click the "+" card OR drag & drop EPUB file
4. Wait for automatic processing

The upload path processes EPUBs with the same Python interpreter running the server, so adding books does not depend on a separate `uv` executable being available at request time.

**Option B: Command Line**
```bash
uv run reader3.py your_book.epub
```

### 3. Start Server

```bash
uv run server.py
```

The server listens on `0.0.0.0:8123` by default so other devices on your LAN can reach it.
You can override that with:

```bash
READER_HOST=0.0.0.0 READER_PORT=8123 uv run server.py
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
- **Yellow** - Fact checks
- **Blue** - Discussions
- **Green** - Your comments
- Hover to see type, click to view/edit
- All highlights are editable and deletable

### View & Export Highlights
- Click ⋮ menu on any book → "View Highlights"
- See all your notes and analyses in one page
- Filter by type (Fact Check, Discussion, Comment)
- Export to markdown for AI processing
- Context length warnings for large exports
- Jump directly to any chapter

### Library Browsing
- Use the alphabet bar under the search field to filter the grid by title initial
- The title filter uses pinyin initials for Chinese books, so `三体` appears under `S`
- Open `Settings` to switch AI Provider or toggle between all books and unfinished books
- Use the ⋮ menu on a book card to mark it complete or incomplete
- Completed books keep a green progress indicator and a dimmed cover treatment

### Keyboard Shortcuts
- **← →** - Navigate between chapters
- **ESC** - Close panels and modals
- Works anywhere except when typing in text fields

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
- Click ⋮ menu on any book → "View Highlights"
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

## Why Ollama Cloud?

- ✅ Uses the same Ollama workflow as local models
- ✅ Lets you use larger hosted models without a local GPU
- ✅ Keeps one provider for both local and cloud modes
- ✅ Works through Ollama's OpenAI-compatible endpoint

## Troubleshooting

### API Key Error
1. Check `.env` file exists and has correct key
2. Restart server

### No Highlights Showing
1. Check browser console (F12) for errors
2. Verify data exists: `uv run check_database.py`
3. Hard refresh (Ctrl+Shift+R)

### Upload Says A Tool Is Missing
Recent versions process uploads with the server's active Python interpreter. If uploads still fail after pulling changes, restart the server or systemd service so it picks up the new upload path.

### Server Won't Start
1. Check if port 8123 is available
2. Verify `.env` configuration

## Run At Startup On Linux

This repo includes a systemd unit template and installer so the app can start on boot.
The installed service runs the app with `uv run server.py`, matching the normal development command.

### 1. Install dependencies

```bash
uv sync
```

### 2. Install the systemd service

```bash
sudo ./scripts/install-systemd-service.sh
```

This installs [deploy/reader3.service](/home/tr/projects/ai-reader/deploy/reader3.service), enables it, and starts it immediately.

### 3. Check service status

```bash
systemctl status reader3.service
```

### 4. Open the port on the machine firewall if needed

If you use UFW:

```bash
sudo ufw allow 8123/tcp
```

Then browse to `http://<your-linux-machine-ip>:8123` from another device on your home network.

### 5. Find the machine IP

```bash
hostname -I
```

## License

MIT

---

**Note**: This project is designed to be simple and hackable. Ask your LLM to modify it however you like!
