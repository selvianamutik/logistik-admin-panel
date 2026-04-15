import { addDaysToDateValue, getBusinessDateValue } from './business-date';
import type { CompanyProfile, Customer, DeliveryOrder, DeliveryOrderItem, Order } from './types';
import { parseFormattedNumberish } from './formatted-number';

export interface NotaItemRow {
    id: string;
    doRef: string;
    deliveryOrderItemRef?: string;
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket: string;
}

export function createEmptyNotaRow(): NotaItemRow {
    return {
        id: Math.random().toString(36).slice(2),
        doRef: '',
        doNumber: '',
        vehiclePlate: '',
        date: getBusinessDateValue(),
        noSJ: '',
        dari: '',
        tujuan: '',
        barang: '',
        collie: 0,
        beratKg: 0,
        tarip: 0,
        uangRp: 0,
        ket: '',
    };
}

export function isEmptyNotaRow(row: NotaItemRow) {
    return (
        !row.doRef &&
        !row.doNumber &&
        !row.vehiclePlate &&
        !row.noSJ &&
        !row.dari &&
        !row.tujuan &&
        !row.barang &&
        !row.ket &&
        (row.collie || 0) === 0 &&
        (row.beratKg || 0) === 0 &&
        (row.tarip || 0) === 0 &&
        (row.uangRp || 0) === 0
    );
}

export function calculateNotaDueDate(baseDate: string, termDays: number) {
    return addDaysToDateValue(baseDate, termDays);
}

export function getSuggestedNotaDueDate(params: {
    customerRef: string;
    customers: Customer[];
    company: CompanyProfile | null;
    issueDate: string;
    dueDateTouched: boolean;
}) {
    if (params.dueDateTouched) return null;
    const customer = params.customerRef
        ? params.customers.find(item => item._id === params.customerRef)
        : null;
    const customerTerm = customer && Number.isFinite(customer.defaultPaymentTerm) && customer.defaultPaymentTerm >= 0
        ? customer.defaultPaymentTerm
        : null;
    const companyTerm = params.company?.invoiceSettings?.dueDateDays ?? params.company?.invoiceSettings?.defaultTermDays;
    const termDays = customerTerm ?? (
        typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0
            ? companyTerm
            : null
    );

    return termDays === null ? null : calculateNotaDueDate(params.issueDate, termDays);
}

export function buildNotaRowsFromDeliveryOrder(params: {
    deliveryOrder: DeliveryOrder;
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
}): NotaItemRow[] {
    const { deliveryOrder, orders, deliveryOrderItems } = params;
    const relatedOrder = orders.find(order => order._id === deliveryOrder.orderRef);
    const relatedItems = deliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
    const baseRow = {
        doRef: deliveryOrder._id,
        doNumber: deliveryOrder.doNumber || '',
        vehiclePlate: deliveryOrder.vehiclePlate || '',
        date: deliveryOrder.date || getBusinessDateValue(),
        noSJ: deliveryOrder.customerDoNumber || deliveryOrder.doNumber || '',
        dari: deliveryOrder.pickupAddress || relatedOrder?.pickupAddress || '',
        tujuan: deliveryOrder.receiverAddress || relatedOrder?.receiverAddress || '',
        tarip: 0,
        uangRp: 0,
        ket: '',
    };

    if (relatedItems.length === 0) {
        return [{
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            barang: '',
            collie: 0,
            beratKg: 0,
        }];
    }

    return relatedItems.map(item => ({
        id: Math.random().toString(36).slice(2),
        ...baseRow,
        deliveryOrderItemRef: item._id,
        barang: item.orderItemDescription?.trim() || '',
        collie: parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0),
        beratKg: parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0),
    }));
}
