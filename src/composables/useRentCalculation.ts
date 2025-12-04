import { ref } from 'vue'
import { useSupabase } from '@y2kfund/core'

// Cache for trade open dates to avoid repeated queries
const tradeOpenDateCache = ref<Map<string, string | null>>(new Map())

export interface RentCalculation {
  // At Entry
  entryPremiumPerShare: number | null
  entryRentPerDayPerShare: number | null
  totalDaysAtEntry: number | null
  
  // Current (Time Remaining)
  currentPremiumPerShare: number | null
  currentRentPerDayPerShare: number | null
  currentDTE: number | null
  
  // Source values
  entryCashFlow: number | null
  marketValue: number | null
  accountingQuantity: number | null
  tradeOpenDate: string | null
  expiryDate: string | null
}

/**
 * Parse expiry date from symbol text
 * Symbol format: "META 251220C560" where 251220 is YYMMDD
 */
function parseExpiryDateFromSymbol(symbolText: string): string | null {
  if (!symbolText) return null
  
  // Match pattern like "251220C" or "251220P"
  const codeMatch = symbolText.match(/\b(\d{6})[CP]/)
  if (!codeMatch) return null
  
  const code = codeMatch[1]
  const yy = code.substring(0, 2)
  const mm = code.substring(2, 4)
  const dd = code.substring(4, 6)
  
  return `20${yy}-${mm}-${dd}`
}

/**
 * Calculate days between two dates
 */
function daysBetween(startDate: string, endDate: string): number | null {
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  
  start.setHours(0, 0, 0, 0)
  end.setHours(0, 0, 0, 0)
  
  const diffTime = end.getTime() - start.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  return diffDays
}

/**
 * Calculate DTE (Days To Expiration) from today
 */
function calculateCurrentDTE(expiryDate: string): number | null {
  const today = new Date()
  const expiry = new Date(expiryDate)
  
  if (isNaN(expiry.getTime())) return null
  
  today.setHours(0, 0, 0, 0)
  expiry.setHours(0, 0, 0, 0)
  
  const diffTime = expiry.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  
  return diffDays
}

/**
 * Generate cache key for trade open date lookup
 */
function getCacheKey(conid: string, internalAccountId: string): string {
  return `${conid}:${internalAccountId}`
}

