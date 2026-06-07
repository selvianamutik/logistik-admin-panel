import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    buildCustomerReceiptLookup,
    buildExpenseLookup,
    buildPaymentLookup,
    buildPurchaseLookup,
    buildRefundLookup,
    resolveBankTransactionSourceLink,
} from '../src/lib/bank-transaction-links';
import { getAllDocuments } from '../src/lib/repositories/document-store';
import type {
    BankTransaction,
    CustomerReceipt,
    CustomerOverpaymentRefund,
    Expense,
    FreightNota,
    Payment,
    Purchase,
} from '../src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

async function main() {
    const [
        bankTransactions,
        payments,
        customerReceipts,
        refunds,
        expenses,
        purchases,
        freightNotas,
    ] = await Promise.all([
        getAllDocuments<BankTransaction>('bankTransaction'),
        getAllDocuments<Payment>('payment'),
        getAllDocuments<CustomerReceipt>('customerReceipt'),
        getAllDocuments<CustomerOverpaymentRefund>('customerOverpaymentRefund'),
        getAllDocuments<Expense>('expense'),
        getAllDocuments<Purchase>('purchase'),
        getAllDocuments<FreightNota>('freightNota'),
    ]);

    const paymentsById = buildPaymentLookup(payments);
    const receiptsById = buildCustomerReceiptLookup(customerReceipts);
    const refundsById = buildRefundLookup(refunds);
    const expensesById = buildExpenseLookup(expenses);
    const purchasesById = buildPurchaseLookup(purchases);
    const invoiceIdsWithPages = new Set(freightNotas.map(nota => nota._id).filter(Boolean));
    const permissions = {
        canOpenInvoices: true,
        canOpenDriverVouchers: true,
        canOpenDriverBorongans: true,
        canOpenVehicles: true,
        canOpenIncidents: true,
        canOpenMaintenance: true,
        canOpenPurchases: true,
    };

    let paymentInvoiceLinks = 0;
    let receiptLinks = 0;
    let refundLinks = 0;
    let purchaseLinks = 0;
    let expenseLinks = 0;

    for (const transaction of bankTransactions) {
        const sourceLink = resolveBankTransactionSourceLink({
            transaction,
            paymentsById,
            receiptsById,
            refundsById,
            expensesById,
            purchasesById,
            invoiceIdsWithPages,
            permissions,
        });

        if (transaction.relatedPaymentRef) {
            const payment = paymentsById.get(transaction.relatedPaymentRef);
            assert(payment, `Mutasi ${transaction._id} relatedPaymentRef tidak ditemukan.`);
            if (invoiceIdsWithPages.has(payment.invoiceRef)) {
                assert(sourceLink?.href === `/invoices/${payment.invoiceRef}`, `Mutasi payment ${transaction._id} tidak link ke invoice.`);
                paymentInvoiceLinks += 1;
            }
        }

        if (transaction.relatedReceiptRef) {
            const receipt = receiptsById.get(transaction.relatedReceiptRef);
            assert(receipt, `Mutasi ${transaction._id} relatedReceiptRef tidak ditemukan.`);
            const receiptNumber = normalizeText(receipt.receiptNumber);
            assert(receiptNumber, `Receipt ${receipt._id} belum punya nomor receipt.`);
            assert(sourceLink?.href === `/invoices?q=${encodeURIComponent(receiptNumber)}`, `Mutasi receipt ${transaction._id} tidak link ke pencarian receipt.`);
            receiptLinks += 1;
        }

        if (transaction.relatedOverpaymentRefundRef) {
            const refund = refundsById.get(transaction.relatedOverpaymentRefundRef);
            assert(refund, `Mutasi ${transaction._id} relatedOverpaymentRefundRef tidak ditemukan.`);
            if (refund.sourceInvoiceRef) {
                assert(sourceLink?.href === `/invoices/${refund.sourceInvoiceRef}`, `Mutasi refund ${transaction._id} tidak link ke invoice sumber.`);
            } else if (refund.sourceReceiptRef) {
                assert(sourceLink?.href?.startsWith('/invoices?q='), `Mutasi refund receipt ${transaction._id} tidak link ke pencarian receipt.`);
            }
            refundLinks += 1;
        }

        if (transaction.relatedPurchaseRef) {
            assert(purchasesById.has(transaction.relatedPurchaseRef), `Mutasi ${transaction._id} relatedPurchaseRef tidak ditemukan.`);
            assert(sourceLink?.href === `/inventory/purchases/${transaction.relatedPurchaseRef}`, `Mutasi pembelian ${transaction._id} tidak link ke pembelian.`);
            purchaseLinks += 1;
        }

        if (transaction.relatedExpenseRef) {
            assert(expensesById.has(transaction.relatedExpenseRef), `Mutasi ${transaction._id} relatedExpenseRef tidak ditemukan.`);
            if (sourceLink) expenseLinks += 1;
        }
    }

    console.log(JSON.stringify({
        ok: true,
        bankTransactions: bankTransactions.length,
        paymentInvoiceLinks,
        receiptLinks,
        refundLinks,
        purchaseLinks,
        expenseLinks,
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
