import {
    DEFAULT_CHART_OF_ACCOUNTS,
    buildDefaultChartOfAccountDocument,
    formatJournalNumber,
    normalizeLedgerAmount,
    type AccountingSystemKey,
} from '@/lib/accounting';
import {
    createDocument,
    deleteDocument,
    getAllDocuments,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import type {
    AccountingAccountType,
    BankAccount,
    ChartOfAccount,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    Expense,
    FreightNota,
    InvoiceAdjustment,
    JournalEntry,
    JournalLine,
    Payment,
    Purchase,
    PurchasePayment,
    StockMovement,
} from '@/lib/types';

import type { ApiSession, BankAccountSummary } from './data-helpers';

type JournalLineInput = {
    account: AccountingSystemKey;
    debit?: number;
    credit?: number;
    memo?: string;
    entityRef?: string;
    entityType?: string;
};

type JournalInput = {
    entryDate: string;
    memo: string;
    sourceType: string;
    sourceRef: string;
    sourceEvent: string;
    sourceNumber?: string;
    sourceLabel?: string;
    lines: JournalLineInput[];
};

type ReceiptAllocationPosting = {
    invoiceRef: string;
    amount: number;
    label?: string;
};

type DriverVoucherPosting = {
    _id: string;
    bonNumber?: string;
    issuedDate?: string;
    settledDate?: string;
    totalIssuedAmount?: number;
    initialCashGiven?: number;
    cashGiven?: number;
    driverFeeAmount?: number;
    totalSpent?: number;
    balance?: number;
    issueBankRef?: string;
    issueBankName?: string;
    settlementBankRef?: string;
    settlementBankName?: string;
};

let defaultAccountsEnsured = false;
let accountCacheBySystemKey: Map<AccountingSystemKey, ChartOfAccount> | null = null;

function isMissingAccountingStorageError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    return /chart_of_accounts|journal_entries|journal_lines|accounting_periods|Unsupported relational document type|Failed to create relational document/i.test(message);
}

function cleanLineAmount(value: unknown) {
    return Math.max(normalizeLedgerAmount(value), 0);
}

function resolveCashBankAccount(bankAccount?: Pick<BankAccount, 'accountType' | 'systemKey'> | BankAccountSummary | null): AccountingSystemKey {
    const accountType = typeof bankAccount?.accountType === 'string' ? bankAccount.accountType : '';
    const systemKey = typeof bankAccount?.systemKey === 'string' ? bankAccount.systemKey : '';
    return accountType === 'CASH' || systemKey === 'cash' || systemKey === 'cash_on_hand'
        ? 'cash_on_hand'
        : 'bank';
}

function resolveExpenseAccount(expense: Pick<Expense, 'categoryName' | 'relatedIncidentRef' | 'relatedMaintenanceRef' | 'voucherRef' | 'boronganRef'>): AccountingSystemKey {
    const category = String(expense.categoryName || '').toLowerCase();
    if (expense.relatedIncidentRef || /insiden|kecelakaan|santunan/.test(category)) return 'incident_expense';
    if (expense.relatedMaintenanceRef || /maintenance|servis|service|oli|ban|sparepart/.test(category)) return 'maintenance_expense';
    if (expense.voucherRef || /uang jalan|trip|solar|tol|parkir|makan|lain-lain/.test(category)) return 'trip_misc_expense';
    if (expense.boronganRef || /borongan|upah supir|upah driver/.test(category)) return 'driver_fee_expense';
    return 'operational_expense';
}

async function ensureDefaultAccounts() {
    if (defaultAccountsEnsured && accountCacheBySystemKey) {
        return accountCacheBySystemKey;
    }

    let existing = await getAllDocuments<ChartOfAccount>('chartOfAccount');
    let bySystemKey = new Map(existing.map(account => [account.systemKey, account]));
    let didCreateMissingAccount = false;

    for (const definition of DEFAULT_CHART_OF_ACCOUNTS) {
        const current = bySystemKey.get(definition.systemKey);
        if (current?._id) continue;
        await createDocument(buildDefaultChartOfAccountDocument(definition) as unknown as { _type: string; [key: string]: unknown });
        didCreateMissingAccount = true;
    }

    if (didCreateMissingAccount) {
        existing = await getAllDocuments<ChartOfAccount>('chartOfAccount');
        bySystemKey = new Map(existing.map(account => [account.systemKey, account]));
    }

    accountCacheBySystemKey = bySystemKey as Map<AccountingSystemKey, ChartOfAccount>;
    defaultAccountsEnsured = true;
    return accountCacheBySystemKey;
}

