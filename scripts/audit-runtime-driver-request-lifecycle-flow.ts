import { loadScriptEnv } from './_env';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

type DeliveryOrderSnapshot = {
    _id: string;
    doNumber?: string;
    status?: string;
    trackingState?: string;
    cargoFinalizedAt?: string;
    pendingDriverStatus?: string;
    pendingDriverStatusNote?: string;
    pendingDriverActualCargoItems?: Array<{ deliveryOrderItemRef?: string }>;
    pendingDriverActualDropPoints?: Array<{ stopType?: string }>;
    actualDropPoints?: Array<{
        stopType?: string;
        shipperReferenceNumber?: string;
        locationName?: string;
        qtyKoli?: number;
        weightKg?: number;
        note?: string;
    }>;
    customerDoNumber?: string;
    shipperReferences?: Array<{
        _key?: string;
        referenceNumber?: string;
    }>;
};

type DriverVoucherSnapshot = {
    _id: string;
    driverFeeAmount?: number;
    totalClaimAmount?: number;
    balance?: number;
};

type DeliveryOrderItemSnapshot = {
    _id: string;
    orderItemDescription?: string;
    shipperReferenceNumber?: string;
    actualQtyKoli?: number;
    actualWeightKg?: number;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-pending-lock',
    name: 'Audit Owner Pending Lock',
    email: 'audit.pending.owner@company.local',
    role: 'OWNER',
};

