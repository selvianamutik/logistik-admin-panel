import { NextResponse } from 'next/server';

import { getSanityClient, sanityGetById, sanityGetNextNumber, sanityUpdate } from '@/lib/sanity';

import {
    extractRefId,
    isPlainObject,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type OrderItemStatusSummary = { status?: string };

type NormalizedOrderItemInput = {
    description: string;
    qtyKoli: number;
    weight: number;
    volume?: number;
    value?: number;
};

const DO_STATUS_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['ON_DELIVERY', 'CANCELLED'],
    ON_DELIVERY: ['DELIVERED', 'CANCELLED'],
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
        item => item.status === 'DELIVERED' || item.status === 'ON_DELIVERY'
    );
    const anyHold = items.some(item => item.status === 'HOLD');

    if (allDelivered) return 'COMPLETE';
    if (anyInProgress) return 'PARTIAL';
    if (anyHold) return 'ON_HOLD';
    return 'OPEN';
}

export async function syncOrderStatusFromItems(orderRef: string, session: ApiSession, addAuditLog: AuditLogFn) {
    const order = await sanityGetById<{ _id: string; status?: string }>(orderRef);
    if (!order || order.status === 'CANCELLED') {
        return;
    }

    const items = await getSanityClient().fetch<OrderItemStatusSummary[]>(
        `*[_type == "orderItem" && orderRef == $orderRef]{ status }`,
        { orderRef }
    );
    const nextStatus = deriveOrderStatusFromItems(items);

    if (order.status === nextStatus) {
        return;
    }

    await sanityUpdate(orderRef, { status: nextStatus });
    void addAuditLog(
        session,
        'UPDATE',
        'orders',
        orderRef,
        `Order auto-${nextStatus}: sinkronisasi dari ${items.length} item`
    );
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
            return NextResponse.json({ error: 'Layanan order tidak ditemukan' }, { status: 404 });
        }
        if (service.active === false) {
            return NextResponse.json({ error: 'Layanan order tidak aktif' }, { status: 409 });
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
            const weight = normalizeNumber(item.weight ?? 0);
            const volume = normalizeNumber(item.volume);
            const value = normalizeNumber(item.value);

            if (!description) {
                throw new Error('Deskripsi item order wajib diisi');
            }
            if (!Number.isFinite(qtyKoli) || qtyKoli <= 0) {
                throw new Error('Jumlah koli item order harus lebih besar dari 0');
            }
            if (!Number.isFinite(weight) || weight < 0) {
                throw new Error('Berat item order tidak valid');
            }

            return {
                description,
                qtyKoli,
                weight,
                volume: Number.isFinite(volume) && volume >= 0 ? volume : undefined,
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
            value: item.value,
            status: 'PENDING',
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'orders', orderId, `Created orders: ${masterResi}`);
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
    }>(id);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
    }

    const allowedStatuses = DO_STATUS_TRANSITIONS[deliveryOrder.status || ''] || [];
    if (!allowedStatuses.includes(status)) {
        return NextResponse.json({ error: 'Transisi status DO tidak valid' }, { status: 400 });
    }

    const doItems = await getSanityClient().fetch<Array<{ orderItemRef?: unknown }>>(
        `*[_type == "deliveryOrderItem" && deliveryOrderRef == $ref]{ orderItemRef }`,
        { ref: id }
    );

    const nextOrderItemStatus =
        status === 'ON_DELIVERY'
            ? 'ON_DELIVERY'
            : status === 'DELIVERED'
                ? 'DELIVERED'
                : 'PENDING';

    const timestamp = new Date().toISOString();
    const shouldStopTracking = status === 'DELIVERED' || status === 'CANCELLED';
    const transaction = getSanityClient()
        .transaction()
        .patch(id, {
            set: {
                status,
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
            transaction.patch(orderItemRef, { set: { status: nextOrderItemStatus } });
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

    void addAuditLog(
        session,
        'UPDATE',
        'delivery-orders',
        id,
        `DO status ${deliveryOrder.doNumber || id}: ${deliveryOrder.status || '-'} -> ${status}`
    );

    return NextResponse.json({
        data: {
            ...deliveryOrder,
            status,
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
    const rawItemRefs = Array.isArray(data.itemRefs) ? data.itemRefs : [];
    const itemRefs = rawItemRefs.filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (!orderRef || itemRefs.length === 0) {
        return NextResponse.json({ error: 'Order dan item surat jalan wajib diisi' }, { status: 400 });
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
        const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(vehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan DO tidak ditemukan' }, { status: 404 });
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

    const selectedItems = await getSanityClient().fetch<Array<{
        _id: string;
        orderRef?: unknown;
        description?: string;
        qtyKoli?: number;
        weight?: number;
    }>>(`*[_type == "orderItem" && _id in $ids]`, { ids: itemRefs });
    if (selectedItems.length !== itemRefs.length) {
        return NextResponse.json({ error: 'Sebagian item order tidak ditemukan' }, { status: 404 });
    }

    for (const item of selectedItems) {
        if (extractRefId(item.orderRef) !== orderRef) {
            return NextResponse.json({ error: 'Ada item yang bukan milik order ini' }, { status: 400 });
        }

        const activeAssignment = await getSanityClient().fetch<{ _id: string } | null>(
            `*[
                _type == "deliveryOrderItem" &&
                orderItemRef == $orderItemRef &&
                defined(*[_type == "deliveryOrder" && _id == ^.deliveryOrderRef && status != "CANCELLED"][0]._id)
            ][0]{ _id }`,
            { orderItemRef: item._id }
        );
        if (activeAssignment) {
            return NextResponse.json({ error: 'Ada item yang sudah terikat ke surat jalan aktif lain' }, { status: 409 });
        }
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
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemRef: item._id,
            orderItemDescription: item.description,
            orderItemQtyKoli: item.qtyKoli,
            orderItemWeight: item.weight,
        });
    }

    await transaction.commit();
    void addAuditLog(session, 'CREATE', 'delivery-orders', doId, `Created delivery-orders: ${doNumber}`);
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

    void addAuditLog(session, 'DELETE', 'orders', id, `Deleted orders ${order.masterResi || id}`);
    return NextResponse.json({ success: true });
}
