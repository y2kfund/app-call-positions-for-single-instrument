<script setup lang="ts">
import { computed } from 'vue'
import type { RebalanceForm } from '../composables/useRebalance'

interface Props {
  show: boolean
  position: any | null
  form: RebalanceForm
  isSaving?: boolean
  isEditing?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isSaving: false,
  isEditing: false
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save'): void
  (e: 'update:form', value: RebalanceForm): void
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

function validateIntegerInput(event: Event) {
  const input = event.target as HTMLInputElement
  // Remove any non-digit characters
  input.value = input.value.replace(/[^0-9]/g, '')
}

function updateFormField(field: keyof RebalanceForm, value: string) {
  emit('update:form', {
    ...props.form,
    [field]: value.replace(/[^0-9]/g, '')
  })
}

function handleClose() {
  emit('close')
}

function handleSave() {
  emit('save')
}
</script>

<template>
  <div v-if="show" class="modal-overlay" @click="handleClose">
    <div class="modal-content rebalance-modal" @click.stop>
      <div class="modal-header">
        <h3>{{ isEditing ? 'Edit Rebalance Settings' : 'Rebalance Settings' }}</h3>
        <button class="modal-close" @click="handleClose">&times;</button>
      </div>

      <div class="modal-body">
        <div v-if="position" class="position-info" style="margin-bottom: 1.5rem;">
          <strong>Position:</strong>
          <span v-for="tag in positionTags" :key="tag" class="fi-tag position-tag">
            {{ tag }}
          </span>
        </div>

        <div class="rebalance-form">
          <div class="form-group">
            <label class="form-label">Delta Range</label>
            <div class="range-inputs">
              <input
                :value="form.deltaStart"
                type="text"
                class="form-input"
                placeholder="Start"
                @input="(e) => updateFormField('deltaStart', (e.target as HTMLInputElement).value)"
              />
              <span class="range-separator">-</span>
              <input
                :value="form.deltaEnd"
                type="text"
                class="form-input"
                placeholder="End"
                @input="(e) => updateFormField('deltaEnd', (e.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Desired Delta</label>
            <input
              :value="form.desiredDelta"
              type="text"
              class="form-input"
              placeholder="Enter desired delta"
              @input="(e) => updateFormField('desiredDelta', (e.target as HTMLInputElement).value)"
            />
          </div>

          <div class="form-group">
            <label class="form-label">DTE Range</label>
            <div class="range-inputs">
              <input
                :value="form.dteStart"
                type="text"
                class="form-input"
                placeholder="Start"
                @input="(e) => updateFormField('dteStart', (e.target as HTMLInputElement).value)"
              />
              <span class="range-separator">-</span>
              <input
                :value="form.dteEnd"
                type="text"
                class="form-input"
                placeholder="End"
                @input="(e) => updateFormField('dteEnd', (e.target as HTMLInputElement).value)"
              />
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="handleClose" :disabled="isSaving">Cancel</button>
        <button class="btn btn-primary" @click="handleSave" :disabled="isSaving">
          <span v-if="isSaving">{{ isEditing ? 'Updating...' : 'Saving...' }}</span>
          <span v-else>{{ isEditing ? 'Update' : 'Save' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style>
/* Modal base styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #e9ecef;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #2c3e50;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #6c757d;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.modal-close:hover {
  background-color: #f8f9fa;
  color: #495057;
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid #e9ecef;
}

/* Button styles */
.btn {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  color: #495057;
}

.btn-secondary:hover {
  background: #e9ecef;
  border-color: #ced4da;
}

.btn-primary {
  background: #007bff;
  border: 1px solid #007bff;
  color: white;
}

.btn-primary:hover {
  background: #0056b3;
  border-color: #0056b3;
}

/* Position info styles */
.position-info {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.fi-tag.position-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid #dbe2ea;
  border-radius: 999px;
  background: #f5f7fa;
  color: #425466;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
}

/* Rebalance button styles (for table) */
.rebalance-btn:hover {
  opacity: 0.8;
}

.rebalance-yes:hover {
  background: #c8e6c9 !important;
}

.rebalance-no:hover {
  background: #ffcdd2 !important;
}

/* Rebalance modal styles */
.rebalance-modal {
  max-width: 450px;
  width: 90%;
}

.rebalance-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-label {
  font-weight: 600;
  color: #495057;
  font-size: 0.9rem;
}

.form-input {
  padding: 0.5rem 0.75rem;
  border: 1px solid #ced4da;
  border-radius: 4px;
  font-size: 0.95rem;
  transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.form-input:focus {
  border-color: #80bdff;
  outline: 0;
  box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
}

.form-input::placeholder {
  color: #adb5bd;
}

.range-inputs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.range-inputs .form-input {
  flex: 1;
  text-align: center;
}

.range-separator {
  color: #6c757d;
  font-weight: 500;
  font-size: 1.1rem;
}
</style>
