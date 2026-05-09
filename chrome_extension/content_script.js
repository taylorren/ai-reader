// Content script: creates a right-side chat panel and listens for messages
(function () {
  const PANEL_ID = 'ai-reader-panel-v1';

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    // Create a fixed right-side sidebar panel
    panel = document.createElement('aside');
    panel.id = PANEL_ID;
    panel.className = 'ai-reader-panel';

    panel.innerHTML = `
      <div class="ai-reader-header">
        <div class="ai-reader-title-wrap">
          <span id="ai-reader-title">AI Reader</span>
        </div>
        <button id="ai-reader-close" title="Close">×</button>
      </div>
      <div id="ai-reader-body" class="ai-reader-body" role="region" aria-live="polite"></div>
      <div class="ai-reader-footer"><small>AI Reader Assistant</small></div>
    `;

    document.documentElement.appendChild(panel);

    // Close/hide the sidebar
    document.getElementById('ai-reader-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });

    return panel;
  }

  function showLoading(analysisType, selected) {
    const panel = ensurePanel();
    panel.style.display = 'block';
    const body = panel.querySelector('#ai-reader-body');
    body.innerHTML = `<div class="ai-reader-item ai-reader-loading">Requesting ${escapeHtml(analysisType)}...</div>`;
    panel.querySelector('#ai-reader-title').textContent = `AI Reader — ${analysisType.replace('_',' ')}`;
    // scroll to top for a new request
    body.scrollTop = 0;
  }

  function showResponse(analysisType, selected, response) {
    const panel = ensurePanel();
    panel.style.display = 'block';
    const body = panel.querySelector('#ai-reader-body');

    const headerHtml = `<div class="ai-reader-selected">Selected: <em>${escapeHtml(selected)}</em></div>`;
    const mdHtml = renderMarkdown(response || '');
    const respHtml = `<div class="ai-reader-item ai-reader-markdown">${mdHtml}</div>`;
    body.innerHTML = headerHtml + respHtml;
    panel.querySelector('#ai-reader-title').textContent = `AI Reader — ${analysisType.replace('_',' ')}`;
    // Scroll to bottom if content is long
    setTimeout(() => { body.scrollTop = body.scrollHeight; }, 50);
  }

  function showError(message) {
    const panel = ensurePanel();
    panel.style.display = 'block';
    const body = panel.querySelector('#ai-reader-body');
    body.innerHTML = `<div class="ai-reader-item ai-reader-error">Error: ${escapeHtml(message)}</div>`;
    panel.querySelector('#ai-reader-title').textContent = `AI Reader — error`;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // Minimal Markdown renderer: supports code fences, inline code, headings, bold, italics, links, lists
  function renderMarkdown(md) {
    if (!md) return '';
    // Escape first, then restore code blocks
    let text = md.replaceAll('\r\n', '\n');

    // Code fences
    text = text.replace(/```([\s\S]*?)```/g, (m, code) => {
      return '<pre><code>' + escapeHtml(code) + '</code></pre>';
    });

    // Inline code
    text = text.replace(/`([^`]+)`/g, (m, code) => '<code>' + escapeHtml(code) + '</code>');

    // Headings
    text = text.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
    text = text.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
    text = text.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
    text = text.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.*)$/gm, '<h1>$1</h1>');

    // Bold and italics
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Unordered lists
    // Convert lines starting with - or * into <li>
    if (/^[-*] /m.test(text)) {
      text = text.replace(/(^|\n)([-*] .+(?:\n[-*] .+)*)/g, (m, pre, block) => {
        const items = block.split(/\n/).map(l => '<li>' + l.replace(/^[-*] /, '') + '</li>').join('');
        return pre + '<ul>' + items + '</ul>';
      });
    }

    // Paragraphs: wrap remaining lines
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (!/^<(h[1-6]|ul|li|pre|code|a|strong|em)/.test(line)) {
        lines[i] = '<p>' + line + '</p>';
      }
    }
    text = lines.join('');

    return text;
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ping') {
      // Reply so background knows content script is present
      sendResponse({ pong: true });
      return;
    }
    if (msg.type === 'request_started') {
      const panel = ensurePanel();
      panel.style.display = 'block';
      const body = panel.querySelector('#ai-reader-body');
      const info = `<div class="ai-reader-item ai-reader-loading">Sending request to backend...</div>`;
      body.innerHTML = info;
      return;
    }
    if (msg.type === 'request_finished') {
      const panel = ensurePanel();
      const body = panel.querySelector('#ai-reader-body');
      const info = `<div class="ai-reader-item">Request finished (status: ${msg.status})</div>`;
      body.insertAdjacentHTML('beforeend', info);
      return;
    }
    if (msg.type === 'show_loading') {
      showLoading(msg.analysisType || 'analysis', msg.selected || '');
    } else if (msg.type === 'show_response') {
      showResponse(msg.analysisType || 'analysis', msg.selected || '', msg.response || '(no response)');
    } else if (msg.type === 'show_error') {
      showError(msg.message || 'Unknown error');
    }
  });

  // Create panel on load (hidden)
  try { ensurePanel(); document.getElementById(PANEL_ID).style.display = 'none'; } catch(e) {}

})();
