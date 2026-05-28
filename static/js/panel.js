// Panel mixin — all AI panel, context menu, toast/confirm, and save/delete logic.
// Mixed into the main Vue app in reader.js.

window.PanelMixin = {
    data() {
        return {
            // Selection
            selectedText: '',
            selectedContext: '',

            // Highlight tracking
            currentHighlightId: null,
            currentAnalysisId: null,
            currentAnalysisType: '',
            currentRawAnalysisResponse: '',

            // Panel visibility and mode
            panelOpen: false,
            panelMode: 'analysis',          // 'analysis' | 'comment'
            panelTitle: 'AI 分析',
            panelSelectedText: '',
            panelAnalysisTypeLabel: '',
            panelAnalysisHtml: '<div class="loading">等待分析...</div>',

            // Comment input
            commentText: '',

            // Buttons
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

            // Toast
            toastVisible: false,
            toastMessage: '',
            toastType: 'info',
            toastTimer: null,

            // Confirm dialog
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

    methods: {
        // ================================================================
        //  Toast & Confirm
        // ================================================================

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

        // ================================================================
        //  Panel open / close / toggle
        // ================================================================

        openPanel() {
            this.panelOpen = true;
        },

        closePanel() {
            this.panelOpen = false;
            window.getSelection().removeAllRanges();

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

        // ================================================================
        //  Context menu
        // ================================================================

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
            const menu = document.getElementById('context-menu');
            if (menu) menu.style.display = 'none';
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

        // ================================================================
        //  Shared panel setup helpers
        // ================================================================

        _openPanelWithSelectedText(actionType) {
            this.hideContextMenu();
            if (!this.selectedText) return false;

            this.currentAnalysisType = actionType;
            this.openPanel();
            this.currentHighlightId = null;
            this.currentAnalysisId = null;
            this.currentRawAnalysisResponse = '';
            this.showSaved = false;
            this.panelSelectedText = this.selectedText;
            return true;
        },

        _setupCommentPanel() {
            this.panelTitle = '💬 添加笔记';
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
        },

        _setupAnalysisPanel(actionType) {
            this.panelMode = 'analysis';
            this.showPanelActions = true;
            this.showCommentActions = false;
            this.showSaveBtn = true;
            this.showDeleteBtn = false;
            this.panelTitle = actionType === 'fact_check' ? '📋 解释说明' : '💡 深入讨论';
            this.panelAnalysisTypeLabel = actionType === 'fact_check' ? '解释说明' : '深入讨论';
        },

        // ================================================================
        //  Context action dispatcher
        // ================================================================

        async handleContextAction(actionType) {
            if (actionType === 'copy_search') {
                this.hideContextMenu();
                try {
                    await this.copyTextToClipboard(this.selectedText);
                } catch (error) {
                    console.error('Failed to copy text:', error);
                    this.showToast('复制失败，请重试。', 'error');
                }
                return;
            }

            if (!this._openPanelWithSelectedText(actionType)) return;

            if (actionType === 'comment') {
                this._setupCommentPanel();
                return;
            }

            // AI actions (fact_check, discussion)
            this._setupAnalysisPanel(actionType);

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

        // ================================================================
        //  Show saved analysis
        // ================================================================

        normalizeSavedAnalysisContent(text) {
            if (!text) return '';
            return text.replace(/^(Using:\s*(?:🏠 Local|☁️ Cloud))(?=\S)/m, '$1\n\n');
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

        // ================================================================
        //  Save / Delete
        // ================================================================

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
                    await this.loadSavedHighlights();
                    setTimeout(() => this.closePanel(), 800);
                } else {
                    this.saveBtnDisabled = false;
                    this.showToast('保存失败', 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.showToast('保存失败', 'error');
            }
        },

        async updateComment() {
            const text = this.commentText.trim();
            if (!text) {
                this.showToast('请输入笔记内容', 'info');
                return;
            }

            this.saveBtnDisabled = true;

            try {
                const response = await fetch(`/api/ai/update/${this.currentAnalysisId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ response: text }),
                });
                const data = await response.json();

                if (data.status === 'success') {
                    this.showSaved = true;
                    await this.loadSavedHighlights();
                    setTimeout(() => this.closePanel(), 800);
                } else {
                    this.saveBtnDisabled = false;
                    this.showToast('更新失败', 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.showToast('更新失败', 'error');
            }
        },

        async deleteCurrentHighlight() {
            if (!this.currentHighlightId) return;
            const ok = await this.showConfirm('确定要删除这条高亮吗？相关笔记和分析也会一起删除。');
            if (!ok) return;

            this.saveBtnDisabled = true;

            try {
                const response = await fetch(`/api/highlight/${this.currentHighlightId}`, {
                    method: 'DELETE',
                });
                const data = await response.json();

                if (data.status === 'success') {
                    this.showToast('已删除', 'success');
                    setTimeout(() => this.closePanel(), 500);
                    await this.loadSavedHighlights();
                } else {
                    this.saveBtnDisabled = false;
                    this.showToast('删除失败', 'error');
                }
            } catch (error) {
                console.error('Error:', error);
                this.saveBtnDisabled = false;
                this.showToast('删除失败', 'error');
            }
        },

        // ================================================================
        //  AI Provider settings
        // ================================================================

        async initializeProviderUI() {
            try {
                const response = await fetch('/api/settings');
                const data = await response.json();
                this.serverProviderOverride = data.provider_override;
                this.serverDefaultProvider = data.default_provider || 'ollama_cloud';
                // Update toggle switch visual state
                this.$nextTick(() => {
                    const toggle = document.getElementById('provider-toggle');
                    if (toggle) {
                        const effectiveProvider = this.aiSettings.provider;
                        toggle.classList.toggle('active', effectiveProvider === 'ollama_cloud');
                    }
                });
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
                // Update toggle switch visual state
                const toggle = document.getElementById('provider-toggle');
                if (toggle) {
                    toggle.classList.toggle('active', data.provider_override === 'ollama_cloud');
                }
            } catch (error) {
                console.error('Failed to toggle AI provider:', error);
            }
        },

        // ================================================================
        //  Panel keyboard & click-outside listeners
        // ================================================================

        setupPanelListeners() {
            // ESC closes panel and context menu
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
                if (e.key !== 'Escape') return;

                const modal = document.getElementById('link-modal');
                const isModalOpen = modal && modal.classList.contains('show');
                if (isModalOpen) return;  // handled by reader's keyboard handler

                const contextMenu = document.getElementById('context-menu');
                const isContextMenuOpen = contextMenu && contextMenu.style.display === 'block';

                if (this.panelOpen || isContextMenuOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closePanel();
                    this.hideContextMenu();
                }
            });

            // Click-outside closes panel
            document.addEventListener('mousedown', (e) => {
                if (!this.panelOpen) return;
                const panel = document.getElementById('ai-panel');
                if (panel && !panel.contains(e.target) &&
                    !e.target.closest('#context-menu') &&
                    !e.target.closest('#toggle-panel-btn') &&
                    !e.target.closest('.saved-highlight') &&
                    !e.target.closest('[data-highlight-id]')) {
                    this.closePanel();
                }
            });
        },
    },
};
