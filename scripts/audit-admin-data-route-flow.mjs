import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/data/route.ts');
const source = fs.readFileSync(routePath, 'utf8');
const financeWorkflowPath = path.join(process.cwd(), 'src/lib/api/finance-workflows.ts');
const financeWorkflowSource = fs.readFileSync(financeWorkflowPath, 'utf8');
const accountingStatementsPath = path.join(process.cwd(), 'src/app/(admin)/accounting/statements/page.tsx');
const accountingStatementsSource = fs.readFileSync(accountingStatementsPath, 'utf8');
const accountingLedgerPath = path.join(process.cwd(), 'src/app/(admin)/accounting/ledger/page.tsx');
const accountingLedgerSource = fs.readFileSync(accountingLedgerPath, 'utf8');
const accountingPostingPath = path.join(process.cwd(), 'src/lib/api/accounting-posting.ts');
const accountingPostingSource = fs.readFileSync(accountingPostingPath, 'utf8');
const driverWorkflowPath = path.join(process.cwd(), 'src/lib/api/driver-workflows.ts');
const driverWorkflowSource = fs.readFileSync(driverWorkflowPath, 'utf8');
const documentStorePath = path.join(process.cwd(), 'src/lib/repositories/document-store.ts');
const documentStoreSource = fs.readFileSync(documentStorePath, 'utf8');
const reportsSupportPath = path.join(process.cwd(), 'src/lib/reports-support.ts');
const reportsSupportSource = fs.readFileSync(reportsSupportPath, 'utf8');
const accountingLedgerMigrationPath = path.join(process.cwd(), 'supabase/migrations/0015_relational_accounting_ledger.sql');
const accountingLedgerMigrationSource = fs.readFileSync(accountingLedgerMigrationPath, 'utf8').toLowerCase();
const accountingRevisionMigrationPath = path.join(process.cwd(), 'supabase/migrations/0016_accounting_journal_revision_unique_index.sql');
const accountingRevisionMigrationSource = fs.readFileSync(accountingRevisionMigrationPath, 'utf8').toLowerCase();

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function extractBalancedBlockFrom(sourceText, label, startNeedle) {
    const startIndex = sourceText.indexOf(startNeedle);
    assert(startIndex >= 0, `${label} tidak ditemukan.`);

    const openIndex = sourceText.indexOf('{', startIndex);
    assert(openIndex >= 0, `Block ${label} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < sourceText.length; index += 1) {
        const char = sourceText[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return sourceText.slice(openIndex, index + 1);
        }
    }

    throw new Error(`Block ${label} tidak tertutup.`);
}

function extractBalancedBlock(label, startNeedle) {
    return extractBalancedBlockFrom(source, label, startNeedle);
}

function assertActionMappedToUpdate(block, action) {
    assert(
        block.includes(`action === '${action}'`),
        `Action ${action} belum masuk getMutationPermissionAction sebagai update.`
    );
}

function assertDispatch(block, entity, action, handler) {
    const actionIndex = block.indexOf(`entity === '${entity}' && action === '${action}'`);
    assert(actionIndex >= 0, `Dispatch action ${entity}/${action} tidak ditemukan di POST /api/data.`);
    const handlerIndex = block.indexOf(handler, actionIndex);
    assert(handlerIndex >= 0, `Action ${entity}/${action} tidak mengarah ke ${handler}.`);

    const nextDeliveryOrderDispatchIndex = block.indexOf(`entity === '${entity}' && action ===`, actionIndex + 1);
    assert(
        nextDeliveryOrderDispatchIndex < 0 || handlerIndex < nextDeliveryOrderDispatchIndex,
        `Handler ${handler} untuk action ${entity}/${action} berada di luar block dispatch yang benar.`
    );
}

function extractSpecialPermissionBlock(block, action) {
    const marker = `entity === 'delivery-orders' && action === '${action}'`;
    const markerIndex = block.indexOf(marker);
    if (markerIndex < 0) return null;

    const ifStart = block.lastIndexOf('if', markerIndex);
    assert(ifStart >= 0, `Special permission ${action} tidak punya if block.`);
    const openIndex = block.indexOf('{', markerIndex);
    assert(openIndex >= 0, `Special permission ${action} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < block.length; index += 1) {
        const char = block[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return block.slice(ifStart, index + 1);
        }
    }

    throw new Error(`Special permission ${action} tidak tertutup.`);
}

