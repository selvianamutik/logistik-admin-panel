import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import { getBusinessDateValue } from '../src/lib/business-date';
import {
    createDocument,
    deleteDocument,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type DriverLoginResponse = {
    token?: string;
    error?: string;
};

type IncidentLike = {
    _id: string;
    _rev?: string;
    incidentNumber?: string;
    status?: string;
    relatedDeliveryOrderRef?: string;
    driverRef?: string;
};

type IncidentSettlementLineLike = {
    _id: string;
    _rev?: string;
    incidentRef?: string;
    lineType?: string;
    category?: string;
    amount?: number;
    description?: string;
    status?: string;
    linkedExpenseRef?: string;
};

type ReferenceDocLike = {
    _id: string;
    name?: string | null;
    customerName?: string | null;
    serviceName?: string | null;
    active?: boolean | null;
};

const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);
const AUDIT_SUFFIX = Date.now().toString().slice(-6);

function getBaseUrl() {
    return (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function auditStep(message: string) {
    console.log(`[audit:driver-incident] ${message}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout setelah ${REQUEST_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function loginAdmin() {
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/auth/login`, {
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
    }, 'Login admin');
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

async function loginDriver(email: string, password: string) {
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/driver/mobile/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/driver`,
        },
        body: JSON.stringify({
            email,
            password,
        }),
    }, 'Login mobile driver');
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as DriverLoginResponse : {};
    if (!response.ok) {
        throw new Error(`Login mobile driver ${email} gagal (${response.status}): ${bodyText}`);
    }
    assert(parsed.token, `Login mobile driver ${email} tidak mengembalikan token`);
    return parsed.token;
}

async function requestJson<T>(path: string, cookieHeader: string) {
    const response = await fetchWithTimeout(`${getBaseUrl()}${path}`, {
        headers: {
            Cookie: cookieHeader,
        },
    }, `GET ${path}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`${path} -> ${response.status}: ${bodyText}`);
    }
    return JSON.parse(bodyText) as T;
}

async function postData<T>(
    cookieHeader: string,
    payload: Record<string, unknown>,
    options?: { expectStatus?: number }
) {
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/fleet/incidents`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
    }, 'POST /api/data');
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as ApiResponse<T> : {};
    if (options?.expectStatus) {
        assert(
            response.status === options.expectStatus,
            `/api/data expected ${options.expectStatus}, got ${response.status}: ${bodyText}`
        );
        return parsed;
    }
    if (!response.ok) {
        throw new Error(`/api/data -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

async function driverRequest<T>(
    method: 'GET' | 'POST' | 'PATCH',
    token: string,
    path: string,
    payload?: Record<string, unknown>,
    options?: { expectStatus?: number }
) {
    const response = await fetchWithTimeout(`${getBaseUrl()}${path}`, {
        method,
        headers: {
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
        },
        body: payload ? JSON.stringify(payload) : undefined,
    }, `${method} ${path}`);
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as ApiResponse<T> : {};
    if (options?.expectStatus) {
        assert(
            response.status === options.expectStatus,
            `${method} ${path} expected ${options.expectStatus}, got ${response.status}: ${bodyText}`
        );
        return parsed;
    }
    if (!response.ok) {
        throw new Error(`${method} ${path} -> ${response.status}: ${bodyText}`);
    }
    return parsed;
}

async function cleanupIncident(incidentId?: string) {
    if (!incidentId) return;
    const [lines, logs, audits] = await Promise.all([
        listDocumentsByFilter<IncidentSettlementLineLike>('incidentSettlementLine', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('incidentActionLog', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: incidentId }).catch(() => []),
    ]);
    for (const line of lines) {
        const lineAudits = await listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: line._id }).catch(() => []);
        for (const audit of lineAudits) {
            await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
        }
        await deleteDocument(line._id, 'incidentSettlementLine').catch(() => undefined);
    }
    for (const log of logs) {
        await deleteDocument(log._id, 'incidentActionLog').catch(() => undefined);
    }
    for (const audit of audits) {
        await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    }
    await deleteDocument(incidentId, 'incident').catch(() => undefined);
}

async function cleanupDocumentWithAudits(id: string, type: string) {
    const audits = await listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: id }).catch(() => []);
    for (const audit of audits) {
        await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    }
    await deleteDocument(id, type).catch(() => undefined);
}

