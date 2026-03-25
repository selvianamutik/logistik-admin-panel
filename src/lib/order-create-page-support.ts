import type { CustomerProduct, CustomerRecipient } from './types';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    type VolumeInputUnit,
    type WeightInputUnit,
} from './measurement';

export type OrderItemForm = {
    id?: string;
    customerProductRef: string;
    description: string;
    qtyKoli: number;
    weightInputValue: number;
    weightInputUnit: WeightInputUnit;
    volumeInputValue: number;
    volumeInputUnit: VolumeInputUnit;
    value: number;
};

export const DEFAULT_ORDER_ITEM_FORM: OrderItemForm = {
    customerProductRef: '',
    description: '',
    qtyKoli: 0,
    weightInputValue: 0,
    weightInputUnit: 'KG',
    volumeInputValue: 0,
    volumeInputUnit: 'M3',
    value: 0,
};

export function createDefaultOrderItemForm(): OrderItemForm {
    return { ...DEFAULT_ORDER_ITEM_FORM };
}

export function getDraftOrderItems(items: OrderItemForm[]) {
    return items.filter(item =>
        item.description.trim() ||
        item.customerProductRef ||
        item.qtyKoli > 0 ||
        item.weightInputValue > 0 ||
        item.volumeInputValue > 0
    );
}

export function summarizeDraftOrderCargo(items: OrderItemForm[]) {
    return getDraftOrderItems(items).reduce((sum, item) => ({
        qtyKoli: sum.qtyKoli + Number(item.qtyKoli || 0),
        weightKg: sum.weightKg + (item.weightInputValue > 0 ? convertWeightToKg(item.weightInputValue, item.weightInputUnit) : 0),
        volumeM3: sum.volumeM3 + (item.volumeInputValue > 0 ? convertVolumeToM3(item.volumeInputValue, item.volumeInputUnit) : 0),
    }), { qtyKoli: 0, weightKg: 0, volumeM3: 0 });
}

export function resetCustomerScopedOrderItems(items: OrderItemForm[]) {
    return items.map(item => (item.customerProductRef ? createDefaultOrderItemForm() : item));
}

export function applyCustomerProductToOrderItem(item: OrderItemForm, selectedProduct: CustomerProduct | undefined): OrderItemForm {
    if (!selectedProduct) {
        return { ...item, customerProductRef: '' };
    }

    const nextWeightUnit = selectedProduct.defaultWeightInputUnit || item.weightInputUnit || 'KG';
    const nextVolumeUnit = selectedProduct.defaultVolumeInputUnit || item.volumeInputUnit || 'M3';
    const nextWeightValue =
        typeof selectedProduct.defaultWeightInputValue === 'number' && selectedProduct.defaultWeightInputValue > 0
            ? selectedProduct.defaultWeightInputValue
            : typeof selectedProduct.defaultWeight === 'number' && selectedProduct.defaultWeight > 0
                ? convertKgToWeightInputValue(selectedProduct.defaultWeight, nextWeightUnit)
                : 0;
    const nextVolumeValue =
        typeof selectedProduct.defaultVolumeInputValue === 'number' && selectedProduct.defaultVolumeInputValue > 0
            ? selectedProduct.defaultVolumeInputValue
            : typeof selectedProduct.defaultVolume === 'number' && selectedProduct.defaultVolume > 0
                ? convertM3ToVolumeInputValue(selectedProduct.defaultVolume, nextVolumeUnit)
                : 0;

    return {
        ...item,
        customerProductRef: selectedProduct._id,
        description: selectedProduct.description || selectedProduct.name || item.description,
        qtyKoli: selectedProduct.defaultQtyKoli ?? item.qtyKoli ?? 0,
        weightInputValue: nextWeightValue,
        weightInputUnit: nextWeightUnit,
        volumeInputValue: nextVolumeValue,
        volumeInputUnit: nextVolumeUnit,
    };
}

export function applyCustomerRecipientSnapshot(selectedRecipient: CustomerRecipient | undefined) {
    if (!selectedRecipient) {
        return {
            receiverName: '',
            receiverPhone: '',
            receiverAddress: '',
            receiverCompany: '',
        };
    }

    return {
        receiverName: selectedRecipient.receiverName || '',
        receiverPhone: selectedRecipient.receiverPhone || '',
        receiverAddress: selectedRecipient.receiverAddress || '',
        receiverCompany: selectedRecipient.receiverCompany || '',
    };
}

export function sortCustomerRecipients(recipients: CustomerRecipient[]) {
    return [...recipients].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
}

export function findDefaultCustomerRecipient(recipients: CustomerRecipient[]) {
    return recipients.find(recipient => recipient.active !== false && recipient.isDefault) || null;
}
