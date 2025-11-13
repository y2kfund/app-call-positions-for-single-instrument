import { ref, watch, nextTick, type Ref, type ComputedRef } from 'vue'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { ColumnDefinition, Options } from 'tabulator-tables'

interface UseTabulatorOptions {
  data: ComputedRef<any[] | undefined>
  columns: ColumnDefinition[]
  isSuccess: ComputedRef<boolean>
  placeholder?: string
  rowFormatter?: (row: any) => void | Promise<void>
}

export function useTabulator(options: UseTabulatorOptions) {
  const { data, columns, isSuccess, placeholder = 'No data available', rowFormatter } = options
  
  const tableDiv = ref<HTMLDivElement | null>(null)
  const isTableInitialized = ref(false)
  const tabulator = ref<Tabulator | null>(null)

  function initializeTabulator() {
    if (!tableDiv.value || isTableInitialized.value) {
      console.log('⚠️ Cannot initialize: div exists?', !!tableDiv.value, 'already initialized?', isTableInitialized.value)
      return
    }

    // Check if element is visible
    if (tableDiv.value.offsetParent === null) {
      console.log('⚠️ Table div is not visible, skipping initialization')
      return
    }

    console.log('🚀 Initializing Tabulator with data:', data.value?.length, 'rows')

    const config: Options = {
      data: data.value || [],
      columns,
      layout: 'fitColumns',
      placeholder,
      height: '100%',
      reactiveData: true,
      initialSort: [
        { column: 'expiry_date', dir: 'asc' }
      ]
    }

    if (rowFormatter) {
      config.rowFormatter = rowFormatter
    }

    tabulator.value = new Tabulator(tableDiv.value, config)
    isTableInitialized.value = true

    console.log('✅ Tabulator initialized')
  }

  // Watch for both success state AND when the element becomes available
  watch(
    [isSuccess, tableDiv],
    async ([success, element]) => {
      console.log('👀 Tabulator watch triggered:', { success, hasElement: !!element, initialized: isTableInitialized.value })
      
      if (success && element && !isTableInitialized.value) {
        // Wait for element to be visible in DOM
        await nextTick()
        
        // Check if element is now visible
        if (element.offsetParent !== null) {
          console.log('🚀 Initializing from watcher')
          initializeTabulator()
        } else {
          console.log('⏸️ Element not visible yet, will retry')
          // Set up a short retry mechanism
          setTimeout(() => {
            if (element.offsetParent !== null && !isTableInitialized.value) {
              console.log('🚀 Initializing after visibility check')
              initializeTabulator()
            }
          }, 100)
        }
      }
    },
    { immediate: true }
  )

  // Watch for data changes
  watch(
    () => data.value,
    (newData) => {
      if (tabulator.value && newData) {
        console.log('🔄 Updating Tabulator data:', newData.length, 'rows')
        tabulator.value.setData(newData)
      }
    }
  )

  return {
    tableDiv,
    tabulator,
    initializeTabulator,
    isTableInitialized
  }
}