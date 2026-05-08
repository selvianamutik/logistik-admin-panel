import { addDaysToDateValue, getBusinessDateValue } from './business-date';
import {
    getDeliveryOrderActualDropDestinations,
    getDeliveryOrderBillableCargoSummary,
    getDeliveryOrderItemSpecificBillableCargoSummary,
    getDeliveryOrderNonBillableCargoSummary,
    hasDeliveryOrderBillableCargo,
    hasDeliveryOrderItemSpecificDropMapping,
} from './delivery-order-completion';
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
    volumeM3?: number;
    tarip: number;
    uangRp: number;
    ket: string;
    plt: string;
    pc: string;
    kbl: string;
    invoiceLineDate: string;
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
        volumeM3: 0,
        tarip: 0,
        uangRp: 0,
        ket: '',
        plt: '',
        pc: '',
        kbl: '',
        invoiceLineDate: '',
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
        !row.plt &&
        !row.pc &&
        !row.kbl &&
        !row.invoiceLineDate &&
        (row.collie || 0) === 0 &&
        (row.beratKg || 0) === 0 &&
        (row.volumeM3 || 0) === 0 &&
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
    deliveryOrderItemRefs?: string[] | null | undefined;
}) {
    const { deliveryOrder } = params;
    const doRef = deliveryOrder._id?.trim();
    const normalizedNoSJ = params.noSJ?.trim() || '';
    const normalizedItemRefs = Array.from(
        new Set(
            (params.deliveryOrderItemRefs || [])
                .map(value => value?.trim())
                .filter((value): value is string => Boolean(value))
        )
    );
    if (!doRef) {
        return [];
    }

    if (normalizedItemRefs.length > 0) {
        return normalizedItemRefs.map(itemRef => `${doRef}::item::${itemRef}`);
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
    const hasActualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) && deliveryOrder.actualDropPoints.length > 0;
    const actualDropPoints = Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints : [];
    const actualDropPointsHaveReference = actualDropPoints.some(point => Boolean(point.shipperReferenceNumber?.trim()));
    const shipperReferences = (deliveryOrder.shipperReferences || [])
        .filter(reference => Boolean(reference.referenceNumber?.trim()))
        .map(reference => ({
            ...reference,
            referenceNumber: reference.referenceNumber!.trim(),
        }));
    const shipperReferenceMap = new Map(
        shipperReferences.map(reference => [reference.referenceNumber, reference])
    );
    const fallbackShipperReferenceNumber = shipperReferences[0]?.referenceNumber || deliveryOrder.customerDoNumber || deliveryOrder.doNumber || '';
    const baseRow = {
        doRef: deliveryOrder._id,
        customerRef: relatedOrder?.customerRef || deliveryOrder.customerRef || '',
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
        plt: '',
        pc: '',
        kbl: '',
        invoiceLineDate: '',
    };

    const hasCargo = (cargo: { qtyKoli: number; weightKg: number; volumeM3: number }) =>
        cargo.qtyKoli > 0 || cargo.weightKg > 0 || cargo.volumeM3 > 0;

    const getItemActualOrPlannedCargo = (item: DeliveryOrderItem) => ({
        qtyKoli: parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0),
        weightKg: parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0),
        volumeM3: parseFormattedNumberish(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }),
    });

    const groupedItems = relatedItems.reduce<Map<string, DeliveryOrderItem[]>>((acc, item) => {
        const key = item.shipperReferenceNumber?.trim() || fallbackShipperReferenceNumber || 'TANPA-SJ';
        const current = acc.get(key) || [];
        current.push(item);
        acc.set(key, current);
        return acc;
    }, new Map());
    const shouldScopeDropsByReference = actualDropPointsHaveReference || shipperReferences.length > 1 || groupedItems.size > 1;
    const getDropReferenceScope = (shipperReferenceNumber: string) =>
        shouldScopeDropsByReference ? shipperReferenceNumber : undefined;
    const getReferenceBillableCargo = (shipperReferenceNumber: string) =>
        getDeliveryOrderBillableCargoSummary(deliveryOrder, getDropReferenceScope(shipperReferenceNumber));
    const getReferenceNonBillableCargo = (shipperReferenceNumber: string) =>
        getDeliveryOrderNonBillableCargoSummary(deliveryOrder, getDropReferenceScope(shipperReferenceNumber));
    const getReferenceDestinationSummary = (shipperReferenceNumber: string, deliveryOrderItemRef?: string) =>
        getDeliveryOrderActualDropDestinations(deliveryOrder, {
            shipperReferenceNumber: getDropReferenceScope(shipperReferenceNumber),
            billableOnly: true,
            deliveryOrderItemRef,
        }).join(', ');
    const getActualDropDestination = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) =>
        point.locationAddress?.trim() || point.locationName?.trim() || '';
    const getActualDropCargoSummary = (point: NonNullable<DeliveryOrder['actualDropPoints']>[number]) => ({
        qtyKoli: parseFormattedNumberish(point.qtyKoli || 0),
        weightKg: parseFormattedNumberish(point.weightKg ?? point.weightInputValue ?? 0),
        volumeM3: parseFormattedNumberish(point.volumeM3 ?? point.volumeInputValue ?? 0, { maxFractionDigits: 3 }),
    });
    const getBillableActualDropPointsForItem = (shipperReferenceNumber: string, item: DeliveryOrderItem) => {
        const scopedReference = getDropReferenceScope(shipperReferenceNumber);
        const normalizedReference = (scopedReference || '').trim();
        return actualDropPoints.filter(point => {
            if (!['DROP', 'EXTRA_DROP'].includes(point.stopType || '')) {
                return false;
            }
            if (normalizedReference && (point.shipperReferenceNumber || '').trim() !== normalizedReference) {
                return false;
            }
            const pointItemRefs = [
                point.deliveryOrderItemRef,
                ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
            ].map(value => (value || '').trim()).filter(Boolean);
            return pointItemRefs.includes(item._id);
        });
    };
    const getActualDropBillingContext = (shipperReferenceNumber: string, deliveryOrderItemRef?: string) => {
        const scopedReference = getDropReferenceScope(shipperReferenceNumber);
        const normalizedReference = (scopedReference || '').trim();
        const normalizedItemRef = (deliveryOrderItemRef || '').trim();
        const billableDrop = actualDropPoints.find(point => {
            if (!['DROP', 'EXTRA_DROP'].includes(point.stopType || '')) {
                return false;
            }
            if (normalizedReference && (point.shipperReferenceNumber || '').trim() !== normalizedReference) {
                return false;
            }
            if (normalizedItemRef) {
                const pointItemRefs = [
                    point.deliveryOrderItemRef,
                    ...(Array.isArray(point.deliveryOrderItemRefs) ? point.deliveryOrderItemRefs : []),
                ].map(value => (value || '').trim()).filter(Boolean);
                if (pointItemRefs.length > 0 && !pointItemRefs.includes(normalizedItemRef)) {
                    return false;
                }
            }
            return Boolean(point.billingCustomerRef || point.billingCustomerName);
        });

        return {
            customerRef: billableDrop?.billingCustomerRef || '',
            customerName: billableDrop?.billingCustomerName || '',
        };
    };

    const buildShipperReferenceRow = (
        shipperReferenceNumber: string,
        items: DeliveryOrderItem[] = []
    ): NotaItemRow => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const actualDropBilling = getActualDropBillingContext(shipperReferenceNumber);
        const billableItems = hasActualDropPoints
            ? items.filter(item => {
                const itemBillableCargo = getDeliveryOrderBillableCargoSummary(
                    deliveryOrder,
                    shipperReferenceNumber,
                    item._id
                );
                return itemBillableCargo.qtyKoli > 0 || itemBillableCargo.weightKg > 0 || itemBillableCargo.volumeM3 > 0;
            })
            : items;
        const itemDescriptions = billableItems.length > 0
            ? [...new Set(billableItems.map(item => item.orderItemDescription?.trim()).filter((value): value is string => Boolean(value)))].join(', ')
            : '';
        const billableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const destinationSummary = getReferenceDestinationSummary(shipperReferenceNumber);

        return {
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            deliveryOrderItemRef: billableItems[0]?._id,
            deliveryOrderItemRefs: billableItems.map(item => item._id).filter(Boolean),
            customerRef: actualDropBilling.customerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: actualDropBilling.customerName || matchedReference?.billingCustomerName || baseRow.customerName,
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                (hasActualDropPoints && destinationSummary) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: itemDescriptions,
            collie: hasActualDropPoints
                ? billableCargo.qtyKoli
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualQtyKoli ?? item.orderItemQtyKoli ?? 0), 0),
            beratKg: hasActualDropPoints
                ? billableCargo.weightKg
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualWeightKg ?? item.orderItemWeight ?? 0), 0),
            volumeM3: hasActualDropPoints
                ? billableCargo.volumeM3
                : items.reduce((sum, item) => sum + parseFormattedNumberish(item.actualVolumeM3 ?? item.orderItemVolumeM3 ?? 0, { maxFractionDigits: 3 }), 0),
        };
    };

    const buildItemRow = (
        shipperReferenceNumber: string,
        item: DeliveryOrderItem,
        options?: {
            billableCargoOverride?: { qtyKoli: number; weightKg: number; volumeM3: number };
            useSpecificBillableCargo?: boolean;
        }
    ): NotaItemRow | null => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const actualDropBilling = getActualDropBillingContext(shipperReferenceNumber, item._id);
        const itemActualCargo = getItemActualOrPlannedCargo(item);
        const itemSpecificBillableCargo = getDeliveryOrderItemSpecificBillableCargoSummary(
            deliveryOrder,
            getDropReferenceScope(shipperReferenceNumber),
            item._id
        );
        const destinationSummary = getReferenceDestinationSummary(shipperReferenceNumber, item._id);
        const billableCargo = options?.billableCargoOverride
            || (options?.useSpecificBillableCargo
                ? itemSpecificBillableCargo
                : itemActualCargo);

        if (hasActualDropPoints && !hasCargo(billableCargo)) {
            return null;
        }

        return {
            id: `${deliveryOrder._id}-${item._id}`,
            ...baseRow,
            deliveryOrderItemRef: item._id,
            deliveryOrderItemRefs: [item._id],
            customerRef: actualDropBilling.customerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: actualDropBilling.customerName || matchedReference?.billingCustomerName || baseRow.customerName,
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                (hasActualDropPoints && destinationSummary) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: item.orderItemDescription?.trim() || '',
            collie: billableCargo.qtyKoli,
            beratKg: billableCargo.weightKg,
            volumeM3: billableCargo.volumeM3,
        };
    };
    const buildActualDropPointItemRow = (
        shipperReferenceNumber: string,
        item: DeliveryOrderItem,
        point: NonNullable<DeliveryOrder['actualDropPoints']>[number],
        pointIndex: number
    ): NotaItemRow | null => {
        const matchedReference = shipperReferenceMap.get(shipperReferenceNumber.trim());
        const billableCargo = getActualDropCargoSummary(point);
        if (!hasCargo(billableCargo)) {
            return null;
        }

        return {
            id: `${deliveryOrder._id}-${item._id}-${point._key || point.sequence || pointIndex}`,
            ...baseRow,
            deliveryOrderItemRef: item._id,
            deliveryOrderItemRefs: [item._id],
            customerRef: point.billingCustomerRef || matchedReference?.billingCustomerRef || baseRow.customerRef,
            customerName: point.billingCustomerName || matchedReference?.billingCustomerName || baseRow.customerName,
            noSJ: shipperReferenceNumber,
            dari: matchedReference?.pickupAddress || baseRow.dari,
            tujuan:
                getActualDropDestination(point) ||
                matchedReference?.receiverAddress ||
                baseRow.tujuan,
            barang: item.orderItemDescription?.trim() || '',
            collie: billableCargo.qtyKoli,
            beratKg: billableCargo.weightKg,
            volumeM3: billableCargo.volumeM3,
        };
    };
    const aggregateDuplicateBillableRows = (inputRows: NotaItemRow[]) => {
        const aggregated = new Map<string, NotaItemRow>();
        const getItemCoverageKey = (row: NotaItemRow) => {
            const itemRefs = Array.from(new Set([
                ...(row.deliveryOrderItemRefs || []),
                row.deliveryOrderItemRef || '',
            ].map(value => value.trim()).filter(Boolean))).sort();
            return itemRefs.length > 0 ? itemRefs.join('|') : '-';
        };

        for (const row of inputRows) {
            const key = [
                row.doRef,
                row.noSJ,
                row.customerRef || '',
                row.customerName || '',
                row.tujuan || '',
                row.barang || '',
                row.dari || '',
                getItemCoverageKey(row),
            ].join('::');
            const existing = aggregated.get(key);
            if (!existing) {
                aggregated.set(key, { ...row });
                continue;
            }

            const deliveryOrderItemRefs = Array.from(new Set([
                ...(existing.deliveryOrderItemRefs || []),
                ...(row.deliveryOrderItemRefs || []),
                existing.deliveryOrderItemRef || '',
                row.deliveryOrderItemRef || '',
            ].map(value => value.trim()).filter(Boolean)));

            aggregated.set(key, {
                ...existing,
                id: existing.id || row.id,
                deliveryOrderItemRef: existing.deliveryOrderItemRef || row.deliveryOrderItemRef,
                deliveryOrderItemRefs,
                collie: (existing.collie || 0) + (row.collie || 0),
                beratKg: (existing.beratKg || 0) + (row.beratKg || 0),
                volumeM3: (existing.volumeM3 || 0) + (row.volumeM3 || 0),
                ket: [existing.ket, row.ket].map(value => value?.trim()).filter(Boolean).join('; '),
            });
        }

        return [...aggregated.values()];
    };

    if (relatedItems.length === 0) {
        if (shipperReferences.length > 0) {
            const rows = shipperReferences.map(reference => {
                const billableCargo = getDeliveryOrderBillableCargoSummary(deliveryOrder, reference.referenceNumber);
                const destinationSummary = getDeliveryOrderActualDropDestinations(deliveryOrder, {
                    shipperReferenceNumber: reference.referenceNumber,
                    billableOnly: true,
                }).join(', ');
                const actualDropBilling = getActualDropBillingContext(reference.referenceNumber);

                return {
                    id: Math.random().toString(36).slice(2),
                    ...baseRow,
                    customerRef: actualDropBilling.customerRef || reference.billingCustomerRef || baseRow.customerRef,
                    customerName: actualDropBilling.customerName || reference.billingCustomerName || baseRow.customerName,
                    noSJ: reference.referenceNumber,
                    dari: reference.pickupAddress || baseRow.dari,
                    tujuan:
                        (hasActualDropPoints && destinationSummary) ||
                        reference.receiverAddress ||
                        baseRow.tujuan,
                    barang: '',
                    collie: hasActualDropPoints ? billableCargo.qtyKoli : 0,
                    beratKg: hasActualDropPoints ? billableCargo.weightKg : 0,
                    volumeM3: hasActualDropPoints ? billableCargo.volumeM3 : 0,
                };
            });

            return hasActualDropPoints
                ? rows.filter(row => (row.collie || 0) > 0 || (row.beratKg || 0) > 0)
                : rows;
        }

        return [{
            id: Math.random().toString(36).slice(2),
            ...baseRow,
            barang: '',
            collie: 0,
            beratKg: 0,
            volumeM3: 0,
        }];
    }

    const rows: NotaItemRow[] = [];
    const emittedReferences = new Set<string>();

    for (const reference of shipperReferences) {
        const shipperReferenceNumber = reference.referenceNumber;
        emittedReferences.add(shipperReferenceNumber);
        const itemsForReference = groupedItems.get(shipperReferenceNumber) || [];
        const hasSpecificMapping = hasDeliveryOrderItemSpecificDropMapping(deliveryOrder, shipperReferenceNumber);
        const referenceBillableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const nonBillableCargo = getReferenceNonBillableCargo(shipperReferenceNumber);
        const hasNonBillableOutcome = hasActualDropPoints && hasCargo(nonBillableCargo);

        if (hasActualDropPoints && !hasCargo(referenceBillableCargo)) {
            continue;
        }

        const itemRows = itemsForReference
            .flatMap(item => {
                if (hasActualDropPoints && hasSpecificMapping) {
                    const pointRows = getBillableActualDropPointsForItem(shipperReferenceNumber, item)
                        .map((point, pointIndex) => buildActualDropPointItemRow(shipperReferenceNumber, item, point, pointIndex))
                        .filter((row): row is NotaItemRow => Boolean(row));
                    if (pointRows.length > 0) {
                        return pointRows;
                    }
                }
                const row = buildItemRow(shipperReferenceNumber, item, {
                    billableCargoOverride: hasActualDropPoints && !hasSpecificMapping && hasNonBillableOutcome && itemsForReference.length === 1
                        ? referenceBillableCargo
                        : undefined,
                    useSpecificBillableCargo: hasSpecificMapping,
                });
                return row ? [row] : [];
            })
            .filter((row): row is NotaItemRow => Boolean(row));

        if (itemRows.length > 0) {
            rows.push(...itemRows);
            continue;
        }

        rows.push(buildShipperReferenceRow(shipperReferenceNumber, itemsForReference));
    }

    for (const [shipperReferenceNumber, items] of groupedItems.entries()) {
        if (emittedReferences.has(shipperReferenceNumber)) {
            continue;
        }
        const hasSpecificMapping = hasDeliveryOrderItemSpecificDropMapping(deliveryOrder, shipperReferenceNumber);
        const referenceBillableCargo = getReferenceBillableCargo(shipperReferenceNumber);
        const nonBillableCargo = getReferenceNonBillableCargo(shipperReferenceNumber);
        const hasNonBillableOutcome = hasActualDropPoints && hasCargo(nonBillableCargo);

        if (hasActualDropPoints && !hasCargo(referenceBillableCargo)) {
            continue;
        }

        const itemRows = items
            .flatMap(item => {
                if (hasActualDropPoints && hasSpecificMapping) {
                    const pointRows = getBillableActualDropPointsForItem(shipperReferenceNumber, item)
                        .map((point, pointIndex) => buildActualDropPointItemRow(shipperReferenceNumber, item, point, pointIndex))
                        .filter((row): row is NotaItemRow => Boolean(row));
                    if (pointRows.length > 0) {
                        return pointRows;
                    }
                }
                const row = buildItemRow(shipperReferenceNumber, item, {
                    billableCargoOverride: hasActualDropPoints && !hasSpecificMapping && hasNonBillableOutcome && items.length === 1
                        ? referenceBillableCargo
                        : undefined,
                    useSpecificBillableCargo: hasSpecificMapping,
                });
                return row ? [row] : [];
            })
            .filter((row): row is NotaItemRow => Boolean(row));

        if (itemRows.length > 0) {
            rows.push(...itemRows);
            continue;
        }

        rows.push(buildShipperReferenceRow(shipperReferenceNumber, items));
    }

    if (!hasActualDropPoints) {
        return rows;
    }

    return aggregateDuplicateBillableRows(rows.filter(row =>
        (row.collie || 0) > 0 ||
        (row.beratKg || 0) > 0 ||
        hasDeliveryOrderBillableCargo(deliveryOrder, getDropReferenceScope(row.noSJ))
    ));
}
