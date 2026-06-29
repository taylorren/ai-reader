import { ref } from 'vue'
import { useReaderStore } from '@/stores/reader'
import { api } from '@/api'

export function useHighlights() {
  const store = useReaderStore()
  const contentRef = ref<HTMLElement | null>(null)
  
  // Load highlights for current chapter
  async function loadHighlights() {
    if (!store.bookId || store.chapterIndex === undefined) return
    
    try {
      const highlights = await api.getHighlights(store.bookId, store.chapterIndex)
      store.setHighlights(highlights)
      applyHighlights()
    } catch (error) {
      console.error('Failed to load highlights:', error)
    }
  }
  
  // Apply visual highlights to content
  function applyHighlights() {
    if (!contentRef.value) return
    
    // Clear existing highlights
    const existing = contentRef.value.querySelectorAll('.saved-highlight')
    existing.forEach(el => {
      const parent = el.parentNode
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el)
      }
      parent?.removeChild(el)
    })
    
    contentRef.value.normalize()
    
    // Apply new highlights
    store.highlights.forEach(highlight => {
      const range = findTextRange(contentRef.value!, highlight.selected_text)
      if (range) {
        wrapRange(range, highlight)
      }
    })
  }
  
  // Find text range in content
  function findTextRange(root: HTMLElement, text: string): Range | null {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      null
    )
    
    let node: Node | null
    let fullText = ''
    const nodes: Text[] = []
    
    while ((node = walker.nextNode())) {
      if (node.textContent) {
        nodes.push(node as Text)
        fullText += node.textContent
      }
    }
    
    const index = fullText.indexOf(text)
    if (index === -1) return null
    
    const range = document.createRange()
    let charCount = 0
    let startNode: Text | null = null
    let startOffset = 0
    let endNode: Text | null = null
    let endOffset = 0
    
    for (const textNode of nodes) {
      const nodeLength = textNode.textContent?.length || 0
      
      if (!startNode && charCount + nodeLength > index) {
        startNode = textNode
        startOffset = index - charCount
      }
      
      if (startNode && charCount + nodeLength >= index + text.length) {
        endNode = textNode
        endOffset = index + text.length - charCount
        break
      }
      
      charCount += nodeLength
    }
    
    if (startNode && endNode) {
      range.setStart(startNode, startOffset)
      range.setEnd(endNode, endOffset)
      return range
    }
    
    return null
  }
  
  // Wrap range with highlight span
  function wrapRange(range: Range, highlight: any) {
    const span = document.createElement('span')
    span.className = 'saved-highlight'
    span.dataset.highlightId = String(highlight.id)
    
    // Determine highlight type
    const analysisType = highlight.analyses?.[0]?.analysis_type || 'comment'
    span.dataset.type = analysisType
    
    try {
      range.surroundContents(span)
    } catch (e) {
      // Fallback for complex ranges
      const contents = range.extractContents()
      span.appendChild(contents)
      range.insertNode(span)
    }
  }
  
  // Handle text selection
  function handleSelection() {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    
    const text = selection.toString().trim()
    if (text.length === 0) {
      store.clearSelection()
      return
    }
    
    const range = selection.getRangeAt(0)
    store.setSelection(text, range)
  }
  
  // Create highlight
  async function createHighlight() {
    if (!store.selectedText || !store.bookId) return
    
    try {
      const highlight = await api.createHighlight({
        book_id: store.bookId,
        chapter_index: store.chapterIndex,
        selected_text: store.selectedText,
        context_before: '',
        context_after: '',
      })
      
      store.addHighlight(highlight)
      store.currentHighlightId = highlight.id
      applyHighlights()
      
      return highlight
    } catch (error) {
      console.error('Failed to create highlight:', error)
      throw error
    }
  }
  
  // Delete highlight
  async function deleteHighlight(id: number) {
    try {
      await api.deleteHighlight(id)
      store.removeHighlight(id)
      applyHighlights()
    } catch (error) {
      console.error('Failed to delete highlight:', error)
      throw error
    }
  }
  
  return {
    contentRef,
    loadHighlights,
    applyHighlights,
    handleSelection,
    createHighlight,
    deleteHighlight,
  }
}
