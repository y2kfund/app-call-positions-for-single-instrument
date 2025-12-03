import { ref, reactive } from 'vue'
import { useSupabase } from '@y2kfund/core'

export interface RebalanceForm {
  deltaStart: string
  deltaEnd: string
  desiredDelta: string
  dteStart: string
  dteEnd: string
}

// Map to track enabled states by position key
export const rebalanceEnabledStates = reactive<Map<string, boolean>>(new Map())

// Map to store full settings data by position key
export const rebalanceSettingsData = reactive<Map<string, RebalanceSettingsDB>>(new Map())

export interface RebalanceSettings {
  positionKey: string
  position: any
  deltaRange: {
    start: number
    end: number
  }
  desiredDelta: number
  dteRange: {
    start: number
    end: number
  }
}

export interface RebalanceSettingsDB {
  id?: string
  user_id: string
  position_key: string
  symbol?: string
  internal_account_id?: string
  legal_entity?: string
  delta_start: number
  delta_end: number
  desired_delta: number
  dte_start: number
  dte_end: number
  is_enabled?: boolean
  created_at?: string
  updated_at?: string
}

export function useRebalance(getPositionKey: (position: any) => string, userId?: string | null) {
  const supabase = useSupabase()
  
  const showRebalanceModal = ref(false)
  const rebalancePosition = ref<any>(null)
  const rebalanceForm = ref<RebalanceForm>({
    deltaStart: '',
    deltaEnd: '',
    desiredDelta: '',
    dteStart: '',
    dteEnd: ''
  })
  const isSaving = ref(false)
  const saveError = ref<string | null>(null)
  const isEditing = ref(false)

  // Optimal Rebalance Options modal state
  const showOptimalRebalanceModal = ref(false)
  const optimalRebalancePosition = ref<any>(null)

  function openRebalanceModal(position: any) {
    rebalancePosition.value = position
    isEditing.value = false
    // Reset form
    rebalanceForm.value = {
      deltaStart: '',
      deltaEnd: '',
      desiredDelta: '',
      dteStart: '',
      dteEnd: ''
    }
    saveError.value = null
    showRebalanceModal.value = true
  }

  // Open modal for editing existing settings
  function openRebalanceModalForEdit(position: any) {
    const positionKey = getPositionKey(position)
    const existingSettings = rebalanceSettingsData.get(positionKey)
    
    rebalancePosition.value = position
    isEditing.value = true
    
    // Pre-fill form with existing values
    if (existingSettings) {
      rebalanceForm.value = {
        deltaStart: String(existingSettings.delta_start),
        deltaEnd: String(existingSettings.delta_end),
        desiredDelta: String(existingSettings.desired_delta),
        dteStart: String(existingSettings.dte_start),
        dteEnd: String(existingSettings.dte_end)
      }
    } else {
      // Fallback to empty form
      rebalanceForm.value = {
        deltaStart: '',
        deltaEnd: '',
        desiredDelta: '',
        dteStart: '',
        dteEnd: ''
      }
    }
    
    saveError.value = null
    showRebalanceModal.value = true
  }

  function closeRebalanceModal() {
    showRebalanceModal.value = false
    rebalancePosition.value = null
    saveError.value = null
    isEditing.value = false
  }

  function validateIntegerInput(event: Event) {
    const input = event.target as HTMLInputElement
    // Remove any non-digit characters
    input.value = input.value.replace(/[^0-9]/g, '')
  }

  async function saveRebalanceSettings(): Promise<RebalanceSettings | null> {
    // Validate all fields are filled
    const form = rebalanceForm.value
    if (!form.deltaStart || !form.deltaEnd || !form.desiredDelta || !form.dteStart || !form.dteEnd) {
      alert('Please fill in all fields')
      return null
    }

    if (!userId) {
      alert('User not authenticated')
      return null
    }

    const position = rebalancePosition.value
    const positionKey = getPositionKey(position)

    const settings: RebalanceSettings = {
      positionKey,
      position,
      deltaRange: {
        start: parseInt(form.deltaStart),
        end: parseInt(form.deltaEnd)
      },
      desiredDelta: parseInt(form.desiredDelta),
      dteRange: {
        start: parseInt(form.dteStart),
        end: parseInt(form.dteEnd)
      }
    }

    // Prepare data for database
    const dbRecord: RebalanceSettingsDB = {
      user_id: userId,
      position_key: positionKey,
      symbol: position?.symbol || null,
      internal_account_id: position?.internal_account_id || null,
      legal_entity: position?.legal_entity || null,
      delta_start: settings.deltaRange.start,
      delta_end: settings.deltaRange.end,
      desired_delta: settings.desiredDelta,
      dte_start: settings.dteRange.start,
      dte_end: settings.dteRange.end,
      is_enabled: true
    }

    isSaving.value = true
    saveError.value = null

    try {
      // Upsert: insert or update if exists (based on unique constraint)
      const { data, error } = await supabase
        .schema('hf')
        .from('rebalance_settings')
        .upsert(dbRecord, {
          onConflict: 'user_id,position_key'
        })
        .select()
        .single()

      if (error) {
        console.error('❌ Error saving rebalance settings:', error)
        saveError.value = error.message
        alert(`Failed to save: ${error.message}`)
        return null
      }

      console.log('✅ Rebalance settings saved:', data)
      // Update enabled state in the map
      rebalanceEnabledStates.set(positionKey, true)
      // Store the full settings data
      rebalanceSettingsData.set(positionKey, data as RebalanceSettingsDB)
      closeRebalanceModal()
      return settings

    } catch (err: any) {
      console.error('❌ Exception saving rebalance settings:', err)
      saveError.value = err.message || 'Unknown error'
      alert(`Failed to save: ${err.message || 'Unknown error'}`)
      return null
    } finally {
      isSaving.value = false
    }
  }

  async function fetchRebalanceSettings(positionKey: string): Promise<RebalanceSettingsDB | null> {
    if (!userId) return null

    try {
      const { data, error } = await supabase
        .schema('hf')
        .from('rebalance_settings')
        .select('*')
        .eq('user_id', userId)
        .eq('position_key', positionKey)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows found - not an error
          return null
        }
        console.error('❌ Error fetching rebalance settings:', error)
        return null
      }

      return data
    } catch (err) {
      console.error('❌ Exception fetching rebalance settings:', err)
      return null
    }
  }

  async function deleteRebalanceSettings(positionKey: string): Promise<boolean> {
    if (!userId) return false

    try {
      const { error } = await supabase
        .schema('hf')
        .from('rebalance_settings')
        .delete()
        .eq('user_id', userId)
        .eq('position_key', positionKey)

      if (error) {
        console.error('❌ Error deleting rebalance settings:', error)
        return false
      }

      console.log('✅ Rebalance settings deleted for:', positionKey)
      // Remove from settings data map
      rebalanceSettingsData.delete(positionKey)
      return true
    } catch (err) {
      console.error('❌ Exception deleting rebalance settings:', err)
      return false
    }
  }

  function handleRebalanceAction(action: string, position: any) {
    if (action === 'yes') {
      openRebalanceModal(position)
    } else if (action === 'no') {
      const positionKey = getPositionKey(position)
      console.log('📊 Rebalance: No selected for position', positionKey)
      // Optionally delete existing settings when "No" is clicked
      deleteRebalanceSettings(positionKey)
    }
  }

  // Toggle handler for the switch
  async function handleToggle(position: any, newState: boolean) {
    const positionKey = getPositionKey(position)
    
    if (newState) {
      // Opening toggle - show modal to configure
      openRebalanceModal(position)
    } else {
      // Closing toggle - disable/delete settings
      await deleteRebalanceSettings(positionKey)
      rebalanceEnabledStates.set(positionKey, false)
    }
  }

  // Check if a position has rebalance enabled
  function isRebalanceEnabled(position: any): boolean {
    const positionKey = getPositionKey(position)
    return rebalanceEnabledStates.get(positionKey) ?? false
  }

  // Set enabled state for a position
  function setRebalanceEnabled(positionKey: string, enabled: boolean) {
    rebalanceEnabledStates.set(positionKey, enabled)
  }

  // Fetch all rebalance settings for the user and populate enabled states
  async function fetchAllRebalanceSettings(): Promise<RebalanceSettingsDB[]> {
    if (!userId) return []

    try {
      const { data, error } = await supabase
        .schema('hf')
        .from('rebalance_settings')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('❌ Error fetching all rebalance settings:', error)
        return []
      }

      // Populate enabled states map and settings data map
      if (data) {
        data.forEach((setting: RebalanceSettingsDB) => {
          rebalanceEnabledStates.set(setting.position_key, setting.is_enabled ?? true)
          rebalanceSettingsData.set(setting.position_key, setting)
        })
      }

      console.log('✅ Loaded rebalance settings for', data?.length || 0, 'positions')
      return data || []
    } catch (err) {
      console.error('❌ Exception fetching all rebalance settings:', err)
      return []
    }
  }

  // Get settings data for a position
  function getRebalanceSettings(positionKey: string): RebalanceSettingsDB | undefined {
    return rebalanceSettingsData.get(positionKey)
  }

  // Check if delta is within the configured range for a position
  function isDeltaInRange(positionKey: string, delta: number): boolean {
    const settings = rebalanceSettingsData.get(positionKey)
    if (!settings) return true // No settings = no range check, default behavior
    
    // Convert delta to absolute percentage (e.g., -0.25 → 25)
    const deltaPercent = Math.abs(delta) * 100
    
    // Check if within range
    return deltaPercent >= settings.delta_start && deltaPercent <= settings.delta_end
  }

  // Open the Optimal Rebalance Options modal
  function openOptimalRebalanceModal(position: any) {
    optimalRebalancePosition.value = position
    showOptimalRebalanceModal.value = true
  }

  // Close the Optimal Rebalance Options modal
  function closeOptimalRebalanceModal() {
    showOptimalRebalanceModal.value = false
    optimalRebalancePosition.value = null
  }

  return {
    showRebalanceModal,
    rebalancePosition,
    rebalanceForm,
    isSaving,
    saveError,
    isEditing,
    showOptimalRebalanceModal,
    optimalRebalancePosition,
    openRebalanceModal,
    openRebalanceModalForEdit,
    closeRebalanceModal,
    validateIntegerInput,
    saveRebalanceSettings,
    fetchRebalanceSettings,
    deleteRebalanceSettings,
    handleRebalanceAction,
    handleToggle,
    isRebalanceEnabled,
    setRebalanceEnabled,
    fetchAllRebalanceSettings,
    getRebalanceSettings,
    isDeltaInRange,
    openOptimalRebalanceModal,
    closeOptimalRebalanceModal
  }
}
