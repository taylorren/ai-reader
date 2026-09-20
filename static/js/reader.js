// Configure marked for safe rendering
marked.setOptions({
    breaks: true,
    gfm: true
});

const { createApp } = Vue;

createApp({
    mixins: [PanelMixin],
    delimiters: ['[[', ']]'],
    data() {
        return {
            // Book
            bookId: '',
            chapterIndex: 0,
            savedPercent: 0,
            savedAnchor: null,
            targetHighlightId: '',
            spineMap: {},
            savedHighlights: [],

            // AI provider (shared with PanelMixin)
            serverProviderOverride: null,
            serverDefaultProvider: 'ollama_cloud',

            // Settings dropdown
            showSettingsDropdown: false,

            // TOC sidebar visibility (persisted)
            sidebarOpen: true,

            // SPA chapter navigation
            loadingChapter: false,
            totalChapters: 0,
        };
    },

    mounted() {
        const readerDataEl = document.getElementById('reader-data');
        if (readerDataEl) {
            this.bookId = readerDataEl.dataset.bookId || '';
            this.chapterIndex = Number(readerDataEl.dataset.chapterIndex || 0);
            this.savedPercent = Number(readerDataEl.dataset.savedPercent || 0);
            const rawAnchor = readerDataEl.dataset.savedAnchor || '';
            if (rawAnchor) {
                try {
                    this.savedAnchor = JSON.parse(rawAnchor);
                } catch (e) {
                    console.warn('Failed to parse saved anchor:', e);
                }
            }
            this.targetHighlightId = readerDataEl.dataset.targetHighlightId || '';
            try {
                this.spineMap = JSON.parse(readerDataEl.dataset.spineMap || '{}');
            } catch (e) {
                console.warn('Failed to parse spine map:', e);
            }
            this.totalChapters = Number(readerDataEl.dataset.totalChapters || Object.keys(this.spineMap).length);
        }

        this.initializeProviderUI();        // PanelMixin
        this.restoreSidebarState();
        this.loadSavedHighlights();
        this.restoreScrollPosition();
        this.loadSavedSettings();
        this.setupProgressSaving();
        this.setupKeyboardShortcuts();
        this.setupContextMenu();            // PanelMixin
        this.setupPanelListeners();         // PanelMixin
        this.setupLinkInterceptor();

        window.addEventListener('popstate', (e) => {
            if (e.state && e.state.chapterIndex !== undefined && e.state.bookId === this.bookId) {
                this.saveProgress().then(() => {
                    this.loadChapterContent(e.state.chapterIndex);
                });
            }
        });

        this.$nextTick(() => {
            if (!this.sidebarOpen) return;
            const activeLink = document.querySelector('.toc-link.active');
            if (activeLink) {
                const sidebar = document.getElementById('sidebar');
                sidebar.scrollTop = activeLink.offsetTop - (sidebar.clientHeight / 2) + (activeLink.offsetHeight / 2);
            }
        });
    },

    watch: {
        sidebarOpen: {
            immediate: true,
            handler() {
                this.$nextTick(() => this.applySidebarClass());
            },
        },
    },

    methods: {
        // ---- TOC sidebar toggle ----

        restoreSidebarState() {
            const saved = localStorage.getItem('sidebarOpen');
            if (saved !== null) {
                this.sidebarOpen = saved === 'true';
            } else {
                // Default: hide the TOC on small/portrait screens (pads, tablets)
                const isSmall = window.innerWidth <= 1024;
                const isPortrait = window.innerHeight > window.innerWidth;
                this.sidebarOpen = !(isSmall || isPortrait);
            }
        },

        toggleSidebar() {
            this.sidebarOpen = !this.sidebarOpen;
            try {
                localStorage.setItem('sidebarOpen', String(this.sidebarOpen));
            } catch (e) { /* storage unavailable */ }
            if (this.sidebarOpen) {
                // Re-center the active TOC entry after the sidebar becomes visible
                this.$nextTick(() => {
                    const activeLink = document.querySelector('.toc-link.active');
                    if (activeLink) {
                        const sidebar = document.getElementById('sidebar');
                        sidebar.scrollTop = activeLink.offsetTop - (sidebar.clientHeight / 2) + (activeLink.offsetHeight / 2);
                    }
                });
            }
        },

        applySidebarClass() {
            // The mount root (#reader-app) can't carry Vue bindings, so toggle
            // the CSS class directly on the DOM element.
            const appEl = document.getElementById('reader-app');
            if (appEl) appEl.classList.toggle('sidebar-collapsed', !this.sidebarOpen);
        },

        // ---- Scroll progress (debounced) ----

        _debouncedSaveProgress() {
            if (this._saveTimer) clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => {
                this.saveProgress();
            }, 1500);
        },

        _debounceScrollHandler() {
            this._debouncedSaveProgress();
        },

        // ---- Navigation ----

        findAndGo(filename) {
            const cleanFile = filename.split('#')[0];
            const idx = this.spineMap[cleanFile];
            if (idx !== undefined) {
                this.navigateToChapter(idx);
            }
        },

        // ---- SPA Chapter Navigation ----

        async navigateToChapter(chapterIndex) {
            if (this.loadingChapter) return;
            if (chapterIndex === this.chapterIndex) return;
            if (chapterIndex < 0 || chapterIndex >= this.totalChapters) return;

            this.loadingChapter = true;

            // Save scroll progress of current chapter before leaving
            await this.saveProgress();

            // Update browser URL and history
            const url = `/read/${this.bookId}/${chapterIndex}`;
            history.pushState({ chapterIndex, bookId: this.bookId }, '', url);

            await this.loadChapterContent(chapterIndex);

            this.loadingChapter = false;
        },

        async loadChapterContent(chapterIndex) {
            const url = `/read/${this.bookId}/${chapterIndex}`;

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Extract book content from fetched page
                const newContent = doc.querySelector('#book-content');
                if (!newContent) throw new Error('Content element not found');

                // Fade out
                const bookContent = document.getElementById('book-content');
                bookContent.style.opacity = '0';

                // Wait for fade-out, then swap content
                await new Promise(r => setTimeout(r, 100));

                bookContent.innerHTML = newContent.innerHTML;
                this.chapterIndex = chapterIndex;
                this.targetHighlightId = '';
                this.savedPercent = 0;
                this.savedAnchor = null;

                // Scroll main to top
                const mainEl = document.getElementById('main');
                if (mainEl) mainEl.scrollTop = 0;

                // Reapply saved reading settings to new content
                this.reapplySettings();

                // Update nav buttons and chapter counter
                this.updateNavAndTOC(chapterIndex);

                // Load highlights for new chapter
                await this.loadSavedHighlights();

                // Fade in
                bookContent.style.opacity = '1';

                // Re-render MathJax for new content
                if (window.MathJax && MathJax.typesetPromise) {
                    try { await MathJax.typesetPromise([bookContent]); } catch (e) { /* ignore */ }
                }

            } catch (error) {
                console.error('Failed to load chapter:', error);
                // Fallback: full page navigation
                window.location.href = url;
            }
        },

        updateNavAndTOC(chapterIndex) {
            const total = this.totalChapters;
            const counterText = `第 ${chapterIndex + 1} / ${total} 节`;

            // Update chapter counter text in both sticky top nav and bottom nav
            document.querySelectorAll('.chapter-nav span').forEach(span => {
                if (span.textContent.includes('第 ') && span.textContent.includes(' 节')) {
                    span.textContent = counterText;
                }
            });

            // Update prev/next nav buttons
            const updateNav = (navEl) => {
                if (!navEl) return;
                const anchors = navEl.querySelectorAll('a.nav-btn, span.nav-btn');
                if (anchors.length < 2) return;

                // Prev button (first anchor/span)
                const prevEl = anchors[0];
                if (chapterIndex > 0) {
                    if (prevEl.tagName === 'SPAN') {
                        // Replace span with anchor
                        const a = document.createElement('a');
                        a.href = `/read/${this.bookId}/${chapterIndex - 1}`;
                        a.className = 'nav-btn';
                        a.textContent = '← 上一章';
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.navigateToChapter(chapterIndex - 1);
                        });
                        prevEl.replaceWith(a);
                    } else {
                        prevEl.href = `/read/${this.bookId}/${chapterIndex - 1}`;
                    }
                } else {
                    if (prevEl.tagName === 'A') {
                        const span = document.createElement('span');
                        span.className = 'nav-btn disabled';
                        span.textContent = '← 上一章';
                        prevEl.replaceWith(span);
                    }
                }

                // Next button (last anchor/span)
                const nextEl = anchors[anchors.length - 1];
                if (chapterIndex < total - 1) {
                    if (nextEl.tagName === 'SPAN') {
                        const a = document.createElement('a');
                        a.href = `/read/${this.bookId}/${chapterIndex + 1}`;
                        a.className = 'nav-btn';
                        a.textContent = '下一章 →';
                        a.addEventListener('click', (e) => {
                            e.preventDefault();
                            this.navigateToChapter(chapterIndex + 1);
                        });
                        nextEl.replaceWith(a);
                    } else {
                        nextEl.href = `/read/${this.bookId}/${chapterIndex + 1}`;
                    }
                } else {
                    if (nextEl.tagName === 'A') {
                        const span = document.createElement('span');
                        span.className = 'nav-btn disabled';
                        span.textContent = '下一章 →';
                        nextEl.replaceWith(span);
                    }
                }
            };

            document.querySelectorAll('.chapter-nav').forEach(updateNav);

            // Update TOC active link
            const href = this.getChapterHref(chapterIndex);
            document.querySelectorAll('.toc-link').forEach(link => {
                const isActive = link.dataset.fileHref === href;
                link.classList.toggle('active', isActive);
            });

            // Scroll TOC to active link
            const activeLink = document.querySelector('.toc-link.active');
            if (activeLink) {
                const sidebar = document.getElementById('sidebar');
                sidebar.scrollTop = activeLink.offsetTop - (sidebar.clientHeight / 2) + (activeLink.offsetHeight / 2);
            }
        },

        getChapterHref(chapterIndex) {
            return Object.entries(this.spineMap).find(([, idx]) => idx === chapterIndex)?.[0] || '';
        },

        reapplySettings() {
            // Reapply font, size, line-height, theme from localStorage to the new content
            const bookContent = document.getElementById('book-content');
            if (!bookContent) return;

            const savedFont = localStorage.getItem('reader-font');
            const savedSize = localStorage.getItem('reader-font-size');
            const savedHeight = localStorage.getItem('reader-line-height');

            if (savedFont) bookContent.style.fontFamily = savedFont;
            if (savedSize) bookContent.style.fontSize = savedSize + 'px';
            if (savedHeight) bookContent.style.lineHeight = savedHeight;
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

        // ---- Progress ----

        setupProgressSaving() {
            const main = document.getElementById('main');
            if (main) {
                main.addEventListener('scroll', () => this._debounceScrollHandler());
            }

            window.addEventListener('beforeunload', () => this.saveProgress());
            window.addEventListener('pagehide', () => this.saveProgress());

            // Nav button click → SPA navigation
            document.querySelectorAll('.nav-btn:not(.disabled)').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    const match = btn.href.match(/\/read\/[^/]+\/(\d+)/);
                    if (match) {
                        this.navigateToChapter(Number(match[1]));
                    }
                });
            });

            // Home link → full navigation (different page)
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
            const pos = this.computeReadingPosition();
            if (!pos) return Promise.resolve();

            const params = new URLSearchParams({
                book_id: this.bookId,
                chapter_index: this.chapterIndex,
                scroll_percent: pos.percent.toFixed(4),
            });
            if (pos.anchor) params.set('anchor', JSON.stringify(pos.anchor));

            return fetch(`/api/progress?${params.toString()}`, {
                method: 'POST',
                keepalive: true,
            }).catch(error => console.error('Failed to save progress:', error));
        },

        // ---- Position computation (device-independent) ----

        computeReadingPosition() {
            const main = document.getElementById('main');
            const content = document.getElementById('book-content');
            if (!main || !content) return null;

            const scrollable = main.scrollHeight - main.clientHeight;
            const percent = scrollable > 0
                ? Math.min(1, Math.max(0, main.scrollTop / scrollable)) : 0;

            return { percent, anchor: this._computeAnchor(main, content) };
        },

        // Anchor = identity of the text element at the bottom of the viewport
        // (the last line the reader has seen), as a path of
        // [tag, nth-of-type index] steps from #book-content.
        _computeAnchor(main, content) {
            const mainRect = main.getBoundingClientRect();
            let element = null;

            // Preferred: caret position just above the bottom edge.
            const x = mainRect.left + Math.min(80, main.clientWidth / 2);
            const y = mainRect.bottom - 40;
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(x, y);
                if (range && content.contains(range.startContainer)) {
                    element = range.startContainer.parentElement;
                }
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(x, y);
                if (pos && content.contains(pos.offsetNode)) {
                    element = pos.offsetNode.parentElement;
                }
            }
            if (!element || element === content) {
                element = this._lastVisibleElement(content, mainRect);
            }
            if (!element) return null;

            const path = this._elementPath(element, content);
            if (!path.length) return null;
            return { p: path, o: 0 };
        },

        _lastVisibleElement(content, mainRect) {
            const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
            let node;
            let last = null;
            while ((node = walker.nextNode())) {
                if (!node.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                if (rect.bottom > mainRect.top && rect.top < mainRect.bottom) {
                    last = node.parentElement;
                }
            }
            return last;
        },

        _elementPath(element, root) {
            const path = [];
            let current = element;
            while (current && current !== root) {
                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName) index++;
                    sibling = sibling.previousElementSibling;
                }
                path.unshift([current.tagName.toLowerCase(), index]);
                current = current.parentElement;
            }
            return path;
        },

        _resolvePath(path, root) {
            let current = root;
            for (const [tag, index] of path) {
                if (!current) return null;
                const matches = current.querySelectorAll(':scope > ' + tag);
                current = matches[index - 1] || null;
            }
            return current;
        },

        restoreScrollPosition() {
            if (this.targetHighlightId) return;
            if (!this.savedAnchor && !(this.savedPercent > 0)) return;

            const main = document.getElementById('main');
            if (!main) return;

            let attempts = 0;
            const restore = () => {
                let restored = false;
                if (this.savedAnchor) restored = this._restoreFromAnchor(main);
                if (!restored && this.savedPercent > 0) {
                    restored = this._restoreFromPercent(main);
                }
                if (restored) {
                    if (!this._positionToastShown) {
                        this._positionToastShown = true;
                        // Position is anchored at the bottom of the viewport
                        // (the last line seen), so the hint appears at the
                        // bottom, just below that line.
                        this.showToast('已回到上次阅读的位置', 'info');
                    }
                    return;
                }
                if (!restored && attempts < 5) {
                    attempts++;
                    setTimeout(restore, 200);
                }
            };
            setTimeout(restore, 100);
        },

        _restoreFromPercent(main) {
            const scrollable = main.scrollHeight - main.clientHeight;
            if (scrollable <= 0) return false; // content not laid out yet
            main.scrollTop = this.savedPercent * scrollable;
            return true;
        },

        _restoreFromAnchor(main) {
            const content = document.getElementById('book-content');
            if (!content) return false;

            const element = this._resolvePath(this.savedAnchor.p, content);
            if (!element) return false;

            const elementBottom = element.getBoundingClientRect().bottom
                - main.getBoundingClientRect().top
                + main.scrollTop;
            const scrollable = main.scrollHeight - main.clientHeight;
            // Place the last-read line ~100px above the viewport bottom, so
            // the "resume reading" toast (bottom) doesn't cover it.
            const target = elementBottom - main.clientHeight + 100;
            main.scrollTop = scrollable > 0 ? Math.min(Math.max(target, 0), scrollable) : 0;
            return true;
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

        // ---- Keyboard (non-panel keys; panel ESC is in PanelMixin) ----

        setupKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

                const modal = document.getElementById('link-modal');
                const isModalOpen = modal && modal.classList.contains('show');

                if (e.key === 'Escape') {
                    if (isModalOpen) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.closeModal();
                    }
                    // Panel / context-menu ESC is handled by PanelMixin.setupPanelListeners()
                } else if (e.key === 'ArrowLeft') {
                    if (this.chapterIndex > 0) {
                        e.preventDefault();
                        this.navigateToChapter(this.chapterIndex - 1);
                    }
                } else if (e.key === 'ArrowRight') {
                    if (this.chapterIndex < this.totalChapters - 1) {
                        e.preventDefault();
                        this.navigateToChapter(this.chapterIndex + 1);
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
    },
}).mount('#reader-app');
