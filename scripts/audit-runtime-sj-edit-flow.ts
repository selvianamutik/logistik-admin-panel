import { loadScriptEnv } from './_env';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

type DeliveryOrderHeaderSnapshot = {
    _id?: string;
    customerDoNumber?: string;
    shipperReferences?: Array<{ _key?: string; referenceNumber?: string }>;
};

type DeliveryOrderItemSnapshot = {
    _id: string;
    shipperReferenceNumber?: string;
    orderItemDescription?: string;
};

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-script',
    name: 'Audit Owner',
    email: 'audit.owner@company.local',
    role: 'OWNER',
};

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseResponse(response: Response | undefined) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) {
        return;
    }
    const transaction = client.transaction();
    for (const id of ids) {
        transaction.delete(id);
    }
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-SJ-EDIT-*"]._id`
    );
    const orderItemIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "orderItem" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
        )
        : [];
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...doItemIds,
        ...doIds,
        ...orderItemIds,
        ...orderIds,
    ]);
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const {
        handleDeliveryOrderAppendCargoItems,
        handleDeliveryOrderCargoItemRemove,
        handleDeliveryOrderCargoItemUpdate,
        handleDeliveryOrderShipperReferenceUpdate,
    } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const businessDate = getBusinessDateValue();
    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const orderId = `audit-order-sj-edit-${uniqueSeed.toLowerCase()}`;
    const doId = `audit-do-sj-edit-${uniqueSeed.toLowerCase()}`;
    const pickupKey = `pickup-${uniqueSeed.toLowerCase()}`;

    try {
        await client.create({
            _id: orderId,
            _type: 'order',
            masterResi: `AUDIT-SJ-EDIT-${uniqueSeed}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Gudang Audit SJ Edit',
            receiverAddress: 'Tujuan Audit SJ Edit',
            pickupStops: [
                {
                    _key: pickupKey,
                    label: 'Pickup Audit',
                    pickupAddress: 'Gudang Audit SJ Edit',
                },
            ],
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'OPEN',
            createdAt: new Date().toISOString(),
            createdBy: ownerSession._id,
        });

        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-SJ-EDIT-${uniqueSeed}`,
            masterResi: `AUDIT-SJ-EDIT-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: businessDate,
            status: 'CREATED',
            orderRef: orderId,
            pickupAddress: 'Gudang Audit SJ Edit',
            receiverAddress: 'Tujuan Audit SJ Edit',
            pickupStops: [
                {
                    _key: pickupKey,
                    label: 'Pickup Audit',
                    pickupAddress: 'Gudang Audit SJ Edit',
                },
            ],
        });

        await parseResponse(
            await handleDeliveryOrderAppendCargoItems(
                ownerSession,
                {
                    id: doId,
                    cargoItems: [
                        {
                            pickupStopKey: pickupKey,
                            shipperReferenceNumber: `SJ-A-${uniqueSeed}`,
                            description: 'Barang Audit A',
                            qtyKoli: 3,
                            weightInputValue: 90,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.3,
                            volumeInputUnit: 'M3',
                        },
                        {
                            pickupStopKey: pickupKey,
                            shipperReferenceNumber: `SJ-B-${uniqueSeed}`,
                            description: 'Barang Audit B',
                            qtyKoli: 2,
                            weightInputValue: 60,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.2,
                            volumeInputUnit: 'M3',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        let deliveryOrder = await client.fetch<DeliveryOrderHeaderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, customerDoNumber, shipperReferences[]{ _key, referenceNumber } }`,
            { id: doId }
        );
        let deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{ _id, shipperReferenceNumber, orderItemDescription }`,
            { id: doId }
        );

        assert(deliveryOrder, 'DO audit edit SJ tidak ditemukan.');
        assert((deliveryOrder.shipperReferences || []).length === 2, 'Append cargo tidak membentuk tepat 2 SJ.');
        assert(deliveryOrderItems.length === 2, 'Append cargo tidak membentuk tepat 2 item DO.');

        const existingRefs = deliveryOrder.shipperReferences || [];
        const refA = existingRefs.find(reference => reference.referenceNumber === `SJ-A-${uniqueSeed}`);
        const refB = existingRefs.find(reference => reference.referenceNumber === `SJ-B-${uniqueSeed}`);
        assert(refA?._key && refB?._key, 'SJ awal tidak punya _key stabil untuk rename.');

        await parseResponse(
            await handleDeliveryOrderShipperReferenceUpdate(
                ownerSession,
                {
                    id: doId,
                    shipperReferences: [
                        {
                            _key: refA._key,
                            referenceNumber: `SJ-C-${uniqueSeed}`,
                            pickupStopKey: pickupKey,
                        },
                        {
                            _key: refB._key,
                            referenceNumber: `SJ-D-${uniqueSeed}`,
                            pickupStopKey: pickupKey,
                        },
                    ],
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderHeaderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, customerDoNumber, shipperReferences[]{ _key, referenceNumber } }`,
            { id: doId }
        );
        deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{ _id, shipperReferenceNumber, orderItemDescription }`,
            { id: doId }
        );

        const renamedRefs = (deliveryOrder?.shipperReferences || []).map(reference => reference.referenceNumber).filter(Boolean);
        assert(renamedRefs.length === 2, 'Rename SJ membuat jumlah SJ berubah tidak sesuai.');
        assert(new Set(renamedRefs).size === 2, 'Rename SJ menghasilkan referensi duplikat.');
        assert(renamedRefs.includes(`SJ-C-${uniqueSeed}`) && renamedRefs.includes(`SJ-D-${uniqueSeed}`), 'Rename SJ tidak mengganti nomor dengan benar.');
        assert(deliveryOrder?.customerDoNumber === `SJ-C-${uniqueSeed}`, 'customerDoNumber legacy tidak ikut sinkron ke SJ pertama baru.');
        assert(
            deliveryOrderItems.every(item => item.shipperReferenceNumber === `SJ-C-${uniqueSeed}` || item.shipperReferenceNumber === `SJ-D-${uniqueSeed}`),
            'Item DO tidak ikut berpindah ke SJ hasil rename.'
        );

        const itemToMove = deliveryOrderItems.find(item => item.shipperReferenceNumber === `SJ-C-${uniqueSeed}`);
        assert(itemToMove?._id, 'Tidak ada item SJ-C untuk diuji move.');

        await parseResponse(
            await handleDeliveryOrderCargoItemUpdate(
                ownerSession,
                {
                    id: doId,
                    deliveryOrderItemId: itemToMove._id,
                    cargoItem: {
                        pickupStopKey: pickupKey,
                        shipperReferenceNumber: `SJ-D-${uniqueSeed}`,
                        description: 'Barang Audit A Dipindah',
                        qtyKoli: 4,
                        weightInputValue: 120,
                        weightInputUnit: 'KG',
                        volumeInputValue: 0.4,
                        volumeInputUnit: 'M3',
                    },
                },
                noopAuditLog
            )
        );

        await parseResponse(
            await handleDeliveryOrderAppendCargoItems(
                ownerSession,
                {
                    id: doId,
                    cargoItems: [
                        {
                            pickupStopKey: pickupKey,
                            shipperReferenceNumber: `SJ-E-${uniqueSeed}`,
                            description: 'Barang Audit E',
                            qtyKoli: 1,
                            weightInputValue: 30,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.1,
                            volumeInputUnit: 'M3',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderHeaderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, shipperReferences[]{ _key, referenceNumber } }`,
            { id: doId }
        );
        deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{ _id, shipperReferenceNumber, orderItemDescription }`,
            { id: doId }
        );

        const refsAfterAppend = (deliveryOrder?.shipperReferences || []).map(reference => reference.referenceNumber).filter(Boolean);
        assert(refsAfterAppend.length === 3, 'Tambah SJ baru tidak menghasilkan 3 SJ yang terpisah.');
        assert(new Set(refsAfterAppend).size === 3, 'Tambah SJ baru menghasilkan duplikasi nomor SJ.');

        const itemToRemove = deliveryOrderItems.find(item => item.shipperReferenceNumber === `SJ-E-${uniqueSeed}`);
        assert(itemToRemove?._id, 'Tidak ada item SJ-E untuk diuji remove.');

        await parseResponse(
            await handleDeliveryOrderCargoItemRemove(
                ownerSession,
                {
                    id: doId,
                    deliveryOrderItemId: itemToRemove._id,
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderHeaderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ customerDoNumber, shipperReferences[]{ _key, referenceNumber } }`,
            { id: doId }
        );
        deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{ _id, shipperReferenceNumber, orderItemDescription }`,
            { id: doId }
        );

        const finalRefs = (deliveryOrder?.shipperReferences || []).map(reference => reference.referenceNumber).filter(Boolean);
        assert(new Set(finalRefs).size === finalRefs.length, 'Setelah remove item, header SJ DO menjadi duplikat.');
        assert(
            deliveryOrderItems.every(item => {
                const ref = item.shipperReferenceNumber?.trim();
                return !ref || finalRefs.includes(ref);
            }),
            'Setelah mutasi edit/remove, ada item DO yang menunjuk ke SJ yang tidak ada di header.'
        );
        assert(deliveryOrder?.customerDoNumber === finalRefs[0], 'customerDoNumber legacy tidak sinkron dengan SJ pertama final.');

        console.log('Audit Runtime SJ Edit Flow');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log('- Append cargo membentuk multi-SJ tanpa duplikasi');
        console.log('- Rename SJ mempertahankan jumlah ref dan memindahkan item ke nomor baru');
        console.log('- Edit barang bisa memindahkan item ke SJ lain tanpa mismatch header');
        console.log('- Tambah SJ baru tetap terpisah dan tidak menggabung salah');
        console.log('- Hapus barang tidak meninggalkan item ke SJ yang sudah tidak valid');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime SJ edit flow gagal:', error);
    process.exitCode = 1;
});
