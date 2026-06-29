// API Request/Response Types

export interface HighlightRequest {
  book_id: string
  chapter_index: number
  selected_text: string
  context_before?: string
  context_after?: string
}

export interface AIRequest {
  highlight_id: number
  analysis_type: 'fact_check' | 'discussion'
  selected_text: string
  context?: string
  provider?: 'ollama' | 'ollama_cloud'
}

export interface SaveAnalysisRequest {
  highlight_id: number
  analysis_type: string
  prompt: string
  response: string
}

export interface SettingsUpdate {
  provider_override?: 'ollama' | 'ollama_cloud' | null
}

export interface ProgressUpdate {
  book_id: string
  chapter_index: number
}

export interface CompletionUpdate {
  is_completed: boolean
}

export interface Highlight {
  id: number
  book_id: string
  chapter_index: number
  selected_text: string
  context_before: string
  context_after: string
  created_at: string
}

export interface AIAnalysis {
  id: number
  highlight_id: number
  analysis_type: string
  prompt: string
  response: string
  created_at: string
}

export interface Settings {
  provider_override: string | null
  status?: string
}
