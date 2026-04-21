import { loadScriptEnv } from './_env';
import { deriveOrderItemStatusFromProgress, getOrderItemProgress } from '../src/lib/order-item-progress';
import type { Order } from '../src/lib/types';

loadScriptEnv();

type OrderResponse = Order & {
    _updatedAt?: string;
};

type OrderItemResponse = {
    _id: string;
    orderRef?: string | null;
    status?: string | null;
    qtyKoli?: number | null;
    weight?: number | null;
    volume?: number | null;
    deliveredQtyKoli?: number | null;
    deliveredWeight?: number | null;
    deliveredVolume?: number | null;
    assignedQtyKoli?: number | null;
    assignedWeight?: number | null;
    assignedVolume?: number | null;
    heldQtyKoli?: number | null;
    heldWeight?: number | null;
    heldVolume?: number | null;
    deliveryStatus?: string | null;
    partialStatus?: string | null;
    cargoStatus?: string | null;
    tripStatus?: string | null;
    deliveryOrderStatus?: string | null;
    paymentStatus?: string | null;
    description?: string | null;
};

function deriveOrderStatusFromItems(items: Array<{ status?: string | null }>) {
    const allDelivered = items.length > 0 && items.every(item => item.status === 'DELIVERED');
    const anyDelivered = items.some(item =>
        item.status === 'DELIVERED'
        || item.status === 'PARTIAL'
    );
    const anyAssigned = items.some(item =>
        item.status === 'ASSIGNED'
        || item.status === 'ON_DELIVERY'
    );
    const anyNonDeliveryResolved = items.some(item =>
        item.status === 'HOLD'
        || item.status === 'RETURNED'
    );

    if (allDelivered) {
        return 'COMPLETE';
    }

    if (anyDelivered) {
        return 'PARTIAL';
    }

    if (anyNonDeliveryResolved && !anyAssigned) {
        return 'ON_HOLD';
    }

    return 'OPEN';
}

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function sanitizeOrderItemProgressSource(item: OrderItemResponse) {
    return {
        qtyKoli: item.qtyKoli ?? undefined,
        weight: item.weight ?? undefined,
        volume: item.volume ?? undefined,
        deliveredQtyKoli: item.deliveredQtyKoli ?? undefined,
        deliveredWeight: item.deliveredWeight ?? undefined,
        deliveredVolume: item.deliveredVolume ?? undefined,
        assignedQtyKoli: item.assignedQtyKoli ?? undefined,
        assignedWeight: item.assignedWeight ?? undefined,
        assignedVolume: item.assignedVolume ?? undefined,
        heldQtyKoli: item.heldQtyKoli ?? undefined,
        heldWeight: item.heldWeight ?? undefined,
        heldVolume: item.heldVolume ?? undefined,
        status: normalizeText(item.status) || undefined,
        deliveryStatus: normalizeText(item.deliveryStatus) || undefined,
        partialStatus: normalizeText(item.partialStatus) || undefined,
        cargoStatus: normalizeText(item.cargoStatus) || undefined,
        tripStatus: normalizeText(item.tripStatus) || undefined,
        deliveryOrderStatus: normalizeText(item.deliveryOrderStatus) || undefined,
        paymentStatus: normalizeText(item.paymentStatus) || undefined,
    };
}

async function loginAndGetCookieHeader() {
    const response = await fetch(`${getBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/login`,
        },
        body: JSON.stringify({
            email: process.env.AUDIT_LOGIN_EMAIL || 'owner@company.local',
            password: process.env.AUDIT_LOGIN_PASSWORD || 'owner12345',
        }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login admin gagal (${response.status}): ${bodyText}`);
    }

    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieHeader = cookies
        .map(cookie => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');

    assert(cookieHeader, 'Login admin berhasil tetapi cookie session tidak diterima');
    return cookieHeader;
}

async function requestJson<T>(path: string, cookieHeader: string) {
    const response = await fetch(`${getBaseUrl()}${path}`, {
        headers: {
            Cookie: cookieHeader,
        },
    });
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`${path} -> ${response.status}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as T;
}

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const [ordersResponse, orderItemsResponse] = await Promise.all([
        requestJson<{ data: OrderResponse[] }>('/api/data?entity=orders', cookieHeader),
        requestJson<{ data: OrderItemResponse[] }>('/api/data?entity=order-items', cookieHeader),
    ]);

    const orders = Array.isArray(ordersResponse.data) ? ordersResponse.data : [];
    const orderItems = Array.isArray(orderItemsResponse.data) ? orderItemsResponse.data : [];

    const itemsByOrderRef = new Map<string, Array<{ status: string }>>();
    for (const item of orderItems) {
        const orderRef = normalizeText(item.orderRef);
        if (!orderRef) continue;
        const current = itemsByOrderRef.get(orderRef) || [];
        current.push({
            status: deriveOrderItemStatusFromProgress(getOrderItemProgress(sanitizeOrderItemProgressSource(item))),
        });
        itemsByOrderRef.set(orderRef, current);
    }

    const mismatches = orders
        .filter(order => normalizeText(order.status) !== 'CANCELLED')
        .map(order => {
            const linkedItems = itemsByOrderRef.get(order._id) || [];
            const expectedStatus = linkedItems.length > 0
                ? deriveOrderStatusFromItems(linkedItems)
                : normalizeText(order.status) || 'OPEN';
            return {
                orderId: order._id,
                orderNumber: normalizeText(order.masterResi) || order._id,
                actualStatus: normalizeText(order.status) || '-',
                expectedStatus,
                linkedItemCount: linkedItems.length,
            };
        })
        .filter(item => item.actualStatus !== item.expectedStatus);

    if (mismatches.length > 0) {
        throw new Error(`Order status mismatch ditemukan: ${JSON.stringify(mismatches.slice(0, 10), null, 2)}`);
    }

    const sampleOrder = orders.find(order => normalizeText(order.status) === 'PARTIAL') || orders[0];
    if (sampleOrder) {
        const singleResponse = await requestJson<{ data: OrderResponse }>(
            `/api/data?entity=orders&id=${encodeURIComponent(sampleOrder._id)}`,
            cookieHeader,
        );
        const linkedItems = itemsByOrderRef.get(sampleOrder._id) || [];
        const expectedStatus = linkedItems.length > 0
            ? deriveOrderStatusFromItems(linkedItems)
            : normalizeText(sampleOrder.status) || 'OPEN';
        assert(
            normalizeText(singleResponse.data?.status) === expectedStatus,
            `GET single order ${sampleOrder.masterResi || sampleOrder._id} tidak sinkron: ${singleResponse.data?.status} vs ${expectedStatus}`
        );
    }

    console.log(`Order status consistency audit OK: ${orders.length} order diverifikasi tanpa mismatch header/item progress.`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
