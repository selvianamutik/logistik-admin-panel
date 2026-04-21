import { loadScriptEnv } from './_env';

loadScriptEnv();

type DeliveryOrderLike = {
    _id: string;
    doNumber?: string;
    status?: string;
    cargoFinalizedAt?: string | null;
    actualTotalWeightKg?: number | null;
    actualDropPoints?: Array<unknown> | null;
};

type DeliveryOrderItemLike = {
    _id: string;
    deliveryOrderRef?: string;
    actualQtyKoli?: number | null;
    actualWeightKg?: number | null;
};

type FreightNotaItemLike = {
    _id: string;
    doRef?: string | null;
    doNumber?: string | null;
    noSJ?: string | null;
    barang?: string | null;
    tujuan?: string | null;
    deliveryOrderItemRef?: string | null;
    deliveryOrderItemRefs?: string[] | null;
};

type AuditIssue = {
    kind: string;
    ref: string;
    message: string;
};

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundQuantity(value: number, maxFractionDigits = 2) {
    if (!Number.isFinite(value)) return 0;
    const multiplier = 10 ** maxFractionDigits;
    return Math.round(value * multiplier) / multiplier;
}

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function getAuditEmail() {
    return process.env.AUDIT_LOGIN_EMAIL || 'owner@company.local';
}

function getAuditPassword() {
    return process.env.AUDIT_LOGIN_PASSWORD || 'owner12345';
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

async function loginAndGetCookieHeader() {
    const response = await fetch(`${getBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/login`,
        },
        body: JSON.stringify({
            email: getAuditEmail(),
            password: getAuditPassword(),
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

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const [deliveryOrderResponse, deliveryOrderItemResponse, freightNotaItemResponse] = await Promise.all([
        requestJson<{ data: DeliveryOrderLike[] }>('/api/data?entity=delivery-orders', cookieHeader),
        requestJson<{ data: DeliveryOrderItemLike[] }>('/api/data?entity=delivery-order-items', cookieHeader),
        requestJson<{ data: FreightNotaItemLike[] }>('/api/data?entity=freight-nota-items', cookieHeader),
    ]);

    const deliveryOrders = Array.isArray(deliveryOrderResponse.data) ? deliveryOrderResponse.data : [];
    const deliveryOrderItems = Array.isArray(deliveryOrderItemResponse.data) ? deliveryOrderItemResponse.data : [];
    const freightNotaItems = Array.isArray(freightNotaItemResponse.data) ? freightNotaItemResponse.data : [];

    const itemGroups = new Map<string, DeliveryOrderItemLike[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = itemGroups.get(deliveryOrderRef) || [];
        current.push(item);
        itemGroups.set(deliveryOrderRef, current);
    }

    const issues: AuditIssue[] = [];
    const deliveredOrders = deliveryOrders.filter(item => item.status === 'DELIVERED');

    for (const deliveryOrder of deliveredOrders) {
        const linkedItems = itemGroups.get(deliveryOrder._id) || [];
        const actualWeightFromItems = roundQuantity(
            linkedItems.reduce((sum, item) => sum + normalizeNumber(item.actualWeightKg), 0),
            2,
        );
        const actualQtyFromItems = roundQuantity(
            linkedItems.reduce((sum, item) => sum + normalizeNumber(item.actualQtyKoli), 0),
            2,
        );
        const actualTotalWeightKg = roundQuantity(normalizeNumber(deliveryOrder.actualTotalWeightKg), 2);
        const actualDropCount = Array.isArray(deliveryOrder.actualDropPoints) ? deliveryOrder.actualDropPoints.length : 0;

        if (!normalizeText(deliveryOrder.cargoFinalizedAt)) {
            issues.push({
                kind: 'delivery-order',
                ref: deliveryOrder.doNumber || deliveryOrder._id,
                message: 'DELIVERED tanpa cargoFinalizedAt',
            });
        }

        if (actualWeightFromItems > 0 && actualTotalWeightKg <= 0) {
            issues.push({
                kind: 'delivery-order',
                ref: deliveryOrder.doNumber || deliveryOrder._id,
                message: `DELIVERED tanpa actualTotalWeightKg padahal item aktual berjumlah ${actualWeightFromItems} kg`,
            });
        }

        if (actualWeightFromItems > 0 && Math.abs(actualTotalWeightKg - actualWeightFromItems) > 0.01) {
            issues.push({
                kind: 'delivery-order',
                ref: deliveryOrder.doNumber || deliveryOrder._id,
                message: `actualTotalWeightKg ${actualTotalWeightKg} kg tidak sama dengan total item aktual ${actualWeightFromItems} kg`,
            });
        }

        if ((actualWeightFromItems > 0 || actualQtyFromItems > 0) && actualDropCount === 0) {
            issues.push({
                kind: 'delivery-order',
                ref: deliveryOrder.doNumber || deliveryOrder._id,
                message: 'DELIVERED tanpa actualDropPoints padahal muatan aktual sudah ada',
            });
        }
    }

    for (const item of freightNotaItems) {
        const doRef = normalizeText(item.doRef);
        const doNumber = normalizeText(item.doNumber);
        const noSJ = normalizeText(item.noSJ);
        const barang = normalizeText(item.barang);
        const tujuan = normalizeText(item.tujuan);
        const rowItemRefs = [
            normalizeText(item.deliveryOrderItemRef),
            ...(Array.isArray(item.deliveryOrderItemRefs) ? item.deliveryOrderItemRefs.map(ref => normalizeText(ref)) : []),
        ].filter(Boolean);
        const linkedDeliveryOrderItems = doRef ? (itemGroups.get(doRef) || []) : [];

        if (doNumber && noSJ && doNumber === noSJ) {
            issues.push({
                kind: 'freight-nota-item',
                ref: item._id,
                message: `NO.SJ masih memakai DO internal (${doNumber})`,
            });
        }

        if (!noSJ) {
            issues.push({
                kind: 'freight-nota-item',
                ref: item._id,
                message: 'Baris nota tidak punya nomor SJ',
            });
        }

        if (!tujuan) {
            issues.push({
                kind: 'freight-nota-item',
                ref: item._id,
                message: 'Baris nota tidak punya tujuan',
            });
        }

        if (doRef && linkedDeliveryOrderItems.length > 1 && rowItemRefs.length === 0) {
            issues.push({
                kind: 'freight-nota-item',
                ref: item._id,
                message: `Baris nota DO multi-item harus mengacu ke item SJ spesifik, bukan gabungan (${barang || 'barang kosong'})`,
            });
        }
    }

    console.log('Delivery order / nota integrity audit');
    console.log('');
    console.log(`- Base URL: ${getBaseUrl()}`);
    console.log(`- Delivered rows checked: ${deliveredOrders.length}`);
    console.log(`- Nota rows checked: ${freightNotaItems.length}`);

    if (issues.length > 0) {
        console.log('');
        console.log('Issues found:');
        for (const issue of issues) {
            console.log(`- [${issue.kind}] ${issue.ref}: ${issue.message}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('Integrity audit OK: delivered DO final cargo data and nota SJ rows are consistent.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