function assertSpecialRoles(block, action, expectedRoles) {
    const permissionBlock = extractSpecialPermissionBlock(block, action);
    assert(permissionBlock, `Special permission ${action} tidak ditemukan.`);

    for (const role of expectedRoles) {
        assert(
            permissionBlock.includes(`role === '${role}'`),
            `Special permission ${action} belum mengizinkan ${role}.`
        );
    }

    for (const role of ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) {
        if (!expectedRoles.includes(role)) {
            assert(
                !permissionBlock.includes(`role === '${role}'`),
                `Special permission ${action} tidak boleh mengizinkan ${role}.`
            );
        }
    }
}

const mutationPermissionBlock = extractBalancedBlock(
    'getMutationPermissionAction',
    'function getMutationPermissionAction'
);
const specialPermissionBlock = extractBalancedBlock(
    'hasSpecialMutationPermission',
    'function hasSpecialMutationPermission'
);
const postBlock = extractBalancedBlock('POST /api/data', 'export async function POST');

const deliveryOrderActions = [
    {
        action: 'set-status',
        handler: 'handleDeliveryOrderStatusUpdate',
        specialRoles: null,
    },
    {
        action: 'assign-trip-resources',
        handler: 'handleDeliveryOrderTripResourceAssign',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'append-cargo-items',
        handler: 'handleDeliveryOrderAppendCargoItems',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-cargo-item',
        handler: 'handleDeliveryOrderCargoItemUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'remove-cargo-item',
        handler: 'handleDeliveryOrderCargoItemRemove',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-shipper-reference',
        handler: 'handleDeliveryOrderShipperReferenceUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'FINANCE'],
    },
    {
        action: 'reject-driver-status-request',
        handler: 'handleDeliveryOrderDriverStatusRequestReject',
        specialRoles: null,
    },
];

for (const item of deliveryOrderActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'delivery-orders', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );

    if (item.specialRoles) {
        assertSpecialRoles(specialPermissionBlock, item.action, item.specialRoles);
    } else {
        assert(
            !extractSpecialPermissionBlock(specialPermissionBlock, item.action),
            `Action ${item.action} seharusnya memakai permission module umum, bukan special role override.`
        );
    }
}

const freightNotaUpdateActions = [
    {
        action: 'update-with-items',
        handler: 'handleFreightNotaUpdate',
    },
    {
        action: 'update-pph23',
        handler: 'handleFreightNotaPph23Update',
    },
];

for (const item of freightNotaUpdateActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'freight-notas', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );
}

assert(
    postBlock.includes("session.role === 'DRIVER'") &&
        postBlock.includes('Driver tidak diizinkan mengakses API admin'),
    'POST /api/data harus tetap menolak role DRIVER karena driver memakai route /api/driver.'
);