async function main() {
    const adminCookie = await loginAdmin();
    let createdIncidentId = '';
    let createdFollowupIncidentId = '';
    const createdDirectDocs: Array<[string, string]> = [];

    try {
        auditStep('siapkan DO dan akun driver khusus audit');
        const [customersResponse, servicesResponse] = await Promise.all([
            requestJson<{ data: ReferenceDocLike[] }>('/api/data?entity=customers&pageSize=100', adminCookie),
            requestJson<{ data: ReferenceDocLike[] }>('/api/data?entity=services&pageSize=100', adminCookie),
        ]);
        const customer = (customersResponse.data || []).find(item => item.active !== false);
        const service = (servicesResponse.data || []).find(item => item.active !== false);
        assert(customer, 'Audit driver incident butuh customer aktif');
        assert(service, 'Audit driver incident butuh service aktif');

        const driverId = `audit-driver-incident-driver-${AUDIT_SUFFIX}`;
        const vehicleId = `audit-driver-incident-vehicle-${AUDIT_SUFFIX}`;
        const userId = `audit-driver-incident-user-${AUDIT_SUFFIX}`;
        const orderId = `audit-driver-incident-order-${AUDIT_SUFFIX}`;
        const deliveryOrderId = `audit-driver-incident-do-${AUDIT_SUFFIX}`;
        const driverName = `Audit Driver Incident ${AUDIT_SUFFIX}`;
        const driverEmail = `audit-driver-incident-${AUDIT_SUFFIX}@driver.local`;
        const driverPassword = `Audit${AUDIT_SUFFIX}!`;
        const vehiclePlate = `AUD-INC-${AUDIT_SUFFIX}`;
        const orderNumber = `AUD-INC-ORDER-${AUDIT_SUFFIX}`;
        const doNumber = `AUD-INC-DO-${AUDIT_SUFFIX}`;
        const auditDate = getBusinessDateValue();
        const customerName = customer.customerName || customer.name || 'Audit Customer';
        const serviceName = service.serviceName || service.name || 'Audit Service';

        await createDocument({
            _id: driverId,
            _type: 'driver',
            name: driverName,
            active: true,
        });
        createdDirectDocs.push([driverId, 'driver']);
        await createDocument({
            _id: vehicleId,
            _type: 'vehicle',
            plateNumber: vehiclePlate,
            status: 'AVAILABLE',
            active: true,
        });
        createdDirectDocs.push([vehicleId, 'vehicle']);
        await createDocument({
            _id: userId,
            _type: 'user',
            name: driverName,
            email: driverEmail,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName,
            passwordHash: await hashPassword(driverPassword),
        });
        createdDirectDocs.push([userId, 'user']);
        await createDocument({
            _id: orderId,
            _type: 'order',
            masterResi: orderNumber,
            customerRef: customer._id,
            customerName,
            pickupAddress: 'Audit Incident Pickup',
            serviceRef: service._id,
            serviceName,
            status: 'IN_PROGRESS',
            notes: `Audit driver incident ${AUDIT_SUFFIX}`,
            createdAt: new Date().toISOString(),
        });
        createdDirectDocs.push([orderId, 'order']);
        await createDocument({
            _id: deliveryOrderId,
            _type: 'deliveryOrder',
            doNumber,
            orderRef: orderId,
            masterResi: orderNumber,
            customerRef: customer._id,
            customerName,
            pickupAddress: 'Audit Incident Pickup',
            serviceRef: service._id,
            serviceName,
            status: 'ON_DELIVERY',
            date: auditDate,
            driverRef: driverId,
            driverName,
            vehicleRef: vehicleId,
            vehiclePlate,
        });
        createdDirectDocs.push([deliveryOrderId, 'deliveryOrder']);

        const driverToken = await loginDriver(driverEmail, driverPassword);

        auditStep('driver membuat laporan insiden untuk DO miliknya');
        const incidentCreate = await driverRequest<IncidentLike>('POST', driverToken, '/api/driver/incidents', {
            relatedDeliveryOrderRef: deliveryOrderId,
            incidentType: 'OTHER',
            urgency: 'LOW',
            locationText: `Audit incident location ${AUDIT_SUFFIX}`,
            odometer: 12345,
            description: `Audit incident driver flow ${AUDIT_SUFFIX}`,
        });
        const incident = incidentCreate.data;
        assert(incident?._id, 'Create incident driver tidak mengembalikan incident id');
        createdIncidentId = incident._id;
        assert(incident.status === 'OPEN', 'Incident baru dari driver harus berstatus OPEN');
        assert(
            incident.relatedDeliveryOrderRef === deliveryOrderId,
            'Incident driver harus terhubung ke DO yang dipilih'
        );

        auditStep('driver tidak boleh membuat laporan insiden baru saat incident aktif belum ditutup');
        await driverRequest('POST', driverToken, '/api/driver/incidents', {
            relatedDeliveryOrderRef: deliveryOrderId,
            incidentType: 'OTHER',
            urgency: 'LOW',
            locationText: `Duplicate active incident ${AUDIT_SUFFIX}`,
            odometer: 12346,
            description: 'Duplicate incident harus ditolak',
        }, { expectStatus: 409 });

        auditStep('driver list melihat incident dan menambah biaya draft');
        const incidentList = await driverRequest<IncidentLike[]>('GET', driverToken, '/api/driver/incidents');
        assert(
            (incidentList.data || []).some(item => item._id === createdIncidentId),
            'Incident baru tidak muncul di list mobile driver'
        );

        const costSubmission = await driverRequest<{ incident: IncidentLike; settlementLines: IncidentSettlementLineLike[] }>(
            'PATCH',
            driverToken,
            '/api/driver/incidents',
            {
                action: 'submit-resolution',
                incidentRef: createdIncidentId,
                resolutionNote: `Audit additional cost ${AUDIT_SUFFIX}`,
                resolutionLocationText: `Audit cost location ${AUDIT_SUFFIX}`,
                resolutionOdometer: 12400,
                costs: [
                    {
                        category: 'REPAIR',
                        amount: 125000,
                        description: `Audit repair cost ${AUDIT_SUFFIX}`,
                        payeeName: 'Bengkel Audit',
                        note: 'Harus review admin',
                    },
                ],
            }
        );
        const createdLine = costSubmission.data?.settlementLines?.[0];
        assert(
            costSubmission.data?.incident?.status === 'OPEN',
            'Tambahan biaya driver tidak boleh otomatis mengubah status incident'
        );
        assert(createdLine?._id, 'Tambahan biaya driver harus membuat settlement line draft');
        assert(createdLine.status === 'DRAFT', 'Biaya dari driver harus masuk sebagai DRAFT untuk approval admin');
        assert(createdLine.amount === 125000, 'Nominal biaya incident dari driver berubah sebelum approval admin');

        auditStep('driver submit penyelesaian tanpa biaya dan tidak boleh dobel');
        const resolution = await driverRequest<{ incident: IncidentLike; settlementLines: IncidentSettlementLineLike[] }>(
            'PATCH',
            driverToken,
            '/api/driver/incidents',
            {
                action: 'submit-resolution',
                incidentRef: createdIncidentId,
                resolutionNote: `Audit resolution ${AUDIT_SUFFIX}`,
                resolutionLocationText: `Audit resolution location ${AUDIT_SUFFIX}`,
                resolutionOdometer: 12450,
                costs: [],
            }
        );
        assert(resolution.data?.incident?.status === 'IN_PROGRESS', 'Submit penyelesaian driver harus menaikkan incident ke IN_PROGRESS');
        assert((resolution.data?.settlementLines || []).length === 0, 'Submit penyelesaian tanpa biaya tidak boleh membuat settlement line tambahan');

        await driverRequest('PATCH', driverToken, '/api/driver/incidents', {
            action: 'submit-resolution',
            incidentRef: createdIncidentId,
            resolutionNote: 'Duplicate audit resolution',
        }, { expectStatus: 409 });

        auditStep('admin approve biaya draft dan edit langsung setelah approve harus ditolak');
        const lineDetail = await requestJson<{ data: IncidentSettlementLineLike }>(
            `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(createdLine._id)}`,
            adminCookie
        );
        assert(lineDetail.data?._id, 'Detail biaya incident tidak bisa dibaca admin untuk approval');
        const approvedLine = await postData<IncidentSettlementLineLike>(adminCookie, {
            entity: 'incident-settlement-lines',
            action: 'set-status',
            data: {
                id: createdLine._id,
                revision: lineDetail.data._rev || '',
                status: 'APPROVED',
            },
        });
        assert(approvedLine.data?.status === 'APPROVED', 'Admin approval biaya incident tidak menghasilkan status APPROVED');

        await postData(adminCookie, {
            entity: 'incident-settlement-lines',
            action: 'update',
            data: {
                id: createdLine._id,
                revision: approvedLine.data?._rev || '',
                updates: {
                    description: 'Edit seharusnya ditolak setelah approve',
                },
            },
        }, { expectStatus: 409 });

        auditStep('incident tidak boleh ditutup selama biaya approved belum diposting atau void');
        const incidentDetail = await requestJson<{ data: IncidentLike }>(
            `/api/data?entity=incidents&id=${encodeURIComponent(createdIncidentId)}`,
            adminCookie
        );
        assert(incidentDetail.data?._id, 'Incident tidak bisa dibaca admin untuk status update');
        const resolvedIncident = await postData<IncidentLike>(adminCookie, {
            entity: 'incidents',
            action: 'set-status',
            data: {
                id: createdIncidentId,
                revision: incidentDetail.data._rev || '',
                status: 'RESOLVED',
                note: 'Audit admin resolved incident',
            },
        });
        assert(resolvedIncident.data?.status === 'RESOLVED', 'Admin gagal mengubah incident ke RESOLVED');

        await driverRequest('POST', driverToken, '/api/driver/incidents', {
            relatedDeliveryOrderRef: deliveryOrderId,
            incidentType: 'OTHER',
            urgency: 'LOW',
            locationText: `Duplicate resolved incident ${AUDIT_SUFFIX}`,
            odometer: 12450,
            description: 'Incident RESOLVED tapi belum CLOSED harus tetap menahan laporan baru',
        }, { expectStatus: 409 });

        const resolvedDetail = await requestJson<{ data: IncidentLike }>(
            `/api/data?entity=incidents&id=${encodeURIComponent(createdIncidentId)}`,
            adminCookie
        );
        await postData(adminCookie, {
            entity: 'incidents',
            action: 'set-status',
            data: {
                id: createdIncidentId,
                revision: resolvedDetail.data?._rev || '',
                status: 'CLOSED',
                note: 'Close harus tertahan pending settlement',
            },
        }, { expectStatus: 409 });

        auditStep('setelah incident ditutup admin, driver boleh membuat laporan insiden baru untuk DO yang sama');
        const approvedLineAfterCloseGuard = await requestJson<{ data: IncidentSettlementLineLike }>(
            `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(createdLine._id)}`,
            adminCookie
        );
        const voidLine = await postData<IncidentSettlementLineLike>(adminCookie, {
            entity: 'incident-settlement-lines',
            action: 'set-status',
            data: {
                id: createdLine._id,
                revision: approvedLineAfterCloseGuard.data?._rev || '',
                status: 'VOID',
            },
        });
        assert(voidLine.data?.status === 'VOID', 'Biaya incident tidak bisa di-void untuk menutup incident audit');
        const closableIncidentDetail = await requestJson<{ data: IncidentLike }>(
            `/api/data?entity=incidents&id=${encodeURIComponent(createdIncidentId)}`,
            adminCookie
        );
        const closedIncident = await postData<IncidentLike>(adminCookie, {
            entity: 'incidents',
            action: 'set-status',
            data: {
                id: createdIncidentId,
                revision: closableIncidentDetail.data?._rev || '',
                status: 'CLOSED',
                note: 'Audit admin close setelah biaya void',
            },
        });
        assert(closedIncident.data?.status === 'CLOSED', 'Admin gagal menutup incident setelah settlement void');

        const followupIncident = await driverRequest<IncidentLike>('POST', driverToken, '/api/driver/incidents', {
            relatedDeliveryOrderRef: deliveryOrderId,
            incidentType: 'OTHER',
            urgency: 'LOW',
            locationText: `Follow up incident after close ${AUDIT_SUFFIX}`,
            odometer: 12500,
            description: 'Incident baru setelah incident lama ditutup admin',
        });
        assert(followupIncident.data?._id, 'Driver harus bisa membuat incident baru setelah incident lama CLOSED');
        createdFollowupIncidentId = followupIncident.data._id;

        console.log(
            `Driver incident audit OK: ${incident.incidentNumber || createdIncidentId} create, active duplicate report guard, submit draft cost, admin approve, duplicate guard, close guard, dan reopen report after CLOSED valid.`
        );
    } finally {
        await cleanupIncident(createdFollowupIncidentId);
        await cleanupIncident(createdIncidentId);
        for (const [id, type] of createdDirectDocs.reverse()) {
            await cleanupDocumentWithAudits(id, type);
        }
    }
}

main().catch(async error => {
    console.error(error);
    process.exit(1);
});
