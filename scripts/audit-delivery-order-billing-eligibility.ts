import { loadScriptEnv } from './_env';

loadScriptEnv();

import { buildNotaRowsFromDeliveryOrder } from '../src/lib/invoice-create-page-support';
import { hasDeliveryOrderBillableCargo } from '../src/lib/delivery-order-completion';
import type { DeliveryOrder, DeliveryOrderItem, FreightNotaItem, Order } from '../src/lib/types';

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
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
        throw new Error(`Login audit gagal (${response.status}): ${bodyText}`);
    }

    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieHeader = cookies
        .map(cookie => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');

    if (!cookieHeader) {
        throw new Error('Login audit berhasil tetapi cookie session tidak diterima');
    }

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
    const [deliveryOrdersResponse, ordersResponse, deliveryOrderItemsResponse, notaItemsResponse] = await Promise.all([
        requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders', cookieHeader),
        requestJson<{ data: Order[] }>('/api/data?entity=orders', cookieHeader),
        requestJson<{ data: DeliveryOrderItem[] }>('/api/data?entity=delivery-order-items', cookieHeader),
        requestJson<{ data: FreightNotaItem[] }>('/api/data?entity=freight-nota-items', cookieHeader),
    ]);

    const deliveryOrders = Array.isArray(deliveryOrdersResponse.data) ? deliveryOrdersResponse.data : [];
    const orders = Array.isArray(ordersResponse.data) ? ordersResponse.data : [];
    const deliveryOrderItems = Array.isArray(deliveryOrderItemsResponse.data) ? deliveryOrderItemsResponse.data : [];
    const notaItems = Array.isArray(notaItemsResponse.data) ? notaItemsResponse.data : [];

    const deliveredNonBillableDos = deliveryOrders.filter(deliveryOrder =>
        deliveryOrder.status === 'DELIVERED' &&
        Array.isArray(deliveryOrder.actualDropPoints) &&
        deliveryOrder.actualDropPoints.length > 0 &&
        !hasDeliveryOrderBillableCargo(deliveryOrder)
    );

    for (const deliveryOrder of deliveredNonBillableDos) {
        const relatedOrder = orders.find(order => order._id === normalizeText(deliveryOrder.orderRef));
        const rows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: relatedOrder ? [relatedOrder] : [],
            deliveryOrderItems: deliveryOrderItems.filter(item => normalizeText(item.deliveryOrderRef) === deliveryOrder._id),
        });

        assert(
            rows.length === 0,
            `DO ${deliveryOrder.doNumber || deliveryOrder._id} masih menghasilkan ${rows.length} row nota billable padahal realisasinya non-billable`,
        );

        const linkedPositiveNotaRows = notaItems.filter(item =>
            normalizeText(item.doRef) === deliveryOrder._id &&
            (
                normalizeNumber(item.collie) > 0 ||
                normalizeNumber(item.beratKg) > 0 ||
                normalizeNumber(item.uangRp) > 0
            )
        );

        assert(
            linkedPositiveNotaRows.length === 0,
            `DO ${deliveryOrder.doNumber || deliveryOrder._id} masih punya ${linkedPositiveNotaRows.length} row nota tersimpan yang bernilai billable`,
        );
    }

    console.log('Delivery order billing eligibility audit');
    console.log('');
    console.log(`- Base URL: ${getBaseUrl()}`);
    console.log(`- Delivered non-billable DO checked: ${deliveredNonBillableDos.length}`);
    console.log('');
    console.log('Billing eligibility audit OK: DO delivered non-billable tidak menghasilkan row nota billable.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
