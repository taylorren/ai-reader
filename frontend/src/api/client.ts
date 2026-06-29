import axios from 'axios'
import type { AxiosInstance } from 'axios'
import type {
  HighlightRequest,
  AIRequest,
  SaveAnalysisRequest,
  SettingsUpdate,
  ProgressUpdate,
  CompletionUpdate,
  Highlight,
  AIAnalysis,
  Settings,
} from './types'

class ApiClient {
  private client: AxiosInstance

  constructor(baseURL = '/api') {
    this.client = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }

  // Highlights
  async createHighlight(data: HighlightRequest): Promise<Highlight> {
    const response = await this.client.post<Highlight>('/highlight', data)
    return response.data
  }

  async deleteHighlight(highlightId: number): Promise<void> {
    await this.client.delete(`/highlight/${highlightId}`)
  }

  async getHighlights(bookId: string, chapterIndex: number): Promise<Highlight[]> {
    const response = await this.client.get<Highlight[]>(`/highlights/${bookId}/${chapterIndex}`)
    return response.data
  }

  // AI Analysis
  async analyzeText(data: AIRequest): Promise<{ response: string }> {
    const response = await this.client.post<{ response: string }>('/ai/analyze', data)
    return response.data
  }

  async saveAnalysis(data: SaveAnalysisRequest): Promise<AIAnalysis> {
    const response = await this.client.post<AIAnalysis>('/ai/save', data)
    return response.data
  }

  async updateAnalysis(analysisId: number, data: Partial<SaveAnalysisRequest>): Promise<void> {
    await this.client.put(`/ai/update/${analysisId}`, data)
  }

  async deleteAnalysis(analysisId: number): Promise<void> {
    await this.client.delete(`/ai/delete/${analysisId}`)
  }

  // Progress
  async saveProgress(data: ProgressUpdate): Promise<void> {
    await this.client.post('/progress', data)
  }

  async updateCompletion(bookId: string, data: CompletionUpdate): Promise<void> {
    await this.client.post(`/books/${bookId}/completion`, data)
  }

  // Settings
  async getSettings(): Promise<Settings> {
    const response = await this.client.get<Settings>('/settings')
    return response.data
  }

  async updateSettings(data: SettingsUpdate): Promise<Settings> {
    const response = await this.client.post<Settings>('/settings', data)
    return response.data
  }
}

export const api = new ApiClient()
export default api
