<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch, inject } from 'vue'
import type { ColumnDefinition } from 'tabulator-tables'
import { useCallPositionsQuery } from '@y2kfund/core/callPositionsForSingleInstrument'
import { useSupabase, fetchPositionsBySymbolRoot, savePositionTradeMappings, savePositionPositionMappings, type Position } from '@y2kfund/core'
import { useTabulator } from '../composables/useTabulator'
import { useAttachedData } from '../composables/useAttachedData'
import { usePositionExpansion } from '../composables/usePositionExpansion'
import { TabulatorFull as Tabulator } from 'tabulator-tables'

interface callPositionsProps {
  symbolRoot: string
  userId?: string | null
}

const props = withDefaults(defineProps<callPositionsProps>(), {
  symbolRoot: 'IBIT',
  userId: '67e578fd-2cf7-48a4-b028-a11a3f89bb9b'
})

const supabase = useSupabase()

// Active tab state
const eventBus = inject<any>('eventBus')
const activeTab = ref<'current' | 'expired'>('current')
const accountFilter = ref<string | null>(parseAccountFilterFromUrl())
const expiryDateFilter = ref<string | null>(parseExpiryDateFilterFromUrl())
const strikePriceFilter = ref<string | null>(parseStrikePriceFilterFromUrl())

// Query call positions
const q = useCallPositionsQuery(props.symbolRoot, props.userId)

// Use attached data composable - CHANGED: removed symbolRoot param
const {
  positionTradesMap,
  positionPositionsMap,
  positionOrdersMap,
  getPositionKey,
  getAttachedTrades,
  fetchOrdersForSymbol,
  getAttachedOrders,
  savePositionOrderMappings,
  fetchAttachedPositionsForDisplay,
  fetchTradesForSymbol,
  isReady,
  refetchMappings
} = useAttachedData(props.userId)

// Use expansion composable
const {
  expandedPositions,
  processingPositions,
  togglePositionExpansion: toggleExpansion
} = usePositionExpansion()

// Expired positions state
const expiredPositions = ref<any[]>([])
const loadingExpired = ref(false)
const errorExpired = ref<string | null>(null)
const expiredDataLoaded = ref(false)

// Context menu state
const showContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuContent = ref('')

//const accountFilter = ref<string | null>(null)

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

function extractTagsFromTradesSymbol(symbolText: string): string[] {
  if (!symbolText) return []
  const text = String(symbolText).trim()
  
  const symMatch = text.match(/^([A-Z]+)\s*/)
  const base = symMatch?.[1] ?? ''
  
  const remaining = text.slice(symMatch?.[0]?.length || 0)
  
  const expiryMatch = remaining.match(/(\d{6})([CP])/)
  let expiry = ''
  let right = ''
  let strike = ''
  
  if (expiryMatch) {
    expiry = formatExpiryFromYyMmDd(expiryMatch[1])
    right = expiryMatch[2] === 'C' ? 'Call' : 'Put'
    
    const afterExpiry = remaining.slice(expiryMatch[0].length)
    const strikeMatch = afterExpiry.match(/(\d+)/)
    if (strikeMatch) {
      const strikeValue = parseInt(strikeMatch[1], 10) / 1000
      strike = strikeValue.toString()
    }
  }
  
  return [base, expiry, strike, right].filter(Boolean)
}

function formatExpiryFromYyMmDd(code: string): string {
  if (!code || code.length !== 6) return ''
  const yy = code.substring(0, 2)
  const mm = code.substring(2, 4)
  const dd = code.substring(4, 6)
  return `20${yy}-${mm}-${dd}`
}

function formatTradeDate(dateStr: string): string {
  if (!dateStr) return ''
  
  // Check if it's in DD/MM/YYYY format (day first)
  const ddmmyyyyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(dateStr).trim())
  let dt: Date
  
  if (ddmmyyyyMatch) {
    const day = parseInt(ddmmyyyyMatch[1])      // First number is day
    const month = parseInt(ddmmyyyyMatch[2]) - 1 // Second number is month (0-indexed)
    let year = parseInt(ddmmyyyyMatch[3])
    if (year < 100) {
      year = 2000 + year
    }
    dt = new Date(year, month, day)
  } else {
    // Try parsing as ISO date or other format
    dt = new Date(dateStr)
    if (isNaN(dt.getTime())) return String(dateStr)
  }
  
  // Format as YYYY-MM-DD
  const year = dt.getFullYear()
  const month = (dt.getMonth() + 1).toString().padStart(2, '0')
  const day = dt.getDate().toString().padStart(2, '0')
  
  return `${year}-${month}-${day}`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value)
}

function parseAccountFilterFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('all_cts_clientId') || null
}

function parseExpiryDateFilterFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('expiryDate') || null
}

function parseStrikePriceFilterFromUrl(): string | null {
  const url = new URL(window.location.href)
  return url.searchParams.get('strikePrice') || null
}

function togglePositionExpansion(positionKey: string) {
  console.log('🔄 Toggle expansion for key:', positionKey)
  console.log('📊 Before toggle - expanded positions:', Array.from(expandedPositions.value))
  
  // Toggle the expansion state
  if (expandedPositions.value.has(positionKey)) {
    expandedPositions.value.delete(positionKey)
    console.log('➖ Removed from expanded')
  } else {
    expandedPositions.value.add(positionKey)
    console.log('➕ Added to expanded')
  }
  
  console.log('📊 After toggle - expanded positions:', Array.from(expandedPositions.value))
  console.log('🎯 Tabulator exists?', !!tabulator.value) // <-- Changed to .value
  
  // Force row reformat
  if (tabulator.value) { // <-- Changed to .value
    const rows = tabulator.value.getRows() // <-- Changed to .value
    console.log('📋 Total rows:', rows.length)
    
    for (const row of rows) {
      const data = row.getData()
      if (data) {
        const rowPosKey = getRowPositionKey(data)
        console.log('🔍 Checking row key:', rowPosKey, 'matches?', rowPosKey === positionKey)
        
        if (rowPosKey === positionKey) {
          console.log('✅ Found matching row, reformatting...')
          row.reformat()
          break
        }
      }
    }
  }
}

// Wrapper to get position key with current data
function getRowPositionKey(data: any): string {
  return getPositionKey(data)
}

// Helper function to get border color based on delta value
function getDeltaBorderColor(delta: number | null): string {
  if (delta === null || delta === undefined) return 'transparent'
  
  const absDelta = Math.abs(delta) // Use absolute value
  
  if (absDelta >= 0.4) { // >= 40%
    return '#dc3545' // Red
  } else if (absDelta <= 0.2) { // <= 20%
    return '#28a745' // Green
  } else { // Between 20% - 40%
    return '#fd7e14' // Light orange
  }
}