async function resolveAccount(systemKey: AccountingSystemKey) {
    const accountsBySystemKey = await ensureDefaultAccounts();
    const account = accountsBySystemKey.get(systemKey) || null;
    if (!account || account.active === false) {
        throw new Error(`Akun ${systemKey} tidak tersedia atau nonaktif`);
    }
    return account;
}

async function buildJournalNumber(entryDate: string, existing?: JournalEntry | null) {
    if (existing?.entryNumber) return existing.entryNumber;
    const monthPrefix = entryDate.replace(/-/g, '').slice(0, 6);
    const existingEntries = await getAllDocuments<JournalEntry>('journalEntry');
    const periodCount = existingEntries.filter(entry => entry.entryNumber?.startsWith(`JRN-${monthPrefix}-`)).length;
    return formatJournalNumber(entryDate, periodCount + 1);
}

export async function postJournalEntry(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: JournalInput,
) {
    try {
        const normalizedLines = input.lines
            .map(line => ({
                ...line,
                debit: cleanLineAmount(line.debit),
                credit: cleanLineAmount(line.credit),
            }))
            .filter(line => line.debit > 0 || line.credit > 0);

        if (normalizedLines.length === 0) return null;

        const totalDebit = normalizedLines.reduce((sum, line) => sum + line.debit, 0);
        const totalCredit = normalizedLines.reduce((sum, line) => sum + line.credit, 0);
        if (Math.abs(totalDebit - totalCredit) > 0.01) {
            throw new Error(`Jurnal tidak balance: debit ${totalDebit}, kredit ${totalCredit}`);
        }

        const existing = (await listDocumentsByFilter<JournalEntry>('journalEntry', {
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            sourceEvent: input.sourceEvent,
        }))[0] || null;

        const entryId = existing?._id || `journal-${crypto.randomUUID()}`;
        const entryNumber = await buildJournalNumber(input.entryDate, existing);
        const now = new Date().toISOString();
        const entryDoc: JournalEntry = {
            _id: entryId,
            _type: 'journalEntry',
            entryNumber,
            entryDate: input.entryDate,
            memo: input.memo,
            sourceType: input.sourceType,
            sourceRef: input.sourceRef,
            sourceEvent: input.sourceEvent,
            sourceNumber: input.sourceNumber,
            sourceLabel: input.sourceLabel,
            status: 'POSTED',
            totalDebit,
            totalCredit,
            postedAt: existing?.postedAt || now,
            postedBy: existing?.postedBy || session._id,
            postedByName: existing?.postedByName || session.name,
        };

        if (existing) {
            const oldLines = await listDocumentsByFilter<JournalLine>('journalLine', { journalEntryRef: entryId });
            await Promise.all(oldLines.map(line => deleteDocument(line._id, 'journalLine')));
            await updateDocument(entryId, entryDoc as unknown as Record<string, unknown>, 'journalEntry');
        } else {
            await createDocument(entryDoc as unknown as { _type: string; [key: string]: unknown });
        }

        const accountCache = new Map<AccountingSystemKey, ChartOfAccount>();
        for (const [index, line] of normalizedLines.entries()) {
            let account = accountCache.get(line.account);
            if (!account) {
                account = await resolveAccount(line.account);
                accountCache.set(line.account, account);
            }
            const lineDoc: JournalLine = {
                _id: `journal-line-${crypto.randomUUID()}`,
                _type: 'journalLine',
                journalEntryRef: entryId,
                lineNumber: index + 1,
                accountRef: account._id,
                accountCode: account.code,
                accountName: account.name,
                accountType: account.accountType as AccountingAccountType,
                debit: line.debit,
                credit: line.credit,
                memo: line.memo,
                entityRef: line.entityRef,
                entityType: line.entityType,
            };
            await createDocument(lineDoc as unknown as { _type: string; [key: string]: unknown });
        }

        return entryDoc;
    } catch (error) {
        if (isMissingAccountingStorageError(error)) {
            console.warn('[accounting] jurnal dilewati karena tabel akuntansi belum tersedia', error);
            return null;
        }
        throw error;
    }
}

