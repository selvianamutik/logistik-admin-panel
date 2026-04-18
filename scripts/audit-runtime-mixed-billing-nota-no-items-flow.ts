import { loadScriptEnv } from './_env';
import type { DeliveryOrder } from '../src/lib/types';

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

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-mixed-no-items',
    name: 'Audit Owner Mixed No Items',
    email: 'audit.mixed.no.items@company.local',
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

async function parseResponse(response: Response) {
    const payload = await parseJsonSafe(response);
    if (!response.ok) {
        const error = typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`;
        throw new Error(error);
    }
    return payload;
}

async function expectConflict(response: Response, containsText: string) {
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
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-MIX-NO-ITEMS-*"]._id`
    );
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-MIX-NO-ITEMS-*"]._id`
    );
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...notaItemIds,
        ...notaIds,
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
    const { handleFreightNotaCreate, handleFreightNotaDelete, handleFreightNotaUpdate } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-mix-no-items-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-MIX-NO-ITEMS-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-MIX-NO-ITEMS-SJ-B-${uniqueSeed}`;
    const sjC = `AUDIT-MIX-NO-ITEMS-SJ-C-${uniqueSeed}`;
    const tujuanA = `Jl. Audit No Items A ${uniqueSeed.slice(-4)}, Surabaya`;
    const tujuanB = `Jl. Audit No Items B ${uniqueSeed.slice(-4)}, Sidoarjo`;
    const tujuanC = `Jl. Audit No Items C ${uniqueSeed.slice(-4)}, Gresik`;
    const notaPrefix = `AUDIT-MIX-NO-ITEMS-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-MIX-NO-ITEMS-${uniqueSeed}`,
            masterResi: `AUDIT-MIX-NO-ITEMS-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Mixed No Items',
            receiverCompany: 'Header Mixed No Items',
            receiverName: 'Header Mixed No Items',
            receiverAddress: 'Jl. Header Mixed No Items, Gresik',
            customerDoNumber: sjA,
            podReceiverName: 'Penerima Mixed No Items',
            podReceivedDate: issueDate,
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Mixed No Items',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverAddress: tujuanA,
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Mixed No Items',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverAddress: tujuanB,
                },
                {
                    _key: `shipref-c-${uniqueSeed.toLowerCase()}`,
                    sequence: 3,
                    referenceNumber: sjC,
                    pickupAddress: 'Gudang Audit Mixed No Items',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverAddress: tujuanC,
                },
            ],
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit mixed no-items tidak ditemukan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems: [],
        }).map(row => {
            const metricsBySj: Record<string, { collie: number; beratKg: number }> = {
                [sjA]: { collie: 6, beratKg: 180 },
                [sjB]: { collie: 4, beratKg: 120 },
                [sjC]: { collie: 5, beratKg: 150 },
            };
            const metrics = metricsBySj[row.noSJ] || { collie: 1, beratKg: 1 };

            return {
                ...row,
                collie: metrics.collie,
                beratKg: metrics.beratKg,
                tarip: 132,
                ket: `Audit mixed no items ${row.noSJ}`,
            };
        });

        assert(notaRows.length === 3, 'DO no-items harus membentuk tepat 3 row nota dari shipperReferences.');
        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        const rowC = notaRows.find(row => row.noSJ === sjC);
        assert(rowA && rowB && rowC, 'Row nota no-items tidak lengkap per SJ.');
        assert(!rowA.deliveryOrderItemRef && (!rowA.deliveryOrderItemRefs || rowA.deliveryOrderItemRefs.length === 0), 'Row A no-items tidak boleh punya deliveryOrderItemRef.');
        assert(!rowB.deliveryOrderItemRef && (!rowB.deliveryOrderItemRefs || rowB.deliveryOrderItemRefs.length === 0), 'Row B no-items tidak boleh punya deliveryOrderItemRef.');
        assert(rowA.customerRef === 'cust-001' && rowA.tujuan === tujuanA, 'Row A no-items tidak membaca customer/tujuan dari shipperReference.');
        assert(rowB.customerRef === 'cust-002' && rowB.tujuan === tujuanB, 'Row B no-items tidak membaca customer/tujuan dari shipperReference.');
        assert(rowC.customerRef === 'cust-001' && rowC.tujuan === tujuanC, 'Row C no-items tidak membaca customer/tujuan dari shipperReference.');

        const notaAResponse = await handleFreightNotaCreate(
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
        const notaAJson = await parseResponse(notaAResponse);
        const notaAId = notaAJson?.id || notaAJson?.data?._id;
        assert(typeof notaAId === 'string' && notaAId.length > 0, 'Nota A no-items gagal dibuat.');
        createdNotaIds.add(notaAId);

        const duplicateAResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A-DUP`,
                rows: [rowA],
            },
            noopAuditLog
        );
        await expectConflict(duplicateAResponse, 'sudah tertagih');

        const notaBResponse = await handleFreightNotaCreate(
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
        const notaBJson = await parseResponse(notaBResponse);
        const notaBId = notaBJson?.id || notaBJson?.data?._id;
        assert(typeof notaBId === 'string' && notaBId.length > 0, 'Nota B no-items gagal dibuat.');
        createdNotaIds.add(notaBId);

        const reviseAResponse = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: notaAId,
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A-REVISED`,
                rows: [rowC],
            },
            noopAuditLog
        );
        await parseResponse(reviseAResponse);

        const notaAItems = await client.fetch<Array<{ noSJ?: string; deliveryOrderItemRef?: string; deliveryOrderItemRefs?: string[] }>>(
            `*[_type == "freightNotaItem" && notaRef == $id]{ noSJ, deliveryOrderItemRef, deliveryOrderItemRefs }`,
            { id: notaAId }
        );
        assert(notaAItems.length === 1 && notaAItems[0]?.noSJ === sjC, 'Revisi nota A no-items tidak memindahkan coverage ke SJ C.');
        assert(
            !notaAItems[0]?.deliveryOrderItemRef && (!notaAItems[0]?.deliveryOrderItemRefs || notaAItems[0].deliveryOrderItemRefs.length === 0),
            'Nota item hasil revisi no-items tidak boleh tiba-tiba punya deliveryOrderItemRef.'
        );

        const releasedAResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-A-RELEASED`,
                rows: [rowA],
            },
            noopAuditLog
        );
        const releasedAJson = await parseResponse(releasedAResponse);
        const releasedAId = releasedAJson?.id || releasedAJson?.data?._id;
        assert(typeof releasedAId === 'string' && releasedAId.length > 0, 'SJ A tidak kembali available setelah revisi nota no-items.');
        createdNotaIds.add(releasedAId);

        const deleteNotaAResponse = await handleFreightNotaDelete(
            ownerSession,
            { id: notaAId },
            noopAuditLog
        );
        await parseResponse(deleteNotaAResponse);
        createdNotaIds.delete(notaAId);

        const releasedCResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-C-RELEASED`,
                rows: [rowC],
            },
            noopAuditLog
        );
        const releasedCJson = await parseResponse(releasedCResponse);
        const releasedCId = releasedCJson?.id || releasedCJson?.data?._id;
        assert(typeof releasedCId === 'string' && releasedCId.length > 0, 'SJ C tidak kembali available setelah delete nota no-items.');
        createdNotaIds.add(releasedCId);

        const duplicateBResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B-DUP`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectConflict(duplicateBResponse, 'sudah tertagih');

        console.log('Audit Runtime Mixed Billing Nota No Items');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${sjA}, ${sjB}, ${sjC}`);
        console.log('- Row invoice terbentuk dari shipperReferences tanpa deliveryOrderItem');
        console.log('- Revisi nota tetap memindahkan coverage per-SJ secara bersih');
        console.log('- Delete/recreate coverage tetap bekerja walau row tidak punya item refs');
        console.log('- Lock customer lain tetap independen');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime mixed billing nota no-items flow gagal:', error);
    process.exitCode = 1;
});