function calculateDTE(symbolText: string): number | null {
  const tags = extractTagsFromSymbol(symbolText)
  const expiryDateStr = tags[1] // YYYY-MM-DD format
  if (!expiryDateStr) return null
  
  const expiryDate = new Date(expiryDateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  expiryDate.setHours(0, 0, 0, 0)
  
  const diffTime = expiryDate.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  return diffDays
}

const activeFilters = computed(() => {
  const filters: Array<{ field: string; label: string; value: string }> = []
  
  if (accountFilter.value) {
    filters.push({
      field: 'legal_entity',
      label: 'Account',
      value: accountFilter.value
    })
  }

  if (expiryDateFilter.value) {
    filters.push({
      field: 'expiry_date',
      label: 'Expiry Date',
      value: expiryDateFilter.value
    })
  }
  
  if (strikePriceFilter.value) {
    filters.push({
      field: 'strike_price',
      label: 'Strike Price',
      value: strikePriceFilter.value
    })
  }
  
  return filters
})

function clearFilter(field: string) {
  const url = new URL(window.location.href)
  
  if (field === 'legal_entity') {
    accountFilter.value = null
    url.searchParams.delete('all_cts_clientId')
    
    // Emit event
    if (eventBus) {
      eventBus.emit('account-filter-changed', {
        accountId: null,
        source: 'call-positions'
      })
    }
  } else if (field === 'expiry_date') {
    expiryDateFilter.value = null
    url.searchParams.delete('expiryDate')
    
    // Emit event
    if (eventBus) {
      eventBus.emit('expiry-date-filter-changed', {
        expiryDate: null,
        source: 'call-positions'
      })
    }
  } else if (field === 'strike_price') {
    strikePriceFilter.value = null
    url.searchParams.delete('strikePrice')
    
    // Emit event
    if (eventBus) {
      eventBus.emit('strike-price-filter-changed', {
        strikePrice: null,
        source: 'call-positions'
      })
    }
  }
  
  window.history.replaceState({}, '', url.toString())
  updateFilters()
}

function clearAllFilters() {
  accountFilter.value = null
  expiryDateFilter.value = null
  strikePriceFilter.value = null
  
  const url = new URL(window.location.href)
  url.searchParams.delete('all_cts_clientId')
  url.searchParams.delete('expiryDate')
  url.searchParams.delete('strikePrice')
  
  window.history.replaceState({}, '', url.toString())
  updateFilters()
  
  // Emit events to clear all filters in other components
  if (eventBus) {
    eventBus.emit('account-filter-changed', {
      accountId: null,
      source: 'call-positions'
    })
    eventBus.emit('expiry-date-filter-changed', {
      expiryDate: null,
      source: 'call-positions'
    })
    eventBus.emit('strike-price-filter-changed', {
      strikePrice: null,
      source: 'call-positions'
    })
  }
}

// Define columns with expansion support
const columns: ColumnDefinition[] = [
  {
    title: 'Account', 
    field: 'legal_entity', 
    headerHozAlign: 'left',
    widthGrow: 1,
    formatter: (cell: any) => {
      const data = cell.getRow().getData()
      const accountName = cell.getValue() || data.internal_account_id
      
      // Check if mappings are ready
      if (!isReady.value) {
        console.log('⏳ Formatter called but mappings not ready yet')
        return `<div style="display: flex; align-items: center; gap: 6px;">
          <span class="expand-arrow">&nbsp;</span>
          <span>${accountName}</span>
        </div>`
      }
      
      const posKey = getRowPositionKey(data)
      const attachedTradeIds = positionTradesMap.value.get(posKey)
      const attachedPositionKeys = positionPositionsMap.value.get(posKey)
      const attachedOrderIds = positionOrdersMap.value.get(posKey)
      
      //console.log('🔍 Position Key:', positionTradesMap.value)
      console.log('🎨 Formatter for', posKey, {
        attachedTradeIds: attachedTradeIds?.size || 0,
        isReady: isReady.value
      })
      
      const hasAttachments = (attachedTradeIds && attachedTradeIds.size > 0) || 
                            (attachedPositionKeys && attachedPositionKeys.size > 0) ||
                            (attachedOrderIds && attachedOrderIds.size > 0)
      const isExpanded = expandedPositions.value.has(posKey)
      
      const expandArrow = hasAttachments
        ? `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}" data-position-key="${posKey}" title="${isExpanded ? 'Collapse' : 'Expand'} attachments">
            ${isExpanded ? '▼' : '▶'}
          </span>`
        : '<span class="expand-arrow">&nbsp;</span>'
      
      const totalAttachments = (attachedTradeIds?.size || 0) + (attachedPositionKeys?.size || 0) + (attachedOrderIds?.size || 0)
      const attachmentLabel = totalAttachments > 0 
        ? `<span class="trade-count">(${totalAttachments})</span>`
        : ''

      const attachButton = `<button class="attach-trades-btn" title="Attach trades or positions" style="border:none;background:transparent;cursor:pointer;padding:0;margin-right:4px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>`

      const isFiltered = accountFilter.value === accountName
      const accountClass = isFiltered ? 'account-filtered' : 'account-clickable'
      
      return `
        <div style="display: flex; align-items: center; gap: 6px;">
          ${expandArrow} 
          ${attachButton} 
          <span class="${accountClass}" data-account="${accountName}">${accountName}</span>
          ${attachmentLabel}
        </div>
      `
    },
    cellClick: (e: any, cell: any) => {
      const target = e.target as HTMLElement
      
      const expandArrow = target.closest('.expand-arrow')
      if (expandArrow) {
        e.stopPropagation()
        const posKey = expandArrow.getAttribute('data-position-key')
        if (posKey) {
          togglePositionExpansion(posKey)
        }
        return
      }

      const attachBtn = target.closest('.attach-trades-btn')
      if (attachBtn) {
        e.stopPropagation()
        const data = cell.getRow().getData()
        if (data) {
          openAttachModal(data, 'trades')
        }
        return
      }

      const accountSpan = target.closest('.account-clickable, .account-filtered')
      if (accountSpan) {
        e.stopPropagation()
        const accountName = accountSpan.getAttribute('data-account')
        if (accountName) {
          handleAccountFilter(accountName)
        }
        return
      }
    }
  },
  { 
    title: 'Strike<br>price', 
    field: 'strike_price', 
    hozAlign: 'left', 
    headerHozAlign: 'left',
    widthGrow: 0.8,
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT') {
        const tags = extractTagsFromSymbol(row.symbol)
        const strikePrice = tags[2] || ''
        
        if (strikePrice) {
          const isFiltered = strikePriceFilter.value === strikePrice
          const strikeClass = isFiltered ? 'strike-filtered' : 'strike-clickable'
          return `<span class="${strikeClass}" data-strike="${strikePrice}">${strikePrice}</span>`
        }
        
        return '<span style="color:#aaa;font-style:italic;">Unknown</span>'
      }
      return '<span style="color:#aaa;font-style:italic;">Not applicable</span>'
    },
    cellClick: (e: any, cell: any) => {
      const target = e.target as HTMLElement
      const strikeSpan = target.closest('.strike-clickable, .strike-filtered')
      
      if (strikeSpan) {
        e.stopPropagation()
        const strikePrice = strikeSpan.getAttribute('data-strike')
        if (strikePrice) {
          handleStrikePriceFilter(strikePrice)
        }
      }
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
        const expiryDate = tags[1] || ''
        
        if (expiryDate) {
          const isFiltered = expiryDateFilter.value === expiryDate
          const expiryClass = isFiltered ? 'expiry-filtered' : 'expiry-clickable'
          return `<span class="${expiryClass}" data-expiry="${expiryDate}">${expiryDate}</span>`
        }
        
        return '<span style="color:#aaa;font-style:italic;">Unknown</span>'
      }
      return '<span style="color:#aaa;font-style:italic;">Not applicable</span>'
    },
    cellClick: (e: any, cell: any) => {
      const target = e.target as HTMLElement
      const expirySpan = target.closest('.expiry-clickable, .expiry-filtered')
      
      if (expirySpan) {
        e.stopPropagation()
        const expiryDate = expirySpan.getAttribute('data-expiry')
        if (expiryDate) {
          handleExpiryDateFilter(expiryDate)
        }
      }
    },
    sorter: (a: any, b: any, aRow: any, bRow: any) => {
      const aData = aRow.getData()
      const bData = bRow.getData()
      
      // Extract dates from symbols
      const aDateStr = extractTagsFromSymbol(aData.symbol)[1] || ''
      const bDateStr = extractTagsFromSymbol(bData.symbol)[1] || ''
      
      // Handle empty/unknown dates
      if (!aDateStr && !bDateStr) return 0
      if (!aDateStr) return 1
      if (!bDateStr) return -1
      
      // Compare as date strings (YYYY-MM-DD format sorts correctly as strings)
      return aDateStr.localeCompare(bDateStr)
    }
  },
  { 
    title: 'DTE', 
    field: 'dte', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 0.8,
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      if (row.asset_class === 'OPT') {
        const dte = calculateDTE(row.symbol)
        if (dte === null) return '<span style="color:#aaa;font-style:italic;">N/A</span>'
        
        // Color code based on DTE
        let color = '#000'
        if (dte < 0) color = '#dc3545' // Red for expired
        else if (dte <= 7) color = '#fd7e14' // Orange for <= 7 days
        else if (dte <= 30) color = '#ffc107' // Yellow for <= 30 days
        else color = '#28a745' // Green for > 30 days
        
        return `<span style="color:${color};font-weight:${dte <= 7 ? 'bold' : 'normal'}">${dte}</span>`
      }
      return '<span style="color:#aaa;font-style:italic;">N/A</span>'
    },
    sorter: (a: any, b: any, aRow: any, bRow: any) => {
      const aData = aRow.getData()
      const bData = bRow.getData()
      
      const aDTE = calculateDTE(aData.symbol)
      const bDTE = calculateDTE(bData.symbol)
      
      if (aDTE === null && bDTE === null) return 0
      if (aDTE === null) return 1
      if (bDTE === null) return -1
      
      return aDTE - bDTE
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
    widthGrow: 1.2,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return ''
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
    },
    bottomCalc: 'sum',
    bottomCalcFormatter: (cell: any) => {
      const value = cell.getValue()
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
      if (value === null || value === undefined) return '-'
      
      const row = cell.getRow().getData()
      const symbol = row.symbol
      const qty = row.accounting_quantity
      
      // Add directional symbol based on option type and position (sold options only)
      let prefix = ''
      if (symbol && qty < 0) { // Only for sold options (negative qty)
        const tags = extractTagsFromSymbol(symbol)
        const right = tags[3] // Fourth tag is the right (P or C)
        
        if (right === 'P') {
          prefix = '> ' // PUT sold - stock must stay above BE price for profit
        } else if (right === 'C') {
          prefix = '< ' // CALL sold - stock must stay below BE price for profit
        }
      }
      
      return prefix + '$' + Number(value).toFixed(2)
    }
  },
  { 
    title: 'Delta', 
    field: 'delta', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 0.8,
    formatter: (cell: any) => {
      const value = cell.getValue()
      if (value == null) return '<span style="color:#aaa;font-style:italic;">N/A</span>'
      const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
      return `<span style="color:${color}">${Number(value).toFixed(3)}</span>`
    }
  },
  { 
    title: 'Rent per day<br>per share', 
    field: 'rent_per_day_per_share', 
    hozAlign: 'right', 
    headerHozAlign: 'right',
    widthGrow: 1.2,
    formatter: (cell: any) => {
      const row = cell.getRow().getData()
      const entryCashFlow = row.computed_cash_flow_on_entry
      const quantity = row.accounting_quantity
      const dte = calculateDTE(row.symbol)
      
      if (entryCashFlow == null || quantity == null || dte == null || dte === 0 || quantity === 0) {
        return '<span style="color:#aaa;font-style:italic;">N/A</span>'
      }
      
      // Premium per share = Entry Cash Flow / abs(Quantity)
      const premiumPerShare = entryCashFlow / Math.abs(quantity)
      
      // Rent per day per share = Premium per share / DTE
      const rentPerDayPerShare = premiumPerShare / dte
      
      const color = rentPerDayPerShare < 0 ? '#dc3545' : rentPerDayPerShare > 0 ? '#28a745' : '#000'
      return `<span style="color:${color};cursor:context-menu;">$${Number(rentPerDayPerShare).toFixed(2)}</span>`
    },
    cellContext: (e: any, cell: any) => {
      e.preventDefault()
      
      const row = cell.getRow().getData()
      const entryCashFlow = row.computed_cash_flow_on_entry
      const quantity = row.accounting_quantity
      const dte = calculateDTE(row.symbol)
      
      if (entryCashFlow == null || quantity == null || dte == null || dte === 0 || quantity === 0) {
        return
      }
      
      const premiumPerShare = entryCashFlow / Math.abs(quantity)
      const rentPerDayPerShare = premiumPerShare / dte
      
      // Set context menu position - position to the left of cursor
      // Approximate menu width is 280px, so offset by that amount to show on left
      const menuWidth = 280
      contextMenuX.value = Math.max(10, e.clientX - menuWidth)
      
      // Adjust vertical position if too close to bottom
      const menuHeight = 200 // approximate height
      const windowHeight = window.innerHeight
      if (e.clientY + menuHeight > windowHeight) {
        contextMenuY.value = Math.max(10, windowHeight - menuHeight - 10)
      } else {
        contextMenuY.value = e.clientY
      }
      
      contextMenuContent.value = `<div style="padding: 12px;">
        <div style="font-weight: bold; margin-bottom: 10px; font-size: 14px;">📊 Rent per Day Calculation</div>
        <div style="margin-bottom: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
          <div><strong>Entry Cash Flow:</strong> $${Number(entryCashFlow).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
          <div><strong>Quantity:</strong> ${Math.abs(quantity).toLocaleString()}</div>
          <div><strong>DTE:</strong> ${dte} days</div>
        </div>
        <div style="margin-bottom: 6px;">
          <strong>Step 1:</strong> Premium per share<br>
          <span style="font-family: monospace;">$${Number(entryCashFlow).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ÷ ${Math.abs(quantity).toLocaleString()} = <strong>$${Number(premiumPerShare).toFixed(2)}</strong></span>
        </div>
        <div>
          <strong>Step 2:</strong> Rent per day per share<br>
          <span style="font-family: monospace;">$${Number(premiumPerShare).toFixed(2)} ÷ ${dte} days = <strong style="color: #28a745;">$${Number(rentPerDayPerShare).toFixed(2)}</strong></span>
        </div>
      </div>`
      showContextMenu.value = true
    }
  }
]

