import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import {
    createDocument,
    deleteDocument,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';

type DeliveryOrderLike = {
    _id: string;
    doNumber?: string;
    status?: string;
    driverRef?: string | null;
    cargoFinalizedAt?: string | null;
    pendingDriverStatus?: string | null;
    customerDoNumber?: string | null;
    shipperReferences?: Array<{
        referenceNumber?: string | null;
        pickupStopKey?: string | null;
    }> | null;
};

type UserLike = {
    _id: string;
    role?: string | null;
    active?: boolean | null;
    email?: string | null;
    driverRef?: string | null;
};

type DriverCargoResponse = {
    data?: {
        _id?: string;
        appendedCount?: number;
        shipperReferenceCount?: number;
    };
    error?: string;
};

type DriverMobileLoginResponse = {
    token?: string;
    error?: string;
};

type CreatedDocumentRef = [id: string, type: string];

const AUDIT_DATE = '2026-05-20';
const AUDIT_PREFIX = 'audit-shipper-ref';
const AUDIT_DO_PREFIX = 'AUD-SHIPPER-REF';

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

async function loginAndGetCookieHeader(params: {
    email: string;
    password: string;
    scope?: 'ADMIN' | 'DRIVER';
}) {
    const response = await fetch(`${getBaseUrl()}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/login`,
        },
        body: JSON.stringify(params),
    });

    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login ${params.scope || 'ADMIN'} gagal (${response.status}): ${bodyText}`);
    }

    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookieHeader = cookies
        .map(cookie => cookie.split(';')[0])
        .filter(Boolean)
        .join('; ');

    if (!cookieHeader) {
        throw new Error(`Login ${params.scope || 'ADMIN'} berhasil tetapi cookie session tidak diterima`);
    }

    return cookieHeader;
}

async function loginDriverAndGetAuthHeader(email: string, password: string) {
    const response = await fetch(`${getBaseUrl()}/api/driver/mobile/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/driver`,
        },
        body: JSON.stringify({ email, password }),
    });

    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as DriverMobileLoginResponse : {};
    if (!response.ok) {
        throw new Error(`Login DRIVER mobile gagal (${response.status}): ${bodyText}`);
    }
    if (!parsed.token) {
        throw new Error('Login DRIVER mobile berhasil tetapi token tidak diterima');
    }

    return `Bearer ${parsed.token}`;
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

async function postDriverCargoUpdate(
    driverAuthHeader: string,
    payload: {
        id: string;
        shipperReferences: Array<{
            referenceNumber: string;
            pickupStopKey?: string;
        }>;
        cargoItems: Array<Record<string, unknown>>;
    }
) {
    const response = await fetch(`${getBaseUrl()}/api/driver/delivery-orders/cargo`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/driver`,
            Authorization: driverAuthHeader,
        },
        body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as DriverCargoResponse : {};
    if (!response.ok) {
        throw new Error(`/api/driver/delivery-orders/cargo -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

function mapShipperReferences(deliveryOrder: DeliveryOrderLike) {
    const shipperReferences = Array.isArray(deliveryOrder.shipperReferences)
        ? deliveryOrder.shipperReferences
            .map(reference => ({
                referenceNumber: normalizeText(reference.referenceNumber).toUpperCase(),
                pickupStopKey: normalizeText(reference.pickupStopKey) || undefined,
            }))
            .filter(reference => reference.referenceNumber.length > 0)
        : [];

    if (shipperReferences.length > 0) {
        return shipperReferences;
    }

    const fallbackCustomerDoNumber = normalizeText(deliveryOrder.customerDoNumber).toUpperCase();
    if (!fallbackCustomerDoNumber) {
        return [];
    }

    return [{ referenceNumber: fallbackCustomerDoNumber, pickupStopKey: undefined }];
}

async function cleanupAuditFixture(deliveryOrderId: string, createdDocs: CreatedDocumentRef[]) {
    const [suratJalanItems, suratJalanDocs, tripAuditLogs] = await Promise.all([
        listDocumentsByFilter<{ _id: string }>('suratJalanItem', { tripRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: deliveryOrderId }).catch(() => []),
    ]);

    for (const item of suratJalanItems) await deleteDocument(item._id, 'suratJalanItem').catch(() => undefined);
    for (const item of suratJalanDocs) await deleteDocument(item._id, 'suratJalan').catch(() => undefined);
    for (const item of tripAuditLogs) await deleteDocument(item._id, 'auditLog').catch(() => undefined);
    await deleteDocument(deliveryOrderId, 'trip').catch(() => undefined);

    for (const [id, type] of [...createdDocs].reverse()) {
        const auditLogs = await listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: id }).catch(() => []);
        for (const auditLog of auditLogs) await deleteDocument(auditLog._id, 'auditLog').catch(() => undefined);
        await deleteDocument(id, type).catch(() => undefined);
    }
}

function isAuditFixtureDoc(doc: Record<string, unknown>) {
    return String(doc._id || '').startsWith(AUDIT_PREFIX) ||
        String(doc.doNumber || '').startsWith(AUDIT_DO_PREFIX) ||
        String(doc.masterResi || '').startsWith(`${AUDIT_DO_PREFIX}-RESI`) ||
        String(doc.email || '').startsWith(AUDIT_PREFIX);
}

async function cleanupStaleAuditFixtures() {
    const docTypes = ['deliveryOrder', 'order', 'user', 'driver'] as const;
    const staleRefs: CreatedDocumentRef[] = [];
    const deliveryOrderIds = new Set<string>();

    for (const docType of docTypes) {
        const docs = await listDocumentsByFilter<Record<string, unknown>>(docType, {}).catch(() => []);
        for (const doc of docs) {
            if (!isAuditFixtureDoc(doc)) continue;
            if (docType === 'deliveryOrder' && typeof doc._id === 'string') {
                deliveryOrderIds.add(doc._id);
            }
            staleRefs.push([String(doc._id), docType]);
        }
    }

    for (const deliveryOrderId of deliveryOrderIds) {
        await cleanupAuditFixture(deliveryOrderId, []);
    }
    for (const [id, type] of staleRefs.reverse()) {
        await deleteDocument(id, type).catch(() => undefined);
    }
}

async function createAuditFixture(): Promise<{
    deliveryOrder: DeliveryOrderLike;
    driverUser: UserLike;
    driverAuthHeader: string;
    cleanup: () => Promise<void>;
}> {
    const suffix = Date.now().toString().slice(-6);
    const createdDocs: CreatedDocumentRef[] = [];
    const driverId = `audit-shipper-ref-driver-${suffix}`;
    const userId = `audit-shipper-ref-user-${suffix}`;
    const orderId = `audit-shipper-ref-order-${suffix}`;
    const deliveryOrderId = `audit-shipper-ref-do-${suffix}`;
    const refA = `pickup-a-${suffix}`;
    const email = `audit-shipper-ref-${suffix}@driver.local`;
    const password = `Audit${suffix}!`;
    const sjA = `AUD-SHIPPER-REF-${suffix}-A`;

    try {
        await createDocument({
            _id: driverId,
            _type: 'driver',
            name: 'Audit Shipper Reference Driver',
            active: true,
        });
        createdDocs.push([driverId, 'driver']);

        await createDocument({
            _id: userId,
            _type: 'user',
            name: 'Audit Shipper Reference Driver',
            email,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName: 'Audit Shipper Reference Driver',
            passwordHash: await hashPassword(password),
        });
        createdDocs.push([userId, 'user']);

        await createDocument({
            _id: orderId,
            _type: 'order',
            masterResi: `AUD-SHIPPER-REF-RESI-${suffix}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerName: 'Audit Customer',
            pickupAddress: 'Audit Pickup',
            receiverName: 'Audit Receiver',
            receiverAddress: 'Audit Drop',
            serviceName: 'Audit Service',
            status: 'OPEN',
            createdAt: AUDIT_DATE,
        });
        createdDocs.push([orderId, 'order']);

        const deliveryOrder: DeliveryOrderLike = {
            _id: deliveryOrderId,
            doNumber: `AUD-SHIPPER-REF-${suffix}`,
            status: 'CREATED',
            driverRef: driverId,
            shipperReferences: [
                {
                    referenceNumber: sjA,
                    pickupStopKey: refA,
                },
            ],
        };
        await createDocument({
            ...deliveryOrder,
            _type: 'deliveryOrder',
            orderRef: orderId,
            masterResi: `AUD-SHIPPER-REF-RESI-${suffix}`,
            date: AUDIT_DATE,
            trackingState: 'ACTIVE',
            driverName: 'Audit Shipper Reference Driver',
            vehiclePlate: `AUD-${suffix}`,
            customerName: 'Audit Customer',
            pickupAddress: 'Audit Pickup',
            pickupStops: [
                {
                    _key: refA,
                    pickupAddress: 'Audit Pickup',
                },
            ],
            receiverName: 'Audit Receiver',
            receiverAddress: 'Audit Drop',
        });
        createdDocs.push([deliveryOrderId, 'deliveryOrder']);

        const driverUser: UserLike = {
            _id: userId,
            role: 'DRIVER',
            active: true,
            email,
            driverRef: driverId,
        };
        const driverAuthHeader = await loginDriverAndGetAuthHeader(email, password);

        return {
            deliveryOrder,
            driverUser,
            driverAuthHeader,
            cleanup: () => cleanupAuditFixture(deliveryOrderId, createdDocs),
        };
    } catch (error) {
        await cleanupAuditFixture(deliveryOrderId, createdDocs);
        throw error;
    }
}

