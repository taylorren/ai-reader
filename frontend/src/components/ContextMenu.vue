<script setup lang="ts">
import { useReaderStore } from '@/stores/reader'
import { useHighlights } from '@/composables/useHighlights'
import { useAI } from '@/composables/useAI'

const store = useReaderStore()
const { createHighlight } = useHighlights()
const { analyzeText, addComment } = useAI()

async function handleFactCheck() {
  store.closeContextMenu()
  
  try {
    const highlight = await createHighlight()
    if (highlight) {
      await analyzeText('fact_check', highlight.id)
    }
  } catch (error) {
    console.error('Fact check failed:', error)
  }
}

async function handleDiscussion() {
  store.closeContextMenu()
  
  try {
    const highlight = await createHighlight()
    if (highlight) {
      await analyzeText('discussion', highlight.id)
    }
  } catch (error) {
    console.error('Discussion failed:', error)
  }
}

async function handleComment() {
  store.closeContextMenu()
  
  const comment = prompt('Enter your comment:')
  if (!comment) return
  
  try {
    const highlight = await createHighlight()
    if (highlight) {
      await addComment(highlight.id, comment)
    }
  } catch (error) {
    console.error('Comment failed:', error)
  }
}

function handleCopy() {
  navigator.clipboard.writeText(store.selectedText)
  store.closeContextMenu()
}
</script>

<template>
  <div
    v-if="store.showContextMenu && store.hasSelection"
    :style="{
      position: 'fixed',
      left: `${store.contextMenuPosition.x}px`,
      top: `${store.contextMenuPosition.y}px`,
    }"
    class="bg-white shadow-lg rounded-lg border border-gray-200 py-2 z-50 min-w-48"
  >
    <button
      @click="handleFactCheck"
      class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
    >
      <span>📋</span>
      <span>Fact Check</span>
    </button>
    
    <button
      @click="handleDiscussion"
      class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
    >
      <span>💡</span>
      <span>Discussion</span>
    </button>
    
    <button
      @click="handleComment"
      class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
    >
      <span>💬</span>
      <span>Add Comment</span>
    </button>
    
    <div class="border-t border-gray-200 my-1"></div>
    
    <button
      @click="handleCopy"
      class="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center gap-2"
    >
      <span>📄</span>
      <span>Copy Text</span>
    </button>
  </div>
</template>