// Initialize Tabulator for current positions
const { tableDiv, initializeTabulator, isTableInitialized, tabulator } = useTabulator({
  data: q.data,
  columns,
  isSuccess: q.isSuccess,
  placeholder: 'No call positions available',
  onTableCreated: (table: any) => {
    console.log('🎯 Table created, applying initial filters')
    
    const hasFilters = accountFilter.value || expiryDateFilter.value || strikePriceFilter.value
    
    if (hasFilters) {
      table.setFilter((data: any) => {
        if (accountFilter.value && data.legal_entity !== accountFilter.value) return false
        
        if (expiryDateFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          if (tags[1] !== expiryDateFilter.value) return false
        }
        
        if (strikePriceFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          if (tags[2] !== strikePriceFilter.value) return false
        }
        
        return true
      })
    }
  },
  rowFormatter: async (row: any) => {
    try {
      const data = row.getData()
      const element = row.getElement()
      
      if (!data) return

      // 🎨 Apply delta-based border color styling
      const delta = data.delta
      const borderColor = getDeltaBorderColor(delta)
      const firstCell = element.querySelector('.tabulator-cell:first-child') as HTMLElement
      if (firstCell) {
        firstCell.style.borderLeft = `10px solid ${borderColor}`
      }

      const posKey = getRowPositionKey(data)
      const attachedTradeIds = positionTradesMap.value.get(posKey)
      const attachedPositionKeys = positionPositionsMap.value.get(posKey)
      const attachedOrderIds = positionOrdersMap.value.get(posKey)
      const isExpanded = expandedPositions.value.has(posKey)
      
      console.log('🎨 Row formatter running for:', posKey, {
        isExpanded,
        delta,
        borderColor,
        attachedTradeIds: attachedTradeIds?.size || 0,
        attachedPositionKeys: attachedPositionKeys?.size || 0,
        processing: processingPositions.value.has(posKey)
      })
      
      const existingNested = element.querySelector('.nested-tables-container')
      if (existingNested) {
        console.log('🗑️ Removing existing nested container')
        existingNested.remove()
      }

      if (processingPositions.value.has(posKey)) {
        console.log('⏸️ Position is being processed, skipping')
        return
      }

      if (isExpanded && (
        (attachedTradeIds && attachedTradeIds.size > 0) || 
        (attachedPositionKeys && attachedPositionKeys.size > 0) ||
        (attachedOrderIds && attachedOrderIds.size > 0)
      )) {
        console.log('📦 Creating nested tables for:', posKey)
        processingPositions.value.add(posKey)
        
        try {
          const container = document.createElement('div')
          container.className = 'nested-tables-container'
          container.style.cssText = 'padding: 1rem; background: #f8f9fa; border-top: 1px solid #dee2e6;'

          // Add Trades section
          if (attachedTradeIds && attachedTradeIds.size > 0) {
            console.log('📊 Adding trades section')
            const tradesTitle = document.createElement('h4')
            tradesTitle.textContent = `Attached Trades (${attachedTradeIds.size})`
            tradesTitle.style.cssText = 'margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #495057;'
            container.appendChild(tradesTitle)

            const tradesTableDiv = document.createElement('div')
            tradesTableDiv.className = 'nested-trades-table'
            tradesTableDiv.style.cssText = 'margin-bottom: 1rem;'
            container.appendChild(tradesTableDiv)

            const tradesData = await getAttachedTrades(data)
            console.log('✅ Got trades data:', tradesData.length)

            new Tabulator(tradesTableDiv, {
              data: tradesData,
              layout: 'fitColumns',
              columns: [
                { 
                  title: 'Financial instruments', 
                  field: 'symbol', 
                  widthGrow: 1.8,
                  formatter: (cell: any) => {
                    const tags = extractTagsFromTradesSymbol(cell.getValue())
                    return tags.map(tag => `<span class="fi-tag">${tag}</span>`).join(' ')
                  }
                },
                { 
                  title: 'Side', 
                  field: 'buySell', 
                  widthGrow: 1,
                  formatter: (cell: any) => {
                    const side = cell.getValue()
                    const className = side === 'BUY' ? 'trade-buy' : 'trade-sell'
                    return `<span class="trade-side-badge ${className}">${side}</span>`
                  }
                },
                { 
                  title: 'Open/Close', 
                  field: 'openCloseIndicator', 
                  widthGrow: 1,
                  formatter: (cell: any) => {
                    const value = cell.getValue()
                    if (value === 'O') return '<span style="color: #17a2b8; font-weight: bold;">OPEN</span>'
                    if (value === 'C') return '<span style="color: #6f42c1; font-weight: bold;">CLOSE</span>'
                    return value
                  }
                },
                { 
                  title: 'Trade Date', 
                  field: 'tradeDate', 
                  widthGrow: 1,
                  formatter: (cell: any) => formatTradeDate(cell.getValue())
                },
                { 
                  title: 'Settlement Date', 
                  field: 'settleDateTarget', 
                  widthGrow: 1,
                  formatter: (cell: any) => formatTradeDate(cell.getValue())
                },
                { 
                  title: 'Quantity', 
                  field: 'quantity', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => {
                    const row = cell.getRow().getData()
                    const q = parseFloat(row?.quantity || 0) || 0
                    const m = parseFloat(row?.multiplier || 1) || 1
                    const effective = q * m
                    return formatNumber(effective)
                  }
                },
                { 
                  title: 'Price', 
                  field: 'tradePrice', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'Total Premium', 
                  field: 'tradeMoney', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'Net Cash', 
                  field: 'netCash', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'MTM PnL', 
                  field: 'mtmPnl', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'Close Price', 
                  field: 'closePrice', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                }
              ]
            })
          }

          // Add Positions section
          if (attachedPositionKeys && attachedPositionKeys.size > 0) {
            console.log('📊 Adding positions section')
            const positionsTitle = document.createElement('h4')
            positionsTitle.textContent = `Attached Positions (${attachedPositionKeys.size})`
            positionsTitle.style.cssText = 'margin: 1rem 0 0.5rem 0; font-size: 0.9rem; color: #495057;'
            container.appendChild(positionsTitle)

            const positionsTableDiv = document.createElement('div')
            positionsTableDiv.className = 'nested-positions-table'
            container.appendChild(positionsTableDiv)

            const attachedPositionsData = await fetchAttachedPositionsForDisplay(data, attachedPositionKeys)
            console.log('✅ Got positions data:', attachedPositionsData.length)

            // Use the same columns as the parent table but without the Account column
            new Tabulator(positionsTableDiv, {
              data: attachedPositionsData,
              layout: 'fitColumns',
              columns: [
                { 
                  title: 'Financial instruments', 
                  field: 'symbol', 
                  widthGrow: 1.8,
                  formatter: (cell: any) => {
                    const tags = extractTagsFromSymbol(cell.getValue())
                    return tags.map(tag => `<span class="fi-tag">${tag}</span>`).join(' ')
                  }
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
                  },
                  sorter: (a: any, b: any, aRow: any, bRow: any) => {
                    const aData = aRow.getData()
                    const bData = bRow.getData()
                    
                    // Extract dates from symbols
                    const aDateStr = extractTagsFromSymbol(aData.symbol)[1] || ''
                    const bDateStr = extractTagsFromSymbol(bData.symbol)[1] || ''
                    
                    // Handle empty/unknown dates
                    if (!aDateStr && !bDateStr) return 0
                    if (!aDateStr) return 1
                    if (!bDateStr) return -1
                    
                    // Compare as date strings (YYYY-MM-DD format sorts correctly as strings)
                    return aDateStr.localeCompare(bDateStr)
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
                  }
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
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
                    if (value === null || value === undefined) return '-'
                    
                    const row = cell.getRow().getData()
                    const symbol = row.symbol
                    const qty = row.accounting_quantity
                    
                    // Add directional symbol based on option type and position (sold options only)
                    let prefix = ''
                    if (symbol && qty < 0) { // Only for sold options (negative qty)
                      const tags = extractTagsFromSymbol(symbol)
                      const right = tags[3] // Fourth tag is the right (P or C)
                      
                      if (right === 'P') {
                        prefix = '> ' // PUT sold - stock must stay above BE price for profit
                      } else if (right === 'C') {
                        prefix = '< ' // CALL sold - stock must stay below BE price for profit
                      }
                    }
                    
                    return prefix + '$' + Number(value).toFixed(2)
                  }
                },
                { 
                  title: 'Delta', 
                  field: 'delta', 
                  hozAlign: 'right', 
                  headerHozAlign: 'right',
                  widthGrow: 0.8,
                  formatter: (cell: any) => {
                    const value = cell.getValue()
                    if (value == null) return '<span style="color:#aaa;font-style:italic;">N/A</span>'
                    const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
                    return `<span style="color:${color}">${Number(value).toFixed(3)}</span>`
                  }
                }
              ]
            })
          }

          // Add Orders section
          const attachedOrderIds = positionOrdersMap.value.get(posKey)
          //console.log('👀 Attached order IDs for', posKey, attachedOrderIds)
          if (isExpanded && attachedOrderIds && attachedOrderIds.size > 0) {
            console.log('📦 Adding orders section for:', posKey)
            const ordersTitle = document.createElement('h4')
            ordersTitle.textContent = `Attached Orders (${attachedOrderIds.size})`
            ordersTitle.style.cssText = 'margin: 1rem 0 0.5rem 0; font-size: 0.9rem; color: #495057;'
            container.appendChild(ordersTitle)

            const ordersTableDiv = document.createElement('div')
            ordersTableDiv.className = 'nested-orders-table'
            container.appendChild(ordersTableDiv)

            const ordersData = await getAttachedOrders(data)
            //console.log('✅ Got orders data:', ordersData.length)

            new Tabulator(ordersTableDiv, {
              data: ordersData,
              layout: 'fitColumns',
              columns: [
                { 
                  title: 'Financial instruments', 
                  field: 'symbol', 
                  widthGrow: 1.8,
                  formatter: (cell: any) => {
                    const tags = extractTagsFromTradesSymbol(cell.getValue())
                    return tags.map((tag: string) => `<span class="fi-tag">${tag}</span>`).join(' ')
                  }
                },
                { 
                  title: 'Side', 
                  field: 'buySell', 
                  widthGrow: 1,
                  formatter: (cell: any) => {
                    const side = cell.getValue()
                    const className = side === 'BUY' ? 'trade-buy' : 'trade-sell'
                    return `<span class="trade-side-badge ${className}">${side}</span>`
                  }
                },
                { 
                  title: 'Order Date', 
                  field: 'dateTime', 
                  widthGrow: 1,
                  formatter: (cell: any) => formatTradeDate(cell.getValue()),
                  sorter: (a: any, b: any) => {
                    const dateA = new Date(formatTradeDate(a))
                    const dateB = new Date(formatTradeDate(b))
                    return dateA.getTime() - dateB.getTime()
                  }
                },
                { 
                  title: 'Accounting Quantity', 
                  field: 'quantity', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  //formatter: (cell: any) => formatNumber(parseFloat(cell.getValue()) || 0)
                  formatter: (cell: any) => {
                    const value = cell.getValue()
                    if (value === null || value === undefined) return '-'
                    const data = cell.getData()
                    if (data.assetCategory === 'OPT') {
                      return data.quantity * 100
                    } else if (data.assetCategory === 'STK') {
                      return data.quantity * 1
                    }
                    
                    return formatNumber(data.quantity)
                  },
                },
                { 
                  title: 'Trade Price', 
                  field: 'tradePrice', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'Trade Money', 
                  field: 'tradeMoney', 
                  widthGrow: 1,
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { 
                  title: 'Settlement Date', 
                  field: 'settleDateTarget', 
                  widthGrow: 1,
                  formatter: (cell: any) => formatSettleDateTarget(cell.getValue())
                }
              ]
            })
          }

          console.log('✅ Appending nested container to row')
          element.appendChild(container)
        } catch (error) {
          console.error('❌ Error creating nested tables:', error)
        } finally {
          setTimeout(() => {
            processingPositions.value.delete(posKey)
            console.log('✅ Removed from processing')
          }, 100)
        }
      } else {
        console.log('ℹ️ Row not expanded or no attachments')
      }
    } catch (error) {
      console.error('❌ Row formatter error:', error)
    }
  }
})

