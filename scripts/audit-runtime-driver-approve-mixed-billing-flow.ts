import { loadScriptEnv } from './_env';
import type { DeliveryOrder, DeliveryOrderItem } from '../src/lib/types';

loadScriptEnv(process.cwd());

type ApiSession = {
    _id: string;
    name: string;
    email?: string;
    role: 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA' | 'DRIVER';
};

type CompanyNumberingSnapshot = {
    _id: string;
    numberingSettings?: Record<string, unknown>;
};

type RuntimeAuditDeliveryOrder = {
    _id: string;
    status?: string;
    pendingDriverStatus?: string;
    actualDropPoints?: Array<{
        stopType?: string;
        locationAddress?: string;
        qtyKoli?: number;
        weightKg?: number;
    }>;
    shipperReferences?: Array<{
        referenceNumber?: string;
        billingCustomerRef?: string;
        receiverAddress?: string;
    }>;
};

type RuntimeAuditFreightNotaItem = {
    _id: string;
    notaRef?: string;
    noSJ?: string;
    tujuan?: string;
    customerRef?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-driver-approve-mixed',
    name: 'Audit Owner Driver Approve Mixed',
    email: 'audit.driver.approve.mixed@company.local',
    role: 'OWNER',
};

const driverSession: ApiSession = {
    _id: 'user-audit-driver-driver-approve-mixed',
    name: 'Audit Driver Driver Approve Mixed',
    email: 'audit.driver.approve.mixed.driver@company.local',
    role: 'DRIVER',
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

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
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
    const doIds = await client.fetch<string[]>(
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-DRIVER-MIX-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const trackingLogIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "trackingLog" && refRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-DRIVER-APPROVE-MIX-*"]._id`
    );
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...trackingLogIds,
        ...notaItemIds,
        ...notaIds,
        ...doItemIds,
        ...doIds,
    ]);
}

