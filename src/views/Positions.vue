<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch } from 'vue'
import type { ColumnDefinition } from 'tabulator-tables'
import { useCallPositionsQuery } from '@y2kfund/core/callPositionsForSingleInstrument'
import { useSupabase, fetchPositionsBySymbolRoot } from '@y2kfund/core'
import { useTabulator } from '../composables/useTabulator'
import { useAttachedData } from '../composables/useAttachedData'
import { usePositionExpansion } from '../composables/usePositionExpansion'
import { TabulatorFull as Tabulator } from 'tabulator-tables'

interface callPositionsProps {
  symbolRoot: string
  userId?: string | null
}

const props = withDefaults(defineProps<callPositionsProps>(), {
  symbolRoot: 'META',
  userId: '67e578fd-2cf7-48a4-b028-a11a3f89bb9b'
})

const supabase = useSupabase()

// Active tab state
const activeTab = ref<'current' | 'expired'>('current')

// Query call positions
const q = useCallPositionsQuery(props.symbolRoot, props.userId)

// Use attached data composable - CHANGED: removed symbolRoot param
const {
  positionTradesMap,
  positionPositionsMap,
  getPositionKey,
  getAttachedTrades,
  fetchAttachedPositionsForDisplay,
  isReady
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
      
      //console.log('🔍 Position Key:', positionTradesMap.value)
      console.log('🎨 Formatter for', posKey, {
        attachedTradeIds: attachedTradeIds?.size || 0,
        isReady: isReady.value
      })
      
      const hasAttachments = (attachedTradeIds && attachedTradeIds.size > 0) || 
                            (attachedPositionKeys && attachedPositionKeys.size > 0)
      const isExpanded = expandedPositions.value.has(posKey)
      
      const expandArrow = hasAttachments
        ? `<span class="expand-arrow ${isExpanded ? 'expanded' : ''}" data-position-key="${posKey}" title="${isExpanded ? 'Collapse' : 'Expand'} attachments">
            ${isExpanded ? '▼' : '▶'}
          </span>`
        : '<span class="expand-arrow">&nbsp;</span>'
      
      const totalAttachments = (attachedTradeIds?.size || 0) + (attachedPositionKeys?.size || 0)
      const attachmentLabel = totalAttachments > 0 
        ? `<span class="trade-count">(${totalAttachments})</span>`
        : ''
      
      return `
        <div style="display: flex; align-items: center; gap: 6px;">
          ${expandArrow}
          <span>${accountName}</span>
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
const { tableDiv, initializeTabulator, isTableInitialized, tabulator } = useTabulator({
  data: q.data,
  columns,
  isSuccess: q.isSuccess,
  placeholder: 'No call positions available',
  rowFormatter: async (row: any) => {
    try {
      const data = row.getData()
      const element = row.getElement()
      
      if (!data) return

      const posKey = getRowPositionKey(data)
      const attachedTradeIds = positionTradesMap.value.get(posKey)
      const attachedPositionKeys = positionPositionsMap.value.get(posKey)
      const isExpanded = expandedPositions.value.has(posKey)
      
      console.log('🎨 Row formatter running for:', posKey, {
        isExpanded,
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
        (attachedPositionKeys && attachedPositionKeys.size > 0)
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
  rowFormatter: async (row: any) => {
    // Same rowFormatter as current positions
    try {
      const data = row.getData()
      const element = row.getElement()
      
      if (!data) return

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

onMounted(async () => {
  console.log('🎬 Component mounted')
  console.log('📊 Query state:', {
    isLoading: q.isLoading.value,
    isSuccess: q.isSuccess.value,
    isReady: isReady.value,
    dataLength: q.data.value?.length
  })
  
  // Don't set isTableInitialized manually, let the composable handle it
  // The useTabulator composable will initialize when data is ready
})

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