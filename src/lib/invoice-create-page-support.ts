import { addDaysToDateValue, getBusinessDateValue } from './business-date';
import type { CompanyProfile, Customer, DeliveryOrder, DeliveryOrderItem, Order } from './types';
import { parseFormattedNumberish } from './formatted-number';

export interface NotaItemRow {
    id: string;
    doRef: string;
    deliveryOrderItemRef?: string;
    deliveryOrderItemRefs?: string[];
    customerRef?: string;
    customerName?: string;
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
        customerRef: '',
        customerName: '',
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
        !row.customerRef &&
        !row.customerName &&
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

export function buildFreightNotaCoverageRowKeys(params: {
    deliveryOrder: {
        _id: string;
        doNumber?: string;
        customerDoNumber?: string;
        shipperReferences?: Array<{ referenceNumber?: string | undefined }>;
    };
    noSJ?: string | null | undefined;
}) {
    const { deliveryOrder } = params;
    const doRef = deliveryOrder._id?.trim();
    const normalizedNoSJ = params.noSJ?.trim() || '';
    if (!doRef) {
        return [];
    }

    const doNumber = deliveryOrder.doNumber?.trim() || '';
    const customerDoNumber = deliveryOrder.customerDoNumber?.trim() || '';
    const explicitReferences = Array.from(
        new Set(
            (deliveryOrder.shipperReferences || [])
                .map(reference => reference.referenceNumber?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );

    const coverageNumbers = new Set<string>();
    if (normalizedNoSJ) {
        coverageNumbers.add(normalizedNoSJ);
    }

    const matchesExplicitReference = normalizedNoSJ ? explicitReferences.includes(normalizedNoSJ) : false;
    const matchesLegacyHeaderNumber =
        normalizedNoSJ &&
        (normalizedNoSJ === doNumber || normalizedNoSJ === customerDoNumber);

    if (matchesLegacyHeaderNumber && !matchesExplicitReference) {
        if (doNumber) {
            coverageNumbers.add(doNumber);
        }
        if (customerDoNumber) {
            coverageNumbers.add(customerDoNumber);
        }
        explicitReferences.forEach(referenceNumber => coverageNumbers.add(referenceNumber));
    }

    return Array.from(coverageNumbers).map(referenceNumber => `${doRef}::${referenceNumber}`);
}

export function buildNotaRowsFromDeliveryOrder(params: {
    deliveryOrder: DeliveryOrder;
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
}): NotaItemRow[] {
    const { deliveryOrder, orders, deliveryOrderItems } = params;
    const relatedOrder = orders.find(order => order._id === deliveryOrder.orderRef);
    const relatedItems = deliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
    const shipperReferences = (deliveryOrder.shipperReferences || [])
        .filter(reference => Boolean(reference.referenceNumber?.trim()))
        .map(reference => ({
            ...reference,
            referenceNumber: reference.referenceNumber!.trim(),
        }));
    const shipperReferenceMap = new Map(
        shipperReferences.map(reference => [reference.referenceNumber, reference])
    );
    const actualDropPointsByShipperReference = new Map<string, string>();
    for (const point of deliveryOrder.actualDropPoints || []) {
        const shipperReferenceNumber = point.shipperReferenceNumber?.trim();
        if (!shipperReferenceNumber) continue;
        const destination = point.locationAddress?.trim() || point.locationName?.trim() || '';
        if (!destination) continue;
        const current = actualDropPointsByShipperReference.get(shipperReferenceNumber);
        actualDropPointsByShipperReference.set(
            shipperReferenceNumber,
            current ? `${current}, ${destination}` : destination
        );
    }
    const fallbackShipperReferenceNumber = shipperReferences[0]?.referenceNumber || deliveryOrder.customerDoNumber || deliveryOrder.doNumber || '';
    const baseRow = {
        doRef: deliveryOrder._id,
        customerRef: relatedOrder?.customerRef || '',
        customerName: relatedOrder?.customerName || deliveryOrder.customerName || '',
        doNumber: deliveryOrder.doNumber || '',
        vehiclePlate: deliveryOrder.vehiclePlate || '',
        date: deliveryOrder.date || getBusinessDateValue(),
        noSJ: fallbackShipperReferenceNumber,
        dari: deliveryOrder.pickupAddress || relatedOrder?.pickupAddress || '',
        tujuan: deliveryOrder.receiverAddress || relatedOrder?.receiverAddress || '',
        tarip: 0,
        uangRp: 0,
        ket: '',
    };

    const buildShipperReferenceRow = (
        shipperReferenceNumber: string,
        items: DeliveryOrderItem[] = []
    ): NotaItemRow => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());

        return {
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            deliveryOrderItemRef: items[0]?._id,
            deliveryOrderItemRefs: items.map(item => item._id).filter(Boolean),
            customerRef: matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: matchedReference?.billingCustomerName || baseRow.customerName,
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                matchedReference?.receiverAddress ||
                actualDropPointsByShipperReference.get(shipperReferenceNumber) ||
                baseRow.tujuan,
            barang: items.length > 0
                ? [...new Set(items.map(item => item.orderItemDescription?.trim()).filter((value): value is string => Boolean(value)))].join(', ')
                : '',
            collie: items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0), 0),
            beratKg: items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0), 0),
        };
    };

    if (relatedItems.length === 0) {
        if (shipperReferences.length > 0) {
            return shipperReferences.map(reference => ({
                id: Math.random().toString(36).slice(2),
                ...baseRow,
                customerRef: reference.billingCustomerRef || baseRow.customerRef,
                customerName: reference.billingCustomerName || baseRow.customerName,
                noSJ: reference.referenceNumber,
                dari: reference.pickupAddress || baseRow.dari,
                tujuan:
                    reference.receiverAddress ||
                    actualDropPointsByShipperReference.get(reference.referenceNumber) ||
                    baseRow.tujuan,
                barang: '',
                collie: 0,
                beratKg: 0,
            }));
        }

        return [{
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            barang: '',
            collie: 0,
            beratKg: 0,
        }];
    }

    const groupedItems = relatedItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const key = item.shipperReferenceNumber?.trim() || fallbackShipperReferenceNumber || 'TANPA-SJ';
        const current = acc.get(key) || [];
        current.push(item);
        acc.set(key, current);
        return acc;
    }, new Map());
    const rows: NotaItemRow[] = [];
    const emittedReferences = new Set<string>();

    for (const reference of shipperReferences) {
        const shipperReferenceNumber = reference.referenceNumber;
        emittedReferences.add(shipperReferenceNumber);
        rows.push(buildShipperReferenceRow(shipperReferenceNumber, groupedItems.get(shipperReferenceNumber) || []));
    }

    for (const [shipperReferenceNumber, items] of groupedItems.entries()) {
        if (emittedReferences.has(shipperReferenceNumber)) {
            continue;
        }
        rows.push(buildShipperReferenceRow(shipperReferenceNumber, items));
    }

    return rows;
}
