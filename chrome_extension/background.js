// Background service worker: create context menu items and call backend
// Default API base — keep in sync with `manifest.json` host_permissions
const API_BASE = 'http://localhost:8123';

function createContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      // ignore errors
      chrome.contextMenus.create({
        id: 'fact_check',
        title: 'Fact-check',
        contexts: ['selection']
      });

      chrome.contextMenus.create({
        id: 'discuss',
        title: 'Discuss',
        contexts: ['selection']
      });
    });
  } catch (e) {
    console.error('Failed to create context menus', e);
  }
}

// Ensure menus are created when the service worker starts
createContextMenus();

chrome.runtime.onInstalled.addListener(() => createContextMenus());
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => createContextMenus());

async function ensureContentScriptInjected(tabId) {
  return new Promise((resolve, reject) => {
    // Try sending a ping message to see if content script is present
    chrome.tabs.sendMessage(tabId, { type: 'ping' }, (resp) => {
      const err = chrome.runtime.lastError;
      if (!err && resp && resp.pong) return resolve(true);

      // Not present — inject content script and css
      chrome.scripting.executeScript(
        { target: { tabId }, files: ['content_script.js'] },
        () => {
          const cssErr = chrome.runtime.lastError;
          // inject CSS too (best-effort)
          chrome.scripting.insertCSS({ target: { tabId }, files: ['style.css'] }, () => {
            // ignore errors
            const err2 = chrome.runtime.lastError;
            if (cssErr || err2) {
              console.warn('Injected content script but got css/script error', cssErr || err2);
            }
            resolve(true);
          });
        }
      );
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.selectionText || !tab || !tab.id) return;

  const selected = info.selectionText.trim();
  const analysisType = info.menuItemId === 'fact_check' ? 'fact_check' : 'discussion';

  try {
    // Ensure content script exists in the tab so messages are received
    await ensureContentScriptInjected(tab.id);

    // Tell the content script to show a loading panel
    chrome.tabs.sendMessage(tab.id, {
      type: 'show_loading',
      analysisType,
      selected
    }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('show_loading sendMessage error:', chrome.runtime.lastError.message);
      }
    });

    // Notify content script that request is starting (helps debugging)
    chrome.tabs.sendMessage(tab.id, { type: 'request_started', analysisType, selected }, () => {});

    console.log('AI Reader: calling backend', `${API_BASE}/api/ai/analyze`);

    const resp = await fetch(`${API_BASE}/api/ai/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        highlight_id: -1,
        analysis_type: analysisType,
        selected_text: selected,
        context: ''
      })
    });

    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`Backend error: ${resp.status} ${txt}`);
    }

    const data = await resp.json();

    // Notify content script that request finished
    chrome.tabs.sendMessage(tab.id, { type: 'request_finished', status: resp.status }, () => {});

    chrome.tabs.sendMessage(tab.id, {
      type: 'show_response',
      analysisType,
      selected,
      response: data.response || data.result || JSON.stringify(data)
    }, (r) => {
      if (chrome.runtime.lastError) {
        console.warn('show_response sendMessage error:', chrome.runtime.lastError.message);
      }
    });

  } catch (err) {
    console.error('AI analyze error', err);
    chrome.tabs.sendMessage(tab.id, {
      type: 'show_error',
      message: err.message || String(err)
    }, (r) => {
      if (chrome.runtime.lastError) {
        // If we can't message the tab at all, show a notification as fallback
        console.warn('Failed to send error to content script:', chrome.runtime.lastError.message);
        try {
          chrome.notifications && chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'AI Reader',
            message: err.message || String(err)
          });
        } catch (e) {}
      }
    });
  }
});
