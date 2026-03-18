import { NextResponse } from 'next/server';

import {
    calculateWeightPortion,
    calculateVolumePortion,
    deriveOrderItemStatusFromProgress,
    getOrderItemProgress,
    roundQuantity,
} from '@/lib/order-item-progress';
import { getSanityClient, sanityGetById, sanityGetNextNumber, sanityUpdate } from '@/lib/sanity';

import {
    extractRefId,
    isPlainObject,
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

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type OrderItemStatusSummary = {
    status?: string;
    qtyKoli?: number;
    weight?: number;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
};

type NormalizedOrderItemInput = {
    description: string;
    qtyKoli: number;
    weight: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    value?: number;
};

type DeliveryOrderItemSelection = {
    orderItemRef: string;
    qtyKoli: number;
    holdRemaining: boolean;
    holdReason?: string;
    holdLocation?: string;
};

type OrderItemProgressSnapshot = {
    _id: string;
    orderRef?: unknown;
    description?: string;
    qtyKoli?: number;
    weight?: number;
    volume?: number;
    weightInputValue?: number;
    weightInputUnit?: WeightInputUnit;
    volumeInputValue?: number;
    volumeInputUnit?: VolumeInputUnit;
    status?: string;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    holdReason?: string;
    holdLocation?: string;
};

type DeliveryOrderItemCargoSnapshot = {
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
};

type NormalizedActualCargoInput = {
    deliveryOrderItemRef: string;
    actualQtyKoli: number;
    actualWeightKg: number;
    actualWeightInputValue?: number;
    actualWeightInputUnit?: WeightInputUnit;
    actualVolumeM3?: number;
    actualVolumeInputValue?: number;
    actualVolumeInputUnit?: VolumeInputUnit;
};

const DO_STATUS_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'CANCELLED'],
    HEADING_TO_PICKUP: ['ON_DELIVERY', 'CANCELLED'],
    ON_DELIVERY: ['ARRIVED', 'DELIVERED', 'CANCELLED'],
    ARRIVED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
};

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

function deriveOrderStatusFromItems(items: OrderItemStatusSummary[]) {
    const allDelivered = items.length > 0 && items.every(item => item.status === 'DELIVERED');
    const anyInProgress = items.some(
        item =>
            item.status === 'DELIVERED' ||
            item.status === 'PARTIAL' ||
            item.status === 'ASSIGNED' ||
            item.status === 'ON_DELIVERY'
    );
    const anyHold = items.some(item => item.status === 'HOLD');

    if (allDelivered) return 'COMPLETE';
    if (anyInProgress) return 'PARTIAL';
    if (anyHold) return 'ON_HOLD';
    return 'OPEN';
}

function normalizeDeliveryOrderSelections(data: Record<string, unknown>, orderItems: OrderItemProgressSnapshot[]) {
    const rawSelections = Array.isArray(data.items) ? data.items : [];
    if (rawSelections.length > 0) {
        const selections = rawSelections
            .filter(isPlainObject)
            .map<DeliveryOrderItemSelection>(item => ({
                orderItemRef: normalizeText(item.orderItemRef),
                qtyKoli: normalizeNumber(item.qtyKoli),
                holdRemaining: Boolean(item.holdRemaining),
                holdReason: normalizeOptionalText(item.holdReason),
                holdLocation: normalizeOptionalText(item.holdLocation),
            }));
        return selections.filter(item => item.orderItemRef);
    }

    const rawItemRefs = Array.isArray(data.itemRefs) ? data.itemRefs : [];
    const itemRefs = rawItemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0);
    return orderItems
        .filter(item => itemRefs.includes(item._id))
        .map<DeliveryOrderItemSelection>(item => ({
            orderItemRef: item._id,
            qtyKoli: normalizeNumber(item.qtyKoli),
            holdRemaining: false,
        }));
}

