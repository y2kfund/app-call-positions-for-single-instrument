<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { ColumnDefinition } from 'tabulator-tables'
import { useCallPositionsQuery } from '@y2kfund/core/callPositionsForSingleInstrument'
import { useTabulator } from '../composables/useTabulator'

interface callPositionsProps {
  symbolRoot: string
  userId?: string | null
}

const props = withDefaults(defineProps<callPositionsProps>(), {
  //symbolRoot: 'META',
  //userId: '67e578fd-2cf7-48a4-b028-a11a3f89bb9b'
  userId: null,
  symbolRoot: ''
})

// Query call positions
const q = useCallPositionsQuery(props.symbolRoot, props.userId)

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

// Define columns
const columns: ColumnDefinition[] = [
  { title: 'Account', field: 'legal_entity', minWidth: 100, headerHozAlign: 'left' },
  { 
    title: 'Financial Instrument', 
    field: 'symbol', 
    minWidth: 100,
    headerHozAlign: 'left',
    formatter: (cell: any) => {
      const tags = extractTagsFromSymbol(cell.getValue())
      return tags.map(tag => `<span class="fi-tag">${tag}</span>`).join(' ')
    },
  },
  { title: 'Expiry Date', field: 'expiry_date', minWidth: 100, hozAlign: 'left', headerHozAlign: 'left',
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT') {
        const tags = extractTagsFromSymbol(row.symbol)
        return tags[1] || '<span style="color:#aaa;font-style:italic;">Unknown</span>'
      }
      return '<span style="color:#aaa;font-style:italic;">Not applicable</span>'
    }
  },
  { title: 'Asset Class', field: 'asset_class', minWidth: 100, headerHozAlign: 'left' },
  { title: 'Conid', field: 'conid', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right' },
  { title: 'Underlying Conid', field: 'undConid', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right' },
  { title: 'Multiplier', field: 'multiplier', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right', formatter: 'money' },
  { 
    title: 'Contract Quantity', 
    field: 'contract_quantity', 
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right', 
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
  { title: 'Accounting Quantity', field: 'accounting_quantity', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right', formatter: 'money' },
  { title: 'Avg Price', field: 'avgPrice', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right', 
    formatter: (cell: any) => {
      const value = cell.getValue()
      return value != null ? '$' + Number(value).toFixed(2) : ''
    }
  },
  { title: 'Market Price', field: 'price', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right',
    formatter: (cell: any) => {
      const value = cell.getValue()
      return value != null ? '$' + Number(value).toFixed(2) : ''
    }
  },
  { 
    title: 'Market Value', 
    field: 'market_value', 
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right',
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
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right',
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
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right',
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
    title: 'If Exercised Cash Flow', 
    field: 'computed_cash_flow_on_exercise', 
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right',
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
  { title: 'Entry/Exercise %', field: 'entry_exercise_cash_flow_pct', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right',
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT' && row.computed_cash_flow_on_entry != null && row.computed_cash_flow_on_exercise != null && row.computed_cash_flow_on_exercise !== 0) {
        const pct = (row.computed_cash_flow_on_entry / row.computed_cash_flow_on_exercise) * 100
        return Math.abs(pct).toFixed(2) + '%'
      }
      return '<span style="color:#aaa;font-style:italic;">N/A</span>'
    }
  },
  { title: 'BE Price', field: 'computed_be_price', minWidth: 100, hozAlign: 'right', headerHozAlign: 'right',
    formatter: (cell: any) => {
      const value = cell.getValue()
      return value != null ? '$' + Number(value).toFixed(2) : ''
    }
  }/*,
  { 
    title: 'Maintenance Margin Change', 
    field: 'maintenance_margin_change', 
    minWidth: 100, 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value === null || value === undefined || value === '') return '-'
      const numValue = parseFloat(value.replace(/,/g, ''))
      const color = numValue < 0 ? '#dc3545' : numValue > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${numValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      if (value === null || value === undefined || isNaN(value)) return '-'
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
    }
  }*/
]

// Initialize Tabulator with composable
const { tableDiv, initializeTabulator, isTableInitialized } = useTabulator({
  data: q.data,
  columns,
  isSuccess: q.isSuccess,
  placeholder: 'No call positions available'
})

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
      <h2>Call Positions - {{ symbolRoot }}</h2>
      <div v-if="q.isSuccess.value" class="positions-info">
        Found {{ q.data.value?.length || 0 }} position(s)
      </div>
    </div>

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
</template>

<style>
@import 'tabulator-tables/dist/css/tabulator_modern.min.css';
@import '../styles/styles.css';
</style>

<style scoped>
@import '../styles/scoped-styles.css';
</style>