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
const accountingLedgerMigrationPath = path.join(process.cwd(), 'supabase/migrations/0015_relational_accounting_ledger.sql');
const accountingLedgerMigrationSource = fs.readFileSync(accountingLedgerMigrationPath, 'utf8').toLowerCase();
const accountingRevisionMigrationPath = path.join(process.cwd(), 'supabase/migrations/0016_accounting_journal_revision_unique_index.sql');
const accountingRevisionMigrationSource = fs.readFileSync(accountingRevisionMigrationPath, 'utf8').toLowerCase();

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function extractBalancedBlock(label, startNeedle) {
    const startIndex = source.indexOf(startNeedle);
    assert(startIndex >= 0, `${label} tidak ditemukan.`);

    const openIndex = source.indexOf('{', startIndex);
    assert(openIndex >= 0, `Block ${label} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(openIndex, index + 1);
        }
    }

    throw new Error(`Block ${label} tidak tertutup.`);
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
assert(
    !accountingStatementsSource.includes('toISOString().slice(0, 10)'),
    'Laporan keuangan tidak boleh memakai toISOString().slice(0, 10) untuk periode karena timezone bisa menggeser tanggal akhir bulan.'
);
assert(
    !accountingPostingSource.includes('new Date().toISOString().slice(0, 10)'),
    'Posting jurnal fallback harus memakai business date, bukan tanggal UTC dari toISOString().'
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
for (const accountingEntity of ['chart-of-accounts', 'journal-entries', 'journal-lines', 'accounting-periods']) {
    assert(
        genericWorkflowSource.includes(`entity === '${accountingEntity}'`),
        `Entity akuntansi ${accountingEntity} harus dilindungi dari mutation API umum.`
    );
}

console.log(`Admin data route audit OK: ${deliveryOrderActions.length} delivery-order actions, ${freightNotaUpdateActions.length} freight-nota update actions, receivable document-type guard, accounting date/ledger guards, accounting revision history, and accounting mutation guards verified.`);
