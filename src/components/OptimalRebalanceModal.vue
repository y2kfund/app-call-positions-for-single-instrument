<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  show: boolean
  position: any | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// Helper function to extract tags from symbol
function extractTagsFromSymbol(symbolText: string): string[] {
  if (!symbolText) return []
  const text = String(symbolText)
  const symMatch = text.match(/^([A-Z]+)\b/)
  const base = symMatch?.[1] ?? ''
  const rightMatch = text.match(/\s([CP])\b/)
  const right = rightMatch?.[1] ?? ''
  const strikeMatch = text.match(/\s(\d+(?:\.\d+)?)\s+[CP]\b/)
  const strike = strikeMatch?.[1] ?? ''
  const codeMatch = text.match(/\b(\d{6})[CP]/)
  const expiry = codeMatch ? formatExpiryFromYyMmDd(codeMatch[1]) : ''
  return [base, expiry, strike, right].filter(Boolean)
}

function formatExpiryFromYyMmDd(code: string): string {
  if (!code || code.length !== 6) return ''
  const yy = code.substring(0, 2)
  const mm = code.substring(2, 4)
  const dd = code.substring(4, 6)
  return `20${yy}-${mm}-${dd}`
}

const positionTags = computed(() => {
  if (!props.position?.symbol) return []
  return extractTagsFromSymbol(props.position.symbol)
})

const currentDelta = computed(() => {
  if (props.position?.delta == null) return 'N/A'
  return Number(props.position.delta).toFixed(3)
})

const currentDeltaPercent = computed(() => {
  if (props.position?.delta == null) return 'N/A'
  return (Math.abs(props.position.delta) * 100).toFixed(1) + '%'
})

function handleClose() {
  emit('close')
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="handleClose">
    <div class="modal-content optimal-rebalance-modal" @click.stop>
      <div class="modal-header">
        <h3>Optimal Rebalance Options</h3>
        <button class="modal-close" @click="handleClose">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="position" class="position-info" style="margin-bottom: 1.5rem;">
          <strong>Position:</strong>
          <span v-for="tag in positionTags" :key="tag" class="fi-tag position-tag">
            {{ tag }}
          </span>
        </div>

        <div class="delta-info">
          <div class="delta-current">
            <span class="delta-label">Current Delta:</span>
            <span class="delta-value delta-orange">{{ currentDelta }}</span>
            <span class="delta-percent">({{ currentDeltaPercent }})</span>
          </div>
        </div>

        <div class="coming-soon-container">
          <div class="coming-soon-icon">🚧</div>
          <h4>Coming Soon</h4>
          <p>Optimal rebalance option chain data and recommendations will be available here.</p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="handleClose">Close</button>
      </div>
    </div>
  </div>
</template>

<style>
/* Optimal Rebalance Modal styles */
.optimal-rebalance-modal {
  max-width: 500px;
  width: 90%;
}

.delta-info {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.delta-current {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.delta-label {
  font-weight: 600;
  color: #495057;
}

.delta-value {
  font-weight: 700;
  font-size: 1.1rem;
}

.delta-orange {
  color: #fd7e14;
}

.delta-percent {
  color: #6c757d;
  font-size: 0.9rem;
}

.coming-soon-container {
  text-align: center;
  padding: 2rem 1rem;
  background: #f8f9fa;
  border-radius: 8px;
  border: 2px dashed #dee2e6;
}

.coming-soon-icon {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.coming-soon-container h4 {
  margin: 0 0 0.5rem 0;
  color: #495057;
  font-size: 1.25rem;
}

.coming-soon-container p {
  margin: 0;
  color: #6c757d;
  font-size: 0.95rem;
}
</style>
