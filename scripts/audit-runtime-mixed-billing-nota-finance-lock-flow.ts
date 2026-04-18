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

type BankAccountSnapshot = {
    _id: string;
    currentBalance?: number;
};

let client: ReturnType<Awaited<typeof import('../src/lib/sanity')>['getSanityClient']>;

const ownerSession: ApiSession = {
    _id: 'user-audit-owner-mixed-finance-lock',
    name: 'Audit Owner Mixed Finance Lock',
    email: 'audit.mixed.finance.lock@company.local',
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
        `*[_type == "deliveryOrder" && doNumber match "DO-AUDIT-MIX-LOCK-*"]._id`
    );
    const doItemIds = doIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]._id`,
            { ids: doIds }
        )
        : [];
    const notaIds = await client.fetch<string[]>(
        `*[_type == "freightNota" && notes match "AUDIT-MIX-FIN-LOCK-*"]._id`
    );
    const notaItemIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "freightNotaItem" && notaRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    const paymentIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "payment" && invoiceRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];
    const incomeIds = paymentIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "income" && paymentRef in $ids]._id`,
            { ids: paymentIds }
        )
        : [];
    const bankTransactionIds = paymentIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "bankTransaction" && relatedPaymentRef in $ids]._id`,
            { ids: paymentIds }
        )
        : [];
    const refundIds = notaIds.length > 0
        ? await client.fetch<string[]>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "INVOICE_OVERPAID" && sourceInvoiceRef in $ids]._id`,
            { ids: notaIds }
        )
        : [];

    await deleteDocumentsByIds([
        ...bankTransactionIds,
        ...incomeIds,
        ...paymentIds,
        ...refundIds,
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

async function restoreBankBalance(snapshot: BankAccountSnapshot | null) {
    if (!snapshot?._id) {
        return;
    }
    const current = await client.fetch<{ _id: string; _rev?: string } | null>(
        `*[_type == "bankAccount" && _id == $id][0]{ _id, _rev }`,
        { id: snapshot._id }
    );
    if (!current?._id || !current._rev) {
        return;
    }
    await client
        .patch(current._id)
        .ifRevisionId(current._rev)
        .set({ currentBalance: snapshot.currentBalance || 0 })
        .commit();
}

async function main() {
    const { getSanityClient } = await import('../src/lib/sanity');
    const { getBusinessDateValue } = await import('../src/lib/business-date');
    const { buildNotaRowsFromDeliveryOrder } = await import('../src/lib/invoice-create-page-support');
    const { handleFreightNotaCreate, handleFreightNotaDelete, handleFreightNotaUpdate, handlePaymentCreate } = await import('../src/lib/api/finance-workflows');

    client = getSanityClient();
    await cleanupAuditArtifacts();

    const uniqueSeed = Date.now().toString(36).toUpperCase();
    const issueDate = getBusinessDateValue();
    const doId = `audit-do-mix-lock-${uniqueSeed.toLowerCase()}`;
    const doItemAId = `audit-doi-mix-lock-a-${uniqueSeed.toLowerCase()}`;
    const doItemBId = `audit-doi-mix-lock-b-${uniqueSeed.toLowerCase()}`;
    const doItemCId = `audit-doi-mix-lock-c-${uniqueSeed.toLowerCase()}`;
    const sjA = `AUDIT-MIX-LOCK-SJ-A-${uniqueSeed}`;
    const sjB = `AUDIT-MIX-LOCK-SJ-B-${uniqueSeed}`;
    const sjC = `AUDIT-MIX-LOCK-SJ-C-${uniqueSeed}`;
    const notaPrefix = `AUDIT-MIX-FIN-LOCK-${uniqueSeed}`;

    const companySnapshot = await client.fetch<CompanyNumberingSnapshot | null>(
        `*[_type == "companyProfile"][0]{ _id, numberingSettings }`
    );
    const bankSnapshot = await client.fetch<BankAccountSnapshot | null>(
        `*[_type == "bankAccount" && _id == "bank-jatim-001"][0]{ _id, currentBalance }`
    );

    const createdNotaIds = new Set<string>();

    try {
        await client.create({
            _id: doId,
            _type: 'deliveryOrder',
            doNumber: `DO-AUDIT-MIX-LOCK-${uniqueSeed}`,
            masterResi: `AUDIT-MIX-LOCK-${uniqueSeed}`,
            customerRef: 'cust-001',
            customerName: 'PT Pangan Nusantara',
            date: issueDate,
            status: 'DELIVERED',
            pickupAddress: 'Gudang Audit Mixed Finance Lock',
            receiverCompany: 'Header Mixed Finance Lock',
            receiverName: 'Header Mixed Finance Lock',
            receiverAddress: 'Jl. Header Mixed Finance Lock, Gresik',
            customerDoNumber: sjA,
            podReceiverName: 'Penerima Mixed Finance Lock',
            podReceivedDate: issueDate,
            shipperReferences: [
                {
                    _key: `shipref-a-${uniqueSeed.toLowerCase()}`,
                    sequence: 1,
                    referenceNumber: sjA,
                    pickupAddress: 'Gudang Audit Mixed Finance Lock',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverAddress: 'Jl. Audit Mixed Finance Lock A, Surabaya',
                },
                {
                    _key: `shipref-b-${uniqueSeed.toLowerCase()}`,
                    sequence: 2,
                    referenceNumber: sjB,
                    pickupAddress: 'Gudang Audit Mixed Finance Lock',
                    billingCustomerRef: 'cust-002',
                    billingCustomerName: 'CV Sinar Logam',
                    receiverAddress: 'Jl. Audit Mixed Finance Lock B, Sidoarjo',
                },
                {
                    _key: `shipref-c-${uniqueSeed.toLowerCase()}`,
                    sequence: 3,
                    referenceNumber: sjC,
                    pickupAddress: 'Gudang Audit Mixed Finance Lock',
                    billingCustomerRef: 'cust-001',
                    billingCustomerName: 'PT Pangan Nusantara',
                    receiverAddress: 'Jl. Audit Mixed Finance Lock C, Gresik',
                },
            ],
        });

        await client.create({
            _id: doItemAId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Finance Lock A',
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
            orderItemDescription: 'Barang Mixed Finance Lock B',
            orderItemQtyKoli: 4,
            orderItemWeight: 120,
            actualQtyKoli: 4,
            actualWeightKg: 120,
            shipperReferenceNumber: sjB,
        });
        await client.create({
            _id: doItemCId,
            _type: 'deliveryOrderItem',
            deliveryOrderRef: doId,
            orderItemDescription: 'Barang Mixed Finance Lock C',
            orderItemQtyKoli: 5,
            orderItemWeight: 150,
            actualQtyKoli: 5,
            actualWeightKg: 150,
            shipperReferenceNumber: sjC,
        });

        const deliveryOrder = await client.fetch<DeliveryOrder | null>(
            `*[_type == "deliveryOrder" && _id == $id][0]`,
            { id: doId }
        );
        const deliveryOrderItems = await client.fetch<DeliveryOrderItem[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef == $id]`,
            { id: doId }
        );
        assert(deliveryOrder, 'DO audit mixed finance lock tidak ditemukan.');

        const notaRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders: [],
            deliveryOrderItems,
        }).map(row => ({
            ...row,
            tarip: 132,
            ket: `Audit mixed finance lock ${row.noSJ}`,
        }));

        const rowA = notaRows.find(row => row.noSJ === sjA);
        const rowB = notaRows.find(row => row.noSJ === sjB);
        const rowC = notaRows.find(row => row.noSJ === sjC);
        assert(rowA && rowB && rowC, 'Row nota mixed finance lock tidak lengkap.');

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
        assert(typeof notaAId === 'string' && notaAId.length > 0, 'Nota A mixed finance lock gagal dibuat.');
        createdNotaIds.add(notaAId);

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
        assert(typeof notaBId === 'string' && notaBId.length > 0, 'Nota B mixed finance lock gagal dibuat.');
        createdNotaIds.add(notaBId);

        const paymentCreate = await handlePaymentCreate(
            ownerSession,
            {
                invoiceRef: notaAId,
                date: issueDate,
                amount: 10_000,
                method: 'TRANSFER',
                bankAccountRef: 'bank-jatim-001',
                note: `${notaPrefix}-PAYMENT-A`,
            },
            noopAuditLog
        );
        assert(paymentCreate instanceof Response, 'Handler payment create mixed finance lock tidak mengembalikan response.');
        await parseResponse(paymentCreate);

        const reviseAAfterPayment = await handleFreightNotaUpdate(
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
        await expectConflict(reviseAAfterPayment, 'tidak bisa direvisi');

        const deleteAAfterPayment = await handleFreightNotaDelete(
            ownerSession,
            { id: notaAId },
            noopAuditLog
        );
        await expectConflict(deleteAAfterPayment, 'tidak boleh dihapus');

        const notaCResponse = await handleFreightNotaCreate(
            ownerSession,
            {
                customerRef: 'cust-001',
                customerName: 'PT Pangan Nusantara',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-C`,
                rows: [rowC],
            },
            noopAuditLog
        );
        const notaCJson = await parseResponse(notaCResponse);
        const notaCId = notaCJson?.id || notaCJson?.data?._id;
        assert(typeof notaCId === 'string' && notaCId.length > 0, 'SJ C harus tetap bisa ditagihkan walau nota A sudah dibayar.');
        createdNotaIds.add(notaCId);

        await client.create({
            _id: `audit-refund-mix-lock-${uniqueSeed.toLowerCase()}`,
            _type: 'customerOverpaymentRefund',
            sourceType: 'INVOICE_OVERPAID',
            sourceInvoiceRef: notaBId,
            sourceInvoiceNumber: 'AUDIT-MIX-FIN-LOCK-REFUND',
            customerRef: 'cust-002',
            customerName: 'CV Sinar Logam',
            date: issueDate,
            amount: 5_000,
            bankAccountRef: 'bank-jatim-001',
            bankAccountName: 'Bank Jatim',
            bankAccountNumber: '0201200300400',
            note: `${notaPrefix}-REFUND-B`,
            createdBy: ownerSession._id,
            createdByName: ownerSession.name,
        });

        const reviseBAfterRefund = await handleFreightNotaUpdate(
            ownerSession,
            {
                id: notaBId,
                customerRef: 'cust-002',
                customerName: 'CV Sinar Logam',
                issueDate,
                billingMode: 'PER_KG',
                notes: `${notaPrefix}-B-REVISED`,
                rows: [rowB],
            },
            noopAuditLog
        );
        await expectConflict(reviseBAfterRefund, 'tidak bisa direvisi');

        const deleteBAfterRefund = await handleFreightNotaDelete(
            ownerSession,
            { id: notaBId },
            noopAuditLog
        );
        await expectConflict(deleteBAfterRefund, 'tidak boleh dihapus');

        const duplicateAWhilePaid = await handleFreightNotaCreate(
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
        await expectConflict(duplicateAWhilePaid, 'sudah tertagih');

        const duplicateBWhileRefunded = await handleFreightNotaCreate(
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
        await expectConflict(duplicateBWhileRefunded, 'sudah tertagih');

        console.log('Audit Runtime Mixed Billing Nota Finance Lock');
        console.log(`Dataset: ${process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'}`);
        console.log('');
        console.log('Semua langkah runtime mutation: OK');
        console.log(`- DO audit: ${doId}`);
        console.log(`- SJ audit: ${sjA}, ${sjB}, ${sjC}`);
        console.log('- Payment pada nota SJ A mengunci revise/delete SJ A saja');
        console.log('- SJ C tetap bisa dibuat nota baru untuk customer yang sama');
        console.log('- Refund invoice-overpaid pada nota SJ B mengunci revise/delete SJ B saja');
        console.log('- Coverage SJ A dan SJ B tetap terkunci dari duplikasi selama nota finance-locked');
    } finally {
        await cleanupAuditArtifacts().catch(() => undefined);
        await restoreBankBalance(bankSnapshot).catch(() => undefined);
        await restoreCompanyNumbering(companySnapshot).catch(() => undefined);
    }
}

main().catch(error => {
    console.error('Audit runtime mixed billing nota finance lock flow gagal:', error);
    process.exitCode = 1;
});
