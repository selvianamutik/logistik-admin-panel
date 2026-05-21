import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import {
    createDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '../src/lib/repositories/document-store';

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3217').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 120000);
const AUDIT_DATE = '2026-05-17';

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type AnyDoc = Record<string, unknown> & {
    _id: string;
    _rev?: string;
    amount?: number;
    category?: string;
    customerName?: string;
    driverRef?: string;
    driverSuratJalanRecords?: AnyDoc[];
    doNumber?: string;
    incident?: AnyDoc;
    linkedDriverVoucherItemRef?: string;
    linkedExpenseRef?: string;
    name?: string;
    orderItemQtyKoli?: number;
    orderItemVolumeInputUnit?: string;
    orderItemVolumeInputValue?: number;
    orderItemVolumeM3?: number;
    orderItemWeight?: number;
    orderItemWeightInputUnit?: string;
    orderItemWeightInputValue?: number;
    relatedIncidentRef?: string;
    relatedIncidentSettlementLineRef?: string;
    serviceName?: string;
    settlementLines?: AnyDoc[];
    shippedQtyKoli?: number;
    shippedVolume?: number;
    shippedWeight?: number;
    status?: string;
    suratJalanNumber?: string;
    totalSpent?: number;
    tripStatus?: string;
    updatedCount?: number;
    vehicleRef?: string;
};

const suffix = Date.now().toString().slice(-7);
const state: Record<string, string> = {};
const createdIncidents: string[] = [];
const createdDirectDocs: Array<[string, string]> = [];

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout ${REQUEST_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function loginAdmin() {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
        },
        body: JSON.stringify({
            email: process.env.AUDIT_LOGIN_EMAIL || 'owner@company.local',
            password: process.env.AUDIT_LOGIN_PASSWORD || 'owner12345',
        }),
    }, 'login admin');
    const body = await response.text();
    if (!response.ok) throw new Error(`login admin ${response.status}: ${body}`);
    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];
    const cookie = cookies
        .map(item => item.split(';')[0])
        .filter(Boolean)
        .join('; ');
    assert(cookie, 'admin login tidak memberi cookie');
    return cookie;
}

async function loginDriver(email: string, password: string) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/driver/mobile/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/driver`,
        },
        body: JSON.stringify({ email, password }),
    }, 'login driver mobile');
    const body = await response.text();
    const parsed = body ? JSON.parse(body) as { token?: string } : {};
    if (!response.ok) throw new Error(`login driver ${response.status}: ${body}`);
    assert(parsed.token, 'driver login tidak memberi token');
    return parsed.token;
}

async function requestJson<T>(path: string, cookie: string): Promise<T> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
        headers: { Cookie: cookie },
    }, `GET ${path}`);
    const body = await response.text();
    if (!response.ok) throw new Error(`${path} ${response.status}: ${body}`);
    return JSON.parse(body) as T;
}

async function postData<T>(
    cookie: string,
    payload: Record<string, unknown>,
    expectStatus?: number
): Promise<ApiResponse<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/dashboard`,
            Cookie: cookie,
        },
        body: JSON.stringify(payload),
    }, 'POST /api/data');
    const body = await response.text();
    const parsed = body ? JSON.parse(body) as ApiResponse<T> : {};
    if (expectStatus) {
        assert(response.status === expectStatus, `expected ${expectStatus}, got ${response.status}: ${body}`);
        return parsed;
    }
    if (!response.ok) throw new Error(`/api/data ${response.status}: ${body}`);
    return parsed;
}