export async function voidJournalEntryForSource(
    session: Pick<ApiSession, '_id' | 'name'>,
    sourceType: string,
    sourceRef: string,
    sourceEvent: string,
) {
    try {
        const existing = (await listDocumentsByFilter<JournalEntry>('journalEntry', {
            sourceType,
            sourceRef,
            sourceEvent,
        }))[0] || null;
        if (!existing || existing.status === 'VOID') return;
        await updateDocument(existing._id, {
            status: 'VOID',
            voidedAt: new Date().toISOString(),
            voidedBy: session._id,
            voidedByName: session.name,
        }, 'journalEntry');
    } catch (error) {
        if (isMissingAccountingStorageError(error)) return;
        throw error;
    }
}

export async function postFreightNotaIssueJournal(session: Pick<ApiSession, '_id' | 'name'>, nota: FreightNota) {
    const grossAmount = cleanLineAmount(nota.totalAmount);
    await postJournalEntry(session, {
        entryDate: nota.issueDate,
        memo: `Invoice ongkos ${nota.notaDisplayNumber || nota.notaNumber}`,
        sourceType: 'FREIGHT_NOTA',
        sourceRef: nota._id,
        sourceEvent: 'ISSUE',
        sourceNumber: nota.notaNumber,
        sourceLabel: nota.customerName,
        lines: [
            { account: 'accounts_receivable', debit: grossAmount, entityRef: nota.customerRef, entityType: 'customer' },
            { account: 'freight_revenue', credit: grossAmount, entityRef: nota._id, entityType: 'freightNota' },
        ],
    });
    const pph23Amount = cleanLineAmount(nota.pph23Amount);
    if (pph23Amount > 0) {
        await postJournalEntry(session, {
            entryDate: nota.issueDate,
            memo: `PPh 23 dipotong invoice ${nota.notaDisplayNumber || nota.notaNumber}`,
            sourceType: 'FREIGHT_NOTA',
            sourceRef: nota._id,
            sourceEvent: 'PPH23',
            sourceNumber: nota.notaNumber,
            sourceLabel: nota.customerName,
            lines: [
                { account: 'prepaid_pph23', debit: pph23Amount, entityRef: nota._id, entityType: 'freightNota' },
                { account: 'accounts_receivable', credit: pph23Amount, entityRef: nota.customerRef, entityType: 'customer' },
            ],
        });
    } else {
        await voidJournalEntryForSource(session, 'FREIGHT_NOTA', nota._id, 'PPH23');
    }
}

export async function postPaymentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    payment: Payment,
    bankAccount?: BankAccountSummary | null,
    sourceLabel?: string,
) {
    const amount = cleanLineAmount(payment.amount);
    await postJournalEntry(session, {
        entryDate: payment.date,
        memo: `Pembayaran invoice ${sourceLabel || payment.invoiceRef}`,
        sourceType: 'PAYMENT',
        sourceRef: payment._id,
        sourceEvent: 'RECEIVE',
        sourceNumber: payment.receiptNumber,
        sourceLabel,
        lines: [
            { account: resolveCashBankAccount(bankAccount), debit: amount, entityRef: payment.bankAccountRef, entityType: 'bankAccount' },
            { account: 'accounts_receivable', credit: amount, entityRef: payment.invoiceRef, entityType: 'invoice' },
        ],
    });
}

