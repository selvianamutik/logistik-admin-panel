import { createClient } from '@sanity/client';

function cleanEnv(value) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function getClient() {
    const projectId = cleanEnv(process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) || 'p6do50hl';
    const dataset = cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production';
    const apiVersion = cleanEnv(process.env.SANITY_API_VERSION) || '2024-01-01';
    const token = cleanEnv(process.env.SANITY_API_TOKEN);

    return createClient({
        projectId,
        dataset,
        apiVersion,
        token,
        useCdn: false,
    });
}

function groupBy(items, keyFn) {
    const map = new Map();
    for (const item of items) {
        const key = keyFn(item);
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    }
    return map;
}

function sum(items, valueFn) {
    return items.reduce((total, item) => total + valueFn(item), 0);
}

function fmtCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
    }).format(amount || 0);
}

function printSection(title, findings) {
    console.log(`\n${title}`);
    if (findings.length === 0) {
        console.log('  OK');
        return;
    }

    for (const finding of findings) {
        console.log(`  - ${finding}`);
    }
}

async function main() {
    const client = getClient();
    const data = await client.fetch(`{
        "invoices": *[_type == "invoice"]{ _id, invoiceNumber, totalAmount, status },
        "freightNotas": *[_type == "freightNota"]{ _id, notaNumber, totalAmount, status },
        "payments": *[_type == "payment"]{ _id, invoiceRef, amount, date },
        "borongans": *[_type == "driverBorongan"]{ _id, boronganNumber, totalAmount, status },
        "driverVouchers": *[_type == "driverVoucher"]{
            _id, bonNumber, status, issuedDate, cashGiven, totalSpent, balance,
            issueBankRef, settlementBankRef
        },
        "driverVoucherItems": *[_type == "driverVoucherItem"]{ _id, voucherRef, category, amount },
        "expenses": *[_type == "expense"]{
            _id, amount, date, bankAccountRef, boronganRef, voucherRef, categoryName
        },
        "bankAccounts": *[_type == "bankAccount"]{ _id, bankName, initialBalance, currentBalance, active },
        "bankTransactions": *[_type == "bankTransaction"]{
            _id, bankAccountRef, type, amount, balanceAfter,
            relatedPaymentRef, relatedExpenseRef, relatedTransferRef, relatedVoucherRef
        }
    }`);

    const invoiceFindings = [];
    const paymentGroups = groupBy(data.payments, payment => payment.invoiceRef || '');
    const receivableDocs = [
        ...data.invoices.map(item => ({ ...item, label: item.invoiceNumber || item._id, kind: 'Invoice' })),
        ...data.freightNotas.map(item => ({ ...item, label: item.notaNumber || item._id, kind: 'Nota' })),
    ];
    const receivableMap = new Map(receivableDocs.map(item => [item._id, item]));

    for (const payment of data.payments) {
        if (!receivableMap.has(payment.invoiceRef)) {
            invoiceFindings.push(`Payment ${payment._id} mengarah ke tagihan yang tidak ada (${payment.invoiceRef || '-'})`);
        }
    }

    for (const doc of receivableDocs) {
        const docPayments = paymentGroups.get(doc._id) || [];
        const totalPaid = sum(docPayments, item => item.amount || 0);
        const expectedStatus = totalPaid >= (doc.totalAmount || 0) ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';

        if (totalPaid > (doc.totalAmount || 0)) {
            invoiceFindings.push(`${doc.kind} ${doc.label} overpaid ${fmtCurrency(totalPaid)} dari total ${fmtCurrency(doc.totalAmount)}`);
        }
        if (doc.status !== expectedStatus) {
            invoiceFindings.push(`${doc.kind} ${doc.label} status ${doc.status} tidak cocok dengan pembayaran (${expectedStatus})`);
        }
    }

    const boronganFindings = [];
    const boronganExpenseGroups = groupBy(
        data.expenses.filter(expense => expense.boronganRef),
        expense => expense.boronganRef
    );
    for (const borongan of data.borongans) {
        const relatedExpenses = boronganExpenseGroups.get(borongan._id) || [];
        if (borongan.status === 'PAID' && relatedExpenses.length === 0) {
            boronganFindings.push(`Borongan ${borongan.boronganNumber} sudah PAID tapi belum punya expense`);
        }
        if (relatedExpenses.length > 1) {
            boronganFindings.push(`Borongan ${borongan.boronganNumber} punya ${relatedExpenses.length} expense, seharusnya 1`);
        }
        if (borongan.status !== 'PAID' && relatedExpenses.length > 0) {
            boronganFindings.push(`Borongan ${borongan.boronganNumber} belum PAID tapi sudah punya expense`);
        }
    }

    const voucherFindings = [];
    const voucherExpenseGroups = groupBy(
        data.expenses.filter(expense => expense.voucherRef),
        expense => expense.voucherRef
    );
    const voucherItemGroups = groupBy(data.driverVoucherItems, item => item.voucherRef);
    const voucherBankTxGroups = groupBy(
        data.bankTransactions.filter(tx => tx.relatedVoucherRef),
        tx => tx.relatedVoucherRef
    );

    for (const voucher of data.driverVouchers) {
        const items = voucherItemGroups.get(voucher._id) || [];
        const expenses = voucherExpenseGroups.get(voucher._id) || [];
        const bankTx = voucherBankTxGroups.get(voucher._id) || [];
        const computedSpent = sum(items, item => item.amount || 0);
        const computedBalance = (voucher.cashGiven || 0) - computedSpent;

        if (!voucher.issueBankRef) {
            voucherFindings.push(`Bon ${voucher.bonNumber} tidak punya rekening sumber`);
        }
        if ((voucher.totalSpent || 0) !== computedSpent) {
            voucherFindings.push(`Bon ${voucher.bonNumber} totalSpent ${fmtCurrency(voucher.totalSpent)} tidak cocok dengan item ${fmtCurrency(computedSpent)}`);
        }
        if ((voucher.balance || 0) !== computedBalance) {
            voucherFindings.push(`Bon ${voucher.bonNumber} balance ${fmtCurrency(voucher.balance)} tidak cocok dengan perhitungan ${fmtCurrency(computedBalance)}`);
        }
        if (voucher.status === 'SETTLED' && expenses.length === 0) {
            voucherFindings.push(`Bon ${voucher.bonNumber} sudah SETTLED tapi belum diposting ke expense`);
        }
        if (voucher.status !== 'SETTLED' && expenses.length > 0) {
            voucherFindings.push(`Bon ${voucher.bonNumber} belum settle tapi sudah punya expense`);
        }
        if (bankTx.length === 0) {
            voucherFindings.push(`Bon ${voucher.bonNumber} tidak punya mutasi bank terkait voucher`);
        }
    }

    const expenseFindings = [];
    const expenseTxRefs = new Set(
        data.bankTransactions
            .filter(tx => tx.relatedExpenseRef)
            .map(tx => tx.relatedExpenseRef)
    );
    for (const expense of data.expenses) {
        if (expense.bankAccountRef && !expenseTxRefs.has(expense._id)) {
            expenseFindings.push(`Expense ${expense._id} memakai rekening tapi tidak punya bank transaction`);
        }
    }

    const bankFindings = [];
    const bankTxGroups = groupBy(data.bankTransactions, tx => tx.bankAccountRef || '');
    for (const account of data.bankAccounts) {
        const transactions = bankTxGroups.get(account._id) || [];
        const movement = transactions.reduce((total, tx) => {
            const isCredit = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
            return total + (isCredit ? tx.amount : -tx.amount);
        }, 0);
        const expectedBalance = (account.initialBalance || 0) + movement;

        if (expectedBalance !== (account.currentBalance || 0)) {
            bankFindings.push(`Saldo ${account.bankName} mismatch. expected ${fmtCurrency(expectedBalance)} aktual ${fmtCurrency(account.currentBalance)}`);
        }
    }

    const allSections = [
        ['Invoice & Nota', invoiceFindings],
        ['Borongan', boronganFindings],
        ['Bon Supir', voucherFindings],
        ['Expense', expenseFindings],
        ['Bank', bankFindings],
    ];

    console.log('Audit Finance');
    console.log(`Dataset: ${cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production'}`);

    let totalFindings = 0;
    for (const [, findings] of allSections) totalFindings += findings.length;

    for (const [title, findings] of allSections) {
        printSection(title, findings);
    }

    console.log(`\nTotal temuan: ${totalFindings}`);
    process.exitCode = totalFindings > 0 ? 1 : 0;
}

main().catch(error => {
    console.error('Audit gagal:', error);
    process.exitCode = 1;
});