async function restoreCompanyNumbering(snapshot: CompanyNumberingSnapshot | null) {
    if (!snapshot?._id) {
        return;
    }
    const current = await client.fetch<{ _id: string; _rev?: string } | null>(
        `*[_type == "companyProfile" && _id == $id][0]{ _id, _rev }`,
        { id: snapshot._id }
    );
    if (!current?._id || !current._rev) {
        return;
    }
    await client
        .patch(current._id)
        .ifRevisionId(current._rev)
        .set({ numberingSettings: snapshot.numberingSettings || {} })
        .commit();
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const { buildNotaRowsFromDeliveryOrder } = await import('../src/lib/invoice-create-page-support');
    const {
        handleDeliveryOrderDriverStatusRequest,
        handleDeliveryOrderStatusUpdate,
    } = await import('../src/lib/api/order-workflows');
    const {
        handleFreightNotaCreate,
        handleFreightNotaDelete,
    } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-driver-mix-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-driver-mix-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-driver-mix-b-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-DRV-MIX-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-DRV-MIX-SJ-B-${uniqueSeed}`;
    const tujuanA = `Jl. Driver Mixed Approval A ${uniqueSeed.slice(-4)}, Surabaya`;
    const tujuanB = `Jl. Driver Mixed Approval B ${uniqueSeed.slice(-4)}, Pasuruan`;
    const holdAddress = `Gudang Hold Driver Mixed ${uniqueSeed.slice(-4)}, Sidoarjo`;
    const notaPrefix = `AUDIT-DRIVER-APPROVE-MIX-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-DRIVER-MIX-${uniqueSeed}`,
            masterResi: `AUDIT-DRIVER-MIX-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'ARRIVED',
            pickupAddress: 'Gudang Audit Driver Mixed',
            receiverCompany: 'Header Driver Mixed',
            receiverName: 'Header Driver Mixed',
            receiverAddress: 'Jl. Header Driver Mixed, Gresik',
            customerDoNumber: sjA,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            vehicleRef: 'veh-002',
            vehiclePlate: 'L 9456 AB',
            driverRef: 'drv-002',
            driverName: 'Budi Hartono',
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Driver Mixed',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Driver A',
                    receiverName: 'Penerima Driver A',
                    receiverAddress: tujuanA,
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Driver Mixed',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverCompany: 'Distribusi Driver B',
                    receiverName: 'Penerima Driver B',
                    receiverAddress: tujuanB,
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Driver Mixed A',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            shippedQtyKoli: 4,
            shippedWeight: 120,
            shipperReferenceNumber: sjA,
        });

        await client.create({
            _id: doItemBId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Driver Mixed B',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            shippedQtyKoli: 4,
            shippedWeight: 120,
            shipperReferenceNumber: sjB,
        });

        const driverRequestPayload = {
            id: doId,
            status: 'DELIVERED',
            note: 'Audit driver mixed billing dengan partial + hold + full drop',
            actualItems: [
                {
                    deliveryOrderItemRef: doItemAId,
                    actualQtyKoli: 4,
                    actualWeightInputValue: 120,
                    actualWeightInputUnit: 'KG',
                    actualVolumeInputValue: 0.4,
                    actualVolumeInputUnit: 'M3',
                },
                {
                    deliveryOrderItemRef: doItemBId,
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
                    locationName: 'Tujuan SJ A',
                    locationAddress: tujuanA,
                    qtyKoli: 3,
                    weightInputValue: 90,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.3,
                    volumeInputUnit: 'M3',
                    note: 'Sebagian SJ A diturunkan',
                },
                {
                    stopType: 'HOLD',
                    locationName: 'Gudang Hold',
                    locationAddress: holdAddress,
                    qtyKoli: 1,
                    weightInputValue: 30,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.1,
                    volumeInputUnit: 'M3',
                    note: 'Sisa SJ A ditahan',
                },
                {
                    stopType: 'DROP',
                    locationName: 'Tujuan SJ B',
                    locationAddress: tujuanB,
                    qtyKoli: 4,
                    weightInputValue: 120,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0.4,
                    volumeInputUnit: 'M3',
                    note: 'SJ B full drop',
                },
            ],
        };

        const driverRequestResponse = await handleDeliveryOrderDriverStatusRequest(
            driverSession,
            driverRequestPayload,
            noopAuditLog
        );
        const driverRequestJson = await parseResponse(driverRequestResponse);
        assert(
            driverRequestJson?.data?.pendingDriverStatus === 'DELIVERED',
            'Driver request mixed billing tidak menyimpan pendingDriverStatus DELIVERED.'
        );

        const approvalPayload = {
            ...driverRequestPayload,
            podReceiverName: 'Penerima Audit Driver Mixed',
            podReceivedDate: issueDate,
            podNote: 'POD audit driver mixed billing',
        };
        const approvalResponse = await handleDeliveryOrderStatusUpdate(
            ownerSession,
            approvalPayload,
            noopAuditLog
        );
        await parseResponse(approvalResponse);

        const deliveredDo = await client.fetch<RuntimeAuditDeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                status,
                pendingDriverStatus,
                actualDropPoints,
                shipperReferences[]{
                    referenceNumber,
                    billingCustomerRef,
                    receiverAddress
                }
            }`,
            { id: doId }
        );
        const deliveredDoItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );

        assert(deliveredDo?.status === 'DELIVERED', 'DO mixed billing driver approval tidak berubah ke DELIVERED.');
        assert(!deliveredDo?.pendingDriverStatus, 'Pending driver status mixed billing tidak dibersihkan setelah approval.');
        assert((deliveredDo?.actualDropPoints || []).length === 3, 'Actual drop points mixed billing tidak final 3 titik.');
        assert(
            deliveredDo?.actualDropPoints?.some(point => point.stopType === 'HOLD' && point.locationAddress === holdAddress),
            'Titik HOLD mixed billing tidak tersimpan.'
        );

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: deliveredDo as unknown as DeliveryOrder,
            orders: [],
            deliveryOrderItems: deliveredDoItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: `Audit driver approve mixed ${row.noSJ}`,
        }));

        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        assert(rowA && rowB, 'Nota rows mixed billing setelah admin approve tidak lengkap.');
        assert(rowA.customerRef === 'cust-001', 'Row SJ A setelah approve tidak membaca customer A.');
        assert(rowB.customerRef === 'cust-002', 'Row SJ B setelah approve tidak membaca customer B.');
        assert(rowA.tujuan === tujuanA, 'Row SJ A setelah approve tidak membaca tujuan dari SJ.');
        assert(rowB.tujuan === tujuanB, 'Row SJ B setelah approve tidak membaca tujuan dari SJ.');
        assert(rowA.tujuan !== holdAddress, 'Row SJ A setelah approve salah jatuh ke lokasi HOLD.');
        assert(rowB.tujuan !== holdAddress, 'Row SJ B setelah approve salah jatuh ke lokasi HOLD.');

        const createNotaAResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const createNotaAJson = await parseResponse(createNotaAResponse);
        const notaAId = createNotaAJson?.id || createNotaAJson?.data?._id;
        assert(notaAId, 'Nota A mixed billing setelah approve gagal dibuat.');
        createdNotaIds.add(notaAId);

        const createNotaBResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B`,
                rows: [rowB],
            },
            noopAuditLog
        );
        const createNotaBJson = await parseResponse(createNotaBResponse);
        const notaBId = createNotaBJson?.id || createNotaBJson?.data?._id;
        assert(notaBId, 'Nota B mixed billing setelah approve gagal dibuat.');
        createdNotaIds.add(notaBId);

        const notaItems = await client.fetch<RuntimeAuditFreightNotaItem[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]{
                _id,
                notaRef,
                noSJ,
                tujuan,
                customerRef
            }`,
            { ids: Array.from(createdNotaIds) }
        );
        const notaItemA = notaItems.find(item => item.notaRef === notaAId);
        const notaItemB = notaItems.find(item => item.notaRef === notaBId);
        assert(notaItemA?.noSJ === sjA, 'Nota item A setelah approve tidak menyimpan SJ A.');
        assert(notaItemA?.customerRef === 'cust-001', 'Nota item A setelah approve tidak menyimpan customer A.');
        assert(notaItemA?.tujuan === tujuanA, 'Nota item A setelah approve tidak menyimpan tujuan SJ A.');
        assert(notaItemB?.noSJ === sjB, 'Nota item B setelah approve tidak menyimpan SJ B.');
        assert(notaItemB?.customerRef === 'cust-002', 'Nota item B setelah approve tidak menyimpan customer B.');
        assert(notaItemB?.tujuan === tujuanB, 'Nota item B setelah approve tidak menyimpan tujuan SJ B.');

        console.log('Audit runtime driver approve mixed billing flow: OK');
    } finally {
        for (const notaId of createdNotaIds) {
            try {
                await handleFreightNotaDelete(ownerSession, { id: notaId }, noopAuditLog);
            } catch {}
        }
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime driver approve mixed billing flow failed.');
    console.error(error);
    process.exitCode = 1;
});
