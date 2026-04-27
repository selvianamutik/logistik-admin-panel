import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    getAllDocuments,
} from '../src/lib/repositories/document-store';
import {
    postBankTransferJournal,
    postCustomerOverpaymentRefundJournal,
    postCustomerReceiptJournal,
    postDriverVoucherIssueJournal,
    postDriverVoucherSettlementJournal,
    postDriverVoucherTopUpJournal,
    postExpenseJournal,
    postFreightNotaIssueJournal,
    postInvoiceAdjustmentJournal,
    postLegacyInvoiceIssueJournal,
    postPaymentJournal,
    postPurchasePaymentJournal,
    postPurchaseReceiptJournal,
    postStockMovementJournal,
    voidJournalEntryForSource,
} from '../src/lib/api/accounting-posting';
import type { ApiSession, BankAccountSummary } from '../src/lib/api/data-helpers';
import type {
    BankAccount,
    BankTransaction,
    CustomerOverpaymentRefund,
    CustomerReceipt,
    DriverVoucher,
    DriverVoucherDisbursement,
    Expense,
    FreightNota,
    Invoice,
    InvoiceAdjustment,
    Payment,
    Purchase,
    PurchaseItem,
    PurchasePayment,
    StockMovement,
    WarehouseItem,
} from '../src/lib/types';

const BACKFILL_SESSION: Pick<ApiSession, '_id' | 'name'> = {
    _id: 'system-accounting-backfill',
    name: 'System Accounting Backfill',
};

type CounterKey =
    | 'freightNotas'
    | 'legacyInvoices'
    | 'directPayments'
    | 'customerReceipts'
    | 'invoiceAdjustments'
    | 'overpaymentRefunds'
    | 'standaloneExpenses'
    | 'purchaseReceipts'
    | 'purchasePayments'
    | 'stockMovements'
    | 'driverVoucherIssues'
    | 'driverVoucherTopUps'
    | 'driverVoucherSettlements'
    | 'bankTransfers'
    | 'voidedStaleEntries'
    | 'skipped';

const counters = new Map<CounterKey, number>();
const warnings: string[] = [];

function inc(key: CounterKey, amount = 1) {
    counters.set(key, (counters.get(key) || 0) + amount);
}