export function useRentCalculation() {
  const supabase = useSupabase()
  
  /**
   * Fetch the trade open date for a position
   * Queries positions table with [conid, internal_account_id]; order by 'id' ASC; limit 1
   * Returns the date part of fetched_at
   */
  async function fetchTradeOpenDate(
    conid: string,
    internalAccountId: string
  ): Promise<string | null> {
    const cacheKey = getCacheKey(conid, internalAccountId)
    
    // Check cache first
    if (tradeOpenDateCache.value.has(cacheKey)) {
      return tradeOpenDateCache.value.get(cacheKey) ?? null
    }
    
    try {
      const { data, error } = await supabase
        .schema('hf')
        .from('positions')
        .select('fetched_at')
        .eq('conid', conid)
        .eq('internal_account_id', internalAccountId)
        .order('id', { ascending: true })
        .limit(1)
        .single()
      
      if (error) {
        console.error('❌ Error fetching trade open date:', error)
        tradeOpenDateCache.value.set(cacheKey, null)
        return null
      }
      
      // Parse date only from fetched_at (e.g., "2025-12-02T15:19:02.246199+00:00" -> "2025-12-02")
      const fetchedAt = data?.fetched_at
      if (!fetchedAt) {
        tradeOpenDateCache.value.set(cacheKey, null)
        return null
      }
      
      const dateOnly = fetchedAt.split('T')[0]
      tradeOpenDateCache.value.set(cacheKey, dateOnly)
      
      return dateOnly
    } catch (err) {
      console.error('❌ Exception fetching trade open date:', err)
      tradeOpenDateCache.value.set(cacheKey, null)
      return null
    }
  }
  
  /**
   * Calculate rent per day per share for both "At Entry" and "Current" scenarios
   */
  async function calculateRent(position: {
    conid: string
    internal_account_id: string
    symbol: string
    computed_cash_flow_on_entry: number | null
    market_value: number | null
    accounting_quantity: number | null
  }): Promise<RentCalculation> {
    const result: RentCalculation = {
      entryPremiumPerShare: null,
      entryRentPerDayPerShare: null,
      totalDaysAtEntry: null,
      currentPremiumPerShare: null,
      currentRentPerDayPerShare: null,
      currentDTE: null,
      entryCashFlow: position.computed_cash_flow_on_entry,
      marketValue: position.market_value,
      accountingQuantity: position.accounting_quantity,
      tradeOpenDate: null,
      expiryDate: null
    }
    
    const { conid, internal_account_id, symbol, computed_cash_flow_on_entry, market_value, accounting_quantity } = position
    
    // Parse expiry date from symbol
    const expiryDate = parseExpiryDateFromSymbol(symbol)
    result.expiryDate = expiryDate
    
    if (!expiryDate) {
      console.warn('⚠️ Could not parse expiry date from symbol:', symbol)
      return result
    }
    
    // Get the absolute quantity for per-share calculations
    const absQuantity = accounting_quantity ? Math.abs(accounting_quantity) : null
    
    if (!absQuantity || absQuantity === 0) {
      return result
    }
    
    // Calculate current DTE
    const currentDTE = calculateCurrentDTE(expiryDate)
    result.currentDTE = currentDTE
    
    // Fetch trade open date
    const tradeOpenDate = await fetchTradeOpenDate(conid, internal_account_id)
    result.tradeOpenDate = tradeOpenDate
    
    // ==========================================
    // AT ENTRY CALCULATION
    // ==========================================
    // Premium per share (at entry) = Entry Cash Flow / |Acc Qty|
    // Rent per day per share (at entry) = Premium per share / (Expiry Date - Trade Open Date)
    
    if (computed_cash_flow_on_entry != null && tradeOpenDate) {
      const entryPremiumPerShare = computed_cash_flow_on_entry / absQuantity
      result.entryPremiumPerShare = entryPremiumPerShare
      
      const totalDaysAtEntry = daysBetween(tradeOpenDate, expiryDate)
      result.totalDaysAtEntry = totalDaysAtEntry
      
      if (totalDaysAtEntry && totalDaysAtEntry > 0) {
        result.entryRentPerDayPerShare = entryPremiumPerShare / totalDaysAtEntry
      }
    }
    
    // ==========================================
    // CURRENT (TIME REMAINING) CALCULATION
    // ==========================================
    // Premium per share (current) = Market Value / |Acc Qty|
    // Rent per day per share (current) = Premium per share / Current DTE
    
    if (market_value != null) {
      const currentPremiumPerShare = market_value / absQuantity
      result.currentPremiumPerShare = currentPremiumPerShare
      
      if (currentDTE && currentDTE > 0) {
        result.currentRentPerDayPerShare = currentPremiumPerShare / currentDTE
      }
    }
    
    return result
  }
  
  /**
   * Pre-fetch trade open dates for multiple positions (batch optimization)
   */
  async function prefetchTradeOpenDates(positions: Array<{ conid: string; internal_account_id: string }>): Promise<void> {
    const uncachedPositions = positions.filter(p => {
      const cacheKey = getCacheKey(p.conid, p.internal_account_id)
      return !tradeOpenDateCache.value.has(cacheKey)
    })
    
    if (uncachedPositions.length === 0) return
    
    console.log(`🔄 Pre-fetching trade open dates for ${uncachedPositions.length} positions...`)
    
    // Fetch in parallel (limited concurrency to avoid overwhelming the server)
    const batchSize = 10
    for (let i = 0; i < uncachedPositions.length; i += batchSize) {
      const batch = uncachedPositions.slice(i, i + batchSize)
      await Promise.all(
        batch.map(p => fetchTradeOpenDate(p.conid, p.internal_account_id))
      )
    }
    
    console.log(`✅ Pre-fetched trade open dates for ${uncachedPositions.length} positions`)
  }
  
  /**
   * Clear the cache (useful when data changes)
   */
  function clearCache(): void {
    tradeOpenDateCache.value.clear()
  }
  
  /**
   * Format rent calculation for display
   */
  function formatRentDisplay(calc: RentCalculation): {
    atEntry: string
    current: string
  } {
    const formatValue = (value: number | null): string => {
      if (value == null) return 'N/A'
      return `$${value.toFixed(2)}`
    }
    
    return {
      atEntry: formatValue(calc.entryRentPerDayPerShare),
      current: formatValue(calc.currentRentPerDayPerShare)
    }
  }
  
  /**
   * Get color for rent value (green for positive, red for negative)
   */
  function getRentColor(value: number | null): string {
    if (value == null) return '#aaa'
    if (value < 0) return '#dc3545' // Red
    if (value > 0) return '#28a745' // Green
    return '#000'
  }
  
  return {
    calculateRent,
    prefetchTradeOpenDates,
    clearCache,
    formatRentDisplay,
    getRentColor,
    tradeOpenDateCache
  }
}