const hardCodedReceivableLegacyUpdates = financeWorkflowSource.match(
    /updateDocument\([\s\S]{0,220}buildReceivablePatch\([\s\S]{0,220}['"]invoice['"]\)/g
) || [];
assert(
    hardCodedReceivableLegacyUpdates.length === 0,
    'Mutasi piutang tidak boleh hard-code updateDocument(..., buildReceivablePatch(...), "invoice") karena invoice aktif memakai freightNota.'
);
assert(
    financeWorkflowSource.includes('function getReceivableDocumentType') &&
        financeWorkflowSource.includes('async function updateReceivableSnapshot'),
    'Finance workflow harus memakai helper updateReceivableSnapshot agar tipe dokumen piutang mengikuti snapshot.'
);
const freightNotaWorkflowUpdateBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleFreightNotaUpdate',
    'export async function handleFreightNotaUpdate'
);
assert(
    freightNotaWorkflowUpdateBlock.includes('buildNotaRowsFromDeliveryOrder') &&
        freightNotaWorkflowUpdateBlock.includes('findBuiltNotaRowMatch') &&
        freightNotaWorkflowUpdateBlock.includes('hasDeliveryOrderBillableCargo') &&
        freightNotaWorkflowUpdateBlock.includes('belum punya realisasi drop yang bisa ditagihkan'),
    'Revisi invoice harus memvalidasi ulang realisasi drop billable seperti create invoice agar barang hold/return tidak bisa ditagihkan lewat edit.'
);
assert(
    (freightNotaWorkflowUpdateBlock.match(/buildFreightNotaCoverageRowKeys/g) || []).length >= 2,
    'Revisi invoice harus memakai coverage key yang sama dengan create invoice agar alias nomor SJ/header tidak bisa double billing.'
);
assert(
    !accountingStatementsSource.includes('toISOString().slice(0, 10)'),
    'Laporan keuangan tidak boleh memakai toISOString().slice(0, 10) untuk periode karena timezone bisa menggeser tanggal akhir bulan.'
);
assert(
    !accountingPostingSource.includes('new Date().toISOString().slice(0, 10)'),
    'Posting jurnal fallback harus memakai business date, bukan tanggal UTC dari toISOString().'
);
assert(
    accountingPostingSource.includes('const maxSequence = existingEntries.reduce') &&
        accountingPostingSource.includes('Math.max(max, sequence)') &&
        !accountingPostingSource.includes('const periodCount = existingEntries.filter'),
    'Nomor jurnal harus memakai suffix maksimum existing, bukan count row, agar void/delete cleanup tidak membuat nomor jurnal duplikat.'
);
assert(
    documentStoreSource.includes('relationalMaxNumericSuffixByPrefix') &&
        documentStoreSource.includes('const maxExistingSuffix') &&
        documentStoreSource.includes('Math.max(currentCounter, maxExistingSuffix) + 1') &&
        !documentStoreSource.includes('relationalCountByPrefix') &&
        documentStoreSource.includes("company.synced_at") &&
        documentStoreSource.includes("'is.null'"),
    'Nomor dokumen bisnis harus memakai suffix maksimum existing dan lock synced_at null-safe, bukan count row yang bisa membuat nomor duplikat setelah void/delete.'
);
assert(
    !accountingPostingSource.includes('deleteDocument('),
    'Posting jurnal tidak boleh menghapus line jurnal lama. Revisi jurnal harus void entry lama lalu post entry baru agar riwayat tetap utuh.'
);
assert(
    accountingPostingSource.includes('function isSamePostedJournal') &&
        accountingPostingSource.includes("const activeEntries = sourceEntries.filter(entry => entry.status !== 'VOID')") &&
        accountingPostingSource.includes('activeEntries.length === 1') &&
        accountingPostingSource.includes("status: 'VOID'"),
    'Posting jurnal harus idempotent: jika isi sama jangan repost, jika berubah void jurnal aktif lama lalu buat jurnal baru.'
);
assert(
    accountingPostingSource.includes("filter(entry => entry.status !== 'VOID')") &&
        accountingPostingSource.includes('Promise.all(existing.map'),
    'Void jurnal harus menutup semua jurnal aktif untuk source yang sama, bukan hanya hasil query pertama.'
);
assert(
    accountingPostingSource.includes('function resolveDriverVoucherIssuedAmount') &&
        accountingPostingSource.includes('const driverAdvanceCloseAmount = resolveDriverVoucherIssuedAmount') &&
        accountingPostingSource.includes('const additionalPaymentAmount = Math.max(-balance, 0)') &&
        !accountingPostingSource.includes('totalExpense + Math.max(balance, 0)') &&
        !accountingPostingSource.includes("lines.push({ account: 'driver_advance', debit: shortage"),
    'Settlement uang jalan harus menutup akun bon sebesar total uang diberikan dan mencatat kekurangan sebagai kredit kas/bank, bukan debit-kredit ulang di akun bon.'
);
const driverVoucherDisbursementDeleteBlock = extractBalancedBlockFrom(
    driverWorkflowSource,
    'handleDriverVoucherDisbursementDelete',
    'export async function handleDriverVoucherDisbursementDelete'
);
assert(
    driverVoucherDisbursementDeleteBlock.includes("status: 'VOID'") &&
        driverVoucherDisbursementDeleteBlock.includes('voidedAt: new Date().toISOString()') &&
        driverVoucherDisbursementDeleteBlock.includes('const remainingDisbursements = state.disbursements.filter') &&
        !driverVoucherDisbursementDeleteBlock.includes('getDriverVoucherIssuedAmount(state.voucher) - amount') &&
        driverVoucherDisbursementDeleteBlock.includes('reversalBankTransactionRef') &&
        driverVoucherDisbursementDeleteBlock.includes("type: 'CREDIT'") &&
        driverVoucherDisbursementDeleteBlock.includes('reversesBankTransactionRef') &&
        driverVoucherDisbursementDeleteBlock.includes("voidJournalEntryForSource(session, 'DRIVER_VOUCHER_DISBURSEMENT'") &&
        !driverVoucherDisbursementDeleteBlock.includes("deleteDocument(disbursementId, 'driverVoucherDisbursement')") &&
        !driverVoucherDisbursementDeleteBlock.includes('deleteDocument(disbursement.bankTransactionRef'),
    'Hapus top up uang jalan harus soft-void disbursement, membuat mutasi bank pembalik, dan void jurnal; bukan menghapus histori pencairan.'
);
assert(
    source.includes("entity === 'driver-voucher-disbursements'") &&
        source.includes("items = items.filter(item => item.status !== 'VOID');"),
    'GET driver-voucher-disbursements harus menyembunyikan disbursement VOID dari UI aktif.'
);
const freightNotaDeleteBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleFreightNotaDelete',
    'export async function handleFreightNotaDelete'
);
assert(
    freightNotaDeleteBlock.includes("status: 'VOID'") &&
        freightNotaDeleteBlock.includes('voidedAt: nowIso') &&
        freightNotaDeleteBlock.includes("voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'ISSUE')") &&
        freightNotaDeleteBlock.includes("voidJournalEntryForSource(session, 'FREIGHT_NOTA', id, 'PPH23')") &&
        !freightNotaDeleteBlock.includes("deleteDocument(id, 'freightNota')") &&
        !freightNotaDeleteBlock.includes("deleteDocument(item._id, 'freightNotaItem')"),
    'Hapus invoice harus soft-void invoice dan itemnya, lalu void jurnal; bukan menghapus histori invoice.'
);
assert(
    financeWorkflowSource.includes("existingNotaItems.filter(item => item.status !== 'VOID')") &&
        financeWorkflowSource.includes("item.status !== 'VOID' && itemDoRef && uniqueDoRefs.includes(itemDoRef)") &&
        source.includes("entity === 'freight-nota-items'") &&
        source.includes("items = items.filter(item => item.status !== 'VOID');"),
    'Item invoice VOID harus disembunyikan dari UI aktif dan tidak boleh ikut guard double billing.'
);
const receivableSnapshotBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'loadReceivableSnapshot',
    'async function loadReceivableSnapshot'
);
assert(
    receivableSnapshotBlock.includes("doc.status === 'VOID'") &&
        receivableSnapshotBlock.includes('Invoice yang sudah dibatalkan tidak bisa diproses lagi') &&
        receivableSnapshotBlock.includes('{ status: 409 }'),
    'Semua mutasi piutang harus menolak invoice VOID lewat loadReceivableSnapshot, bukan hanya menyembunyikan dari UI.'
);
const customerReceiptCreateBlock = extractBalancedBlockFrom(
    financeWorkflowSource,
    'handleCustomerReceiptCreate',
    'export async function handleCustomerReceiptCreate'
);
assert(
    !customerReceiptCreateBlock.includes("throw new Error('Semua alokasi penerimaan wajib memilih invoice')") &&
        !customerReceiptCreateBlock.includes("throw new Error('Nominal alokasi penerimaan tidak valid')") &&
        customerReceiptCreateBlock.includes("NextResponse.json({ error: 'Semua alokasi penerimaan wajib memilih invoice' }, { status: 400 })") &&
        customerReceiptCreateBlock.includes("NextResponse.json({ error: 'Nominal alokasi penerimaan tidak valid' }, { status: 400 })"),
    'Validasi alokasi customer receipt harus mengembalikan 400 JSON, bukan throw mentah yang bisa menjadi 500.'
);
assert(
    reportsSupportSource.includes('const activeFreightNotas = freightNotas.filter(item => item.status !== \'VOID\')') &&
        reportsSupportSource.includes('const totalNotaIssued = activeFreightNotas') &&
        reportsSupportSource.includes('const totalNotaOutstanding = activeFreightNotas'),
    'Laporan keuangan harus mengecualikan invoice VOID dari total terbit dan outstanding walaupun data dipanggil langsung.'
);
assert(
    reportsSupportSource.includes("function isInvoiceOverpaymentRefund") &&
        reportsSupportSource.includes("item => isInvoiceOverpaymentRefund(item) && inPeriod(item.date)") &&
        reportsSupportSource.includes("const revenueRefundRows = filteredOverpaymentRefunds.filter(isInvoiceOverpaymentRefund)"),
    'Laba/rugi hanya boleh mengurangi pendapatan dari refund overpaid invoice; refund sisa receipt belum teralokasi adalah arus kas, bukan koreksi pendapatan.'
);
for (const [label, migrationSource] of [
    ['schema awal accounting ledger', accountingLedgerMigrationSource],
    ['migration revisi accounting journal unique index', accountingRevisionMigrationSource],
]) {
    assert(
        migrationSource.includes('idx_journal_entries_source_event_unique') &&
            migrationSource.includes("where status = 'posted'") &&
            migrationSource.includes('source_type is not null') &&
            migrationSource.includes('source_ref is not null') &&
            migrationSource.includes('source_event is not null'),
        `Unique index source jurnal di ${label} harus hanya membatasi jurnal POSTED agar jurnal VOID tetap menjadi riwayat revisi.`
    );
}
assert(
    accountingRevisionMigrationSource.includes('drop index if exists public.idx_journal_entries_source_event_unique'),
    'Migration revisi jurnal harus drop unique index lama yang belum memfilter status POSTED.'
);
assert(
    accountingLedgerSource.includes('const periodLines') &&
        accountingLedgerSource.includes('const cumulativeLines') &&
        accountingLedgerSource.includes('buildProfitLossFromLedger(periodSummaries)') &&
        accountingLedgerSource.includes('buildBalanceSheetFromLedger(balanceSummaries)'),
    'Buku besar harus memisahkan mutasi periode untuk laba/rugi dan saldo kumulatif untuk neraca.'
);
const genericWorkflowPath = path.join(process.cwd(), 'src/lib/api/generic-workflows.ts');
const genericWorkflowSource = fs.readFileSync(genericWorkflowPath, 'utf8');
const protectedLedgerBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isProtectedLedgerEntity',
    'function isProtectedLedgerEntity'
);
const workflowCreateBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedCreateEntity',
    'function isWorkflowManagedCreateEntity'
);
const workflowUpdateBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedUpdateEntity',
    'function isWorkflowManagedUpdateEntity'
);
const workflowDeleteBlock = extractBalancedBlockFrom(
    genericWorkflowSource,
    'isWorkflowManagedDeleteEntity',
    'function isWorkflowManagedDeleteEntity'
);