async function driverRequest<T>(
    method: 'GET' | 'POST' | 'PATCH',
    token: string,
    path: string,
    payload?: Record<string, unknown>,
    expectStatus?: number
): Promise<ApiResponse<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
        method,
        headers: {
            ...(payload ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
        },
        body: payload ? JSON.stringify(payload) : undefined,
    }, `${method} ${path}`);
    const body = await response.text();
    const parsed = body ? JSON.parse(body) as ApiResponse<T> : {};
    if (expectStatus) {
        assert(response.status === expectStatus, `${method} ${path} expected ${expectStatus}, got ${response.status}: ${body}`);
        return parsed;
    }
    if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${body}`);
    return parsed;
}

async function getDriverOrders(token: string) {
    const result = await driverRequest<AnyDoc[]>('GET', token, '/api/driver/delivery-orders');
    return Array.isArray(result.data) ? result.data : [];
}

async function getSuratJalanDocs(adminCookie: string, deliveryOrderId: string) {
    const response = await requestJson<ApiResponse<AnyDoc[]>>(
        `/api/data?entity=surat-jalan&filter=${encodeURIComponent(JSON.stringify({ tripRef: deliveryOrderId }))}&pageSize=100`,
        adminCookie
    );
    return Array.isArray(response.data) ? response.data : [];
}

async function cleanupExpense(expenseId: string) {
    const [txs, entries, audits] = await Promise.all([
        listDocumentsByFilter<AnyDoc>('bankTransaction', { relatedExpenseRef: expenseId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('journalEntry', { sourceRef: expenseId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: expenseId }).catch(() => []),
    ]);
    for (const tx of txs) await deleteDocument(tx._id, 'bankTransaction').catch(() => undefined);
    for (const entry of entries) {
        const lines = await listDocumentsByFilter<AnyDoc>('journalLine', { journalEntryRef: entry._id }).catch(() => []);
        for (const line of lines) await deleteDocument(line._id, 'journalLine').catch(() => undefined);
        await deleteDocument(entry._id, 'journalEntry').catch(() => undefined);
    }
    for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    await deleteDocument(expenseId, 'expense').catch(() => undefined);
}

async function cleanupVoucher(voucherId: string) {
    const [items, disbursements, expenses, txs, entries, audits] = await Promise.all([
        listDocumentsByFilter<AnyDoc>('driverVoucherItem', { voucherRef: voucherId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('driverVoucherDisbursement', { voucherRef: voucherId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('expense', { voucherRef: voucherId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('bankTransaction', { relatedVoucherRef: voucherId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('journalEntry', { sourceRef: voucherId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: voucherId }).catch(() => []),
    ]);
    for (const expense of expenses) await cleanupExpense(expense._id);
    for (const item of items) await deleteDocument(item._id, 'driverVoucherItem').catch(() => undefined);
    for (const item of disbursements) await deleteDocument(item._id, 'driverVoucherDisbursement').catch(() => undefined);
    for (const tx of txs) await deleteDocument(tx._id, 'bankTransaction').catch(() => undefined);
    for (const entry of entries) {
        const lines = await listDocumentsByFilter<AnyDoc>('journalLine', { journalEntryRef: entry._id }).catch(() => []);
        for (const line of lines) await deleteDocument(line._id, 'journalLine').catch(() => undefined);
        await deleteDocument(entry._id, 'journalEntry').catch(() => undefined);
    }
    for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    await deleteDocument(voucherId, 'driverVoucher').catch(() => undefined);
}

async function cleanupIncident(incidentId: string) {
    const [lines, logs, expenses, audits] = await Promise.all([
        listDocumentsByFilter<AnyDoc>('incidentSettlementLine', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('incidentActionLog', { incidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('expense', { relatedIncidentRef: incidentId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: incidentId }).catch(() => []),
    ]);
    for (const expense of expenses) await cleanupExpense(expense._id);
    for (const line of lines) {
        const lineAudits = await listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: line._id }).catch(() => []);
        for (const audit of lineAudits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
        await deleteDocument(line._id, 'incidentSettlementLine').catch(() => undefined);
    }
    for (const log of logs) await deleteDocument(log._id, 'incidentActionLog').catch(() => undefined);
    for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    await deleteDocument(incidentId, 'incident').catch(() => undefined);
}

async function cleanupDeliveryOrder(deliveryOrderId: string) {
    const [items, sjItems, sjDocs, trackingLogs, vouchers, audits] = await Promise.all([
        listDocumentsByFilter<AnyDoc>('deliveryOrderItem', { deliveryOrderRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('suratJalanItem', { tripRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('suratJalan', { tripRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('trackingLog', { refRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('driverVoucher', { deliveryOrderRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: deliveryOrderId }).catch(() => []),
    ]);
    for (const voucher of vouchers) await cleanupVoucher(voucher._id);
    for (const item of items) await deleteDocument(item._id, 'deliveryOrderItem').catch(() => undefined);
    for (const item of sjItems) await deleteDocument(item._id, 'suratJalanItem').catch(() => undefined);
    for (const doc of sjDocs) await deleteDocument(doc._id, 'suratJalan').catch(() => undefined);
    for (const log of trackingLogs) await deleteDocument(log._id, 'trackingLog').catch(() => undefined);
    for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
    await deleteDocument(deliveryOrderId, 'trip').catch(() => undefined);
    await deleteDocument(deliveryOrderId, 'deliveryOrder').catch(() => undefined);
}

async function cleanup() {
    for (const incidentId of [...createdIncidents].reverse()) await cleanupIncident(incidentId);
    for (const key of ['firstDoId', 'secondDoId']) {
        if (state[key]) await cleanupDeliveryOrder(state[key]);
    }
    if (state.orderId) {
        const [items, audits] = await Promise.all([
            listDocumentsByFilter<AnyDoc>('orderItem', { orderRef: state.orderId }).catch(() => []),
            listDocumentsByFilter<AnyDoc>('auditLog', { entityRef: state.orderId }).catch(() => []),
        ]);
        for (const item of items) await deleteDocument(item._id, 'orderItem').catch(() => undefined);
        for (const audit of audits) await deleteDocument(audit._id, 'auditLog').catch(() => undefined);
        await deleteDocument(state.orderId, 'order').catch(() => undefined);
    }
    for (const [id, type] of createdDirectDocs.reverse()) {
        await deleteDocument(id, type).catch(() => undefined);
    }
}

async function makeIncidentCycle(params: {
    token: string;
    adminCookie: string;
    deliveryOrderId: string;
    expenseCategoryRef: string;
    bankAccountRef: string;
    idx: number;
    category: string;
    amount: number;
}) {
    const incidentResp = await driverRequest<AnyDoc>('POST', params.token, '/api/driver/incidents', {
        relatedDeliveryOrderRef: params.deliveryOrderId,
        incidentType: params.idx === 1 ? 'ENGINE_TROUBLE' : 'OTHER',
        urgency: params.idx === 1 ? 'MEDIUM' : 'LOW',
        locationText: `Audit incident location ${suffix}-${params.idx}`,
        odometer: 1000 + params.idx,
        description: `Audit incident ${suffix}-${params.idx}`,
    });
    const incident = incidentResp.data;
    assert(incident?._id, `incident ${params.idx} tidak dibuat dari mobile endpoint`);
    createdIncidents.push(incident._id);

    const resolution = await driverRequest<AnyDoc>('PATCH', params.token, '/api/driver/incidents', {
        action: 'submit-resolution',
        incidentRef: incident._id,
        resolutionNote: `Driver selesai incident ${params.idx}`,
        resolutionLocationText: `Audit resolution location ${params.idx}`,
        resolutionOdometer: 1100 + params.idx,
        costs: [{
            category: params.category,
            amount: params.amount,
            description: `Biaya incident ${params.idx}`,
            payeeName: 'Audit Payee',
            note: 'Masuk uang jalan',
        }],
    });
    const line = resolution.data?.settlementLines?.[0];
    assert(resolution.data?.incident?.status === 'IN_PROGRESS', `incident ${params.idx} tidak naik ke IN_PROGRESS`);
    assert(line?._id && line.status === 'DRAFT', `incident ${params.idx} tidak membuat biaya DRAFT`);

    const duplicate = await driverRequest<AnyDoc>('PATCH', params.token, '/api/driver/incidents', {
        action: 'submit-resolution',
        incidentRef: incident._id,
        resolutionNote: 'Duplicate should fail',
    }, 409);
    assert(duplicate.error, `duplicate incident ${params.idx} harus ditolak`);

    const lineDetail = await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(line._id)}`,
        params.adminCookie
    );
    const approved = await postData<AnyDoc>(params.adminCookie, {
        entity: 'incident-settlement-lines',
        action: 'set-status',
        data: {
            id: line._id,
            revision: lineDetail.data?._rev || '',
            status: 'APPROVED',
        },
    });
    assert(approved.data?.status === 'APPROVED', `admin approval incident line ${params.idx} gagal`);
    const approvedLineDetail = await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(line._id)}`,
        params.adminCookie
    );
    const approvedLineDirect = await getDocumentById<AnyDoc>(line._id, 'incidentSettlementLine');
    const approvedLineRevision = approvedLineDetail.data?._rev || approvedLineDirect?._rev || '';
    assert(approvedLineRevision, `line incident ${params.idx} tidak punya revision terbaru untuk post expense`);

    const expense = await postData<AnyDoc>(params.adminCookie, {
        entity: 'expenses',
        action: 'create',
        data: {
            date: AUDIT_DATE,
            categoryRef: params.expenseCategoryRef,
            amount: params.amount,
            relatedIncidentRef: incident._id,
            relatedIncidentSettlementLineRef: line._id,
            relatedIncidentSettlementLineRevision: approvedLineRevision,
            incidentExpenseRoute: 'DRIVER_VOUCHER',
            note: `Post incident ${params.idx} ke uang jalan`,
            description: `Audit expense incident ${params.idx}`,
            privacyLevel: 'internal',
        },
    });
    assert(expense.data?._id, `expense incident ${params.idx} tidak dibuat admin`);
    assert(!expense.data.bankAccountRef, `expense incident ${params.idx} tidak boleh menjadi pengeluaran bank langsung saat bon trip tersedia`);
    assert(expense.data.incidentExpenseRoute === 'DRIVER_VOUCHER', `expense incident ${params.idx} harus tercatat route uang jalan driver`);

    const postedLine = (await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=incident-settlement-lines&id=${encodeURIComponent(line._id)}`,
        params.adminCookie
    )).data;
    assert(postedLine?.status === 'POSTED', `line incident ${params.idx} tidak menjadi POSTED`);
    assert(postedLine.linkedExpenseRef === expense.data._id, `line incident ${params.idx} tidak link ke expense`);
    const linkedDriverVoucherItemRef = text(postedLine.linkedDriverVoucherItemRef);
    assert(linkedDriverVoucherItemRef, `line incident ${params.idx} tidak link ke item uang jalan`);

    const voucherItem = await getDocumentById<AnyDoc>(linkedDriverVoucherItemRef, 'driverVoucherItem');
    assert(voucherItem?.amount === params.amount, `voucher item incident ${params.idx} nominal mismatch`);
    assert(voucherItem.relatedIncidentRef === incident._id, `voucher item incident ${params.idx} tidak link incident`);
    assert(voucherItem.relatedIncidentSettlementLineRef === line._id, `voucher item incident ${params.idx} tidak link settlement line`);

    const incDetail = (await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=incidents&id=${encodeURIComponent(incident._id)}`,
        params.adminCookie
    )).data;
    const resolved = await postData<AnyDoc>(params.adminCookie, {
        entity: 'incidents',
        action: 'set-status',
        data: {
            id: incident._id,
            revision: incDetail?._rev || '',
            status: 'RESOLVED',
            note: `Incident ${params.idx} resolved`,
        },
    });
    assert(resolved.data?.status === 'RESOLVED', `incident ${params.idx} tidak resolved`);

    const resolvedDetail = (await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=incidents&id=${encodeURIComponent(incident._id)}`,
        params.adminCookie
    )).data;
    const closed = await postData<AnyDoc>(params.adminCookie, {
        entity: 'incidents',
        action: 'set-status',
        data: {
            id: incident._id,
            revision: resolvedDetail?._rev || '',
            status: 'CLOSED',
            note: `Incident ${params.idx} closed`,
        },
    });
    assert(closed.data?.status === 'CLOSED', `incident ${params.idx} tidak closed setelah biaya posted`);

    return {
        incidentId: incident._id,
        lineId: line._id,
        expenseId: expense.data._id,
        voucherItemId: postedLine.linkedDriverVoucherItemRef,
    };
}

