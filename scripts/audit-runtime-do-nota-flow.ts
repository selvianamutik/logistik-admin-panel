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
    podReceiverName?: string;
    podReceivedDate?: string;
    pendingDriverStatus?: string;
    actualDropPoints?: Array<{
        stopType?: string;
        qtyKoli?: number;
        weightKg?: number;
    }>;
    shipperReferences?: Array<{
        referenceNumber?: string;
        receiverAddress?: string;
        billingCustomerRef?: string;
    }>;
};

type RuntimeAuditDeliveryOrderItem = {
    _id: string;
    deliveryOrderRef?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
    actualQtyKoli?: number;
    actualWeightKg?: number;
    shipperReferenceNumber?: string;
};

type RuntimeAuditFreightNotaItem = {
    _id: string;
    notaRef?: string;
    doRef?: string;
    noSJ?: string;
    tujuan?: string;
    customerRef?: string;
    customerName?: string;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-script',
    name: 'Audit Owner',
    email: 'audit.owner@company.local',
    role: 'OWNER',
};

const driverSession: ApiSession = {
    _id: 'user-audit-driver-script',
    name: 'Audit Driver',
    email: 'audit.driver@company.local',
    role: 'DRIVER',
};

const noopAuditLog = async () => undefined;

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function parseResponse(response: Response) {
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

async function cleanupTrackingLogs(refRef: string) {
    const trackingLogIds = await client.fetch<string[]>(
        `*[_type == "trackingLog" && refRef == $ref]._id`,
        { ref: refRef }
    );
    await deleteDocumentsByIds(trackingLogIds || []);
}

async function cleanupAuditRuntimeArtifacts() {
    const runtimeArtifacts = await client.fetch<{
        doIds: string[];
        doItemIds: string[];
        trackingLogIds: string[];
        notaItemIds: string[];
        notaIds: string[];
    }>(
        `{
            "doIds": *[_type == "deliveryOrder" && doNumber match "DO-AUDIT-*"]._id,
            "doItemIds": *[_type == "deliveryOrderItem" && deliveryOrderRef in *[_type == "deliveryOrder" && doNumber match "DO-AUDIT-*"]._id]._id,
            "trackingLogIds": *[_type == "trackingLog" && refRef in *[_type == "deliveryOrder" && doNumber match "DO-AUDIT-*"]._id]._id,
            "notaItemIds": *[_type == "freightNotaItem" && doRef in *[_type == "deliveryOrder" && doNumber match "DO-AUDIT-*"]._id]._id,
            "notaIds": *[_type == "freightNota" && _id in *[_type == "freightNotaItem" && doRef in *[_type == "deliveryOrder" && doNumber match "DO-AUDIT-*"]._id].notaRef]._id
        }`
    );

    await deleteDocumentsByIds([
        ...(runtimeArtifacts.trackingLogIds || []),
        ...(runtimeArtifacts.notaItemIds || []),
        ...(runtimeArtifacts.notaIds || []),
        ...(runtimeArtifacts.doItemIds || []),
        ...(runtimeArtifacts.doIds || []),
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
    await cleanupAuditRuntimeArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const doId = `audit-do-runtime-${uniqueSeed.toLowerCase()}`;
    const doItemId = `audit-doi-runtime-${uniqueSeed.toLowerCase()}`;
    const shipperReferenceNumber = `AUDIT-SJ-${uniqueSeed}`;
    const receiverAddress = `Jl. Audit Runtime No. ${uniqueSeed.slice(-4)}, Pasuruan`;
    const holdAddress = `Gudang Hold Audit ${uniqueSeed}, Sidoarjo`;
    const issueDate = getBusinessDateValue();

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    let createdNotaId: string | null = null;

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-${uniqueSeed}`,
            masterResi: `AUDIT-RESI-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'ARRIVED',
            pickupAddress: 'Gudang Audit Runtime - Tulangan',
            receiverCompany: 'Distribusi Audit Runtime',
            receiverName: 'Penerima Audit Runtime',
            receiverAddress,
            serviceRef: 'svc-002',
            serviceName: 'CDD',
            vehicleRef: 'veh-002',
            vehiclePlate: 'L 9456 AB',
            driverRef: 'drv-002',
            driverName: 'Budi Hartono',
            customerDoNumber: shipperReferenceNumber,
            shipperReferences: [
                {
                    _key: `shipref-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: shipperReferenceNumber,
                    pickupAddress: 'Gudang Audit Runtime - Tulangan',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Audit Runtime',
                    receiverName: 'Penerima Audit Runtime',
                    receiverAddress,
                },
            ],
        });

        await client.create({
            _id: doItemId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Bahan audit runtime',
            orderItemQtyKoli: 7,
            orderItemWeight: 210,
            shippedQtyKoli: 7,
            shippedWeight: 210,
            shipperReferenceNumber,
        });

        const driverRequestPayload = {
            id: doId,
            status: 'DELIVERED',
            note: 'Audit runtime driver completion dengan partial drop + hold',
            actualItems: [
                {
                    deliveryOrderItemRef: doItemId,
                    actualQtyKoli: 7,
                    actualWeightInputValue: 210,
                    actualWeightInputUnit: 'KG',
                    actualVolumeInputValue: 0,
                    actualVolumeInputUnit: 'M3',
                },
            ],
            actualDropPoints: [
                {
                    stopType: 'DROP',
                    locationName: 'Distribusi Audit Runtime',
                    locationAddress: receiverAddress,
                    qtyKoli: 5,
                    weightInputValue: 150,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0,
                    volumeInputUnit: 'M3',
                    note: 'Sebagian barang dibongkar di tujuan utama',
                },
                {
                    stopType: 'HOLD',
                    locationName: 'Gudang Hold Audit',
                    locationAddress: holdAddress,
                    qtyKoli: 2,
                    weightInputValue: 60,
                    weightInputUnit: 'KG',
                    volumeInputValue: 0,
                    volumeInputUnit: 'M3',
                    note: 'Sisa barang ditahan sementara',
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
            'Driver request tidak menyimpan pendingDriverStatus DELIVERED.'
        );

        const approvalPayload = {
            ...driverRequestPayload,
            podReceiverName: 'Penerima Audit Runtime',
            podReceivedDate: issueDate,
            podNote: 'POD audit runtime',
        };

        const approveResponse = await handleDeliveryOrderStatusUpdate(
            ownerSession,
            approvalPayload,
            noopAuditLog
        );
        await parseResponse(approveResponse);

        const deliveredDo = await client.fetch<RuntimeAuditDeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]{
                _id,
                status,
                podReceiverName,
                podReceivedDate,
                pendingDriverStatus,
                actualDropPoints,
                shipperReferences
            }`,
            { id: doId }
        );
        const deliveredDoItems = await client.fetch<RuntimeAuditDeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]{
                _id,
                deliveryOrderRef,
                orderItemDescription,
                orderItemQtyKoli,
                orderItemWeight,
                actualQtyKoli,
                actualWeightKg,
                shipperReferenceNumber
            }`,
            { id: doId }
        );

        assert(deliveredDo?.status === 'DELIVERED', 'DO audit tidak berubah ke DELIVERED.');
        assert(!deliveredDo?.pendingDriverStatus, 'Pending driver status tidak dibersihkan setelah approval.');
        assert(Array.isArray(deliveredDo?.actualDropPoints) && deliveredDo.actualDropPoints.length === 2, 'Realisasi titik drop final tidak sesuai.');
        assert(deliveredDoItems[0]?.actualQtyKoli === 7, 'Muatan aktual item DO tidak tersimpan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder: deliveredDo as unknown as DeliveryOrder,
            orders: [],
            deliveryOrderItems: deliveredDoItems as unknown as DeliveryOrderItem[],
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: 'Audit runtime handoff',
        }));

        assert(notaRows.length === 1, 'Nota row audit harus tepat 1 SJ.');
        assert(notaRows[0].noSJ === shipperReferenceNumber, 'Nota row tidak mengambil SJ pengirim yang benar.');
        assert(notaRows[0].tujuan === receiverAddress, 'Nota row tidak mengambil tujuan dari SJ.');
        assert(notaRows[0].beratKg === 210, 'Nota row tidak mengambil berat aktual DO.');

        const createNotaResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                rows: notaRows,
            },
            noopAuditLog
        );
        const createNotaJson = await parseResponse(createNotaResponse);
        createdNotaId = createNotaJson?.id || createNotaJson?.data?._id || null;
        assert(createdNotaId, 'Nota audit tidak berhasil dibuat.');

        const notaItems = await client.fetch<RuntimeAuditFreightNotaItem[]>(
            `*[_type == "freightNotaItem" && notaRef == $id]{
                _id,
                notaRef,
                doRef,
                noSJ,
                tujuan,
                customerRef,
                customerName
            }`,
            { id: createdNotaId }
        );
        assert(notaItems.length === 1, 'Freight nota item audit harus tepat 1 baris.');
        assert(notaItems[0]?.noSJ === shipperReferenceNumber, 'Freight nota item tidak memakai SJ yang benar.');
        assert(notaItems[0]?.tujuan === receiverAddress, 'Freight nota item tidak mengambil tujuan SJ.');
        assert(notaItems[0]?.customerRef === 'cust-001', 'Freight nota item tidak memakai customer billing SJ.');

        const deleteNotaResponse = await handleFreightNotaDelete(
            ownerSession,
            { id: createdNotaId },
            noopAuditLog
        );
        await parseResponse(deleteNotaResponse);
        createdNotaId = null;

        const remainingNota = await client.fetch<{ _id: string } | null>(
            `*[_type == "freightNota" && _id == $id][0]{ _id }`,
            { id: createNotaJson.id }
        );
        assert(!remainingNota, 'Nota audit masih ada setelah dihapus.');

        console.log('Audit Runtime DO -> Driver -> Admin -> Nota');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${shipperReferenceNumber}`);
        console.log('- Driver request DELIVERED tersimpan');
        console.log('- Admin approve DELIVERED memfinalisasi cargo + drop');
        console.log('- Nota mengambil customer dan tujuan dari SJ');
        console.log('- Nota bisa dihapus ulang tanpa meninggalkan coverage');
    } finally {
        if (createdNotaId) {
            try {
                await handleFreightNotaDelete(ownerSession, { id: createdNotaId }, noopAuditLog);
            } catch {}
        }
        await cleanupTrackingLogs(doId).catch(() => undefined);
        await deleteDocumentsByIds([doItemId, doId]).catch(() => undefined);
        await cleanupAuditRuntimeArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime DO/nota gagal:', error);
    process.exitCode = 1;
});
