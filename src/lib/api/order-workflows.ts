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
    const receiverName = normalizeText(data.receiverName);
    const receiverAddress = normalizeText(data.receiverAddress);
    if (!customerRef || !receiverName || !receiverAddress) {
        return NextResponse.json({ error: 'Customer, penerima, dan alamat tujuan wajib diisi' }, { status: 400 });
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
        customerName: normalizeOptionalText(data.customerName),
        receiverName,
        receiverPhone: normalizeText(data.receiverPhone),
        receiverAddress,
        receiverCompany: normalizeOptionalText(data.receiverCompany),
        pickupAddress: normalizeOptionalText(data.pickupAddress),
        serviceRef: typeof data.serviceRef === 'string' ? data.serviceRef : '',
        serviceName: normalizeOptionalText(data.serviceName),
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

    const deliveryOrder = await sanityGetById<{ _id: string; doNumber?: string; status?: string; orderRef?: unknown }>(id);
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

    const transaction = getSanityClient()
        .transaction()
        .patch(id, { set: { status } })
        .create({
            _id: crypto.randomUUID(),
            _type: 'trackingLog',
            refType: 'DO',
            refRef: id,
            status,
            note: note || undefined,
            timestamp: new Date().toISOString(),
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
        customerName?: string;
        receiverName?: string;
        receiverAddress?: string;
    }>(orderRef);
    if (!order) {
        return NextResponse.json({ error: 'Order tidak ditemukan' }, { status: 404 });
    }

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
        ...data,
        orderRef,
        masterResi: typeof data.masterResi === 'string' && data.masterResi ? data.masterResi : order.masterResi,
        customerName: typeof data.customerName === 'string' && data.customerName ? data.customerName : order.customerName,
        receiverName: typeof data.receiverName === 'string' && data.receiverName ? data.receiverName : order.receiverName,
        receiverAddress: typeof data.receiverAddress === 'string' && data.receiverAddress ? data.receiverAddress : order.receiverAddress,
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
