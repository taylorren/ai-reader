import { useReaderStore } from '@/stores/reader'
import { api } from '@/api'

export function useAI() {
  const store = useReaderStore()
  
  async function analyzeText(type: 'fact_check' | 'discussion', highlightId: number) {
    if (!store.selectedText) return
    
    store.aiLoading = true
    store.openAIPanel()
    
    try {
      const result = await api.analyzeText({
        highlight_id: highlightId,
        analysis_type: type,
        selected_text: store.selectedText,
        context: '',
        provider: store.aiProvider,
      })
      
      store.aiResponse = result.response
    } catch (error) {
      console.error('AI analysis failed:', error)
      store.aiResponse = 'Error: Failed to analyze text'
    } finally {
      store.aiLoading = false
    }
  }
  
  async function saveAnalysis(highlightId: number, type: string, prompt: string) {
    if (!store.aiResponse) return
    
    try {
      await api.saveAnalysis({
        highlight_id: highlightId,
        analysis_type: type,
        prompt,
        response: store.aiResponse,
      })
    } catch (error) {
      console.error('Failed to save analysis:', error)
      throw error
    }
  }
  
  async function addComment(highlightId: number, comment: string) {
    try {
      await api.saveAnalysis({
        highlight_id: highlightId,
        analysis_type: 'comment',
        prompt: '',
        response: comment,
      })
    } catch (error) {
      console.error('Failed to save comment:', error)
      throw error
    }
  }
  
  return {
    analyzeText,
    saveAnalysis,
    addComment,
  }
}
