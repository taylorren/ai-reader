# AI Reader Chrome Extension

This extension adds two context-menu commands to the browser when you select text: `AI Reader: Fact-check` and `AI Reader: Discuss`.

What it does:
- Sends the selected text to the backend endpoint at `http://localhost:8000/api/ai/analyze`.
- Displays the AI response in a right-side chatbot panel on the current page.

Installation (developer / unpacked mode):

1. Start the ai-reader backend (e.g., `uvicorn server:app --reload --port 8000`).
2. In Chrome, go to `chrome://extensions/` and enable "Developer mode".
3. Click "Load unpacked" and select the `chrome_extension/` directory in this repo.
4. Visit any page, select some text, right-click and choose the AI Reader command.

Notes:
- The extension's background worker sends requests to `http://localhost:8000`. If your backend runs on a different port or host, update `background.js` `API_BASE` constant.
- The extension fetches in the background (service worker) so it doesn't rely on page CORS.
