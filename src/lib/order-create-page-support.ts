import type { CustomerPickupLocation, CustomerProduct, CustomerRecipient } from './types';
import { parseFormattedNumberish } from './formatted-number';
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
        qtyKoli: sum.qtyKoli + parseFormattedNumberish(item.qtyKoli || 0, { maxFractionDigits: 2 }),
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
    const normalizedQtyKoli = parseFormattedNumberish(selectedProduct.defaultQtyKoli ?? item.qtyKoli ?? 0, {
        maxFractionDigits: 2,
    });
    const normalizedWeightInputValue = parseFormattedNumberish(
        selectedProduct.defaultWeightInputValue ?? 0,
        { maxFractionDigits: nextWeightUnit === 'TON' ? 3 : 2 }
    );
    const normalizedWeightKg = parseFormattedNumberish(selectedProduct.defaultWeight ?? 0, {
        maxFractionDigits: 2,
    });
    const nextWeightValue =
        normalizedWeightInputValue > 0
            ? normalizedWeightInputValue
            : normalizedWeightKg > 0
                ? convertKgToWeightInputValue(normalizedWeightKg, nextWeightUnit)
                : 0;
    const normalizedVolumeInputValue = parseFormattedNumberish(
        selectedProduct.defaultVolumeInputValue ?? 0,
        { maxFractionDigits: nextVolumeUnit === 'LITER' ? 0 : 3 }
    );
    const normalizedVolumeM3 = parseFormattedNumberish(selectedProduct.defaultVolume ?? 0, {
        maxFractionDigits: 3,
    });
    const nextVolumeValue =
        normalizedVolumeInputValue > 0
            ? normalizedVolumeInputValue
            : normalizedVolumeM3 > 0
                ? convertM3ToVolumeInputValue(normalizedVolumeM3, nextVolumeUnit)
                : 0;

    return {
        ...item,
        customerProductRef: selectedProduct._id,
        description: selectedProduct.description || selectedProduct.name || item.description,
        qtyKoli: normalizedQtyKoli,
        weightInputValue: nextWeightValue,
        weightInputUnit: nextWeightUnit,
        volumeInputValue: nextVolumeValue,
        volumeInputUnit: nextVolumeUnit,
    };
}

export function updateOrderItemWeightUnit(item: OrderItemForm, nextUnit: WeightInputUnit): OrderItemForm {
    if (item.weightInputUnit === nextUnit) {
        return item;
    }

    const currentWeightKg =
        item.weightInputValue > 0
            ? convertWeightToKg(item.weightInputValue, item.weightInputUnit)
            : 0;

    return {
        ...item,
        weightInputUnit: nextUnit,
        weightInputValue: currentWeightKg > 0 ? convertKgToWeightInputValue(currentWeightKg, nextUnit) : 0,
    };
}

export function updateOrderItemVolumeUnit(item: OrderItemForm, nextUnit: VolumeInputUnit): OrderItemForm {
    if (item.volumeInputUnit === nextUnit) {
        return item;
    }

    const currentVolumeM3 =
        item.volumeInputValue > 0
            ? convertVolumeToM3(item.volumeInputValue, item.volumeInputUnit)
            : 0;

    return {
        ...item,
        volumeInputUnit: nextUnit,
        volumeInputValue: currentVolumeM3 > 0 ? convertM3ToVolumeInputValue(currentVolumeM3, nextUnit) : 0,
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

export function applyCustomerPickupSnapshot(selectedPickup: CustomerPickupLocation | undefined) {
    return {
        pickupAddress: selectedPickup?.pickupAddress || '',
    };
}

export function sortCustomerPickups(pickups: CustomerPickupLocation[]) {
    return [...pickups].sort((a, b) => {
        if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
            return a.isDefault ? -1 : 1;
        }
        return (a.label || '').localeCompare(b.label || '');
    });
}

export function findDefaultCustomerPickup(pickups: CustomerPickupLocation[]) {
    return pickups.find(pickup => pickup.active !== false && pickup.isDefault) || null;
}
