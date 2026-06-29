<script setup lang="ts">
import { useReaderStore } from '@/stores/reader'
import { useAI } from '@/composables/useAI'

const store = useReaderStore()
const { saveAnalysis } = useAI()

async function handleSave() {
  if (!store.currentHighlightId || !store.aiResponse) return
  
  try {
    await saveAnalysis(store.currentHighlightId, 'fact_check', store.selectedText)
    alert('Analysis saved!')
  } catch (error) {
    alert('Failed to save analysis')
  }
}

function handleClose() {
  store.closeAIPanel()
}
</script>

<template>
  <div
    v-if="store.showAIPanel"
    class="fixed right-0 top-0 h-full w-96 bg-white shadow-lg border-l border-gray-200 z-50 flex flex-col"
  >
    <div class="flex items-center justify-between p-4 border-b">
      <h2 class="text-lg font-semibold">AI Analysis</h2>
      <button
        @click="handleClose"
        class="text-gray-500 hover:text-gray-700"
      >
        ✕
      </button>
    </div>
    
    <div class="flex-1 overflow-y-auto p-4">
      <div v-if="store.aiLoading" class="text-center py-8">
        <div class="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        <p class="mt-2 text-gray-600">Analyzing...</p>
      </div>
      
      <div v-else-if="store.aiResponse" class="prose prose-sm max-w-none">
        <div v-html="store.aiResponse"></div>
      </div>
      
      <div v-else class="text-gray-500 text-center py-8">
        No analysis yet
      </div>
    </div>
    
    <div v-if="store.aiResponse && !store.aiLoading" class="p-4 border-t">
      <button
        @click="handleSave"
        class="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
      >
        Save Analysis
      </button>
    </div>
  </div>
</template>
