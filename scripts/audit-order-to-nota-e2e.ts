import { loadScriptEnv } from './_env';

loadScriptEnv();

import { buildNotaRowsFromDeliveryOrder } from '../src/lib/invoice-create-page-support';
import type { DeliveryOrder, DeliveryOrderItem, Driver, FreightNota, FreightNotaItem, Order, Vehicle } from '../src/lib/types';

type ApiResponse<T> = {
    data?: T;
    id?: string;
    error?: string;
};

type CustomerLike = {
    _id: string;
    name?: string;
    active?: boolean;
};

type ServiceLike = {
    _id: string;
    name?: string;
    active?: boolean;
};

type BankAccountLike = {
    _id: string;
    active?: boolean;
};

type CreatedState = {
    orderId?: string;
    deliveryOrderIds: string[];
    notaId?: string;
};

const AUDIT_DATE = '2026-04-21';
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
    console.log(`[audit:order-to-nota] ${message}`);
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout setelah ${timeoutMs} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function cleanEnv(value: string | undefined) {
    const trimmed = value?.trim().replace(/^['"]+|['"]+$/g, '');
    return trimmed || undefined;
}

function getSupabaseConfig() {
    const url = cleanEnv(
        process.env.SUPABASE_URL ||
        process.env.SUPABASE_PROJECT_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.NEXT_PUBLIC_SUPABASE_PROJECT_URL
    );
    const key = cleanEnv(
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_KEY ||
        process.env.SUPABASE_SECRET_KEY ||
        process.env.SUPABASE_SERVICE_ROLE
    );
    assert(url && key, 'Audit cleanup butuh SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.');
    return { url, key };
}

async function supabaseRest<T>(path: string, init: RequestInit = {}) {
    const config = getSupabaseConfig();
    const headers = new Headers(init.headers);
    headers.set('apikey', config.key);
    headers.set('Authorization', `Bearer ${config.key}`);
    headers.set('Content-Type', 'application/json');
    const response = await fetchWithTimeout(`${config.url}/rest/v1/${path}`, {
        ...init,
        headers,
    }, `Supabase ${init.method || 'GET'} ${path}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Supabase ${init.method || 'GET'} ${path} -> ${response.status}: ${bodyText}`);
    }
    return bodyText ? JSON.parse(bodyText) as T : undefined as T;
}

async function listSourceIds(table: string, filter: string) {
    const rows = await supabaseRest<Array<{ source_document_id: string }>>(
        `${table}?select=source_document_id&${filter}`
    );
    return (rows || []).map(row => row.source_document_id).filter(Boolean);
}

async function deleteBySourceId(table: string, id: string) {
    if (!id) return;
    await supabaseRest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
    }).catch(() => undefined);
}

