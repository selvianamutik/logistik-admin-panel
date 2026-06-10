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
import { clearRelationalReadCache } from '../src/lib/supabase-relational';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';
import type { SuratJalanRecord } from '../src/lib/trip-document-types';

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const suffix = Date.now().toString().slice(-6);
const ids: Array<[string, string]> = [];
const driverId = `audit-add-sj-driver-${suffix}`;
const userId = `audit-add-sj-user-${suffix}`;
const orderId = `audit-add-sj-order-${suffix}`;
const orderItemAId = `audit-add-sj-order-item-${suffix}-a`;
const doId = `audit-add-sj-do-${suffix}`;
const doItemAId = `audit-add-sj-item-${suffix}-a`;
const refA = `ref-a-${suffix}`;
const refB = `ref-b-${suffix}`;
const sjA = `AUD-ADD-SJ-${suffix}-A`;
const sjB = `AUD-ADD-SJ-${suffix}-B`;
const email = `audit-add-sj-${suffix}@driver.local`;
const password = `Audit${suffix}!`;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

async function cleanup() {
    const [sjItems, sjDocs] = await Promise.all([
        listDocumentsByFilter<{ _id: string }>('suratJalanItem', { tripRef: doId }).catch(() => []),
        listDocumentsByFilter<{ _id: string }>('suratJalan', { tripRef: doId }).catch(() => []),
    ]);
    for (const item of sjItems) await deleteDocument(item._id, 'suratJalanItem').catch(() => undefined);
    for (const item of sjDocs) await deleteDocument(item._id, 'suratJalan').catch(() => undefined);
    for (const [id, type] of ids.reverse()) await deleteDocument(id, type).catch(() => undefined);
}