function normalizeDeliveryOrderActualCargoInputs(
    data: Record<string, unknown>,
    doItems: DeliveryOrderItemCargoSnapshot[]
) {
    const rawActualItems = Array.isArray(data.actualItems) ? data.actualItems : [];
    const providedActuals = new Map<string, Record<string, unknown>>();
    for (const rawItem of rawActualItems) {
        if (!isPlainObject(rawItem)) {
            continue;
        }
        const deliveryOrderItemRef = normalizeText(rawItem.deliveryOrderItemRef);
        if (!deliveryOrderItemRef) {
            continue;
        }
        providedActuals.set(deliveryOrderItemRef, rawItem);
    }

    const normalized = new Map<string, NormalizedActualCargoInput>();
    for (const item of doItems) {
        const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
        const plannedWeightKg = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));
        const plannedVolumeM3 = roundQuantity(normalizeNumber(item.orderItemVolumeM3 ?? 0), 3);

        const rawItem = providedActuals.get(item._id);
        const weightInputUnit: WeightInputUnit =
            rawItem?.actualWeightInputUnit === 'TON'
                ? 'TON'
                : item.actualWeightInputUnit || item.orderItemWeightInputUnit || 'KG';
        const volumeInputUnit: VolumeInputUnit =
            rawItem?.actualVolumeInputUnit === 'LITER'
                ? 'LITER'
                : rawItem?.actualVolumeInputUnit === 'KL'
                    ? 'KL'
                : item.actualVolumeInputUnit || item.orderItemVolumeInputUnit || 'M3';

        const actualQtyKoli = roundQuantity(
            normalizeNumber(rawItem?.actualQtyKoli ?? item.actualQtyKoli ?? plannedQtyKoli)
        );
        const rawWeightInputValue = normalizeNumber(
            rawItem?.actualWeightInputValue ??
            item.actualWeightInputValue ??
            (item.actualWeightKg !== undefined
                ? convertKgToWeightInputValue(normalizeNumber(item.actualWeightKg), weightInputUnit)
                : item.orderItemWeightInputValue ?? convertKgToWeightInputValue(plannedWeightKg, weightInputUnit))
        );
        const rawVolumeInputValue = normalizeNumber(
            rawItem?.actualVolumeInputValue ??
            item.actualVolumeInputValue ??
            (item.actualVolumeM3 !== undefined
                ? convertM3ToVolumeInputValue(normalizeNumber(item.actualVolumeM3), volumeInputUnit)
                : item.orderItemVolumeInputValue ?? convertM3ToVolumeInputValue(plannedVolumeM3, volumeInputUnit))
        );
        const actualWeightKg = roundQuantity(convertWeightToKg(rawWeightInputValue, weightInputUnit));
        const actualVolumeM3 = roundQuantity(convertVolumeToM3(rawVolumeInputValue, volumeInputUnit), 3);

        normalized.set(item._id, {
            deliveryOrderItemRef: item._id,
            actualQtyKoli,
            actualWeightKg,
            actualWeightInputValue: rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
            actualWeightInputUnit: rawWeightInputValue > 0 ? weightInputUnit : undefined,
            actualVolumeM3: actualVolumeM3 > 0 ? actualVolumeM3 : undefined,
            actualVolumeInputValue: rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
            actualVolumeInputUnit: rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
        });
    }

    return normalized;
}