const driverSession: ApiSession = {
    _id: 'user-audit-driver-pending-lock',
    name: 'Audit Driver Pending Lock',
    email: 'audit.pending.driver@company.local',
    role: 'DRIVER',
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

async function expectConflict(response: Response | undefined, expectedMessagePart: string) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await response.json().catch(() => ({}));
    assert(response.status === 409, `Expected 409, got ${response.status}. Payload: ${JSON.stringify(payload)}`);
    const error = typeof payload?.error === 'string' ? payload.error : '';
    assert(
        error.includes(expectedMessagePart),
        `Expected error containing "${expectedMessagePart}", got "${error || '(kosong)'}".`
    );
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
        `*[_type == "order" && masterResi match "AUDIT-PENDING-LIFECYCLE-*"]._id`
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
    const voucherIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "driverVoucher" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const trackingLogIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "trackingLog" && refRef in $ids]._id`,
            { ids: doIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...trackingLogIds,
        ...voucherIds,
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
        handleDeliveryOrderCargoItemUpdate,
        handleDeliveryOrderStatusUpdate,
        handleDeliveryOrderDriverStatusRequest,
        handleDeliveryOrderDriverStatusRequestReject,
        handleDeliveryOrderShipperReferenceUpdate,
    } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const businessDate = getBusinessDateValue();
    const orderId = `audit-order-pending-lifecycle-${uniqueSeed.toLowerCase()}`;
    const doId = `audit-do-pending-lifecycle-${uniqueSeed.toLowerCase()}`;
    const pickupKey = `pickup-${uniqueSeed.toLowerCase()}`;
    const sjNumber = `SJ-PEND-${uniqueSeed}`;

    try {
        await client.create({
            _id: orderId,
            _type: 'order',
            masterResi: `AUDIT-PENDING-LIFECYCLE-${uniqueSeed}`,
            cargoEntryMode: 'DELIVERY_ORDER',
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            pickupAddress: 'Gudang Audit Pending Lifecycle',
            receiverAddress: 'Tujuan Audit Pending Lifecycle',
            pickupStops: [
                {
                    _key: pickupKey,
                    label: 'Pickup Audit Pending',
                    pickupAddress: 'Gudang Audit Pending Lifecycle',
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
            doNumber: `DO-AUDIT-PENDING-${uniqueSeed}`,
            masterResi: `AUDIT-PENDING-LIFECYCLE-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: businessDate,
            status: 'ARRIVED',
            orderRef: orderId,
            pickupAddress: 'Gudang Audit Pending Lifecycle',
            receiverAddress: 'Tujuan Audit Pending Lifecycle',
            vehicleRef: 'veh-002',
            vehiclePlate: 'L 9456 AB',
            serviceRef: 'svc-002',
            serviceName: 'CDD Box / Canter',
            driverRef: 'drv-002',
            driverName: 'Budi Hartono',
            baseTaripBorongan: 260000,
            taripBorongan: 260000,
            pickupStops: [
                {
                    _key: pickupKey,
                    label: 'Pickup Audit Pending',
                    pickupAddress: 'Gudang Audit Pending Lifecycle',
                },
            ],
        });
        await client.create({
            _id: `audit-voucher-pending-lifecycle-${uniqueSeed.toLowerCase()}`,
            _type: 'driverVoucher',
            bonNumber: `BON-AUDIT-PENDING-${uniqueSeed}`,
            deliveryOrderRef: doId,
            doNumber: `DO-AUDIT-PENDING-${uniqueSeed}`,
            driverRef: 'drv-002',
            driverName: 'Budi Hartono',
            vehicleRef: 'veh-002',
            vehiclePlate: 'L 9456 AB',
            issuedDate: businessDate,
            cashGiven: 95000,
            initialCashGiven: 95000,
            totalIssuedAmount: 95000,
            totalSpent: 0,
            driverFeeAmount: 260000,
            totalClaimAmount: 260000,
            balance: -165000,
            issueBankRef: 'bank-jatim-001',
            issueBankName: 'Bank Jatim',
            status: 'ISSUED',
        });

        await parseResponse(
            await handleDeliveryOrderAppendCargoItems(
                ownerSession,
                {
                    id: doId,
                    cargoItems: [
                        {
                            pickupStopKey: pickupKey,
                            shipperReferenceNumber: sjNumber,
                            description: 'Barang Audit Pending',
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.4,
                            volumeInputUnit: 'M3',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        let deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                doNumber,
                pendingDriverStatus,
                pendingDriverStatusNote,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints,
                customerDoNumber,
                shipperReferences[]{ _key, referenceNumber }
            }`,
            { id: doId }
        );
        let deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{
                _id,
                orderItemDescription,
                shipperReferenceNumber
            }`,
            { id: doId }
        );

        assert(deliveryOrder, 'DO audit pending lifecycle tidak ditemukan.');
        assert(deliveryOrderItems.length === 1, 'DO audit pending lifecycle harus mulai dengan 1 item.');
        const shipperReference = deliveryOrder.shipperReferences?.[0];
        const deliveryOrderItemId = deliveryOrderItems[0]?._id;
        assert(shipperReference?._key, 'SJ awal tidak punya _key.');
        assert(deliveryOrderItemId, 'Item DO awal tidak ditemukan.');

        await parseResponse(
            await handleDeliveryOrderDriverStatusRequest(
                driverSession,
                {
                    id: doId,
                    status: 'DELIVERED',
                    note: 'Driver audit mengajukan selesai',
                    actualItems: [
                        {
                            deliveryOrderItemRef: deliveryOrderItemId,
                            actualQtyKoli: 4,
                            actualWeightInputValue: 120,
                            actualWeightInputUnit: 'KG',
                            actualVolumeInputValue: 0.4,
                            actualVolumeInputUnit: 'M3',
                        },
                    ],
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Tujuan Audit Pending Lifecycle',
                            locationAddress: 'Tujuan Audit Pending Lifecycle',
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.4,
                            volumeInputUnit: 'M3',
                            note: 'Drop penuh untuk audit lifecycle pending',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                pendingDriverStatus,
                pendingDriverStatusNote,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints
            }`,
            { id: doId }
        );
        assert(deliveryOrder?.pendingDriverStatus === 'DELIVERED', 'Pending driver status tidak tersimpan sebagai DELIVERED.');
        assert((deliveryOrder.pendingDriverActualCargoItems || []).length === 1, 'Draft actual cargo pending tidak tersimpan.');
        assert((deliveryOrder.pendingDriverActualDropPoints || []).length === 1, 'Draft actual drop pending tidak tersimpan.');

        await expectConflict(
            await handleDeliveryOrderCargoItemUpdate(
                ownerSession,
                {
                    id: doId,
                    deliveryOrderItemId,
                    cargoItem: {
                        pickupStopKey: pickupKey,
                        shipperReferenceNumber: sjNumber,
                        description: 'Barang Audit Pending - coba edit saat pending',
                        qtyKoli: 5,
                        weightInputValue: 150,
                        weightInputUnit: 'KG',
                        volumeInputValue: 0.5,
                        volumeInputUnit: 'M3',
                    },
                },
                noopAuditLog
            ),
            'sedang menunggu approval DELIVERED'
        );

        await expectConflict(
            await handleDeliveryOrderAppendCargoItems(
                ownerSession,
                {
                    id: doId,
                    cargoItems: [
                        {
                            pickupStopKey: pickupKey,
                            shipperReferenceNumber: `SJ-PEND-EXTRA-${uniqueSeed}`,
                            description: 'Barang tambahan saat pending',
                            qtyKoli: 1,
                            weightInputValue: 30,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.1,
                            volumeInputUnit: 'M3',
                        },
                    ],
                },
                noopAuditLog
            ),
            'sedang menunggu approval DELIVERED'
        );

        await expectConflict(
            await handleDeliveryOrderShipperReferenceUpdate(
                ownerSession,
                {
                    id: doId,
                    shipperReferences: [
                        {
                            _key: shipperReference._key,
                            referenceNumber: `SJ-PEND-RENAME-${uniqueSeed}`,
                            pickupStopKey: pickupKey,
                        },
                    ],
                },
                noopAuditLog
            ),
            'sedang menunggu approval DELIVERED'
        );

        await parseResponse(
            await handleDeliveryOrderDriverStatusRequestReject(
                ownerSession,
                {
                    id: doId,
                    note: 'Audit admin reject untuk buka lock edit lagi',
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                pendingDriverStatus,
                pendingDriverStatusNote,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints,
                customerDoNumber,
                shipperReferences[]{ _key, referenceNumber }
            }`,
            { id: doId }
        );
        assert(!deliveryOrder?.pendingDriverStatus, 'Reject admin tidak menghapus pendingDriverStatus.');
        assert(!deliveryOrder?.pendingDriverActualCargoItems?.length, 'Reject admin tidak membersihkan draft actual cargo.');
        assert(!deliveryOrder?.pendingDriverActualDropPoints?.length, 'Reject admin tidak membersihkan draft actual drop.');

        await parseResponse(
            await handleDeliveryOrderCargoItemUpdate(
                ownerSession,
                {
                    id: doId,
                    deliveryOrderItemId,
                    cargoItem: {
                        pickupStopKey: pickupKey,
                        shipperReferenceNumber: sjNumber,
                        description: 'Barang Audit Pending - edit setelah reject',
                        qtyKoli: 5,
                        weightInputValue: 150,
                        weightInputUnit: 'KG',
                        volumeInputValue: 0.5,
                        volumeInputUnit: 'M3',
                    },
                },
                noopAuditLog
            )
        );

        const renamedSjNumber = `SJ-PEND-RENAME-${uniqueSeed}`;
        await parseResponse(
            await handleDeliveryOrderShipperReferenceUpdate(
                ownerSession,
                {
                    id: doId,
                    shipperReferences: [
                        {
                            _key: shipperReference._key,
                            referenceNumber: renamedSjNumber,
                            pickupStopKey: pickupKey,
                        },
                    ],
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
                            shipperReferenceNumber: `SJ-PEND-EXTRA-${uniqueSeed}`,
                            description: 'Barang tambahan setelah reject',
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

        deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                customerDoNumber,
                shipperReferences[]{ _key, referenceNumber }
            }`,
            { id: doId }
        );
        deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{
                _id,
                orderItemDescription,
                shipperReferenceNumber
            }`,
            { id: doId }
        );

        const shipperRefNumbers = (deliveryOrder?.shipperReferences || []).map(ref => ref.referenceNumber).filter(Boolean);
        assert(shipperRefNumbers.includes(renamedSjNumber), 'Rename SJ setelah reject tidak tersimpan.');
        assert(shipperRefNumbers.includes(`SJ-PEND-EXTRA-${uniqueSeed}`), 'Append cargo setelah reject tidak menambah SJ baru.');
        assert(deliveryOrder?.customerDoNumber === renamedSjNumber, 'customerDoNumber legacy tidak ikut sinkron setelah rename pasca reject.');
        assert(deliveryOrderItems.length === 2, 'Append cargo setelah reject tidak menambah item kedua.');
        assert(
            deliveryOrderItems.some(item => item.orderItemDescription === 'Barang Audit Pending - edit setelah reject'),
            'Edit cargo setelah reject tidak tersimpan.'
        );

        const updatedItem = deliveryOrderItems.find(item => item.orderItemDescription === 'Barang Audit Pending - edit setelah reject');
        assert(updatedItem?._id, 'Item hasil edit setelah reject tidak ditemukan.');

        await parseResponse(
            await handleDeliveryOrderDriverStatusRequest(
                driverSession,
                {
                    id: doId,
                    status: 'DELIVERED',
                    note: 'Driver audit resubmit setelah reject',
                    actualItems: deliveryOrderItems.map(item => ({
                        deliveryOrderItemRef: item._id,
                        actualQtyKoli: item.orderItemDescription === 'Barang tambahan setelah reject' ? 1 : 5,
                        actualWeightInputValue: item.orderItemDescription === 'Barang tambahan setelah reject' ? 30 : 150,
                        actualWeightInputUnit: 'KG',
                        actualVolumeInputValue: item.orderItemDescription === 'Barang tambahan setelah reject' ? 0.1 : 0.5,
                        actualVolumeInputUnit: 'M3',
                    })),
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Tujuan Audit Pending Lifecycle',
                            locationAddress: 'Tujuan Audit Pending Lifecycle',
                            qtyKoli: 6,
                            weightInputValue: 180,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0.6,
                            volumeInputUnit: 'M3',
                            note: 'Resubmit setelah reject dan edit ulang',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                pendingDriverStatus,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints
            }`,
            { id: doId }
        );
        assert(deliveryOrder?.pendingDriverStatus === 'DELIVERED', 'Driver tidak bisa resubmit setelah reject.');
        assert((deliveryOrder.pendingDriverActualCargoItems || []).length === 2, 'Resubmit setelah reject tidak membawa seluruh actual item terbaru.');
        assert((deliveryOrder.pendingDriverActualDropPoints || []).length === 1, 'Resubmit setelah reject tidak menyimpan actual drop terbaru.');

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: doId,
                    status: 'DELIVERED',
                    note: 'Audit admin approve draft driver tanpa kirim ulang cargo/drop',
                    podReceiverName: 'Penerima Audit Pending Lifecycle',
                    podReceivedDate: businessDate,
                    podNote: 'Approval memakai pending draft driver',
                },
                noopAuditLog
            )
        );

        deliveryOrder = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                status,
                trackingState,
                cargoFinalizedAt,
                pendingDriverStatus,
                pendingDriverActualCargoItems,
                pendingDriverActualDropPoints,
                actualDropPoints[]{
                    stopType,
                    shipperReferenceNumber,
                    locationName,
                    qtyKoli,
                    weightKg,
                    note
                }
            }`,
            { id: doId }
        );
        deliveryOrderItems = await client.fetch<DeliveryOrderItemSnapshot[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{
                _id,
                orderItemDescription,
                actualQtyKoli,
                actualWeightKg
            }`,
            { id: doId }
        );

        assert(deliveryOrder?.status === 'DELIVERED', 'Approval admin tidak memfinalkan DO menjadi DELIVERED.');
        assert(deliveryOrder?.trackingState === 'STOPPED', 'Approval admin tidak menghentikan tracking DO.');
        assert(Boolean(deliveryOrder?.cargoFinalizedAt), 'Approval admin tidak mengisi cargoFinalizedAt.');
        assert(!deliveryOrder?.pendingDriverStatus, 'Approval admin tidak membersihkan pendingDriverStatus.');
        assert(!deliveryOrder?.pendingDriverActualCargoItems?.length, 'Approval admin tidak membersihkan pending actual cargo.');
        assert(!deliveryOrder?.pendingDriverActualDropPoints?.length, 'Approval admin tidak membersihkan pending actual drop.');
        assert((deliveryOrder?.actualDropPoints || []).length === 1, 'Approval admin tidak memakai pending actual drop driver.');
        assert(
            deliveryOrder?.actualDropPoints?.[0]?.locationName === 'Tujuan Audit Pending Lifecycle',
            'Approval admin tidak mempertahankan lokasi drop dari draft driver.'
        );
        assert(
            !deliveryOrder?.actualDropPoints?.[0]?.shipperReferenceNumber,
            'Drop gabungan multi-SJ tidak boleh dipaksa ke salah satu nomor SJ.'
        );
        assert(
            deliveryOrder?.actualDropPoints?.[0]?.note === 'Resubmit setelah reject dan edit ulang',
            'Approval admin tidak mempertahankan catatan drop dari draft driver.'
        );
        const finalizedWeight = deliveryOrderItems.reduce((sum, item) => sum + (item.actualWeightKg || 0), 0);
        const finalizedQty = deliveryOrderItems.reduce((sum, item) => sum + (item.actualQtyKoli || 0), 0);
        assert(finalizedQty === 6, 'Approval admin tidak memfinalkan total qty aktual dari draft driver.');
        assert(finalizedWeight === 180, 'Approval admin tidak memfinalkan total berat aktual dari draft driver.');

        const linkedVoucher = await client.fetch<DriverVoucherSnapshot | null>(
            `*[_type == "driverVoucher" && deliveryOrderRef == $id][0]{
                _id,
                driverFeeAmount,
                totalClaimAmount,
                balance
            }`,
            { id: doId }
        );
        assert(linkedVoucher, 'Bon audit pending lifecycle tidak ditemukan.');
        assert(linkedVoucher.driverFeeAmount === 278000, 'Approval overtonase tidak mengubah upah trip bon menjadi Rp278.000.');
        assert(linkedVoucher.totalClaimAmount === 278000, 'Approval overtonase tidak mengubah total klaim bon menjadi Rp278.000.');
        assert(linkedVoucher.balance === -183000, 'Approval overtonase tidak menghitung ulang balance bon menjadi -Rp183.000.');

        console.log('Audit runtime driver pending approval lifecycle: OK');
    } finally {
        await cleanupAuditArtifacts();
    }
}

main().catch(error => {
    console.error('Audit runtime driver pending approval lifecycle failed.');
    console.error(error);
    process.exitCode = 1;
});