function positiveNumber(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.max(Math.round(numeric), 0) : 0;
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function mapById<T extends { _id: string }>(items: T[]) {
    return new Map(items.map(item => [item._id, item]));
}

function bankSummary(bank?: BankAccount | null): BankAccountSummary | null {
    if (!bank) return null;
    return {
        _id: bank._id,
        currentBalance: positiveNumber(bank.currentBalance),
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        accountType: bank.accountType,
        systemKey: bank.systemKey,
        accountHolder: bank.accountHolder,
        active: bank.active,
    };
}

function invoiceLabel(invoice?: Pick<FreightNota, 'notaDisplayNumber' | 'notaNumber' | 'customerName'> | Pick<Invoice, 'invoiceNumber' | 'customerName'> | null) {
    if (!invoice) return undefined;
    if ('notaDisplayNumber' in invoice || 'notaNumber' in invoice) {
        const nota = invoice as Pick<FreightNota, 'notaDisplayNumber' | 'notaNumber' | 'customerName'>;
        return [nota.notaDisplayNumber || nota.notaNumber, nota.customerName].filter(Boolean).join(' - ') || undefined;
    }
    return [invoice.invoiceNumber, invoice.customerName].filter(Boolean).join(' - ') || undefined;
}

function purchaseReceiptKey(movement: StockMovement) {
    return `${movement.sourceRef || ''}::${movement.movementDate || ''}`;
}

async function postWithContext(label: string, action: () => Promise<unknown>) {
    try {
        await action();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${label}: ${message}`);
    }
}

async function main() {
    const [
        freightNotas,
        legacyInvoices,
        payments,
        customerReceipts,
        invoiceAdjustments,
        overpaymentRefunds,
        expenses,
        bankAccounts,
        purchases,
        purchaseItems,
        purchasePayments,
        stockMovements,
        warehouseItems,
        driverVouchers,
        driverVoucherDisbursements,
        bankTransactions,
    ] = await Promise.all([
        getAllDocuments<FreightNota>('freightNota'),
        getAllDocuments<Invoice>('invoice'),
        getAllDocuments<Payment>('payment'),
        getAllDocuments<CustomerReceipt>('customerReceipt'),
        getAllDocuments<InvoiceAdjustment>('invoiceAdjustment'),
        getAllDocuments<CustomerOverpaymentRefund>('customerOverpaymentRefund'),
        getAllDocuments<Expense>('expense'),
        getAllDocuments<BankAccount>('bankAccount'),
        getAllDocuments<Purchase>('purchase'),
        getAllDocuments<PurchaseItem>('purchaseItem'),
        getAllDocuments<PurchasePayment>('purchasePayment'),
        getAllDocuments<StockMovement>('stockMovement'),
        getAllDocuments<WarehouseItem>('warehouseItem'),
        getAllDocuments<DriverVoucher>('driverVoucher'),
        getAllDocuments<DriverVoucherDisbursement>('driverVoucherDisbursement'),
        getAllDocuments<BankTransaction>('bankTransaction'),
    ]);

    const banksById = mapById(bankAccounts);
    const freightNotaById = mapById(freightNotas);
    const legacyInvoiceById = mapById(legacyInvoices);
    const purchasesById = mapById(purchases);
    const warehouseItemsById = mapById(warehouseItems);

    for (const nota of freightNotas) {
        if (nota.status === 'VOID') {
            await Promise.all([
                voidJournalEntryForSource(BACKFILL_SESSION, 'FREIGHT_NOTA', nota._id, 'ISSUE'),
                voidJournalEntryForSource(BACKFILL_SESSION, 'FREIGHT_NOTA', nota._id, 'PPH23'),
            ]);
            inc('skipped');
            continue;
        }
        if (positiveNumber(nota.totalAmount) <= 0 && positiveNumber(nota.pph23Amount) <= 0) {
            inc('skipped');
            continue;
        }
        await postWithContext(`invoice ongkos ${nota.notaNumber || nota._id}`, () =>
            postFreightNotaIssueJournal(BACKFILL_SESSION, nota)
        );
        inc('freightNotas');
    }

    for (const invoice of legacyInvoices) {
        if (positiveNumber(invoice.totalAmount) <= 0 && positiveNumber(invoice.pph23Amount) <= 0) {
            inc('skipped');
            continue;
        }
        await postWithContext(`invoice legacy ${invoice.invoiceNumber || invoice._id}`, () =>
            postLegacyInvoiceIssueJournal(BACKFILL_SESSION, invoice)
        );
        inc('legacyInvoices');
    }

    for (const payment of payments) {
        if (payment.receiptRef) {
            await voidJournalEntryForSource(BACKFILL_SESSION, 'PAYMENT', payment._id, 'RECEIVE');
            inc('voidedStaleEntries');
            continue;
        }
        if (positiveNumber(payment.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const bank = bankSummary(payment.bankAccountRef ? banksById.get(payment.bankAccountRef) : null);
        const source = freightNotaById.get(payment.invoiceRef) || legacyInvoiceById.get(payment.invoiceRef) || null;
        await postWithContext(`pembayaran ${payment._id}`, () =>
            postPaymentJournal(BACKFILL_SESSION, payment, bank, invoiceLabel(source))
        );
        inc('directPayments');
    }

    const paymentsByReceiptRef = payments.reduce((acc, payment) => {
        if (!payment.receiptRef) return acc;
        const list = acc.get(payment.receiptRef) || [];
        list.push(payment);
        acc.set(payment.receiptRef, list);
        return acc;
    }, new Map<string, Payment[]>());

    for (const receipt of customerReceipts) {
        if (positiveNumber(receipt.totalAmount) <= 0) {
            inc('skipped');
            continue;
        }
        const allocations = (paymentsByReceiptRef.get(receipt._id) || [])
            .filter(payment => positiveNumber(payment.amount) > 0)
            .map(payment => {
                const source = freightNotaById.get(payment.invoiceRef) || legacyInvoiceById.get(payment.invoiceRef) || null;
                return {
                    invoiceRef: payment.invoiceRef,
                    amount: positiveNumber(payment.amount),
                    label: invoiceLabel(source),
                };
            });
        const bank = bankSummary(receipt.bankAccountRef ? banksById.get(receipt.bankAccountRef) : null);
        await postWithContext(`penerimaan customer ${receipt.receiptNumber || receipt._id}`, () =>
            postCustomerReceiptJournal(BACKFILL_SESSION, receipt, bank, allocations)
        );
        inc('customerReceipts');
    }

    for (const adjustment of invoiceAdjustments) {
        if (adjustment.status === 'VOID') {
            await voidJournalEntryForSource(BACKFILL_SESSION, 'INVOICE_ADJUSTMENT', adjustment._id, 'APPROVE');
            inc('voidedStaleEntries');
            continue;
        }
        if (positiveNumber(adjustment.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const source = freightNotaById.get(adjustment.invoiceRef) || legacyInvoiceById.get(adjustment.invoiceRef) || null;
        await postWithContext(`klaim/potongan ${adjustment._id}`, () =>
            postInvoiceAdjustmentJournal(BACKFILL_SESSION, adjustment, invoiceLabel(source))
        );
        inc('invoiceAdjustments');
    }

    for (const refund of overpaymentRefunds) {
        if (positiveNumber(refund.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const bank = bankSummary(refund.bankAccountRef ? banksById.get(refund.bankAccountRef) : null);
        await postWithContext(`refund overpayment ${refund._id}`, () =>
            postCustomerOverpaymentRefundJournal(BACKFILL_SESSION, refund, bank)
        );
        inc('overpaymentRefunds');
    }

    for (const expense of expenses) {
        if (expense.voucherRef) {
            await voidJournalEntryForSource(BACKFILL_SESSION, 'EXPENSE', expense._id, 'CREATE');
            inc('voidedStaleEntries');
            continue;
        }
        if (positiveNumber(expense.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const bank = bankSummary(expense.bankAccountRef ? banksById.get(expense.bankAccountRef) : null);
        await postWithContext(`pengeluaran ${expense._id}`, () =>
            postExpenseJournal(BACKFILL_SESSION, expense, bank)
        );
        inc('standaloneExpenses');
    }

    const purchaseItemsByPurchaseAndWarehouse = purchaseItems.reduce((acc, item) => {
        const key = `${item.purchaseRef}::${item.warehouseItemRef}`;
        const list = acc.get(key) || [];
        list.push(item);
        acc.set(key, list);
        return acc;
    }, new Map<string, PurchaseItem[]>());

    const purchaseReceiptGroups = stockMovements
        .filter(movement => movement.sourceType === 'PURCHASE_RECEIPT' && movement.sourceRef && movement.movementDate)
        .reduce((acc, movement) => {
            const key = purchaseReceiptKey(movement);
            const list = acc.get(key) || [];
            list.push(movement);
            acc.set(key, list);
            return acc;
        }, new Map<string, StockMovement[]>());

    for (const [key, movements] of purchaseReceiptGroups.entries()) {
        const [purchaseRef, receiptDate] = key.split('::');
        const purchase = purchasesById.get(purchaseRef);
        if (!purchase || purchase.status === 'CANCELLED') {
            inc('skipped');
            continue;
        }
        let receivedValue = 0;
        for (const movement of movements) {
            const matchingItems = purchaseItemsByPurchaseAndWarehouse.get(`${purchaseRef}::${movement.warehouseItemRef}`) || [];
            const unitPrice = positiveNumber(matchingItems[0]?.unitPrice);
            receivedValue += positiveNumber(movement.quantity) * unitPrice;
        }
        if (receivedValue <= 0) {
            inc('skipped');
            continue;
        }
        const batchRef = movements
            .map(movement => movement._id)
            .sort()
            .join('|');
        await postWithContext(`penerimaan pembelian ${purchase.purchaseNumber || purchase._id}`, () =>
            postPurchaseReceiptJournal(BACKFILL_SESSION, purchase, receiptDate, receivedValue, batchRef)
        );
        inc('purchaseReceipts');
    }

    for (const payment of purchasePayments) {
        if (positiveNumber(payment.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const bank = bankSummary(payment.bankAccountRef ? banksById.get(payment.bankAccountRef) : null);
        if (!bank) {
            warnings.push(`Lewati pembayaran supplier ${payment._id}: rekening tidak ditemukan`);
            inc('skipped');
            continue;
        }
        await postWithContext(`pembayaran supplier ${payment.purchaseNumber || payment._id}`, () =>
            postPurchasePaymentJournal(BACKFILL_SESSION, payment, bank)
        );
        inc('purchasePayments');
    }

    for (const movement of stockMovements) {
        if (!['MANUAL_IN', 'MANUAL_OUT', 'MAINTENANCE_USAGE'].includes(movement.sourceType)) {
            continue;
        }
        const warehouseItem = warehouseItemsById.get(movement.warehouseItemRef);
        const unitValue = positiveNumber(warehouseItem?.defaultPurchasePrice);
        if (unitValue <= 0 || positiveNumber(movement.quantity) <= 0) {
            inc('skipped');
            continue;
        }
        await postWithContext(`mutasi stok ${movement._id}`, () =>
            postStockMovementJournal(BACKFILL_SESSION, movement, unitValue)
        );
        inc('stockMovements');
    }

    for (const voucher of driverVouchers) {
        if (voucher.status === 'DRAFT' || positiveNumber(voucher.cashGiven || voucher.initialCashGiven || voucher.totalIssuedAmount) <= 0) {
            inc('skipped');
            continue;
        }
        await postWithContext(`pencairan bon ${voucher.bonNumber || voucher._id}`, () =>
            postDriverVoucherIssueJournal(BACKFILL_SESSION, voucher, bankSummary(voucher.issueBankRef ? banksById.get(voucher.issueBankRef) : null))
        );
        inc('driverVoucherIssues');
    }

    for (const disbursement of driverVoucherDisbursements) {
        if (disbursement.kind !== 'TOP_UP') continue;
        if (disbursement.status === 'VOID') {
            await postWithContext(`void top up bon ${disbursement._id}`, () =>
                voidJournalEntryForSource(BACKFILL_SESSION, 'DRIVER_VOUCHER_DISBURSEMENT', disbursement._id, 'TOP_UP')
            );
            inc('skipped');
            continue;
        }
        if (positiveNumber(disbursement.amount) <= 0) {
            inc('skipped');
            continue;
        }
        const bank = bankSummary(disbursement.bankAccountRef ? banksById.get(disbursement.bankAccountRef) : null);
        if (!bank) {
            warnings.push(`Lewati top up bon ${disbursement._id}: rekening tidak ditemukan`);
            inc('skipped');
            continue;
        }
        const voucher = driverVouchers.find(row => row._id === disbursement.voucherRef);
        await postWithContext(`top up bon ${voucher?.bonNumber || disbursement._id}`, () =>
            postDriverVoucherTopUpJournal(BACKFILL_SESSION, {
                voucherId: disbursement.voucherRef,
                bonNumber: voucher?.bonNumber,
                date: disbursement.date,
                amount: positiveNumber(disbursement.amount),
                disbursementId: disbursement._id,
                bankAccount: bank,
            })
        );
        inc('driverVoucherTopUps');
    }

    for (const voucher of driverVouchers) {
        if (voucher.status !== 'SETTLED') continue;
        const hasSettlementValue =
            positiveNumber(voucher.totalSpent) > 0 ||
            positiveNumber(voucher.driverFeeAmount) > 0 ||
            Math.abs(Number(voucher.balance || 0)) > 0;
        if (!hasSettlementValue) {
            inc('skipped');
            continue;
        }
        await postWithContext(`settlement bon ${voucher.bonNumber || voucher._id}`, () =>
            postDriverVoucherSettlementJournal(
                BACKFILL_SESSION,
                voucher,
                bankSummary(voucher.settlementBankRef ? banksById.get(voucher.settlementBankRef) : null)
            )
        );
        inc('driverVoucherSettlements');
    }

    const transferOutRows = bankTransactions.filter(row => row.type === 'TRANSFER_OUT' && row.relatedTransferRef);
    for (const transferOut of transferOutRows) {
        const transferIn = bankTransactions.find(row =>
            row.relatedTransferRef === transferOut.relatedTransferRef &&
            row.type === 'TRANSFER_IN' &&
            row.amount === transferOut.amount
        );
        if (!transferIn) {
            warnings.push(`Lewati transfer ${transferOut.relatedTransferRef}: pasangan masuk tidak ditemukan`);
            inc('skipped');
            continue;
        }
        const fromAccount = bankSummary(banksById.get(transferOut.bankAccountRef));
        const toAccount = bankSummary(banksById.get(transferIn.bankAccountRef));
        if (!fromAccount || !toAccount) {
            warnings.push(`Lewati transfer ${transferOut.relatedTransferRef}: rekening tidak lengkap`);
            inc('skipped');
            continue;
        }
        await postWithContext(`transfer bank ${transferOut.relatedTransferRef}`, () =>
            postBankTransferJournal(BACKFILL_SESSION, {
                transferId: normalizeText(transferOut.relatedTransferRef),
                date: transferOut.date,
                amount: positiveNumber(transferOut.amount),
                fromAccount,
                toAccount,
            })
        );
        inc('bankTransfers');
    }

    const summary = Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
    console.log(JSON.stringify({ ok: true, summary, warnings }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