// Initialize Tabulator for expired positions
const expiredData = computed(() => expiredPositions.value)
const expiredIsSuccess = computed(() => expiredDataLoaded.value && !loadingExpired.value && !errorExpired.value)
const { 
  tableDiv: expiredTableDiv, 
  initializeTabulator: initializeExpiredTabulator,
  isTableInitialized: isExpiredTableInitialized,
  tabulator: expiredTabulator
} = useTabulator({
  data: expiredData,
  columns,
  isSuccess: expiredIsSuccess,
  placeholder: 'No expired positions available',
  onTableCreated: (table: any) => {
    console.log('🎯 Expired table created, applying initial filters')
    const filters: any[] = []
    
    if (accountFilter.value) {
      console.log('📌 Applying account filter to expired table:', accountFilter.value)
      filters.push({
        field: 'legal_entity',
        type: '=',
        value: accountFilter.value
      })
    }
    
    if (expiryDateFilter.value) {
      console.log('📌 Applying expiry date filter to expired table:', expiryDateFilter.value)
      filters.push((data: any) => {
        if (data.asset_class !== 'OPT') return false
        const tags = extractTagsFromSymbol(data.symbol)
        return tags[1] === expiryDateFilter.value
      })
    }
    
    if (strikePriceFilter.value) {
      console.log('📌 Applying strike price filter to expired table:', strikePriceFilter.value)
      filters.push((data: any) => {
        if (data.asset_class !== 'OPT') return false
        const tags = extractTagsFromSymbol(data.symbol)
        return tags[2] === strikePriceFilter.value
      })
    }
    
    if (filters.length > 0) {
      table.setFilter(filters)
    }
  },
  rowFormatter: async (row: any) => {
    // Same rowFormatter as current positions
    try {
      const data = row.getData()
      const element = row.getElement()
      
      if (!data) return

      // 🎨 Apply delta-based border color styling
      const delta = data.delta
      const borderColor = getDeltaBorderColor(delta)
      const firstCell = element.querySelector('.tabulator-cell:first-child') as HTMLElement
      if (firstCell) {
        firstCell.style.borderLeft = `10px solid ${borderColor}`
      }

      const posKey = getRowPositionKey(data)
      const attachedTradeIds = positionTradesMap.value.get(posKey)
      const attachedPositionKeys = positionPositionsMap.value.get(posKey)
      const isExpanded = expandedPositions.value.has(posKey)
      
      const existingNested = element.querySelector('.nested-tables-container')
      if (existingNested) {
        existingNested.remove()
      }

      if (processingPositions.value.has(posKey)) {
        return
      }

      if (isExpanded && (
        (attachedTradeIds && attachedTradeIds.size > 0) || 
        (attachedPositionKeys && attachedPositionKeys.size > 0)
      )) {
        processingPositions.value.add(posKey)
        
        try {
          const container = document.createElement('div')
          container.className = 'nested-tables-container'
          container.style.cssText = 'padding: 1rem; background: #f8f9fa; border-top: 1px solid #dee2e6;'

          // Add Trades section
          if (attachedTradeIds && attachedTradeIds.size > 0) {
            const tradesTitle = document.createElement('h4')
            tradesTitle.textContent = `Attached Trades (${attachedTradeIds.size})`
            tradesTitle.style.cssText = 'margin: 0 0 0.5rem 0; font-size: 0.9rem; color: #495057;'
            container.appendChild(tradesTitle)

            const tradesTableDiv = document.createElement('div')
            tradesTableDiv.className = 'nested-trades-table'
            tradesTableDiv.style.cssText = 'margin-bottom: 1rem;'
            container.appendChild(tradesTableDiv)

            const tradesData = await getAttachedTrades(data)

            new Tabulator(tradesTableDiv, {
              data: tradesData,
              layout: 'fitColumns',
              columns: [
                { 
                  title: 'Financial instruments', 
                  field: 'symbol', 
                  width: 200,
                  formatter: (cell: any) => {
                    const tags = extractTagsFromTradesSymbol(cell.getValue())
                    return tags.map(tag => `<span class="fi-tag">${tag}</span>`).join(' ')
                  }
                },
                { 
                  title: 'Side', 
                  field: 'buySell', 
                  width: 80,
                  formatter: (cell: any) => {
                    const side = cell.getValue()
                    const className = side === 'BUY' ? 'trade-buy' : 'trade-sell'
                    return `<span class="trade-side-badge ${className}">${side}</span>`
                  }
                },
                { title: 'Quantity', field: 'quantity', width: 100, hozAlign: 'right' },
                { 
                  title: 'Price', 
                  field: 'tradePrice', 
                  width: 100, 
                  hozAlign: 'right',
                  formatter: (cell: any) => formatCurrency(parseFloat(cell.getValue()) || 0)
                },
                { title: 'Trade Date', field: 'tradeDate', width: 120 },
              ]
            })
          }

          // Add Positions section - UPDATED TO MATCH CURRENT TAB
          if (attachedPositionKeys && attachedPositionKeys.size > 0) {
            const positionsTitle = document.createElement('h4')
            positionsTitle.textContent = `Attached Positions (${attachedPositionKeys.size})`
            positionsTitle.style.cssText = 'margin: 1rem 0 0.5rem 0; font-size: 0.9rem; color: #495057;'
            container.appendChild(positionsTitle)

            const positionsTableDiv = document.createElement('div')
            positionsTableDiv.className = 'nested-positions-table'
            container.appendChild(positionsTableDiv)

            const attachedPositionsData = await fetchAttachedPositionsForDisplay(data, attachedPositionKeys)

            // Use the same columns as the parent table but without the Account column
            new Tabulator(positionsTableDiv, {
              data: attachedPositionsData,
              layout: 'fitColumns',
              columns: [
                { 
                  title: 'Financial instruments', 
                  field: 'symbol', 
                  widthGrow: 1.8,
                  formatter: (cell: any) => {
                    const tags = extractTagsFromSymbol(cell.getValue())
                    return tags.map(tag => `<span class="fi-tag">${tag}</span>`).join(' ')
                  }
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
                  },
                  sorter: (a: any, b: any, aRow: any, bRow: any) => {
                    const aData = aRow.getData()
                    const bData = bRow.getData()
                    
                    // Extract dates from symbols
                    const aDateStr = extractTagsFromSymbol(aData.symbol)[1] || ''
                    const bDateStr = extractTagsFromSymbol(bData.symbol)[1] || ''
                    
                    // Handle empty/unknown dates
                    if (!aDateStr && !bDateStr) return 0
                    if (!aDateStr) return 1
                    if (!bDateStr) return -1
                    
                    // Compare as date strings (YYYY-MM-DD format sorts correctly as strings)
                    return aDateStr.localeCompare(bDateStr)
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
                  }
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
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
                  }
                },
                { 
                  title: 'Entry Cash<br>Flow', 
                  field: 'computed_cash_flow_on_entry', 
                  hozAlign: 'right', 
                  headerHozAlign: 'right',
                  widthGrow: 1,
                  formatter: (cell: any) => {
                    const value = cell.getValue()
                    if (value == null) return ''
                    const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
                  },
                  bottomCalc: 'sum',
                  bottomCalcFormatter: (cell: any) => {
                    const value = cell.getValue()
                    const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
                    return `<span style="color:${color}">$${Number(value).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}</span>`
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
                    if (value === null || value === undefined) return '-'
                    
                    const row = cell.getRow().getData()
                    const symbol = row.symbol
                    const qty = row.accounting_quantity
                    
                    // Add directional symbol based on option type and position (sold options only)
                    let prefix = ''
                    if (symbol && qty < 0) { // Only for sold options (negative qty)
                      const tags = extractTagsFromSymbol(symbol)
                      const right = tags[3] // Fourth tag is the right (P or C)
                      
                      if (right === 'P') {
                        prefix = '> ' // PUT sold - stock must stay above BE price for profit
                      } else if (right === 'C') {
                        prefix = '< ' // CALL sold - stock must stay below BE price for profit
                      }
                    }
                    
                    return prefix + '$' + Number(value).toFixed(2)
                  }
                },
                { 
                  title: 'Delta', 
                  field: 'delta', 
                  hozAlign: 'right', 
                  headerHozAlign: 'right',
                  widthGrow: 0.8,
                  formatter: (cell: any) => {
                    const value = cell.getValue()
                    if (value == null) return '<span style="color:#aaa;font-style:italic;">N/A</span>'
                    const color = value < 0 ? '#dc3545' : value > 0 ? '#28a745' : '#000'
                    return `<span style="color:${color}">${Number(value).toFixed(3)}</span>`
                  }
                }
              ]
            })
          }

          element.appendChild(container)
        } finally {
          setTimeout(() => {
            processingPositions.value.delete(posKey)
          }, 100)
        }
      }
    } catch (error) {
      console.error('❌ Row formatter error:', error)
    }
  }
})

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

