import { Ref, ComputedRef } from 'vue';
import { ColumnDefinition } from 'tabulator-tables';
interface UseTabulatorOptions {
    data: ComputedRef<any[] | undefined>;
    columns: ColumnDefinition[];
    isSuccess: ComputedRef<boolean>;
    placeholder?: string;
    rowFormatter?: (row: any) => void | Promise<void>;
}
export declare function useTabulator(options: UseTabulatorOptions): {
    tableDiv: Ref<HTMLDivElement | null, HTMLDivElement | null>;
    tabulator: any;
    initializeTabulator: () => void;
    isTableInitialized: Ref<boolean, boolean>;
};
export {};
