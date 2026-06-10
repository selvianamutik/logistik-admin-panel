import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import {
    createDocument,
    deleteDocument,
    listDocumentsByFilter,
    updateDocument,
} from '../src/lib/repositories/document-store';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';
import type { SuratJalanRecord } from '../src/lib/trip-document-types';

type DriverDeliveryOrderResponse = DeliveryOrder & {
    driverSuratJalanRecords?: SuratJalanRecord[];
};

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const AUDIT_DATE = '2026-05-17';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function loginDriver(email: string, password: string) {
    const response = await fetch(`${BASE_URL}/api/driver/mobile/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login mobile driver gagal (${response.status}): ${bodyText}`);
    }
    const parsed = JSON.parse(bodyText) as { token?: string };
    assert(parsed.token, 'Login mobile driver tidak mengembalikan token.');
    return parsed.token;
}

async function getDriverOrders(token: string) {
    const response = await fetch(`${BASE_URL}/api/driver/delivery-orders`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Ambil delivery order driver gagal (${response.status}): ${bodyText}`);
    }
    const parsed = JSON.parse(bodyText) as { data?: DriverDeliveryOrderResponse[] };
    return parsed.data || [];
}

async function postBatchStatus(
    token: string,
    params: {
        deliveryOrderId: string;
        status: string;
        targetSuratJalanRefs: string[];
    }
) {
    const response = await fetch(`${BASE_URL}/api/driver/delivery-orders/batch-status`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            id: params.deliveryOrderId,
            status: params.status,
            targetSuratJalanRefs: params.targetSuratJalanRefs,
            note: 'Audit mobile batch status per-SJ',
        }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Batch status driver gagal (${response.status}): ${bodyText}`);
    }
    return JSON.parse(bodyText) as { data?: { updatedCount?: number; targetSuratJalanRefs?: string[] } };
}

async function cleanup(ids: Array<[string, string]>, deliveryOrderId: string) {
    const [suratJalanItems, suratJalanDocs] = await Promise.all([
        listDocumentsByFilter<{ _id: string }>('suratJalanItem', { tripRef: deliveryOrderId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: deliveryOrderId }).catch(() => []),
    ]);
    for (const item of suratJalanItems) {
        await deleteDocument(item._id, 'suratJalanItem').catch(() => undefined);
    }
    for (const item of suratJalanDocs) {
        await deleteDocument(item._id, 'suratJalan').catch(() => undefined);
    }
    for (const [id, type] of ids.reverse()) {
        await deleteDocument(id, type).catch(() => undefined);
    }
}

