import { loadScriptEnv } from './_env';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

type BankAccountSnapshot = {
    _id: string;
    currentBalance?: number;
};

type OrderItemRuntimeSnapshot = {
    _id: string;
    status?: string;
    deliveredQtyKoli?: number;
    deliveredWeight?: number;
    assignedQtyKoli?: number;
    assignedWeight?: number;
    heldQtyKoli?: number;
    heldWeight?: number;
    holdReason?: string;
    holdLocation?: string;
};

type OrderRuntimeSnapshot = {
    _id: string;
    status?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-hold-release-complete',
    name: 'Audit Owner Hold Release Complete',
    email: 'audit.hold.release.complete@company.local',
    role: 'OWNER',
};

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseJsonSafe(response: Response) {
    return response.json().catch(() => ({}));
}

async function parseResponse(response: Response | undefined) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return;
    const transaction = client.transaction();
    ids.forEach(id => transaction.delete(id));
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-HOLD-RELEASE-COMPLETE-*"]._id`
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
    const disbursementIds = voucherIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "driverVoucherDisbursement" && voucherRef in $ids]._id`,
            { ids: voucherIds }
        )
        : [];
    const bankTransactionIds = voucherIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "bankTransaction" && relatedVoucherRef in $ids]._id`,
            { ids: voucherIds }
        )
        : [];
    const trackingLogIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "trackingLog" && refRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-HOLD-RELEASE-COMPLETE-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-HOLD-RELEASE-COMPLETE-*"]._id`
    );

    await deleteDocumentsByIds([
        ...disbursementIds,
        ...bankTransactionIds,
        ...trackingLogIds,
        ...voucherIds,
        ...doItemIds,
        ...doIds,
        ...orderItemIds,
        ...orderIds,
        ...vehicleIds,
        ...driverIds,
    ]);
}

async function restoreBankBalance(snapshot: BankAccountSnapshot | null) {
    if (!snapshot?._id) return;
    const current = await client.fetch<{ _id: string; _rev?: string } | null>(
        `*[_type == "bankAccount" && _id == $id][0]{ _id, _rev }`,
        { id: snapshot._id }
    );
    if (!current?._id || !current._rev) return;
    await client
        .patch(current._id)
        .ifRevisionId(current._rev)
        .set({ currentBalance: snapshot.currentBalance || 0 })
        .commit();
}