for (const accountingEntity of ['chart-of-accounts', 'journal-entries', 'journal-lines', 'accounting-periods']) {
    assert(
        protectedLedgerBlock.includes(`entity === '${accountingEntity}'`),
        `Entity akuntansi ${accountingEntity} harus dilindungi dari mutation API umum.`
    );
}

for (const ledgerEntity of [
    'payments',
    'customer-receipts',
    'customer-overpayment-refunds',
    'invoice-adjustments',
    'incomes',
    'expenses',
    'bank-transactions',
    'purchase-payments',
]) {
    assert(
        protectedLedgerBlock.includes(`entity === '${ledgerEntity}'`),
        `Entity ledger ${ledgerEntity} harus ditolak dari update/delete generic.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'driver-voucher-items',
    'driver-voucher-disbursements',
    'purchases',
    'purchase-items',
    'freight-notas',
    'freight-nota-items',
]) {
    assert(
        workflowCreateBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh dibuat lewat generic create.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'driver-voucher-items',
    'driver-voucher-disbursements',
    'purchases',
    'purchase-items',
    'freight-notas',
    'freight-nota-items',
]) {
    assert(
        workflowUpdateBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh diubah lewat generic update.`
    );
}

for (const workflowEntity of [
    'stock-movements',
    'driver-vouchers',
    'purchase-payments',
    'purchases',
    'purchase-items',
    'freight-nota-items',
]) {
    assert(
        workflowDeleteBlock.includes(`entity === '${workflowEntity}'`),
        `Entity workflow ${workflowEntity} tidak boleh dihapus lewat generic delete.`
    );
}