async function main() {
    await cleanupStaleAuditFixtures();

    const adminCookie = await loginAndGetCookieHeader({
        email: process.env.AUDIT_LOGIN_EMAIL || 'owner@company.local',
        password: process.env.AUDIT_LOGIN_PASSWORD || 'owner12345',
    });

    const [deliveryOrderResponse, usersResponse] = await Promise.all([
        requestJson<{ data: DeliveryOrderLike[] }>('/api/data?entity=delivery-orders', adminCookie),
        requestJson<{ data: UserLike[] }>('/api/data?entity=users', adminCookie),
    ]);

    const deliveryOrders = Array.isArray(deliveryOrderResponse.data) ? deliveryOrderResponse.data : [];
    const users = Array.isArray(usersResponse.data) ? usersResponse.data : [];

    const candidatePairs = deliveryOrders
        .filter(item =>
            ['CREATED', 'ON_DELIVERY', 'ARRIVED'].includes(normalizeText(item.status)) &&
            normalizeText(item.driverRef) &&
            !normalizeText(item.cargoFinalizedAt) &&
            !normalizeText(item.pendingDriverStatus) &&
            mapShipperReferences(item).length > 0
        )
        .map(item => ({
            deliveryOrder: item,
            driverUser: users.find(user =>
                user.role === 'DRIVER' &&
                user.active !== false &&
                normalizeText(user.driverRef) === normalizeText(item.driverRef) &&
                normalizeText(user.email)
            ),
        }));

    let selectedCandidate: {
        deliveryOrder: DeliveryOrderLike;
        driverUser: UserLike;
        driverAuthHeader: string;
        cleanup?: () => Promise<void>;
    } | undefined;

    for (const candidatePair of candidatePairs) {
        const driverUser = candidatePair.driverUser;
        if (!driverUser) continue;
        try {
            const driverAuthHeader = await loginDriverAndGetAuthHeader(
                normalizeText(driverUser.email),
                process.env.AUDIT_DRIVER_PASSWORD || 'driver12345'
            );
            selectedCandidate = {
                deliveryOrder: candidatePair.deliveryOrder,
                driverUser,
                driverAuthHeader,
            };
            break;
        } catch {
            console.warn(
                `Driver shipper reference audit: skip kandidat ${normalizeText(driverUser.email) || driverUser._id} karena login driver gagal.`
            );
        }
    }

    if (!selectedCandidate) {
        console.log('Driver shipper reference audit: tidak ada kandidat seed yang cocok, membuat fixture audit sementara.');
        selectedCandidate = await createAuditFixture();
    }

    const { deliveryOrder: candidate, driverAuthHeader, cleanup } = selectedCandidate;

    const originalReferences = mapShipperReferences(candidate);
    assert(originalReferences.length > 0, `DO ${candidate.doNumber || candidate._id} tidak punya daftar SJ awal.`);

    const noOpResult = await postDriverCargoUpdate(driverAuthHeader, {
        id: candidate._id,
        shipperReferences: originalReferences,
        cargoItems: [],
    });
    assert(
        noOpResult.data?.appendedCount === 0,
        `No-op save driver harus 0 appendedCount, sekarang ${String(noOpResult.data?.appendedCount)}`
    );

    const tempReferenceNumber = `${originalReferences[0]?.referenceNumber || 'SJ'}-AUDIT-${Date.now().toString().slice(-4)}`;
    const extendedReferences = [
        ...originalReferences,
        {
            referenceNumber: tempReferenceNumber,
            pickupStopKey: originalReferences[0]?.pickupStopKey,
        },
    ];

    try {
        const appendResult = await postDriverCargoUpdate(driverAuthHeader, {
            id: candidate._id,
            shipperReferences: extendedReferences,
            cargoItems: [],
        });
        assert(
            appendResult.data?.shipperReferenceCount === extendedReferences.length,
            `Jumlah SJ setelah append harus ${extendedReferences.length}, sekarang ${String(appendResult.data?.shipperReferenceCount)}`
        );

        const updatedDeliveryOrderResponse = await requestJson<{ data: DeliveryOrderLike }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(candidate._id)}`,
            adminCookie,
        );
        const updatedReferences = mapShipperReferences(updatedDeliveryOrderResponse.data);
        assert(
            updatedReferences.some(reference => reference.referenceNumber === tempReferenceNumber),
            `DO ${candidate.doNumber || candidate._id} belum menyimpan SJ tambahan ${tempReferenceNumber}`
        );
    } finally {
        try {
            await postDriverCargoUpdate(driverAuthHeader, {
                id: candidate._id,
                shipperReferences: originalReferences,
                cargoItems: [],
            });

            const restoredDeliveryOrderResponse = await requestJson<{ data: DeliveryOrderLike }>(
                `/api/data?entity=delivery-orders&id=${encodeURIComponent(candidate._id)}`,
                adminCookie,
            );
            const restoredReferences = mapShipperReferences(restoredDeliveryOrderResponse.data);
            assert(
                JSON.stringify(restoredReferences) === JSON.stringify(originalReferences),
                `DO ${candidate.doNumber || candidate._id} gagal dikembalikan ke daftar SJ awal`
            );
        } finally {
            if (cleanup) {
                await cleanup();
            }
        }
    }

    console.log(
        `Driver shipper reference audit OK: ${candidate.doNumber || candidate._id} bisa no-op save, tambah SJ, lalu restore.`
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
