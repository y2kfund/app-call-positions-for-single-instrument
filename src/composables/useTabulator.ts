import { ref, watch, nextTick, type Ref, type ComputedRef } from 'vue'
import { TabulatorFull as Tabulator } from 'tabulator-tables'
import type { ColumnDefinition, Options } from 'tabulator-tables'

interface UseTabulatorOptions {
  data: any
  columns: any[]
  isSuccess: any
  placeholder?: string
  rowFormatter?: (row: any) => Promise<void> | void
  onTableCreated?: (table: any) => void
  initialSort?: Array<{ column: string; dir: 'asc' | 'desc' }>
}

export function useTabulator(options: UseTabulatorOptions) {
  const tableDiv = ref<HTMLDivElement | null>(null)
  const tabulator = ref<Tabulator | null>(null)
  const isTableInitialized = ref(false)

  const initializeTabulator = () => {
    if (!tableDiv.value || isTableInitialized.value) {
      console.log('⏭️ Skipping table init:', { 
        hasDiv: !!tableDiv.value, 
        isInitialized: isTableInitialized.value 
      })
      return
    }

    console.log('🚀 Initializing tabulator...')

    try {
      tabulator.value = new Tabulator(tableDiv.value, {
        data: options.data.value || [],
        columns: options.columns,
        layout: 'fitColumns',
        placeholder: options.placeholder || 'No data available',
        rowFormatter: options.rowFormatter,
        // Remove initialSort from config
      })

      isTableInitialized.value = true
      console.log('✅ Tabulator initialized')

      // Wait for table to be fully built, then apply sort
      if (options.initialSort && options.initialSort.length > 0 && tabulator.value) {
        tabulator.value.on("tableBuilt", () => {
          console.log('🔄 Table built, applying initial sort to show indicator')
          setTimeout(() => {
            if (tabulator.value) {
              tabulator.value.setSort(options.initialSort!)
              console.log('✅ Sort applied with indicator')
            }
          }, 50)
        })
      }

      // Call the onTableCreated callback if provided
      if (options.onTableCreated && tabulator.value) {
        nextTick(() => {
          options.onTableCreated!(tabulator.value!)
        })
      }
    } catch (error) {
      console.error('❌ Error initializing tabulator:', error)
    }
  }

  // Watch for both success state AND when the element becomes available
  watch(
    [options.isSuccess, tableDiv],
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
    () => options.data.value,
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
    isTableInitialized,
    initializeTabulator
  }
}