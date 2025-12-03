import { RebalanceForm } from '../composables/useRebalance';
interface Props {
    show: boolean;
    position: any | null;
    form: RebalanceForm;
    isSaving?: boolean;
    isEditing?: boolean;
}
declare const _default: import('vue').DefineComponent<Props, {}, {}, {}, {}, import('vue').ComponentOptionsMixin, import('vue').ComponentOptionsMixin, {} & {
    close: () => any;
    save: () => any;
    "update:form": (value: RebalanceForm) => any;
}, string, import('vue').PublicProps, Readonly<Props> & Readonly<{
    onClose?: (() => any) | undefined;
    onSave?: (() => any) | undefined;
    "onUpdate:form"?: ((value: RebalanceForm) => any) | undefined;
}>, {
    isSaving: boolean;
    isEditing: boolean;
}, {}, {}, {}, string, import('vue').ComponentProvideOptions, false, {}, any>;
export default _default;
