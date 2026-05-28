const { createApp } = Vue;

createApp({
    data() {
        return {
            currentFilter: "all",
        };
    },
    mounted() {
        this.loadTheme();
        this.renderMarkdown();
        this.exposeLegacyHandlers();
    },
    methods: {
        exposeLegacyHandlers() {
            window.toggleTheme = this.toggleTheme;
            window.filterHighlights = this.filterHighlights;
            window.exportHighlights = this.exportHighlights;
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
        normalizeSavedAnalysisContent(text) {
            if (!text) return "";
            return text.replace(/^(Using:\s*(?:🏠 Local|☁️ Cloud))(?=\S)/m, "$1\n\n");
        },
        renderMarkdown() {
            marked.setOptions({ breaks: true, gfm: true });
            document.querySelectorAll(".analysis-content").forEach((element) => {
                const type = element.getAttribute("data-type");
                if (type === "fact_check" || type === "discussion") {
                    const text = this.normalizeSavedAnalysisContent(element.textContent);
                    element.innerHTML = marked.parse(text);
                }
            });
        },
        filterHighlights(type, event) {
            this.currentFilter = type;
            document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));
            if (event?.target) event.target.classList.add("active");

            document.querySelectorAll(".highlight-item").forEach((item) => {
                item.style.display = type === "all" || item.dataset.type === type ? "block" : "none";
            });
        },
        exportHighlights() {
            const items = document.querySelectorAll(".highlight-item");
            const bookTitle = document.getElementById("highlights-app").dataset.bookTitle;
            const exportData = [];

            items.forEach((item) => {
                if (item.style.display === "none") return;
                const type = item.dataset.type;
                const typeLabel = type === "fact_check" ? "解释说明" : type === "discussion" ? "深入讨论" : "个人笔记";
                const chapter = item.querySelector(".highlight-chapter").textContent;
                const text = item.querySelector(".highlight-text").textContent.replace(/^"|"$/g, "");
                const analysisContent = item.querySelector(".analysis-content");
                const analysis = analysisContent ? analysisContent.textContent.trim() : "";
                exportData.push({ type: typeLabel, chapter, text, analysis });
            });

            let markdown = `# ${bookTitle} - Highlights\n\n`;
            markdown += `Exported: ${new Date().toLocaleString()}\n`;
            markdown += `Filter: ${this.currentFilter === "all" ? "All" : this.currentFilter.replace("_", " ")}\n`;
            markdown += `Total: ${exportData.length} highlights\n\n---\n\n`;

            exportData.forEach((item, index) => {
                markdown += `## ${index + 1}. ${item.type}\n\n`;
                markdown += `**${item.chapter}**\n\n`;
                markdown += `> ${item.text}\n\n`;
                if (item.analysis) markdown += `### Analysis:\n\n${item.analysis}\n\n`;
                markdown += "---\n\n";
            });

            const charCount = markdown.length;
            const tokenEstimate = Math.ceil(charCount / 4);
            if (!this.confirmLargeExport(tokenEstimate, charCount)) return;

            const blob = new Blob([markdown], { type: "text/markdown" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `${bookTitle.replace(/[^a-z0-9]/gi, "_")}_highlights_${Date.now()}.md`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        },
        confirmLargeExport(tokenEstimate, charCount) {
            if (tokenEstimate > 100000) {
                return confirm(`⚠️ Warning: Export is very large (~${tokenEstimate.toLocaleString()} tokens, ${(charCount / 1000).toFixed(1)}K chars).\n\nThis exceeds most AI context limits.\n\nConsider filtering to reduce size.\n\nContinue export anyway?`);
            }
            if (tokenEstimate > 50000) {
                return confirm(`⚠️ Notice: Export is large (~${tokenEstimate.toLocaleString()} tokens, ${(charCount / 1000).toFixed(1)}K chars).\n\nThis may exceed some AI context limits.\n\nContinue export?`);
            }
            return true;
        },
    },
}).mount("#highlights-app");
