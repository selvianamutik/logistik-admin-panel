import { loadScriptEnv, requireAnyEnv } from './_env';

loadScriptEnv();

import { mapDeliveryOrderToSuratJalanRecords } from '../src/lib/trip-document-mappers';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';
import type { CargoSummary, SuratJalanDocument } from '../src/lib/trip-document-types';

type AuditIssue = {
    kind: string;
    ref: string;
    message: string;
};

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundQuantity(value: number, fractionDigits = 3) {
    const factor = 10 ** fractionDigits;
    return Math.round(value * factor) / factor;
}

function nearlyEqual(a: number, b: number, fractionDigits = 3) {
    return Math.abs(roundQuantity(a, fractionDigits) - roundQuantity(b, fractionDigits)) <= 1 / (10 ** fractionDigits);
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

    if (!cookieHeader) {
        throw new Error('Login admin berhasil tetapi cookie session tidak diterima');
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

async function deleteStaleSuratJalanDocument(sourceDocumentId: string) {
    const supabaseUrl = requireAnyEnv([
        'SUPABASE_URL',
        'SUPABASE_PROJECT_URL',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_PROJECT_URL',
    ]).replace(/\/+$/, '');
    const serviceRoleKey = requireAnyEnv([
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_SERVICE_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE',
    ]);

    const response = await fetch(
        `${supabaseUrl}/rest/v1/surat_jalan_documents?source_document_id=eq.${encodeURIComponent(sourceDocumentId)}`,
        {
            method: 'DELETE',
            headers: {
                apikey: serviceRoleKey,
                Authorization: `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Gagal hapus dokumen SJ stale ${sourceDocumentId}: ${await response.text()}`);
    }
}

function compareCargoSummary(
    issues: AuditIssue[],
    params: {
        label: string;
        ref: string;
        expected: CargoSummary;
        actual: CargoSummary;
    },
) {
    const fields: Array<keyof CargoSummary> = ['qtyKoli', 'weightKg', 'volumeM3'];
    for (const field of fields) {
        const fractionDigits = field === 'volumeM3' ? 3 : 2;
        const expected = normalizeNumber(params.expected?.[field]);
        const actual = normalizeNumber(params.actual?.[field]);
        if (!nearlyEqual(expected, actual, fractionDigits)) {
            issues.push({
                kind: 'surat-jalan',
                ref: params.ref,
                message: `${params.label}.${field} mismatch: expected ${expected}, actual ${actual}`,
            });
        }
    }
}

async function main() {
    const shouldFix = process.argv.includes('--fix');
    const cookieHeader = await loginAndGetCookieHeader();
    const [deliveryOrderResponse, deliveryOrderItemResponse, suratJalanResponse] = await Promise.all([
        requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders&pageSize=1000', cookieHeader),
        requestJson<{ data: DeliveryOrderItem[] }>('/api/data?entity=delivery-order-items&pageSize=2000', cookieHeader),
        requestJson<{ data: SuratJalanDocument[] }>('/api/data?entity=surat-jalan&pageSize=2000', cookieHeader),
    ]);

    const deliveryOrders = Array.isArray(deliveryOrderResponse.data) ? deliveryOrderResponse.data : [];
    const deliveryOrderItems = Array.isArray(deliveryOrderItemResponse.data) ? deliveryOrderItemResponse.data : [];
    const suratJalanDocuments = Array.isArray(suratJalanResponse.data) ? suratJalanResponse.data : [];

    const itemsByDeliveryOrderRef = new Map<string, DeliveryOrderItem[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = itemsByDeliveryOrderRef.get(deliveryOrderRef) || [];
        current.push(item);
        itemsByDeliveryOrderRef.set(deliveryOrderRef, current);
    }

    const actualDocumentsByTripRef = new Map<string, SuratJalanDocument[]>();
    for (const document of suratJalanDocuments) {
        const tripRef = normalizeText(document.tripRef || document.sourceDeliveryOrderRef);
        if (!tripRef) continue;
        const current = actualDocumentsByTripRef.get(tripRef) || [];
        current.push(document);
        actualDocumentsByTripRef.set(tripRef, current);
    }

    const issues: AuditIssue[] = [];
    const staleDocumentIds: string[] = [];
    const expectedDocumentIds = new Set<string>();
    let checkedDocumentCount = 0;

    for (const deliveryOrder of deliveryOrders) {
        const linkedItems = itemsByDeliveryOrderRef.get(deliveryOrder._id) || [];
        const expectedDocuments = mapDeliveryOrderToSuratJalanRecords(deliveryOrder, linkedItems);
        const actualDocuments = actualDocumentsByTripRef.get(deliveryOrder._id) || [];
        const actualDocumentsById = new Map(actualDocuments.map(document => [document._id, document]));

        for (const expected of expectedDocuments) {
            expectedDocumentIds.add(expected._id);
            const actual = actualDocumentsById.get(expected._id);
            checkedDocumentCount += 1;
            if (!actual) {
                issues.push({
                    kind: 'surat-jalan',
                    ref: expected._id,
                    message: `Dokumen SJ missing untuk DO ${deliveryOrder.doNumber || deliveryOrder._id}`,
                });
                continue;
            }

            if (normalizeText(actual.suratJalanNumber) !== normalizeText(expected.suratJalanNumber)) {
                issues.push({
                    kind: 'surat-jalan',
                    ref: actual._id,
                    message: `Nomor SJ mismatch: expected ${expected.suratJalanNumber}, actual ${actual.suratJalanNumber}`,
                });
            }

            if (normalizeText(actual.tripStatus) !== normalizeText(expected.tripStatus)) {
                issues.push({
                    kind: 'surat-jalan',
                    ref: actual._id,
                    message: `Status SJ mismatch: expected ${expected.tripStatus}, actual ${actual.tripStatus}`,
                });
            }

            if (normalizeNumber(actual.itemCount) !== normalizeNumber(expected.itemCount)) {
                issues.push({
                    kind: 'surat-jalan',
                    ref: actual._id,
                    message: `Item count mismatch: expected ${expected.itemCount}, actual ${actual.itemCount}`,
                });
            }

            compareCargoSummary(issues, {
                label: 'cargoSummary',
                ref: actual._id,
                expected: expected.cargoSummary,
                actual: actual.cargoSummary,
            });
            compareCargoSummary(issues, {
                label: 'billableCargo',
                ref: actual._id,
                expected: expected.billableCargo,
                actual: actual.billableCargo,
            });
            compareCargoSummary(issues, {
                label: 'holdCargo',
                ref: actual._id,
                expected: expected.holdCargo,
                actual: actual.holdCargo,
            });
            compareCargoSummary(issues, {
                label: 'returnCargo',
                ref: actual._id,
                expected: expected.returnCargo,
                actual: actual.returnCargo,
            });
        }
    }

    for (const actual of suratJalanDocuments) {
        const tripRef = normalizeText(actual.tripRef || actual.sourceDeliveryOrderRef);
        if (!tripRef) continue;
        if (!expectedDocumentIds.has(actual._id)) {
            staleDocumentIds.push(actual._id);
            issues.push({
                kind: 'surat-jalan-stale',
                ref: actual._id,
                message: `Dokumen SJ stale masih tersimpan untuk trip ${tripRef}: ${actual.suratJalanNumber || '-'}`,
            });
        }
    }

    if (issues.length > 0) {
        const nonFixableIssues = issues.filter(issue => issue.kind !== 'surat-jalan-stale');
        if (shouldFix && staleDocumentIds.length > 0 && nonFixableIssues.length === 0) {
            for (const staleDocumentId of staleDocumentIds) {
                await deleteStaleSuratJalanDocument(staleDocumentId);
            }
            console.log(`Delivery order/SJ invariant repair OK: ${staleDocumentIds.length} dokumen SJ stale dihapus.`);
            return;
        }

        throw new Error(`Delivery order/SJ invariant mismatch ditemukan:\n${JSON.stringify(issues.slice(0, 25), null, 2)}`);
    }

    console.log(
        `Delivery order/SJ invariant audit OK: ${deliveryOrders.length} DO, ${checkedDocumentCount} expected SJ, ${suratJalanDocuments.length} dokumen SJ tersimpan sinkron.`
    );
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
