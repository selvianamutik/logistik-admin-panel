import { loadScriptEnv, requireAnyEnv } from './_env.mjs';
import { isMissingSupabaseTableError } from './_supabase-relational.mjs';

loadScriptEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);

const REFERENCE_TABLES = {
    related_payment_ref: 'payments',
    related_receipt_ref: 'customer_receipts',
    related_expense_ref: 'expenses',
    related_voucher_ref: 'driver_vouchers',
    related_overpayment_refund_ref: 'customer_overpayment_refunds',
    related_purchase_payment_ref: 'purchase_payments',
};

const PRIMARY_REF_FIELDS = [
    'related_payment_ref',
    'related_receipt_ref',
    'related_expense_ref',
    'related_transfer_ref',
    'related_voucher_ref',
    'related_overpayment_refund_ref',
    'related_purchase_payment_ref',
];

function money(value) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function bankDelta(transaction) {
    const amount = money(transaction.amount);
    return transaction.type === 'DEBIT' || transaction.type === 'TRANSFER_OUT' ? -amount : amount;
}

function bankTransactionOrderKey(transaction) {
    return `${transaction.date || ''} ${transaction.document_created_at || ''} ${transaction.source_document_id || ''}`;
}

function groupBy(rows, selector) {
    const grouped = new Map();
    for (const row of rows) {
        const key = selector(row);
        if (!key) continue;
        const current = grouped.get(key) || [];
        current.push(row);
        grouped.set(key, current);
    }
    return grouped;
}

function sourceId(row, label) {
    const id = row?.source_document_id;
    if (!id) {
        throw new Error(`${label} tidak punya source_document_id, tidak aman untuk diubah otomatis.`);
    }
    return id;
}

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

async function fetchAll(table) {
    const pageSize = 1000;
    const rows = [];

    for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const response = await supabaseRequest(`${table}?select=*`, {
            headers: {
                Range: `${from}-${to}`,
            },
        });
        const batch = await response.json();
        rows.push(...batch);
        if (batch.length < pageSize) break;
    }

    return rows;
}

async function fetchOptional(table) {
    try {
        return await fetchAll(table);
    } catch (error) {
        if (isMissingSupabaseTableError(error)) {
            console.warn(`Skipping optional table ${table}: table not found`);
            return [];
        }
        throw error;
    }
}

async function patchBySourceId(table, id, patch) {
    await supabaseRequest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(patch),
    });
}

