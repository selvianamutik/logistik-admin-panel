import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import {
    calculateWeightPortion,
    calculateVolumePortion,
    deriveOrderItemStatusFromProgress,
    getOrderItemProgress,
    roundQuantity,
} from '@/lib/order-item-progress';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getSanityClient, sanityGetById, sanityGetNextNumber, sanityUpdate } from '@/lib/sanity';

import {
    assertIsoDate,
    extractRefId,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';
import {
    convertKgToWeightInputValue,
    convertM3ToVolumeInputValue,
    convertVolumeToM3,
    convertWeightToKg,
    type VolumeInputUnit,
    type WeightInputUnit,
} from '@/lib/measurement';
import {
    DO_STATUS_TRANSITIONS,
    DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES,
    DRIVER_STATUS_REQUEST_FIELDS,
    buildDriverRequestedTrackingStatus,
    deriveOrderStatusFromItems,
    normalizeOrderItemsInput,
    normalizeCustomerDoPrefix,
    normalizeDeliveryActualDropPoints,
    normalizeDeliveryOrderActualCargoInputs,
    normalizeDeliveryOrderSelections,
    resolvePayloadVolumeInputUnit,
    resolvePayloadWeightInputUnit,
    resolveOrderPartyData,
    resolveOrderPickupData,
    resolveOrderRecipientData,
    summarizeActualCargoInputs,
    summarizeSelection,
    type NormalizedActualCargoInput,
    type NormalizedOrderItemInput,
    type OrderItemProgressSnapshot,
    type OrderItemStatusSummary,
    type ResolvedCustomerPickupData,
    type ResolvedCustomerRecipientData,
    type ResolvedOrderPartyData,
} from './order-workflow-support';
import { resolveOrderCargoEntryMode } from '@/lib/order-cargo-entry-mode';
import { resolveTripRouteRateSelection } from './generic-workflow-support';
import { computeDriverVoucherTotals } from './driver-workflow-support';
import { computeDeliveryOrderOvertonage } from '@/lib/delivery-order-overtonage';
import type { CompanyProfile } from '@/lib/types';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

async function releaseDriverTrackingLockIfOwned(driverRef: unknown, deliveryOrderRef: string, timestamp: string) {
    const driverId = extractRefId(driverRef);
    if (!driverId) {
        return;
    }

    const driver = await sanityGetById<{ _id: string; _rev?: string; activeTrackingDeliveryOrderRef?: unknown }>(driverId);
    if (!driver?._rev) {
        return;
    }

    if (extractRefId(driver.activeTrackingDeliveryOrderRef) !== deliveryOrderRef) {
        return;
    }

    await getSanityClient()
        .patch(driverId)
        .ifRevisionId(driver._rev)
        .unset(['activeTrackingDeliveryOrderRef'])
        .set({ activeTrackingUpdatedAt: timestamp })
        .commit();
}

function buildOrderItemDraftDocument(
    orderRef: string,
    item: NormalizedOrderItemInput,
    itemId: string = crypto.randomUUID(),
    extras?: Record<string, unknown>
) {
    return {
        _id: itemId,
        _type: 'orderItem',
        orderRef,
        entrySource: 'ORDER',
        customerProductRef: item.customerProductRef,
        customerProductCode: item.customerProductCode,
        customerProductName: item.customerProductName,
        description: item.description,
        qtyKoli: item.qtyKoli,
        weight: item.weight,
        volume: item.volume,
        weightInputValue: item.weightInputValue,
        weightInputUnit: item.weightInputUnit,
        volumeInputValue: item.volumeInputValue,
        volumeInputUnit: item.volumeInputUnit,
        value: item.value,
        deliveredQtyKoli: 0,
        deliveredWeight: 0,
        deliveredVolume: 0,
        assignedQtyKoli: 0,
        assignedWeight: 0,
        assignedVolume: 0,
        heldQtyKoli: 0,
        heldWeight: 0,
        heldVolume: 0,
        status: 'PENDING',
        ...extras,
    };
}

export async function syncOrderStatusFromItems(orderRef: string, session: ApiSession, addAuditLog: AuditLogFn) {
    const order = await sanityGetById<{ _id: string; status?: string }>(orderRef);
    if (!order || order.status === 'CANCELLED') {
        return;
    }

    const items = await getSanityClient().fetch<OrderItemStatusSummary[]>(
        `*[_type == "orderItem" && orderRef == $orderRef]{
            status,
            qtyKoli,
            weight,
            volume,
            deliveredQtyKoli,
            deliveredWeight,
            deliveredVolume,
            assignedQtyKoli,
            assignedWeight,
            assignedVolume,
            heldQtyKoli,
            heldWeight,
            heldVolume
        }`,
        { orderRef }
    );
    const nextStatus = deriveOrderStatusFromItems(items);

    if (order.status === nextStatus) {
        return;
    }

    await sanityUpdate(orderRef, { status: nextStatus });
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        orderRef,
        `Order auto-${nextStatus}: sinkronisasi dari ${items.length} item`
    );
}

export async function handleOrderItemHoldSet(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const holdQtyKoli = normalizeNumber(data.holdQtyKoli);
    let holdWeightInputUnit: WeightInputUnit;
    let holdVolumeInputUnit: VolumeInputUnit;
    try {
        holdWeightInputUnit = resolvePayloadWeightInputUnit(data.holdWeightInputUnit, 'Satuan berat hold');
        holdVolumeInputUnit = resolvePayloadVolumeInputUnit(data.holdVolumeInputUnit, 'Satuan volume hold');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Satuan hold tidak valid' },
            { status: 400 }
        );
    }
    const holdWeightInputValue = roundQuantity(normalizeNumber(data.holdWeightInputValue, {
        maxFractionDigits: holdWeightInputUnit === 'TON' ? 3 : 2,
    }), holdWeightInputUnit === 'TON' ? 3 : 2);
    const holdVolumeInputValue = roundQuantity(normalizeNumber(data.holdVolumeInputValue, {
        maxFractionDigits: holdVolumeInputUnit === 'LITER' ? 0 : 3,
    }), holdVolumeInputUnit === 'LITER' ? 0 : 3);
    const holdReason = normalizeOptionalText(data.holdReason);
    const holdLocation = normalizeOptionalText(data.holdLocation);

    if (!id) {
        return NextResponse.json({ error: 'Item order tidak valid' }, { status: 400 });
    }
    if (!holdReason) {
        return NextResponse.json({ error: 'Alasan hold wajib diisi' }, { status: 400 });
    }

    const orderItem = await sanityGetById<OrderItemProgressSnapshot>(id);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }

    const progress = getOrderItemProgress(orderItem);
    if (progress.totalQtyKoli <= 0) {
        const holdWeight = holdWeightInputValue > 0 ? roundQuantity(convertWeightToKg(holdWeightInputValue, holdWeightInputUnit)) : 0;
        const holdVolume = holdVolumeInputValue > 0 ? roundQuantity(convertVolumeToM3(holdVolumeInputValue, holdVolumeInputUnit), 3) : 0;
        if (progress.pendingWeight > 0 && holdWeight <= 0) {
            return NextResponse.json({ error: 'Berat hold wajib diisi untuk item non-koli' }, { status: 400 });
        }
        if (progress.pendingVolume > 0 && holdVolume <= 0) {
            return NextResponse.json({ error: 'Volume hold wajib diisi untuk item non-koli' }, { status: 400 });
        }
        if (holdWeight <= 0 && holdVolume <= 0) {
            return NextResponse.json({ error: 'Muatan hold tidak valid' }, { status: 400 });
        }
        if (holdWeight - progress.pendingWeight > 0.00001) {
            return NextResponse.json({ error: 'Berat hold melebihi sisa berat yang siap dikirim' }, { status: 409 });
        }
        if (holdVolume - progress.pendingVolume > 0.00001) {
            return NextResponse.json({ error: 'Volume hold melebihi sisa volume yang siap dikirim' }, { status: 409 });
        }

        const updates = {
            heldWeight: roundQuantity(progress.heldWeight + holdWeight),
            heldVolume: roundQuantity(progress.heldVolume + holdVolume, 3),
            holdReason,
            holdLocation: holdLocation || undefined,
            status: deriveOrderItemStatusFromProgress({
                ...progress,
                heldWeight: roundQuantity(progress.heldWeight + holdWeight),
                heldVolume: roundQuantity(progress.heldVolume + holdVolume, 3),
                pendingWeight: roundQuantity(Math.max(progress.pendingWeight - holdWeight, 0)),
                pendingVolume: roundQuantity(Math.max(progress.pendingVolume - holdVolume, 0), 3),
            }),
        };

        const updated = await sanityUpdate(id, updates);
        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
        await addAuditLog(
            session,
            'UPDATE',
            'order-items',
            id,
            `Item order hold ${[
                holdWeight > 0 ? `${roundQuantity(holdWeight)} kg` : null,
                holdVolume > 0 ? `${roundQuantity(holdVolume, 3)} m3` : null,
            ].filter(Boolean).join(' / ')}${holdLocation ? ` di ${holdLocation}` : ''}: ${holdReason}`
        );

        return NextResponse.json({ data: updated });
    }
    if (!Number.isFinite(holdQtyKoli) || holdQtyKoli <= 0) {
        return NextResponse.json({ error: 'Jumlah koli hold tidak valid' }, { status: 400 });
    }
    if (progress.pendingQtyKoli <= 0) {
        return NextResponse.json({ error: 'Tidak ada sisa qty yang bisa ditahan' }, { status: 409 });
    }
    if (holdQtyKoli > progress.pendingQtyKoli) {
        return NextResponse.json({ error: 'Jumlah hold melebihi sisa qty yang siap dikirim' }, { status: 409 });
    }

    const holdWeight = calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, holdQtyKoli);
    const updates = {
        heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyKoli),
        heldWeight: roundQuantity(progress.heldWeight + holdWeight),
        holdReason,
        holdLocation: holdLocation || undefined,
        status: deriveOrderItemStatusFromProgress({
            ...progress,
            heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyKoli),
            heldWeight: roundQuantity(progress.heldWeight + holdWeight),
            pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - holdQtyKoli, 0)),
            pendingWeight: roundQuantity(Math.max(progress.pendingWeight - holdWeight, 0)),
        }),
    };

    const updated = await sanityUpdate(id, updates);
    const orderRef = extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'order-items',
        id,
        `Item order hold ${holdQtyKoli} koli${holdLocation ? ` di ${holdLocation}` : ''}: ${holdReason}`
    );

    return NextResponse.json({ data: updated });
}

export async function handleOrderItemHoldRelease(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Item order tidak valid' }, { status: 400 });
    }

    const orderItem = await sanityGetById<OrderItemProgressSnapshot>(id);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }

    const progress = getOrderItemProgress(orderItem);
    if (progress.totalQtyKoli <= 0) {
        if (progress.heldWeight <= 0 && progress.heldVolume <= 0) {
            return NextResponse.json({ error: 'Item ini tidak punya hold aktif' }, { status: 409 });
        }
        const updates = {
            heldWeight: 0,
            heldVolume: 0,
            holdReason: undefined,
            holdLocation: undefined,
            status: deriveOrderItemStatusFromProgress({
                ...progress,
                heldWeight: 0,
                heldVolume: 0,
                pendingWeight: roundQuantity(progress.pendingWeight + progress.heldWeight),
                pendingVolume: roundQuantity(progress.pendingVolume + progress.heldVolume, 3),
            }),
        };
        const updated = await sanityUpdate(id, updates);

        const orderRef = extractRefId(orderItem.orderRef);
        if (orderRef) {
            await syncOrderStatusFromItems(orderRef, session, addAuditLog);
        }
        await addAuditLog(
            session,
            'UPDATE',
            'order-items',
            id,
            `Hold item order dilepas${orderItem.holdLocation ? ` dari ${orderItem.holdLocation}` : ''}`
        );

        return NextResponse.json({ data: updated });
    }
    if (progress.heldQtyKoli <= 0) {
        return NextResponse.json({ error: 'Item ini tidak punya qty hold aktif' }, { status: 409 });
    }

    const updates = {
        heldQtyKoli: 0,
        heldWeight: 0,
        holdReason: undefined,
        holdLocation: undefined,
        status: deriveOrderItemStatusFromProgress({
            ...progress,
            heldQtyKoli: 0,
            heldWeight: 0,
            pendingQtyKoli: roundQuantity(progress.pendingQtyKoli + progress.heldQtyKoli),
            pendingWeight: roundQuantity(progress.pendingWeight + progress.heldWeight),
        }),
    };
    const updated = await sanityUpdate(id, updates);

    const orderRef = extractRefId(orderItem.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }
    await addAuditLog(
        session,
        'UPDATE',
        'order-items',
        id,
        `Release hold item order ${progress.heldQtyKoli} koli`
    );

    return NextResponse.json({ data: updated });
}

