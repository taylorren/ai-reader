import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Highlight, AIAnalysis } from '@/api/types'

export const useReaderStore = defineStore('reader', () => {
  // State
  const bookId = ref<string>('')
  const chapterIndex = ref<number>(0)
  const highlights = ref<Highlight[]>([])
  const selectedText = ref<string>('')
  const selectedRange = ref<Range | null>(null)
  const currentHighlightId = ref<number | null>(null)
  const currentAnalysis = ref<AIAnalysis | null>(null)
  
  // UI State
  const showContextMenu = ref(false)
  const contextMenuPosition = ref({ x: 0, y: 0 })
  const showAIPanel = ref(false)
  const aiLoading = ref(false)
  const aiResponse = ref<string>('')
  
  // Settings
  const aiProvider = ref<'ollama' | 'ollama_cloud'>('ollama_cloud')
  
  // Computed
  const hasSelection = computed(() => selectedText.value.length > 0)
  const currentHighlight = computed(() => 
    highlights.value.find(h => h.id === currentHighlightId.value)
  )
  
  // Actions
  function setBook(id: string, index: number) {
    bookId.value = id
    chapterIndex.value = index
  }
  
  function setSelection(text: string, range: Range | null) {
    selectedText.value = text
    selectedRange.value = range
  }
  
  function clearSelection() {
    selectedText.value = ''
    selectedRange.value = null
  }
  
  function addHighlight(highlight: Highlight) {
    highlights.value.push(highlight)
  }
  
  function removeHighlight(id: number) {
    const index = highlights.value.findIndex(h => h.id === id)
    if (index !== -1) {
      highlights.value.splice(index, 1)
    }
  }
  
  function setHighlights(newHighlights: Highlight[]) {
    highlights.value = newHighlights
  }
  
  function openContextMenu(x: number, y: number) {
    contextMenuPosition.value = { x, y }
    showContextMenu.value = true
  }
  
  function closeContextMenu() {
    showContextMenu.value = false
  }
  
  function openAIPanel() {
    showAIPanel.value = true
  }
  
  function closeAIPanel() {
    showAIPanel.value = false
    aiResponse.value = ''
    aiLoading.value = false
  }
  
  return {
    // State
    bookId,
    chapterIndex,
    highlights,
    selectedText,
    selectedRange,
    currentHighlightId,
    currentAnalysis,
    showContextMenu,
    contextMenuPosition,
    showAIPanel,
    aiLoading,
    aiResponse,
    aiProvider,
    
    // Computed
    hasSelection,
    currentHighlight,
    
    // Actions
    setBook,
    setSelection,
    clearSelection,
    addHighlight,
    removeHighlight,
    setHighlights,
    openContextMenu,
    closeContextMenu,
    openAIPanel,
    closeAIPanel,
  }
})