async function loginAndGetCookieHeader() {
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
    const actionLabel = `${normalizeText(payload.entity) || 'entity'}:${normalizeText(payload.action) || 'action'}`;
    const response = await fetchWithTimeout(`${getBaseUrl()}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: getBaseUrl(),
            Referer: `${getBaseUrl()}/orders`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
    }, `POST /api/data ${actionLabel}`);

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

async function cleanupCreatedState(state: CreatedState) {
    if (state.notaId) {
        const notaItemIds = await listSourceIds('freight_nota_items', `nota_ref=eq.${encodeURIComponent(state.notaId)}`).catch(() => []);
        for (const itemId of notaItemIds) {
            await deleteBySourceId('freight_nota_items', itemId);
        }
        await deleteBySourceId('freight_notas', state.notaId);
    }

    for (const deliveryOrderId of state.deliveryOrderIds) {
        const notaItemIds = await listSourceIds('freight_nota_items', `do_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []);
        const notaIds = new Set<string>();
        for (const itemId of notaItemIds) {
            const rows = await supabaseRest<Array<{ nota_ref?: string }>>(
                `freight_nota_items?select=nota_ref&source_document_id=eq.${encodeURIComponent(itemId)}`
            ).catch(() => []);
            rows?.forEach(row => {
                if (row.nota_ref) notaIds.add(row.nota_ref);
            });
            await deleteBySourceId('freight_nota_items', itemId);
        }
        for (const notaId of notaIds) {
            await deleteBySourceId('freight_notas', notaId);
        }

        const [deliveryOrderItemIds, trackingLogIds, driverVoucherIds] = await Promise.all([
            listSourceIds('delivery_order_items', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('tracking_logs', `ref_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
            listSourceIds('driver_vouchers', `delivery_order_ref=eq.${encodeURIComponent(deliveryOrderId)}`).catch(() => []),
        ]);
        for (const itemId of deliveryOrderItemIds) {
            await deleteBySourceId('delivery_order_items', itemId);
        }
        for (const itemId of trackingLogIds) {
            await deleteBySourceId('tracking_logs', itemId);
        }
        for (const itemId of driverVoucherIds) {
            await deleteBySourceId('driver_vouchers', itemId);
        }
        await deleteBySourceId('delivery_orders', deliveryOrderId);
    }

    if (state.orderId) {
        const orderItemIds = await listSourceIds('order_items', `order_ref=eq.${encodeURIComponent(state.orderId)}`).catch(() => []);
        for (const itemId of orderItemIds) {
            await deleteBySourceId('order_items', itemId);
        }
        await deleteBySourceId('orders', state.orderId);
    }
}

async function cleanupStaleAuditOrders() {
    const rows = await supabaseRest<Array<{ source_document_id: string }>>(
        'orders?select=source_document_id&notes=ilike.*Audit%20E2E*'
    ).catch(() => []);
    for (const row of rows || []) {
        const deliveryOrderIds = await listSourceIds('delivery_orders', `order_ref=eq.${encodeURIComponent(row.source_document_id)}`).catch(() => []);
        await cleanupCreatedState({
            orderId: row.source_document_id,
            deliveryOrderIds,
        });
    }
}

function pickAuditResources(params: {
    customers: CustomerLike[];
    services: ServiceLike[];
    vehicles: Vehicle[];
    drivers: Driver[];
    bankAccounts: BankAccountLike[];
    deliveryOrders: DeliveryOrder[];
}) {
    const activeDeliveryOrders = params.deliveryOrders.filter(item =>
        ['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED'].includes(normalizeText(item.status))
    );
    const busyVehicleIds = new Set(activeDeliveryOrders.map(item => normalizeText(item.vehicleRef)).filter(Boolean));
    const busyDriverIds = new Set(activeDeliveryOrders.map(item => normalizeText(item.driverRef)).filter(Boolean));
    const activeServices = params.services.filter(item => item.active !== false);
    const availableVehicles = params.vehicles.filter(item =>
        item.status !== 'SOLD' &&
        item.status !== 'OUT_OF_SERVICE' &&
        !busyVehicleIds.has(item._id)
    );
    const availableDrivers = params.drivers.filter(item => item.active !== false && !busyDriverIds.has(item._id));

    for (const service of activeServices) {
        const matchingVehicles = availableVehicles.filter(vehicle => normalizeText(vehicle.serviceRef) === service._id);
        if (matchingVehicles.length >= 2 && availableDrivers.length >= 1) {
            return {
                customer: params.customers.find(item => item.active !== false),
                service,
                vehicles: matchingVehicles.slice(0, 2),
                drivers: availableDrivers.length >= 2 ? availableDrivers.slice(0, 2) : [availableDrivers[0], availableDrivers[0]],
                bankAccount: params.bankAccounts.find(item => item.active !== false),
            };
        }
    }

    return {
        customer: params.customers.find(item => item.active !== false),
        service: undefined,
        vehicles: availableVehicles.slice(0, 2),
        drivers: availableDrivers.length >= 2 ? availableDrivers.slice(0, 2) : availableDrivers.length === 1 ? [availableDrivers[0], availableDrivers[0]] : [],
        bankAccount: params.bankAccounts.find(item => item.active !== false),
    };
}

async function getDeliveryOrderItems(cookieHeader: string, deliveryOrderId: string) {
    const response = await requestJson<{ data: DeliveryOrderItem[] }>(
        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef: deliveryOrderId }))}`,
        cookieHeader
    );
    return Array.isArray(response.data) ? response.data : [];
}

async function advanceDeliveryOrderToDelivered(params: {
    cookieHeader: string;
    deliveryOrderId: string;
    actualItems: Array<Record<string, unknown>>;
    actualDropPoints: Array<Record<string, unknown>>;
}) {
    for (const status of ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED']) {
        await postData(params.cookieHeader, {
            entity: 'delivery-orders',
            action: 'set-status',
            data: {
                id: params.deliveryOrderId,
                status,
                note: `Audit ${status}`,
            },
        });
    }

    await postData(params.cookieHeader, {
        entity: 'delivery-orders',
        action: 'set-status',
        data: {
            id: params.deliveryOrderId,
            status: 'DELIVERED',
            note: 'Audit selesai',
            podReceiverName: 'Penerima Audit',
            podReceivedDate: AUDIT_DATE,
            podNote: 'Audit POD',
            actualItems: params.actualItems,
            actualDropPoints: params.actualDropPoints,
        },
    });
}

async function main() {
    const cookieHeader = await loginAndGetCookieHeader();
    const createdState: CreatedState = { deliveryOrderIds: [] };
    const suffix = Date.now().toString().slice(-6);
    const pickupOneKey = `audit-pickup-1-${suffix}`;
    const pickupTwoKey = `audit-pickup-2-${suffix}`;
    const tripOneKey = `audit-trip-1-${suffix}`;
    const tripTwoKey = `audit-trip-2-${suffix}`;
    const sjA = `AUD-${suffix}-A`;
    const sjB = `AUD-${suffix}-B`;
    const sjHold = `AUD-${suffix}-HOLD`;

    try {
        auditStep('cleanup data audit lama');
        await cleanupStaleAuditOrders();
        auditStep('ambil master data dan DO aktif');
        const [customerResponse, serviceResponse, vehicleResponse, driverResponse, bankResponse, deliveryOrderResponse] = await Promise.all([
            requestJson<{ data: CustomerLike[] }>('/api/data?entity=customers', cookieHeader),
            requestJson<{ data: ServiceLike[] }>('/api/data?entity=services', cookieHeader),
            requestJson<{ data: Vehicle[] }>('/api/data?entity=vehicles', cookieHeader),
            requestJson<{ data: Driver[] }>('/api/data?entity=drivers', cookieHeader),
            requestJson<{ data: BankAccountLike[] }>('/api/data?entity=bank-accounts', cookieHeader),
            requestJson<{ data: DeliveryOrder[] }>('/api/data?entity=delivery-orders', cookieHeader),
        ]);
        const resources = pickAuditResources({
            customers: customerResponse.data || [],
            services: serviceResponse.data || [],
            vehicles: vehicleResponse.data || [],
            drivers: driverResponse.data || [],
            bankAccounts: bankResponse.data || [],
            deliveryOrders: deliveryOrderResponse.data || [],
        });
        assert(resources.customer, 'Audit butuh minimal 1 customer aktif.');
        assert(resources.service, 'Audit butuh minimal 1 kategori armada dengan 2 kendaraan tersedia.');
        assert(resources.vehicles.length >= 2, 'Audit butuh minimal 2 kendaraan tersedia pada kategori armada yang sama.');
        assert(resources.drivers.length >= 2, 'Audit butuh minimal 1 supir tersedia untuk dipakai berurutan pada 2 trip.');
        assert(resources.bankAccount, 'Audit butuh minimal 1 rekening/kas aktif.');

        auditStep('create order header booking dengan 2 pickup dan 2 rencana trip');
        const orderCreate = await postData<Order>(cookieHeader, {
            entity: 'orders',
            action: 'create-with-items',
            data: {
                customerRef: resources.customer._id,
                serviceRef: resources.service._id,
                pickupAddress: 'Audit Pickup Utama',
                pickupStops: [
                    {
                        _key: pickupOneKey,
                        sequence: 1,
                        pickupLabel: 'Audit Pickup 1',
                        pickupAddress: 'Audit Pickup 1 Address',
                    },
                    {
                        _key: pickupTwoKey,
                        sequence: 2,
                        pickupLabel: 'Audit Pickup 2',
                        pickupAddress: 'Audit Pickup 2 Address',
                    },
                ],
                notes: `Audit E2E ${suffix}`,
                items: [],
                tripDrafts: [
                    {
                        _key: tripOneKey,
                        pickupStopKeys: [pickupOneKey],
                        vehicleRef: resources.vehicles[0]._id,
                        driverRef: resources.drivers[0]._id,
                        taripBorongan: 250000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 100000,
                        date: AUDIT_DATE,
                    },
                    {
                        _key: tripTwoKey,
                        pickupStopKeys: [pickupTwoKey],
                        vehicleRef: resources.vehicles[1]._id,
                        driverRef: resources.drivers[1]._id,
                        taripBorongan: 275000,
                        issueBankRef: resources.bankAccount._id,
                        cashGiven: 120000,
                        date: AUDIT_DATE,
                    },
                ],
            },
        });
        createdState.orderId = normalizeText(orderCreate.data?._id) || normalizeText(orderCreate.id);
        assert(createdState.orderId, 'Create order tidak mengembalikan ID.');

        const createdOrder = await requestJson<{ data: Order }>(
            `/api/data?entity=orders&id=${encodeURIComponent(createdState.orderId)}`,
            cookieHeader
        );
        assert(createdOrder.data.cargoEntryMode === 'DELIVERY_ORDER', 'Order header booking harus memakai mode barang di Surat Jalan.');
        assert((createdOrder.data.tripPlans || []).length === 2, 'Order harus menyimpan 2 rencana trip.');

        auditStep('create DO trip 1 dengan 2 nomor SJ dan 2 barang');
        const doOneCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripOneKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjA, pickupStopKey: pickupOneKey },
                    { referenceNumber: sjB, pickupStopKey: pickupOneKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang A',
                        qtyKoli: 2,
                        weightInputValue: 200,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupOneKey,
                        shipperReferenceNumber: sjA,
                    },
                    {
                        description: 'Audit barang B',
                        qtyKoli: 3,
                        weightInputValue: 300,
                        weightInputUnit: 'KG',
                        volumeInputValue: 1.5,
                        volumeInputUnit: 'M3',
                        pickupStopKey: pickupOneKey,
                        shipperReferenceNumber: sjB,
                    },
                ],
            },
        });
        const doOneId = normalizeText(doOneCreate.data?._id) || normalizeText(doOneCreate.id);
        assert(doOneId, 'Create DO trip 1 tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doOneId);

        let doOneItems = await getDeliveryOrderItems(cookieHeader, doOneId);
        assert(doOneItems.length === 2, 'DO trip 1 harus punya 2 barang.');
        assert(
            doOneItems.some(item => item.shipperReferenceNumber === sjA) &&
            doOneItems.some(item => item.shipperReferenceNumber === sjB),
            'Barang DO trip 1 harus tersambung ke masing-masing nomor SJ pengirim.'
        );
        assert(
            doOneItems.every(item => normalizeText(item.pickupStopKey)),
            'Barang DO trip 1 harus menyimpan pickupStopKey.'
        );

        doOneItems = await getDeliveryOrderItems(cookieHeader, doOneId);
        auditStep('finalisasi DO trip 1 sebagai campuran drop billable dan hold non-billable');
        await advanceDeliveryOrderToDelivered({
            cookieHeader,
            deliveryOrderId: doOneId,
            actualItems: doOneItems.map(item => ({
                deliveryOrderItemRef: item._id,
                actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
                actualWeightInputValue: normalizeNumber(item.orderItemWeight),
                actualWeightInputUnit: 'KG',
                actualVolumeInputValue: normalizeNumber(item.orderItemVolumeInputValue ?? item.orderItemVolumeM3),
                actualVolumeInputUnit: item.orderItemVolumeInputUnit || 'M3',
            })),
            actualDropPoints: [
                {
                    stopType: 'DROP',
                    shipperReferenceNumber: sjA,
                    locationName: 'Audit Drop A',
                    locationAddress: 'Audit Drop A Address',
                    qtyKoli: 2,
                    weightInputValue: 200,
                    weightInputUnit: 'KG',
                    volumeInputValue: 1,
                    volumeInputUnit: 'M3',
                },
                {
                    stopType: 'HOLD',
                    shipperReferenceNumber: sjB,
                    locationName: 'Audit Gudang Hold B',
                    locationAddress: 'Audit Gudang Hold B Address',
                    qtyKoli: 3,
                    weightInputValue: 300,
                    weightInputUnit: 'KG',
                    volumeInputValue: 1.5,
                    volumeInputUnit: 'M3',
                },
            ],
        });

        auditStep('create DO trip 2 setelah trip 1 selesai untuk skenario hold');
        const doTwoCreate = await postData<DeliveryOrder>(cookieHeader, {
            entity: 'delivery-orders',
            action: 'create-with-items',
            data: {
                orderRef: createdState.orderId,
                orderTripPlanKey: tripTwoKey,
                date: AUDIT_DATE,
                shipperReferences: [
                    { referenceNumber: sjHold, pickupStopKey: pickupTwoKey },
                ],
                cargoItems: [
                    {
                        description: 'Audit barang hold final',
                        qtyKoli: 4,
                        weightInputValue: 400,
                        weightInputUnit: 'KG',
                        pickupStopKey: pickupTwoKey,
                        shipperReferenceNumber: sjHold,
                    },
                ],
            },
        });
        const doTwoId = normalizeText(doTwoCreate.data?._id) || normalizeText(doTwoCreate.id);
        assert(doTwoId, 'Create DO trip 2 tidak mengembalikan ID.');
        createdState.deliveryOrderIds.push(doTwoId);

        auditStep('uji append barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'append-cargo-items',
            data: {
                id: doTwoId,
                cargoItems: [
                    {
                        description: 'Audit barang sementara',
                        qtyKoli: 1,
                        weightInputValue: 50,
                        weightInputUnit: 'KG',
                        shipperReferenceNumber: sjHold,
                    },
                ],
            },
        });
        let doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const temporaryItem = doTwoItems.find(item => item.orderItemDescription === 'Audit barang sementara');
        assert(temporaryItem, 'Append barang ke DO trip 2 tidak tersimpan.');
        assert(temporaryItem.shipperReferenceNumber === sjHold, 'Append barang harus tetap tersambung ke SJ hold.');

        auditStep('uji edit barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'update-cargo-item',
            data: {
                id: doTwoId,
                deliveryOrderItemId: temporaryItem._id,
                cargoItem: {
                    description: 'Audit barang sementara revisi',
                    qtyKoli: 1,
                    weightInputValue: 60,
                    weightInputUnit: 'KG',
                    shipperReferenceNumber: sjHold,
                },
            },
        });
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        const revisedTemporaryItem = doTwoItems.find(item => item._id === temporaryItem._id);
        assert(revisedTemporaryItem?.orderItemDescription === 'Audit barang sementara revisi', 'Edit barang DO trip 2 tidak tersimpan.');
        assert(revisedTemporaryItem.shipperReferenceNumber === sjHold, 'Edit barang DO trip 2 tidak boleh melepas nomor SJ.');

        auditStep('uji hapus barang DO trip 2');
        await postData(cookieHeader, {
            entity: 'delivery-orders',
            action: 'remove-cargo-item',
            data: {
                id: doTwoId,
                deliveryOrderItemId: temporaryItem._id,
            },
        });
        doTwoItems = await getDeliveryOrderItems(cookieHeader, doTwoId);
        assert(!doTwoItems.some(item => item._id === temporaryItem._id), 'Hapus barang DO trip 2 tidak menghapus item.');
        assert(doTwoItems.length === 1, 'DO trip 2 harus tersisa 1 barang untuk realisasi hold.');
        assert(doTwoItems[0].shipperReferenceNumber === sjHold, 'Barang sisa DO trip 2 harus tetap tersambung ke SJ hold.');

        auditStep('finalisasi DO trip 2 sebagai hold non-billable');
        await advanceDeliveryOrderToDelivered({
            cookieHeader,
            deliveryOrderId: doTwoId,
            actualItems: doTwoItems.map(item => ({
                deliveryOrderItemRef: item._id,
                actualQtyKoli: normalizeNumber(item.orderItemQtyKoli),
                actualWeightInputValue: normalizeNumber(item.orderItemWeight),
                actualWeightInputUnit: 'KG',
            })),
            actualDropPoints: [
                {
                    stopType: 'HOLD',
                    shipperReferenceNumber: sjHold,
                    locationName: 'Audit Gudang Hold',
                    locationAddress: 'Audit Gudang Hold Address',
                    qtyKoli: 4,
                    weightInputValue: 400,
                    weightInputUnit: 'KG',
                },
            ],
        });

        const deliveredOrder = await requestJson<{ data: Order }>(
            `/api/data?entity=orders&id=${encodeURIComponent(createdState.orderId)}`,
            cookieHeader
        );
        assert(deliveredOrder.data.status === 'PARTIAL', `Order harus PARTIAL setelah campuran drop/hold dan 1 trip hold-only, sekarang ${deliveredOrder.data.status}.`);

        auditStep('create nota dari SJ billable pada DO campuran dan verifikasi row per SJ');
        const doOneState = await requestJson<{ data: DeliveryOrder }>(
            `/api/data?entity=delivery-orders&id=${encodeURIComponent(doOneId)}`,
            cookieHeader
        );
        const suggestedNotaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: doOneState.data,
            orders: [deliveredOrder.data],
            deliveryOrderItems: doOneItems,
        });
        const suggestedBillableRow = suggestedNotaRows.find(row => row.noSJ === sjA);
        assert(suggestedBillableRow, 'Builder nota harus menghasilkan row untuk SJ billable.');
        assert(
            normalizeText(suggestedBillableRow.barang).includes('Audit barang A') &&
            !normalizeText(suggestedBillableRow.barang).includes('Audit barang B'),
            'Builder nota tidak boleh mencampur nama barang hold ke row SJ billable.'
        );
        assert(
            suggestedNotaRows.every(row => row.noSJ !== sjB),
            'Builder nota tidak boleh menghasilkan row untuk SJ yang hanya hold.'
        );
        const notaRows = doOneItems
            .sort((left, right) => String(left.shipperReferenceNumber || '').localeCompare(String(right.shipperReferenceNumber || '')))
            .filter(item => item.shipperReferenceNumber === sjA)
            .map(item => ({
                doRef: doOneId,
                deliveryOrderItemRef: item._id,
                noSJ: item.shipperReferenceNumber,
                tarip: 1000,
            }));
        const notaCreate = await postData<FreightNota>(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: notaRows,
            },
        });
        createdState.notaId = normalizeText(notaCreate.data?._id) || normalizeText(notaCreate.id);
        assert(createdState.notaId, 'Create nota dari DO billable tidak mengembalikan ID.');

        const notaItemsResponse = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: createdState.notaId }))}`,
            cookieHeader
        );
        const notaItems = Array.isArray(notaItemsResponse.data) ? notaItemsResponse.data : [];
        assert(notaItems.length === 1, `Nota harus hanya punya 1 row SJ billable, sekarang ${notaItems.length}.`);
        assert(
            notaItems.some(item => item.noSJ === sjA && normalizeNumber(item.beratKg) === 200),
            'Row nota harus mengikuti berat billable per SJ A.'
        );
        assert(
            notaItems.every(item => normalizeText(item.tujuan).startsWith('Audit Drop')),
            'Tujuan nota harus berasal dari titik drop aktual per SJ.'
        );

        auditStep('pastikan SJ hold pada DO campuran tidak bisa ditagihkan');
        const heldMixedItem = doOneItems.find(item => item.shipperReferenceNumber === sjB);
        assert(heldMixedItem, 'Item hold pada DO campuran harus ditemukan.');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: [
                    {
                        doRef: doOneId,
                        deliveryOrderItemRef: heldMixedItem._id,
                        noSJ: sjB,
                        tarip: 1000,
                    },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('pastikan DO hold-only ditolak untuk nota');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'create-with-items',
            data: {
                issueDate: AUDIT_DATE,
                dueDate: AUDIT_DATE,
                billingMode: 'PER_KG',
                items: [
                    {
                        doRef: doTwoId,
                        deliveryOrderItemRef: doTwoItems[0]._id,
                        noSJ: sjHold,
                        tarip: 1000,
                    },
                ],
            },
        }, { expectStatus: 409 });

        auditStep('hapus nota dan verifikasi item nota ikut terhapus');
        await postData(cookieHeader, {
            entity: 'freight-notas',
            action: 'delete',
            data: {
                id: createdState.notaId,
            },
        });
        const deletedNotaItems = await requestJson<{ data: FreightNotaItem[] }>(
            `/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: createdState.notaId }))}`,
            cookieHeader
        );
        assert((deletedNotaItems.data || []).length === 0, 'Delete nota harus menghapus row freightNotaItem.');
        createdState.notaId = undefined;

        console.log('Order to nota E2E audit OK: create order, multi-trip DO, mixed drop/hold SJ, append/edit/delete cargo, hold-only completion, nota create/delete verified.');
    } finally {
        auditStep('cleanup data audit berjalan');
        await cleanupCreatedState(createdState);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