export async function handleOrderCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);
    if (!customerRef) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    let customer: ResolvedOrderPartyData['customer'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    let items: NormalizedOrderItemInput[];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
        items = await normalizeOrderItemsInput(customerRef, Array.isArray(data.items) ? data.items : [], {
            allowEmpty: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }
    const receiverName = normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || '';
    const receiverAddress = normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || '';
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const orderId = crypto.randomUUID();
    const masterResi = await sanityGetNextNumber('resi');
    const createdAt = new Date().toISOString();
    const orderDoc = {
        _id: orderId,
        _type: 'order',
        cargoEntryMode: items.length === 0 ? 'DELIVERY_ORDER' : 'ORDER',
        customerRef,
        customerName: customer.name,
        customerRecipientRef: customerRecipientRef || undefined,
        customerPickupRef: customerPickupRef || undefined,
        receiverName,
        receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
        receiverAddress,
        receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
        pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
        serviceRef: serviceRef || '',
        serviceName,
        notes: normalizeOptionalText(data.notes),
        masterResi,
        status: 'OPEN',
        createdAt,
        createdBy: session._id,
    };

    const transaction = getSanityClient().transaction().create(orderDoc);
    for (const item of items) {
        transaction.create(buildOrderItemDraftDocument(orderId, item));
    }

    await transaction.commit();
    await addAuditLog(
        session,
        'CREATE',
        'orders',
        orderId,
        `Created orders: ${masterResi}${items.length > 0 ? ` (${items.length} item target)` : ' (header booking tanpa item)'}`
    );
    return NextResponse.json({ data: orderDoc, id: orderId });
}

export async function handleOrderUpdateWithItems(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);

    if (!id || !customerRef) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{ _id: string; masterResi?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini memakai flow header booking. Edit header order lewat workflow header booking, bukan edit item order.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh mengubah item atau koli lagi' }, { status: 409 });
    }

    const existingItems = await getSanityClient().fetch<Array<{
        _id: string;
        deliveredQtyKoli?: number;
        deliveredWeight?: number;
        deliveredVolume?: number;
        assignedQtyKoli?: number;
        assignedWeight?: number;
        assignedVolume?: number;
        heldQtyKoli?: number;
        heldWeight?: number;
        heldVolume?: number;
    }>>(
        `*[_type == "orderItem" && orderRef == $ref]{
            _id,
            deliveredQtyKoli,
            deliveredWeight,
            deliveredVolume,
            assignedQtyKoli,
            assignedWeight,
            assignedVolume,
            heldQtyKoli,
            heldWeight,
            heldVolume
        }`,
        { ref: id }
    );
    const hasOperationalProgress = existingItems.some(item =>
        normalizeNumber(item.deliveredQtyKoli) > 0 ||
        normalizeNumber(item.deliveredWeight) > 0 ||
        normalizeNumber(item.deliveredVolume) > 0 ||
        normalizeNumber(item.assignedQtyKoli) > 0 ||
        normalizeNumber(item.assignedWeight) > 0 ||
        normalizeNumber(item.assignedVolume) > 0 ||
        normalizeNumber(item.heldQtyKoli) > 0 ||
        normalizeNumber(item.heldWeight) > 0 ||
        normalizeNumber(item.heldVolume) > 0
    );
    if (hasOperationalProgress) {
        return NextResponse.json(
            { error: 'Order yang sudah punya progress parsial/hold harus diedit lewat workflow item order, bukan edit massal' },
            { status: 409 }
        );
    }

    let customer: ResolvedOrderPartyData['customer'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    let items: NormalizedOrderItemInput[];
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
        items = await normalizeOrderItemsInput(customerRef, Array.isArray(data.items) ? data.items : [], {
            allowEmpty: true,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }
    if (items.length === 0 && existingItems.length > 0) {
        return NextResponse.json(
            { error: 'Order lama yang sudah punya item target tidak boleh dikosongkan. Barang tetap mengikuti histori order ini.' },
            { status: 409 }
        );
    }

    const receiverName = normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || '';
    const receiverAddress = normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || '';
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const transaction = getSanityClient()
        .transaction()
        .patch(id, patch => patch.set({
            cargoEntryMode: 'ORDER',
            customerRef,
            customerName: customer.name,
            customerRecipientRef: customerRecipientRef || undefined,
            customerPickupRef: customerPickupRef || undefined,
            receiverName,
            receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
            receiverAddress,
            receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
            pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
            serviceRef: serviceRef || '',
            serviceName,
            notes: normalizeOptionalText(data.notes),
        }));

    for (const item of existingItems) {
        transaction.delete(item._id);
    }

    for (const item of items) {
        transaction.create(buildOrderItemDraftDocument(id, item));
    }

    await transaction.commit();
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Update order ${order.masterResi || id}${items.length > 0 ? ` dengan ${items.length} item` : ' sebagai header booking tanpa item'}`
    );

    const updatedOrder = await sanityGetById(id);
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleOrderHeaderBookingUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const customerRef = normalizeText(data.customerRef);
    const serviceRef = normalizeOptionalText(data.serviceRef);
    const customerRecipientRef = normalizeOptionalText(data.customerRecipientRef);
    const customerPickupRef = normalizeOptionalText(data.customerPickupRef);
    const notes = normalizeOptionalText(data.notes);

    if (!id || !customerRef) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{
        _createdAt?: string;
        _id: string;
        _rev?: string;
        createdAt?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerRecipientRef?: string;
        customerPickupRef?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        pickupAddress?: string;
        serviceRef?: string;
        notes?: string;
    }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini masih memakai flow item target di order. Gunakan edit order biasa.' },
            { status: 409 }
        );
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );

    if (relatedDeliveryOrder) {
        const attemptedHeaderChanges =
            normalizeText(order.customerRef) !== customerRef ||
            normalizeOptionalText(order.serviceRef) !== serviceRef ||
            normalizeOptionalText(order.customerRecipientRef) !== customerRecipientRef ||
            normalizeOptionalText(order.customerPickupRef) !== customerPickupRef ||
            normalizeText(order.receiverName) !== normalizeText(data.receiverName) ||
            normalizeOptionalText(order.receiverPhone) !== normalizeOptionalText(data.receiverPhone) ||
            normalizeText(order.receiverAddress) !== normalizeText(data.receiverAddress) ||
            normalizeOptionalText(order.receiverCompany) !== normalizeOptionalText(data.receiverCompany) ||
            normalizeOptionalText(order.pickupAddress) !== normalizeOptionalText(data.pickupAddress);

        if (attemptedHeaderChanges) {
            return NextResponse.json(
                { error: 'Order header booking yang sudah punya Surat Jalan hanya boleh mengubah catatan umum.' },
                { status: 409 }
            );
        }

        if (!order._rev) {
            return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        let updatedOrder: unknown;
        try {
            updatedOrder = await getSanityClient()
                .patch(id)
                .ifRevisionId(order._rev)
                .set({ notes })
                .commit();
        } catch (error) {
            if (isMutationConflictError(error)) {
                return NextResponse.json(
                    { error: 'Header booking berubah karena ada update lain. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw error;
        }
        await addAuditLog(
            session,
            'UPDATE',
            'orders',
            id,
            `Update header booking ${order.masterResi || id}: catatan umum diperbarui setelah Surat Jalan terbit`
        );
        return NextResponse.json({ data: updatedOrder, id });
    }

    let customer: ResolvedOrderPartyData['customer'];
    let serviceName: string | undefined;
    let customerRecipient: ResolvedCustomerRecipientData | null = null;
    let customerPickup: ResolvedCustomerPickupData | null = null;
    try {
        const party = await resolveOrderPartyData(customerRef, serviceRef);
        customer = party.customer;
        serviceName = party.serviceName;
        customerRecipient = await resolveOrderRecipientData(customerRef, customerRecipientRef);
        customerPickup = await resolveOrderPickupData(customerRef, customerPickupRef);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Data order tidak valid';
        const status = message.includes('tidak ditemukan') ? 404 : message.includes('tidak aktif') ? 409 : 400;
        return NextResponse.json({ error: message }, { status });
    }

    const receiverName = normalizeText(data.receiverName) || normalizeOptionalText(customerRecipient?.receiverName) || '';
    const receiverAddress = normalizeText(data.receiverAddress) || normalizeOptionalText(customerRecipient?.receiverAddress) || '';
    if (!receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Order, customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updatedOrder: unknown;
    try {
        updatedOrder = await getSanityClient()
            .patch(id)
            .ifRevisionId(order._rev)
            .set({
                cargoEntryMode: 'DELIVERY_ORDER',
                customerRef,
                customerName: customer.name,
                customerRecipientRef: customerRecipientRef || undefined,
                customerPickupRef: customerPickupRef || undefined,
                receiverName,
                receiverPhone: normalizeOptionalText(data.receiverPhone) || normalizeOptionalText(customerRecipient?.receiverPhone) || '',
                receiverAddress,
                receiverCompany: normalizeOptionalText(data.receiverCompany) || normalizeOptionalText(customerRecipient?.receiverCompany),
                pickupAddress: normalizeOptionalText(data.pickupAddress) || normalizeOptionalText(customerPickup?.pickupAddress) || customer.address || undefined,
                serviceRef: serviceRef || '',
                serviceName,
                notes,
            })
            .commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Header booking berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Update header booking ${order.masterResi || id}: customer, tujuan, armada, atau catatan diperbarui`
    );
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleOrderTargetRevision(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = normalizeText(data.id);
    const revisionReason = normalizeOptionalText(data.revisionReason);
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }
    if (!revisionReason) {
        return NextResponse.json({ error: 'Alasan revisi order wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{ _id: string; _rev?: string; masterResi?: string; notes?: string; cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER' }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }
    if (order.cargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order header booking tidak memakai revisi target item. Barang tetap mengikuti Surat Jalan.' },
            { status: 409 }
        );
    }

    const existingItems = await getSanityClient().fetch<Array<OrderItemProgressSnapshot & { _rev?: string }>>(
        `*[_type == "orderItem" && orderRef == $ref]{
            _id,
            _rev,
            orderRef,
            description,
            qtyKoli,
            weight,
            volume,
            weightInputValue,
            weightInputUnit,
            volumeInputValue,
            volumeInputUnit,
            status,
            deliveredQtyKoli,
            deliveredWeight,
            deliveredVolume,
            assignedQtyKoli,
            assignedWeight,
            assignedVolume,
            heldQtyKoli,
            heldWeight,
            heldVolume,
            holdReason,
            holdLocation
        }`,
        { ref: id }
    );
    if (existingItems.length === 0) {
        return NextResponse.json({ error: 'Order belum punya item yang bisa direvisi' }, { status: 409 });
    }
    if (!order._rev) {
        return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (existingItems.some(item => !item._rev)) {
        return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const rawItems = Array.isArray(data.items) ? data.items.filter(isPlainObject) : [];
    if (rawItems.length !== existingItems.length) {
        return NextResponse.json(
            { error: 'Revisi order hanya boleh mengubah target item yang sudah ada, tanpa menambah atau menghapus item' },
            { status: 409 }
        );
    }

    const rawItemById = new Map<string, Record<string, unknown>>();
    for (const rawItem of rawItems) {
        const itemId = normalizeText(rawItem.id);
        if (itemId) {
            rawItemById.set(itemId, rawItem);
        }
    }
    if (rawItemById.size !== existingItems.length) {
        return NextResponse.json({ error: 'Data item revisi tidak lengkap' }, { status: 400 });
    }

    const transaction = getSanityClient().transaction();
    const revisionSummaries: string[] = [];

    for (const existingItem of existingItems) {
        const rawItem = rawItemById.get(existingItem._id);
        if (!rawItem) {
            return NextResponse.json({ error: 'Ada item order yang belum ikut direvisi' }, { status: 400 });
        }

        const qtyKoli = roundQuantity(normalizeNumber(rawItem.qtyKoli));
        if (!Number.isFinite(qtyKoli) || qtyKoli < 0) {
            return NextResponse.json(
                { error: `Target koli untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }

        let weightInputUnit: WeightInputUnit;
        let volumeInputUnit: VolumeInputUnit;
        try {
            weightInputUnit = resolvePayloadWeightInputUnit(rawItem.weightInputUnit, `Satuan berat target ${existingItem.description || 'item order'}`);
            volumeInputUnit = resolvePayloadVolumeInputUnit(rawItem.volumeInputUnit, `Satuan volume target ${existingItem.description || 'item order'}`);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : `Satuan item ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const weightInputValue = roundQuantity(normalizeNumber(rawItem.weightInputValue, {
            maxFractionDigits: weightInputUnit === 'TON' ? 3 : 2,
        }), weightInputUnit === 'TON' ? 3 : 2);
        if (!Number.isFinite(weightInputValue) || weightInputValue < 0) {
            return NextResponse.json(
                { error: `Target berat untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const weight = roundQuantity(convertWeightToKg(weightInputValue, weightInputUnit));

        const volumeInputValue = roundQuantity(normalizeNumber(rawItem.volumeInputValue, {
            maxFractionDigits: volumeInputUnit === 'LITER' ? 0 : 3,
        }), volumeInputUnit === 'LITER' ? 0 : 3);
        if (!Number.isFinite(volumeInputValue) || volumeInputValue < 0) {
            return NextResponse.json(
                { error: `Target volume untuk ${existingItem.description || 'item order'} tidak valid` },
                { status: 400 }
            );
        }
        const volume = roundQuantity(convertVolumeToM3(volumeInputValue, volumeInputUnit), 3);

        const progress = getOrderItemProgress(existingItem);
        const lockedQtyKoli = roundQuantity(progress.deliveredQtyKoli + progress.assignedQtyKoli);
        const lockedWeight = roundQuantity(progress.deliveredWeight + progress.assignedWeight);
        const lockedVolume = roundQuantity(progress.deliveredVolume + progress.assignedVolume, 3);
        const hadHoldProgress =
            progress.heldQtyKoli > 0 ||
            progress.heldWeight > 0 ||
            progress.heldVolume > 0;

        if (qtyKoli <= 0 && weight <= 0 && volume <= 0) {
            return NextResponse.json(
                { error: `Target ${existingItem.description || 'item order'} wajib punya koli, berat, atau volume lebih dari 0` },
                { status: 400 }
            );
        }

        if (lockedQtyKoli > 0 && qtyKoli < lockedQtyKoli) {
            return NextResponse.json(
                {
                    error: `Target koli ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedQtyKoli} koli).`,
                },
                { status: 409 }
            );
        }
        if (weight < lockedWeight) {
            return NextResponse.json(
                {
                    error: `Target berat ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedWeight} kg).`,
                },
                { status: 409 }
            );
        }
        if (lockedVolume > 0 && volume < lockedVolume) {
            return NextResponse.json(
                {
                    error: `Target volume ${existingItem.description || 'item order'} tidak boleh lebih kecil dari progress yang sudah terkirim / dalam DO aktif (${lockedVolume} m3).`,
                },
                { status: 409 }
            );
        }

        const nextProgress = getOrderItemProgress({
            ...existingItem,
            qtyKoli,
            weight,
            volume,
            heldQtyKoli: 0,
            heldWeight: 0,
            heldVolume: 0,
        });
        const hasAssignedProgress =
            nextProgress.assignedQtyKoli > 0 ||
            nextProgress.assignedWeight > 0 ||
            nextProgress.assignedVolume > 0;
        const nextStatus =
            hasAssignedProgress
                ? deriveOrderItemStatusFromProgress(nextProgress, 'in-transit')
                : deriveOrderItemStatusFromProgress(nextProgress);

        transaction.patch(existingItem._id, {
            ifRevisionID: existingItem._rev,
            set: {
                qtyKoli,
                weight,
                volume: volume > 0 ? volume : undefined,
                weightInputValue: weightInputValue > 0 ? weightInputValue : undefined,
                weightInputUnit: weightInputValue > 0 ? weightInputUnit : undefined,
                volumeInputValue: volumeInputValue > 0 ? volumeInputValue : undefined,
                volumeInputUnit: volumeInputValue > 0 ? volumeInputUnit : undefined,
                heldQtyKoli: 0,
                heldWeight: 0,
                heldVolume: 0,
                status: nextStatus,
            },
            unset: ['holdReason', 'holdLocation'],
        });

        const itemChanges: string[] = [];
        if (roundQuantity(normalizeNumber(existingItem.qtyKoli)) !== qtyKoli) {
            itemChanges.push(`koli ${roundQuantity(normalizeNumber(existingItem.qtyKoli))} -> ${qtyKoli}`);
        }
        if (roundQuantity(normalizeNumber(existingItem.weight)) !== weight) {
            itemChanges.push(`berat ${roundQuantity(normalizeNumber(existingItem.weight))} kg -> ${weight} kg`);
        }
        if (roundQuantity(normalizeNumber(existingItem.volume ?? 0), 3) !== volume) {
            itemChanges.push(`volume ${roundQuantity(normalizeNumber(existingItem.volume ?? 0), 3)} m3 -> ${volume} m3`);
        }
        if (hadHoldProgress) {
            itemChanges.push('hold dilepas ke pending');
        }
        if (itemChanges.length > 0) {
            revisionSummaries.push(`${existingItem.description || existingItem._id}: ${itemChanges.join(', ')}`);
        }
    }

    transaction.patch(id, {
        ifRevisionID: order._rev,
        set: {
            notes: normalizeOptionalText(data.notes),
        },
    });

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order atau target item berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await syncOrderStatusFromItems(id, session, addAuditLog);
    await addAuditLog(
        session,
        'UPDATE',
        'orders',
        id,
        `Revisi order ${order.masterResi || id}: ${revisionReason}${revisionSummaries.length > 0 ? ` | ${revisionSummaries.join('; ')}` : ''}`
    );

    const updatedOrder = await sanityGetById(id);
    return NextResponse.json({ data: updatedOrder, id });
}

export async function handleDeliveryOrderStatusUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = typeof data.note === 'string' ? data.note.trim() : '';
    if (!id || !status) {
        return NextResponse.json({ error: 'Status DO tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        orderRef?: unknown;
        driverRef?: unknown;
        serviceRef?: unknown;
        vehicleRef?: unknown;
        trackingState?: string;
        podReceiverName?: string;
        podReceivedDate?: string;
        podNote?: string;
        receiverName?: string;
        receiverCompany?: string;
        receiverAddress?: string;
        baseTaripBorongan?: number;
        taripBorongan?: number;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const hasTripVehicle = Boolean(extractRefId(deliveryOrder.vehicleRef));
    const hasTripDriver = Boolean(extractRefId(deliveryOrder.driverRef));
    const requiresTripResources =
        status === 'HEADING_TO_PICKUP' ||
        status === 'ON_DELIVERY' ||
        status === 'ARRIVED' ||
        status === 'DELIVERED';
    if (requiresTripResources && (!hasTripVehicle || !hasTripDriver)) {
        return NextResponse.json(
            {
                error: 'Armada trip belum lengkap. Isi kendaraan dan supir dulu sebelum DO dijalankan atau diselesaikan.',
            },
            { status: 409 }
        );
    }

    if (deliveryOrder.pendingDriverStatus && status !== deliveryOrder.pendingDriverStatus) {
        return NextResponse.json(
            {
                error: `DO ${deliveryOrder.doNumber || id} sedang menunggu approval permintaan driver ${deliveryOrder.pendingDriverStatus}. Review/approve atau tolak dulu sebelum ganti ke status lain.`,
            },
            { status: 409 }
        );
    }

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status DO tidak valid' }, { status: 400 });
    }

    const doItems = await getSanityClient().fetch<Array<{
        _id: string;
        orderItemRef?: unknown;
        shippedQtyKoli?: number;
        shippedWeight?: number;
        orderItemQtyKoli?: number;
        orderItemWeight?: number;
        orderItemVolumeM3?: number;
        orderItemWeightInputValue?: number;
        orderItemWeightInputUnit?: WeightInputUnit;
        orderItemVolumeInputValue?: number;
        orderItemVolumeInputUnit?: VolumeInputUnit;
        actualQtyKoli?: number;
        actualWeightKg?: number;
        actualVolumeM3?: number;
        actualWeightInputValue?: number;
        actualWeightInputUnit?: WeightInputUnit;
        actualVolumeInputValue?: number;
        actualVolumeInputUnit?: VolumeInputUnit;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            _id,
            orderItemRef,
            shippedQtyKoli,
            shippedWeight,
            orderItemQtyKoli,
            orderItemWeight,
            orderItemVolumeM3,
            orderItemWeightInputValue,
            orderItemWeightInputUnit,
            orderItemVolumeInputValue,
            orderItemVolumeInputUnit,
            actualQtyKoli,
            actualWeightKg,
            actualVolumeM3,
            actualWeightInputValue,
            actualWeightInputUnit,
            actualVolumeInputValue,
            actualVolumeInputUnit
        }`,
        { ref: id }
    );
    const podReceiverName = normalizeOptionalText(data.podReceiverName);
    const podReceivedDate = normalizeOptionalText(data.podReceivedDate);
    const podNote = normalizeOptionalText(data.podNote);

    if (status === 'DELIVERED') {
        if (!podReceiverName) {
            return NextResponse.json({ error: 'Nama penerima POD wajib diisi untuk menyelesaikan surat jalan' }, { status: 400 });
        }
        if (!podReceivedDate) {
            return NextResponse.json({ error: 'Tanggal terima POD wajib diisi untuk menyelesaikan surat jalan' }, { status: 400 });
        }
        try {
            assertIsoDate(podReceivedDate, 'Tanggal terima POD');
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Tanggal terima POD tidak valid' },
                { status: 400 }
            );
        }
    }

    let actualCargoByDoItemId = new Map<string, NormalizedActualCargoInput>();
    let actualDropPoints: ReturnType<typeof normalizeDeliveryActualDropPoints> | undefined;
    let overtonageResult: ReturnType<typeof computeDeliveryOrderOvertonage> | undefined;
    let linkedVoucherAdjustmentSummary: string | undefined;
    let settledVoucherOvertonageWarning: string | undefined;
    let linkedVoucherPatch:
        | {
            _id: string;
            _rev: string;
            driverFeeAmount: number;
            totalClaimAmount: number;
        }
        | undefined;
    if (status === 'DELIVERED') {
        if (doItems.length === 0) {
            return NextResponse.json(
                { error: 'Surat jalan belum punya item muatan. Isi barang dulu sebelum DO diselesaikan.' },
                { status: 400 }
            );
        }

        try {
            actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, doItems);
            actualDropPoints = normalizeDeliveryActualDropPoints(data, deliveryOrder, actualCargoByDoItemId);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Muatan aktual surat jalan tidak valid' },
                { status: 400 }
            );
        }

        const actualCargoTotals = summarizeActualCargoInputs(actualCargoByDoItemId);
        const serviceRef = extractRefId(deliveryOrder.serviceRef);
        const vehicleRef = extractRefId(deliveryOrder.vehicleRef);
        const [service, vehicle, linkedVoucher] = await Promise.all([
            serviceRef
                ? sanityGetById<{
                    _id: string;
                    maxPayloadKg?: number;
                    overtonaseDriverRatePerKg?: number;
                }>(serviceRef)
                : Promise.resolve(null),
            vehicleRef
                ? sanityGetById<{
                    _id: string;
                    capacityKg?: number;
                }>(vehicleRef)
                : Promise.resolve(null),
            getSanityClient().fetch<{
                _id: string;
                _rev?: string;
                bonNumber?: string;
                status?: string;
                totalSpent?: number;
                totalIssuedAmount?: number;
                cashGiven?: number;
                driverFeeAmount?: number;
            } | null>(
                `*[_type == "driverVoucher" && (deliveryOrderRef == $ref || deliveryOrderRef._ref == $ref)][0]{
                    _id,
                    _rev,
                    bonNumber,
                    status,
                    totalSpent,
                    totalIssuedAmount,
                    cashGiven,
                    driverFeeAmount
                }`,
                { ref: id }
            ),
        ]);

        overtonageResult = computeDeliveryOrderOvertonage({
            actualTotalWeightKg: actualCargoTotals.weightKg,
            serviceMaxPayloadKg: service?.maxPayloadKg,
            vehicleCapacityKg: vehicle?.capacityKg,
            baseTripFee: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0),
            overtonaseDriverRatePerKg: service?.overtonaseDriverRatePerKg,
        });

        if (
            linkedVoucher?._id &&
            linkedVoucher._rev &&
            linkedVoucher.status !== 'SETTLED' &&
            Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
        ) {
            const voucherTotals = computeDriverVoucherTotals(
                normalizeNumber(linkedVoucher.totalIssuedAmount ?? linkedVoucher.cashGiven ?? 0, { maxFractionDigits: 0 }),
                normalizeNumber(linkedVoucher.totalSpent ?? 0, { maxFractionDigits: 0 }),
                overtonageResult.effectiveTripFee
            );
            linkedVoucherPatch = {
                _id: linkedVoucher._id,
                _rev: linkedVoucher._rev,
                driverFeeAmount: voucherTotals.driverFeeAmount,
                totalClaimAmount: voucherTotals.totalClaimAmount,
            };
            linkedVoucherAdjustmentSummary = `bon ${linkedVoucher.bonNumber || linkedVoucher._id} ikut disinkronkan ke ${voucherTotals.driverFeeAmount}`;
        }

        if (
            linkedVoucher?._id &&
            linkedVoucher.status === 'SETTLED' &&
            Math.abs(normalizeCurrencyNumber(linkedVoucher.driverFeeAmount ?? 0) - overtonageResult.effectiveTripFee) > 0.01
        ) {
            settledVoucherOvertonageWarning = `Bon ${linkedVoucher.bonNumber || linkedVoucher._id} sudah settle, jadi tambahan overtonase tidak ikut mengubah settlement lama.`;
        }
    }

    const timestamp = new Date().toISOString();
    const shouldStopTracking = status === 'DELIVERED' || status === 'CANCELLED';
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                status,
                ...(status === 'DELIVERED'
                    ? {
                        podReceiverName,
                        podReceivedDate,
                        podNote,
                        baseTaripBorongan: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0) || undefined,
                        taripBorongan: overtonageResult?.effectiveTripFee || normalizeCurrencyNumber(deliveryOrder.taripBorongan ?? 0) || undefined,
                        actualTotalWeightKg: overtonageResult?.actualTotalWeightKg || undefined,
                        serviceMaxPayloadKg: overtonageResult?.serviceMaxPayloadKg,
                        vehicleCapacityKg: overtonageResult?.vehicleCapacityKg,
                        overtonaseWeightKg: overtonageResult?.overtonaseWeightKg,
                        overtonaseDriverRatePerKg: overtonageResult?.overtonaseDriverRatePerKg,
                        overtonaseDriverAmount: overtonageResult?.overtonaseDriverAmount,
                        vehicleCapacityExceededKg: overtonageResult?.vehicleCapacityExceededKg,
                        cargoFinalizedAt: timestamp,
                        cargoFinalizedBy: session._id,
                        cargoFinalizedByName: session.name,
                        actualDropPoints,
                    }
                    : {}),
                ...(shouldStopTracking
                    ? {
                        trackingState: 'STOPPED',
                        trackingStoppedAt: timestamp,
                    }
                    : {}),
            },
            unset: DRIVER_STATUS_REQUEST_FIELDS,
        })
        .create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status,
            note: note || undefined,
            timestamp,
            userRef: session._id,
            userName: session.name,
        });

    if (linkedVoucherPatch) {
        transaction.patch(linkedVoucherPatch._id, {
            ifRevisionID: linkedVoucherPatch._rev,
            set: {
                driverFeeAmount: linkedVoucherPatch.driverFeeAmount,
                totalClaimAmount: linkedVoucherPatch.totalClaimAmount,
            },
        });
    }

    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (orderItemRef) {
            const orderItem = await sanityGetById<OrderItemProgressSnapshot>(orderItemRef);
            if (!orderItem) {
                continue;
            }

            const progress = getOrderItemProgress(orderItem);
            const usesDeliveryOrderOwnedTarget =
                orderItem.entrySource === 'DELIVERY_ORDER' &&
                extractRefId(orderItem.sourceDeliveryOrderRef) === id;
            const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
            const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
            const plannedVolume = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);

            if (status === 'HEADING_TO_PICKUP' || status === 'ON_DELIVERY' || status === 'ARRIVED') {
                transaction.patch(orderItemRef, { set: { status: 'ON_DELIVERY' } });
                continue;
            }

            if (status === 'DELIVERED') {
                const actualCargo = actualCargoByDoItemId.get(item._id);
                if (!actualCargo) {
                    return NextResponse.json({ error: 'Muatan aktual surat jalan tidak lengkap' }, { status: 400 });
                }
                const requireQty = progress.totalQtyKoli > 0;
                if (requireQty) {
                    if (!Number.isFinite(actualCargo.actualQtyKoli) || actualCargo.actualQtyKoli <= 0) {
                        return NextResponse.json(
                            { error: `Qty aktual untuk ${orderItem.description || 'item order'} harus lebih besar dari 0` },
                            { status: 400 }
                        );
                    }
                    const otherReservedQtyKoli = roundQuantity(
                        Math.max(progress.deliveredQtyKoli + progress.assignedQtyKoli + progress.heldQtyKoli - plannedQtyKoli, 0)
                    );
                    const maxActualQtyKoli = roundQuantity(Math.max(progress.totalQtyKoli - otherReservedQtyKoli, 0));
                    if (!usesDeliveryOrderOwnedTarget && actualCargo.actualQtyKoli > maxActualQtyKoli) {
                        return NextResponse.json(
                            {
                                error: `Qty aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualQtyKoli} koli). Revisi order/resi dulu jika total barang fisik memang bertambah.`,
                            },
                            { status: 409 }
                        );
                    }
                }
                if (!Number.isFinite(actualCargo.actualWeightKg) || actualCargo.actualWeightKg < 0) {
                    return NextResponse.json(
                        { error: `Berat aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                        { status: 400 }
                    );
                }
                if ((plannedWeight > 0 || normalizeNumber(item.orderItemWeight ?? 0) > 0) && actualCargo.actualWeightKg <= 0) {
                    return NextResponse.json(
                        { error: `Berat aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                        { status: 400 }
                    );
                }
                if (actualCargo.actualVolumeM3 !== undefined && (!Number.isFinite(actualCargo.actualVolumeM3) || actualCargo.actualVolumeM3 < 0)) {
                    return NextResponse.json(
                        { error: `Volume aktual untuk ${orderItem.description || 'item order'} tidak valid` },
                        { status: 400 }
                    );
                }
                if ((plannedVolume > 0 || normalizeNumber(item.orderItemVolumeM3 ?? 0) > 0) && normalizeNumber(actualCargo.actualVolumeM3 ?? 0) <= 0) {
                    return NextResponse.json(
                        { error: `Volume aktual untuk ${orderItem.description || 'item order'} wajib diisi` },
                        { status: 400 }
                    );
                }

                const actualQtyKoli = requireQty ? actualCargo.actualQtyKoli : 0;
                const actualWeight = roundQuantity(actualCargo.actualWeightKg);
                const actualVolume = roundQuantity(normalizeNumber(actualCargo.actualVolumeM3 ?? 0), 3);
                const otherReservedWeight = roundQuantity(
                    Math.max(progress.deliveredWeight + progress.assignedWeight + progress.heldWeight - plannedWeight, 0)
                );
                if (!usesDeliveryOrderOwnedTarget && progress.totalWeight > 0) {
                    const maxActualWeight = roundQuantity(Math.max(progress.totalWeight - otherReservedWeight, 0));
                    if (actualWeight - maxActualWeight > 0.00001) {
                        return NextResponse.json(
                            {
                                error: `Berat aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualWeight} kg). Revisi target berat order/resi dulu jika total muatan fisik memang bertambah.`,
                            },
                            { status: 409 }
                        );
                    }
                }
                const otherReservedVolume = roundQuantity(
                    Math.max(progress.deliveredVolume + progress.assignedVolume + progress.heldVolume - plannedVolume, 0),
                    3
                );
                if (!usesDeliveryOrderOwnedTarget && progress.totalVolume > 0) {
                    const maxActualVolume = roundQuantity(Math.max(progress.totalVolume - otherReservedVolume, 0), 3);
                    if (actualVolume - maxActualVolume > 0.00001) {
                        return NextResponse.json(
                            {
                                error: `Volume aktual untuk ${orderItem.description || 'item order'} melebihi sisa target order/resi (${maxActualVolume} m3). Revisi target volume order/resi dulu jika total muatan fisik memang bertambah.`,
                            },
                            { status: 409 }
                        );
                    }
                }
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                    deliveredQtyKoli: roundQuantity(progress.deliveredQtyKoli + actualQtyKoli),
                    deliveredWeight: roundQuantity(progress.deliveredWeight + actualWeight),
                    deliveredVolume: roundQuantity(progress.deliveredVolume + actualVolume, 3),
                };
                const orderItemPatch: {
                    set: Record<string, unknown>;
                    unset?: string[];
                } = {
                    set: {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        assignedVolume: nextProgress.assignedVolume,
                        deliveredQtyKoli: nextProgress.deliveredQtyKoli,
                        deliveredWeight: nextProgress.deliveredWeight,
                        deliveredVolume: nextProgress.deliveredVolume,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                };
                if (usesDeliveryOrderOwnedTarget) {
                    if (requireQty) {
                        orderItemPatch.set.qtyKoli = actualQtyKoli;
                    }
                    orderItemPatch.set.weight = actualWeight;
                    orderItemPatch.set.weightInputValue = actualCargo.actualWeightInputValue;
                    orderItemPatch.set.weightInputUnit = actualCargo.actualWeightInputUnit;
                    if (actualVolume > 0) {
                        orderItemPatch.set.volume = actualVolume;
                        orderItemPatch.set.volumeInputValue = actualCargo.actualVolumeInputValue;
                        orderItemPatch.set.volumeInputUnit = actualCargo.actualVolumeInputUnit;
                    } else {
                        orderItemPatch.unset = ['volume', 'volumeInputValue', 'volumeInputUnit'];
                    }
                }
                transaction.patch(orderItemRef, orderItemPatch);
                transaction.patch(item._id, {
                    set: {
                        actualQtyKoli: requireQty ? actualCargo.actualQtyKoli : undefined,
                        actualWeightKg: actualWeight,
                        actualVolumeM3: actualVolume > 0 ? actualVolume : undefined,
                        actualWeightInputValue: actualCargo.actualWeightInputValue,
                        actualWeightInputUnit: actualCargo.actualWeightInputUnit,
                        actualVolumeInputValue: actualCargo.actualVolumeInputValue,
                        actualVolumeInputUnit: actualCargo.actualVolumeInputUnit,
                    },
                });
                continue;
            }

            if (status === 'CANCELLED') {
                const nextProgress = {
                    ...progress,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    assignedVolume: roundQuantity(Math.max(progress.assignedVolume - plannedVolume, 0), 3),
                };
                transaction.patch(orderItemRef, {
                    set: {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        assignedVolume: nextProgress.assignedVolume,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                });
            }
        }
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Status surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    if (shouldStopTracking) {
        try {
            await releaseDriverTrackingLockIfOwned(deliveryOrder.driverRef, id, timestamp);
        } catch (error) {
            console.warn('Failed to release driver tracking lock from DO status update', error);
        }
    }

    const orderRef = extractRefId(deliveryOrder.orderRef);
    if (orderRef) {
        await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `DO status ${deliveryOrder.doNumber || id}: ${deliveryOrder.status || '-'} -> ${status}${status === 'DELIVERED'
            ? ` (muatan aktual difinalisasi ${doItems.length} item, ${actualDropPoints?.length || 0} titik drop${overtonageResult?.actualTotalWeightKg ? `, berat final ${overtonageResult.actualTotalWeightKg} kg` : ''}${overtonageResult?.overtonaseWeightKg ? `, overtonase ${overtonageResult.overtonaseWeightKg} kg + ${overtonageResult.overtonaseDriverAmount || 0}` : ''}${overtonageResult?.vehicleCapacityExceededKg ? `, melebihi kapasitas kendaraan ${overtonageResult.vehicleCapacityExceededKg} kg` : ''}${linkedVoucherAdjustmentSummary ? `, ${linkedVoucherAdjustmentSummary}` : ''}${settledVoucherOvertonageWarning ? `, ${settledVoucherOvertonageWarning}` : ''})`
            : ''}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            status,
            ...(status === 'DELIVERED'
                ? {
                    podReceiverName,
                    podReceivedDate,
                    podNote,
                    baseTaripBorongan: normalizeCurrencyNumber(deliveryOrder.baseTaripBorongan ?? deliveryOrder.taripBorongan ?? 0) || undefined,
                    taripBorongan: overtonageResult?.effectiveTripFee || normalizeCurrencyNumber(deliveryOrder.taripBorongan ?? 0) || undefined,
                    actualTotalWeightKg: overtonageResult?.actualTotalWeightKg || undefined,
                    serviceMaxPayloadKg: overtonageResult?.serviceMaxPayloadKg,
                    vehicleCapacityKg: overtonageResult?.vehicleCapacityKg,
                    overtonaseWeightKg: overtonageResult?.overtonaseWeightKg,
                    overtonaseDriverRatePerKg: overtonageResult?.overtonaseDriverRatePerKg,
                    overtonaseDriverAmount: overtonageResult?.overtonaseDriverAmount,
                    vehicleCapacityExceededKg: overtonageResult?.vehicleCapacityExceededKg,
                    pendingDriverStatus: undefined,
                    pendingDriverStatusRequestedAt: undefined,
                    pendingDriverStatusRequestedBy: undefined,
                    pendingDriverStatusRequestedByName: undefined,
                    pendingDriverStatusNote: undefined,
                    pendingDriverActualCargoItems: undefined,
                    cargoFinalizedAt: timestamp,
                    cargoFinalizedBy: session._id,
                    cargoFinalizedByName: session.name,
                    actualDropPoints,
                }
                : {}),
            ...(status !== 'DELIVERED'
                ? {
                    pendingDriverStatus: undefined,
                    pendingDriverStatusRequestedAt: undefined,
                    pendingDriverStatusRequestedBy: undefined,
                    pendingDriverStatusRequestedByName: undefined,
                    pendingDriverStatusNote: undefined,
                    pendingDriverActualCargoItems: undefined,
                }
                : {}),
            trackingState: shouldStopTracking ? 'STOPPED' : deliveryOrder.trackingState,
            trackingStoppedAt: shouldStopTracking ? timestamp : undefined,
        },
    });
}

export async function handleDeliveryOrderDriverStatusRequest(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const status = typeof data.status === 'string' ? data.status : '';
    const note = normalizeOptionalText(data.note);
    if (!id || !status) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid' }, { status: 400 });
    }
    if (!DRIVER_APPROVAL_REQUESTABLE_DO_STATUSES.has(status)) {
        return NextResponse.json({ error: 'Status ini tidak memakai approval admin dari driver app' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        driverRef?: unknown;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid untuk kondisi DO saat ini' }, { status: 409 });
    }

    if (deliveryOrder.pendingDriverStatus) {
        if (deliveryOrder.pendingDriverStatus === status) {
            return NextResponse.json(
                { error: `Permintaan ${status} untuk DO ${deliveryOrder.doNumber || id} sudah menunggu approval admin.` },
                { status: 409 }
            );
        }
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || id} masih punya permintaan status ${deliveryOrder.pendingDriverStatus} yang belum diputuskan admin.` },
            { status: 409 }
        );
    }

    const doItems = await getSanityClient().fetch<Array<{
        _id: string;
        orderItemRef?: unknown;
        shippedQtyKoli?: number;
        shippedWeight?: number;
        orderItemQtyKoli?: number;
        orderItemWeight?: number;
        orderItemVolumeM3?: number;
        orderItemWeightInputValue?: number;
        orderItemWeightInputUnit?: WeightInputUnit;
        orderItemVolumeInputValue?: number;
        orderItemVolumeInputUnit?: VolumeInputUnit;
        actualQtyKoli?: number;
        actualWeightKg?: number;
        actualVolumeM3?: number;
        actualWeightInputValue?: number;
        actualWeightInputUnit?: WeightInputUnit;
        actualVolumeInputValue?: number;
        actualVolumeInputUnit?: VolumeInputUnit;
    }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{
            _id,
            orderItemRef,
            shippedQtyKoli,
            shippedWeight,
            orderItemQtyKoli,
            orderItemWeight,
            orderItemVolumeM3,
            orderItemWeightInputValue,
            orderItemWeightInputUnit,
            orderItemVolumeInputValue,
            orderItemVolumeInputUnit,
            actualQtyKoli,
            actualWeightKg,
            actualVolumeM3,
            actualWeightInputValue,
            actualWeightInputUnit,
            actualVolumeInputValue,
            actualVolumeInputUnit
        }`,
        { ref: id }
    );
    if (doItems.length === 0) {
        return NextResponse.json(
            { error: 'Surat jalan ini belum punya item muatan. Minta admin isi barang dulu sebelum driver mengajukan selesai.' },
            { status: 400 }
        );
    }
    const explicitActualItemRefs = new Set(
        (Array.isArray(data.actualItems) ? data.actualItems : [])
            .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
            .map(item => normalizeText(item.deliveryOrderItemRef))
            .filter(Boolean)
    );
    const missingExplicitActualItem = doItems.find(item => !explicitActualItemRefs.has(item._id));
    if (missingExplicitActualItem) {
        return NextResponse.json(
            {
                error: `Driver harus mengisi seluruh muatan aktual sebelum mengajukan selesai. Item ${missingExplicitActualItem._id} belum diisi.`,
            },
            { status: 400 }
        );
    }
    let pendingDriverActualCargoItems: Array<{
        deliveryOrderItemRef: string;
        actualQtyKoli?: number;
        actualWeightInputValue?: number;
        actualWeightInputUnit?: WeightInputUnit;
        actualVolumeInputValue?: number;
        actualVolumeInputUnit?: VolumeInputUnit;
    }> = [];
    try {
        const actualCargoByDoItemId = normalizeDeliveryOrderActualCargoInputs(data, doItems);
        pendingDriverActualCargoItems = Array.from(actualCargoByDoItemId.values()).map(item => ({
            deliveryOrderItemRef: item.deliveryOrderItemRef,
            actualQtyKoli: item.actualQtyKoli > 0 ? item.actualQtyKoli : undefined,
            actualWeightInputValue: item.actualWeightInputValue,
            actualWeightInputUnit: item.actualWeightInputUnit,
            actualVolumeInputValue: item.actualVolumeInputValue,
            actualVolumeInputUnit: item.actualVolumeInputUnit,
        }));
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Muatan aktual draft driver tidak valid' },
            { status: 400 }
        );
    }

    const timestamp = new Date().toISOString();
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                pendingDriverStatus: status,
                pendingDriverStatusRequestedAt: timestamp,
                pendingDriverStatusRequestedBy: session._id,
                pendingDriverStatusRequestedByName: session.name,
                pendingDriverStatusNote: note,
                pendingDriverActualCargoItems,
            },
        })
        .create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status: buildDriverRequestedTrackingStatus(status),
            note: note || undefined,
            timestamp,
            userRef: session._id,
            userName: session.name,
        });

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Permintaan driver berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Driver mengajukan status ${status} untuk DO ${deliveryOrder.doNumber || id} (${pendingDriverActualCargoItems.length} item aktual draft)${note ? `: ${note}` : ''}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            pendingDriverStatus: status,
            pendingDriverStatusRequestedAt: timestamp,
            pendingDriverStatusRequestedBy: session._id,
            pendingDriverStatusRequestedByName: session.name,
            pendingDriverStatusNote: note,
            pendingDriverActualCargoItems,
        },
    });
}

export async function handleDeliveryOrderDriverStatusRequestReject(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const note = normalizeOptionalText(data.note);
    if (!id) {
        return NextResponse.json({ error: 'Permintaan status driver tidak valid' }, { status: 400 });
    }
    if (!note) {
        return NextResponse.json({ error: 'Alasan penolakan wajib diisi' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        pendingDriverStatus?: string;
        pendingDriverStatusRequestedAt?: string;
        pendingDriverStatusRequestedBy?: string;
        pendingDriverStatusRequestedByName?: string;
        pendingDriverStatusNote?: string;
        pendingDriverActualCargoItems?: Array<{
            deliveryOrderItemRef?: string;
            actualQtyKoli?: number;
            actualWeightInputValue?: number;
            actualWeightInputUnit?: WeightInputUnit;
            actualVolumeInputValue?: number;
            actualVolumeInputUnit?: VolumeInputUnit;
        }>;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }
    if (!deliveryOrder.pendingDriverStatus) {
        return NextResponse.json({ error: 'Tidak ada permintaan status driver yang menunggu approval' }, { status: 409 });
    }

    const timestamp = new Date().toISOString();
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            ifRevisionID: deliveryOrder._rev,
            unset: DRIVER_STATUS_REQUEST_FIELDS,
        })
        .create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status: 'DRIVER_REQUEST_REJECTED',
            note: `${deliveryOrder.pendingDriverStatus}${note ? `: ${note}` : ''}`,
            timestamp,
            userRef: session._id,
            userName: session.name,
        });

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Permintaan driver berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Permintaan driver ${deliveryOrder.pendingDriverStatus} untuk DO ${deliveryOrder.doNumber || id} ditolak: ${note}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            pendingDriverStatus: undefined,
            pendingDriverStatusRequestedAt: undefined,
            pendingDriverStatusRequestedBy: undefined,
            pendingDriverStatusRequestedByName: undefined,
            pendingDriverStatusNote: undefined,
            pendingDriverActualCargoItems: undefined,
        },
    });
}

export async function handleDeliveryOrderCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const orderRef = typeof data.orderRef === 'string' ? data.orderRef : '';
    if (!orderRef) {
        return NextResponse.json({ error: 'Order surat jalan wajib diisi' }, { status: 400 });
    }

    const order = await sanityGetById<{
        _id: string;
        _rev?: string;
        masterResi?: string;
        cargoEntryMode?: 'ORDER' | 'DELIVERY_ORDER';
        customerRef?: string;
        customerName?: string;
        receiverName?: string;
        receiverPhone?: string;
        receiverAddress?: string;
        receiverCompany?: string;
        pickupAddress?: string;
        serviceRef?: string;
        serviceName?: string;
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const orderCustomerRef = extractRefId(order.customerRef);
    const customer = orderCustomerRef
        ? await sanityGetById<{
            _id: string;
            _rev?: string;
            name?: string;
            active?: boolean;
            deliveryOrderPrefix?: string;
            deliveryOrderCounter?: number;
            deliveryOrderPeriod?: string;
        }>(orderCustomerRef)
        : null;
    if (orderCustomerRef && !customer) {
        return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
    }

    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    let vehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : '';
    let vehicleCapacityKg = 0;
    const vehicleCategoryOverrideReason = normalizeOptionalText(data.vehicleCategoryOverrideReason);
    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    let driverName =
        typeof data.driverName === 'string' && data.driverName.trim()
            ? data.driverName.trim()
            : '';
    let vehicleServiceRef: string | undefined;
    let vehicleServiceName: string | undefined;
    let vehicleCategoryOverrideReasonToStore: string | undefined;

    if (vehicleRef) {
        const vehicle = await sanityGetById<{
            _id: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
            capacityKg?: number;
        }>(vehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan DO tidak ditemukan' }, { status: 404 });
        }
        if (vehicle.status === 'SOLD') {
            return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        if (vehicle.status === 'OUT_OF_SERVICE') {
            return NextResponse.json({ error: 'Kendaraan yang sedang out of service tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        vehicleCapacityKg = normalizeNumber(vehicle.capacityKg ?? 0);
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: vehicleRef,
                plate: (vehicle.plateNumber || vehiclePlate || '').toLowerCase(),
            }
        );
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} masih dipakai di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        const orderServiceRef = extractRefId(order.serviceRef);
        vehicleServiceRef = extractRefId(vehicle.serviceRef) || undefined;
        vehicleServiceName = vehicle.serviceName || undefined;
        if (orderServiceRef && !vehicleServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} belum punya kategori armada yang cocok. Isi alasan override jika trip ini memang harus jalan dengan armada berbeda.`,
                },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} berkategori ${vehicle.serviceName || '-'} tidak sama dengan armada order ${order.serviceName || '-'}. Isi alasan override bila trip parsial ini memang memakai armada lain.`,
                },
                { status: 400 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef) {
            vehicleCategoryOverrideReasonToStore = vehicleCategoryOverrideReason || undefined;
        }
        vehiclePlate = vehicle.plateNumber || vehiclePlate;
    }
    if (driverRef) {
        const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                ref: driverRef,
                driverName: (driver.name || driverName || '').toLowerCase(),
            }
        );
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Supir ${driver.name || driverRef} masih terikat di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        driverName = driver.name || driverName;
    }

    const doDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    try {
        assertIsoDate(doDate, 'Tanggal surat jalan');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal surat jalan tidak valid' },
            { status: 400 }
        );
    }
    const manualCustomerDoNumber = normalizeOptionalText(data.customerDoNumber)?.toUpperCase();
    const taripBorongan = normalizeCurrencyNumber(data.taripBorongan ?? 0);
    if (!Number.isFinite(taripBorongan) || taripBorongan < 0) {
        return NextResponse.json({ error: 'Upah trip pada surat jalan tidak valid' }, { status: 400 });
    }
    let tripRouteSelection: Awaited<ReturnType<typeof resolveTripRouteRateSelection>>;
    try {
        tripRouteSelection = await resolveTripRouteRateSelection(data, {
            serviceRef: order.serviceRef,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Master biaya rute trip tidak valid' },
            { status: 400 }
        );
    }
    const matchedTripRouteRateFee = normalizeCurrencyNumber(tripRouteSelection?.matchedTripRouteRate?.rate ?? 0);
    if (
        matchedTripRouteRateFee > 0 &&
        taripBorongan > 0 &&
        Math.abs(taripBorongan - matchedTripRouteRateFee) > 0.01
    ) {
        return NextResponse.json(
            { error: 'Upah trip mengikuti master biaya rute trip yang dipilih. Ubah area trip jika ingin memakai master yang berbeda.' },
            { status: 409 }
        );
    }
    const customerDoPrefix = normalizeCustomerDoPrefix(customer?.deliveryOrderPrefix);
    const customerDoNumber = manualCustomerDoNumber || undefined;
    const effectiveTripFee =
        matchedTripRouteRateFee > 0
            ? matchedTripRouteRateFee
            : taripBorongan;

    if (customerDoNumber && orderCustomerRef) {
        const duplicateCustomerDoNumber = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrder" &&
                customerRef == $customerRef &&
                lower(coalesce(customerDoNumber, "")) == $customerDoNumber
            ][0]{ _id }`,
            {
                customerRef: orderCustomerRef,
                customerDoNumber: customerDoNumber.toLowerCase(),
            }
        );

        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${customerDoNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    const existingOrderItemCount = await getSanityClient().fetch<number>(
        `count(*[_type == "orderItem" && orderRef == $ref])`,
        { ref: orderRef }
    );
    const orderItemCargoModeHints =
        !order.cargoEntryMode && existingOrderItemCount > 0
            ? await getSanityClient().fetch<Array<{
                _createdAt?: string;
                entrySource?: 'ORDER' | 'DELIVERY_ORDER';
                sourceDeliveryOrderRef?: string;
            }>>(
                `*[_type == "orderItem" && orderRef == $ref]{
                    _createdAt,
                    entrySource,
                    sourceDeliveryOrderRef
                }`,
                { ref: orderRef }
            )
            : [];
    const resolvedCargoEntryMode = resolveOrderCargoEntryMode(order, orderItemCargoModeHints);
    const requestedItemIds = Array.from(new Set([
        ...(Array.isArray(data.itemRefs) ? data.itemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0) : []),
        ...(Array.isArray(data.items)
            ? data.items
                .filter(isPlainObject)
                .map(item => normalizeText(item.orderItemRef))
                .filter(Boolean)
            : []),
    ]));
    const usingDirectCargoInput = requestedItemIds.length === 0;
    const allowsDirectCargoInput = resolvedCargoEntryMode === 'DELIVERY_ORDER' || existingOrderItemCount === 0;
    let selectedItems: Array<OrderItemProgressSnapshot & { _rev?: string }> = [];
    let normalizedSelections: ReturnType<typeof normalizeDeliveryOrderSelections> = [];
    let selectionByItemId = new Map<string, ReturnType<typeof normalizeDeliveryOrderSelections>[number]>();
    let directCargoItems: NormalizedOrderItemInput[] = [];
    const selectionSummaries: string[] = [];
    let plannedShipmentWeightKgTotal = 0;

    if (usingDirectCargoInput) {
        if (!allowsDirectCargoInput) {
            return NextResponse.json(
                { error: 'Order ini sudah punya item target. Pilih item order yang mau dimasukkan ke surat jalan.' },
                { status: 409 }
            );
        }
        try {
            directCargoItems = await normalizeOrderItemsInput(
                orderCustomerRef || normalizeText(order.customerRef),
                Array.isArray(data.cargoItems) ? data.cargoItems : [],
                { allowEmpty: false }
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Barang surat jalan tidak valid';
            return NextResponse.json({ error: message }, { status: 400 });
        }
        const plannedWeightKg = roundQuantity(
            directCargoItems.reduce((sum, item) => sum + normalizeNumber(item.weight || 0), 0)
        );
        plannedShipmentWeightKgTotal = plannedWeightKg;
        if (vehicleCapacityKg > 0 && plannedShipmentWeightKgTotal - vehicleCapacityKg > 0.00001) {
            return NextResponse.json(
                {
                    error: `Muatan rencana ${plannedShipmentWeightKgTotal} kg melebihi kapasitas kendaraan ${vehicleCapacityKg} kg.`,
                },
                { status: 409 }
            );
        }
        for (const item of directCargoItems) {
            selectionSummaries.push(
                summarizeSelection({
                    orderItemRef: item.description,
                    qtyKoli: item.qtyKoli,
                    weightInputValue: item.weightInputValue,
                    weightInputUnit: item.weightInputUnit,
                    volumeInputValue: item.volumeInputValue,
                    volumeInputUnit: item.volumeInputUnit,
                    holdRemaining: false,
                }, item.description)
            );
        }
    } else if (resolvedCargoEntryMode === 'DELIVERY_ORDER') {
        return NextResponse.json(
            { error: 'Order ini memakai flow barang di Surat Jalan. Barang baru harus diinput langsung saat membuat Surat Jalan.' },
            { status: 409 }
        );
    } else {
        selectedItems = await getSanityClient().fetch<Array<OrderItemProgressSnapshot & { _rev?: string }>>(
            `*[_type == "orderItem" && _id in $ids]{
                _id,
                _rev,
                orderRef,
                description,
                qtyKoli,
                weight,
                volume,
                weightInputValue,
                weightInputUnit,
                volumeInputValue,
                volumeInputUnit,
                status,
                deliveredQtyKoli,
                deliveredWeight,
                deliveredVolume,
                assignedQtyKoli,
                assignedWeight,
                assignedVolume,
                heldQtyKoli,
                heldWeight,
                heldVolume,
                holdReason,
                holdLocation
            }`,
            { ids: requestedItemIds }
        );
        if (selectedItems.length !== requestedItemIds.length) {
            return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
        }
        if (selectedItems.some(item => !item._rev)) {
            return NextResponse.json({ error: 'Revisi item order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }

        try {
            normalizedSelections = normalizeDeliveryOrderSelections(data, selectedItems);
        } catch (error) {
            return NextResponse.json(
                { error: error instanceof Error ? error.message : 'Item surat jalan tidak valid' },
                { status: 400 }
            );
        }
        if (normalizedSelections.length === 0) {
            return NextResponse.json({ error: 'Pilih minimal 1 item untuk surat jalan' }, { status: 400 });
        }

        const duplicateSelection = normalizedSelections.find(
            (selection, index) => normalizedSelections.findIndex(candidate => candidate.orderItemRef === selection.orderItemRef) !== index
        );
        if (duplicateSelection) {
            return NextResponse.json({ error: 'Item surat jalan tidak boleh dipilih dua kali' }, { status: 400 });
        }

        selectionByItemId = new Map(normalizedSelections.map(selection => [selection.orderItemRef, selection]));

        for (const item of selectedItems) {
            const selection = selectionByItemId.get(item._id);
            if (!selection) {
                continue;
            }
            if (extractRefId(item.orderRef) !== orderRef) {
                return NextResponse.json({ error: 'Ada item yang bukan milik order ini' }, { status: 400 });
            }

            const progress = getOrderItemProgress(item);
            const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
                `*[
                    _type == "deliveryOrderItem" &&
                    orderItemRef == $orderItemRef &&
                    defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"]][0]._id)
                ][0]{ _id }`,
                { orderItemRef: item._id }
            );
            if (activeAssignment) {
                return NextResponse.json({ error: 'Ada item yang sudah terikat ke surat jalan aktif lain' }, { status: 409 });
            }

            if (progress.totalQtyKoli > 0) {
                if (!Number.isFinite(selection.qtyKoli) || selection.qtyKoli <= 0) {
                    return NextResponse.json({ error: 'Jumlah koli kirim harus lebih besar dari 0' }, { status: 400 });
                }
                if (selection.qtyKoli > progress.pendingQtyKoli) {
                    return NextResponse.json({ error: `Jumlah koli kirim untuk ${item.description || 'item order'} melebihi sisa qty yang siap dikirim` }, { status: 409 });
                }

                const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - selection.qtyKoli, 0));
                if (selection.holdRemaining) {
                    if (remainingQtyAfterShipment <= 0) {
                        return NextResponse.json({ error: `Tidak ada sisa qty ${item.description || 'item order'} yang bisa ditahan` }, { status: 409 });
                    }
                    if (!selection.holdReason) {
                        return NextResponse.json({ error: `Alasan hold wajib diisi untuk sisa qty ${item.description || 'item order'}` }, { status: 400 });
                    }
                }

                plannedShipmentWeightKgTotal = roundQuantity(
                    plannedShipmentWeightKgTotal +
                    calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, selection.qtyKoli)
                );
                selectionSummaries.push(summarizeSelection(selection, item.description));
                continue;
            }

            if (progress.pendingWeight <= 0 && progress.pendingVolume <= 0) {
                return NextResponse.json({ error: `Tidak ada sisa berat/volume ${item.description || 'item order'} yang siap dikirim` }, { status: 409 });
            }
            if (selection.qtyKoli > 0) {
                return NextResponse.json(
                    { error: `Item ${item.description || 'item order'} tidak memakai basis koli. Centang item untuk mengirim seluruh sisa berat/volume.` },
                    { status: 400 }
                );
            }
            const selectedWeightInputValue = normalizeNumber(selection.weightInputValue ?? 0, {
                maxFractionDigits: selection.weightInputUnit === 'TON' ? 3 : 2,
            });
            const selectedVolumeInputValue = normalizeNumber(selection.volumeInputValue ?? 0, {
                maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
            });
            const selectedWeightKg = selectedWeightInputValue > 0 && selection.weightInputUnit
                ? roundQuantity(convertWeightToKg(selectedWeightInputValue, selection.weightInputUnit))
                : 0;
            const selectedVolumeM3 = selectedVolumeInputValue > 0 && selection.volumeInputUnit
                ? roundQuantity(convertVolumeToM3(selectedVolumeInputValue, selection.volumeInputUnit), 3)
                : 0;
            if (progress.pendingWeight > 0 && selectedWeightKg <= 0) {
                return NextResponse.json({ error: `Berat kirim untuk ${item.description || 'item order'} wajib diisi` }, { status: 400 });
            }
            if (progress.pendingVolume > 0 && selectedVolumeM3 <= 0) {
                return NextResponse.json({ error: `Volume kirim untuk ${item.description || 'item order'} wajib diisi` }, { status: 400 });
            }
            if (selectedWeightKg <= 0 && selectedVolumeM3 <= 0) {
                return NextResponse.json({ error: `Muatan kirim untuk ${item.description || 'item order'} tidak valid` }, { status: 400 });
            }
            if (selectedWeightKg - progress.pendingWeight > 0.00001) {
                return NextResponse.json({ error: `Berat kirim untuk ${item.description || 'item order'} melebihi sisa berat yang siap dikirim` }, { status: 409 });
            }
            if (selectedVolumeM3 - progress.pendingVolume > 0.00001) {
                return NextResponse.json({ error: `Volume kirim untuk ${item.description || 'item order'} melebihi sisa volume yang siap dikirim` }, { status: 409 });
            }
            const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - selectedWeightKg, 0));
            const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - selectedVolumeM3, 0), 3);
            if (selection.holdRemaining) {
                if (remainingWeightAfterShipment <= 0 && remainingVolumeAfterShipment <= 0) {
                    return NextResponse.json({ error: `Tidak ada sisa muatan ${item.description || 'item order'} yang bisa ditahan` }, { status: 409 });
                }
                if (!selection.holdReason) {
                    return NextResponse.json({ error: `Alasan hold wajib diisi untuk sisa muatan ${item.description || 'item order'}` }, { status: 400 });
                }
            }

            plannedShipmentWeightKgTotal = roundQuantity(plannedShipmentWeightKgTotal + selectedWeightKg);
            selectionSummaries.push(summarizeSelection(selection, item.description));
        }

        if (vehicleCapacityKg > 0 && plannedShipmentWeightKgTotal - vehicleCapacityKg > 0.00001) {
            return NextResponse.json(
                {
                    error: `Muatan rencana ${plannedShipmentWeightKgTotal} kg melebihi kapasitas kendaraan ${vehicleCapacityKg} kg.`,
                },
                { status: 409 }
            );
        }
    }

    const doId = crypto.randomUUID();
    const doNumber = await sanityGetNextNumber('do', doDate);
    const companyProfile = await getSanityClient().fetch<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'> | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl
        }`
    );
    const doDoc = {
        _id: doId,
        _type: 'deliveryOrder',
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
        orderRef,
        masterResi: order.masterResi,
        customerRef: orderCustomerRef || undefined,
        customerName: order.customerName,
        customerDoPrefix,
        customerDoNumber,
        receiverName: order.receiverName,
        receiverPhone: order.receiverPhone,
        receiverAddress: order.receiverAddress,
        receiverCompany: order.receiverCompany,
        pickupAddress: order.pickupAddress,
        serviceRef: order.serviceRef,
        serviceName: order.serviceName,
        vehicleServiceRef,
        vehicleServiceName,
        vehicleCategoryOverrideReason: vehicleCategoryOverrideReasonToStore,
        vehicleRef: vehicleRef || undefined,
        vehiclePlate: vehiclePlate || undefined,
        driverRef: driverRef || undefined,
        driverName: driverName || undefined,
        tripRouteRateRef: tripRouteSelection?.tripRouteRateRef,
        tripOriginArea: tripRouteSelection?.tripOriginArea,
        tripDestinationArea: tripRouteSelection?.tripDestinationArea,
        baseTaripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        taripBorongan: effectiveTripFee > 0 ? effectiveTripFee : undefined,
        date: doDate,
        notes: normalizeOptionalText(data.notes),
        doNumber,
        status: 'CREATED',
    };

    const transaction = getSanityClient().transaction().create(doDoc);
    if (usingDirectCargoInput) {
        if (order.cargoEntryMode !== 'DELIVERY_ORDER') {
            if (!order._rev) {
                return NextResponse.json({ error: 'Revisi order tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
            }
            transaction.patch(orderRef, {
                ifRevisionID: order._rev,
                set: {
                    cargoEntryMode: 'DELIVERY_ORDER',
                },
            });
        }
        for (const item of directCargoItems) {
            const orderItemId = crypto.randomUUID();
            const usesQtyBasis = item.qtyKoli > 0;
            transaction.create({
                ...buildOrderItemDraftDocument(orderRef, item, orderItemId, {
                    entrySource: 'DELIVERY_ORDER',
                    sourceDeliveryOrderRef: doId,
                    sourceDeliveryOrderNumber: doNumber,
                }),
                assignedQtyKoli: usesQtyBasis ? item.qtyKoli : 0,
                assignedWeight: item.weight,
                assignedVolume: item.volume || 0,
                status: 'ASSIGNED',
            });
            transaction.create({
                _id: crypto.randomUUID(),
                _type: 'deliveryOrderItem',
                deliveryOrderRef: doId,
                orderItemRef: orderItemId,
                orderItemDescription: item.description,
                orderItemQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                orderItemWeight: item.weight,
                orderItemVolumeM3: item.volume,
                orderItemWeightInputValue: item.weightInputValue,
                orderItemWeightInputUnit: item.weightInputUnit,
                orderItemVolumeInputValue: item.volumeInputValue,
                orderItemVolumeInputUnit: item.volumeInputUnit,
                shippedQtyKoli: usesQtyBasis ? item.qtyKoli : undefined,
                shippedWeight: item.weight,
            });
        }
    }
    for (const item of selectedItems) {
        const selection = selectionByItemId.get(item._id);
        if (!selection) {
            continue;
        }

        const progress = getOrderItemProgress(item);
        const usesQtyBasis = progress.totalQtyKoli > 0;
        const shippedQtyKoli = usesQtyBasis ? roundQuantity(selection.qtyKoli) : 0;
        const selectedWeightInputValue = normalizeNumber(selection.weightInputValue ?? 0, {
            maxFractionDigits: selection.weightInputUnit === 'TON' ? 3 : 2,
        });
        const selectedVolumeInputValue = normalizeNumber(selection.volumeInputValue ?? 0, {
            maxFractionDigits: selection.volumeInputUnit === 'LITER' ? 0 : 3,
        });
        const shippedWeight = usesQtyBasis
            ? calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, shippedQtyKoli)
            : (selectedWeightInputValue > 0 && selection.weightInputUnit
                ? roundQuantity(convertWeightToKg(selectedWeightInputValue, selection.weightInputUnit))
                : 0);
        const shippedVolumeM3 = usesQtyBasis
            ? calculateVolumePortion(normalizeNumber(item.volume ?? 0), progress.totalQtyKoli, shippedQtyKoli)
            : (selectedVolumeInputValue > 0 && selection.volumeInputUnit
                ? roundQuantity(convertVolumeToM3(selectedVolumeInputValue, selection.volumeInputUnit), 3)
                : 0);
        const shippedWeightInputValue =
            usesQtyBasis && item.weightInputValue && item.weightInputUnit
                ? roundQuantity(convertKgToWeightInputValue(shippedWeight, item.weightInputUnit), item.weightInputUnit === 'TON' ? 3 : 2)
                : !usesQtyBasis && selection.weightInputValue && selection.weightInputUnit
                    ? roundQuantity(selection.weightInputValue, selection.weightInputUnit === 'TON' ? 3 : 2)
                : undefined;
        const shippedWeightInputUnit =
            shippedWeightInputValue !== undefined
                ? (usesQtyBasis ? item.weightInputUnit : selection.weightInputUnit)
                : undefined;
        const shippedVolumeInputValue =
            usesQtyBasis && item.volumeInputValue && item.volumeInputUnit
                ? roundQuantity(convertM3ToVolumeInputValue(shippedVolumeM3, item.volumeInputUnit), item.volumeInputUnit === 'LITER' ? 0 : 3)
                : !usesQtyBasis && selection.volumeInputValue && selection.volumeInputUnit
                    ? roundQuantity(selection.volumeInputValue, selection.volumeInputUnit === 'LITER' ? 0 : 3)
                : undefined;
        const shippedVolumeInputUnit =
            shippedVolumeInputValue !== undefined
                ? (usesQtyBasis ? item.volumeInputUnit : selection.volumeInputUnit)
                : undefined;
        const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli, 0));
        const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - shippedWeight, 0));
        const remainingVolumeAfterShipment = roundQuantity(Math.max(progress.pendingVolume - shippedVolumeM3, 0), 3);
        const holdQtyToApply = selection.holdRemaining ? (usesQtyBasis ? remainingQtyAfterShipment : 0) : 0;
        const holdWeightToApply = selection.holdRemaining ? remainingWeightAfterShipment : 0;
        const holdVolumeToApply = selection.holdRemaining ? remainingVolumeAfterShipment : 0;
        const nextProgress = {
            ...progress,
            assignedQtyKoli: roundQuantity(progress.assignedQtyKoli + shippedQtyKoli),
            assignedWeight: roundQuantity(progress.assignedWeight + shippedWeight),
            assignedVolume: roundQuantity(progress.assignedVolume + shippedVolumeM3, 3),
            heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyToApply),
            heldWeight: roundQuantity(progress.heldWeight + holdWeightToApply),
            heldVolume: roundQuantity(progress.heldVolume + holdVolumeToApply, 3),
            pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli - holdQtyToApply, 0)),
            pendingWeight: roundQuantity(Math.max(progress.pendingWeight - shippedWeight - holdWeightToApply, 0)),
            pendingVolume: roundQuantity(Math.max(progress.pendingVolume - shippedVolumeM3 - holdVolumeToApply, 0), 3),
        };

        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemRef: item._id,
            orderItemDescription: item.description,
            orderItemQtyKoli: usesQtyBasis ? shippedQtyKoli : undefined,
            orderItemWeight: shippedWeight,
            orderItemVolumeM3: shippedVolumeM3 > 0 ? shippedVolumeM3 : undefined,
            orderItemWeightInputValue: shippedWeightInputValue,
            orderItemWeightInputUnit: shippedWeightInputUnit,
            orderItemVolumeInputValue: shippedVolumeInputValue,
            orderItemVolumeInputUnit: shippedVolumeInputUnit,
            shippedQtyKoli: usesQtyBasis ? shippedQtyKoli : undefined,
            shippedWeight,
        });
        transaction.patch(item._id, {
            ifRevisionID: item._rev,
            set: {
                assignedQtyKoli: nextProgress.assignedQtyKoli,
                assignedWeight: nextProgress.assignedWeight,
                assignedVolume: nextProgress.assignedVolume,
                heldQtyKoli: nextProgress.heldQtyKoli,
                heldWeight: nextProgress.heldWeight,
                heldVolume: nextProgress.heldVolume,
                holdReason: selection.holdRemaining ? selection.holdReason : item.holdReason,
                holdLocation: selection.holdRemaining ? selection.holdLocation : item.holdLocation,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            },
        });
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Data order atau item surat jalan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    await addAuditLog(
        session,
        'CREATE',
        'delivery-orders',
        doId,
        `Created delivery-orders: ${doNumber}${customerDoNumber ? ` / ${customerDoNumber}` : ''} (${selectionSummaries.join('; ')})${vehicleCategoryOverrideReasonToStore ? ` | override armada: ${order.serviceName || '-'} -> ${vehicleServiceName || vehiclePlate || '-'} | alasan: ${vehicleCategoryOverrideReasonToStore}` : ''}`
    );
    return NextResponse.json({ data: doDoc, id: doId });
}

export async function handleDeliveryOrderTripResourceAssign(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    const vehicleCategoryOverrideReason = normalizeOptionalText(data.vehicleCategoryOverrideReason);

    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }
    if (!vehicleRef && !driverRef) {
        return NextResponse.json({ error: 'Pilih kendaraan dan/atau supir yang akan dilengkapi' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        customerDoNumber?: string;
        status?: string;
        trackingState?: string;
        serviceRef?: unknown;
        serviceName?: string;
        vehicleRef?: unknown;
        vehiclePlate?: string;
        vehicleServiceRef?: unknown;
        vehicleServiceName?: string;
        vehicleCategoryOverrideReason?: string;
        driverRef?: unknown;
        driverName?: string;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status !== 'CREATED') {
        return NextResponse.json({ error: 'Armada trip hanya bisa dilengkapi saat status surat jalan masih Dibuat' }, { status: 409 });
    }
    if (deliveryOrder.trackingState === 'ACTIVE' || deliveryOrder.trackingState === 'PAUSED') {
        return NextResponse.json({ error: 'Armada trip tidak bisa diubah saat tracking driver masih aktif' }, { status: 409 });
    }

    const relatedVoucher = await getSanityClient().fetch<{ _id: string; bonNumber?: string } | null>(
        `*[_type == "driverVoucher" && deliveryOrderRef == $ref][0]{ _id, bonNumber }`,
        { ref: id }
    );
    if (relatedVoucher) {
        return NextResponse.json(
            { error: `Armada trip tidak boleh diubah karena DO ini sudah punya uang jalan ${relatedVoucher.bonNumber || relatedVoucher._id}` },
            { status: 409 }
        );
    }

    const relatedBoronganItem = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "driverBoronganItem" && doRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedBoronganItem) {
        return NextResponse.json(
            { error: 'Armada trip tidak boleh diubah karena DO ini sudah masuk arsip slip borongan' },
            { status: 409 }
        );
    }

    const currentVehicleRef = extractRefId(deliveryOrder.vehicleRef);
    const currentDriverRef = extractRefId(deliveryOrder.driverRef);
    let nextVehicleRef = currentVehicleRef || '';
    let nextVehiclePlate = deliveryOrder.vehiclePlate || '';
    let nextVehicleServiceRef = extractRefId(deliveryOrder.vehicleServiceRef) || undefined;
    let nextVehicleServiceName = deliveryOrder.vehicleServiceName || undefined;
    let nextVehicleCategoryOverrideReason = deliveryOrder.vehicleCategoryOverrideReason || undefined;
    let nextDriverRef = currentDriverRef || '';
    let nextDriverName = deliveryOrder.driverName || '';

    if (vehicleRef) {
        const vehicle = await sanityGetById<{
            _id: string;
            plateNumber?: string;
            status?: string;
            serviceRef?: string;
            serviceName?: string;
        }>(vehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan DO tidak ditemukan' }, { status: 404 });
        }
        if (vehicle.status === 'SOLD') {
            return NextResponse.json({ error: 'Kendaraan yang sudah dijual tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        if (vehicle.status === 'OUT_OF_SERVICE') {
            return NextResponse.json({ error: 'Kendaraan yang sedang out of service tidak bisa dipakai untuk surat jalan baru' }, { status: 409 });
        }
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                _id != $currentId &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((vehicleRef == $ref || vehicleRef._ref == $ref) || lower(coalesce(vehiclePlate, "")) == $plate)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                currentId: id,
                ref: vehicleRef,
                plate: (vehicle.plateNumber || nextVehiclePlate || '').toLowerCase(),
            }
        );
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} masih dipakai di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        const requestedServiceRef = extractRefId(deliveryOrder.serviceRef);
        const assignedVehicleServiceRef = extractRefId(vehicle.serviceRef) || undefined;
        const assignedVehicleServiceName = vehicle.serviceName || undefined;
        if (requestedServiceRef && !assignedVehicleServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} belum punya kategori armada yang cocok. Isi alasan override jika trip ini memang harus jalan dengan armada berbeda.`,
                },
                { status: 400 }
            );
        }
        if (requestedServiceRef && assignedVehicleServiceRef !== requestedServiceRef && !vehicleCategoryOverrideReason) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} berkategori ${vehicle.serviceName || '-'} tidak sama dengan armada order ${deliveryOrder.serviceName || '-'}. Isi alasan override bila trip ini memang memakai armada lain.`,
                },
                { status: 400 }
            );
        }

        nextVehicleRef = vehicleRef;
        nextVehiclePlate = vehicle.plateNumber || nextVehiclePlate;
        nextVehicleServiceRef = assignedVehicleServiceRef;
        nextVehicleServiceName = assignedVehicleServiceName;
        nextVehicleCategoryOverrideReason =
            requestedServiceRef && assignedVehicleServiceRef !== requestedServiceRef
                ? vehicleCategoryOverrideReason || undefined
                : undefined;
    }

    if (driverRef) {
        const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(driverRef);
        if (!driver) {
            return NextResponse.json({ error: 'Supir DO tidak ditemukan' }, { status: 404 });
        }
        if (driver.active === false) {
            return NextResponse.json({ error: 'Supir DO tidak aktif' }, { status: 409 });
        }
        const conflictingDeliveryOrder = await getSanityClient().fetch<{
            _id: string;
            doNumber?: string;
            customerDoNumber?: string;
        } | null>(
            `*[
                _type == "deliveryOrder" &&
                _id != $currentId &&
                status in ["CREATED", "HEADING_TO_PICKUP", "ON_DELIVERY", "ARRIVED"] &&
                ((driverRef == $ref || driverRef._ref == $ref) || lower(coalesce(driverName, "")) == $driverName)
            ][0]{
                _id,
                doNumber,
                customerDoNumber
            }`,
            {
                currentId: id,
                ref: driverRef,
                driverName: (driver.name || nextDriverName || '').toLowerCase(),
            }
        );
        if (conflictingDeliveryOrder) {
            const conflictingNumber =
                conflictingDeliveryOrder.doNumber ||
                conflictingDeliveryOrder.customerDoNumber ||
                conflictingDeliveryOrder._id;
            return NextResponse.json(
                {
                    error: `Supir ${driver.name || driverRef} masih terikat di surat jalan aktif ${conflictingNumber}. Selesaikan atau batalkan dulu DO tersebut.`,
                },
                { status: 409 }
            );
        }
        nextDriverRef = driverRef;
        nextDriverName = driver.name || nextDriverName;
    }

    const vehicleChanged =
        nextVehicleRef !== (currentVehicleRef || '') ||
        nextVehiclePlate !== (deliveryOrder.vehiclePlate || '') ||
        (nextVehicleCategoryOverrideReason || '') !== (deliveryOrder.vehicleCategoryOverrideReason || '');
    const driverChanged =
        nextDriverRef !== (currentDriverRef || '') ||
        nextDriverName !== (deliveryOrder.driverName || '');

    if (!vehicleChanged && !driverChanged) {
        const unchangedDeliveryOrder = await sanityGetById(id);
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updatedDeliveryOrder: unknown;
    try {
        updatedDeliveryOrder = await getSanityClient()
            .patch(id)
            .ifRevisionId(deliveryOrder._rev)
            .set({
                vehicleRef: nextVehicleRef || undefined,
                vehiclePlate: nextVehiclePlate || undefined,
                vehicleServiceRef: nextVehicleServiceRef || undefined,
                vehicleServiceName: nextVehicleServiceName || undefined,
                vehicleCategoryOverrideReason: nextVehicleCategoryOverrideReason || undefined,
                driverRef: nextDriverRef || undefined,
                driverName: nextDriverName || undefined,
            })
            .commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Armada trip berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    const changes: string[] = [];
    if (vehicleChanged) {
        changes.push(`kendaraan ${deliveryOrder.vehiclePlate || '-'} -> ${nextVehiclePlate || '-'}`);
    }
    if (driverChanged) {
        changes.push(`supir ${deliveryOrder.driverName || '-'} -> ${nextDriverName || '-'}`);
    }
    if (nextVehicleCategoryOverrideReason) {
        changes.push(`override armada: ${nextVehicleCategoryOverrideReason}`);
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Lengkapi armada trip ${deliveryOrder.doNumber || id}: ${changes.join('; ')}`
    );

    return NextResponse.json({ data: updatedDeliveryOrder, id });
}