export async function postCustomerReceiptJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    receipt: CustomerReceipt,
    bankAccount: BankAccountSummary | null | undefined,
    allocations: ReceiptAllocationPosting[],
) {
    const totalAmount = cleanLineAmount(receipt.totalAmount);
    await postJournalEntry(session, {
        entryDate: receipt.date,
        memo: `Penerimaan customer ${receipt.receiptNumber}`,
        sourceType: 'CUSTOMER_RECEIPT',
        sourceRef: receipt._id,
        sourceEvent: 'RECEIVE',
        sourceNumber: receipt.receiptNumber,
        sourceLabel: receipt.customerName,
        lines: [
            { account: resolveCashBankAccount(bankAccount), debit: totalAmount, entityRef: receipt.bankAccountRef, entityType: 'bankAccount' },
            { account: 'customer_deposit', credit: totalAmount, entityRef: receipt.customerRef, entityType: 'customer' },
        ],
    });

    for (const allocation of allocations) {
        const amount = cleanLineAmount(allocation.amount);
        await postJournalEntry(session, {
            entryDate: receipt.date,
            memo: `Alokasi penerimaan ${receipt.receiptNumber} ke invoice ${allocation.label || allocation.invoiceRef}`,
            sourceType: 'CUSTOMER_RECEIPT',
            sourceRef: `${receipt._id}:${allocation.invoiceRef}`,
            sourceEvent: 'ALLOCATE',
            sourceNumber: receipt.receiptNumber,
            sourceLabel: allocation.label,
            lines: [
                { account: 'customer_deposit', debit: amount, entityRef: receipt.customerRef, entityType: 'customer' },
                { account: 'accounts_receivable', credit: amount, entityRef: allocation.invoiceRef, entityType: 'invoice' },
            ],
        });
    }
}

export async function postInvoiceAdjustmentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    adjustment: InvoiceAdjustment,
    label?: string,
) {
    const amount = cleanLineAmount(adjustment.amount);
    await postJournalEntry(session, {
        entryDate: adjustment.date,
        memo: `Klaim/potongan invoice ${label || adjustment.invoiceRef}`,
        sourceType: 'INVOICE_ADJUSTMENT',
        sourceRef: adjustment._id,
        sourceEvent: 'APPROVE',
        sourceLabel: label || adjustment.customerName,
        lines: [
            { account: 'sales_deduction', debit: amount, entityRef: adjustment.invoiceRef, entityType: 'invoice' },
            { account: 'accounts_receivable', credit: amount, entityRef: adjustment.customerRef, entityType: 'customer' },
        ],
    });
}

export async function postCustomerOverpaymentRefundJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    refund: CustomerOverpaymentRefund,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(refund.amount);
    await postJournalEntry(session, {
        entryDate: refund.date,
        memo: `Refund kelebihan bayar customer ${refund.customerName || ''}`.trim(),
        sourceType: 'CUSTOMER_OVERPAYMENT_REFUND',
        sourceRef: refund._id,
        sourceEvent: 'REFUND',
        sourceNumber: refund.sourceReceiptNumber || refund.sourceInvoiceNumber,
        sourceLabel: refund.customerName,
        lines: [
            { account: 'customer_deposit', debit: amount, entityRef: refund.customerRef, entityType: 'customer' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: refund.bankAccountRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postExpenseJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    expense: Expense,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(expense.amount);
    await postJournalEntry(session, {
        entryDate: expense.date,
        memo: expense.description || expense.note || `Pengeluaran ${expense.categoryName || ''}`.trim(),
        sourceType: 'EXPENSE',
        sourceRef: expense._id,
        sourceEvent: 'CREATE',
        sourceLabel: expense.categoryName,
        lines: [
            {
                account: resolveExpenseAccount(expense),
                debit: amount,
                entityRef: expense.relatedVehicleRef || expense.voucherRef || expense.relatedIncidentRef || expense.relatedMaintenanceRef,
                entityType: expense.relatedVehicleRef ? 'vehicle' : expense.voucherRef ? 'driverVoucher' : undefined,
            },
            {
                account: bankAccount ? resolveCashBankAccount(bankAccount) : 'accrued_expense',
                credit: amount,
                entityRef: expense.bankAccountRef,
                entityType: bankAccount ? 'bankAccount' : undefined,
            },
        ],
    });
}

export async function postBankTransferJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: {
        transferId: string;
        date: string;
        amount: number;
        fromAccount: BankAccountSummary;
        toAccount: BankAccountSummary;
    },
) {
    const amount = cleanLineAmount(input.amount);
    await postJournalEntry(session, {
        entryDate: input.date,
        memo: `Transfer ${input.fromAccount.bankName} ke ${input.toAccount.bankName}`,
        sourceType: 'BANK_TRANSFER',
        sourceRef: input.transferId,
        sourceEvent: 'TRANSFER',
        sourceLabel: `${input.fromAccount.bankName} -> ${input.toAccount.bankName}`,
        lines: [
            { account: resolveCashBankAccount(input.toAccount), debit: amount, entityRef: input.toAccount._id, entityType: 'bankAccount' },
            { account: resolveCashBankAccount(input.fromAccount), credit: amount, entityRef: input.fromAccount._id, entityType: 'bankAccount' },
        ],
    });
}

export async function postPurchaseReceiptJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    purchase: Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierRef' | 'supplierName'>,
    receiptDate: string,
    receivedValue: number,
    receiptBatchRef?: string,
) {
    const amount = cleanLineAmount(receivedValue);
    const batchRef = receiptBatchRef || `${purchase._id}:${receiptDate}`;
    await postJournalEntry(session, {
        entryDate: receiptDate,
        memo: `Penerimaan barang pembelian ${purchase.purchaseNumber}`,
        sourceType: 'PURCHASE',
        sourceRef: batchRef,
        sourceEvent: 'RECEIVE',
        sourceNumber: purchase.purchaseNumber,
        sourceLabel: purchase.supplierName,
        lines: [
            { account: 'inventory', debit: amount, entityRef: purchase._id, entityType: 'purchase' },
            { account: 'accounts_payable', credit: amount, entityRef: purchase.supplierRef, entityType: 'supplier' },
        ],
    });
}

export async function postPurchasePaymentJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    payment: PurchasePayment,
    bankAccount: BankAccountSummary,
) {
    const amount = cleanLineAmount(payment.amount);
    await postJournalEntry(session, {
        entryDate: payment.date,
        memo: `Pembayaran supplier ${payment.purchaseNumber || payment.purchaseRef}`,
        sourceType: 'PURCHASE_PAYMENT',
        sourceRef: payment._id,
        sourceEvent: 'PAY',
        sourceNumber: payment.purchaseNumber,
        sourceLabel: payment.supplierName,
        lines: [
            { account: 'accounts_payable', debit: amount, entityRef: payment.supplierRef, entityType: 'supplier' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: payment.bankAccountRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postStockMovementJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    movement: StockMovement,
    unitValue: number,
) {
    const shouldPostInventoryUsage =
        movement.sourceType === 'MANUAL_IN' ||
        movement.sourceType === 'MANUAL_OUT' ||
        movement.sourceType === 'MAINTENANCE_USAGE';
    if (!shouldPostInventoryUsage) return;
    const amount = cleanLineAmount(unitValue * cleanLineAmount(movement.quantity));
    if (amount <= 0) return;

    const isStockIn = movement.type === 'IN' && movement.sourceType === 'MANUAL_IN';
    await postJournalEntry(session, {
        entryDate: movement.movementDate,
        memo: `${isStockIn ? 'Penyesuaian stok masuk' : 'Pemakaian stok keluar'} ${movement.itemName || movement.itemCode || movement._id}`,
        sourceType: 'STOCK_MOVEMENT',
        sourceRef: movement._id,
        sourceEvent: movement.sourceType,
        sourceNumber: movement.itemCode,
        sourceLabel: movement.itemName,
        lines: isStockIn
            ? [
                { account: 'inventory', debit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
                { account: 'inventory_usage_expense', credit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
            ]
            : [
                { account: 'inventory_usage_expense', debit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
                { account: 'inventory', credit: amount, entityRef: movement.warehouseItemRef, entityType: 'warehouseItem' },
            ],
    });
}

export async function postDriverVoucherIssueJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    voucher: DriverVoucherPosting,
    bankAccount?: BankAccountSummary | null,
) {
    const amount = cleanLineAmount(voucher.cashGiven || voucher.initialCashGiven || voucher.totalIssuedAmount);
    await postJournalEntry(session, {
        entryDate: voucher.issuedDate || new Date().toISOString().slice(0, 10),
        memo: `Pencairan uang jalan ${voucher.bonNumber || voucher._id}`,
        sourceType: 'DRIVER_VOUCHER',
        sourceRef: voucher._id,
        sourceEvent: 'ISSUE',
        sourceNumber: voucher.bonNumber,
        sourceLabel: voucher.issueBankName,
        lines: [
            { account: 'driver_advance', debit: amount, entityRef: voucher._id, entityType: 'driverVoucher' },
            { account: resolveCashBankAccount(bankAccount), credit: amount, entityRef: voucher.issueBankRef, entityType: 'bankAccount' },
        ],
    });
}

export async function postDriverVoucherTopUpJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    input: {
        voucherId: string;
        bonNumber?: string;
        date: string;
        amount: number;
        disbursementId: string;
        bankAccount: BankAccountSummary;
    },
) {
    const amount = cleanLineAmount(input.amount);
    await postJournalEntry(session, {
        entryDate: input.date,
        memo: `Tambahan uang jalan ${input.bonNumber || input.voucherId}`,
        sourceType: 'DRIVER_VOUCHER_DISBURSEMENT',
        sourceRef: input.disbursementId,
        sourceEvent: 'TOP_UP',
        sourceNumber: input.bonNumber,
        lines: [
            { account: 'driver_advance', debit: amount, entityRef: input.voucherId, entityType: 'driverVoucher' },
            { account: resolveCashBankAccount(input.bankAccount), credit: amount, entityRef: input.bankAccount._id, entityType: 'bankAccount' },
        ],
    });
}

export async function postDriverVoucherSettlementJournal(
    session: Pick<ApiSession, '_id' | 'name'>,
    voucher: DriverVoucherPosting,
    settlementBank?: BankAccountSummary | null,
) {
    const tripMiscAmount = cleanLineAmount(voucher.totalSpent);
    const driverFeeAmount = cleanLineAmount(voucher.driverFeeAmount);
    const totalExpense = tripMiscAmount + driverFeeAmount;
    const balance = normalizeLedgerAmount(voucher.balance);
    const lines: JournalLineInput[] = [];

    if (tripMiscAmount > 0) lines.push({ account: 'trip_misc_expense', debit: tripMiscAmount, entityRef: voucher._id, entityType: 'driverVoucher' });
    if (driverFeeAmount > 0) lines.push({ account: 'driver_fee_expense', debit: driverFeeAmount, entityRef: voucher._id, entityType: 'driverVoucher' });
    if (balance > 0) lines.push({ account: resolveCashBankAccount(settlementBank), debit: balance, entityRef: voucher.settlementBankRef, entityType: 'bankAccount' });

    lines.push({ account: 'driver_advance', credit: totalExpense + Math.max(balance, 0), entityRef: voucher._id, entityType: 'driverVoucher' });

    if (balance < 0) {
        const shortage = Math.abs(balance);
        lines.push({ account: 'driver_advance', debit: shortage, entityRef: voucher._id, entityType: 'driverVoucher' });
        lines.push({ account: resolveCashBankAccount(settlementBank), credit: shortage, entityRef: voucher.settlementBankRef, entityType: 'bankAccount' });
    }

    await postJournalEntry(session, {
        entryDate: voucher.settledDate || new Date().toISOString().slice(0, 10),
        memo: `Settlement uang jalan ${voucher.bonNumber || voucher._id}`,
        sourceType: 'DRIVER_VOUCHER',
        sourceRef: voucher._id,
        sourceEvent: 'SETTLE',
        sourceNumber: voucher.bonNumber,
        sourceLabel: voucher.settlementBankName || voucher.issueBankName,
        lines,
    });
}
