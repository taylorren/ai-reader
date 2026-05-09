        // Configure marked for safe rendering
        marked.setOptions({
            breaks: true,
            gfm: true
        });
        
        const readerDataEl = document.getElementById('reader-data');

        // TOC Navigation
        let spineMap = {};
        try {
            spineMap = JSON.parse((readerDataEl && readerDataEl.dataset.spineMap) || '{}');
        } catch (error) {
            console.warn('Failed to parse spine map:', error);
        }

        function findAndGo(filename) {
            const cleanFile = filename.split('#')[0];
            const idx = spineMap[cleanFile];
            if (idx !== undefined) {
                window.location.href = "/read/" + BOOK_ID + "/" + idx;
            }
        }

        function escapeSelectorFragment(value) {
            if (window.CSS && typeof window.CSS.escape === 'function') {
                return window.CSS.escape(value);
            }

            return value.replace(/([ !\"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
        }

        function scrollModalToHash(modalBody, hash) {
            const scrollContainer = modalBody.closest('.modal-content') || modalBody;

            if (!hash) {
                scrollContainer.scrollTop = 0;
                return;
            }

            const rawId = decodeURIComponent(hash.replace(/^#/, ''));
            if (!rawId) {
                scrollContainer.scrollTop = 0;
                return;
            }

            const escapedId = escapeSelectorFragment(rawId);
            const target = modalBody.querySelector(`#${escapedId}, a[name="${escapedId}"]`);

            if (target) {
                target.scrollIntoView({ block: 'start', behavior: 'auto' });
                return;
            }

            scrollContainer.scrollTop = 0;
        }

        // AI Feature Variables
        const BOOK_ID = (readerDataEl && readerDataEl.dataset.bookId) || '';
        const CHAPTER_INDEX = Number((readerDataEl && readerDataEl.dataset.chapterIndex) || 0);
        const SAVED_SCROLL = Number((readerDataEl && readerDataEl.dataset.savedScroll) || 0);
        const TARGET_HIGHLIGHT_ID = (readerDataEl && readerDataEl.dataset.targetHighlightId) || '';
        let selectedText = "";
        let selectedContext = "";
        let currentHighlightId = null;
        let currentAnalysisId = null;
        let currentAnalysisType = "";
        let currentRawAnalysisResponse = "";
        let savedHighlights = []; // Store saved highlights for this chapter
        let serverProviderOverride = null; // Server-side override from /api/settings
        let serverDefaultProvider = 'ollama_cloud'; // Server's default provider

        function normalizeSavedAnalysisContent(text) {
            if (!text) {
                return '';
            }

            return text.replace(/^(Using:\s*(?:🏠 Local|☁️ Cloud))(?=\S)/m, '$1\n\n');
        }

        function getAISettings() {
            const mode = localStorage.getItem('ai-mode');

            // Fallback/migration from old key.
            const provider = mode
                ? (mode === 'remote' ? 'ollama_cloud' : 'ollama')
                : (localStorage.getItem('ai-provider') || serverDefaultProvider);

            // Use server override if set, otherwise use local choice
            const effectiveProvider = serverProviderOverride || provider;

            return {
                provider: effectiveProvider,
                mode: mode || (effectiveProvider === 'ollama_cloud' || effectiveProvider === 'deepseek' ? 'remote' : 'local'),
                serverOverride: serverProviderOverride
            };
        }

        // Initialize provider UI and load server settings
        async function initializeProviderUI() {
            try {
                const response = await fetch('/api/settings');
                const data = await response.json();
                serverProviderOverride = data.provider_override;
                serverDefaultProvider = data.default_provider || 'ollama_cloud';
                console.log('Server settings loaded:', { override: serverProviderOverride, default: serverDefaultProvider });
                updateProviderUI();
            } catch (error) {
                console.error('Failed to load server settings:', error);
            }
        }

        // Update provider UI buttons to show current state
        function updateProviderUI() {
            const settings = getAISettings();
            const currentProvider = settings.provider;
            
            console.log('Updating provider UI with:', { currentProvider, serverOverride: serverProviderOverride });
            
            // Update toggle state (cloud = right/active, local = left/inactive)
            const toggle = document.getElementById('provider-toggle');
            if (toggle) {
                if (currentProvider === 'ollama_cloud') {
                    toggle.classList.add('active');
                    console.log('Toggle set to ACTIVE (Cloud)');
                } else {
                    toggle.classList.remove('active');
                    console.log('Toggle set to INACTIVE (Local)');
                }
            } else {
                console.warn('Toggle element not found!');
            }
        }

        // Toggle AI provider (local or cloud)
        async function toggleAIProvider() {
            console.log('toggleAIProvider called');
            const settings = getAISettings();
            const newProvider = settings.provider === 'ollama' ? 'ollama_cloud' : 'ollama';
            
            console.log('Current provider:', settings.provider, '-> New provider:', newProvider);
            
            try {
                // Update server settings with override
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider_override: newProvider })
                });
                
                const data = await response.json();
                console.log('Server response:', data);
                serverProviderOverride = data.provider_override;
                updateProviderUI();
                console.log('Provider switched to:', newProvider);
            } catch (error) {
                console.error('Failed to toggle AI provider:', error);
            }
        }

        // Set AI provider (local or cloud)
        async function setAIProvider(provider) {
            try {
                // Update server settings with override
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider_override: provider })
                });
                
                const data = await response.json();
                serverProviderOverride = data.provider_override;
                updateProviderUI();
                console.log('Provider switched to:', provider);
            } catch (error) {
                console.error('Failed to set AI provider:', error);
            }
        }

        // Load saved highlights when page loads
        async function loadSavedHighlights() {
            try {
                const response = await fetch(`/api/highlights/${BOOK_ID}/${CHAPTER_INDEX}`);
                const data = await response.json();
                savedHighlights = data.highlights || [];
                
                console.log(`Loaded ${savedHighlights.length} highlights for chapter ${CHAPTER_INDEX}`);
                
                // Apply highlights to the content
                applyHighlights();

                if (TARGET_HIGHLIGHT_ID) {
                    scrollToTargetHighlight();
                }
            } catch (error) {
                console.error('Error loading highlights:', error);
            }
        }

        function scrollToTargetHighlight() {
            const target = document.querySelector(`[data-highlight-id="${TARGET_HIGHLIGHT_ID}"]`);
            if (!target) {
                return;
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Apply highlights using Range-based approach (industry standard)
        // This is how tools like Hypothesis, Medium, and Google Docs do it
        function applyHighlights() {
            const bookContent = document.getElementById('book-content');
            
            // Clear existing highlights first and normalize text nodes
            const existingHighlights = bookContent.querySelectorAll('.saved-highlight');
            existingHighlights.forEach(span => {
                const parent = span.parentNode;
                while (span.firstChild) {
                    parent.insertBefore(span.firstChild, span);
                }
                parent.removeChild(span);
            });
            
            // Normalize text nodes to merge adjacent text nodes
            bookContent.normalize();
            
            if (savedHighlights.length === 0) return;
            
            // Find all text ranges first, then wrap them
            const ranges = [];
            
            savedHighlights.forEach((highlight) => {
                const text = highlight.selected_text;
                const analysisType = highlight.analyses && highlight.analyses.length > 0 
                    ? highlight.analyses[0].analysis_type 
                    : '';
                
                const range = findTextRange(bookContent, text);
                if (range) {
                    ranges.push({
                        range: range,
                        highlight: highlight,
                        analysisType: analysisType
                    });
                } else {
                    console.warn('Could not find text for highlight:', text.substring(0, 50) + '...');
                }
            });
            
            // Sort ranges by start position (latest first) to avoid position shifts
            ranges.sort((a, b) => {
                return b.range.compareBoundaryPoints(Range.START_TO_START, a.range);
            });
            
            // Apply highlights by marking affected elements
            ranges.forEach((item) => {
                try {
                    const range = item.range;
                    const commonAncestor = range.commonAncestorContainer;
                    
                    // Get all elements within the range
                    const walker = document.createTreeWalker(
                        commonAncestor.nodeType === Node.ELEMENT_NODE ? commonAncestor : commonAncestor.parentElement,
                        NodeFilter.SHOW_ELEMENT,
                        {
                            acceptNode: function(node) {
                                const nodeRange = document.createRange();
                                nodeRange.selectNodeContents(node);
                                
                                // Check if this node intersects with our highlight range
                                if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
                                    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0) {
                                    return NodeFilter.FILTER_ACCEPT;
                                }
                                return NodeFilter.FILTER_SKIP;
                            }
                        }
                    );
                    
                    const elements = [];
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.tagName === 'P' || node.tagName === 'DIV') {
                            elements.push(node);
                        }
                    }
                    
                    // If no block elements found, try to wrap inline
                    if (elements.length === 0) {
                        const span = document.createElement('span');
                        span.className = 'saved-highlight';
                        span.setAttribute('data-highlight-id', item.highlight.id);
                        span.setAttribute('data-analysis-type', item.analysisType);
                        span.title = '📋 Click to view';
                        span.onclick = () => showSavedAnalysis(item.highlight);
                        
                        try {
                            range.surroundContents(span);
                        } catch (e) {
                            const contents = range.extractContents();
                            span.appendChild(contents);
                            range.insertNode(span);
                        }
                    } else {
                        // Mark each paragraph with highlight data
                        elements.forEach(el => {
                            el.classList.add('saved-highlight');
                            el.setAttribute('data-highlight-id', item.highlight.id);
                            el.setAttribute('data-analysis-type', item.analysisType);
                            el.style.cursor = 'pointer';
                            el.onclick = () => showSavedAnalysis(item.highlight);
                            
                            const tooltips = {
                                'fact_check': '📋 解释说明 - 点击查看',
                                'discussion': '💡 深入讨论 - 点击查看',
                                'comment': '💬 个人笔记 - 点击查看/编辑'
                            };
                            el.title = tooltips[item.analysisType] || 'Click to view';
                        });
                    }
                } catch (e) {
                    console.error(`Failed to apply highlight ${item.highlight.id}:`, e);
                }
            });
        }
        
        // Find text range in element with whitespace-tolerant matching
        function findTextRange(element, searchText) {
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            let node;
            let fullText = '';
            const nodes = [];
            
            // Build a map of text nodes
            while (node = walker.nextNode()) {
                nodes.push({
                    node: node,
                    start: fullText.length,
                    end: fullText.length + node.textContent.length
                });
                fullText += node.textContent;
            }
            
            // Try exact match first
            let searchIndex = fullText.indexOf(searchText);
            let searchLength = searchText.length;
            
            // If no exact match, try with normalized whitespace
            if (searchIndex === -1) {
                // Create regex that allows flexible whitespace
                const pattern = searchText
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
                    .replace(/\s+/g, '\\s+'); // Allow any whitespace
                
                const regex = new RegExp(pattern);
                const match = fullText.match(regex);
                
                if (!match) {
                    return null;
                }
                
                searchIndex = match.index;
                searchLength = match[0].length;
            }
            
            const searchEnd = searchIndex + searchLength;
            
            // Find which text nodes contain the search text
            let startNode = null, startOffset = 0;
            let endNode = null, endOffset = 0;
            
            for (const item of nodes) {
                if (searchIndex >= item.start && searchIndex < item.end) {
                    startNode = item.node;
                    startOffset = searchIndex - item.start;
                }
                if (searchEnd > item.start && searchEnd <= item.end) {
                    endNode = item.node;
                    endOffset = searchEnd - item.start;
                }
                if (startNode && endNode) break;
            }
            
            if (!startNode || !endNode) {
                return null;
            }
            
            // Create range
            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            
            return range;
        }

        // Show saved analysis when clicking on a highlight
        function showSavedAnalysis(highlight) {
            openPanel();
            currentHighlightId = highlight.id;
            currentAnalysisId = highlight.analyses && highlight.analyses.length > 0
                ? highlight.analyses[0].id
                : null;
            selectedText = highlight.selected_text;
            
            // Update panel content
            document.getElementById('panel-selected-text').textContent = highlight.selected_text;
            
            if (highlight.analyses && highlight.analyses.length > 0) {
                const analysis = highlight.analyses[0];
                
                // Check if it's a comment
                if (analysis.analysis_type === 'comment') {
                    // Show comment view with edit capability
                    document.getElementById('panel-title').textContent = '💬 我的笔记';
                    document.getElementById('analysis-box').style.display = 'none';
                    document.getElementById('comment-input-area').style.display = 'block';
                    document.getElementById('comment-textarea').value = analysis.response;
                    
                    // Show edit/delete buttons
                    document.getElementById('panel-actions').style.display = 'none';
                    document.getElementById('comment-actions').style.display = 'flex';
                    document.getElementById('save-comment-btn').style.display = 'none';
                    document.getElementById('update-comment-btn').style.display = 'inline-block';
                    document.getElementById('delete-comment-btn').style.display = 'inline-block';
                    
                    currentAnalysisType = 'comment';
                    
                } else {
                    // Show AI analysis (fact_check or discussion)
                    document.getElementById('panel-title').textContent = '📚 已保存的分析';
                    document.getElementById('analysis-box').style.display = 'block';
                    document.getElementById('comment-input-area').style.display = 'none';
                    document.getElementById('panel-analysis-type').textContent = 
                        analysis.analysis_type === 'fact_check' ? '解释说明' : '深入讨论';
                    // Render markdown for AI responses
                    document.getElementById('panel-analysis-content').innerHTML = marked.parse(
                        normalizeSavedAnalysisContent(analysis.response)
                    );
                    
                    // Hide save button and show saved indicator
                    document.getElementById('panel-actions').style.display = 'flex';
                    document.getElementById('comment-actions').style.display = 'none';
                    document.getElementById('save-btn').style.display = 'none';
                    document.getElementById('delete-highlight-btn').style.display = 'inline-block';
                    document.getElementById('saved-indicator').classList.add('show');
                }
            } else {
                document.getElementById('panel-title').textContent = '📚 已保存的分析';
                document.getElementById('analysis-box').style.display = 'block';
                document.getElementById('comment-input-area').style.display = 'none';
                document.getElementById('panel-analysis-content').textContent = '暂无AI分析';
                document.getElementById('panel-actions').style.display = 'flex';
                document.getElementById('comment-actions').style.display = 'none';
                document.getElementById('save-btn').style.display = 'none';
                document.getElementById('delete-highlight-btn').style.display = 'inline-block';
                document.getElementById('saved-indicator').classList.add('show');
            }
        }

        // Load highlights and restore scroll position when page loads
        window.addEventListener('DOMContentLoaded', function() {
            initializeProviderUI();  // Load server settings
            loadSavedHighlights();
            
            // Restore scroll position
            const savedScroll = SAVED_SCROLL;
            if (!TARGET_HIGHLIGHT_ID && savedScroll > 0) {
                // Try multiple times to ensure content is loaded
                const mainElement = document.getElementById('main');
                let attempts = 0;
                const restoreScroll = () => {
                    mainElement.scrollTop = savedScroll;
                    currentScrollPosition = savedScroll;
                    
                    // Verify it worked, retry if needed
                    if (mainElement.scrollTop < savedScroll - 10 && attempts < 5) {
                        attempts++;
                        setTimeout(restoreScroll, 200);
                    }
                };
                setTimeout(restoreScroll, 100);
            }
            
            // Scroll TOC to show active item
            const activeLink = document.querySelector('.toc-link.active');
            if (activeLink) {
                const sidebar = document.getElementById('sidebar');
                const linkTop = activeLink.offsetTop;
                const linkHeight = activeLink.offsetHeight;
                const sidebarHeight = sidebar.clientHeight;
                
                // Scroll so active item is roughly in the middle of the sidebar
                sidebar.scrollTop = linkTop - (sidebarHeight / 2) + (linkHeight / 2);
            }
            
            // Setup progress saving on navigation
            setupProgressSaving();
        });
        
        // Track current scroll position
        let currentScrollPosition = 0;
        
        // Update scroll position on scroll
        document.getElementById('main').addEventListener('scroll', function() {
            currentScrollPosition = Math.round(this.scrollTop);
        });
        
        // Save reading progress with scroll position
        function saveProgress() {
            return fetch(`/api/progress?book_id=${encodeURIComponent(BOOK_ID)}&chapter_index=${CHAPTER_INDEX}&scroll_position=${currentScrollPosition}`, {
                method: 'POST',
                keepalive: true  // Ensure request completes even if page unloads
            }).catch(error => {
                console.error('Failed to save progress:', error);
            });
        }
        
        // Setup progress saving listeners
        function setupProgressSaving() {
            // Save progress when navigating away or closing (use both events for better compatibility)
            window.addEventListener('beforeunload', function(e) {
                saveProgress();
            });
            
            window.addEventListener('pagehide', function(e) {
                saveProgress();
            });
            
            // Save progress when clicking navigation links
            document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    saveProgress().then(() => {
                        window.location.href = this.href;
                    });
                });
            });
            
            // Save progress when clicking back to library
            const homeLink = document.querySelector('.nav-home');
            if (homeLink) {
                homeLink.addEventListener('click', function(e) {
                    e.preventDefault();
                    saveProgress().then(() => {
                        window.location.href = this.href;
                    });
                });
            }
        }

        // Prevent default context menu on book content
        document.getElementById('book-content').addEventListener('contextmenu', function(e) {
            const selection = window.getSelection();
            const text = selection.toString().trim();
            
            if (text.length > 0) {
                e.preventDefault();
                selectedText = text;
                
                // Get context
                const range = selection.getRangeAt(0);
                const container = range.commonAncestorContainer.parentElement;
                selectedContext = container.textContent || "";
                
                showContextMenu(e.pageX, e.pageY);
            }
        });

        // Hide context menu when clicking elsewhere
        document.addEventListener('click', function(e) {
            if (!e.target.closest('#context-menu')) {
                hideContextMenu();
            }
        });

        function showContextMenu(x, y) {
            const menu = document.getElementById('context-menu');
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.display = 'block';
        }

        function hideContextMenu() {
            document.getElementById('context-menu').style.display = 'none';
        }

        async function copyTextToClipboard(text) {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }

            const tempTextarea = document.createElement('textarea');
            tempTextarea.value = text;
            tempTextarea.setAttribute('readonly', '');
            tempTextarea.style.position = 'absolute';
            tempTextarea.style.left = '-9999px';
            document.body.appendChild(tempTextarea);
            tempTextarea.select();

            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(tempTextarea);
            }
        }

        async function handleContextAction(actionType) {
            hideContextMenu();
            
            if (!selectedText) return;

            if (actionType === 'copy_search') {
                try {
                    await copyTextToClipboard(selectedText);
                } catch (error) {
                    console.error('Failed to copy text:', error);
                    alert('复制失败，请重试。');
                }
                return;
            }

            currentAnalysisType = actionType;
            
            // Show panel
            openPanel();
            
            // Reset IDs
            currentHighlightId = null;
            currentAnalysisId = null;
            currentRawAnalysisResponse = '';
            
            // Hide saved indicator
            document.getElementById('saved-indicator').classList.remove('show');
            
            // Handle comment action differently
            if (actionType === 'comment') {
                // Show comment input UI
                document.getElementById('panel-title').textContent = '💬 添加笔记';
                document.getElementById('panel-selected-text').textContent = selectedText;
                
                // Hide analysis box, show comment input
                document.getElementById('analysis-box').style.display = 'none';
                document.getElementById('comment-input-area').style.display = 'block';
                document.getElementById('comment-textarea').value = '';
                document.getElementById('comment-textarea').focus();
                
                // Show comment actions, hide AI actions
                document.getElementById('panel-actions').style.display = 'none';
                document.getElementById('comment-actions').style.display = 'flex';
                document.getElementById('save-comment-btn').style.display = 'inline-block';
                document.getElementById('update-comment-btn').style.display = 'none';
                document.getElementById('delete-comment-btn').style.display = 'none';
                
                return;
            }
            
            // Handle AI actions (fact_check, discussion)
            // Show analysis box, hide comment input
            document.getElementById('analysis-box').style.display = 'block';
            document.getElementById('comment-input-area').style.display = 'none';
            document.getElementById('panel-actions').style.display = 'flex';
            document.getElementById('comment-actions').style.display = 'none';
            
            // Update panel content
            document.getElementById('panel-title').textContent = 
                actionType === 'fact_check' ? '📋 解释说明' : '💡 深入讨论';
            document.getElementById('panel-selected-text').textContent = selectedText;
            document.getElementById('panel-analysis-type').textContent = 
                actionType === 'fact_check' ? '解释说明' : '深入讨论';
            const aiSettings = getAISettings();
            const providerLabel = aiSettings.provider === 'ollama'
                ? 'Local'
                : 'Cloud';
            document.getElementById('panel-analysis-content').innerHTML = 
                `<div class="loading">正在分析中... (${providerLabel})</div>`;
            
            // Disable save button
            document.getElementById('save-btn').disabled = true;

            try {
                // Call AI analysis (without saving)
                const aiRes = await fetch('/api/ai/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: 0,  // Temporary, not saved yet
                        analysis_type: actionType,
                        selected_text: selectedText,
                        context: selectedContext,
                        provider: aiSettings.provider
                    })
                });

                const aiData = await aiRes.json();
                
                if (aiData.status === 'success') {
                    currentRawAnalysisResponse = aiData.response;
                    // Render markdown
                    const providerUsed = aiData.provider_used === 'ollama' ? '🏠 Local' : '☁️ Cloud';
                    const responseHTML = `<div class="provider-badge" style="font-size: 0.85em; color: #999; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">Using: ${providerUsed}</div>` + 
                        marked.parse(aiData.response);
                    document.getElementById('panel-analysis-content').innerHTML = responseHTML;
                    // Enable save button
                    document.getElementById('save-btn').disabled = false;
                } else {
                    document.getElementById('panel-analysis-content').textContent = '分析失败，请重试。';
                }

            } catch (error) {
                console.error('Error:', error);
                document.getElementById('panel-analysis-content').textContent = '发生错误: ' + error.message;
            }
        }

        async function saveAnalysis() {
            const saveBtn = document.getElementById('save-btn');
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';
            
            try {
                // Step 1: Save highlight
                const highlightRes = await fetch('/api/highlight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_id: BOOK_ID,
                        chapter_index: CHAPTER_INDEX,
                        selected_text: selectedText,
                        context_before: selectedContext.substring(0, 200),
                        context_after: selectedContext.substring(selectedContext.length - 200)
                    })
                });

                const highlightData = await highlightRes.json();
                currentHighlightId = highlightData.highlight_id;

                // Step 2: Save analysis
                const analysisContent = currentRawAnalysisResponse;
                
                const saveRes = await fetch('/api/ai/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: currentHighlightId,
                        analysis_type: currentAnalysisType,
                        prompt: selectedText,
                        response: analysisContent
                    })
                });

                const saveData = await saveRes.json();
                
                if (saveData.status === 'success') {
                    currentAnalysisId = saveData.analysis_id;
                    document.getElementById('saved-indicator').classList.add('show');
                    saveBtn.textContent = '已保存';
                    
                    // Reload highlights to show the new one
                    await loadSavedHighlights();
                } else {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '保存失败';
                    setTimeout(() => {
                        saveBtn.textContent = '保存到数据库';
                    }, 2000);
                }

            } catch (error) {
                console.error('Error:', error);
                saveBtn.disabled = false;
                saveBtn.textContent = '保存失败';
                setTimeout(() => {
                    saveBtn.textContent = '保存到数据库';
                }, 2000);
            }
        }

        function openPanel() {
            document.getElementById('ai-panel').classList.remove('hidden');
            document.getElementById('toggle-panel-btn').classList.add('hidden');
        }

        function closePanel() {
            document.getElementById('ai-panel').classList.add('hidden');
            document.getElementById('toggle-panel-btn').classList.remove('hidden');
            window.getSelection().removeAllRanges();
            
            // Reset panel state
            document.getElementById('save-btn').style.display = 'inline-block';
            document.getElementById('delete-highlight-btn').style.display = 'none';
            document.getElementById('delete-highlight-btn').disabled = false;
            document.getElementById('delete-highlight-btn').textContent = '删除高亮';
            document.getElementById('saved-indicator').classList.remove('show');
            document.getElementById('analysis-box').style.display = 'block';
            document.getElementById('comment-input-area').style.display = 'none';
            document.getElementById('panel-actions').style.display = 'flex';
            document.getElementById('comment-actions').style.display = 'none';
            document.getElementById('delete-comment-btn').style.display = 'none';
            document.getElementById('delete-comment-btn').disabled = false;
            document.getElementById('delete-comment-btn').textContent = '删除高亮';
        }
        
        // Comment functions
        async function saveComment() {
            const commentText = document.getElementById('comment-textarea').value.trim();
            
            if (!commentText) {
                alert('请输入笔记内容');
                return;
            }
            
            const saveBtn = document.getElementById('save-comment-btn');
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';
            
            try {
                // Step 1: Save highlight
                const highlightRes = await fetch('/api/highlight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_id: BOOK_ID,
                        chapter_index: CHAPTER_INDEX,
                        selected_text: selectedText,
                        context_before: selectedContext.substring(0, 200),
                        context_after: selectedContext.substring(selectedContext.length - 200)
                    })
                });

                const highlightData = await highlightRes.json();
                currentHighlightId = highlightData.highlight_id;

                // Step 2: Save comment as analysis
                const saveRes = await fetch('/api/ai/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: currentHighlightId,
                        analysis_type: 'comment',
                        prompt: selectedText,
                        response: commentText
                    })
                });

                const saveData = await saveRes.json();
                
                if (saveData.status === 'success') {
                    currentAnalysisId = saveData.analysis_id;
                    document.getElementById('saved-indicator').classList.add('show');
                    saveBtn.textContent = '已保存';
                    
                    // Reload highlights to show the new comment
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    saveBtn.disabled = false;
                    saveBtn.textContent = '保存失败';
                    setTimeout(() => {
                        saveBtn.textContent = '保存笔记';
                    }, 2000);
                }

            } catch (error) {
                console.error('Error:', error);
                saveBtn.disabled = false;
                saveBtn.textContent = '保存失败';
                setTimeout(() => {
                    saveBtn.textContent = '保存笔记';
                }, 2000);
            }
        }
        
        async function updateComment() {
            const commentText = document.getElementById('comment-textarea').value.trim();
            
            if (!commentText) {
                alert('请输入笔记内容');
                return;
            }
            
            const updateBtn = document.getElementById('update-comment-btn');
            updateBtn.disabled = true;
            updateBtn.textContent = '更新中...';
            
            try {
                const response = await fetch(`/api/ai/update/${currentAnalysisId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        response: commentText
                    })
                });

                const data = await response.json();
                
                if (data.status === 'success') {
                    updateBtn.textContent = '已更新';
                    document.getElementById('saved-indicator').classList.add('show');
                    
                    // Reload to show updated comment
                    setTimeout(() => {
                        window.location.reload();
                    }, 1000);
                } else {
                    updateBtn.disabled = false;
                    updateBtn.textContent = '更新失败';
                    setTimeout(() => {
                        updateBtn.textContent = '更新笔记';
                    }, 2000);
                }

            } catch (error) {
                console.error('Error:', error);
                updateBtn.disabled = false;
                updateBtn.textContent = '更新失败';
                setTimeout(() => {
                    updateBtn.textContent = '更新笔记';
                }, 2000);
            }
        }
        
        async function deleteCurrentHighlight() {
            if (!currentHighlightId) {
                return;
            }

            if (!confirm('确定要删除这条高亮吗？相关笔记和分析也会一起删除。')) {
                return;
            }
            
            const deleteBtn = document.getElementById(
                document.getElementById('comment-actions').style.display === 'flex'
                    ? 'delete-comment-btn'
                    : 'delete-highlight-btn'
            );
            deleteBtn.disabled = true;
            deleteBtn.textContent = '删除中...';
            
            try {
                const response = await fetch(`/api/highlight/${currentHighlightId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();
                
                if (data.status === 'success') {
                    deleteBtn.textContent = '已删除';
                    
                    // Reload to remove the highlight
                    setTimeout(() => {
                        window.location.reload();
                    }, 500);
                } else {
                    deleteBtn.disabled = false;
                    deleteBtn.textContent = '删除失败';
                    setTimeout(() => {
                        deleteBtn.textContent = '删除';
                    }, 2000);
                }

            } catch (error) {
                console.error('Error:', error);
                deleteBtn.disabled = false;
                deleteBtn.textContent = '删除失败';
                setTimeout(() => {
                    deleteBtn.textContent = '删除';
                }, 2000);
            }
        }

        function togglePanel() {
            const panel = document.getElementById('ai-panel');
            if (panel.classList.contains('hidden')) {
                openPanel();
            } else {
                closePanel();
            }
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', function(e) {
            // Don't trigger if user is typing in a text field
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
                return;
            }

            const modal = document.getElementById('link-modal');
            const isModalOpen = modal && modal.classList.contains('show');
            const aiPanel = document.getElementById('ai-panel');
            const isPanelOpen = aiPanel && !aiPanel.classList.contains('hidden');
            const contextMenu = document.getElementById('context-menu');
            const isContextMenuOpen = contextMenu && contextMenu.style.display === 'block';
            
            if (e.key === 'Escape') {
                if (isModalOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeModal();
                    return;
                }

                if (isPanelOpen || isContextMenuOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                }

                closePanel();
                hideContextMenu();
                closeModal();
            } else if (e.key === 'ArrowLeft') {
                // Previous chapter - find the first prev button that's not disabled
                const prevBtn = document.querySelector('.chapter-nav a.nav-btn:first-child:not(.disabled)');
                if (prevBtn) {
                    e.preventDefault();
                    window.location.href = prevBtn.href;
                }
            } else if (e.key === 'ArrowRight') {
                // Next chapter - find the last next button that's not disabled
                const nextBtn = document.querySelector('.chapter-nav a.nav-btn:last-child:not(.disabled)');
                if (nextBtn) {
                    e.preventDefault();
                    window.location.href = nextBtn.href;
                }
            }
        });
        
        // Intercept internal links and show in modal
        document.getElementById('book-content').addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href) {
                const url = new URL(link.href);
                // Check if it's an internal link to this book
                if (url.pathname.includes('/read/')) {
                    e.preventDefault();
                    showLinkModal(`${url.pathname}${url.search}`, url.hash);
                }
            }
        });
        
        async function showLinkModal(path, hash = '') {
            const modal = document.getElementById('link-modal');
            const modalBody = document.getElementById('modal-body');
            const modalTitle = document.getElementById('modal-title');
            
            modal.classList.add('show');
            modalBody.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Loading...</div>';
            modalTitle.textContent = 'Reference';
            
            try {
                const response = await fetch(path);
                const html = await response.text();
                
                // Parse the HTML to extract just the content
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const content = doc.querySelector('.book-content');
                
                if (content) {
                    modalBody.innerHTML = content.innerHTML;
                    scrollModalToHash(modalBody, hash);
                } else {
                    modalBody.innerHTML = '<p>Content not found</p>';
                }
            } catch (error) {
                modalBody.innerHTML = '<p>Error loading content</p>';
                console.error('Error loading modal content:', error);
            }
        }
        
        function closeModal(event) {
            // Only close if clicking overlay or close button, not the content
            if (!event || event.target.id === 'link-modal' || event.target.classList.contains('modal-close')) {
                document.getElementById('link-modal').classList.remove('show');
            }
        }
        
        // Reading settings
        function toggleSettings(event) {
            event.stopPropagation();
            const dropdown = document.getElementById('settings-dropdown');
            dropdown.classList.toggle('show');
        }
        
        function updateThemeToggle(theme) {
            const themeToggle = document.getElementById('theme-toggle');
            if (!themeToggle) return;

            if (theme === 'dark') {
                themeToggle.classList.add('active');
            } else {
                themeToggle.classList.remove('active');
            }
        }

        function toggleTheme() {
            const isDark = document.body.classList.contains('dark-mode');
            setTheme(isDark ? 'light' : 'dark');
        }

        function setTheme(theme) {
            if (theme === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            localStorage.setItem('reader-theme', theme);

            updateThemeToggle(theme);
        }

        function updatePaperModeToggle(enabled) {
            const paperToggle = document.getElementById('paper-mode-toggle');
            if (!paperToggle) return;

            if (enabled) {
                paperToggle.classList.add('active');
            } else {
                paperToggle.classList.remove('active');
            }
        }

        function togglePaperMode() {
            const isPaperMode = document.body.classList.contains('paper-mode');
            setPaperMode(!isPaperMode);
        }

        function setPaperMode(enabled) {
            if (enabled) {
                document.body.classList.add('paper-mode');
            } else {
                document.body.classList.remove('paper-mode');
            }

            localStorage.setItem('reader-paper-mode', enabled ? 'true' : 'false');
            updatePaperModeToggle(enabled);
        }
        
        // Close settings when clicking outside
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.settings-container')) {
                document.getElementById('settings-dropdown').classList.remove('show');
            }
        });
        
        function setFont(fontFamily) {
            document.getElementById('book-content').style.fontFamily = fontFamily;
            localStorage.setItem('reader-font', fontFamily);
            
            // Update active button
            document.querySelectorAll('.settings-option[data-font]').forEach(btn => {
                btn.classList.remove('active');
            });
            event.target.classList.add('active');
        }
        
        function setFontSize(size) {
            document.getElementById('book-content').style.fontSize = size + 'px';
            document.getElementById('font-size-value').textContent = size + 'px';
            localStorage.setItem('reader-font-size', size);
        }
        
        function setLineHeight(height) {
            document.getElementById('book-content').style.lineHeight = height;
            document.getElementById('line-height-value').textContent = height;
            localStorage.setItem('reader-line-height', height);
        }
        
        // Load saved settings on page load
        window.addEventListener('DOMContentLoaded', function() {
            const savedTheme = localStorage.getItem('reader-theme');
            const savedFont = localStorage.getItem('reader-font');
            const savedSize = localStorage.getItem('reader-font-size');
            const savedHeight = localStorage.getItem('reader-line-height');
            const savedPaperMode = localStorage.getItem('reader-paper-mode');
            
            // Apply saved theme
            if (savedTheme === 'dark') {
                setTheme('dark');
            } else {
                setTheme('light');
            }

            setPaperMode(savedPaperMode === 'true');
            
            if (savedFont) {
                document.getElementById('book-content').style.fontFamily = savedFont;
                // Update active button
                const fontMap = {
                    'Georgia, serif': 'georgia',
                    'Times New Roman, serif': 'times',
                    '-apple-system, sans-serif': 'sans',
                    'Arial, sans-serif': 'arial',
                    'Verdana, sans-serif': 'verdana',
                    'Microsoft YaHei, sans-serif': 'yahei',
                    'SimSun, serif': 'simsun',
                    'Consolas, monospace': 'mono'
                };
                const fontType = fontMap[savedFont];
                if (fontType) {
                    document.querySelectorAll('.settings-option[data-font]').forEach(btn => {
                        btn.classList.remove('active');
                        if (btn.getAttribute('data-font') === fontType) {
                            btn.classList.add('active');
                        }
                    });
                }
            }
            
            if (savedSize) {
                document.getElementById('book-content').style.fontSize = savedSize + 'px';
                document.querySelector('.settings-slider[min="14"]').value = savedSize;
                document.getElementById('font-size-value').textContent = savedSize + 'px';
            }
            
            if (savedHeight) {
                document.getElementById('book-content').style.lineHeight = savedHeight;
                document.querySelector('.settings-slider[min="1.4"]').value = savedHeight;
                document.getElementById('line-height-value').textContent = savedHeight;
            }
        });