async function loginDriver() {
    const response = await fetch(`${BASE_URL}/api/driver/mobile/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`login driver ${response.status}: ${text}`);
    const parsed = JSON.parse(text) as { token?: string };
    assert(parsed.token, 'driver login tidak mengembalikan token');
    return parsed.token;
}

async function getMobileTrip(token: string) {
    const response = await fetch(`${BASE_URL}/api/driver/delivery-orders`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`mobile orders ${response.status}: ${text}`);
    const parsed = JSON.parse(text) as { data?: Array<DeliveryOrder & { driverSuratJalanRecords?: SuratJalanRecord[] }> };
    return (parsed.data || []).find(item => item._id === doId);
}

async function postBatch(token: string, status: string, refs: string[]) {
    const response = await fetch(`${BASE_URL}/api/driver/delivery-orders/batch-status`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: doId,
            status,
            targetSuratJalanRefs: refs,
            note: 'Audit tambah SJ setelah arrived',
        }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`batch ${status} ${response.status}: ${text}`);
}

async function postRefs(token: string) {
    const response = await fetch(`${BASE_URL}/api/driver/delivery-orders/shipper-references`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: doId,
            shipperReferences: [
                { _key: refA, referenceNumber: sjA, pickupStopKey: 'pickup-a' },
                { _key: refB, referenceNumber: sjB, pickupStopKey: 'pickup-b' },
            ],
        }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`shipper refs ${response.status}: ${text}`);
}

async function main() {
    try {
        await createDocument({ _id: driverId, _type: 'driver', name: 'Audit Add SJ Driver', active: true });
        ids.push([driverId, 'driver']);
        await createDocument({
            _id: userId,
            _type: 'user',
            name: 'Audit Add SJ Driver',
            email,
            role: 'DRIVER',
            active: true,
            driverRef: driverId,
            driverName: 'Audit Add SJ Driver',
            passwordHash: await hashPassword(password),
        });
        ids.push([userId, 'user']);
        await createDocument({
            _id: orderId,
            _type: 'order',
            masterResi: `AUD-ADD-SJ-RESI-${suffix}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerName: 'Audit Customer',
            pickupAddress: 'Pickup A',
            receiverName: 'Receiver',
            receiverAddress: 'Drop',
            serviceName: 'Audit Service',
            status: 'OPEN',
            createdAt: '2026-05-19',
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
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `AUD-ADD-SJ-${suffix}`,
            orderRef: orderId,
            masterResi: `AUD-ADD-SJ-RESI-${suffix}`,
            date: '2026-05-19',
            status: 'CREATED',
            trackingState: 'STOPPED',
            driverRef: driverId,
            driverName: 'Audit Add SJ Driver',
            vehiclePlate: 'AUDIT-ADD-1',
            customerName: 'Audit Customer',
            pickupAddress: 'Pickup A',
            receiverName: 'Receiver',
            receiverAddress: 'Drop',
            shipperReferences: [{ _key: refA, referenceNumber: sjA, pickupStopKey: 'pickup-a' }],
        });
        ids.push([doId, 'deliveryOrder']);
        await createDocument({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemRef: orderItemAId,
            orderItemDescription: 'Barang A',
            orderItemQtyKoli: 1,
            orderItemWeight: 100,
            orderItemWeightInputValue: 100,
            orderItemWeightInputUnit: 'KG',
            orderItemVolumeM3: 1,
            orderItemVolumeInputValue: 1,
            orderItemVolumeInputUnit: 'M3',
            shipperReferenceKey: refA,
            shipperReferenceNumber: sjA,
        } as DeliveryOrderItem & { _type: string; [key: string]: unknown });
        ids.push([doItemAId, 'deliveryOrderItem']);

        const token = await loginDriver();
        let trip = await getMobileTrip(token);
        assert(trip, 'trip awal tidak muncul di mobile');
        const refAId = trip.driverSuratJalanRecords?.find(record => record.suratJalanNumber === sjA)?._id || `${doId}:${refA}`;

        await updateDocument(doId, { trackingState: 'ACTIVE' }, 'deliveryOrder');
        await postBatch(token, 'ON_DELIVERY', [refAId]);
        await postBatch(token, 'ARRIVED', [refAId]);

        clearRelationalReadCache();
        let docs = await listDocumentsByFilter<SuratJalanRecord>('suratJalan', { tripRef: doId });
        assert(docs.find(record => record.suratJalanNumber === sjA)?.tripStatus === 'ARRIVED', 'SJ A belum ARRIVED sebelum tambah SJ B');

        await postRefs(token);
        clearRelationalReadCache();
        docs = await listDocumentsByFilter<SuratJalanRecord>('suratJalan', { tripRef: doId });
        const dbA = docs.find(record => record.suratJalanNumber === sjA);
        const dbB = docs.find(record => record.suratJalanNumber === sjB);
        trip = await getMobileTrip(token);
        const mobileA = trip?.driverSuratJalanRecords?.find(record => record.suratJalanNumber === sjA);
        const mobileB = trip?.driverSuratJalanRecords?.find(record => record.suratJalanNumber === sjB);
        assert(dbA?.tripStatus === 'ARRIVED', `DB SJ A rollback: ${dbA?.tripStatus}`);
        assert(dbB?.tripStatus === 'CREATED', `DB SJ B harus CREATED: ${dbB?.tripStatus}`);
        assert(mobileA?.tripStatus === 'ARRIVED', `mobile SJ A rollback: ${mobileA?.tripStatus}`);
        assert(mobileB?.tripStatus === 'CREATED', `mobile SJ B harus CREATED: ${mobileB?.tripStatus}`);

        const deliveryOrder = await getDocumentById<DeliveryOrder>(doId, 'deliveryOrder');
        console.log(JSON.stringify({
            ok: true,
            doStatus: deliveryOrder?.status,
            db: docs.map(record => ({ no: record.suratJalanNumber, status: record.tripStatus })),
            mobile: trip?.driverSuratJalanRecords?.map(record => ({ no: record.suratJalanNumber, status: record.tripStatus })),
        }, null, 2));
    } finally {
        await cleanup();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
