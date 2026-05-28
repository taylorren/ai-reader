const { createApp } = Vue;

const libraryApp = createApp({
    data() {
        return {
            activeTitleGroupFilter: "all",
            uploadStatus: "",
            statusMessage: "",
            uploadProgress: 0,
            showUnfinishedOnly: false,
        };
    },
    mounted() {
        this.loadTheme();
        this.loadAISettings();
        this.applyProgressWidths();
        this.exposeLegacyHandlers();
    },
    methods: {
        exposeLegacyHandlers() {
            window.toggleTheme = this.toggleTheme;
            window.filterBooks = this.filterBooks;
            window.setTitleGroupFilter = this.setTitleGroupFilter;
            window.toggleAIProviderSetting = this.toggleAIProviderSetting;
            window.toggleViewFilter = this.toggleViewFilter;
            window.handleToggleKey = this.handleToggleKey;
            window.toggleMenu = this.toggleMenu;
            window.viewHighlights = this.viewHighlights;
            window.toggleCompleted = this.toggleCompleted;
            window.deleteBook = this.deleteBook;
            window.handleFileUpload = this.handleFileUpload;
        },
        loadTheme() {
            const savedTheme = localStorage.getItem("reader-theme");
            if (savedTheme === "dark") {
                document.body.classList.add("dark-mode");
                document.getElementById("theme-icon").textContent = "☀️";
            }
        },
        toggleTheme() {
            const icon = document.getElementById("theme-icon");
            const isDark = document.body.classList.toggle("dark-mode");
            icon.textContent = isDark ? "☀️" : "🌙";
            localStorage.setItem("reader-theme", isDark ? "dark" : "light");
        },
        applyProgressWidths() {
            document.querySelectorAll(".progress-bar-fill[data-progress-percent]").forEach((bar) => {
                bar.style.width = `${bar.dataset.progressPercent || "0"}%`;
            });
        },
        loadAISettings() {
            const savedMode = localStorage.getItem("ai-mode");
            let mode = savedMode;
            if (!mode) {
                const legacyProvider = localStorage.getItem("ai-provider");
                mode = legacyProvider === "deepseek" || legacyProvider === "ollama_cloud" ? "remote" : "local";
            }
            this.updateAIProviderToggle(mode || "local");
        },
        saveAISettings(mode) {
            const provider = mode === "remote" ? "ollama_cloud" : "ollama";
            localStorage.setItem("ai-mode", mode);
            localStorage.setItem("ai-provider", provider);
        },
        updateAIProviderToggle(mode) {
            const toggle = document.getElementById("ai-provider-toggle");
            if (!toggle) return;
            const isCloud = mode === "remote";
            toggle.classList.toggle("active", isCloud);
            toggle.setAttribute("aria-checked", String(isCloud));
        },
        toggleAIProviderSetting() {
            const toggle = document.getElementById("ai-provider-toggle");
            const nextMode = toggle && toggle.classList.contains("active") ? "local" : "remote";
            this.updateAIProviderToggle(nextMode);
            this.saveAISettings(nextMode);
        },
        updateViewToggle(showUnfinishedOnly) {
            const toggle = document.getElementById("view-toggle");
            if (!toggle) return;
            toggle.classList.toggle("active", showUnfinishedOnly);
            toggle.setAttribute("aria-checked", String(showUnfinishedOnly));
        },
        toggleViewFilter() {
            this.showUnfinishedOnly = !this.showUnfinishedOnly;
            this.updateViewToggle(this.showUnfinishedOnly);
            this.filterBooks();
        },
        handleToggleKey(event, toggleFn) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleFn();
            }
        },
        setTitleGroupFilter(group) {
            this.activeTitleGroupFilter = group;
            document.querySelectorAll(".library-index-link[data-group]").forEach((link) => {
                link.classList.toggle("active", link.dataset.group === group);
            });
            this.filterBooks();
        },
        filterBooks() {
            const searchInput = document.getElementById("search-input");
            const searchTerm = searchInput.value.toLowerCase();
            const cards = document.querySelectorAll(".book-card");
            let visibleCount = 0;

            cards.forEach((card) => {
                const title = card.querySelector(".book-title").textContent.toLowerCase();
                const meta = card.querySelector(".book-meta").textContent.toLowerCase();
                const isCompleted = card.dataset.completed === "true";
                const matchesTitleGroup = this.activeTitleGroupFilter === "all" || card.dataset.group === this.activeTitleGroupFilter;
                const matchesSearch = title.includes(searchTerm) || meta.includes(searchTerm);
                const matchesCompletion = !this.showUnfinishedOnly || !isCompleted;
                const visible = matchesSearch && matchesCompletion && matchesTitleGroup;
                card.classList.toggle("hidden", !visible);
                if (visible) visibleCount += 1;
            });

            this.updateNoResults(visibleCount, searchInput.value, searchTerm);
        },
        updateNoResults(visibleCount, rawSearchTerm, searchTerm) {
            let noResults = document.getElementById("no-results-msg");
            const hasActiveFilter = searchTerm !== "" || this.showUnfinishedOnly || this.activeTitleGroupFilter !== "all";
            if (visibleCount === 0 && hasActiveFilter) {
                if (!noResults) {
                    noResults = document.createElement("div");
                    noResults.id = "no-results-msg";
                    noResults.className = "no-results";
                    document.querySelector(".book-grid").appendChild(noResults);
                }
                if (searchTerm !== "" && this.showUnfinishedOnly) {
                    noResults.textContent = `No unfinished books found matching "${rawSearchTerm}"`;
                } else if (searchTerm !== "") {
                    noResults.textContent = `No books found matching "${rawSearchTerm}"`;
                } else if (this.activeTitleGroupFilter !== "all") {
                    noResults.textContent = `No books found under ${this.activeTitleGroupFilter}`;
                } else {
                    noResults.textContent = "No unfinished books found";
                }
            } else if (noResults) {
                noResults.remove();
            }
        },
        toggleMenu(bookId, event) {
            event.stopPropagation();
            const menu = document.getElementById(`menu-${bookId}`);
            document.querySelectorAll(".dropdown-menu").forEach((item) => {
                if (item.id !== `menu-${bookId}`) item.classList.remove("show");
            });
            menu.classList.toggle("show");
        },
        openFilePicker() {
            document.getElementById("file-input").click();
        },
        viewHighlights(bookId, event) {
            event.stopPropagation();
            document.getElementById(`menu-${bookId}`).classList.remove("show");
            window.location.href = `/highlights/${bookId}`;
        },
        async toggleCompleted(bookId, event) {
            event.stopPropagation();
            const card = document.querySelector(`[data-book-id="${bookId}"]`);
            const nextCompleted = !(card && card.dataset.completed === "true");
            document.getElementById(`menu-${bookId}`).classList.remove("show");

            try {
                const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/completion?completed=${nextCompleted}`, {
                    method: "POST",
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.detail || "Failed to update completion");
                window.location.reload();
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        },
        async deleteBook(bookId, event) {
            event.stopPropagation();
            document.getElementById(`menu-${bookId}`).classList.remove("show");
            if (!confirm(`Delete "${bookId}"?\n\nNote: Your highlights and AI analyses will be kept in the database.`)) return;

            try {
                const response = await fetch(`/delete/${bookId}`, { method: "DELETE" });
                const result = await response.json();
                if (!response.ok) throw new Error(result.detail || "Failed to delete book");

                const card = document.querySelector(`[data-book-id="${bookId}"]`);
                card.style.opacity = "0";
                card.style.transform = "scale(0.8)";
                setTimeout(() => card.remove(), 300);
                this.showStatus(`✓ ${result.message}`, "success");
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
        },
        handleFileUpload(event) {
            const file = event.target.files[0];
            if (file) this.uploadFile(file);
        },
        async uploadFile(file) {
            this.uploadProgress = 30;
            this.showStatus(`Uploading ${file.name}...`, "");

            const formData = new FormData();
            formData.append("file", file);

            try {
                const response = await fetch("/upload", { method: "POST", body: formData });
                const result = await response.json();
                if (!response.ok) throw new Error(result.detail || "Upload failed");

                this.uploadProgress = 100;
                this.showStatus(`✓ ${result.message}`, "success");
                setTimeout(() => window.location.reload(), 2000);
            } catch (error) {
                this.uploadProgress = 0;
                this.showStatus(`✗ Error: ${error.message}`, "error");
            }
        },
        showStatus(message, state) {
            this.statusMessage = message;
            const status = document.getElementById("upload-status");
            const statusMessage = document.getElementById("status-message");
            const progress = document.getElementById("progress-fill");
            status.className = `upload-status show${state ? ` ${state}` : ""}`;
            statusMessage.textContent = message;
            progress.style.width = `${this.uploadProgress}%`;
            if (state === "success" && message.includes("Book deleted")) {
                setTimeout(() => {
                    status.className = "upload-status";
                }, 3000);
            }
        },
    },
}).mount("#library-app");

window.__VUE_LIBRARY_APP__ = libraryApp;

document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-btn")) {
        document.querySelectorAll(".dropdown-menu").forEach((menu) => menu.classList.remove("show"));
    }
});

const bookGrid = document.querySelector(".book-grid");
if (bookGrid) {
    bookGrid.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.stopPropagation();
        bookGrid.style.opacity = "0.7";
        bookGrid.style.background = "#e3f2fd";
    });

    bookGrid.addEventListener("dragleave", (event) => {
        event.preventDefault();
        event.stopPropagation();
        bookGrid.style.opacity = "1";
        bookGrid.style.background = "";
    });

    bookGrid.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();
        bookGrid.style.opacity = "1";
        bookGrid.style.background = "";

        const file = event.dataTransfer.files[0];
        if (!file) return;
        if (file.name.endsWith(".epub")) {
            window.__VUE_LIBRARY_APP__?.uploadFile(file);
        } else {
            alert("Please drop an EPUB file");
        }
    });
}
