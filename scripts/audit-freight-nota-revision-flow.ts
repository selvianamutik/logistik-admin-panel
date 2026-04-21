import { loadScriptEnv } from './_env';
import { buildNotaRowsFromDeliveryOrder, type NotaItemRow } from '../src/lib/invoice-create-page-support';
import type { DeliveryOrder, DeliveryOrderItem, FreightNotaItem, Order } from '../src/lib/types';

loadScriptEnv();

type DeliveryOrderAuditState = DeliveryOrder & {
    freightNotaRef?: string | null;
    freightNotaNumber?: string | null;
};

type FreightNotaMutationResponse = {
    data?: {
        _id?: string;
    };
    id?: string;
    success?: boolean;
    error?: string;
};

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

async function postData<T>(cookieHeader: string, payload: Record<string, unknown>) {
    const response = await fetch(`${getBaseUrl()}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/invoices/new`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as T : {} as T;
    if (!response.ok) {
        throw new Error(`/api/data -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

function buildCandidateRows(params: {
    deliveryOrder: DeliveryOrder;
    orders: Order[];
    deliveryOrderItems: DeliveryOrderItem[];
}) {
    const rows = buildNotaRowsFromDeliveryOrder(params)
        .map(row => ({
            ...row,
            tarip: 1000,
            uangRp: Math.round((row.beratKg || 0) * 1000),
        }))
        .filter(row => !Number.isNaN(row.uangRp));

    const valid = rows.length > 0 && rows.every(row =>
        normalizeText(row.doRef) === normalizeText(params.deliveryOrder._id) &&
        normalizeText(row.noSJ) &&
        normalizeText(row.tujuan) &&
        Number.isFinite(row.beratKg) &&
        row.beratKg > 0 &&
        Number.isFinite(row.tarip) &&
        row.tarip > 0 &&
        row.uangRp > 0
    );

    return {
        rows,
        valid,
        customerRef: normalizeText(rows[0]?.customerRef) || normalizeText(params.deliveryOrder.customerRef),
        customerName: normalizeText(rows[0]?.customerName) || normalizeText(params.deliveryOrder.customerName),
    };
}

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const [deliveryOrderResponse, orderResponse, deliveryOrderItemResponse, freightNotaItemResponse] = await Promise.all([
        requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders', cookieHeader),
        requestJson<{ data: Order[] }>('/api/data?entity=orders', cookieHeader),
        requestJson<{ data: DeliveryOrderItem[] }>('/api/data?entity=delivery-order-items', cookieHeader),
        requestJson<{ data: FreightNotaItem[] }>('/api/data?entity=freight-nota-items', cookieHeader),
    ]);

    const deliveryOrders = Array.isArray(deliveryOrderResponse.data) ? deliveryOrderResponse.data : [];
    const orders = Array.isArray(orderResponse.data) ? orderResponse.data : [];
    const deliveryOrderItems = Array.isArray(deliveryOrderItemResponse.data) ? deliveryOrderItemResponse.data : [];
    const freightNotaItems = Array.isArray(freightNotaItemResponse.data) ? freightNotaItemResponse.data : [];

    const billedDoRefs = new Set(
        freightNotaItems
            .map(item => normalizeText(item.doRef))
            .filter(Boolean)
    );

    const prepared = deliveryOrders
        .filter(deliveryOrder => deliveryOrder.status === 'DELIVERED' && !billedDoRefs.has(normalizeText(deliveryOrder._id)))
        .map(deliveryOrder => ({
            deliveryOrder,
            ...buildCandidateRows({ deliveryOrder, orders, deliveryOrderItems }),
        }))
        .filter(candidate => candidate.valid && candidate.customerRef && candidate.customerName);

    const firstCandidate = prepared[0];
    assert(firstCandidate, 'Tidak ada DO delivered yang siap dibill untuk audit create nota.');

    const manualAuditRows: NotaItemRow[] = [{
        id: `manual-audit-${Date.now().toString(36)}`,
        doRef: '',
        customerRef: firstCandidate.customerRef,
        customerName: firstCandidate.customerName,
        doNumber: '',
        vehiclePlate: 'B 1234 AUDIT',
        date: '2026-04-21',
        noSJ: `MANUAL-AUDIT-${Date.now().toString().slice(-4)}`,
        dari: 'Gudang Audit Internal',
        tujuan: 'Tujuan Audit Sementara',
        barang: 'Barang Audit',
        collie: 1,
        beratKg: 10,
        tarip: 1000,
        uangRp: 10000,
        ket: 'Audit revisi nota untuk unlink/relink DO',
    }];

    let notaId = '';
    try {
        const createPayload = await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: '2026-04-21',
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: firstCandidate.rows,
            },
        });
        notaId = normalizeText(createPayload.data?._id) || normalizeText(createPayload.id);
        assert(notaId, 'Create nota berhasil tetapi ID nota tidak dikembalikan.');

        const createdDoState = await requestJson<{ data: DeliveryOrderAuditState }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(firstCandidate.deliveryOrder._id)}`,
            cookieHeader,
        );
        assert(
            normalizeText(createdDoState.data.freightNotaRef) === notaId,
            `DO ${firstCandidate.deliveryOrder.doNumber || firstCandidate.deliveryOrder._id} belum ter-link ke nota baru`
        );

        const createdRowsResponse = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
            cookieHeader,
        );
        const createdRows = Array.isArray(createdRowsResponse.data) ? createdRowsResponse.data : [];
        assert(
            createdRows.length === firstCandidate.rows.length,
            `Jumlah row nota awal harus ${firstCandidate.rows.length}, sekarang ${createdRows.length}`
        );
        for (const sourceRow of firstCandidate.rows) {
            const createdRow = createdRows.find(item =>
                normalizeText(item.doRef) === normalizeText(sourceRow.doRef) &&
                normalizeText(item.noSJ) === normalizeText(sourceRow.noSJ)
            );
            assert(createdRow, `Row nota awal ${sourceRow.noSJ} tidak ditemukan sesudah create.`);
            assert(
                normalizeText(createdRow.customerRef) === normalizeText(sourceRow.customerRef),
                `CustomerRef row ${sourceRow.noSJ} tidak tersimpan saat create nota.`
            );
            assert(
                normalizeText(createdRow.customerName) === normalizeText(sourceRow.customerName),
                `CustomerName row ${sourceRow.noSJ} tidak tersimpan saat create nota.`
            );
            if ((sourceRow.deliveryOrderItemRefs || []).length > 1) {
                assert(
                    Array.isArray(createdRow.deliveryOrderItemRefs) &&
                    createdRow.deliveryOrderItemRefs.length === sourceRow.deliveryOrderItemRefs?.length,
                    `deliveryOrderItemRefs row ${sourceRow.noSJ} belum tersimpan lengkap saat create nota.`
                );
            }
        }

        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'update-with-items',
            data: {
                id: notaId,
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: '2026-04-21',
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: manualAuditRows,
            },
        });

        const [unlinkedDoState, manualRowsResponse] = await Promise.all([
            requestJson<{ data: DeliveryOrderAuditState }>(
                `/api/data?entity=delivery-orders&id=${encodeURIComponent(firstCandidate.deliveryOrder._id)}`,
                cookieHeader,
            ),
            requestJson<{ data: FreightNotaItem[] }>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
                cookieHeader,
            ),
        ]);

        assert(
            !normalizeText(unlinkedDoState.data.freightNotaRef),
            `DO ${firstCandidate.deliveryOrder.doNumber || firstCandidate.deliveryOrder._id} masih ter-link setelah nota direvisi ke row manual`
        );

        const revisedRows = Array.isArray(manualRowsResponse.data) ? manualRowsResponse.data : [];
        assert(
            revisedRows.length === manualAuditRows.length,
            `Jumlah row nota manual harus ${manualAuditRows.length}, sekarang ${revisedRows.length}`
        );
        assert(
            revisedRows.every(row => !normalizeText(row.doRef) && normalizeText(row.noSJ) === normalizeText(manualAuditRows[0]?.noSJ)),
            'Row nota manual belum menggantikan row DO lama secara penuh.'
        );

        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'update-with-items',
            data: {
                id: notaId,
                customerRef: firstCandidate.customerRef,
                customerName: firstCandidate.customerName,
                issueDate: '2026-04-21',
                dueDate: '2026-04-28',
                billingMode: 'PER_KG',
                items: firstCandidate.rows,
            },
        });

        const [relinkedDoState, relinkedRowsResponse] = await Promise.all([
            requestJson<{ data: DeliveryOrderAuditState }>(
                `/api/data?entity=delivery-orders&id=${encodeURIComponent(firstCandidate.deliveryOrder._id)}`,
                cookieHeader,
            ),
            requestJson<{ data: FreightNotaItem[] }>(
                `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`,
                cookieHeader,
            ),
        ]);
        assert(
            normalizeText(relinkedDoState.data.freightNotaRef) === notaId,
            `DO ${firstCandidate.deliveryOrder.doNumber || firstCandidate.deliveryOrder._id} belum ter-link kembali setelah revisi kedua`
        );
        const relinkedRows = Array.isArray(relinkedRowsResponse.data) ? relinkedRowsResponse.data : [];
        assert(
            relinkedRows.length === firstCandidate.rows.length,
            `Jumlah row nota setelah relink harus ${firstCandidate.rows.length}, sekarang ${relinkedRows.length}`
        );
        assert(
            relinkedRows.every(row => normalizeText(row.doRef) === normalizeText(firstCandidate.deliveryOrder._id)),
            'Masih ada row manual tertinggal setelah nota direvisi kembali ke DO.'
        );

        await postData<FreightNotaMutationResponse>(cookieHeader, {
            entity: 'freight-notas',
            action: 'delete',
            data: { id: notaId },
        });
        notaId = '';

        const releasedNewDoState = await requestJson<{ data: DeliveryOrderAuditState }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(firstCandidate.deliveryOrder._id)}`,
            cookieHeader,
        );
        assert(
            !normalizeText(releasedNewDoState.data.freightNotaRef),
            `DO ${firstCandidate.deliveryOrder.doNumber || firstCandidate.deliveryOrder._id} masih ter-link setelah nota temporary dihapus`
        );
    } finally {
        if (notaId) {
            try {
                await postData<FreightNotaMutationResponse>(cookieHeader, {
                    entity: 'freight-notas',
                    action: 'delete',
                    data: { id: notaId },
                });
            } catch {
                // best effort cleanup
            }
        }
    }

    console.log(
        `Freight nota revision audit OK: create, revise ke manual, relink DO, replace rows, dan cleanup berhasil pada ${firstCandidate.deliveryOrder.doNumber}.`
    );
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