function isExpired(symbolText: string): boolean {
  const tags = extractTagsFromSymbol(symbolText)
  const expiryDate = tags[1] // YYYY-MM-DD format
  if (!expiryDate) return false
  
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(expiryDate)
  
  return expiry < today
}

function handleAccountFilter(accountName: string) {
  const url = new URL(window.location.href)
  
  // Toggle filter
  if (accountFilter.value === accountName) {
    // Clear filter
    accountFilter.value = null
    url.searchParams.delete('all_cts_clientId')
  } else {
    // Set filter
    accountFilter.value = accountName
    url.searchParams.set('all_cts_clientId', accountName)
  }
  
  window.history.replaceState({}, '', url.toString())
  updateFilters()
  
  // Emit event to other components
  if (eventBus) {
    eventBus.emit('account-filter-changed', {
      accountId: accountFilter.value,
      source: 'call-positions'
    })
  }
}

function handleExpiryDateFilter(expiryDate: string) {
  const url = new URL(window.location.href)
  
  // Toggle filter
  if (expiryDateFilter.value === expiryDate) {
    // Clear filter
    expiryDateFilter.value = null
    url.searchParams.delete('expiryDate')
  } else {
    // Set filter
    expiryDateFilter.value = expiryDate
    url.searchParams.set('expiryDate', expiryDate)
  }
  
  window.history.replaceState({}, '', url.toString())
  updateFilters()
  
  // Emit event to other components
  if (eventBus) {
    eventBus.emit('expiry-date-filter-changed', {
      expiryDate: expiryDateFilter.value,
      source: 'call-positions'
    })
  }
}