export async function handleDeliveryOrderShipperReferenceUpdate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    const customerDoNumber = normalizeOptionalText(data.customerDoNumber)?.toUpperCase();

    if (!id) {
        return NextResponse.json({ error: 'Surat jalan tidak valid' }, { status: 400 });
    }
    if (!customerDoNumber) {
        return NextResponse.json({ error: 'No. SJ pengirim wajib diisi' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        customerDoNumber?: string;
        customerRef?: unknown;
        customerName?: string;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }

    const existingCustomerDoNumber = normalizeOptionalText(deliveryOrder.customerDoNumber)?.toUpperCase();
    if (existingCustomerDoNumber === customerDoNumber) {
        const unchangedDeliveryOrder = await sanityGetById(id);
        return NextResponse.json({ data: unchangedDeliveryOrder, id });
    }

    const hasNotaReference = await getSanityClient().fetch<{ _id: string; notaRef?: string } | null>(
        `*[_type == "freightNotaItem" && (doRef == $ref || doRef._ref == $ref)][0]{ _id, notaRef }`,
        { ref: id }
    );
    if (hasNotaReference) {
        return NextResponse.json(
            { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk nota' },
            { status: 409 }
        );
    }

    const hasBoronganReference = await getSanityClient().fetch<{ _id: string; boronganRef?: string } | null>(
        `*[_type == "driverBoronganItem" && (doRef == $ref || doRef._ref == $ref)][0]{ _id, boronganRef }`,
        { ref: id }
    );
    if (hasBoronganReference) {
        return NextResponse.json(
            { error: 'No. SJ pengirim tidak boleh diubah karena DO ini sudah masuk arsip slip borongan' },
            { status: 409 }
        );
    }

    const customerRef = extractRefId(deliveryOrder.customerRef);
    if (customerRef) {
        const duplicateCustomerDoNumber = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrder" &&
                _id != $id &&
                (customerRef == $customerRef || customerRef._ref == $customerRef) &&
                lower(coalesce(customerDoNumber, "")) == $customerDoNumber
            ][0]{ _id }`,
            {
                id,
                customerRef,
                customerDoNumber: customerDoNumber.toLowerCase(),
            }
        );
        if (duplicateCustomerDoNumber) {
            return NextResponse.json(
                { error: `No. SJ pengirim ${customerDoNumber} sudah dipakai untuk customer ini.` },
                { status: 409 }
            );
        }
    }

    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    let updatedDeliveryOrder: unknown;
    try {
        updatedDeliveryOrder = await getSanityClient()
            .patch(id)
            .ifRevisionId(deliveryOrder._rev)
            .set({ customerDoNumber })
            .commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'No. SJ pengirim berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `Update SJ pengirim ${deliveryOrder.doNumber || id}: ${existingCustomerDoNumber || '-'} -> ${customerDoNumber}`
    );

    return NextResponse.json({ data: updatedDeliveryOrder, id });
}

export async function handleOrderDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Order tidak valid' }, { status: 400 });
    }

    const order = await sanityGetById<{ _id: string; masterResi?: string }>(id);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

    const relatedDeliveryOrder = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "deliveryOrder" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedDeliveryOrder) {
        return NextResponse.json({ error: 'Order yang sudah punya surat jalan tidak boleh dihapus' }, { status: 409 });
    }

    const relatedInvoice = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "invoice" && orderRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (relatedInvoice) {
        return NextResponse.json({ error: 'Order yang sudah punya invoice tidak boleh dihapus' }, { status: 409 });
    }

    const orderItemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "orderItem" && orderRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const orderItemId of orderItemIds) {
        transaction.delete(orderItemId);
    }
    transaction.delete(id);
    await transaction.commit();

    await addAuditLog(session, 'DELETE', 'orders', id, `Deleted orders ${order.masterResi || id}`);
    return NextResponse.json({ success: true });
}