async function createAuditTrip(suffix: string) {
    const ids: Array<[string, string]> = [];
    const driverId = `audit-mobile-batch-driver-${suffix}`;
    const userId = `audit-mobile-batch-user-${suffix}`;
    const orderId = `audit-mobile-batch-order-${suffix}`;
    const orderItemAId = `audit-mobile-batch-order-item-${suffix}-a`;
    const orderItemBId = `audit-mobile-batch-order-item-${suffix}-b`;
    const deliveryOrderId = `audit-mobile-batch-do-${suffix}`;
    const refAKey = `ref-a-${suffix}`;
    const refBKey = `ref-b-${suffix}`;
    const sjA = `AUD-MOB-BATCH-${suffix}-A`;
    const sjB = `AUD-MOB-BATCH-${suffix}-B`;
    const email = `audit-mobile-batch-${suffix}@driver.local`;
    const password = `Audit${suffix}!`;

    await createDocument({
        _id: driverId,
        _type: 'driver',
        name: 'Audit Mobile Batch Driver',
        active: true,
    });
    ids.push([driverId, 'driver']);

    await createDocument({
        _id: userId,
        _type: 'user',
        name: 'Audit Mobile Batch Driver',
        email,
        role: 'DRIVER',
        active: true,
        driverRef: driverId,
        driverName: 'Audit Mobile Batch Driver',
        passwordHash: await hashPassword(password),
    });
    ids.push([userId, 'user']);

    await createDocument({
        _id: orderId,
        _type: 'order',
        masterResi: `AUD-MOB-BATCH-RESI-${suffix}`,
        cargoEntryMode: 'DELIVERY_ORDER',
        customerName: 'Audit Customer',
        pickupAddress: 'Audit Pickup',
        receiverName: 'Audit Receiver',
        receiverAddress: 'Audit Drop',
        serviceName: 'Audit Service',
        status: 'OPEN',
        createdAt: AUDIT_DATE,
    });
    ids.push([orderId, 'order']);

    await createDocument({
        _id: orderItemAId,
        _type: 'orderItem',
        orderRef: orderId,
        description: 'Barang A',
        qtyKoli: 1,
        weight: 100,
        volume: 1,
        status: 'ASSIGNED',
    });
    ids.push([orderItemAId, 'orderItem']);

    await createDocument({
        _id: orderItemBId,
        _type: 'orderItem',
        orderRef: orderId,
        description: 'Barang B',
        qtyKoli: 1,
        weight: 200,
        volume: 2,
        status: 'ASSIGNED',
    });
    ids.push([orderItemBId, 'orderItem']);

    await createDocument({
        _id: deliveryOrderId,
        _type: 'deliveryOrder',
        doNumber: `AUD-MOB-BATCH-${suffix}`,
        orderRef: orderId,
        masterResi: `AUD-MOB-BATCH-RESI-${suffix}`,
        date: AUDIT_DATE,
        status: 'CREATED',
        trackingState: 'ACTIVE',
        driverRef: driverId,
        driverName: 'Audit Mobile Batch Driver',
        vehiclePlate: 'AUDIT-1',
        customerName: 'Audit Customer',
        pickupAddress: 'Audit Pickup',
        receiverName: 'Audit Receiver',
        receiverAddress: 'Audit Drop',
        shipperReferences: [
            { _key: refAKey, referenceNumber: sjA, pickupAddress: 'Pickup A' },
            { _key: refBKey, referenceNumber: sjB, pickupAddress: 'Pickup B' },
        ],
    });
    ids.push([deliveryOrderId, 'deliveryOrder']);

    const items: DeliveryOrderItem[] = [
        {
            _id: `audit-mobile-batch-item-${suffix}-a`,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: deliveryOrderId,
            orderItemRef: orderItemAId,
            orderItemDescription: 'Barang A',
            orderItemQtyKoli: 1,
            orderItemWeight: 100,
            orderItemWeightInputValue: 100,
            orderItemWeightInputUnit: 'KG',
            orderItemVolumeM3: 1,
            orderItemVolumeInputValue: 1,
            orderItemVolumeInputUnit: 'M3',
            shipperReferenceKey: refAKey,
            shipperReferenceNumber: sjA,
        } as DeliveryOrderItem,
        {
            _id: `audit-mobile-batch-item-${suffix}-b`,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: deliveryOrderId,
            orderItemRef: orderItemBId,
            orderItemDescription: 'Barang B',
            orderItemQtyKoli: 1,
            orderItemWeight: 200,
            orderItemWeightInputValue: 200,
            orderItemWeightInputUnit: 'KG',
            orderItemVolumeM3: 2,
            orderItemVolumeInputValue: 2,
            orderItemVolumeInputUnit: 'M3',
            shipperReferenceKey: refBKey,
            shipperReferenceNumber: sjB,
        } as DeliveryOrderItem,
    ];
    for (const item of items) {
        await createDocument({ ...item } as { _type: string; [key: string]: unknown });
        ids.push([item._id, 'deliveryOrderItem']);
    }

    return {
        ids,
        email,
        password,
        deliveryOrderId,
        sjA,
        sjB,
        refAKey,
    };
}

