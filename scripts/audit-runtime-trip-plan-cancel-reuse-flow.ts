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

type OrderSnapshot = {
    _id: string;
    tripPlans?: Array<{
        _key?: string;
        linkedDeliveryOrderRef?: string;
        linkedDeliveryOrderNumber?: string;
    }>;
};

type DeliveryOrderSnapshot = {
    _id: string;
    doNumber?: string;
    status?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-trip-reuse',
    name: 'Audit Owner Trip Reuse',
    email: 'audit.trip.reuse@company.local',
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

async function expectConflict(response: Response | undefined, containsText: string) {
    assert(response instanceof Response, 'Handler tidak mengembalikan response.');
    const payload = await parseJsonSafe(response);
    if (response.status !== 409) {
        throw new Error(
            `Expected HTTP 409, got ${response.status}: ${typeof payload?.error === 'string' ? payload.error : 'Tanpa pesan error'}`
        );
    }
    if (typeof payload?.error !== 'string' || !payload.error.includes(containsText)) {
        throw new Error(`Expected error to contain "${containsText}", got "${payload?.error || '(kosong)'}"`);
    }
}

async function deleteDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return;
    const transaction = client.transaction();
    ids.forEach(id => transaction.delete(id));
    await transaction.commit();
}

async function cleanupAuditArtifacts() {
    const orderIds = await client.fetch<string[]>(
        `*[_type == "order" && masterResi match "AUDIT-TRIP-REUSE-*"]._id`
    );
    const doIds = orderIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrder" && orderRef in $ids]._id`,
            { ids: orderIds }
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
        `*[_type == "vehicle" && unitCode match "AUDIT-TRIP-REUSE-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-TRIP-REUSE-*"]._id`
    );

    await deleteDocumentsByIds([
        ...disbursementIds,
        ...bankTransactionIds,
        ...trackingLogIds,
        ...voucherIds,
        ...doIds,
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
    const vehicleId = `audit-veh-trip-reuse-${uniqueSeed.toLowerCase()}`;
    const driverId = `audit-drv-trip-reuse-${uniqueSeed.toLowerCase()}`;

    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    try {
        await client.create({
            _id: vehicleId,
            _type: 'vehicle',
            unitCode: `AUDIT-TRIP-REUSE-${uniqueSeed}`,
            plateNumber: `L 5${uniqueSeed.slice(-4)} C`,
            vehicleType: 'CDD',
            brandModel: 'Audit Trip Reuse Vehicle',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: driverId,
            _type: 'driver',
            name: `Audit Trip Reuse Driver ${uniqueSeed}`,
            phone: '081200020001',
            licenseNumber: `AUDIT-TRIP-REUSE-${uniqueSeed}`,
            active: true,
        });

        const createOrderResponse = await handleOrderCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-002',
                receiverAddress: `Tujuan Audit Trip Reuse ${uniqueSeed}`,
                pickupAddress: `Pickup Audit Trip Reuse ${uniqueSeed}`,
                notes: 'Order audit trip plan reuse runtime',
                items: [],
                tripDrafts: [
                    {
                        vehicleRef: vehicleId,
                        driverRef: driverId,
                        issueBankRef: 'bank-jatim-001',
                        cashGiven: 95000,
                        taripBorongan: 260000,
                        date: businessDate,
                        notes: 'Trip plan reuse audit',
                    },
                ],
            },
            noopAuditLog
        );
        const createOrderJson = await parseResponse(createOrderResponse);
        const orderId = createOrderJson?.id;
        assert(typeof orderId === 'string' && orderId.length > 0, 'Order trip reuse audit gagal dibuat.');

        let order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, tripPlans[]{ _key, linkedDeliveryOrderRef, linkedDeliveryOrderNumber } }`,
            { id: orderId }
        );
        const tripPlan = order?.tripPlans?.[0];
        assert(tripPlan?._key, 'Trip plan reuse audit tidak ditemukan.');

        const createDoAResponse = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                orderTripPlanKey: tripPlan._key,
                notes: 'DO reuse audit pertama',
            },
            noopAuditLog
        );
        const createDoAJson = await parseResponse(createDoAResponse);
        const doAId = createDoAJson?.id;
        assert(typeof doAId === 'string' && doAId.length > 0, 'DO pertama reuse audit gagal dibuat.');

        let doA = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, doNumber, status }`,
            { id: doAId }
        );
        assert(doA?.status === 'CREATED', 'DO pertama reuse audit harus berstatus CREATED.');

        order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, tripPlans[]{ _key, linkedDeliveryOrderRef, linkedDeliveryOrderNumber } }`,
            { id: orderId }
        );
        const linkedTripAfterFirstDo = order?.tripPlans?.find(plan => plan._key === tripPlan._key);
        assert(linkedTripAfterFirstDo?.linkedDeliveryOrderRef === doAId, 'Trip plan tidak ter-link ke DO pertama.');

        await expectConflict(
            await handleDeliveryOrderCreate(
                ownerSession,
                {
                    orderRef: orderId,
                    orderTripPlanKey: tripPlan._key,
                    notes: 'DO reuse audit duplicate sebelum cancel',
                },
                noopAuditLog
            ),
            'Rencana trip ini sudah dipakai'
        );

        await parseResponse(
            await handleDeliveryOrderStatusUpdate(
                ownerSession,
                {
                    id: doAId,
                    status: 'CANCELLED',
                    note: 'Audit cancel agar trip plan bisa dipakai ulang',
                },
                noopAuditLog
            )
        );

        doA = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, doNumber, status }`,
            { id: doAId }
        );
        assert(doA?.status === 'CANCELLED', 'DO pertama reuse audit tidak berubah ke CANCELLED.');

        const createDoBResponse = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                orderTripPlanKey: tripPlan._key,
                notes: 'DO reuse audit kedua setelah cancel',
            },
            noopAuditLog
        );
        const createDoBJson = await parseResponse(createDoBResponse);
        const doBId = createDoBJson?.id;
        assert(typeof doBId === 'string' && doBId.length > 0, 'DO kedua reuse audit gagal dibuat setelah cancel.');
        assert(doBId !== doAId, 'DO kedua reuse audit tidak boleh memakai id DO pertama.');

        const doB = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, doNumber, status }`,
            { id: doBId }
        );
        assert(doB?.status === 'CREATED', 'DO kedua reuse audit harus berstatus CREATED.');

        order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, tripPlans[]{ _key, linkedDeliveryOrderRef, linkedDeliveryOrderNumber } }`,
            { id: orderId }
        );
        const linkedTripAfterReuse = order?.tripPlans?.find(plan => plan._key === tripPlan._key);
        assert(linkedTripAfterReuse?.linkedDeliveryOrderRef === doBId, 'Trip plan tidak dipindah link-nya ke DO kedua setelah cancel.');
        assert(linkedTripAfterReuse?.linkedDeliveryOrderNumber === doB?.doNumber, 'Trip plan tidak sinkron doNumber DO kedua.');

        const vouchers = await client.fetch<Array<{ _id: string; deliveryOrderRef?: string }>>(
            `*[_type == "driverVoucher" && deliveryOrderRef in $ids]{ _id, deliveryOrderRef }`,
            { ids: [doAId, doBId] }
        );
        assert(vouchers.length === 2, 'Reuse trip plan harus menghasilkan 2 voucher terpisah untuk 2 DO berbeda.');

        console.log('Audit runtime trip plan cancel reuse flow: OK');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime trip plan cancel reuse flow failed.');
    console.error(error);
    process.exitCode = 1;
});
