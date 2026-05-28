const { createApp } = Vue;

createApp({
    methods: {
        findAndGo(filename) {
            window.findAndGo(filename);
        },
        toggleSettings(event) {
            window.toggleSettings(event);
        },
        toggleAIProvider() {
            window.toggleAIProvider();
        },
        toggleTheme() {
            window.toggleTheme();
        },
        togglePaperMode() {
            window.togglePaperMode();
        },
        setFont(fontFamily, event) {
            window.setFont(fontFamily, event);
        },
        setFontSize(value) {
            window.setFontSize(value);
        },
        setLineHeight(value) {
            window.setLineHeight(value);
        },
        closePanel() {
            window.closePanel();
        },
        saveAnalysis() {
            window.saveAnalysis();
        },
        deleteCurrentHighlight() {
            window.deleteCurrentHighlight();
        },
        saveComment() {
            window.saveComment();
        },
        updateComment() {
            window.updateComment();
        },
        togglePanel() {
            window.togglePanel();
        },
        closeModal(event) {
            window.closeModal(event);
        },
        handleContextAction(type) {
            window.handleContextAction(type);
        },
    },
}).mount("#reader-app");