function handleStrikePriceFilter(strikePrice: string) {
  const url = new URL(window.location.href)
  
  // Toggle filter
  if (strikePriceFilter.value === strikePrice) {
    // Clear filter
    strikePriceFilter.value = null
    url.searchParams.delete('strikePrice')
  } else {
    // Set filter
    strikePriceFilter.value = strikePrice
    url.searchParams.set('strikePrice', strikePrice)
  }
  
  window.history.replaceState({}, '', url.toString())
  updateFilters()
  
  // Emit event to other components
  if (eventBus) {
    eventBus.emit('strike-price-filter-changed', {
      strikePrice: strikePriceFilter.value,
      source: 'call-positions'
    })
  }
}

// Update the updateFilters function to include account filter (around line 1460)
// Update the updateFilters function (around line 1515)
// Update the updateFilters function (around line 1760)
function updateFilters() {
  console.log('🔍 Applying filters:', {
    account: accountFilter.value,
    expiry: expiryDateFilter.value,
    strike: strikePriceFilter.value
  })

  // Update current positions table
  if (tabulator.value && isTableInitialized.value) {
    console.log('🔄 Clearing existing filters on current table')
    tabulator.value.clearFilter()

    // Build a single custom filter function that handles all filters
    const hasFilters = accountFilter.value || expiryDateFilter.value || strikePriceFilter.value

    if (hasFilters) {
      console.log('✅ Applying combined filter function')
      
      tabulator.value.setFilter((data: any) => {
        // Account filter
        if (accountFilter.value) {
          if (data.legal_entity !== accountFilter.value) {
            return false
          }
        }

        // Expiry date filter
        if (expiryDateFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          const expiryMatch = tags[1] === expiryDateFilter.value
          console.log('📅 Expiry filter check:', data.symbol, tags[1], 'vs', expiryDateFilter.value, '=', expiryMatch)
          if (!expiryMatch) return false
        }

        // Strike price filter
        if (strikePriceFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          const strikeMatch = tags[2] === strikePriceFilter.value
          console.log('💰 Strike filter check:', data.symbol, 'extracted:', tags[2], 'vs filter:', strikePriceFilter.value, '=', strikeMatch)
          if (!strikeMatch) return false
        }

        return true
      })
    }

    nextTick(() => {
      if (tabulator.value) {
        tabulator.value.redraw(true)
        console.log('🔄 Table redrawn')
      }
    })
  } else {
    console.log('⚠️ Table not ready:', {
      hasTabulator: !!tabulator.value,
      isInitialized: isTableInitialized.value
    })
  }

  // Update expired positions table
  if (expiredTabulator.value && isExpiredTableInitialized.value) {
    console.log('🔄 Clearing existing filters on expired table')
    expiredTabulator.value.clearFilter()

    const hasFilters = accountFilter.value || expiryDateFilter.value || strikePriceFilter.value

    if (hasFilters) {
      console.log('✅ Applying combined filter function to expired table')
      
      expiredTabulator.value.setFilter((data: any) => {
        // Account filter
        if (accountFilter.value && data.legal_entity !== accountFilter.value) {
          return false
        }

        // Expiry date filter
        if (expiryDateFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          if (tags[1] !== expiryDateFilter.value) return false
        }

        // Strike price filter
        if (strikePriceFilter.value) {
          if (data.asset_class !== 'OPT') return false
          const tags = extractTagsFromSymbol(data.symbol)
          if (tags[2] !== strikePriceFilter.value) return false
        }

        return true
      })
    }

    nextTick(() => {
      if (expiredTabulator.value) {
        expiredTabulator.value.redraw(true)
        console.log('🔄 Expired table redrawn')
      }
    })
  }
}

function handleExternalAccountFilter(payload: { accountId: string | null, source: string }) {
  console.log('📍 [Call Positions] Received account filter:', payload)
  if (payload.source === 'call-positions') return // Ignore own events

  // Apply or clear the filter
  accountFilter.value = payload.accountId
  const url = new URL(window.location.href)
  if (payload.accountId) {
    url.searchParams.set('all_cts_clientId', payload.accountId)
  } else {
    url.searchParams.delete('all_cts_clientId')
  }
  window.history.replaceState({}, '', url.toString())
  updateFilters()
}

function handleExternalExpiryDateFilter(payload: { expiryDate: string | null, source: string }) {
  console.log('📍 [Call Positions] Received expiry date filter:', payload)
  if (payload.source === 'call-positions') return // Ignore own events

  // Apply or clear the filter
  expiryDateFilter.value = payload.expiryDate
  const url = new URL(window.location.href)
  if (payload.expiryDate) {
    url.searchParams.set('expiryDate', payload.expiryDate)
  } else {
    url.searchParams.delete('expiryDate')
  }
  window.history.replaceState({}, '', url.toString())
  updateFilters()
}

function handleExternalStrikePriceFilter(payload: { strikePrice: string | null, source: string }) {
  console.log('📍 [Call Positions] Received strike price filter:', payload)
  if (payload.source === 'call-positions') return // Ignore own events

  // Apply or clear the filter
  strikePriceFilter.value = payload.strikePrice
  const url = new URL(window.location.href)
  if (payload.strikePrice) {
    url.searchParams.set('strikePrice', payload.strikePrice)
  } else {
    url.searchParams.delete('strikePrice')
  }
  window.history.replaceState({}, '', url.toString())
  updateFilters()
}

onMounted(async () => {
  //accountFilter.value = parseAccountFilterFromUrl()
  if (eventBus) {
    eventBus.on('account-filter-changed', handleExternalAccountFilter)
    eventBus.on('expiry-date-filter-changed', handleExternalExpiryDateFilter)
    eventBus.on('strike-price-filter-changed', handleExternalStrikePriceFilter)
  }

  console.log('🎬 Component mounted')
  console.log('📊 Query state:', {
    isLoading: q.isLoading.value,
    isSuccess: q.isSuccess.value,
    isReady: isReady.value,
    dataLength: q.data.value?.length
  })
  
  // Don't set isTableInitialized manually, let the composable handle it
  // The useTabulator composable will initialize when data is ready
  
  // Add click listener to close context menu
  document.addEventListener('click', () => {
    showContextMenu.value = false
  })
})

watch(accountFilter, (newVal, oldVal) => {
  console.log('🔄 Account filter changed:', { old: oldVal, new: newVal })
  if (tabulator.value && isTableInitialized.value) {
    updateFilters()
  }
}, { immediate: true })

// Add watchers for new filters
watch(expiryDateFilter, (newVal, oldVal) => {
  console.log('🔄 Expiry date filter changed:', { old: oldVal, new: newVal })
  if (tabulator.value && isTableInitialized.value) {
    updateFilters()
  }
}, { immediate: true })

watch(strikePriceFilter, (newVal, oldVal) => {
  console.log('🔄 Strike price filter changed:', { old: oldVal, new: newVal })
  if (tabulator.value && isTableInitialized.value) {
    updateFilters()
  }
}, { immediate: true })

// Watch for when mappings become ready and redraw the table
watch(isReady, async (ready) => {
  console.log('👀 Mappings ready state changed:', ready)
  
  if (ready && tabulator.value && isTableInitialized.value) {
    console.log('🔄 Redrawing table with mappings')
    tabulator.value.redraw(true)
  }
}, { immediate: true })

// REMOVE these watchers - let useTabulator handle initialization
// watch(() => q.isSuccess.value, async (success) => {
//   ...
// }, { immediate: true })

onBeforeUnmount(() => {
  console.log('👋 Component unmounting')
  
  if (eventBus) {
    eventBus.off('account-filter-changed', handleExternalAccountFilter)
    eventBus.off('expiry-date-filter-changed', handleExternalExpiryDateFilter)
    eventBus.off('strike-price-filter-changed', handleExternalStrikePriceFilter)
  }
  
  // Clean up click listener
  document.removeEventListener('click', () => {
    showContextMenu.value = false
  })
})

