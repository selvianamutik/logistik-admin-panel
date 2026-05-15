import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type {
    BankAccount,
    Customer,
    DeliveryOrder,
    DeliveryOrderItem,
    Driver,
    Incident,
    IncidentSettlementLine,
    Order,
    Service,
    User,
    Vehicle,
} from '../src/lib/types';
import type { SuratJalanDocument } from '../src/lib/trip-document-types';

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type CreatedState = {
    orderId?: string;
    deliveryOrderId?: string;
    driverId?: string;
    vehicleId?: string;
    userId?: string;
    incidentId?: string;
};

const AUDIT_DATE = '2026-04-22';
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);

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

function auditStep(message: string) {
    console.log(`[audit:driver-approval-corrections] ${message}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
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
        body: JSON.stringify({ email, password }),
    }, 'Login mobile driver');
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as { token?: string; error?: string } : {};
    if (!response.ok) {
        throw new Error(`Login mobile driver gagal (${response.status}): ${bodyText}`);
    }
    assert(parsed.token, 'Login mobile driver tidak mengembalikan token');
    return parsed.token;
}

async function requestJson<T>(path: string, cookieHeader: string) {
    const response = await fetchWithTimeout(`${getBaseUrl()}${path}`, {
        headers: { Cookie: cookieHeader },
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
            Referer: `${getBaseUrl()}/dashboard`,
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
    method: 'POST' | 'PATCH' | 'DELETE',
    token: string,
    path: string,
    payload: Record<string, unknown>,
    options?: { expectStatus?: number }
) {
    const response = await fetchWithTimeout(`${getBaseUrl()}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
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

async function getDeliveryOrderItems(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: DeliveryOrderItem[] }>(
        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderId }))}&pageSize=100`,
        cookieHeader
    );
    return Array.isArray(response.data) ? response.data : [];
}

async function getSuratJalanDocuments(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: SuratJalanDocument[] }>(
        `/api/data?entity=surat-jalan&filter=${encodeURIComponent(JSON.stringify({ tripRef: deliveryOrderId }))}&pageSize=100`,
        cookieHeader
    );
    return Array.isArray(response.data) ? response.data : [];
}

function getSuratJalanRef(deliveryOrderId: string, documents: SuratJalanDocument[], number: string) {
    return documents.find(document => document.suratJalanNumber === number)?._id || `${deliveryOrderId}:${number}`;
}

async function cleanupIncident(incidentId?: string) {
    if (!incidentId) return;
    const [lines, logs, audits] = await Promise.all([
        listDocumentsByFilter<{ _id: string }>('incidentSettlementLine', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('incidentActionLog', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: incidentId }).catch(() => []),
    ]);
    for (const line of lines) {
        const lineAudits = await listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: line._id }).catch(() => []);
        for (const audit of lineAudits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
        await deleteDocument(line._id, 'incidentSettlementLine').catch(() => undefined);
    }
    for (const log of logs) await deleteDocument(log._id, 'incidentActionLog').catch(() => undefined);
    for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    await deleteDocument(incidentId, 'incident').catch(() => undefined);
}

async function cleanupState(state: CreatedState) {
    await cleanupIncident(state.incidentId);
    if (state.deliveryOrderId) {
        const [deliveryOrderItems, suratJalanItems, suratJalanDocs, trackingLogs, auditLogs, vouchers] = await Promise.all([
            listDocumentsByFilter<{ _id: string; orderItemRef?: string }>('deliveryOrderItem', { deliveryOrderRef: state.deliveryOrderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('suratJalanItem', { tripRef: state.deliveryOrderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: state.deliveryOrderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('trackingLog', { refRef: state.deliveryOrderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: state.deliveryOrderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('driverVoucher', { deliveryOrderRef: state.deliveryOrderId }).catch(() => []),
        ]);
        for (const item of deliveryOrderItems) {
            await deleteDocument(item._id, 'deliveryOrderItem').catch(() => undefined);
            if (item.orderItemRef) {
                await deleteDocument(item.orderItemRef, 'orderItem').catch(() => undefined);
            }
        }
        for (const item of suratJalanItems) await deleteDocument(item._id, 'suratJalanItem').catch(() => undefined);
        for (const item of suratJalanDocs) await deleteDocument(item._id, 'suratJalan').catch(() => undefined);
        for (const item of trackingLogs) await deleteDocument(item._id, 'trackingLog').catch(() => undefined);
        for (const item of auditLogs) await deleteDocument(item._id, 'auditLog').catch(() => undefined);
        for (const item of vouchers) await deleteDocument(item._id, 'driverVoucher').catch(() => undefined);
        await deleteDocument(state.deliveryOrderId, 'trip').catch(() => undefined);
        await deleteDocument(state.deliveryOrderId, 'deliveryOrder').catch(() => undefined);
    }
    if (state.orderId) {
        const [orderItems, audits] = await Promise.all([
            listDocumentsByFilter<{ _id: string }>('orderItem', { orderRef: state.orderId }).catch(() => []),
            listDocumentsByFilter<{ _id: string }>('auditLog', { entityRef: state.orderId }).catch(() => []),
        ]);
        for (const item of orderItems) await deleteDocument(item._id, 'orderItem').catch(() => undefined);
        for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
        await deleteDocument(state.orderId, 'order').catch(() => undefined);
    }
    if (state.userId) await deleteDocument(state.userId, 'user').catch(() => undefined);
    if (state.driverId) await deleteDocument(state.driverId, 'driver').catch(() => undefined);
    if (state.vehicleId) await deleteDocument(state.vehicleId, 'vehicle').catch(() => undefined);
}

async function createAuditDriverResources(params: {
    service: Service;
    suffix: string;
    password: string;
    state: CreatedState;
}) {
    const now = new Date().toISOString();
    const serviceName = normalizeText(params.service.name) || 'Audit Service';
    const driverId = `drv-audit-approval-${params.suffix}`;
    const vehicleId = `veh-audit-approval-${params.suffix}`;
    const userId = `usr-audit-approval-${params.suffix}`;
    const driverName = `Audit Approval Driver ${params.suffix}`;
    const email = `audit.approval.${params.suffix}@company.local`;
    await createDocument<Driver>({
        _id: driverId,
        _type: 'driver',
        name: driverName,
        phone: `08129${params.suffix}`,
        licenseNumber: `SIM-APP-${params.suffix}`,
        ktpNumber: `KTP-APP-${params.suffix}`,
        simExpiry: '2027-12-31',
        address: 'Audit approval correction resource',
        active: true,
    });
    params.state.driverId = driverId;

    await createDocument<Vehicle>({
        _id: vehicleId,
        _type: 'vehicle',
        unitCode: `APP-${params.suffix}`,
        plateNumber: `APP ${params.suffix.slice(-4)} QA`,
        vehicleType: serviceName,
        brandModel: 'Audit approval temporary unit',
        year: 2026,
        capacityKg: 4500,
        serviceRef: params.service._id,
        serviceName,
        status: 'ACTIVE',
        lastOdometer: 1000,
        lastOdometerAt: AUDIT_DATE,
    });
    params.state.vehicleId = vehicleId;

    await createDocument<User>({
        _id: userId,
        _type: 'user',
        name: driverName,
        email,
        role: 'DRIVER',
        driverRef: driverId,
        driverName,
        passwordHash: await hashPassword(params.password),
        active: true,
        createdAt: now,
    });
    params.state.userId = userId;
    return { driverId, vehicleId, userId, email, driverName };
}

async function auditIncidentDraftCorrection(params: {
    adminCookie: string;
    driverToken: string;
    deliveryOrderId: string;
    state: CreatedState;
    suffix: string;
}) {
    auditStep('driver buat incident, admin koreksi biaya draft sebelum approve');
    const incidentCreate = await driverRequest<Incident>('POST', params.driverToken, '/api/driver/incidents', {
        relatedDeliveryOrderRef: params.deliveryOrderId,
        incidentType: 'OTHER',
        urgency: 'LOW',
        locationText: `Audit correction incident ${params.suffix}`,
        odometer: 1100,
        description: `Audit correction incident ${params.suffix}`,
    });
    const incident = incidentCreate.data;
    assert(incident?._id, 'Incident correction tidak mengembalikan id');
    params.state.incidentId = incident._id;

    const resolution = await driverRequest<{ settlementLines: IncidentSettlementLine[] }>(
        'PATCH',
        params.driverToken,
        '/api/driver/incidents',
        {
            action: 'submit-resolution',
            incidentRef: incident._id,
            resolutionNote: 'Audit driver salah input biaya, admin koreksi',
            resolutionLocationText: 'Audit bengkel',
            resolutionOdometer: 1125,
            costs: [
                {
                    category: 'REPAIR',
                    amount: 111000,
                    description: 'Biaya salah dari driver',
                    payeeName: 'Bengkel Audit',
                },
            ],
        }
    );
    const createdLine = resolution.data?.settlementLines?.[0];
    assert(createdLine?._id && createdLine.status === 'DRAFT', 'Biaya driver harus masuk DRAFT sebelum approval');

    const lineDetail = await requestJson<{ data: IncidentSettlementLine }>(
        `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(createdLine._id)}`,
        params.adminCookie
    );
    const corrected = await postData<IncidentSettlementLine>(params.adminCookie, {
        entity: 'incident-settlement-lines',
        action: 'update',
        data: {
            id: createdLine._id,
            revision: lineDetail.data._rev || '',
            updates: {
                amount: 99000,
                description: 'Biaya sudah dikoreksi admin sebelum approve',
                payeeName: 'Bengkel Audit Koreksi',
            },
        },
    });
    assert(corrected.data?.amount === 99000, 'Admin harus bisa koreksi nominal biaya DRAFT sebelum approve');

    const approved = await postData<IncidentSettlementLine>(params.adminCookie, {
        entity: 'incident-settlement-lines',
        action: 'set-status',
        data: {
            id: createdLine._id,
            revision: corrected.data?._rev || '',
            status: 'APPROVED',
        },
    });
    assert(approved.data?.status === 'APPROVED' && approved.data.amount === 99000, 'Approval biaya harus memakai nominal koreksi admin');
    await postData(params.adminCookie, {
        entity: 'incident-settlement-lines',
        action: 'update',
        data: {
            id: createdLine._id,
            revision: approved.data?._rev || '',
            updates: { amount: 88000 },
        },
    }, { expectStatus: 409 });
}

function buildActualItem(item: DeliveryOrderItem, overrides?: { qty?: number; weight?: number; volume?: number }) {
    return {
        deliveryOrderItemRef: item._id,
        actualQtyKoli: overrides?.qty ?? normalizeNumber(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 1),
        actualWeightInputValue: overrides?.weight ?? normalizeNumber(item.orderItemWeight ?? item.shippedWeight ?? 1),
        actualWeightInputUnit: item.orderItemWeightInputUnit || 'KG',
        actualVolumeInputValue: overrides?.volume ?? normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 1),
        actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
    };
}

function buildDropPoint(item: DeliveryOrderItem, sjNumber: string, label: string, overrides?: { qty?: number; weight?: number; volume?: number }) {
    return {
        stopType: 'DROP',
        deliveryOrderItemRef: item._id,
        deliveryOrderItemRefs: [item._id],
        shipperReferenceNumber: sjNumber,
        locationName: label,
        locationAddress: `${label} Address`,
        qtyKoli: overrides?.qty ?? normalizeNumber(item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 1),
        weightInputValue: overrides?.weight ?? normalizeNumber(item.orderItemWeight ?? item.shippedWeight ?? 1),
        weightInputUnit: item.orderItemWeightInputUnit || 'KG',
        volumeInputValue: overrides?.volume ?? normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 1),
        volumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
    };
}

async function main() {
    const adminCookie = await loginAdmin();
    const suffix = Date.now().toString().slice(-6);
    const state: CreatedState = {};
    const driverPassword = `Audit${suffix}!`;
    const pickupKey = `audit-approval-pickup-${suffix}`;
    const tripKey = `audit-approval-trip-${suffix}`;
    const sjA = `AUD-APP-${suffix}-A`;
    const sjB = `AUD-APP-${suffix}-B`;

    try {
        auditStep('ambil master aktif dan buat driver/kendaraan/user audit sementara');
        const [customersResponse, servicesResponse, banksResponse] = await Promise.all([
            requestJson<{ data: Customer[] }>('/api/data?entity=customers&pageSize=100', adminCookie),
            requestJson<{ data: Service[] }>('/api/data?entity=services&pageSize=100', adminCookie),
            requestJson<{ data: BankAccount[] }>('/api/data?entity=bank-accounts&pageSize=100', adminCookie),
        ]);
        const customer = (customersResponse.data || []).find(item => item.active !== false);
        const service = (servicesResponse.data || []).find(item => item.active !== false);
        const bank = (banksResponse.data || []).find(item => item.active !== false);
        assert(customer, 'Audit butuh customer aktif');
        assert(service, 'Audit butuh kategori armada aktif');
        assert(bank, 'Audit butuh rekening/kas aktif');

        const resources = await createAuditDriverResources({ service, suffix, password: driverPassword, state });
        const driverToken = await loginDriver(resources.email, driverPassword);

        auditStep('buat order dan trip dengan 2 SJ untuk skenario pending partial approval');
        const orderCreate = await postData<Order>(adminCookie, {
            entity: 'orders',
            action: 'create-with-items',
            data: {
                customerRef: customer._id,
                serviceRef: service._id,
                pickupAddress: 'Audit Approval Pickup',
                pickupStops: [
                    {
                        _key: pickupKey,
                        sequence: 1,
                        pickupLabel: 'Audit Approval Pickup',
                        pickupAddress: 'Audit Approval Pickup Address',
                    },
                ],
                notes: `Audit approval correction ${suffix}`,
                items: [],
                tripDrafts: [
                    {
                        _key: tripKey,
                        pickupStopKeys: [pickupKey],
                        vehicleRef: resources.vehicleId,
                        driverRef: resources.driverId,
                        taripBorongan: 100000,
                        issueBankRef: bank._id,
                        cashGiven: 10000,
                        date: AUDIT_DATE,
                    },
                ],
            },
        });
        state.orderId = normalizeText(orderCreate.data?._id) || normalizeText(orderCreate.id);
        assert(state.orderId, 'Create order audit approval tidak mengembalikan id');

        const deliveryOrderCreate = await postData<DeliveryOrder>(adminCookie, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: state.orderId,
                orderTripPlanKey: tripKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjA, pickupStopKey: pickupKey },
                    { referenceNumber: sjB, pickupStopKey: pickupKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit approval barang A',
                        qtyKoli: 1,
                        weightInputValue: 100,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupKey,
                        shipperReferenceNumber: sjA,
                    },
                    {
                        description: 'Audit approval barang B',
                        qtyKoli: 2,
                        weightInputValue: 200,
                        weightInputUnit: 'KG',
                        volumeInputValue: 2,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupKey,
                        shipperReferenceNumber: sjB,
                    },
                ],
            },
        });
        state.deliveryOrderId = normalizeText(deliveryOrderCreate.data?._id) || normalizeText(deliveryOrderCreate.id);
        assert(state.deliveryOrderId, 'Create DO audit approval tidak mengembalikan id');

        const initialDocs = await getSuratJalanDocuments(adminCookie, state.deliveryOrderId);
        const sjARef = getSuratJalanRef(state.deliveryOrderId, initialDocs, sjA);
        const sjBRef = getSuratJalanRef(state.deliveryOrderId, initialDocs, sjB);

        auditStep('admin majukan kedua SJ sampai ARRIVED sebagai dasar finalisasi driver');
        for (const status of ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED']) {
            await postData(adminCookie, {
                entity: 'delivery-orders',
                action: 'set-surat-jalan-status-batch',
                data: {
                    id: state.deliveryOrderId,
                    status,
                    targetSuratJalanRefs: [sjARef, sjBRef],
                    note: `Audit approval correction ${status}`,
                },
            });
        }

        let items = await getDeliveryOrderItems(adminCookie, state.deliveryOrderId);
        const itemA = items.find(item => item.shipperReferenceNumber === sjA);
        const itemB = items.find(item => item.shipperReferenceNumber === sjB);
        assert(itemA && itemB, 'Setup item SJ A/B tidak valid');

        auditStep('driver submit aktual SJ A yang salah, lalu sistem mengunci koreksi item SJ A sambil membolehkan SJ B');
        await driverRequest<DeliveryOrder>('POST', driverToken, '/api/driver/delivery-orders/status', {
            id: state.deliveryOrderId,
            status: 'DELIVERED',
            selectedSuratJalanRefs: [sjARef],
            podReceiverName: 'Penerima Audit Salah',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit submit salah, akan ditolak',
            actualItems: [buildActualItem(itemA, { qty: 1, weight: 90, volume: 1 })],
            actualDropPoints: [buildDropPoint(itemA, sjA, 'Audit Drop A Salah', { qty: 1, weight: 90, volume: 1 })],
        });
        let pendingDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        const firstPending = pendingDeliveryOrder.pendingDriverRequests?.[0];
        assert(firstPending?.requestId, 'Submit aktual driver harus masuk pending approval');

        await driverRequest('PATCH', driverToken, '/api/driver/delivery-orders/cargo-item', {
            id: state.deliveryOrderId,
            deliveryOrderItemId: itemA._id,
            cargoItem: {
                description: 'Audit update harus ditolak saat SJ A pending',
                qtyKoli: 1,
                weightInputValue: 91,
                weightInputUnit: 'KG',
                volumeInputValue: 1,
                volumeInputUnit: 'M3',
                shipperReferenceNumber: sjA,
                pickupStopKey: pickupKey,
            },
        }, { expectStatus: 409 });

        const appendB = await driverRequest<{ appendedCount?: number }>('POST', driverToken, '/api/driver/delivery-orders/cargo', {
            id: state.deliveryOrderId,
            shipperReferences: [
                { referenceNumber: sjA, pickupStopKey: pickupKey },
                { referenceNumber: sjB, pickupStopKey: pickupKey },
            ],
            cargoItems: [
                {
                    description: 'Audit barang B tambahan saat SJ A pending',
                    qtyKoli: 1,
                    weightInputValue: 10,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.25,
                    volumeInputUnit: 'M3',
                    shipperReferenceNumber: sjB,
                    pickupStopKey: pickupKey,
                },
            ],
        });
        assert(appendB.data?.appendedCount === 1, 'SJ B harus tetap bisa ditambah saat approval SJ A masih pending');

        auditStep('admin reject aktual salah, driver submit ulang aktual benar, admin approve');
        await postData(adminCookie, {
            entity: 'delivery-orders',
            action: 'reject-driver-status-request',
            data: {
                id: state.deliveryOrderId,
                pendingDriverRequestId: firstPending.requestId,
                note: 'Audit reject karena aktual driver salah input',
            },
        });
        pendingDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        assert(!pendingDeliveryOrder.pendingDriverRequests?.length, 'Reject harus membersihkan pending aktual driver');

        await driverRequest<DeliveryOrder>('POST', driverToken, '/api/driver/delivery-orders/status', {
            id: state.deliveryOrderId,
            status: 'DELIVERED',
            selectedSuratJalanRefs: [sjARef],
            podReceiverName: 'Penerima Audit Benar',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit submit ulang setelah koreksi',
            actualItems: [buildActualItem(itemA, { qty: 1, weight: 95, volume: 1 })],
            actualDropPoints: [buildDropPoint(itemA, sjA, 'Audit Drop A Benar', { qty: 1, weight: 95, volume: 1 })],
        });
        pendingDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        const correctedPending = pendingDeliveryOrder.pendingDriverRequests?.[0];
        assert(correctedPending?.requestId, 'Submit ulang aktual driver harus masuk pending approval');

        await postData(adminCookie, {
            entity: 'delivery-orders',
            action: 'set-surat-jalan-status-batch',
            data: {
                id: state.deliveryOrderId,
                status: 'DELIVERED',
                targetSuratJalanRefs: [sjARef],
                note: 'Audit approve aktual driver terkoreksi',
                podReceiverName: correctedPending.podReceiverName,
                podReceivedDate: correctedPending.podReceivedDate,
                podNote: correctedPending.podNote,
                actualItems: correctedPending.actualCargoItems || [],
                actualDropPoints: correctedPending.actualDropPoints || [],
                approveDriverRequest: true,
                pendingDriverRequestId: correctedPending.requestId,
            },
        });
        const itemAAfterApprove = (await getDeliveryOrderItems(adminCookie, state.deliveryOrderId))
            .find(item => item._id === itemA._id);
        assert(itemAAfterApprove?.actualWeightKg === 95, 'Approval admin harus menyimpan aktual terkoreksi 95 kg, bukan input salah 90 kg');
        const docsAfterApproveA = await getSuratJalanDocuments(adminCookie, state.deliveryOrderId);
        assert(
            docsAfterApproveA.find(document => document._id === sjARef)?.tripStatus === 'DELIVERED',
            'SJ A harus DELIVERED setelah admin approve aktual terkoreksi'
        );

        auditStep('admin finalisasi SJ B termasuk barang tambahan, lalu driver ajukan tutup trip dengan odometer');
        items = await getDeliveryOrderItems(adminCookie, state.deliveryOrderId);
        const bItems = items.filter(item => item.shipperReferenceNumber === sjB);
        assert(bItems.length === 2, 'SJ B harus punya item awal dan item tambahan');
        await postData(adminCookie, {
            entity: 'delivery-orders',
            action: 'set-surat-jalan-status-batch',
            data: {
                id: state.deliveryOrderId,
                status: 'DELIVERED',
                targetSuratJalanRefs: [sjBRef],
                note: 'Audit deliver SJ B setelah partial pending',
                podReceiverName: 'Penerima Audit B',
                podReceivedDate: AUDIT_DATE,
                podNote: 'Audit POD B',
                actualItems: bItems.map(item => buildActualItem(item)),
                actualDropPoints: bItems.map(item => buildDropPoint(item, sjB, `Audit Drop B ${item._id}`)),
            },
        });
        let completedDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        assert(completedDeliveryOrder.status === 'DELIVERED', `Trip harus DELIVERED sebelum closure, sekarang ${completedDeliveryOrder.status}`);

        await driverRequest('POST', driverToken, '/api/driver/delivery-orders/status', {
            id: state.deliveryOrderId,
            status: 'DELIVERED',
            closeTripOnly: true,
            tripEndOdometerKm: 900,
            note: 'Audit odometer tidak valid',
        }, { expectStatus: 400 });

        await driverRequest<DeliveryOrder>('POST', driverToken, '/api/driver/delivery-orders/status', {
            id: state.deliveryOrderId,
            status: 'DELIVERED',
            closeTripOnly: true,
            tripEndOdometerKm: 1200,
            note: 'Audit odometer valid lalu ditolak admin',
        });
        completedDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        const closureRequest = completedDeliveryOrder.pendingDriverRequests?.find(request => request.closeTripOnly);
        assert(closureRequest?.requestId && completedDeliveryOrder.tripEndOdometerKm === 1200, 'Closure driver harus masuk pending dengan odometer draft 1200');
        await postData(adminCookie, {
            entity: 'delivery-orders',
            action: 'reject-driver-status-request',
            data: {
                id: state.deliveryOrderId,
                pendingDriverRequestId: closureRequest.requestId,
                note: 'Audit reject odometer closure',
            },
        });
        completedDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        assert(
            !completedDeliveryOrder.pendingDriverRequests?.length && !completedDeliveryOrder.tripEndOdometerKm,
            'Reject closure harus membersihkan pending request dan odometer draft'
        );

        await driverRequest<DeliveryOrder>('POST', driverToken, '/api/driver/delivery-orders/status', {
            id: state.deliveryOrderId,
            status: 'DELIVERED',
            closeTripOnly: true,
            tripEndOdometerKm: 1250,
            note: 'Audit odometer closure final',
        });
        completedDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        const finalClosureRequest = completedDeliveryOrder.pendingDriverRequests?.find(request => request.closeTripOnly);
        assert(finalClosureRequest?.requestId, 'Closure final harus punya pending request untuk approval admin');

        await postData<DeliveryOrder>(adminCookie, {
            entity: 'delivery-orders',
            action: 'set-trip-closure',
            data: {
                id: state.deliveryOrderId,
                closed: true,
                pendingDriverRequestId: finalClosureRequest.requestId,
                newOdometer: 1250,
            },
        });
        completedDeliveryOrder = (await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(state.deliveryOrderId)}`,
            adminCookie
        )).data;
        assert(completedDeliveryOrder.tripClosedByAdminAt, 'Trip harus tertutup setelah admin approve closure');
        assert(completedDeliveryOrder.tripStartOdometerKm === 1000 && completedDeliveryOrder.tripEndOdometerKm === 1250, 'Odometer closure harus 1000 -> 1250');
        const vehicle = await getDocumentById<Vehicle>(resources.vehicleId, 'vehicle');
        assert(vehicle?.lastOdometer === 1250, 'Odometer kendaraan harus ikut naik ke 1250 setelah closure admin');

        await auditIncidentDraftCorrection({
            adminCookie,
            driverToken,
            deliveryOrderId: state.deliveryOrderId,
            state,
            suffix,
        });

        console.log(
            'Driver approval correction audit OK: pending aktual bisa reject/resubmit/approve, SJ lain tetap bisa diubah, odometer closure guard valid, dan biaya incident draft bisa dikoreksi sebelum approve.'
        );
    } finally {
        await cleanupState(state);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