async function deleteBySourceId(table, id) {
    await supabaseRequest(`${table}?source_document_id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
            Prefer: 'return=minimal',
        },
    });
}

function mapBySourceId(rows) {
    return new Map(rows.filter(row => row.source_document_id).map(row => [row.source_document_id, row]));
}

function getPrimaryRefs(transaction) {
    return PRIMARY_REF_FIELDS
        .map(field => [field, transaction[field]])
        .filter(([, value]) => Boolean(value));
}

function getInvalidReason(transaction, refs, purchasesById) {
    if (!transaction.bank_account_ref) return 'bank_account_ref kosong';
    if (!refs.bankAccountsById.has(transaction.bank_account_ref)) return 'rekening bank tidak ditemukan';
    if (money(transaction.amount) <= 0) return 'nominal tidak valid';

    const primaryRefs = getPrimaryRefs(transaction);
    if (primaryRefs.length !== 1) return `harus punya tepat 1 referensi utama, sekarang ${primaryRefs.length}`;

    const [field, value] = primaryRefs[0];
    if (field !== 'related_purchase_payment_ref' && transaction.related_purchase_ref) {
        return 'related_purchase_ref hanya boleh untuk pembayaran supplier';
    }

    if (field === 'related_transfer_ref') {
        if (transaction.type !== 'TRANSFER_IN' && transaction.type !== 'TRANSFER_OUT') {
            return 'transfer harus bertipe TRANSFER_IN/TRANSFER_OUT';
        }
        return null;
    }

    const table = REFERENCE_TABLES[field];
    const relatedRows = refs.byTable.get(table) || new Map();
    if (!relatedRows.has(value)) return `referensi ${field} ${value} tidak ditemukan`;

    if (field === 'related_payment_ref' && transaction.type !== 'CREDIT') return 'payment harus CREDIT';
    if (field === 'related_receipt_ref' && transaction.type !== 'CREDIT') return 'receipt harus CREDIT';
    if (field === 'related_expense_ref' && transaction.type !== 'DEBIT') return 'expense harus DEBIT';
    if (field === 'related_voucher_ref' && transaction.type !== 'DEBIT' && transaction.type !== 'CREDIT') return 'bon harus DEBIT/CREDIT';
    if (field === 'related_overpayment_refund_ref' && transaction.type !== 'DEBIT') return 'refund overpayment harus DEBIT';

    if (field === 'related_purchase_payment_ref') {
        if (transaction.type !== 'DEBIT') return 'pembayaran supplier harus DEBIT';
        const purchasePayment = relatedRows.get(value);
        if (transaction.related_purchase_ref) {
            const purchase = purchasesById.get(transaction.related_purchase_ref);
            if (!purchase) return `purchase ${transaction.related_purchase_ref} tidak ditemukan`;
            if (purchasePayment.purchase_ref !== transaction.related_purchase_ref) {
                return 'related_purchase_ref tidak cocok dengan pembayaran supplier';
            }
        }
    }

    return null;
}

async function main() {
    const [
        bankAccounts,
        bankTransactions,
        purchases,
        ...referenceRows
    ] = await Promise.all([
        fetchAll('bank_accounts'),
        fetchAll('bank_transactions'),
        fetchOptional('purchases'),
        ...Object.values(REFERENCE_TABLES).map(fetchOptional),
    ]);

    const bankAccountsById = mapBySourceId(bankAccounts);
    const purchasesById = mapBySourceId(purchases);
    const byTable = new Map(Object.values(REFERENCE_TABLES).map((table, index) => [table, mapBySourceId(referenceRows[index])]));
    const refs = { bankAccountsById, byTable };
    const invalidReasons = new Map();

    for (const transaction of bankTransactions) {
        const reason = getInvalidReason(transaction, refs, purchasesById);
        if (reason) {
            invalidReasons.set(sourceId(transaction, 'Mutasi bank'), reason);
        }
    }

    const initiallyValidTransactions = bankTransactions.filter(row => !invalidReasons.has(sourceId(row, 'Mutasi bank')));
    const transferGroups = groupBy(initiallyValidTransactions.filter(row => row.related_transfer_ref), row => row.related_transfer_ref);
    for (const [transferRef, rows] of transferGroups.entries()) {
        const outs = rows.filter(row => row.type === 'TRANSFER_OUT');
        const ins = rows.filter(row => row.type === 'TRANSFER_IN');
        const validTransfer = (
            rows.length === 2
            && outs.length === 1
            && ins.length === 1
            && outs[0].bank_account_ref !== ins[0].bank_account_ref
            && money(outs[0].amount) === money(ins[0].amount)
        );
        if (!validTransfer) {
            for (const row of rows) {
                invalidReasons.set(sourceId(row, 'Mutasi transfer'), `transfer ${transferRef} tidak lengkap atau tidak seimbang`);
            }
        }
    }

    const invalidIds = [...invalidReasons.keys()];
    for (const id of invalidIds) {
        await deleteBySourceId('bank_transactions', id);
    }

    const retainedTransactions = bankTransactions.filter(row => !invalidReasons.has(sourceId(row, 'Mutasi bank')));
    const transactionsByBank = groupBy(retainedTransactions, row => row.bank_account_ref);
    let updatedTransactionBalances = 0;
    let updatedAccountBalances = 0;

    for (const account of bankAccounts) {
        const accountId = sourceId(account, 'Rekening bank');
        let runningBalance = money(account.initial_balance);
        const transactions = [...(transactionsByBank.get(accountId) || [])]
            .sort((left, right) => bankTransactionOrderKey(left).localeCompare(bankTransactionOrderKey(right)));

        for (const transaction of transactions) {
            runningBalance += bankDelta(transaction);
            if (money(transaction.balance_after) !== runningBalance) {
                await patchBySourceId('bank_transactions', sourceId(transaction, 'Mutasi bank'), {
                    balance_after: runningBalance,
                });
                updatedTransactionBalances += 1;
            }
        }

        if (money(account.current_balance) !== runningBalance) {
            await patchBySourceId('bank_accounts', accountId, {
                current_balance: runningBalance,
            });
            updatedAccountBalances += 1;
        }
    }

    console.log(JSON.stringify({
        deletedOrphanTransactions: invalidIds.length,
        deletedDetails: Object.fromEntries(invalidIds.map(id => [id, invalidReasons.get(id)])),
        updatedTransactionBalances,
        updatedAccountBalances,
        retainedTransactions: retainedTransactions.length,
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
