import type { Customer, Order, OrderItem } from './types';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    type WeightInputUnit,
    type VolumeInputUnit,
} from './measurement';
import {
    createDefaultOrderItemForm,
    summarizeDraftOrderCargo,
    type OrderItemForm,
} from './order-create-page-support';

export type OrderEditFormState = {
    customerRef: string;
    customerName: string;
    receiverName: string;
    receiverPhone: string;
    receiverAddress: string;
    receiverCompany: string;
    pickupAddress: string;
    serviceRef: string;
    serviceName: string;
    notes: string;
};

export const DEFAULT_ORDER_EDIT_FORM: OrderEditFormState = {
    customerRef: '',
    customerName: '',
    receiverName: '',
    receiverPhone: '',
    receiverAddress: '',
    receiverCompany: '',
    pickupAddress: '',
    serviceRef: '',
    serviceName: '',
    notes: '',
};

export function buildOrderEditForm(order: Order | null): OrderEditFormState {
    if (!order) {
        return { ...DEFAULT_ORDER_EDIT_FORM };
    }

    return {
        customerRef: order.customerRef,
        customerName: order.customerName || '',
        receiverName: order.receiverName,
        receiverPhone: order.receiverPhone,
        receiverAddress: order.receiverAddress,
        receiverCompany: order.receiverCompany || '',
        pickupAddress: order.pickupAddress || '',
        serviceRef: order.serviceRef,
        serviceName: order.serviceName || '',
        notes: order.notes || '',
    };
}

export function mapOrderItemToOrderEditForm(item: OrderItem): OrderItemForm {
    const nextWeightUnit = (item.weightInputUnit || 'KG') as WeightInputUnit;
    const nextVolumeUnit = (item.volumeInputUnit || 'M3') as VolumeInputUnit;

    return {
        id: item._id,
        customerProductRef: item.customerProductRef || '',
        description: item.description || '',
        qtyKoli: typeof item.qtyKoli === 'number' ? item.qtyKoli : 0,
        weightInputValue:
            typeof item.weightInputValue === 'number' && item.weightInputValue > 0
                ? item.weightInputValue
                : typeof item.weight === 'number' && item.weight > 0
                    ? convertKgToWeightInputValue(item.weight, nextWeightUnit)
                    : 0,
        weightInputUnit: nextWeightUnit,
        volumeInputValue:
            typeof item.volumeInputValue === 'number' && item.volumeInputValue > 0
                ? item.volumeInputValue
                : typeof item.volume === 'number' && item.volume > 0
                    ? convertM3ToVolumeInputValue(item.volume, nextVolumeUnit)
                    : 0,
        volumeInputUnit: nextVolumeUnit,
        value: item.value || 0,
    };
}

export function getOrderEditItems(orderItems: OrderItem[]) {
    const mappedItems = (orderItems || []).map(mapOrderItemToOrderEditForm);
    return mappedItems.length > 0 ? mappedItems : [createDefaultOrderItemForm()];
}

export function hasOrderItemOperationalProgress(orderItems: OrderItem[]) {
    return (orderItems || []).some(item =>
        Number(item.deliveredQtyKoli || 0) > 0 ||
        Number(item.assignedQtyKoli || 0) > 0 ||
        Number(item.heldQtyKoli || 0) > 0 ||
        Number(item.deliveredWeight || 0) > 0 ||
        Number(item.assignedWeight || 0) > 0 ||
        Number(item.heldWeight || 0) > 0 ||
        Number(item.deliveredVolume || 0) > 0 ||
        Number(item.assignedVolume || 0) > 0 ||
        Number(item.heldVolume || 0) > 0
    );
}

export function resolvePickupAddressForCustomer(params: {
    nextCustomerRef: string;
    previousCustomerRef: string;
    previousPickupAddress: string;
    customers: Customer[];
}) {
    const nextCustomer = params.customers.find(customer => customer._id === params.nextCustomerRef);
    const previousCustomer = params.customers.find(customer => customer._id === params.previousCustomerRef);
    const previousCustomerAddress = previousCustomer?.address?.trim() || '';
    const currentPickup = params.previousPickupAddress.trim();

    if (!currentPickup || (previousCustomerAddress && currentPickup === previousCustomerAddress)) {
        return nextCustomer?.address || '';
    }

    return params.previousPickupAddress;
}

export function summarizeOrderEditTargetCargo(items: OrderItemForm[]) {
    return summarizeDraftOrderCargo(items);
}
