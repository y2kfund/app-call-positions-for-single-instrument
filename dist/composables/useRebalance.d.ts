export interface RebalanceForm {
    deltaStart: string;
    deltaEnd: string;
    desiredDelta: string;
    dteStart: string;
    dteEnd: string;
}
export declare const rebalanceEnabledStates: import('vue').Reactive<Map<string, boolean>>;
export declare const rebalanceSettingsData: import('vue').Reactive<Map<string, RebalanceSettingsDB>>;
export interface RebalanceSettings {
    positionKey: string;
    position: any;
    deltaRange: {
        start: number;
        end: number;
    };
    desiredDelta: number;
    dteRange: {
        start: number;
        end: number;
    };
}
export interface RebalanceSettingsDB {
    id?: string;
    user_id: string;
    position_key: string;
    symbol?: string;
    internal_account_id?: string;
    legal_entity?: string;
    delta_start: number;
    delta_end: number;
    desired_delta: number;
    dte_start: number;
    dte_end: number;
    is_enabled?: boolean;
    created_at?: string;
    updated_at?: string;
}
export declare function useRebalance(getPositionKey: (position: any) => string, userId?: string | null): {
    showRebalanceModal: import('vue').Ref<boolean, boolean>;
    rebalancePosition: import('vue').Ref<any, any>;
    rebalanceForm: import('vue').Ref<{
        deltaStart: string;
        deltaEnd: string;
        desiredDelta: string;
        dteStart: string;
        dteEnd: string;
    }, RebalanceForm | {
        deltaStart: string;
        deltaEnd: string;
        desiredDelta: string;
        dteStart: string;
        dteEnd: string;
    }>;
    isSaving: import('vue').Ref<boolean, boolean>;
    saveError: import('vue').Ref<string | null, string | null>;
    isEditing: import('vue').Ref<boolean, boolean>;
    showOptimalRebalanceModal: import('vue').Ref<boolean, boolean>;
    optimalRebalancePosition: import('vue').Ref<any, any>;
    openRebalanceModal: (position: any) => void;
    openRebalanceModalForEdit: (position: any) => void;
    closeRebalanceModal: () => void;
    validateIntegerInput: (event: Event) => void;
    saveRebalanceSettings: () => Promise<RebalanceSettings | null>;
    fetchRebalanceSettings: (positionKey: string) => Promise<RebalanceSettingsDB | null>;
    deleteRebalanceSettings: (positionKey: string) => Promise<boolean>;
    handleRebalanceAction: (action: string, position: any) => void;
    handleToggle: (position: any, newState: boolean) => Promise<void>;
    isRebalanceEnabled: (position: any) => boolean;
    setRebalanceEnabled: (positionKey: string, enabled: boolean) => void;
    fetchAllRebalanceSettings: () => Promise<RebalanceSettingsDB[]>;
    getRebalanceSettings: (positionKey: string) => RebalanceSettingsDB | undefined;
    isDeltaInRange: (positionKey: string, delta: number) => boolean;
    openOptimalRebalanceModal: (position: any) => void;
    closeOptimalRebalanceModal: () => void;
};
