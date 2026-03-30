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

function parseWholeMoneyLike(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value !== 'string') {
        return 0;
    }
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/^-?\d+$/.test(trimmed)) {
        return Number(trimmed);
    }
    const negative = trimmed.startsWith('-');
    const digits = trimmed.replace(/[^\d]/g, '');
    if (!digits) return 0;
    return (negative ? -1 : 1) * Number(digits);
}

function fmtCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
    }).format(parseWholeMoneyLike(amount));
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

function printInfoSection(title, notes) {
    console.log(`\n${title}`);
    if (notes.length === 0) {
        console.log('  Tidak ada catatan');
        return;
    }

    for (const note of notes) {
        console.log(`  - ${note}`);
    }
}

async function main() {
    const client = getClient();
    const data = await client.fetch(`{
        "invoices": *[_type == "invoice"]{ _id, invoiceNumber, totalAmount, totalAdjustmentAmount, netAmount, status },
        "freightNotas": *[_type == "freightNota"]{ _id, notaNumber, totalAmount, totalAdjustmentAmount, netAmount, status },
        "payments": *[_type == "payment"]{ _id, invoiceRef, receiptRef, amount, date },
        "customerReceipts": *[_type == "customerReceipt"]{ _id, receiptNumber, totalAmount, unappliedAmount, allocationCount, customerRef, customerName, method, bankAccountRef },
        "invoiceAdjustments": *[_type == "invoiceAdjustment"]{ _id, invoiceRef, amount, status },
        "borongans": *[_type == "driverBorongan"]{ _id, boronganNumber, totalAmount, status },
        "driverBoronganItems": *[_type == "driverBoronganItem"]{ _id, boronganRef, doRef, doNumber },
        "driverVouchers": *[_type == "driverVoucher"]{
            _id, bonNumber, status, issuedDate, cashGiven, initialCashGiven, totalIssuedAmount, topUpCount, totalSpent, driverFeeAmount, totalClaimAmount, balance,
            issueBankRef, settlementBankRef,
            "deliveryOrderRef": coalesce(deliveryOrderRef._ref, deliveryOrderRef),
            doNumber,
            "driverRef": coalesce(driverRef._ref, driverRef),
            "vehicleRef": coalesce(vehicleRef._ref, vehicleRef)
        },
        "driverVoucherDisbursements": *[_type == "driverVoucherDisbursement"]{
            _id, voucherRef, kind, amount, date, bankAccountRef, bankTransactionRef
        },
        "driverVoucherItems": *[_type == "driverVoucherItem"]{ _id, voucherRef, category, amount, expenseDate },
        "expenses": *[_type == "expense"]{
            _id, amount, date, bankAccountRef, boronganRef, voucherRef, categoryName
        },
        "deliveryOrders": *[_type == "deliveryOrder"]{
            _id,
            doNumber,
            "driverRef": coalesce(driverRef._ref, driverRef),
            "vehicleRef": coalesce(vehicleRef._ref, vehicleRef),
            taripBorongan
        },
        "bankAccounts": *[_type == "bankAccount"]{ _id, bankName, initialBalance, currentBalance, active },
        "bankTransactions": *[_type == "bankTransaction"]{
            _id, bankAccountRef, type, amount, balanceAfter,
            relatedPaymentRef, relatedExpenseRef, relatedTransferRef, relatedVoucherRef
        }
    }`);

    const receivableFindings = [];
    const customerCreditNotes = [];
    const paymentGroups = groupBy(data.payments, payment => payment.invoiceRef || '');
    const receiptPaymentGroups = groupBy(
        data.payments.filter(payment => payment.receiptRef),
        payment => payment.receiptRef
    );
    const adjustmentGroups = groupBy(
        data.invoiceAdjustments.filter(item => item.status === 'APPROVED'),
        item => item.invoiceRef || ''
    );
    const receivableDocs = [
        ...data.invoices.map(item => ({ ...item, label: item.invoiceNumber || item._id, kind: 'Invoice' })),
        ...data.freightNotas.map(item => ({ ...item, label: item.notaNumber || item._id, kind: 'Nota' })),
    ];
    const receivableMap = new Map(receivableDocs.map(item => [item._id, item]));

    for (const payment of data.payments) {
        if (!receivableMap.has(payment.invoiceRef)) {
            receivableFindings.push(`Payment ${payment._id} mengarah ke tagihan yang tidak ada (${payment.invoiceRef || '-'})`);
        }
    }

    for (const receipt of data.customerReceipts) {
        const allocations = receiptPaymentGroups.get(receipt._id) || [];
        const allocatedTotal = sum(allocations, item => parseWholeMoneyLike(item.amount));
        const unappliedAmount = parseWholeMoneyLike(receipt.unappliedAmount);
        const resolvedTotal = allocatedTotal + unappliedAmount;
        if (allocations.length === 0 && unappliedAmount === 0) {
            receivableFindings.push(`Receipt ${receipt.receiptNumber || receipt._id} tidak punya alokasi payment`);
        }
        if (resolvedTotal !== parseWholeMoneyLike(receipt.totalAmount)) {
            receivableFindings.push(
                `Receipt ${receipt.receiptNumber || receipt._id} total ${fmtCurrency(receipt.totalAmount)} tidak cocok dengan alokasi ${fmtCurrency(allocatedTotal)} + kredit ${fmtCurrency(unappliedAmount)}`
            );
        }
        if ((receipt.allocationCount || 0) !== allocations.length) {
            receivableFindings.push(`Receipt ${receipt.receiptNumber || receipt._id} allocationCount ${receipt.allocationCount || 0} tidak cocok dengan ${allocations.length} payment`);
        }
        if (receipt.method === 'TRANSFER' && !receipt.bankAccountRef) {
            receivableFindings.push(`Receipt ${receipt.receiptNumber || receipt._id} transfer tanpa rekening bank`);
        }
        if (unappliedAmount > 0) {
            customerCreditNotes.push(
                `Receipt ${receipt.receiptNumber || receipt._id} masih menyisakan kredit customer ${fmtCurrency(unappliedAmount)}`
            );
        }
    }

    for (const doc of receivableDocs) {
        const docPayments = paymentGroups.get(doc._id) || [];
        const docAdjustments = adjustmentGroups.get(doc._id) || [];
        const totalPaid = sum(docPayments, item => parseWholeMoneyLike(item.amount));
        const totalAdjustment = sum(docAdjustments, item => parseWholeMoneyLike(item.amount));
        const expectedNet = Math.max(parseWholeMoneyLike(doc.totalAmount) - totalAdjustment, 0);
        const storedAdjustment = parseWholeMoneyLike(doc.totalAdjustmentAmount);
        const storedNet = parseWholeMoneyLike(doc.netAmount);
        const expectedStatus = totalPaid >= expectedNet ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';

        if (storedAdjustment !== totalAdjustment) {
            receivableFindings.push(`${doc.kind} ${doc.label} totalAdjustmentAmount ${fmtCurrency(doc.totalAdjustmentAmount)} tidak cocok dengan adjustment ${fmtCurrency(totalAdjustment)}`);
        }
        if (storedNet !== expectedNet) {
            receivableFindings.push(`${doc.kind} ${doc.label} netAmount ${fmtCurrency(doc.netAmount)} tidak cocok dengan netto ${fmtCurrency(expectedNet)}`);
        }
        if (totalPaid > expectedNet) {
            customerCreditNotes.push(`${doc.kind} ${doc.label} punya kelebihan bayar ${fmtCurrency(totalPaid - expectedNet)}`);
        }
        if (doc.status !== expectedStatus) {
            receivableFindings.push(`${doc.kind} ${doc.label} status ${doc.status} tidak cocok dengan pembayaran netto (${expectedStatus})`);
        }
    }

    const legacyInvoiceNotes = [];
    if (data.invoices.length > 0) {
        const outstandingLegacy = sum(
            data.invoices.filter(item => item.status !== 'PAID'),
            item => parseWholeMoneyLike(item.totalAmount)
        );
        legacyInvoiceNotes.push(
            `${data.invoices.length} invoice legacy masih ada di dataset dengan outstanding ${fmtCurrency(outstandingLegacy)}`
        );
        legacyInvoiceNotes.push(
            'Invoice legacy tidak dihitung sebagai tagihan aktif; workflow billing aktif memakai Freight Nota.'
        );
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
    const voucherDisbursementGroups = groupBy(data.driverVoucherDisbursements, item => item.voucherRef);
    const voucherBankTxGroups = groupBy(
        data.bankTransactions.filter(tx => tx.relatedVoucherRef),
        tx => tx.relatedVoucherRef
    );
    const deliveryOrderMap = new Map(data.deliveryOrders.map(item => [item._id, item]));
    const boronganDoRefs = new Set(
        data.driverBoronganItems
            .map(item => item.doRef)
            .filter(Boolean)
    );

    for (const voucher of data.driverVouchers) {
        const items = voucherItemGroups.get(voucher._id) || [];
        const disbursements = voucherDisbursementGroups.get(voucher._id) || [];
        const expenses = voucherExpenseGroups.get(voucher._id) || [];
        const bankTx = voucherBankTxGroups.get(voucher._id) || [];
        const computedSpent = sum(items, item => parseWholeMoneyLike(item.amount));
        const computedDriverFee = parseWholeMoneyLike(voucher.driverFeeAmount);
        const computedClaim = computedSpent + computedDriverFee;
        const computedIssued = disbursements.length > 0
            ? sum(disbursements, item => parseWholeMoneyLike(item.amount))
            : parseWholeMoneyLike(voucher.totalIssuedAmount || voucher.cashGiven);
        const computedInitial = parseWholeMoneyLike(
            disbursements.find(item => item.kind === 'INITIAL')?.amount || voucher.initialCashGiven || voucher.cashGiven
        );
        const computedTopUpCount = disbursements.filter(item => item.kind === 'TOP_UP').length;
        const computedBalance = computedIssued - computedClaim;

        if (!voucher.issueBankRef) {
            voucherFindings.push(`Bon ${voucher.bonNumber} tidak punya rekening sumber`);
        }
        if (!voucher.deliveryOrderRef) {
            voucherFindings.push(`Bon ${voucher.bonNumber} tidak tertaut ke DO / trip`);
        }
        const relatedDeliveryOrder = voucher.deliveryOrderRef ? deliveryOrderMap.get(voucher.deliveryOrderRef) : null;
        if (voucher.deliveryOrderRef && !relatedDeliveryOrder) {
            voucherFindings.push(`Bon ${voucher.bonNumber} mengarah ke DO yang tidak ada (${voucher.deliveryOrderRef})`);
        }
        if (relatedDeliveryOrder) {
            if (voucher.driverRef && relatedDeliveryOrder.driverRef && voucher.driverRef !== relatedDeliveryOrder.driverRef) {
                voucherFindings.push(`Bon ${voucher.bonNumber} punya supir berbeda dari DO ${relatedDeliveryOrder.doNumber || voucher.deliveryOrderRef}`);
            }
            if (voucher.vehicleRef && relatedDeliveryOrder.vehicleRef && voucher.vehicleRef !== relatedDeliveryOrder.vehicleRef) {
                voucherFindings.push(`Bon ${voucher.bonNumber} punya kendaraan berbeda dari DO ${relatedDeliveryOrder.doNumber || voucher.deliveryOrderRef}`);
            }
            if (parseWholeMoneyLike(voucher.driverFeeAmount) !== parseWholeMoneyLike(relatedDeliveryOrder.taripBorongan)) {
                voucherFindings.push(`Bon ${voucher.bonNumber} upah trip ${fmtCurrency(voucher.driverFeeAmount)} tidak cocok dengan tarif DO ${fmtCurrency(relatedDeliveryOrder.taripBorongan)}`);
            }
        }
        if (voucher.deliveryOrderRef && boronganDoRefs.has(voucher.deliveryOrderRef)) {
            voucherFindings.push(`Bon ${voucher.bonNumber} masih bentrok dengan slip borongan pada DO yang sama`);
        }
        if (parseWholeMoneyLike(voucher.initialCashGiven || voucher.cashGiven) !== computedInitial) {
            voucherFindings.push(`Bon ${voucher.bonNumber} initialCashGiven ${fmtCurrency(voucher.initialCashGiven || voucher.cashGiven)} tidak cocok dengan histori pencairan ${fmtCurrency(computedInitial)}`);
        }
        if (parseWholeMoneyLike(voucher.totalIssuedAmount || voucher.cashGiven) !== computedIssued) {
            voucherFindings.push(`Bon ${voucher.bonNumber} totalIssuedAmount ${fmtCurrency(voucher.totalIssuedAmount || voucher.cashGiven)} tidak cocok dengan histori pencairan ${fmtCurrency(computedIssued)}`);
        }
        if ((voucher.topUpCount || 0) !== computedTopUpCount) {
            voucherFindings.push(`Bon ${voucher.bonNumber} topUpCount ${voucher.topUpCount || 0} tidak cocok dengan histori ${computedTopUpCount}`);
        }
        if (parseWholeMoneyLike(voucher.totalSpent) !== computedSpent) {
            voucherFindings.push(`Bon ${voucher.bonNumber} totalSpent ${fmtCurrency(voucher.totalSpent)} tidak cocok dengan item ${fmtCurrency(computedSpent)}`);
        }
        if (parseWholeMoneyLike(voucher.totalClaimAmount) !== computedClaim) {
            voucherFindings.push(`Bon ${voucher.bonNumber} totalClaimAmount ${fmtCurrency(voucher.totalClaimAmount)} tidak cocok dengan perhitungan ${fmtCurrency(computedClaim)}`);
        }
        if (parseWholeMoneyLike(voucher.balance) !== computedBalance) {
            voucherFindings.push(`Bon ${voucher.bonNumber} balance ${fmtCurrency(voucher.balance)} tidak cocok dengan perhitungan ${fmtCurrency(computedBalance)}`);
        }
        if (disbursements.length > 0) {
            const initialCount = disbursements.filter(item => item.kind === 'INITIAL').length;
            if (initialCount !== 1) {
                voucherFindings.push(`Bon ${voucher.bonNumber} harus punya tepat 1 pencairan awal, sekarang ${initialCount}`);
            }
        }
        if (voucher.status === 'SETTLED') {
            const expectedExpenseCount = items.length + (computedDriverFee > 0 ? 1 : 0);
            if (expenses.length === 0) {
                voucherFindings.push(`Bon ${voucher.bonNumber} sudah SETTLED tapi belum diposting ke expense`);
            } else if (expenses.length !== expectedExpenseCount) {
                voucherFindings.push(`Bon ${voucher.bonNumber} punya ${expenses.length} expense, seharusnya ${expectedExpenseCount}`);
            }

            const wageExpenses = expenses.filter(expense => expense.categoryName === 'Borongan Supir');
            if (computedDriverFee > 0) {
                if (wageExpenses.length !== 1) {
                    voucherFindings.push(`Bon ${voucher.bonNumber} harus punya tepat 1 expense upah supir`);
                } else if (parseWholeMoneyLike(wageExpenses[0].amount) !== computedDriverFee) {
                    voucherFindings.push(`Bon ${voucher.bonNumber} expense upah supir ${fmtCurrency(wageExpenses[0].amount)} tidak cocok dengan driver fee ${fmtCurrency(computedDriverFee)}`);
                }
            } else if (wageExpenses.length > 0) {
                voucherFindings.push(`Bon ${voucher.bonNumber} tidak punya driver fee tapi ada expense Borongan Supir`);
            }
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
            const amount = parseWholeMoneyLike(tx.amount);
            return total + (isCredit ? amount : -amount);
        }, 0);
        const expectedBalance = parseWholeMoneyLike(account.initialBalance) + movement;

        if (expectedBalance !== parseWholeMoneyLike(account.currentBalance)) {
            bankFindings.push(`Saldo ${account.bankName} mismatch. expected ${fmtCurrency(expectedBalance)} aktual ${fmtCurrency(account.currentBalance)}`);
        }
        if (account.active === false && parseWholeMoneyLike(account.currentBalance) !== 0) {
            bankFindings.push(`Rekening nonaktif ${account.bankName} masih menyimpan saldo ${fmtCurrency(account.currentBalance)}`);
        }
    }

    const allSections = [
        ['Tagihan Aktif (Nota)', receivableFindings],
        ['Borongan', boronganFindings],
        ['Bon Trip', voucherFindings],
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

    printInfoSection('Legacy Invoice (Info)', legacyInvoiceNotes);
    printInfoSection('Kelebihan Bayar Customer (Info)', customerCreditNotes);

    console.log(`\nTotal temuan: ${totalFindings}`);
    process.exitCode = totalFindings > 0 ? 1 : 0;
}

main().catch(error => {
    console.error('Audit gagal:', error);
    process.exitCode = 1;
});