// -------------------------
// Attach trades / positions
// -------------------------
const showAttachModal = ref(false)
const attachmentTab = ref<'trades' | 'positions' | 'orders'>('trades')
const selectedPositionForTrades = ref<any | null>(null)
const selectedPositionForPositions = ref<any | null>(null)
const selectedOrderIds = ref<Set<string>>(new Set())
const tradeSearchQuery = ref('')
const positionSearchQuery = ref('')
const orderSearchQuery = ref('')
const selectedTradeIds = ref<Set<string>>(new Set())
const selectedPositionKeys = ref<Set<string>>(new Set())
const loadingAttachable = ref(false)
const attachableTrades = ref<any[]>([])
const attachablePositions = ref<any[]>([])
const attachableOrders = ref<any[]>([])

function toggleTradeSelection(id: string) {
  if (selectedTradeIds.value.has(id)) selectedTradeIds.value.delete(id)
  else selectedTradeIds.value.add(id)
}

function togglePositionSelection(key: string) {
  if (selectedPositionKeys.value.has(key)) selectedPositionKeys.value.delete(key)
  else selectedPositionKeys.value.add(key)
}

function toggleOrderSelection(id: string) {
  if (selectedOrderIds.value.has(id)) selectedOrderIds.value.delete(id)
  else selectedOrderIds.value.add(id)
}

async function loadAttachableTradesForPosition(position: any) {
  loadingAttachable.value = true
  attachableTrades.value = []
  try {
    const symbolRoot = extractTagsFromSymbol(position.symbol)[0] || ''
    if (!symbolRoot) return
    const allTrades = await fetchTradesForSymbol(symbolRoot, position.internal_account_id)
    // basic search filter
    const q = tradeSearchQuery.value.trim().toLowerCase()
    attachableTrades.value = q
      ? allTrades.filter((t: any) => (t.symbol || '').toLowerCase().includes(q) || String(t.tradeID || '').toLowerCase().includes(q))
      : allTrades
  } catch (err) {
    console.error('❌ loadAttachableTradesForPosition error:', err)
    attachableTrades.value = []
  } finally {
    loadingAttachable.value = false
  }
}

async function loadAttachablePositionsForPosition(position: any) {
  loadingAttachable.value = true
  attachablePositions.value = []
  try {
    const symbolRoot = extractTagsFromSymbol(position.symbol)[0] || ''
    if (!symbolRoot) return
    const accountId = position.internal_account_id || position.legal_entity
    const allPositions = await fetchPositionsBySymbolRoot(supabase, symbolRoot, props.userId, accountId)
    const q = positionSearchQuery.value.trim().toLowerCase()
    attachablePositions.value = q
      ? allPositions.filter((p: any) => (p.symbol || '').toLowerCase().includes(q))
      : allPositions
  } catch (err) {
    console.error('❌ loadAttachablePositionsForPosition error:', err)
    attachablePositions.value = []
  } finally {
    loadingAttachable.value = false
  }
}


async function loadAttachableOrdersForPosition(position: any) {
  loadingAttachable.value = true
  attachableOrders.value = []
  try {
    const symbolRoot = extractTagsFromSymbol(position.symbol)[0] || ''
    if (!symbolRoot) return
    const allOrders = await fetchOrdersForSymbol(symbolRoot, position.internal_account_id)
    const q = orderSearchQuery.value.trim().toLowerCase()
    attachableOrders.value = q
      ? allOrders.filter((o: any) => (o.symbol || '').toLowerCase().includes(q) || String(o.orderID || '').toLowerCase().includes(q))
      : allOrders
  } catch (err) {
    console.error('❌ loadAttachableOrdersForPosition error:', err)
    attachableOrders.value = []
  } finally {
    loadingAttachable.value = false
  }
}

async function openAttachModal(position: any, tab: 'trades' | 'positions' | 'orders' = 'trades') {
  selectedPositionForTrades.value = position
  selectedPositionForPositions.value = position
  attachmentTab.value = tab
  tradeSearchQuery.value = ''
  positionSearchQuery.value = ''
  orderSearchQuery.value = ''

  const posKey = getPositionKey(position)
  selectedTradeIds.value = new Set(positionTradesMap.value.get(posKey) || [])
  selectedPositionKeys.value = new Set(positionPositionsMap.value.get(posKey) || [])
  selectedOrderIds.value = new Set(positionOrdersMap.value.get(posKey) || [])

  showAttachModal.value = true
  if (tab === 'trades') {
    await loadAttachableTradesForPosition(position)
  } else if (tab === 'positions') {
    await loadAttachablePositionsForPosition(position)
  } else {
    await loadAttachableOrdersForPosition(position)
  }
}

async function saveAttachedOrders() {
  if (!selectedPositionForTrades.value || !props.userId) return
  const posKey = getPositionKey(selectedPositionForTrades.value)
  try {
    await savePositionOrderMappings(supabase, props.userId, posKey, selectedOrderIds.value)
    if (refetchMappings) await refetchMappings()
    showAttachModal.value = false
    if (tabulator.value) tabulator.value.redraw(true)
    //console.log('✅ Orders attached')
  } catch (err: any) {
    console.error('❌ Error saving attached orders:', err)
  }
}

async function saveAttachedTrades() {
  if (!selectedPositionForTrades.value || !props.userId) return
  const posKey = getPositionKey(selectedPositionForTrades.value)
  try {
    await savePositionTradeMappings(supabase, props.userId, posKey, selectedTradeIds.value)
    // refresh mappings so UI reflects new attachments
    if (refetchMappings) await refetchMappings()
    showAttachModal.value = false
    if (tabulator.value) tabulator.value.redraw(true)
    console.log('✅ Trades attached')
  } catch (err: any) {
    console.error('❌ Error saving attached trades:', err)
  }
}

async function saveAttachedPositions() {
  if (!selectedPositionForPositions.value || !props.userId) return
  const posKey = getPositionKey(selectedPositionForPositions.value)
  try {
    await savePositionPositionMappings(supabase, props.userId, posKey, selectedPositionKeys.value)
    if (refetchMappings) await refetchMappings()
    showAttachModal.value = false
    if (tabulator.value) tabulator.value.redraw(true)
    console.log('✅ Positions attached')
  } catch (err: any) {
    console.error('❌ Error saving attached positions:', err)
  }
}

function isPositionExpired(position: Position): boolean {
  if (position.asset_class !== 'OPT') return false
  
  const tags = extractTagsFromSymbol(position.symbol)
  const expiryStr = tags[1] // Date is second tag
  if (!expiryStr) return false
  
  const expiryDate = new Date(expiryStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  return expiryDate < today
}


function formatSettleDateTarget(dateStr: string): string {
  const val = dateStr
  if (!val) return ''
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(val).trim())
  let dt: Date
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2]) - 1
    let year = Number(m[3])
    if (year < 100) year += 2000
    dt = new Date(year, month, day)
  } else {
    dt = new Date(val)
    if (isNaN(dt.getTime())) return String(val)
  }
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

watch([q.isSuccess, () => q.data.value], async ([success, dataValue]) => {
  if (success && dataValue && dataValue.length > 0 && tableDiv.value && !isTableInitialized.value) {
    await nextTick()
    initializeTabulator()
  }
}, { immediate: true })

function formatDateWithTimePST(dateStr: string): string {
  if (!dateStr) return ''
  
  const date = new Date(dateStr)
  
  // Format with PST timezone
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'short'
  }).format(date)
}