function summarizeSelection(selection: DeliveryOrderItemSelection, description?: string) {
    return `${description || selection.orderItemRef}: ${roundQuantity(selection.qtyKoli)} koli${selection.holdRemaining ? ' + sisa hold' : ''}`;
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
            deliveredQtyKoli,
            deliveredWeight,
            assignedQtyKoli,
            assignedWeight,
            heldQtyKoli,
            heldWeight
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
    const holdReason = normalizeOptionalText(data.holdReason);
    const holdLocation = normalizeOptionalText(data.holdLocation);

    if (!id || !Number.isFinite(holdQtyKoli) || holdQtyKoli <= 0) {
        return NextResponse.json({ error: 'Jumlah koli hold tidak valid' }, { status: 400 });
    }
    if (!holdReason) {
        return NextResponse.json({ error: 'Alasan hold wajib diisi' }, { status: 400 });
    }

    const orderItem = await sanityGetById<OrderItemProgressSnapshot>(id);
    if (!orderItem) {
        return NextResponse.json({ error: 'Item order tidak ditemukan' }, { status: 404 });
    }

    const progress = getOrderItemProgress(orderItem);
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
    const receiverName = normalizeText(data.receiverName);
    const receiverAddress = normalizeText(data.receiverAddress);
    if (!customerRef || !receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
    }

    const customer = await sanityGetById<{ _id: string; name?: string; address?: string; active?: boolean }>(customerRef);
    if (!customer) {
        return NextResponse.json({ error: 'Customer order tidak ditemukan' }, { status: 404 });
    }
    if (customer.active === false) {
        return NextResponse.json({ error: 'Customer order tidak aktif' }, { status: 409 });
    }

    let serviceName: string | undefined;
    if (serviceRef) {
        const service = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(serviceRef);
        if (!service) {
            return NextResponse.json({ error: 'Kategori armada order tidak ditemukan' }, { status: 404 });
        }
        if (service.active === false) {
            return NextResponse.json({ error: 'Kategori armada order tidak aktif' }, { status: 409 });
        }
        serviceName = service.name || undefined;
    }

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
        .filter(isPlainObject)
        .filter(item => normalizeText(item.description))
        .map<NormalizedOrderItemInput>(item => {
            const description = normalizeText(item.description);
            const qtyKoli = normalizeNumber(item.qtyKoli ?? 1);
            const rawWeightInputValue = normalizeNumber(item.weightInputValue ?? item.weight ?? 0);
            const rawVolumeInputValue = normalizeNumber(item.volumeInputValue ?? item.volume);
            const weightInputUnit: WeightInputUnit = item.weightInputUnit === 'TON' ? 'TON' : 'KG';
            const volumeInputUnit: VolumeInputUnit =
                item.volumeInputUnit === 'LITER' || item.volumeInputUnit === 'KL' ? item.volumeInputUnit : 'M3';
            const weight = convertWeightToKg(rawWeightInputValue, weightInputUnit);
            const volume = Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue >= 0
                ? convertVolumeToM3(rawVolumeInputValue, volumeInputUnit)
                : undefined;
            const value = normalizeNumber(item.value);

            if (!description) {
                throw new Error('Deskripsi item order wajib diisi');
            }
            if (!Number.isFinite(qtyKoli) || qtyKoli <= 0) {
                throw new Error('Jumlah koli item order harus lebih besar dari 0');
            }
            if (!Number.isFinite(rawWeightInputValue) || rawWeightInputValue < 0) {
                throw new Error('Berat item order tidak valid');
            }
            if (Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue < 0) {
                throw new Error('Volume item order tidak valid');
            }

            return {
                description,
                qtyKoli,
                weight,
                volume: volume !== undefined && Number.isFinite(volume) && volume >= 0 ? volume : undefined,
                weightInputValue: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? rawWeightInputValue : undefined,
                weightInputUnit: Number.isFinite(rawWeightInputValue) && rawWeightInputValue > 0 ? weightInputUnit : undefined,
                volumeInputValue: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? rawVolumeInputValue : undefined,
                volumeInputUnit: Number.isFinite(rawVolumeInputValue) && rawVolumeInputValue > 0 ? volumeInputUnit : undefined,
                value: Number.isFinite(value) && value >= 0 ? value : undefined,
            };
        });

    if (items.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 item order wajib diisi' }, { status: 400 });
    }

    const orderId = crypto.randomUUID();
    const masterResi = await sanityGetNextNumber('resi');
    const createdAt = new Date().toISOString();
    const orderDoc = {
        _id: orderId,
        _type: 'order',
        customerRef,
        customerName: customer.name,
        receiverName,
        receiverPhone: normalizeText(data.receiverPhone),
        receiverAddress,
        receiverCompany: normalizeOptionalText(data.receiverCompany),
        pickupAddress: normalizeOptionalText(data.pickupAddress) || customer.address || undefined,
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
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'orderItem',
            orderRef: orderId,
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
            assignedQtyKoli: 0,
            assignedWeight: 0,
            heldQtyKoli: 0,
            heldWeight: 0,
            status: 'PENDING',
        });
    }

    await transaction.commit();
    await addAuditLog(session, 'CREATE', 'orders', orderId, `Created orders: ${masterResi}`);
    return NextResponse.json({ data: orderDoc, id: orderId });
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
        doNumber?: string;
        status?: string;
        orderRef?: unknown;
        driverRef?: unknown;
        trackingState?: string;
        podReceiverName?: string;
        podReceivedDate?: string;
        podNote?: string;
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
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
    }

    const actualCargoByDoItemId =
        status === 'DELIVERED' ? normalizeDeliveryOrderActualCargoInputs(data, doItems) : new Map<string, NormalizedActualCargoInput>();

    const timestamp = new Date().toISOString();
    const shouldStopTracking = status === 'DELIVERED' || status === 'CANCELLED';
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            set: {
                status,
                ...(status === 'DELIVERED'
                    ? {
                        podReceiverName,
                        podReceivedDate,
                        podNote,
                        cargoFinalizedAt: timestamp,
                        cargoFinalizedBy: session._id,
                        cargoFinalizedByName: session.name,
                    }
                    : {}),
                ...(shouldStopTracking
                    ? {
                        trackingState: 'STOPPED',
                        trackingStoppedAt: timestamp,
                    }
                    : {}),
            },
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

    for (const item of doItems) {
        const orderItemRef = extractRefId(item.orderItemRef);
        if (orderItemRef) {
            const orderItem = await sanityGetById<OrderItemProgressSnapshot>(orderItemRef);
            if (!orderItem) {
                continue;
            }

            const progress = getOrderItemProgress(orderItem);
            const plannedQtyKoli = roundQuantity(normalizeNumber(item.shippedQtyKoli ?? item.orderItemQtyKoli ?? 0));
            const plannedWeight = roundQuantity(normalizeNumber(item.shippedWeight ?? item.orderItemWeight ?? 0));

            if (status === 'HEADING_TO_PICKUP' || status === 'ON_DELIVERY' || status === 'ARRIVED') {
                transaction.patch(orderItemRef, { set: { status: 'ON_DELIVERY' } });
                continue;
            }

            if (status === 'DELIVERED') {
                const actualCargo = actualCargoByDoItemId.get(item._id);
                if (!actualCargo) {
                    return NextResponse.json({ error: 'Muatan aktual surat jalan tidak lengkap' }, { status: 400 });
                }
                if (!Number.isFinite(actualCargo.actualQtyKoli) || actualCargo.actualQtyKoli <= 0) {
                    return NextResponse.json(
                        { error: `Qty aktual untuk ${orderItem.description || 'item order'} harus lebih besar dari 0` },
                        { status: 400 }
                    );
                }
                if (actualCargo.actualQtyKoli > plannedQtyKoli) {
                    return NextResponse.json(
                        {
                            error: `Qty aktual untuk ${orderItem.description || 'item order'} tidak boleh melebihi rencana DO. Ubah rencana DO terlebih dahulu bila muatan aktual lebih besar.`,
                        },
                        { status: 409 }
                    );
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

                const actualQtyKoli = actualCargo.actualQtyKoli;
                const actualWeight = roundQuantity(actualCargo.actualWeightKg);
                const otherReservedWeight = roundQuantity(
                    Math.max(progress.deliveredWeight + progress.assignedWeight + progress.heldWeight - plannedWeight, 0)
                );
                const nextTotalWeight = roundQuantity(Math.max(progress.totalWeight, otherReservedWeight + actualWeight));
                const nextProgress = {
                    ...progress,
                    totalWeight: nextTotalWeight,
                    assignedQtyKoli: roundQuantity(Math.max(progress.assignedQtyKoli - plannedQtyKoli, 0)),
                    assignedWeight: roundQuantity(Math.max(progress.assignedWeight - plannedWeight, 0)),
                    deliveredQtyKoli: roundQuantity(Math.min(progress.deliveredQtyKoli + actualQtyKoli, progress.totalQtyKoli)),
                    deliveredWeight: roundQuantity(progress.deliveredWeight + actualWeight),
                };
                transaction.patch(orderItemRef, {
                    set: {
                        weight: nextTotalWeight,
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        deliveredQtyKoli: nextProgress.deliveredQtyKoli,
                        deliveredWeight: nextProgress.deliveredWeight,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                });
                transaction.patch(item._id, {
                    set: {
                        actualQtyKoli: actualCargo.actualQtyKoli,
                        actualWeightKg: actualWeight,
                        actualVolumeM3: actualCargo.actualVolumeM3,
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
                };
                transaction.patch(orderItemRef, {
                    set: {
                        assignedQtyKoli: nextProgress.assignedQtyKoli,
                        assignedWeight: nextProgress.assignedWeight,
                        status: deriveOrderItemStatusFromProgress(nextProgress),
                    },
                });
            }
        }
    }

    await transaction.commit();

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
        `DO status ${deliveryOrder.doNumber || id}: ${deliveryOrder.status || '-'} -> ${status}${status === 'DELIVERED' ? ` (muatan aktual difinalisasi ${doItems.length} item)` : ''}`
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
                    cargoFinalizedAt: timestamp,
                    cargoFinalizedBy: session._id,
                    cargoFinalizedByName: session.name,
                }
                : {}),
            trackingState: shouldStopTracking ? 'STOPPED' : deliveryOrder.trackingState,
            trackingStoppedAt: shouldStopTracking ? timestamp : undefined,
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
        masterResi?: string;
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

    const vehicleRef = typeof data.vehicleRef === 'string' ? data.vehicleRef : '';
    let vehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : '';
    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    let driverName =
        typeof data.driverName === 'string' && data.driverName.trim()
            ? data.driverName.trim()
            : '';

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
        const orderServiceRef = extractRefId(order.serviceRef);
        const vehicleServiceRef = extractRefId(vehicle.serviceRef);
        if (orderServiceRef && !vehicleServiceRef) {
            return NextResponse.json(
                { error: `Kendaraan ${vehicle.plateNumber || vehicleRef} belum punya kategori armada dan tidak bisa dipakai untuk order ${order.serviceName || '-'}` },
                { status: 409 }
            );
        }
        if (orderServiceRef && vehicleServiceRef !== orderServiceRef) {
            return NextResponse.json(
                {
                    error: `Kendaraan ${vehicle.plateNumber || vehicleRef} berkategori ${vehicle.serviceName || '-'} tidak sesuai dengan kategori armada order ${order.serviceName || '-'}`,
                },
                { status: 409 }
            );
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
        driverName = driver.name || driverName;
    }

    const doDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);

    const requestedItemIds = Array.from(new Set([
        ...(Array.isArray(data.itemRefs) ? data.itemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0) : []),
        ...(Array.isArray(data.items)
            ? data.items
                .filter(isPlainObject)
                .map(item => normalizeText(item.orderItemRef))
                .filter(Boolean)
            : []),
    ]));
    if (requestedItemIds.length === 0) {
        return NextResponse.json({ error: 'Pilih minimal 1 item untuk surat jalan' }, { status: 400 });
    }

    const selectedItems = await getSanityClient().fetch<OrderItemProgressSnapshot[]>(
        `*[_type == "orderItem" && _id in $ids]{
            _id,
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
            assignedQtyKoli,
            assignedWeight,
            heldQtyKoli,
            heldWeight,
            holdReason,
            holdLocation
        }`,
        { ids: requestedItemIds }
    );
    if (selectedItems.length !== requestedItemIds.length) {
        return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
    }

    const normalizedSelections = normalizeDeliveryOrderSelections(data, selectedItems);
    if (normalizedSelections.length === 0) {
        return NextResponse.json({ error: 'Pilih minimal 1 item untuk surat jalan' }, { status: 400 });
    }

    const duplicateSelection = normalizedSelections.find(
        (selection, index) => normalizedSelections.findIndex(candidate => candidate.orderItemRef === selection.orderItemRef) !== index
    );
    if (duplicateSelection) {
        return NextResponse.json({ error: 'Item surat jalan tidak boleh dipilih dua kali' }, { status: 400 });
    }

    const selectionByItemId = new Map(normalizedSelections.map(selection => [selection.orderItemRef, selection]));
    const selectionSummaries: string[] = [];

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

        selectionSummaries.push(summarizeSelection(selection, item.description));
    }

    const doId = crypto.randomUUID();
    const doNumber = await sanityGetNextNumber('do');
    const doDoc = {
        _id: doId,
        _type: 'deliveryOrder',
        orderRef,
        masterResi: order.masterResi,
        customerRef: extractRefId(order.customerRef) || undefined,
        customerName: order.customerName,
        receiverName: order.receiverName,
        receiverPhone: order.receiverPhone,
        receiverAddress: order.receiverAddress,
        receiverCompany: order.receiverCompany,
        pickupAddress: order.pickupAddress,
        serviceRef: order.serviceRef,
        serviceName: order.serviceName,
        vehicleRef: vehicleRef || undefined,
        vehiclePlate: vehiclePlate || undefined,
        driverRef: driverRef || undefined,
        driverName: driverName || undefined,
        date: doDate,
        notes: normalizeOptionalText(data.notes),
        doNumber,
        status: 'CREATED',
    };

    const transaction = getSanityClient().transaction().create(doDoc);
    for (const item of selectedItems) {
        const selection = selectionByItemId.get(item._id);
        if (!selection) {
            continue;
        }

        const progress = getOrderItemProgress(item);
        const shippedQtyKoli = roundQuantity(selection.qtyKoli);
        const shippedWeight = calculateWeightPortion(progress.totalWeight, progress.totalQtyKoli, shippedQtyKoli);
        const shippedVolumeM3 = calculateVolumePortion(normalizeNumber(item.volume ?? 0), progress.totalQtyKoli, shippedQtyKoli);
        const shippedWeightInputValue =
            item.weightInputValue && item.weightInputUnit
                ? roundQuantity(convertKgToWeightInputValue(shippedWeight, item.weightInputUnit), item.weightInputUnit === 'TON' ? 3 : 2)
                : undefined;
        const shippedVolumeInputValue =
            item.volumeInputValue && item.volumeInputUnit
                ? roundQuantity(convertM3ToVolumeInputValue(shippedVolumeM3, item.volumeInputUnit), item.volumeInputUnit === 'LITER' ? 0 : 3)
                : undefined;
        const remainingQtyAfterShipment = roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli, 0));
        const remainingWeightAfterShipment = roundQuantity(Math.max(progress.pendingWeight - shippedWeight, 0));
        const holdQtyToApply = selection.holdRemaining ? remainingQtyAfterShipment : 0;
        const holdWeightToApply = selection.holdRemaining ? remainingWeightAfterShipment : 0;
        const nextProgress = {
            ...progress,
            assignedQtyKoli: roundQuantity(progress.assignedQtyKoli + shippedQtyKoli),
            assignedWeight: roundQuantity(progress.assignedWeight + shippedWeight),
            heldQtyKoli: roundQuantity(progress.heldQtyKoli + holdQtyToApply),
            heldWeight: roundQuantity(progress.heldWeight + holdWeightToApply),
            pendingQtyKoli: roundQuantity(Math.max(progress.pendingQtyKoli - shippedQtyKoli - holdQtyToApply, 0)),
            pendingWeight: roundQuantity(Math.max(progress.pendingWeight - shippedWeight - holdWeightToApply, 0)),
        };

        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemRef: item._id,
            orderItemDescription: item.description,
            orderItemQtyKoli: shippedQtyKoli,
            orderItemWeight: shippedWeight,
            orderItemVolumeM3: shippedVolumeM3 > 0 ? shippedVolumeM3 : undefined,
            orderItemWeightInputValue: shippedWeightInputValue,
            orderItemWeightInputUnit: item.weightInputUnit,
            orderItemVolumeInputValue: shippedVolumeInputValue,
            orderItemVolumeInputUnit: item.volumeInputUnit,
            shippedQtyKoli,
            shippedWeight,
        });
        transaction.patch(item._id, {
            set: {
                assignedQtyKoli: nextProgress.assignedQtyKoli,
                assignedWeight: nextProgress.assignedWeight,
                heldQtyKoli: nextProgress.heldQtyKoli,
                heldWeight: nextProgress.heldWeight,
                holdReason: selection.holdRemaining ? selection.holdReason : item.holdReason,
                holdLocation: selection.holdRemaining ? selection.holdLocation : item.holdLocation,
                status: deriveOrderItemStatusFromProgress(nextProgress),
            },
        });
    }

    await transaction.commit();
    await syncOrderStatusFromItems(orderRef, session, addAuditLog);
    await addAuditLog(
        session,
        'CREATE',
        'delivery-orders',
        doId,
        `Created delivery-orders: ${doNumber} (${selectionSummaries.join('; ')})`
    );
    return NextResponse.json({ data: doDoc, id: doId });
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
