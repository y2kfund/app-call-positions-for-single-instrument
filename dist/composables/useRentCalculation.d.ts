export interface RentCalculation {
    entryPremiumPerShare: number | null;
    entryRentPerDayPerShare: number | null;
    totalDaysAtEntry: number | null;
    currentPremiumPerShare: number | null;
    currentRentPerDayPerShare: number | null;
    currentDTE: number | null;
    entryCashFlow: number | null;
    marketValue: number | null;
    accountingQuantity: number | null;
    tradeOpenDate: string | null;
    expiryDate: string | null;
}
export declare function useRentCalculation(): {
    calculateRent: (position: {
        conid: string;
        internal_account_id: string;
        symbol: string;
        computed_cash_flow_on_entry: number | null;
        market_value: number | null;
        accounting_quantity: number | null;
    }) => Promise<RentCalculation>;
    prefetchTradeOpenDates: (positions: Array<{
        conid: string;
        internal_account_id: string;
    }>) => Promise<void>;
    clearCache: () => void;
    formatRentDisplay: (calc: RentCalculation) => {
        atEntry: string;
        current: string;
    };
    getRentColor: (value: number | null) => string;
    tradeOpenDateCache: import('vue').Ref<Map<string, string | null> & Omit<Map<string, string | null>, keyof Map<any, any>>, Map<string, string | null> | (Map<string, string | null> & Omit<Map<string, string | null>, keyof Map<any, any>>)>;
};