async function main() {
    const adminCookie = await loginAdmin();
    const [customersResp, servicesResp, banksResp, expenseCategoriesResp] = await Promise.all([
        requestJson<ApiResponse<AnyDoc[]>>('/api/data?entity=customers&pageSize=200', adminCookie),
        requestJson<ApiResponse<AnyDoc[]>>('/api/data?entity=services&pageSize=200', adminCookie),
        requestJson<ApiResponse<AnyDoc[]>>('/api/data?entity=bank-accounts&pageSize=200', adminCookie),
        requestJson<ApiResponse<AnyDoc[]>>('/api/data?entity=expense-categories&pageSize=300', adminCookie),
    ]);
    const customer = (customersResp.data || []).find(item => item.active !== false);
    const service = (servicesResp.data || []).find(item => item.active !== false);
    const bank = (banksResp.data || []).find(item => item.active !== false);
    const expenseCategory =
        (expenseCategoriesResp.data || []).find(item => item.active !== false && /lain|trip|operasional|perbaikan/i.test(`${item.name || item.categoryName || ''}`)) ||
        (expenseCategoriesResp.data || []).find(item => item.active !== false);
    assert(customer, 'butuh customer aktif untuk audit');
    assert(service, 'butuh service aktif untuk audit');
    assert(bank, 'butuh bank aktif untuk validasi draft trip');
    assert(expenseCategory, 'butuh kategori expense aktif untuk audit');

    const driverId = `audit-cond-driver-${suffix}`;
    const vehicleId = `audit-cond-vehicle-${suffix}`;
    const userId = `audit-cond-user-${suffix}`;
    const driverEmail = `audit-cond-${suffix}@driver.local`;
    const driverPassword = `Audit${suffix}!`;
    const driverName = `Audit Conditional Driver ${suffix}`;
    const vehiclePlate = `AUD-${suffix}`;

    await createDocument({ _id: driverId, _type: 'driver', name: driverName, active: true });
    await createDocument({
        _id: vehicleId,
        _type: 'vehicle',
        plateNumber: vehiclePlate,
        status: 'AVAILABLE',
        serviceRef: service._id,
        serviceName: service.name || service.serviceName,
        active: true,
    });
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
    createdDirectDocs.push([userId, 'user'], [vehicleId, 'vehicle'], [driverId, 'driver']);

    const pickupKey = `pickup-${suffix}`;
    const tripKey = `trip-${suffix}`;
    const sjA = `AUD-COND-${suffix}-A`;
    const sjB = `AUD-COND-${suffix}-B`;
    const orderCreate = await postData<AnyDoc>(adminCookie, {
        entity: 'orders',
        action: 'create-with-items',
        data: {
            customerRef: customer._id,
            serviceRef: service._id,
            pickupAddress: 'Audit Conditional Pickup',
            pickupStops: [{
                _key: pickupKey,
                sequence: 1,
                pickupLabel: 'Audit Conditional Pickup',
                pickupAddress: 'Audit Conditional Pickup Address',
            }],
            notes: `Audit conditional ${suffix}`,
            items: [],
            tripDrafts: [{
                _key: tripKey,
                pickupStopKeys: [pickupKey],
                vehicleRef: vehicleId,
                driverRef: driverId,
                taripBorongan: 150000,
                issueBankRef: bank._id,
                cashGiven: 50000,
                date: AUDIT_DATE,
            }],
        },
    });
    state.orderId = text(orderCreate.data?._id) || text(orderCreate.id);
    assert(state.orderId, 'admin create order tidak mengembalikan id');

    const doCreate = await postData<AnyDoc>(adminCookie, {
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
                    description: 'Audit barang A',
                    qtyKoli: 1,
                    weightInputValue: 100,
                    weightInputUnit: 'KG',
                    volumeInputValue: 1,
                    volumeInputUnit: 'M3',
                    pickupStopKey: pickupKey,
                    shipperReferenceNumber: sjA,
                },
                {
                    description: 'Audit barang B',
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
    state.firstDoId = text(doCreate.data?._id) || text(doCreate.id);
    assert(state.firstDoId, 'admin create DO tidak mengembalikan id');
    await updateDocument(state.firstDoId, { taripBorongan: 150000 }, 'deliveryOrder');

    const voucherId = `audit-cond-voucher-${suffix}`;
    await createDocument({
        _id: voucherId,
        _type: 'driverVoucher',
        driverRef: driverId,
        driverName,
        deliveryOrderRef: state.firstDoId,
        doNumber: doCreate.data?.doNumber,
        vehicleRef: vehicleId,
        vehiclePlate,
        route: 'Audit Pickup - Audit Drop',
        bonNumber: `AUD-BON-${suffix}`,
        issuedDate: AUDIT_DATE,
        cashGiven: 50000,
        initialCashGiven: 50000,
        totalIssuedAmount: 50000,
        driverFeeAmount: 150000,
        totalClaimAmount: 150000,
        totalSpent: 0,
        balance: -100000,
        status: 'ISSUED',
        notes: 'Audit direct voucher for incident link',
    });

    const token = await loginDriver(driverEmail, driverPassword);
    let driverOrders = await getDriverOrders(token);
    let driverTrip = driverOrders.find(item => item._id === state.firstDoId);
    assert(driverTrip, 'trip pertama tidak muncul di mobile driver endpoint');
    const sjRecords = driverTrip.driverSuratJalanRecords || [];
    const sjARef = text(sjRecords.find((item: AnyDoc) => item.suratJalanNumber === sjA)?._id);
    const sjBRef = text(sjRecords.find((item: AnyDoc) => item.suratJalanNumber === sjB)?._id);
    assert(sjARef && sjBRef && sjARef !== sjBRef, 'mobile endpoint tidak memberi dua ref SJ yang berbeda');

    await driverRequest<AnyDoc>('POST', token, '/api/driver/tracking', {
        action: 'start',
        deliveryOrderRef: state.firstDoId,
        latitude: -7.416183,
        longitude: 112.581563,
        accuracyM: 12,
        speedMps: 0,
    });

    const sjAOnDeliveryResult = await driverRequest<AnyDoc>('POST', token, '/api/driver/delivery-orders/batch-status', {
        id: state.firstDoId,
        status: 'ON_DELIVERY',
        targetSuratJalanRefs: [sjARef],
        note: 'A saja on delivery',
    });
    assert(sjAOnDeliveryResult.data?.updatedCount === 1, `SJ A on delivery updatedCount mismatch: ${JSON.stringify(sjAOnDeliveryResult.data)}`);
    let sjDocs = await getSuratJalanDocs(adminCookie, state.firstDoId);
    assert(
        sjDocs.find(item => item._id === sjARef)?.tripStatus === 'ON_DELIVERY',
        `SJ A tidak berubah ke ON_DELIVERY: ${JSON.stringify(sjDocs.map(item => ({ id: item._id, no: item.suratJalanNumber, status: item.tripStatus })))}`
    );
    assert(
        sjDocs.find(item => item._id === sjBRef)?.tripStatus === 'CREATED',
        `SJ B berubah salah saat hanya SJ A ke ON_DELIVERY: ${JSON.stringify(sjDocs.map(item => ({ id: item._id, no: item.suratJalanNumber, status: item.tripStatus })))}`
    );

    driverOrders = await getDriverOrders(token);
    driverTrip = driverOrders.find(item => item._id === state.firstDoId);
    const mobileAfterStatus = driverTrip?.driverSuratJalanRecords || [];
    assert(mobileAfterStatus.find((item: AnyDoc) => item._id === sjARef)?.tripStatus === 'ON_DELIVERY', 'mobile readback SJ A mismatch');
    assert(mobileAfterStatus.find((item: AnyDoc) => item._id === sjBRef)?.tripStatus === 'CREATED', 'mobile readback SJ B mismatch');

    const sjBOnDeliveryResult = await driverRequest<AnyDoc>('POST', token, '/api/driver/delivery-orders/batch-status', {
        id: state.firstDoId,
        status: 'ON_DELIVERY',
        targetSuratJalanRefs: [sjBRef],
        note: 'B on delivery',
    });
    assert(sjBOnDeliveryResult.data?.updatedCount === 1, `SJ B on delivery updatedCount mismatch: ${JSON.stringify(sjBOnDeliveryResult.data)}`);
    sjDocs = await getSuratJalanDocs(adminCookie, state.firstDoId);

    const earlyStop = await driverRequest<AnyDoc>('POST', token, '/api/driver/tracking', {
        action: 'stop',
        deliveryOrderRef: state.firstDoId,
        latitude: -7.416200,
        longitude: 112.581600,
        accuracyM: 15,
        speedMps: 0,
    }, 409);
    assert(/belum.*selesai|admin menutup/i.test(earlyStop.error || ''), `stop tracking sebelum selesai harus ditolak, got: ${earlyStop.error}`);

    const firstCycle = await makeIncidentCycle({
        token,
        adminCookie,
        deliveryOrderId: state.firstDoId,
        expenseCategoryRef: expenseCategory._id,
        bankAccountRef: bank._id,
        idx: 1,
        category: 'REPAIR',
        amount: 21000,
    });
    const secondCycle = await makeIncidentCycle({
        token,
        adminCookie,
        deliveryOrderId: state.firstDoId,
        expenseCategoryRef: expenseCategory._id,
        bankAccountRef: bank._id,
        idx: 2,
        category: 'OTHER',
        amount: 32000,
    });
    const linkedVoucherItems = await listDocumentsByFilter<AnyDoc>('driverVoucherItem', { voucherRef: voucherId });
    const linkedLineRefs = new Set(linkedVoucherItems.map(item => item.relatedIncidentSettlementLineRef).filter(Boolean));
    assert(linkedLineRefs.has(firstCycle.lineId) && linkedLineRefs.has(secondCycle.lineId), 'dua incident tidak lengkap tertaut ke item uang jalan');
    const voucherAfterIncidents = (await requestJson<ApiResponse<AnyDoc>>(
        `/api/data?entity=driver-vouchers&id=${encodeURIComponent(voucherId)}`,
        adminCookie
    )).data;
    assert(voucherAfterIncidents?.totalSpent === 53000, `totalSpent voucher harus 53000, actual ${voucherAfterIncidents?.totalSpent}`);

    state.secondDoId = `audit-cond-second-do-${suffix}`;
    await createDocument({
        _id: state.secondDoId,
        _type: 'deliveryOrder',
        doNumber: `AUD-COND-SECOND-${suffix}`,
        orderRef: state.orderId,
        masterResi: `AUD-COND-SECOND-${suffix}`,
        date: AUDIT_DATE,
        status: 'CREATED',
        trackingState: 'STOPPED',
        serviceRef: service._id,
        serviceName: service.name || service.serviceName,
        customerName: customer.name || customer.customerName || 'Audit Customer',
        pickupAddress: 'Audit Second Pickup',
        receiverName: 'Audit Receiver 2',
        receiverAddress: 'Audit Second Drop',
    });

    const blockedActive = await postData<AnyDoc>(adminCookie, {
        entity: 'delivery-orders',
        action: 'assign-trip-resources',
        data: { id: state.secondDoId, vehicleRef: vehicleId, driverRef: driverId },
    }, 409);
    assert(/masih|terkunci|aktif|dipakai|terikat/i.test(blockedActive.error || ''), `assign saat trip pertama belum selesai harus blocked, got: ${blockedActive.error}`);

    const deliveryOrderItemsBeforeFinish = await listDocumentsByFilter<AnyDoc>('deliveryOrderItem', {
        deliveryOrderRef: state.firstDoId,
    });
    const actualItemsForFinish = deliveryOrderItemsBeforeFinish.map(item => ({
        deliveryOrderItemRef: item._id,
        actualQtyKoli: item.orderItemQtyKoli ?? item.shippedQtyKoli ?? 1,
        actualWeightInputValue: item.orderItemWeightInputValue ?? item.orderItemWeight ?? item.shippedWeight ?? 1,
        actualWeightInputUnit: item.orderItemWeightInputUnit || 'KG',
        actualVolumeInputValue: item.orderItemVolumeInputValue ?? item.orderItemVolumeM3 ?? 1,
        actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
    }));
    await postData<AnyDoc>(adminCookie, {
        entity: 'delivery-orders',
        action: 'set-status',
        data: {
            id: state.firstDoId,
            status: 'DELIVERED',
            targetSuratJalanRefs: [sjARef, sjBRef],
            autoFinalizeSelectedSuratJalan: true,
            actualItems: actualItemsForFinish,
            podReceiverName: 'Audit Receiver',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit selesai sebelum uji assign ulang',
            note: 'Audit delivered before closure',
        },
    });
    const blockedDeliveredNoClosure = await postData<AnyDoc>(adminCookie, {
        entity: 'delivery-orders',
        action: 'assign-trip-resources',
        data: { id: state.secondDoId, vehicleRef: vehicleId, driverRef: driverId },
    }, 409);
    assert(/terkunci|Selesaikan|finalisasi|dipakai|terikat/i.test(blockedDeliveredNoClosure.error || ''), `assign delivered tanpa admin closure harus blocked, got: ${blockedDeliveredNoClosure.error}`);

    await postData<AnyDoc>(adminCookie, {
        entity: 'delivery-orders',
        action: 'set-trip-closure',
        data: {
            id: state.firstDoId,
            closed: true,
            newOdometer: 1500,
        },
    });
    const assigned = await postData<AnyDoc>(adminCookie, {
        entity: 'delivery-orders',
        action: 'assign-trip-resources',
        data: { id: state.secondDoId, vehicleRef: vehicleId, driverRef: driverId },
    });
    assert(assigned.data?.driverRef === driverId, 'assign setelah trip pertama closed tidak memasang driver');
    assert(assigned.data?.vehicleRef === vehicleId, 'assign setelah trip pertama closed tidak memasang vehicle');

    driverOrders = await getDriverOrders(token);
    assert(driverOrders.some(item => item._id === state.secondDoId), 'trip kedua setelah assign tidak muncul di mobile driver endpoint');

    console.log(JSON.stringify({
        ok: true,
        firstDo: state.firstDoId,
        secondDo: state.secondDoId,
        sjStatus: sjDocs.map(item => ({ no: item.suratJalanNumber, status: item.tripStatus })),
        incidents: [firstCycle.incidentId, secondCycle.incidentId],
        voucherTotalSpent: voucherAfterIncidents.totalSpent,
        linkedVoucherItems: linkedVoucherItems.map(item => ({
            amount: item.amount,
            category: item.category,
            line: item.relatedIncidentSettlementLineRef,
        })),
        assignBlockedActive: blockedActive.error,
        assignBlockedDeliveredNoClosure: blockedDeliveredNoClosure.error,
        assignedSecond: {
            driverRef: assigned.data.driverRef,
            vehicleRef: assigned.data.vehicleRef,
        },
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await cleanup();
    });
