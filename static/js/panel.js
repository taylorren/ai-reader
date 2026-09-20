// Sanitize HTML before it is bound with v-html. AI/markdown output is untrusted;
// DOMPurify strips scripts, event handlers, and dangerous attributes.
function sanitizeHtml(html) {
    if (window.DOMPurify) {
        return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
    }
    console.warn('DOMPurify not loaded; rendering unsanitized HTML');
    return html;
}

function renderMarkdown(markdown) {
    return sanitizeHtml(marked.parse(markdown ?? ''));
}

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
            confirmYesText: '删除',
            confirmYesDanger: true,
            confirmNoText: '',

            // Interactive Discussion
            conversationHistory: [],
            discussionInput: '',
            discussionLoading: false,
            conversationWarnings: [],
            discussionSaved: false,

            // Traditional analysis in-flight flag
            analysisLoading: false,
            showDiscussionActions: false,
            showSaveDiscussionBtn: false,
            discussionSummary: '',
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

        // True while any AI request (analysis or discussion) is in flight
        aiThinking() {
            return this.analysisLoading || this.discussionLoading;
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

        showConfirm(message, options = {}) {
            this.confirmMessage = message;
            this.confirmYesText = options.yesText || '删除';
            this.confirmYesDanger = options.yesDanger !== false;
            this.confirmNoText = options.noText || '';
            this.confirmVisible = true;
            return new Promise((resolve) => {
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

        onConfirmCancel() {
            this.confirmVisible = false;
            if (this.confirmResolve) this.confirmResolve(null);
        },

        // ================================================================
        //  Panel open / close / toggle
        // ================================================================

        openPanel() {
            this.panelOpen = true;
        },

        closePanel() {
            // Don't dismiss while AI is thinking — the in-flight result would be lost.
            if (this.aiThinking) {
                const msg = 'AI 正在思考中，请稍候…';
                if (!(this.toastVisible && this.toastMessage === msg)) {
                    this.showToast(msg, 'info');
                }
                return;
            }
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
            this.showDiscussionActions = false;
            this.showSaveDiscussionBtn = false;
            this.conversationHistory = [];
            this.discussionInput = '';
            this.discussionLoading = false;
            this.conversationWarnings = [];
            this.discussionSummary = '';
            this.discussionSaved = false;
        },

        // User-initiated dismiss (X button, ESC, click-outside).
        // Blocks while AI is thinking; prompts to save an unsaved discussion.
        async requestClosePanel() {
            // Don't dismiss while AI is thinking — the in-flight result would be lost.
            if (this.aiThinking) {
                const msg = 'AI 正在思考中，请稍候…';
                if (!(this.toastVisible && this.toastMessage === msg)) {
                    this.showToast(msg, 'info');
                }
                return;
            }

            // Re-entrancy guard: a confirm prompt is already open
            if (this.confirmVisible) return;

            // Unsaved interactive discussion → prompt to save before discarding
            if (this.panelMode === 'discussion' && !this.discussionSaved && this.conversationHistory.length > 0) {
                const choice = await this.showConfirm('讨论尚未保存，保存并关闭吗？', {
                    yesText: '保存并关闭',
                    yesDanger: false,
                    noText: '不保存关闭',
                });
                if (choice === true) {
                    const saved = await this.saveDiscussionAndClose();
                    if (saved) this.closePanel();
                } else if (choice === false) {
                    this.closePanel();
                }
                // null → user cancelled, stay in panel
                return;
            }

            this.closePanel();
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

        _setupDiscussionPanel() {
            this.panelMode = 'discussion';
            this.showPanelActions = false;
            this.showCommentActions = false;
            this.showDiscussionActions = false;
            this.showSaveDiscussionBtn = false;
            this.panelTitle = '💡 深入讨论 (交互式)';
            this.conversationHistory = [];
            this.discussionInput = '';
            this.conversationWarnings = [];
            this.discussionSummary = '';
            this.discussionSaved = false;
            this.$nextTick(() => {
                this.$refs.discussionTextarea?.focus();
                this.scrollToBottom();
            });
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

            // Interactive discussion
            if (actionType === 'discussion') {
                this._setupDiscussionPanel();
                await this.startInteractiveDiscussion();
                return;
            }

            // Traditional AI actions (fact_check only now)
            this._setupAnalysisPanel(actionType);

            const providerLabel = this.aiSettings.provider === 'ollama' ? 'Local' : 'Cloud';
            this.panelAnalysisHtml = `<div class="loading">正在分析中... (${providerLabel})</div>`;
            this.saveBtnDisabled = true;
            this.analysisLoading = true;

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
                        renderMarkdown(aiData.response);
                    this.saveBtnDisabled = false;
                    this._renderMathInPanel();
                } else {
                    this.panelAnalysisHtml = '分析失败，请重试。';
                }
            } catch (error) {
                console.error('Error:', error);
                this.panelAnalysisHtml = renderMarkdown('发生错误: ' + error.message);
            } finally {
                this.analysisLoading = false;
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
                    this.panelAnalysisHtml = renderMarkdown(
                        this.normalizeSavedAnalysisContent(analysis.response)
                    );
                    this.showPanelActions = true;
                    this._renderMathInPanel();
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
        //  Interactive Discussion
        // ================================================================

        async startInteractiveDiscussion() {
            this.discussionLoading = true;
            this.conversationHistory = [];
            this.conversationWarnings = [];
            this.discussionSummary = '';
            this.discussionSaved = false;
            this.showDiscussionActions = false;
            this.showSaveDiscussionBtn = false;

            try {
                const res = await fetch('/api/ai/discussion/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: 0,
                        selected_text: this.selectedText,
                        context: this.selectedContext,
                        provider: this.aiSettings.provider,
                    }),
                });
                const data = await res.json();

                if (data.status === 'success') {
                    this.conversationHistory = data.conversation_history || [];
                    this._renderMathInPanel();
                    this.$nextTick(() => this.scrollToBottom());
                } else {
                    this.conversationHistory = [{
                        role: 'assistant',
                        content: '抱歉，启动讨论时出现了问题。请重试。'
                    }];
                }
            } catch (error) {
                console.error('Discussion start error:', error);
                this.conversationHistory = [{
                    role: 'assistant',
                    content: '发生错误: ' + error.message
                }];
            } finally {
                this.discussionLoading = false;
                this.$nextTick(() => {
                    this.$refs.discussionTextarea?.focus();
                });
            }
        },

        async sendDiscussionMessage() {
            const message = this.discussionInput.trim();
            if (!message || this.discussionLoading) return;

            // Add user message to conversation immediately
            this.conversationHistory.push({ role: 'user', content: message });
            this.discussionInput = '';
            this.discussionLoading = true;

            this.$nextTick(() => this.scrollToBottom());

            try {
                const res = await fetch('/api/ai/discussion/continue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: 0,
                        selected_text: this.selectedText,
                        conversation_history: this.conversationHistory,
                        user_message: message,
                        provider: this.aiSettings.provider,
                    }),
                });
                const data = await res.json();

                if (data.status === 'success') {
                    this.conversationHistory = data.conversation_history || [];
                    this.conversationWarnings = data.warnings || [];
                    this._renderMathInPanel();
                    this.$nextTick(() => this.scrollToBottom());
                } else {
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: '抱歉，回复时出现了问题。请重试。'
                    });
                }
            } catch (error) {
                console.error('Discussion continue error:', error);
                this.conversationHistory.push({
                    role: 'assistant',
                    content: '发生错误: ' + error.message
                });
            } finally {
                this.discussionLoading = false;
                this.$nextTick(() => {
                    this.$refs.discussionTextarea?.focus();
                });
            }
        },

        async summarizeDiscussion() {
            if (this.discussionLoading) return;
            this.discussionLoading = true;

            try {
                const res = await fetch('/api/ai/discussion/summarize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: 0,
                        selected_text: this.selectedText,
                        conversation_history: this.conversationHistory,
                        provider: this.aiSettings.provider,
                    }),
                });
                const data = await res.json();

                if (data.status === 'success') {
                    this.discussionSummary = data.summary;
                    this.showDiscussionActions = true;
                    this.showSaveDiscussionBtn = true;
                    this.saveBtnDisabled = false;
                    this.saveBtnText = '保存总结';
                    this.showToast('对话总结完成', 'success');

                    // Show summary as a new message in the conversation
                    this.conversationHistory.push({
                        role: 'assistant',
                        content: '**📝 对话总结**\n\n' + data.summary
                    });
                    this._renderMathInPanel();
                    this.$nextTick(() => this.scrollToBottom());
                } else {
                    this.showToast('总结失败，请重试', 'error');
                }
            } catch (error) {
                console.error('Discussion summarize error:', error);
                this.showToast('发生错误: ' + error.message, 'error');
            } finally {
                this.discussionLoading = false;
            }
        },

        async saveDiscussionSummary() {
            if (!this.discussionSummary) {
                this.showToast('没有可保存的总结', 'info');
                return;
            }

            this.saveBtnText = '保存中...';
            const ok = await this._persistDiscussion(this.discussionSummary);
            if (ok) {
                this.discussionSaved = true;
                this.saveBtnText = '已保存';
                this.showToast('讨论总结已保存', 'success');
            } else {
                this.saveBtnText = '保存总结';
            }
        },

        // Persist a discussion as a highlight + discussion analysis. Returns true on success.
        async _persistDiscussion(content) {
            if (!content) {
                this.showToast('没有可保存的内容', 'info');
                return false;
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
                if (!highlightData.highlight_id) {
                    throw new Error(highlightData.detail || 'Failed to create highlight');
                }
                this.currentHighlightId = highlightData.highlight_id;

                const saveRes = await fetch('/api/ai/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        highlight_id: this.currentHighlightId,
                        analysis_type: 'discussion',
                        prompt: this.selectedText,
                        response: content,
                    }),
                });
                const saveData = await saveRes.json();
                if (saveData.status === 'success') {
                    this.currentAnalysisId = saveData.analysis_id;
                    this.showSaved = true;
                    await this.loadSavedHighlights();
                    return true;
                }
                this.saveBtnDisabled = false;
                this.showToast('保存失败', 'error');
                return false;
            } catch (error) {
                console.error('Save discussion error:', error);
                this.saveBtnDisabled = false;
                this.showToast('保存失败', 'error');
                return false;
            }
        },

        // Save the discussion (summary if available, otherwise the raw transcript) and close.
        async saveDiscussionAndClose() {
            let content = this.discussionSummary;
            let savedSummary = false;
            if (!content) {
                content = this.conversationHistory
                    .map((m) => `${m.role === 'user' ? '我' : 'AI助手'}: ${m.content}`)
                    .join('\n\n');
            } else {
                savedSummary = true;
            }
            if (!content) return false;

            const ok = await this._persistDiscussion(content);
            if (ok) {
                this.discussionSaved = true;
                this.showToast(savedSummary ? '讨论总结已保存' : '讨论已保存(原文)', 'success');
            }
            return ok;
        },

        clearDiscussionInput() {
            this.discussionInput = '';
            this.$refs.discussionTextarea?.focus();
        },

        formatMessage(content) {
            if (!content) return '';
            return renderMarkdown(content);
        },

        scrollToBottom() {
            const container = document.querySelector('#discussion-chat-area .conversation-container');
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        },

        _renderMathInPanel() {
            this.$nextTick(() => {
                if (window.MathJax && MathJax.typesetPromise) {
                    const panel = document.getElementById('ai-panel');
                    if (panel) {
                        MathJax.typesetPromise([panel]).catch(() => {});
                    }
                }
            });
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
                    this.hideContextMenu();
                    this.requestClosePanel();
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
                    this.requestClosePanel();
                }
            });
        },
    },
};