for (const routeGuard of [
    ["payments", 'isCreateAction', 'handlePaymentCreate'],
    ["customer-receipts", 'isCreateAction', 'handleCustomerReceiptCreate'],
    ["expenses", null, 'handleExpenseCreate'],
    ["purchase-payments", "action === 'record-payment' || !action", 'handlePurchasePaymentCreate'],
    ["stock-movements", 'isCreateAction', 'handleStockMovementCreate'],
    ["driver-vouchers", null, 'handleDriverVoucherCreate'],
    ["driver-voucher-items", null, 'handleDriverVoucherItemCreate'],
]) {
    const [entity, condition, handler] = routeGuard;
    assert(postBlock.includes(`entity === '${entity}'`), `Route ${entity} belum punya guard khusus.`);
    if (condition) {
        assert(postBlock.includes(condition), `Route ${entity} belum membatasi condition ${condition}.`);
    }
    assert(postBlock.includes(handler), `Route ${entity} tidak mengarah ke ${handler}.`);
}

console.log(`Admin data route audit OK: ${deliveryOrderActions.length} delivery-order actions, ${freightNotaUpdateActions.length} freight-nota update actions, receivable document-type guard, accounting date/ledger guards, accounting revision history, accounting mutation guards, and ledger workflow route guards verified.`);
