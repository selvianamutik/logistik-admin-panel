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
    _id: 'user-audit-owner-order-item-cancel',
    name: 'Audit Owner Order Item Cancel',
    email: 'audit.order.item.cancel@company.local',
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
        `*[_type == "order" && masterResi match "AUDIT-ITEM-HOLD-CANCEL-*"]._id`
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
        `*[_type == "vehicle" && unitCode match "AUDIT-ITEM-HOLD-CANCEL-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-ITEM-HOLD-CANCEL-*"]._id`
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
    const vehicleId = `audit-veh-item-hold-cancel-${uniqueSeed.toLowerCase()}`;
    const driverId = `audit-drv-item-hold-cancel-${uniqueSeed.toLowerCase()}`;

    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    try {
        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-ITEM-HOLD-CANCEL-${uniqueSeed}`,
            plateNumber: `L 4${uniqueSeed.slice(-4)} D`,
            vehicleType: 'CDD',
            brandModel: 'Audit Item Hold Cancel Vehicle',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Item Hold Cancel Driver ${uniqueSeed}`,
            phone: '081200030001',
            licenseNumber: `AUDIT-ITEM-HOLD-CANCEL-${uniqueSeed}`,
            active: true,
        });

        const createOrderResponse = await handleOrderCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-002',
                receiverAddress: `Tujuan Audit Item Hold Cancel ${uniqueSeed}`,
                pickupAddress: `Pickup Audit Item Hold Cancel ${uniqueSeed}`,
                notes: 'Order audit partial hold cancel runtime',
                items: [
                    {
                        description: `Barang Audit Hold Cancel ${uniqueSeed}`,
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
        assert(typeof orderId === 'string' && orderId.length > 0, 'Order audit partial hold cancel gagal dibuat.');

        const orderItem = await client.fetch<{ _id: string } | null>(
            `*[_type == "orderItem" && orderRef == $id][0]{ _id }`,
            { id: orderId }
        );
        assert(orderItem?._id, 'Order item audit partial hold cancel tidak ditemukan.');

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
                notes: 'DO audit partial hold cancel',
                items: [
                    {
                        orderItemRef: orderItem._id,
                        qtyKoli: 4,
                        holdRemaining: true,
                        holdReason: 'Lokasi bongkar belum siap',
                        holdLocation: 'Gudang transit audit',
                    },
                ],
            },
            noopAuditLog
        );
        const createDoJson = await parseResponse(createDoResponse);
        const doId = createDoJson?.id;
        assert(typeof doId === 'string' && doId.length > 0, 'DO audit partial hold cancel gagal dibuat.');

        let updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
            `*[_type == "orderItem" && _id == $id][0]{
                _id,
                status,
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

        assert(updatedOrderItem, 'Order item runtime snapshot tidak ditemukan setelah create DO.');
        assert(updatedOrderItem.assignedQtyKoli === 4, 'Assigned qty item order harus 4 setelah create DO parsial.');
        assert(updatedOrderItem.heldQtyKoli === 6, 'Held qty item order harus 6 setelah hold remaining.');
        assert(updatedOrderItem.holdReason === 'Lokasi bongkar belum siap', 'Hold reason item order tidak tersimpan.');
        assert(updatedOrderItem.holdLocation === 'Gudang transit audit', 'Hold location item order tidak tersimpan.');
        assert(order?.status === 'PARTIAL', 'Order status harus PARTIAL setelah create DO parsial + hold.');

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: doId,
                    status: 'CANCELLED',
                    note: 'Audit cancel DO partial hold',
                },
                noopAuditLog
            )
        );

        updatedOrderItem = await client.fetch<OrderItemRuntimeSnapshot | null>(
            `*[_type == "orderItem" && _id == $id][0]{
                _id,
                status,
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

        assert(updatedOrderItem, 'Order item runtime snapshot hilang setelah cancel DO.');
        assert((updatedOrderItem.assignedQtyKoli || 0) === 0, 'Assigned qty item order harus rollback ke 0 setelah cancel DO.');
        assert((updatedOrderItem.assignedWeight || 0) === 0, 'Assigned weight item order harus rollback ke 0 setelah cancel DO.');
        assert((updatedOrderItem.heldQtyKoli || 0) === 0, 'Held qty item order harus rollback ke 0 setelah cancel DO.');
        assert((updatedOrderItem.heldWeight || 0) === 0, 'Held weight item order harus rollback ke 0 setelah cancel DO.');
        assert(updatedOrderItem.status === 'PENDING', 'Status item order harus kembali PENDING setelah cancel DO.');
        assert(order?.status === 'OPEN', 'Status order harus kembali OPEN setelah cancel DO parsial + hold.');

        console.log('Audit runtime order item partial hold cancel flow: OK');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime order item partial hold cancel flow failed.');
    console.error(error);
    process.exitCode = 1;
});