async function runScenario(
    label: string,
    params: {
        targetRefFactory: (deliveryOrderId: string, sjA: string, mobileDocId: string, refAKey: string) => string;
    }
) {
    const suffix = `${Date.now().toString().slice(-6)}-${label.toLowerCase()}`;
    const state = await createAuditTrip(suffix);
    try {
        const token = await loginDriver(state.email, state.password);
        const beforeOrders = await getDriverOrders(token);
        const beforeTrip = beforeOrders.find(item => item._id === state.deliveryOrderId);
        assert(beforeTrip, `${label}: trip audit tidak muncul di mobile endpoint.`);
        const beforeRecords = beforeTrip.driverSuratJalanRecords || [];
        const mobileDocA = beforeRecords.find(record => record.suratJalanNumber === state.sjA);
        assert(mobileDocA?._id, `${label}: SJ A tidak punya document id dari mobile endpoint.`);

        const targetRef = params.targetRefFactory(state.deliveryOrderId, state.sjA, mobileDocA._id, state.refAKey);
        const updateResult = await postBatchStatus(token, {
            deliveryOrderId: state.deliveryOrderId,
            status: 'ON_DELIVERY',
            targetSuratJalanRefs: [targetRef],
        });
        assert(updateResult.data?.updatedCount === 1, `${label}: endpoint harus update tepat 1 SJ.`);

        const afterRecords = await listDocumentsByFilter<SuratJalanRecord>('suratJalan', {
            tripRef: state.deliveryOrderId,
        });
        console.log(
            `[audit:mobile-batch-status] ${label} DB readback`,
            JSON.stringify(afterRecords.map(record => ({
                _id: record._id,
                no: record.suratJalanNumber,
                status: record.tripStatus,
            })))
        );
        const recordA = afterRecords.find(record => record.suratJalanNumber === state.sjA);
        const recordB = afterRecords.find(record => record.suratJalanNumber === state.sjB);
        assert(recordA?.tripStatus === 'ON_DELIVERY', `${label}: SJ A harus ON_DELIVERY setelah update.`);
        assert(recordB?.tripStatus === 'CREATED', `${label}: SJ B harus tetap CREATED setelah update SJ A.`);

        const afterOrders = await getDriverOrders(token);
        const afterTrip = afterOrders.find(item => item._id === state.deliveryOrderId);
        assert(afterTrip, `${label}: trip audit hilang dari mobile endpoint setelah update.`);
        const afterMobileRecords = afterTrip.driverSuratJalanRecords || [];
        console.log(
            `[audit:mobile-batch-status] ${label} mobile readback`,
            JSON.stringify(afterMobileRecords.map(record => ({
                _id: record._id,
                no: record.suratJalanNumber,
                status: record.tripStatus,
            })))
        );
        assert(
            afterMobileRecords.find(record => record.suratJalanNumber === state.sjA)?.tripStatus === 'ON_DELIVERY',
            `${label}: mobile readback SJ A harus ON_DELIVERY.`
        );
        assert(
            afterMobileRecords.find(record => record.suratJalanNumber === state.sjB)?.tripStatus === 'CREATED',
            `${label}: mobile readback SJ B harus tetap CREATED.`
        );

        await updateDocument(state.deliveryOrderId, { status: 'CREATED' }, 'deliveryOrder');
        console.log(`[audit:mobile-batch-status] ${label} OK: ${state.sjA} -> ON_DELIVERY, ${state.sjB} tetap CREATED.`);
    } finally {
        await cleanup(state.ids, state.deliveryOrderId);
    }
}

async function main() {
    await runScenario('DOCUMENT_ID', {
        targetRefFactory: (_deliveryOrderId, _sjA, mobileDocId) => mobileDocId,
    });
    await runScenario('REFERENCE_NUMBER_ALIAS', {
        targetRefFactory: (deliveryOrderId, sjA) => `${deliveryOrderId}:${sjA}`,
    });
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
