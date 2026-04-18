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
    _id: 'user-audit-owner-mixed-billing',
    name: 'Audit Owner Mixed Billing',
    email: 'audit.mixed.billing@company.local',
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
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-MIX-BILL-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-MIX-BILLING-*"]._id`
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
    const { handleFreightNotaCreate, handleFreightNotaDelete } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-mix-bill-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-mix-bill-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-mix-bill-b-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-MIX-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-MIX-SJ-B-${uniqueSeed}`;
    const tujuanA = `Jl. Audit Mixed Billing A ${uniqueSeed.slice(-4)}, Surabaya`;
    const tujuanB = `Jl. Audit Mixed Billing B ${uniqueSeed.slice(-4)}, Sidoarjo`;
    const notaPrefix = `AUDIT-MIX-BILLING-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-MIX-BILL-${uniqueSeed}`,
            masterResi: `AUDIT-MIX-BILL-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Mixed Billing',
            receiverCompany: 'Header Mixed Billing',
            receiverName: 'Header Mixed Billing',
            receiverAddress: 'Jl. Header Mixed Billing, Gresik',
            customerDoNumber: sjA,
            podReceiverName: 'Penerima Mixed Billing',
            podReceivedDate: issueDate,
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Mixed Billing',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverCompany: 'Distribusi Mixed A',
                    receiverName: 'Penerima Mixed A',
                    receiverAddress: tujuanA,
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Mixed Billing',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverCompany: 'Distribusi Mixed B',
                    receiverName: 'Penerima Mixed B',
                    receiverAddress: tujuanB,
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Billing A',
            orderItemQtyKoli: 6,
            orderItemWeight: 180,
            actualQtyKoli: 6,
            actualWeightKg: 180,
            shipperReferenceNumber: sjA,
        });

        await client.create({
            _id: doItemBId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Billing B',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            actualQtyKoli: 4,
            actualWeightKg: 120,
            shipperReferenceNumber: sjB,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit mixed billing tidak ditemukan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: `Audit mixed billing ${row.noSJ}`,
        }));

        assert(notaRows.length === 2, 'Mixed billing DO harus membentuk tepat 2 row nota per SJ.');
        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        assert(rowA && rowB, 'Row nota mixed billing tidak lengkap per SJ.');
        assert(rowA.customerRef === 'cust-001', 'Row SJ A tidak membaca billing customer cust-001.');
        assert(rowB.customerRef === 'cust-002', 'Row SJ B tidak membaca billing customer cust-002.');
        assert(rowA.tujuan === tujuanA, 'Row SJ A tidak membaca tujuan dari shipper reference.');
        assert(rowB.tujuan === tujuanB, 'Row SJ B tidak membaca tujuan dari shipper reference.');

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
        assert(notaAId, 'Nota A mixed billing gagal dibuat.');
        createdNotaIds.add(notaAId);

        await expectConflict(
            await handleFreightNotaCreate(
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
            ),
            sjA
        );

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
        assert(notaBId, 'Nota B mixed billing gagal dibuat walau SJ-nya berbeda.');
        createdNotaIds.add(notaBId);

        const notaItems = await client.fetch<RuntimeAuditFreightNotaItem[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]{
                _id,
                notaRef,
                doRef,
                noSJ,
                tujuan,
                customerRef,
                customerName
            }`,
            { ids: Array.from(createdNotaIds) }
        );

        const notaItemA = notaItems.find(item => item.notaRef === notaAId);
        const notaItemB = notaItems.find(item => item.notaRef === notaBId);
        assert(notaItemA?.noSJ === sjA, 'Nota A tidak menyimpan SJ A.');
        assert(notaItemA?.customerRef === 'cust-001', 'Nota A tidak menyimpan customer cust-001.');
        assert(notaItemA?.tujuan === tujuanA, 'Nota A tidak menyimpan tujuan SJ A.');
        assert(notaItemB?.noSJ === sjB, 'Nota B tidak menyimpan SJ B.');
        assert(notaItemB?.customerRef === 'cust-002', 'Nota B tidak menyimpan customer cust-002.');
        assert(notaItemB?.tujuan === tujuanB, 'Nota B tidak menyimpan tujuan SJ B.');

        console.log('Audit runtime mixed billing split per SJ: OK');
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
    console.error('Audit runtime mixed billing split flow failed.');
    console.error(error);
    process.exitCode = 1;
});
