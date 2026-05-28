// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true
});

const { createApp } = Vue;

createApp({
    data() {
        return {
            bookId: '',
            chapterIndex: 0,
            savedScroll: 0,
            targetHighlightId: '',
            spineMap: {},
            selectedText: '',
            selectedContext: '',
            currentHighlightId: null,
            currentAnalysisId: null,
            currentAnalysisType: '',
            currentRawAnalysisResponse: '',
            savedHighlights: [],
            serverProviderOverride: null,
            serverDefaultProvider: 'ollama_cloud',
            currentScrollPosition: 0,
            showSettingsDropdown: false,
            // Panel state (replaces imperative getElementById + style.display)
            panelOpen: false,
            panelMode: 'analysis',          // 'analysis' | 'comment'
            panelTitle: 'AI 分析',
            panelSelectedText: '',
            panelAnalysisTypeLabel: '',
            panelAnalysisHtml: '<div class="loading">等待分析...</div>',
            commentText: '',
            saveBtnDisabled: true,
            saveBtnText: '保存到数据库',
            showSaveBtn: true,
            showDeleteBtn: false,
            showSaved: false,
            showPanelActions: true,
            showCommentActions: false,
            showSaveCommentBtn: false,
            showUpdateCommentBtn: false,
            showDeleteCommentBtn: false,
            // Toast notifications
            toastVisible: false,
            toastMessage: '',
            toastType: 'info',           // 'info' | 'error' | 'success'
            toastTimer: null,
            // Confirm dialog (replaces window.confirm)
            confirmVisible: false,
            confirmMessage: '',
            confirmResolve: null,
        };
    },

    computed: {
        aiSettings() {
            const mode = localStorage.getItem('ai-mode');
            const provider = mode
                ? (mode === 'remote' ? 'ollama_cloud' : 'ollama')
                : (localStorage.getItem('ai-provider') || this.serverDefaultProvider);
            return {
                provider: this.serverProviderOverride || provider,
                mode: mode || (this.serverProviderOverride || provider === 'ollama_cloud' ? 'remote' : 'local'),
                serverOverride: this.serverProviderOverride,
            };
        },
    },

    mounted() {
        const readerDataEl = document.getElementById('reader-data');
        if (readerDataEl) {
            this.bookId = readerDataEl.dataset.bookId || '';
            this.chapterIndex = Number(readerDataEl.dataset.chapterIndex || 0);
            this.savedScroll = Number(readerDataEl.dataset.savedScroll || 0);
            this.targetHighlightId = readerDataEl.dataset.targetHighlightId || '';
            try {
                this.spineMap = JSON.parse(readerDataEl.dataset.spineMap || '{}');
            } catch (e) {
                console.warn('Failed to parse spine map:', e);
            }
        }

        this.initializeProviderUI();
        this.loadSavedHighlights();
        this.restoreScrollPosition();
        this.loadSavedSettings();
        this.setupProgressSaving();
        this.setupKeyboardShortcuts();
        this.setupContextMenu();
        this.setupLinkInterceptor();

        this.$nextTick(() => {
            const activeLink = document.querySelector('.toc-link.active');
            if (activeLink) {
                const sidebar = document.getElementById('sidebar');
                sidebar.scrollTop = activeLink.offsetTop - (sidebar.clientHeight / 2) + (activeLink.offsetHeight / 2);
            }
        });
    },

    methods: {
        // ---- Toast & Confirm (replaces alert/confirm) ----

        showToast(message, type = 'info') {
            if (this.toastTimer) clearTimeout(this.toastTimer);
            this.toastMessage = message;
            this.toastType = type;
            this.toastVisible = true;
            this.toastTimer = setTimeout(() => {
                this.toastVisible = false;
            }, 2500);
        },

        showConfirm(message) {
            return new Promise((resolve) => {
                this.confirmMessage = message;
                this.confirmVisible = true;
                this.confirmResolve = resolve;
            });
        },

        onConfirmYes() {
            this.confirmVisible = false;
            if (this.confirmResolve) this.confirmResolve(true);
        },

        onConfirmNo() {
            this.confirmVisible = false;
            if (this.confirmResolve) this.confirmResolve(false);
        },

        // ---- Scroll progress (debounced) ----

        _debouncedSaveProgress() {
            if (this._saveTimer) clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                this.saveProgress();
            }, 1500);
        },

        _debounceScrollHandler() {
            this.currentScrollPosition = Math.round(document.getElementById('main').scrollTop);
            this._debouncedSaveProgress();
        },

        // ---- Navigation ----

        findAndGo(filename) {
            const cleanFile = filename.split('#')[0];
            const idx = this.spineMap[cleanFile];
            if (idx !== undefined) {
                window.location.href = '/read/' + this.bookId + '/' + idx;
            }
        },

        escapeSelectorFragment(value) {
            if (window.CSS && typeof window.CSS.escape === 'function') {
                return window.CSS.escape(value);
            }
            return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
        },

        scrollModalToHash(modalBody, hash) {
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
            const escapedId = this.escapeSelectorFragment(rawId);
            const target = modalBody.querySelector(`#${escapedId}, a[name="${escapedId}"]`);
            if (target) {
                target.scrollIntoView({ block: 'start', behavior: 'auto' });
                return;
            }
            scrollContainer.scrollTop = 0;
        },

        normalizeSavedAnalysisContent(text) {
            if (!text) return '';
            return text.replace(/^(Using:\s*(?:🏠 Local|☁️ Cloud))(?=\S)/m, '$1\n\n');
        },

        // ---- Provider ----

        async initializeProviderUI() {
            try {
                const response = await fetch('/api/settings');
                const data = await response.json();
                this.serverProviderOverride = data.provider_override;
                this.serverDefaultProvider = data.default_provider || 'ollama_cloud';
            } catch (error) {
                console.error('Failed to load server settings:', error);
            }
        },

        async toggleAIProvider() {
            const newProvider = this.aiSettings.provider === 'ollama' ? 'ollama_cloud' : 'ollama';
            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider_override: newProvider }),
                });
                const data = await response.json();
                this.serverProviderOverride = data.provider_override;
            } catch (error) {
                console.error('Failed to toggle AI provider:', error);
            }
        },

        // ---- Highlights ----

        async loadSavedHighlights() {
            try {
                const response = await fetch(`/api/highlights/${this.bookId}/${this.chapterIndex}`);
                const data = await response.json();
                this.savedHighlights = data.highlights || [];
                this.applyHighlights();

                if (this.targetHighlightId) {
                    this.$nextTick(() => {
                        const target = document.querySelector(`[data-highlight-id="${this.targetHighlightId}"]`);
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    });
                }
            } catch (error) {
                console.error('Error loading highlights:', error);
            }
        },

        applyHighlights() {
            const bookContent = document.getElementById('book-content');
            if (!bookContent) return;

            // Clear existing highlights
            const existingHighlights = bookContent.querySelectorAll('.saved-highlight');
            existingHighlights.forEach(span => {
                const parent = span.parentNode;
                while (span.firstChild) {
                    parent.insertBefore(span.firstChild, span);
                }
                parent.removeChild(span);
            });
            bookContent.normalize();

            if (this.savedHighlights.length === 0) return;

            const ranges = [];
            this.savedHighlights.forEach((highlight) => {
                const analysisType = highlight.analyses && highlight.analyses.length > 0
                    ? highlight.analyses[0].analysis_type : '';
                const range = this.findTextRange(bookContent, highlight.selected_text);
                if (range) {
                    ranges.push({ range, highlight, analysisType });
                } else {
                    console.warn('Could not find text for highlight:', highlight.selected_text.substring(0, 50) + '...');
                }
            });

            // Sort ranges by start position (latest first) to avoid position shifts
            ranges.sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range));

            ranges.forEach((item) => {
                try {
                    const range = item.range;
                    const commonAncestor = range.commonAncestorContainer;
                    const walker = document.createTreeWalker(
                        commonAncestor.nodeType === Node.ELEMENT_NODE ? commonAncestor : commonAncestor.parentElement,
                        NodeFilter.SHOW_ELEMENT,
                        {
                            acceptNode: function (node) {
                                const nodeRange = document.createRange();
                                nodeRange.selectNodeContents(node);
                                if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
                                    range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0) {
                                    return NodeFilter.FILTER_ACCEPT;
                                }
                                return NodeFilter.FILTER_SKIP;
                            },
                        }
                    );

                    const elements = [];
                    let node;
                    while ((node = walker.nextNode())) {
                        if (node.tagName === 'P' || node.tagName === 'DIV') {
                            elements.push(node);
                        }
                    }

                    if (elements.length === 0) {
                        const span = document.createElement('span');
                        span.className = 'saved-highlight';
                        span.setAttribute('data-highlight-id', item.highlight.id);
                        span.setAttribute('data-analysis-type', item.analysisType);
                        span.title = '📋 Click to view';
                        span.onclick = () => this.showSavedAnalysis(item.highlight);
                        try {
                            range.surroundContents(span);
                        } catch (e) {
                            const contents = range.extractContents();
                            span.appendChild(contents);
                            range.insertNode(span);
                        }
                    } else {
                        elements.forEach(el => {
                            el.classList.add('saved-highlight');
                            el.setAttribute('data-highlight-id', item.highlight.id);
                            el.setAttribute('data-analysis-type', item.analysisType);
                            el.style.cursor = 'pointer';
                            el.onclick = () => this.showSavedAnalysis(item.highlight);
                            const tooltips = {
                                fact_check: '📋 解释说明 - 点击查看',
                                discussion: '💡 深入讨论 - 点击查看',
                                comment: '💬 个人笔记 - 点击查看/编辑',
                            };
                            el.title = tooltips[item.analysisType] || 'Click to view';
                        });
                    }
                } catch (e) {
                    console.error(`Failed to apply highlight ${item.highlight.id}:`, e);
                }
            });
        },

        findTextRange(element, searchText) {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let node;
            let fullText = '';
            const nodes = [];

            while ((node = walker.nextNode())) {
                nodes.push({
                    node: node,
                    start: fullText.length,
                    end: fullText.length + node.textContent.length,
                });
                fullText += node.textContent;
            }

            let searchIndex = fullText.indexOf(searchText);
            let searchLength = searchText.length;

            if (searchIndex === -1) {
                const pattern = searchText
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/\s+/g, '\\s+');
                const regex = new RegExp(pattern);
                const match = fullText.match(regex);
                if (!match) return null;
                searchIndex = match.index;
                searchLength = match[0].length;
            }

            const searchEnd = searchIndex + searchLength;
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

            if (!startNode || !endNode) return null;

            const range = document.createRange();
            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);
            return range;
        },

        showSavedAnalysis(highlight) {
            this.openPanel();
            this.currentHighlightId = highlight.id;
            this.currentAnalysisId = highlight.analyses && highlight.analyses.length > 0
                ? highlight.analyses[0].id : null;
            this.selectedText = highlight.selected_text;
            this.panelSelectedText = highlight.selected_text;
            this.showSaved = true;

            if (highlight.analyses && highlight.analyses.length > 0) {
                const analysis = highlight.analyses[0];
                if (analysis.analysis_type === 'comment') {
                    this.panelTitle = '💬 我的笔记';
                    this.panelMode = 'comment';
                    this.commentText = analysis.response;
                    this.showPanelActions = false;
                    this.showCommentActions = true;
                    this.showSaveCommentBtn = false;
                    this.showUpdateCommentBtn = true;
                    this.showDeleteCommentBtn = true;
                    this.currentAnalysisType = 'comment';
                } else {
                    this.panelTitle = '📚 已保存的分析';
                    this.panelMode = 'analysis';
                    this.panelAnalysisTypeLabel =
                        analysis.analysis_type === 'fact_check' ? '解释说明' : '深入讨论';
                    this.panelAnalysisHtml = marked.parse(
                        this.normalizeSavedAnalysisContent(analysis.response)
                    );
                    this.showPanelActions = true;
                    this.showCommentActions = false;
                    this.showSaveBtn = false;
                    this.showDeleteBtn = true;
                }
            } else {
                this.panelTitle = '📚 已保存的分析';
                this.panelMode = 'analysis';
                this.panelAnalysisHtml = '暂无AI分析';
                this.showPanelActions = true;
                this.showCommentActions = false;
                this.showSaveBtn = false;
                this.showDeleteBtn = true;
            }
        },

        // ---- Progress ----

        setupProgressSaving() {
            const main = document.getElementById('main');
            if (main) {
                main.addEventListener('scroll', () => this._debounceScrollHandler());
            }

            window.addEventListener('beforeunload', () => this.saveProgress());
            window.addEventListener('pagehide', () => this.saveProgress());

            document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.saveProgress().then(() => {
                        window.location.href = btn.href;
                    });
                });
            });

            const homeLink = document.querySelector('.nav-home');
            if (homeLink) {
                homeLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.saveProgress().then(() => {
                        window.location.href = homeLink.href;
                    });
                });
            }
        },

        async saveProgress() {
            return fetch(
                `/api/progress?book_id=${encodeURIComponent(this.bookId)}&chapter_index=${this.chapterIndex}&scroll_position=${this.currentScrollPosition}`,
                { method: 'POST', keepalive: true }
            ).catch(error => console.error('Failed to save progress:', error));
        },

        restoreScrollPosition() {
            if (this.targetHighlightId) return;
            if (this.savedScroll <= 0) return;

            const mainElement = document.getElementById('main');
            let attempts = 0;
            const restore = () => {
                mainElement.scrollTop = this.savedScroll;
                this.currentScrollPosition = this.savedScroll;
                if (mainElement.scrollTop < this.savedScroll - 10 && attempts < 5) {
                    attempts++;
                    setTimeout(restore, 200);
                }
            };
            setTimeout(restore, 100);
        },

        // ---- Context Menu ----

        setupContextMenu() {
            const bookContent = document.getElementById('book-content');
            if (!bookContent) return;

            bookContent.addEventListener('contextmenu', (e) => {
                const selection = window.getSelection();
                const text = selection.toString().trim();
                if (text.length > 0) {
                    e.preventDefault();
                    this.selectedText = text;
                    const range = selection.getRangeAt(0);
                    const container = range.commonAncestorContainer.parentElement;
                    this.selectedContext = container.textContent || '';
                    this.showContextMenu(e.pageX, e.pageY);
                }
            });

            document.addEventListener('click', (e) => {
                if (!e.target.closest('#context-menu')) {
                    this.hideContextMenu();
                }
            });
        },

        showContextMenu(x, y) {
            const menu = document.getElementById('context-menu');
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.style.display = 'block';
        },

        hideContextMenu() {
            document.getElementById('context-menu').style.display = 'none';
        },

        async copyTextToClipboard(text) {
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
        },

        async handleContextAction(actionType) {
            this.hideContextMenu();
            if (!this.selectedText) return;

            if (actionType === 'copy_search') {
                try {
                    await this.copyTextToClipboard(this.selectedText);
                } catch (error) {
                    console.error('Failed to copy text:', error);
                    this.showToast('复制失败，请重试。', 'error');
                }
                return;
            }

            this.currentAnalysisType = actionType;
            this.openPanel();
            this.currentHighlightId = null;
            this.currentAnalysisId = null;
            this.currentRawAnalysisResponse = '';
            this.showSaved = false;

            if (actionType === 'comment') {
                this.panelTitle = '💬 添加笔记';
                this.panelSelectedText = this.selectedText;
                this.panelMode = 'comment';
                this.commentText = '';
                this.showPanelActions = false;
                this.showCommentActions = true;
                this.showSaveCommentBtn = true;
                this.showUpdateCommentBtn = false;
                this.showDeleteCommentBtn = false;
                this.$nextTick(() => {
                    this.$refs.commentTextarea?.focus();
                });
                return;
            }

            // AI actions (fact_check, discussion)
            this.panelMode = 'analysis';
            this.showPanelActions = true;
            this.showCommentActions = false;
            this.panelTitle = actionType === 'fact_check' ? '📋 解释说明' : '💡 深入讨论';
            this.panelSelectedText = this.selectedText;
            this.panelAnalysisTypeLabel = actionType === 'fact_check' ? '解释说明' : '深入讨论';

            const providerLabel = this.aiSettings.provider === 'ollama' ? 'Local' : 'Cloud';
            this.panelAnalysisHtml = `<div class="loading">正在分析中... (${providerLabel})</div>`;
            this.saveBtnDisabled = true;

            try {
                const aiRes = await fetch('/api/ai/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: 0,
                        analysis_type: actionType,
                        selected_text: this.selectedText,
                        context: this.selectedContext,
                        provider: this.aiSettings.provider,
                    }),
                });
                const aiData = await aiRes.json();

                if (aiData.status === 'success') {
                    this.currentRawAnalysisResponse = aiData.response;
                    const providerUsed = aiData.provider_used === 'ollama' ? '🏠 Local' : '☁️ Cloud';
                    this.panelAnalysisHtml =
                        `<div class="provider-badge" style="font-size: 0.85em; color: #999; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #eee;">Using: ${providerUsed}</div>` +
                        marked.parse(aiData.response);
                    this.saveBtnDisabled = false;
                } else {
                    this.panelAnalysisHtml = '分析失败，请重试。';
                }
            } catch (error) {
                console.error('Error:', error);
                this.panelAnalysisHtml = '发生错误: ' + error.message;
            }
        },

        // ---- Save / Delete ----

        async saveAnalysis() {
            this.saveBtnDisabled = true;
            this.saveBtnText = '保存中...';

            try {
                const highlightRes = await fetch('/api/highlight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_id: this.bookId,
                        chapter_index: this.chapterIndex,
                        selected_text: this.selectedText,
                        context_before: this.selectedContext.substring(0, 200),
                        context_after: this.selectedContext.substring(this.selectedContext.length - 200),
                    }),
                });
                const highlightData = await highlightRes.json();
                this.currentHighlightId = highlightData.highlight_id;

                const saveRes = await fetch('/api/ai/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: this.currentHighlightId,
                        analysis_type: this.currentAnalysisType,
                        prompt: this.selectedText,
                        response: this.currentRawAnalysisResponse,
                    }),
                });
                const saveData = await saveRes.json();

                if (saveData.status === 'success') {
                    this.currentAnalysisId = saveData.analysis_id;
                    this.showSaved = true;
                    this.saveBtnText = '已保存';
                    await this.loadSavedHighlights();
                } else {
                    this.saveBtnDisabled = false;
                    this.saveBtnText = '保存失败';
                    setTimeout(() => { this.saveBtnText = '保存到数据库'; }, 2000);
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.saveBtnText = '保存失败';
                setTimeout(() => { this.saveBtnText = '保存到数据库'; }, 2000);
            }
        },

        async saveComment() {
            const text = this.commentText.trim();
            if (!text) {
                this.showToast('请输入笔记内容', 'info');
                return;
            }

            this.saveBtnText = '保存中...';
            this.saveBtnDisabled = true;

            try {
                const highlightRes = await fetch('/api/highlight', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        book_id: this.bookId,
                        chapter_index: this.chapterIndex,
                        selected_text: this.selectedText,
                        context_before: this.selectedContext.substring(0, 200),
                        context_after: this.selectedContext.substring(this.selectedContext.length - 200),
                    }),
                });
                const highlightData = await highlightRes.json();
                this.currentHighlightId = highlightData.highlight_id;

                const saveRes = await fetch('/api/ai/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: this.currentHighlightId,
                        analysis_type: 'comment',
                        prompt: this.selectedText,
                        response: text,
                    }),
                });
                const saveData = await saveRes.json();

                if (saveData.status === 'success') {
                    this.currentAnalysisId = saveData.analysis_id;
                    this.showSaved = true;
                    this.saveBtnText = '已保存';
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    this.saveBtnDisabled = false;
                    this.saveBtnText = '保存失败';
                    setTimeout(() => { this.saveBtnText = '保存笔记'; }, 2000);
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.saveBtnText = '保存失败';
                setTimeout(() => { this.saveBtnText = '保存笔记'; }, 2000);
            }
        },

        async updateComment() {
            const text = this.commentText.trim();
            if (!text) {
                this.showToast('请输入笔记内容', 'info');
                return;
            }

            this.saveBtnDisabled = true;
            this.saveBtnText = '更新中...';

            try {
                const response = await fetch(`/api/ai/update/${this.currentAnalysisId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ response: text }),
                });
                const data = await response.json();

                if (data.status === 'success') {
                    this.showSaved = true;
                    this.saveBtnText = '已更新';
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    this.saveBtnDisabled = false;
                    this.saveBtnText = '更新失败';
                    setTimeout(() => { this.saveBtnText = '更新笔记'; }, 2000);
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.saveBtnText = '更新失败';
                setTimeout(() => { this.saveBtnText = '更新笔记'; }, 2000);
            }
        },

        async deleteCurrentHighlight() {
            if (!this.currentHighlightId) return;
            const ok = await this.showConfirm('确定要删除这条高亮吗？相关笔记和分析也会一起删除。');
            if (!ok) return;

            this.saveBtnDisabled = true;
            this.saveBtnText = '删除中...';

            try {
                const response = await fetch(`/api/highlight/${this.currentHighlightId}`, {
                    method: 'DELETE',
                });
                const data = await response.json();

                if (data.status === 'success') {
                    this.saveBtnText = '已删除';
                    setTimeout(() => window.location.reload(), 500);
                } else {
                    this.saveBtnDisabled = false;
                    this.saveBtnText = '删除失败';
                    setTimeout(() => { this.saveBtnText = '删除'; }, 2000);
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.saveBtnText = '删除失败';
                setTimeout(() => { this.saveBtnText = '删除'; }, 2000);
            }
        },

        // ---- Panel ----

        openPanel() {
            this.panelOpen = true;
        },

        closePanel() {
            this.panelOpen = false;
            window.getSelection().removeAllRanges();

            // Reset panel to default state
            this.panelMode = 'analysis';
            this.showSaveBtn = true;
            this.showDeleteBtn = false;
            this.saveBtnDisabled = true;
            this.saveBtnText = '保存到数据库';
            this.showSaved = false;
            this.showPanelActions = true;
            this.showCommentActions = false;
            this.showDeleteCommentBtn = false;
        },

        togglePanel() {
            if (this.panelOpen) {
                this.closePanel();
            } else {
                this.openPanel();
            }
        },

        // ---- Link Modal ----

        setupLinkInterceptor() {
            const bookContent = document.getElementById('book-content');
            if (!bookContent) return;

            bookContent.addEventListener('click', (e) => {
                const link = e.target.closest('a');
                if (link && link.href) {
                    const url = new URL(link.href);
                    if (url.pathname.includes('/read/')) {
                        e.preventDefault();
                        this.showLinkModal(`${url.pathname}${url.search}`, url.hash);
                    }
                }
            });
        },

        async showLinkModal(path, hash = '') {
            const modal = document.getElementById('link-modal');
            const modalBody = document.getElementById('modal-body');
            const modalTitle = document.getElementById('modal-title');

            modal.classList.add('show');
            modalBody.innerHTML = '<div style="text-align: center; padding: 40px; color: #999;">Loading...</div>';
            modalTitle.textContent = 'Reference';

            try {
                const response = await fetch(path);
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const content = doc.querySelector('.book-content');
                if (content) {
                    modalBody.innerHTML = content.innerHTML;
                    this.scrollModalToHash(modalBody, hash);
                } else {
                    modalBody.innerHTML = '<p>Content not found</p>';
                }
            } catch (error) {
                modalBody.innerHTML = '<p>Error loading content</p>';
                console.error('Error loading modal content:', error);
            }
        },

        closeModal(event) {
            if (!event || event.target.id === 'link-modal' || event.target.classList.contains('modal-close')) {
                document.getElementById('link-modal').classList.remove('show');
            }
        },

        // ---- Reading Settings ----

        toggleSettings(event) {
            event.stopPropagation();
            this.showSettingsDropdown = !this.showSettingsDropdown;
            document.getElementById('settings-dropdown').classList.toggle('show');
        },

        toggleTheme() {
            const isDark = document.body.classList.contains('dark-mode');
            this.setTheme(isDark ? 'light' : 'dark');
        },

        setTheme(theme) {
            if (theme === 'dark') {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }
            localStorage.setItem('reader-theme', theme);
            const toggle = document.getElementById('theme-toggle');
            if (toggle) toggle.classList.toggle('active', theme === 'dark');
        },

        togglePaperMode() {
            const isPaperMode = document.body.classList.contains('paper-mode');
            this.setPaperMode(!isPaperMode);
        },

        setPaperMode(enabled) {
            if (enabled) {
                document.body.classList.add('paper-mode');
            } else {
                document.body.classList.remove('paper-mode');
            }
            localStorage.setItem('reader-paper-mode', enabled ? 'true' : 'false');
            const toggle = document.getElementById('paper-mode-toggle');
            if (toggle) toggle.classList.toggle('active', enabled);
        },

        setFont(fontFamily, event) {
            document.getElementById('book-content').style.fontFamily = fontFamily;
            localStorage.setItem('reader-font', fontFamily);
            document.querySelectorAll('.settings-option[data-font]').forEach(btn => {
                btn.classList.remove('active');
            });
            if (event && event.target) {
                event.target.classList.add('active');
            }
        },

        setFontSize(size) {
            document.getElementById('book-content').style.fontSize = size + 'px';
            document.getElementById('font-size-value').textContent = size + 'px';
            localStorage.setItem('reader-font-size', size);
        },

        setLineHeight(height) {
            document.getElementById('book-content').style.lineHeight = height;
            document.getElementById('line-height-value').textContent = height;
            localStorage.setItem('reader-line-height', height);
        },

        loadSavedSettings() {
            const savedTheme = localStorage.getItem('reader-theme');
            const savedFont = localStorage.getItem('reader-font');
            const savedSize = localStorage.getItem('reader-font-size');
            const savedHeight = localStorage.getItem('reader-line-height');
            const savedPaperMode = localStorage.getItem('reader-paper-mode');

            this.setTheme(savedTheme === 'dark' ? 'dark' : 'light');
            this.setPaperMode(savedPaperMode === 'true');

            if (savedFont) {
                document.getElementById('book-content').style.fontFamily = savedFont;
                const fontMap = {
                    'Georgia, serif': 'georgia',
                    'Times New Roman, serif': 'times',
                    '-apple-system, sans-serif': 'sans',
                    'Arial, sans-serif': 'arial',
                    'Verdana, sans-serif': 'verdana',
                    'Microsoft YaHei, sans-serif': 'yahei',
                    'SimSun, serif': 'simsun',
                    'Consolas, monospace': 'mono',
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
                const slider = document.querySelector('.settings-slider[min="14"]');
                if (slider) slider.value = savedSize;
                const sizeVal = document.getElementById('font-size-value');
                if (sizeVal) sizeVal.textContent = savedSize + 'px';
            }

            if (savedHeight) {
                document.getElementById('book-content').style.lineHeight = savedHeight;
                const slider = document.querySelector('.settings-slider[min="1.4"]');
                if (slider) slider.value = savedHeight;
                const heightVal = document.getElementById('line-height-value');
                if (heightVal) heightVal.textContent = savedHeight;
            }
        },

        // ---- Keyboard ----

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

                const modal = document.getElementById('link-modal');
                const isModalOpen = modal && modal.classList.contains('show');
                const contextMenu = document.getElementById('context-menu');
                const isContextMenuOpen = contextMenu && contextMenu.style.display === 'block';

                if (e.key === 'Escape') {
                    if (isModalOpen) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.closeModal();
                        return;
                    }
                    if (this.panelOpen || isContextMenuOpen) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    this.closePanel();
                    this.hideContextMenu();
                    this.closeModal();
                } else if (e.key === 'ArrowLeft') {
                    const prevBtn = document.querySelector('.chapter-nav a.nav-btn:first-child:not(.disabled)');
                    if (prevBtn) {
                        e.preventDefault();
                        window.location.href = prevBtn.href;
                    }
                } else if (e.key === 'ArrowRight') {
                    const nextBtn = document.querySelector('.chapter-nav a.nav-btn:last-child:not(.disabled)');
                    if (nextBtn) {
                        e.preventDefault();
                        window.location.href = nextBtn.href;
                    }
                }
            });

            // Close settings dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.settings-container')) {
                    const dropdown = document.getElementById('settings-dropdown');
                    if (dropdown) dropdown.classList.remove('show');
                    this.showSettingsDropdown = false;
                }
            });
        },
    },
}).mount('#reader-app');
