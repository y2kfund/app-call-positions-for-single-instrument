<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref } from 'vue'
import type { ColumnDefinition } from 'tabulator-tables'
import { useCallPositionsQuery } from '@y2kfund/core/callPositionsForSingleInstrument'
import { fetchPositionsBySymbolRoot } from '@y2kfund/core'
import { useTabulator } from '../composables/useTabulator'
import { useSupabase } from '@y2kfund/core'

interface callPositionsProps {
  symbolRoot: string
  userId?: string | null
}

const props = withDefaults(defineProps<callPositionsProps>(), {
  symbolRoot: 'META',
  userId: '67e578fd-2cf7-48a4-b028-a11a3f89bb9b'
})

// Active tab state
const activeTab = ref<'current' | 'expired'>('current')

// Supabase client
const supabase = useSupabase()

// Query call positions
const q = useCallPositionsQuery(props.symbolRoot, props.userId)

// Expired positions state
const expiredPositions = ref<any[]>([])
const loadingExpired = ref(false)
const errorExpired = ref<string | null>(null)
const expiredDataLoaded = ref(false)

// Helper functions
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

function isExpired(symbolText: string): boolean {
  const tags = extractTagsFromSymbol(symbolText)
  const expiryDate = tags[1] // YYYY-MM-DD format
  if (!expiryDate) return false
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  
  return expiry < today
}

// Fetch expired positions
async function fetchExpiredPositions() {
  if (!props.symbolRoot || !props.userId) return
  
  loadingExpired.value = true
  errorExpired.value = null
  expiredDataLoaded.value = false
  
  try {
    const allPositions = await fetchPositionsBySymbolRoot(
      supabase,
      props.symbolRoot,
      props.userId
    )
    
    // Filter for expired options
    expiredPositions.value = allPositions.filter(pos => 
      pos.asset_class === 'OPT' && isExpired(pos.symbol) && pos.symbol.includes(' C ')
    )
    
    console.log('✅ Fetched expired positions:', expiredPositions.value.length)
    expiredDataLoaded.value = true
    
    // Wait for next tick to ensure reactive updates are complete
    await nextTick()
    
    // Initialize the table after data is loaded
    if (expiredPositions.value.length > 0 && expiredTableDiv.value) {
      console.log('🚀 Initializing expired table after fetch, div exists:', !!expiredTableDiv.value)
      console.log('📊 Expired data:', expiredPositions.value)
      initializeExpiredTabulator()
    }
  } catch (err: any) {
    console.error('❌ Error fetching expired positions:', err)
    errorExpired.value = err.message || 'Failed to fetch expired positions'
  } finally {
    loadingExpired.value = false
  }
}

// Define columns
const columns: ColumnDefinition[] = [
  {
    title: 'Account', 
    field: 'legal_entity', 
    headerHozAlign: 'left',
    widthGrow: 1
  },
  { 
    title: 'Strike<br>price', 
    field: 'strike_price', 
    hozAlign: 'left', 
    headerHozAlign: 'left',
    widthGrow: 0.6,
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT') {
        const tags = extractTagsFromSymbol(row.symbol)
        return tags[2] || '<span style="color:#aaa;font-style:italic;">Unknown</span>'
      }
      return '<span style="color:#aaa;font-style:italic;">Not applicable</span>'
    }
  },
  { 
    title: 'Expiry Date', 
    field: 'expiry_date', 
    hozAlign: 'left', 
    headerHozAlign: 'left',
    widthGrow: 1.1,
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT') {
        const tags = extractTagsFromSymbol(row.symbol)
        return tags[1] || '<span style="color:#aaa;font-style:italic;">Unknown</span>'
      }
      return '<span style="color:#aaa;font-style:italic;">Not applicable</span>'
    }
  },
  { 
    title: 'Accounting<br>Quantity', 
    field: 'accounting_quantity', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1,
    formatter: 'money',
    formatterParams: {
      decimal: '.',
      thousand: ',',
      precision: 0
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: 'money',
    bottomCalcFormatterParams: {
      decimal: '.',
      thousand: ',',
      precision: 0
    }
  },
  {
    title: 'Premium received per unit<br>when option was sold', 
    field: 'avgPrice', 
    hozAlign: 'right',
    widthGrow: 2,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return ''
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    },
  },
  { 
    title: 'Market Value', 
    field: 'market_value', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1.5,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return ''
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    }
  },
  { 
    title: 'Unrealized P&L', 
    field: 'unrealized_pnl', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1.5,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return ''
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    }
  },
  { 
    title: 'Entry Cash Flow', 
    field: 'computed_cash_flow_on_entry', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1.5,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return ''
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    }
  },
  { 
    title: 'Break even<br>price', 
    field: 'computed_be_price', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1,
    formatter: (cell: any) => {
      const value = cell.getValue()
      return value != null ? '$' + Number(value).toFixed(2) : ''
    }
  }
]