async function advanceDeliveryOrderToArrived(
    handleDeliveryOrderStatusUpdate: (
        session: ApiSession,
        data: Record<string, unknown>,
        addAuditLog: typeof noopAuditLog
    ) => Promise<Response | undefined>,
    id: string
) {
    for (const status of ['HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED']) {
        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id,
                    status,
                    note: `Audit advance ${status}`,
                },
                noopAuditLog
            )
        );
    }
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const {
        handleOrderCreate,
        handleOrderItemHoldRelease,
        handleDeliveryOrderCreate,
        handleDeliveryOrderStatusUpdate,
    } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const businessDate = getBusinessDateValue();
    const vehicleId = `audit-veh-hold-release-complete-${uniqueSeed.toLowerCase()}`;
    const driverId = `audit-drv-hold-release-complete-${uniqueSeed.toLowerCase()}`;

    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    try {
        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-HOLD-RELEASE-COMPLETE-${uniqueSeed}`,
            plateNumber: `L 3${uniqueSeed.slice(-4)} E`,
            vehicleType: 'CDD',
            brandModel: 'Audit Hold Release Complete Vehicle',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Hold Release Complete Driver ${uniqueSeed}`,
            phone: '081200040001',
            licenseNumber: `AUDIT-HOLD-RELEASE-COMPLETE-${uniqueSeed}`,
            active: true,
        });

        const createOrderResponse = await handleOrderCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-002',
                receiverAddress: `Tujuan Audit Hold Release Complete ${uniqueSeed}`,
                pickupAddress: `Pickup Audit Hold Release Complete ${uniqueSeed}`,
                notes: 'Order audit hold release complete runtime',
                items: [
                    {
                        description: `Barang Audit Hold Release ${uniqueSeed}`,
                        qtyKoli: 10,
                        weightInputValue: 300,
                        weightInputUnit: 'KG',
                    },
                ],
            },
            noopAuditLog
        );
        const createOrderJson = await parseResponse(createOrderResponse);
        const orderId = createOrderJson?.id;
        assert(typeof orderId === 'string' && orderId.length > 0, 'Order audit hold release complete gagal dibuat.');

        const orderItem = await client.fetch<{ _id: string } | null>(
            `*[_type == "orderItem" && orderRef == $id][0]{ _id }`,
            { id: orderId }
        );
        assert(orderItem?._id, 'Order item audit hold release complete tidak ditemukan.');

        const createDo1Response = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                vehicleRef: vehicleId,
                driverRef: driverId,
                issueBankRef: 'bank-jatim-001',
                cashGiven: 90000,
                taripBorongan: 255000,
                date: businessDate,
                notes: 'DO audit hold release complete pertama',
                items: [
                    {
                        orderItemRef: orderItem._id,
                        qtyKoli: 4,
                        holdRemaining: true,
                        holdReason: 'Tunggu jadwal drop berikutnya',
                        holdLocation: 'Gudang transit audit',
                    },
                ],
            },
            noopAuditLog
        );
        const createDo1Json = await parseResponse(createDo1Response);
        const do1Id = createDo1Json?.id;
        assert(typeof do1Id === 'string' && do1Id.length > 0, 'DO pertama audit hold release complete gagal dibuat.');

        const do1Item = await client.fetch<{ _id: string } | null>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id][0]{ _id }`,
            { id: do1Id }
        );
        assert(do1Item?._id, 'DO item pertama audit hold release complete tidak ditemukan.');

        await advanceDeliveryOrderToArrived(handleDeliveryOrderStatusUpdate, do1Id);

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: do1Id,
                    status: 'DELIVERED',
                    podReceiverName: 'Penerima Audit Hold Release 1',
                    podReceivedDate: businessDate,
                    podNote: 'POD audit hold release pertama',
                    actualItems: [
                        {
                            deliveryOrderItemRef: do1Item._id,
                            actualQtyKoli: 4,
                            actualWeightInputValue: 120,
                            actualWeightInputUnit: 'KG',
                            actualVolumeInputValue: 0,
                            actualVolumeInputUnit: 'M3',
                        },
                    ],
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Tujuan Audit Hold Release 1',
                            locationAddress: `Tujuan Audit Hold Release Complete ${uniqueSeed}`,
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0,
                            volumeInputUnit: 'M3',
                            note: 'Drop pertama 4 koli',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        let updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
            `*[_type == "orderItem" && _id == $id][0]{
                _id,
                status,
                deliveredQtyKoli,
                deliveredWeight,
                assignedQtyKoli,
                assignedWeight,
                heldQtyKoli,
                heldWeight,
                holdReason,
                holdLocation
            }`,
            { id: orderItem._id }
        );
        let order = await client.fetch<OrderRuntimeSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, status }`,
            { id: orderId }
        );

        assert(updatedOrderItem, 'Order item tidak ditemukan sesudah DO pertama delivered.');
        assert(updatedOrderItem.deliveredQtyKoli === 4, 'Delivered qty setelah DO pertama harus 4.');
        assert(updatedOrderItem.heldQtyKoli === 6, 'Held qty setelah DO pertama harus 6.');
        assert(updatedOrderItem.status === 'PARTIAL', 'Status item setelah DO pertama delivered harus PARTIAL.');
        assert(order?.status === 'PARTIAL', 'Status order setelah DO pertama delivered harus PARTIAL.');

        await parseResponse(
            await handleOrderItemHoldRelease(
                ownerSession,
                { id: orderItem._id },
                noopAuditLog
            )
        );

        updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
            `*[_type == "orderItem" && _id == $id][0]{
                _id,
                status,
                deliveredQtyKoli,
                deliveredWeight,
                assignedQtyKoli,
                assignedWeight,
                heldQtyKoli,
                heldWeight,
                holdReason,
                holdLocation
            }`,
            { id: orderItem._id }
        );
        order = await client.fetch<OrderRuntimeSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, status }`,
            { id: orderId }
        );

        assert(updatedOrderItem, 'Order item tidak ditemukan sesudah hold release.');
        assert((updatedOrderItem.heldQtyKoli || 0) === 0, 'Held qty harus nol setelah release hold.');
        assert(!updatedOrderItem.holdReason, 'Hold reason harus kosong setelah release hold.');
        assert(!updatedOrderItem.holdLocation, 'Hold location harus kosong setelah release hold.');
        assert(updatedOrderItem.status === 'PARTIAL', 'Status item setelah release hold tetap harus PARTIAL karena masih ada delivered parsial.');
        assert(order?.status === 'PARTIAL', 'Status order setelah release hold tetap harus PARTIAL.');

        const createDo2Response = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                vehicleRef: vehicleId,
                driverRef: driverId,
                issueBankRef: 'bank-jatim-001',
                cashGiven: 95000,
                taripBorongan: 260000,
                date: businessDate,
                notes: 'DO audit hold release complete kedua',
                items: [
                    {
                        orderItemRef: orderItem._id,
                        qtyKoli: 6,
                        holdRemaining: false,
                    },
                ],
            },
            noopAuditLog
        );
        const createDo2Json = await parseResponse(createDo2Response);
        const do2Id = createDo2Json?.id;
        assert(typeof do2Id === 'string' && do2Id.length > 0, 'DO kedua audit hold release complete gagal dibuat.');

        const do2Item = await client.fetch<{ _id: string } | null>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id][0]{ _id }`,
            { id: do2Id }
        );
        assert(do2Item?._id, 'DO item kedua audit hold release complete tidak ditemukan.');

        await advanceDeliveryOrderToArrived(handleDeliveryOrderStatusUpdate, do2Id);

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: do2Id,
                    status: 'DELIVERED',
                    podReceiverName: 'Penerima Audit Hold Release 2',
                    podReceivedDate: businessDate,
                    podNote: 'POD audit hold release kedua',
                    actualItems: [
                        {
                            deliveryOrderItemRef: do2Item._id,
                            actualQtyKoli: 6,
                            actualWeightInputValue: 180,
                            actualWeightInputUnit: 'KG',
                            actualVolumeInputValue: 0,
                            actualVolumeInputUnit: 'M3',
                        },
                    ],
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Tujuan Audit Hold Release 2',
                            locationAddress: `Tujuan Audit Hold Release Complete ${uniqueSeed}`,
                            qtyKoli: 6,
                            weightInputValue: 180,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0,
                            volumeInputUnit: 'M3',
                            note: 'Drop kedua 6 koli',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
            `*[_type == "orderItem" && _id == $id][0]{
                _id,
                status,
                deliveredQtyKoli,
                deliveredWeight,
                assignedQtyKoli,
                assignedWeight,
                heldQtyKoli,
                heldWeight
            }`,
            { id: orderItem._id }
        );
        order = await client.fetch<OrderRuntimeSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, status }`,
            { id: orderId }
        );

        assert(updatedOrderItem, 'Order item tidak ditemukan sesudah DO kedua delivered.');
        assert(updatedOrderItem.deliveredQtyKoli === 10, 'Delivered qty akhir harus 10 setelah DO kedua delivered.');
        assert(updatedOrderItem.deliveredWeight === 300, 'Delivered weight akhir harus 300 kg setelah DO kedua delivered.');
        assert((updatedOrderItem.assignedQtyKoli || 0) === 0, 'Assigned qty akhir harus 0.');
        assert((updatedOrderItem.heldQtyKoli || 0) === 0, 'Held qty akhir harus 0.');
        assert(updatedOrderItem.status === 'DELIVERED', 'Status item akhir harus DELIVERED.');
        assert(order?.status === 'COMPLETE', 'Status order akhir harus COMPLETE.');

        console.log('Audit runtime order item hold release complete flow: OK');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime order item hold release complete flow failed.');
    console.error(error);
    process.exitCode = 1;
});
