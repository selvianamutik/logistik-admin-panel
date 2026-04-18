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
        sequence?: number;
        vehicleRef?: string;
        driverRef?: string;
        issueBankRef?: string;
        cashGiven?: number;
        linkedDeliveryOrderRef?: string;
        linkedDeliveryOrderNumber?: string;
    }>;
};

type DeliveryOrderSnapshot = {
    _id: string;
    doNumber?: string;
    vehicleRef?: string;
    driverRef?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-multi-trip-create',
    name: 'Audit Owner Multi Trip Create',
    email: 'audit.multi.trip.create@company.local',
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
        `*[_type == "order" && masterResi match "AUDIT-MULTI-TRIP-CREATE-*"]._id`
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
    const vehicleIds = await client.fetch<string[]>(
        `*[_type == "vehicle" && unitCode match "AUDIT-MULTI-TRIP-CREATE-*"]._id`
    );
    const driverIds = await client.fetch<string[]>(
        `*[_type == "driver" && licenseNumber match "AUDIT-MULTI-TRIP-CREATE-*"]._id`
    );

    await deleteDocumentsByIds([
        ...disbursementIds,
        ...bankTransactionIds,
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
    } = await import('../src/lib/api/order-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const businessDate = getBusinessDateValue();
    const vehicleAId = `audit-veh-multi-trip-a-${uniqueSeed.toLowerCase()}`;
    const vehicleBId = `audit-veh-multi-trip-b-${uniqueSeed.toLowerCase()}`;
    const driverAId = `audit-drv-multi-trip-a-${uniqueSeed.toLowerCase()}`;
    const driverBId = `audit-drv-multi-trip-b-${uniqueSeed.toLowerCase()}`;

    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    try {
        await client.create({
            _id: vehicleAId,
            _type: 'vehicle',
            unitCode: `AUDIT-MULTI-TRIP-CREATE-A-${uniqueSeed}`,
            plateNumber: `L 7${uniqueSeed.slice(-4)} A`,
            vehicleType: 'CDD',
            brandModel: 'Audit Multi Trip Vehicle A',
            year: 2024,
            capacityKg: 4000,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: vehicleBId,
            _type: 'vehicle',
            unitCode: `AUDIT-MULTI-TRIP-CREATE-B-${uniqueSeed}`,
            plateNumber: `L 6${uniqueSeed.slice(-4)} B`,
            vehicleType: 'CDD',
            brandModel: 'Audit Multi Trip Vehicle B',
            year: 2025,
            capacityKg: 4200,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            status: 'ACTIVE',
        });
        await client.create({
            _id: driverAId,
            _type: 'driver',
            name: `Audit Multi Trip Driver A ${uniqueSeed}`,
            phone: '081200010001',
            licenseNumber: `AUDIT-MULTI-TRIP-CREATE-A-${uniqueSeed}`,
            active: true,
        });
        await client.create({
            _id: driverBId,
            _type: 'driver',
            name: `Audit Multi Trip Driver B ${uniqueSeed}`,
            phone: '081200010002',
            licenseNumber: `AUDIT-MULTI-TRIP-CREATE-B-${uniqueSeed}`,
            active: true,
        });

        const createOrderResponse = await handleOrderCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                serviceRef: 'svc-002',
                receiverAddress: `Tujuan Audit Multi Trip ${uniqueSeed}`,
                pickupAddress: `Pickup Audit Multi Trip ${uniqueSeed}`,
                notes: 'Order audit multi-trip create runtime',
                items: [],
                tripDrafts: [
                    {
                        vehicleRef: vehicleAId,
                        driverRef: driverAId,
                        issueBankRef: 'bank-jatim-001',
                        cashGiven: 100000,
                        taripBorongan: 275000,
                        date: businessDate,
                        notes: 'Trip plan audit A',
                    },
                    {
                        vehicleRef: vehicleBId,
                        driverRef: driverBId,
                        issueBankRef: 'bank-jatim-001',
                        cashGiven: 110000,
                        taripBorongan: 285000,
                        date: businessDate,
                        notes: 'Trip plan audit B',
                    },
                ],
            },
            noopAuditLog
        );
        const createOrderJson = await parseResponse(createOrderResponse);
        const orderId = createOrderJson?.id;
        assert(typeof orderId === 'string' && orderId.length > 0, 'Order multi-trip audit tidak berhasil dibuat.');

        let order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{
                _id,
                tripPlans[]{
                    _key,
                    sequence,
                    vehicleRef,
                    driverRef,
                    issueBankRef,
                    cashGiven,
                    linkedDeliveryOrderRef,
                    linkedDeliveryOrderNumber
                }
            }`,
            { id: orderId }
        );
        assert(order, 'Order multi-trip audit tidak ditemukan.');
        assert((order.tripPlans || []).length === 2, 'Order multi-trip audit harus punya 2 trip plan.');

        const [tripPlanA, tripPlanB] = order.tripPlans || [];
        assert(tripPlanA?._key && tripPlanB?._key, 'Trip plan audit tidak punya _key stabil.');
        assert(tripPlanA.vehicleRef === vehicleAId, 'Trip plan A tidak menyimpan vehicleRef yang benar.');
        assert(tripPlanB.vehicleRef === vehicleBId, 'Trip plan B tidak menyimpan vehicleRef yang benar.');
        assert(tripPlanA.driverRef === driverAId, 'Trip plan A tidak menyimpan driverRef yang benar.');
        assert(tripPlanB.driverRef === driverBId, 'Trip plan B tidak menyimpan driverRef yang benar.');

        const createDoAResponse = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                orderTripPlanKey: tripPlanA._key,
                notes: 'DO audit multi-trip A',
            },
            noopAuditLog
        );
        const createDoAJson = await parseResponse(createDoAResponse);
        const doAId = createDoAJson?.id;
        assert(typeof doAId === 'string' && doAId.length > 0, 'DO A audit multi-trip gagal dibuat.');

        const doA = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, doNumber, vehicleRef, driverRef }`,
            { id: doAId }
        );
        assert(doA, 'DO A audit multi-trip tidak ditemukan.');
        assert(doA.vehicleRef === vehicleAId, 'DO A tidak mewarisi vehicleRef dari trip plan A.');
        assert(doA.driverRef === driverAId, 'DO A tidak mewarisi driverRef dari trip plan A.');

        order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{ _id, tripPlans[]{ _key, sequence, linkedDeliveryOrderRef, linkedDeliveryOrderNumber } }`,
            { id: orderId }
        );
        const linkedPlanA = (order?.tripPlans || []).find(plan => plan._key === tripPlanA._key);
        const linkedPlanBInitial = (order?.tripPlans || []).find(plan => plan._key === tripPlanB._key);
        assert(linkedPlanA?.linkedDeliveryOrderRef === doAId, 'Trip plan A tidak ter-link ke DO A.');
        assert(linkedPlanA?.linkedDeliveryOrderNumber === doA.doNumber, 'Trip plan A tidak sinkron doNumber DO A.');
        assert(!linkedPlanBInitial?.linkedDeliveryOrderRef, 'Trip plan B seharusnya belum ter-link setelah DO A dibuat.');

        await expectConflict(
            await handleDeliveryOrderCreate(
                ownerSession,
                {
                    orderRef: orderId,
                    orderTripPlanKey: tripPlanA._key,
                    notes: 'DO audit multi-trip A duplicate',
                },
                noopAuditLog
            ),
            'Rencana trip ini sudah dipakai'
        );

        const createDoBResponse = await handleDeliveryOrderCreate(
            ownerSession,
            {
                orderRef: orderId,
                orderTripPlanKey: tripPlanB._key,
                notes: 'DO audit multi-trip B',
            },
            noopAuditLog
        );
        const createDoBJson = await parseResponse(createDoBResponse);
        const doBId = createDoBJson?.id;
        assert(typeof doBId === 'string' && doBId.length > 0, 'DO B audit multi-trip gagal dibuat.');

        const doB = await client.fetch<DeliveryOrderSnapshot | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{ _id, doNumber, vehicleRef, driverRef }`,
            { id: doBId }
        );
        assert(doB, 'DO B audit multi-trip tidak ditemukan.');
        assert(doB.vehicleRef === vehicleBId, 'DO B tidak mewarisi vehicleRef dari trip plan B.');
        assert(doB.driverRef === driverBId, 'DO B tidak mewarisi driverRef dari trip plan B.');

        order = await client.fetch<OrderSnapshot | null>(
            `*[_type == "order" && _id == $id][0]{
                _id,
                tripPlans[]{
                    _key,
                    sequence,
                    linkedDeliveryOrderRef,
                    linkedDeliveryOrderNumber
                }
            }`,
            { id: orderId }
        );
        const linkedPlanB = (order?.tripPlans || []).find(plan => plan._key === tripPlanB._key);
        assert(linkedPlanB?.linkedDeliveryOrderRef === doBId, 'Trip plan B tidak ter-link ke DO B.');
        assert(linkedPlanB?.linkedDeliveryOrderNumber === doB.doNumber, 'Trip plan B tidak sinkron doNumber DO B.');
        assert(linkedPlanA?.linkedDeliveryOrderRef !== linkedPlanB?.linkedDeliveryOrderRef, 'Dua trip plan tidak boleh menunjuk DO yang sama.');

        const vouchers = await client.fetch<Array<{
            _id: string;
            deliveryOrderRef?: string;
            cashGiven?: number;
            issueBankRef?: string;
        }>>(
            `*[_type == "driverVoucher" && deliveryOrderRef in $ids]{
                _id,
                deliveryOrderRef,
                cashGiven,
                issueBankRef
            }`,
            { ids: [doAId, doBId] }
        );
        assert(vouchers.length === 2, 'Setiap DO multi-trip harus menerbitkan voucher uang jalan awal masing-masing.');
        const voucherDoRefs = new Set(vouchers.map(voucher => voucher.deliveryOrderRef).filter(Boolean));
        assert(voucherDoRefs.has(doAId) && voucherDoRefs.has(doBId), 'Voucher uang jalan tidak lengkap untuk DO A dan DO B.');

        console.log('Audit runtime order multi-trip create flow: OK');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime order multi-trip create flow failed.');
    console.error(error);
    process.exitCode = 1;
});