// close/open body scroll lock for modal
watch(showAttachModal, (val) => {
  try {
    if (val) document.body.classList.add('modal-open')
    else document.body.classList.remove('modal-open')
  } catch (e) {
    // ignore for SSR or restricted environments
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

    <div v-if="activeFilters.length > 0" class="filters-bar">
      <span class="filters-label">Filtered by:</span>
      <div class="filters-tags">
        <span v-for="f in activeFilters" :key="`${f.field}-${f.value}`" class="filter-tag">
          <strong>{{ f.label }}:</strong> {{ f.value }}
          <button class="tag-clear" @click="clearFilter(f.field)">✕</button>
        </span>
        <button class="btn btn-clear-all" @click="clearAllFilters">Clear all</button>
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

    <!-- Attach modal -->
    <div v-if="showAttachModal" class="modal-overlay" @click="showAttachModal = false">
      <div class="modal-content trade-attach-modal" @click.stop>
        <div class="modal-header">
          <h3>Attach to Position</h3>
          <button class="modal-close" @click="showAttachModal = false">&times;</button>
        </div>

        <div class="modal-body">
          <div v-if="selectedPositionForPositions" class="position-info">
            <strong>Position:</strong>
            <span v-for="tag in extractTagsFromSymbol(selectedPositionForPositions.symbol)" :key="tag" class="fi-tag position-tag">
              {{ tag }}
            </span>
            • (Contract Qty: {{ selectedPositionForPositions.contract_quantity }} · Avg price: ${{ selectedPositionForPositions.avgPrice }})
          </div>

          <div class="attachment-tabs">
            <button
              class="tab-button"
              :class="{ active: attachmentTab === 'trades' }"
              @click="attachmentTab = 'trades'; loadAttachableTradesForPosition(selectedPositionForTrades)"
            >Trades</button>
            <button
              class="tab-button"
              :class="{ active: attachmentTab === 'positions' }"
              @click="attachmentTab = 'positions'; loadAttachablePositionsForPosition(selectedPositionForPositions)"
            >Positions</button>
             <button
              class="tab-button"
              :class="{ active: attachmentTab === 'orders' }"
              @click="attachmentTab = 'orders'; loadAttachableOrdersForPosition(selectedPositionForTrades)"
            >Orders</button>
          </div>

          <!-- Trades tab -->
          <div v-if="attachmentTab === 'trades'">
            <div class="trade-search">
              <input
                v-model="tradeSearchQuery"
                type="text"
                class="search-input"
                placeholder="Search trades (e.g., 'Put' or 'Call, 250')..."
                @input="loadAttachableTradesForPosition(selectedPositionForTrades)"
              />
              <div class="search-hint">💡 <em>Use commas to search multiple terms (AND logic)</em></div>
            </div>

            <div v-if="loadingAttachable" style="padding:1rem;text-align:center;color:#6c757d;">Loading trades...</div>

            <div class="trades-list" v-else>
              <div
                v-for="t in attachableTrades"
                :key="t.tradeID"
                class="trade-item"
                :class="{ selected: selectedTradeIds.has(String(t.tradeID)) }"
                @click="toggleTradeSelection(String(t.tradeID))"
              >
                <input
                  type="checkbox"
                  :checked="selectedTradeIds.has(String(t.tradeID))"
                  @click.stop="toggleTradeSelection(String(t.tradeID))"
                />
                <div class="trade-details">
                  <div class="trade-primary">
                    <span class="trade-side" :class="(t.buySell || '').toLowerCase()">{{ t.buySell }}</span>
                    <strong>
                      <span v-for="tag in extractTagsFromTradesSymbol(t.symbol)" :key="tag" class="fi-tag position-tag">{{ tag }}</span>
                    </strong>
                    <span style="color:#6c757d;">Qty: {{ t.quantity }}</span>
                    <span style="color:#6c757d;">· Price: {{ t.tradePrice }}</span>
                  </div>
                  <div class="trade-secondary">
                    <span>Trade date: {{ formatTradeDate(t.tradeDate) }}</span>
                    <span v-if="t.assetCategory">• {{ t.assetCategory }}</span>
                    <span v-if="t.description">• {{ t.description }}</span>
                    <span style="color:#6c757d;margin-left:6px;">• ID: {{ t.tradeID }}</span>
                  </div>
                </div>
              </div>

              <div v-if="attachableTrades.length === 0" style="padding:1.5rem;text-align:center;color:#6c757d;">
                No trades found
              </div>
            </div>
          </div>

          <!-- Positions tab -->
          <div v-else-if="attachmentTab === 'positions'">
            <div class="trade-search">
              <input
                v-model="positionSearchQuery"
                type="text"
                class="search-input"
                placeholder="Search positions (e.g., 'Put' or 'Call, 250')..."
                @input="loadAttachablePositionsForPosition(selectedPositionForPositions)"
              />
              <div class="search-hint">💡 <em>Showing positions with same underlying symbol. Use commas to search multiple terms.</em></div>
            </div>

            <div v-if="loadingAttachable" style="padding:1rem;text-align:center;color:#6c757d;">Loading positions...</div>

            <div class="trades-list" v-else>
              <div
                v-for="p in attachablePositions"
                :key="getPositionKey(p)"
                class="trade-item"
                :class="{ selected: selectedPositionKeys.has(getPositionKey(p)), expired: p.asset_class === 'OPT' && isPositionExpired(p) }"
                @click="togglePositionSelection(getPositionKey(p))"
              >
                <input
                  type="checkbox"
                  :checked="selectedPositionKeys.has(getPositionKey(p))"
                  @click.stop="togglePositionSelection(getPositionKey(p))"
                />
                <div class="trade-details">
                  <div class="trade-primary">
                    <strong>
                      <span v-for="tag in extractTagsFromSymbol(p.symbol)" :key="tag" class="fi-tag position-tag">{{ tag }}</span>
                    </strong>
                    <span style="color:#6c757d;">Qty: {{ p.contract_quantity }}</span>
                    <span style="color:#6c757d;">· Avg price: {{ formatCurrency(p.avgPrice) }}</span>
                    <span v-if="isPositionExpired(p)" class="expired-badge">EXPIRED</span>
                  </div>
                  <div class="trade-secondary">
                    <span>{{ p.asset_class }}</span>
                    <span> • </span>
                    <span>{{ p.internal_account_id || p.legal_entity }}</span>
                    <span v-if="p.market_value">• MV: {{ formatCurrency(p.market_value) }}</span>
                    <span> • </span>
                    <span>Fetched at: {{ formatDateWithTimePST(p.fetched_at) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="attachablePositions.length === 0" style="padding:1.5rem;text-align:center;color:#6c757d;">
                No positions found
              </div>
            </div>
          </div>
          <div v-else>
            <div class="trade-search">
              <input
                v-model="orderSearchQuery"
                type="text"
                class="search-input"
                placeholder="Search orders (e.g., 'Put' or 'Call, 250')..."
                @input="loadAttachableOrdersForPosition(selectedPositionForTrades)"
              />
              <div class="search-hint">💡 <em>Showing orders with same underlying symbol. Use commas to search multiple terms.</em></div>
            </div>

            <div v-if="loadingAttachable" style="padding:1rem;text-align:center;color:#6c757d;">Loading orders...</div>

            <div class="trades-list" v-else>
              <div
                v-for="o in attachableOrders"
                :key="o.id"
                class="trade-item"
                :class="{ selected: selectedOrderIds.has(String(o.id)) }"
                @click="toggleOrderSelection(String(o.id))"
              >
                <input
                  type="checkbox"
                  :checked="selectedOrderIds.has(String(o.id))"
                  @click.stop="toggleOrderSelection(String(o.id))"
                />
                <div class="trade-details">
                  <div class="trade-primary">
                    <strong>
                      <span v-for="tag in extractTagsFromTradesSymbol(o.symbol)" :key="tag" class="fi-tag position-tag">{{ tag }}</span>
                    </strong>
                    <span style="color:#6c757d;">Qty: {{ o.contract_quantity }}</span>
                    <span style="color:#6c757d;">· Trade price: {{ formatCurrency(o.tradePrice) }}</span>
                  </div>
                  <div class="trade-secondary">
                    <span>{{ o.assetCategory }}</span>
                    <span v-if="o.tradeMoney">• Trade money: {{ formatCurrency(o.tradeMoney) }}</span>
                    <span> • </span>
                    <span>Settlement Date: {{ formatSettleDateTarget(o.settleDateTarget) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="attachableOrders.length === 0" style="padding:1.5rem;text-align:center;color:#6c757d;">
                No orders found
              </div>
            </div>
          </div>

        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showAttachModal = false">Cancel</button>
          <button
            class="btn btn-primary"
            :disabled="attachmentTab === 'trades' ? selectedTradeIds.size === 0 : attachmentTab === 'positions' ? selectedPositionKeys.size === 0 : selectedOrderIds.size === 0"
            @click="attachmentTab === 'trades' ? saveAttachedTrades() : attachmentTab === 'positions' ? saveAttachedPositions() : saveAttachedOrders()"
          >
            Attach {{ attachmentTab === 'trades' ? selectedTradeIds.size : attachmentTab === 'positions' ? selectedPositionKeys.size : selectedOrderIds.size }} 
            {{ attachmentTab === 'trades' ? 'Trade(s)' : attachmentTab === 'positions' ? 'Position(s)' : 'Order(s)' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <div 
      v-if="showContextMenu" 
      class="context-menu"
      :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
      @click="showContextMenu = false"
      v-html="contextMenuContent"
    ></div>
  </div>
</template>

<style>
@import 'tabulator-tables/dist/css/tabulator_modern.min.css';
@import '../styles/styles.css';

.context-menu {
  position: fixed;
  background: white;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10000;
  min-width: 300px;
  max-width: 400px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
}

.context-menu:hover {
  background: #f8f9fa;
}
</style>

<style scoped>
@import '../styles/scoped-styles.css';
</style>