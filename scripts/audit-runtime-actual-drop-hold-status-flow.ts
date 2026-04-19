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
    _id: 'user-audit-owner-actual-drop-hold',
    name: 'Audit Owner Actual Drop Hold',
    email: 'audit.actual.drop.hold@company.local',
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
        `*[_type == "order" && masterResi match "AUDIT-ACTUAL-DROP-HOLD-*"]._id`
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
        `*[_type == "vehicle" && unitCode match "AUDIT-ACTUAL-DROP-HOLD-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-ACTUAL-DROP-HOLD-*"]._id`
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
    await client
        .patch(snapshot._id)
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
        handleDeliveryOrderCreate,
        handleDeliveryOrderStatusUpdate,
    } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const businessDate = getBusinessDateValue();
    const vehicleId = `audit-veh-actual-drop-hold-${uniqueSeed.toLowerCase()}`;
    const driverId = `audit-drv-actual-drop-hold-${uniqueSeed.toLowerCase()}`;
    const holdLocation = `Gudang Hold Aktual ${uniqueSeed}`;

    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    try {
        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-ACTUAL-DROP-HOLD-${uniqueSeed}`,
            plateNumber: `L 4${uniqueSeed.slice(-4)} E`,
            vehicleType: 'CDD',
            brandModel: 'Audit Actual Drop Hold Vehicle',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            active: true,
            status: 'ACTIVE',
        });
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Actual Drop Hold Driver ${uniqueSeed}`,
            phone: '081200050001',
            licenseNumber: `AUDIT-ACTUAL-DROP-HOLD-${uniqueSeed}`,
            active: true,
        });

        const createOrderResponse = await handleOrderCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-002',
                masterResi: `AUDIT-ACTUAL-DROP-HOLD-${uniqueSeed}`,
                receiverAddress: `Tujuan Audit Actual Drop Hold ${uniqueSeed}`,
                pickupAddress: `Pickup Audit Actual Drop Hold ${uniqueSeed}`,
                notes: 'Order audit actual drop hold status runtime',
                items: [
                    {
                        description: `Barang Actual Drop Hold ${uniqueSeed}`,
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
        assert(typeof orderId === 'string' && orderId.length > 0, 'Order audit actual drop hold gagal dibuat.');

        const orderItem = await client.fetch<{ _id: string } | null>(
            `*[_type == "orderItem" && orderRef == $id][0]{ _id }`,
            { id: orderId }
        );
        assert(orderItem?._id, 'Order item audit actual drop hold tidak ditemukan.');

        const createDoResponse = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                vehicleRef: vehicleId,
                driverRef: driverId,
                issueBankRef: 'bank-jatim-001',
                cashGiven: 90000,
                taripBorongan: 255000,
                date: businessDate,
                notes: 'DO audit actual drop hold',
                items: [
                    {
                        orderItemRef: orderItem._id,
                        qtyKoli: 10,
                        holdRemaining: false,
                    },
                ],
            },
            noopAuditLog
        );
        const createDoJson = await parseResponse(createDoResponse);
        const doId = createDoJson?.id;
        assert(typeof doId === 'string' && doId.length > 0, 'DO audit actual drop hold gagal dibuat.');

        const doItem = await client.fetch<{ _id: string } | null>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id][0]{ _id }`,
            { id: doId }
        );
        assert(doItem?._id, 'DO item audit actual drop hold tidak ditemukan.');

        await advanceDeliveryOrderToArrived(handleDeliveryOrderStatusUpdate, doId);

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: doId,
                    status: 'DELIVERED',
                    podReceiverName: 'Penerima Audit Actual Drop Hold',
                    podReceivedDate: businessDate,
                    podNote: 'POD audit actual drop hold',
                    actualItems: [
                        {
                            deliveryOrderItemRef: doItem._id,
                            actualQtyKoli: 10,
                            actualWeightInputValue: 300,
                            actualWeightInputUnit: 'KG',
                            actualVolumeInputValue: 0,
                            actualVolumeInputUnit: 'M3',
                        },
                    ],
                    actualDropPoints: [
                        {
                            stopType: 'DROP',
                            locationName: 'Tujuan Audit Actual Drop Hold',
                            locationAddress: `Tujuan Audit Actual Drop Hold ${uniqueSeed}`,
                            qtyKoli: 6,
                            weightInputValue: 180,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0,
                            volumeInputUnit: 'M3',
                            note: 'Drop customer sebagian',
                        },
                        {
                            stopType: 'HOLD',
                            locationName: holdLocation,
                            locationAddress: holdLocation,
                            qtyKoli: 4,
                            weightInputValue: 120,
                            weightInputUnit: 'KG',
                            volumeInputValue: 0,
                            volumeInputUnit: 'M3',
                            note: 'Sisa disimpan di gudang hold aktual',
                        },
                    ],
                },
                noopAuditLog
            )
        );

        const updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
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
        const order = await client.fetch<OrderRuntimeSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, status }`,
            { id: orderId }
        );
        const deliveryOrder = await client.fetch<{ _id: string; status?: string; actualDropPoints?: unknown[] } | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, status, actualDropPoints }`,
            { id: doId }
        );

        assert(deliveryOrder?.status === 'DELIVERED', 'DO trip final tetap harus DELIVERED setelah driver selesai.');
        assert((deliveryOrder.actualDropPoints || []).length === 2, 'Actual drop HOLD/DROP harus tersimpan dua titik.');
        assert(updatedOrderItem, 'Order item tidak ditemukan sesudah actual drop hold.');
        assert(updatedOrderItem.deliveredQtyKoli === 6, 'Delivered qty harus hanya bagian DROP customer.');
        assert(updatedOrderItem.deliveredWeight === 180, 'Delivered weight harus hanya bagian DROP customer.');
        assert(updatedOrderItem.heldQtyKoli === 4, 'Held qty harus berasal dari titik HOLD aktual.');
        assert(updatedOrderItem.heldWeight === 120, 'Held weight harus berasal dari titik HOLD aktual.');
        assert((updatedOrderItem.assignedQtyKoli || 0) === 0, 'Assigned qty harus nol setelah trip selesai.');
        assert(updatedOrderItem.status === 'PARTIAL', 'Status item harus PARTIAL, bukan DELIVERED, karena ada HOLD aktual.');
        assert(updatedOrderItem.holdLocation === holdLocation, 'Lokasi hold aktual harus tersimpan ke item order.');
        assert(order?.status === 'PARTIAL', 'Status order harus PARTIAL ketika sebagian barang masih hold aktual.');

        console.log('Audit runtime actual drop hold status flow: OK');
        console.log(`- DO audit: ${doId}`);
        console.log('- DROP customer dihitung delivered, HOLD aktual dihitung held');
        console.log('- Status item/order tetap PARTIAL, tidak salah menjadi terkirim semua');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime actual drop hold status flow failed.');
    console.error(error);
    process.exitCode = 1;
});
