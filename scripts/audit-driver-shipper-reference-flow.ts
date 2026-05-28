import { loadScriptEnv } from './_env';

loadScriptEnv();

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
    cookieHeader: string,
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
            Cookie: cookieHeader,
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

async function main() {
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
        driverCookie: string;
    } | undefined;

    for (const candidatePair of candidatePairs) {
        const driverUser = candidatePair.driverUser;
        if (!driverUser) continue;
        try {
            const driverCookie = await loginAndGetCookieHeader({
                email: normalizeText(driverUser.email),
                password: process.env.AUDIT_DRIVER_PASSWORD || 'driver12345',
                scope: 'DRIVER',
            });
            selectedCandidate = {
                deliveryOrder: candidatePair.deliveryOrder,
                driverUser,
                driverCookie,
            };
            break;
        } catch {
            console.warn(
                `Driver shipper reference audit: skip kandidat ${normalizeText(driverUser.email) || driverUser._id} karena login driver gagal.`
            );
        }
    }

    if (!selectedCandidate) {
        console.log('Driver shipper reference audit SKIP: tidak ada DO aktif dengan driver, daftar SJ, dan akun driver yang bisa login pada seed saat ini.');
        return;
    }

    const { deliveryOrder: candidate, driverCookie } = selectedCandidate;

    const originalReferences = mapShipperReferences(candidate);
    assert(originalReferences.length > 0, `DO ${candidate.doNumber || candidate._id} tidak punya daftar SJ awal.`);

    const noOpResult = await postDriverCargoUpdate(driverCookie, {
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
        const appendResult = await postDriverCargoUpdate(driverCookie, {
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
        await postDriverCargoUpdate(driverCookie, {
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
    }

    console.log(
        `Driver shipper reference audit OK: ${candidate.doNumber || candidate._id} bisa no-op save, tambah SJ, lalu restore.`
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