// Initialize Tabulator for current positions
const { tableDiv, initializeTabulator, isTableInitialized } = useTabulator({
  data: q.data,
  columns,
  isSuccess: q.isSuccess,
  placeholder: 'No call positions available'
})

// Initialize Tabulator for expired positions
const expiredData = computed(() => expiredPositions.value)
const expiredIsSuccess = computed(() => expiredDataLoaded.value && !loadingExpired.value && !errorExpired.value)
const { 
  tableDiv: expiredTableDiv, 
  initializeTabulator: initializeExpiredTabulator,
  isTableInitialized: isExpiredTableInitialized 
} = useTabulator({
  data: expiredData,
  columns,
  isSuccess: expiredIsSuccess,
  placeholder: 'No expired positions available'
})

// Handle tab changes
function switchTab(tab: 'current' | 'expired') {
  console.log('🔄 Switching to tab:', tab)
  activeTab.value = tab
  
  if (tab === 'expired') {
    // Fetch expired positions if not already fetched
    if (!expiredDataLoaded.value && !loadingExpired.value) {
      console.log('📥 Fetching expired positions...')
      fetchExpiredPositions()
    } else if (expiredDataLoaded.value && expiredPositions.value.length > 0) {
      // Data already exists, just initialize the table if needed
      nextTick(() => {
        console.log('🔍 Tab switch - Table initialized?', isExpiredTableInitialized.value, 'Div exists?', !!expiredTableDiv.value)
        if (!isExpiredTableInitialized.value && expiredTableDiv.value) {
          console.log('🚀 Initializing expired table on tab switch')
          initializeExpiredTabulator()
        }
      })
    }
  } else if (tab === 'current') {
    // Re-initialize current table if needed
    nextTick(() => {
      if (q.isSuccess.value && !isTableInitialized.value && tableDiv.value) {
        initializeTabulator()
      }
    })
  }
}

onMounted(() => {
  console.log('🎬 Component mounted')
  console.log('📊 Query state:', {
    isLoading: q.isLoading.value,
    isSuccess: q.isSuccess.value,
    isError: q.isError.value,
    dataLength: q.data.value?.length
  })
  
  // Try to initialize if data is already loaded
  if (q.isSuccess.value && tableDiv.value && !isTableInitialized.value) {
    nextTick(() => {
      console.log('🚀 Initializing on mount')
      initializeTabulator()
      isTableInitialized.value = true
    })
  }
})

onBeforeUnmount(() => {
  console.log('👋 Component unmounting, cleaning up query')
  if (q._cleanup) {
    q._cleanup()
  }
})
</script>

<template>
  <div class="call-positions-for-single-instrument-view">
    <div class="positions-header">
      <h2>Call Positions</h2>
      <div v-if="activeTab === 'current' && q.isSuccess.value" class="positions-info">
        Found {{ q.data.value?.length || 0 }} position(s)
      </div>
      <div v-else-if="activeTab === 'expired' && !loadingExpired" class="positions-info">
        Found {{ expiredPositions.length }} expired position(s)
      </div>
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <button 
        class="tab-button" 
        :class="{ active: activeTab === 'current' }"
        @click="switchTab('current')"
      >
        Current
      </button>
      <button 
        class="tab-button" 
        :class="{ active: activeTab === 'expired' }"
        @click="switchTab('expired')"
      >
        Expired
      </button>
    </div>

    <!-- Current Positions Tab -->
    <div v-show="activeTab === 'current'" class="tab-content">
      <div v-if="q.isLoading.value" class="loading">
        <div class="loading-spinner"></div>
        Loading call positions...
      </div>
      
      <div v-else-if="q.isError.value" class="error">
        <h3>Error loading positions</h3>
        <p>{{ q.error.value }}</p>
      </div>
      
      <div v-else-if="q.isSuccess.value" class="positions-container">
        <div ref="tableDiv" class="tabulator-table"></div>
      </div>
    </div>

    <!-- Expired Positions Tab -->
    <div v-show="activeTab === 'expired'" class="tab-content">
      <div v-if="loadingExpired" class="loading">
        <div class="loading-spinner"></div>
        Loading expired positions...
      </div>
      
      <div v-else-if="errorExpired" class="error">
        <h3>Error loading expired positions</h3>
        <p>{{ errorExpired }}</p>
      </div>
      
      <div v-else class="positions-container">
        <div ref="expiredTableDiv" class="tabulator-table"></div>
      </div>
    </div>
  </div>
</template>

<style>
@import 'tabulator-tables/dist/css/tabulator_modern.min.css';
@import '../styles/styles.css';
</style>

<style scoped>
@import '../styles/scoped-styles.css';
</style>