import { Ref } from 'vue';
interface UseTabulatorOptions {
    data: any;
    columns: any[];
    isSuccess: any;
    placeholder?: string;
    rowFormatter?: (row: any) => Promise<void> | void;
    onTableCreated?: (table: any) => void;
    initialSort?: Array<{
        column: string;
        dir: 'asc' | 'desc';
    }>;
}
export declare function useTabulator(options: UseTabulatorOptions): {
    tableDiv: Ref<HTMLDivElement | null, HTMLDivElement | null>;
    tabulator: any;
    isTableInitialized: Ref<boolean, boolean>;
    initializeTabulator: () => void;
};
export {};
