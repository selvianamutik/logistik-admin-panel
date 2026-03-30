import { NextResponse } from 'next/server';

import { resolveCompanyLogoUrl } from '@/lib/branding';
import { calculateFreightNotaRowAmount, normalizeFreightNotaBillingMode } from '@/lib/freight-nota-billing';
import { getSanityClient, sanityCreate, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import { buildFreightNotaDisplayNumberFromParts } from '@/lib/nota-numbering';
import type { FreightNotaInstructionAccount, InvoiceAdjustmentKind, Payment, PaymentMethod } from '@/lib/types';

import {
    assertIsoDate,
    ensureCashAccount,
    extractRefId,
    getLedgerAccount,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';
import {
    INVOICE_ADJUSTMENT_KIND_SET,
    buildReceivablePatch,
    computeReceivableSnapshot,
    isFreightNotaRowEmpty,
    summarizeDeliveryOrderItems,
    type CustomerReceiptAllocationInput,
    type FreightNotaDeliveryOrderItemSource,
    type FreightNotaOrderSource,
    type InvoiceAdjustmentDoc,
    type NormalizedFreightNotaRow,
    type ReceivableDoc,
    type ReceivableSnapshot,
} from './finance-workflow-support';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type ReceiptCustomerSource = {
    _id: string;
    name?: string;
    active?: boolean;
};

function normalizeFreightNotaAmount(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.round(value);
}

async function loadFreightNotaDocumentSettings(): Promise<{
    instructionAccounts: FreightNotaInstructionAccount[];
    notaSeriesCode?: string;
    footerNote?: string;
    issuerCompanyName?: string;
    issuerCompanyAddress?: string;
    issuerCompanyPhone?: string;
    issuerCompanyEmail?: string;
    issuerCompanyLogoUrl?: string;
    issuerCompanySignatureStampUrl?: string;
    issuerCompanySignatureName?: string;
    issuerCompanyNpwp?: string;
}> {
    const companyDoc = await getSanityClient().fetch<{
        name?: string;
        address?: string;
        phone?: string;
        email?: string;
        logoUrl?: string;
        signatureStampUrl?: string;
        npwp?: string;
        bankName?: string;
        bankAccount?: string;
        bankHolder?: string;
        numberingSettings?: {
            notaSeriesCode?: string;
        };
        invoiceSettings?: {
            invoiceBankAccountRefs?: string[];
            defaultInvoiceBankAccountRef?: string;
            footerNote?: string;
        };
    } | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl,
            signatureStampUrl,
            npwp,
            bankName,
            bankAccount,
            bankHolder,
            numberingSettings,
            invoiceSettings
        }`
    );

    const selectedRefs = Array.isArray(companyDoc?.invoiceSettings?.invoiceBankAccountRefs)
        ? companyDoc.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];

    if (selectedRefs.length > 0) {
        const selectedAccounts = await getSanityClient().fetch<Array<{
            _id: string;
            bankName?: string;
            accountNumber?: string;
            accountHolder?: string;
            accountType?: string;
            active?: boolean;
        }>>(
            `*[_type == "bankAccount" && _id in $ids]{
                _id,
                bankName,
                accountNumber,
                accountHolder,
                accountType,
                active
            }`,
            { ids: selectedRefs }
        );
        const eligibleAccounts = selectedAccounts
            .filter(account => account.active !== false && account.accountType !== 'CASH')
            .map<FreightNotaInstructionAccount>(account => ({
                bankAccountRef: account._id,
                bankName: normalizeText(account.bankName),
                accountNumber: normalizeOptionalText(account.accountNumber),
                accountHolder: normalizeOptionalText(account.accountHolder),
            }))
            .filter(account => Boolean(account.bankName));

        if (eligibleAccounts.length > 0) {
            const defaultRef = typeof companyDoc?.invoiceSettings?.defaultInvoiceBankAccountRef === 'string'
                ? companyDoc.invoiceSettings.defaultInvoiceBankAccountRef
                : undefined;
            return {
                instructionAccounts: eligibleAccounts.sort((left, right) => {
                    if (defaultRef) {
                        if (left.bankAccountRef === defaultRef) return -1;
                        if (right.bankAccountRef === defaultRef) return 1;
                    }
                    return selectedRefs.indexOf(left.bankAccountRef || '') - selectedRefs.indexOf(right.bankAccountRef || '');
                }),
                notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
                footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
                issuerCompanyName: normalizeOptionalText(companyDoc?.name),
                issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
                issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
                issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
                issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
                issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
                issuerCompanySignatureName:
                    normalizeOptionalText(companyDoc?.bankHolder)
                    || eligibleAccounts.find(account => account.accountHolder)?.accountHolder
                    || 'Bagian Administrasi',
                issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
            };
        }
    }

    const legacyBankName = normalizeOptionalText(companyDoc?.bankName);
    if (!legacyBankName) {
        return {
            instructionAccounts: [],
            notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
            footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
            issuerCompanyName: normalizeOptionalText(companyDoc?.name),
            issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
            issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
            issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
            issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
            issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
            issuerCompanySignatureName:
                normalizeOptionalText(companyDoc?.bankHolder)
                || 'Bagian Administrasi',
            issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
        };
    }

    return {
        instructionAccounts: [{
            bankName: legacyBankName,
            accountNumber: normalizeOptionalText(companyDoc?.bankAccount),
            accountHolder: normalizeOptionalText(companyDoc?.bankHolder),
        }],
        notaSeriesCode: normalizeOptionalText(companyDoc?.numberingSettings?.notaSeriesCode),
        footerNote: normalizeOptionalText(companyDoc?.invoiceSettings?.footerNote),
        issuerCompanyName: normalizeOptionalText(companyDoc?.name),
        issuerCompanyAddress: normalizeOptionalText(companyDoc?.address),
        issuerCompanyPhone: normalizeOptionalText(companyDoc?.phone),
        issuerCompanyEmail: normalizeOptionalText(companyDoc?.email),
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyDoc),
        issuerCompanySignatureStampUrl: normalizeOptionalText(companyDoc?.signatureStampUrl),
        issuerCompanySignatureName:
            normalizeOptionalText(companyDoc?.bankHolder)
            || 'Bagian Administrasi',
        issuerCompanyNpwp: normalizeOptionalText(companyDoc?.npwp),
    };
}

async function loadReceivableSnapshot(invoiceRef: string) {
    const doc = await sanityGetById<ReceivableDoc>(invoiceRef);
    if (!doc) {
        return { error: NextResponse.json({ error: 'Dokumen tagihan tidak ditemukan' }, { status: 404 }) };
    }
    if (doc._type !== 'freightNota' && doc._type !== 'invoice') {
        return {
            error: NextResponse.json(
                { error: 'Pembayaran hanya boleh dicatat untuk nota ongkos atau arsip invoice lama' },
                { status: 409 }
            ),
        };
    }

    const grossAmount = Math.max(normalizeNumber(doc.totalAmount || 0), 0);
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
        return { error: NextResponse.json({ error: 'Total tagihan tidak valid' }, { status: 400 }) };
    }

    const [allPayments, approvedAdjustments] = await Promise.all([
        getSanityClient().fetch<Payment[]>(
            `*[_type == "payment" && invoiceRef == $ref]`,
            { ref: invoiceRef }
        ),
        getSanityClient().fetch<InvoiceAdjustmentDoc[]>(
            `*[_type == "invoiceAdjustment" && invoiceRef == $ref && status == "APPROVED"]`,
            { ref: invoiceRef }
        ),
    ]);

    return computeReceivableSnapshot(doc, allPayments, approvedAdjustments);
}

async function resolveReceiptBankAccount(method: PaymentMethod, selectedAccountRef?: string) {
    let bankAcc: BankAccountSummary | null = null;
    if (selectedAccountRef) {
        bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return { error: NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 }) };
        }
    } else if (method === 'CASH') {
        bankAcc = await ensureCashAccount();
    }

    if (method === 'TRANSFER' && bankAcc?.accountType === 'CASH') {
        return {
            error: NextResponse.json(
                { error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' },
                { status: 400 }
            ),
        };
    }

    if (method === 'CASH' && bankAcc?.accountType && bankAcc.accountType !== 'CASH') {
        return {
            error: NextResponse.json(
                { error: 'Metode tunai harus memakai akun Kas Tunai, bukan rekening bank' },
                { status: 400 }
            ),
        };
    }

    if (bankAcc && !bankAcc._rev) {
        return { error: NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 }) };
    }

    return { bankAcc };
}

export async function handlePaymentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran tidak valid' }, { status: 400 });
    }

    const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi tagihan wajib diisi' }, { status: 400 });
    }

    const paymentMethod = typeof data.method === 'string' ? data.method as PaymentMethod : 'CASH';
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paymentDate =
        typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10);
    assertIsoDate(paymentDate, 'Tanggal pembayaran');

    const paymentId = crypto.randomUUID();
    const incomeId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const loaded = await loadReceivableSnapshot(invoiceRef);
        if ('error' in loaded) return loaded.error;
        if (!loaded.doc._rev) {
            return NextResponse.json({ error: 'Revisi dokumen tagihan tidak tersedia' }, { status: 409 });
        }

        if (amount > loaded.remainingAmount) {
            return NextResponse.json(
                { error: `Pembayaran melebihi sisa tagihan netto (${loaded.remainingAmount})` },
                { status: 400 }
            );
        }

        const resolvedBank = await resolveReceiptBankAccount(paymentMethod, selectedAccountRef);
        if ('error' in resolvedBank) return resolvedBank.error;
        const { bankAcc } = resolvedBank;

        const nextTotalPaid = loaded.totalPaid + amount;
        const paymentDoc: { _id: string; _type: 'payment'; [key: string]: unknown } = {
            _id: paymentId,
            _type: 'payment',
            ...data,
            invoiceRef,
            date: paymentDate,
            amount,
            method: paymentMethod,
        };
        if (bankAcc) {
            paymentDoc.bankAccountRef = bankAcc._id;
            paymentDoc.bankAccountName = bankAcc.bankName;
            paymentDoc.bankAccountNumber = bankAcc.accountNumber;
        } else {
            delete paymentDoc.bankAccountRef;
            delete paymentDoc.bankAccountName;
            delete paymentDoc.bankAccountNumber;
        }

        const transaction = getSanityClient()
            .transaction()
            .create(paymentDoc)
            .create({
                _id: incomeId,
                _type: 'income',
                sourceType: 'INVOICE_PAYMENT',
                paymentRef: paymentId,
                date: paymentDate,
                amount,
                note: loaded.doc._type === 'freightNota' ? 'Pembayaran nota ongkos' : 'Pembayaran arsip invoice',
            })
            .patch(invoiceRef, {
                ifRevisionID: loaded.doc._rev,
                set: buildReceivablePatch(loaded, nextTotalPaid, loaded.totalAdjustmentAmount),
            });

        if (bankAcc) {
            const nextBankBalance = (bankAcc.currentBalance || 0) + amount;
            transaction
                .create({
                    _id: bankTransactionId,
                    _type: 'bankTransaction',
                    bankAccountRef: bankAcc._id,
                    bankAccountName: bankAcc.bankName,
                    bankAccountNumber: bankAcc.accountNumber,
                    type: 'CREDIT',
                    amount,
                    date: paymentDate,
                    description:
                        bankAcc.accountType === 'CASH'
                            ? 'Pembayaran tunai masuk'
                            : loaded.doc._type === 'freightNota'
                                ? 'Pembayaran nota masuk'
                                : 'Pembayaran arsip invoice masuk',
                    balanceAfter: nextBankBalance,
                    relatedPaymentRef: paymentId,
                })
                .patch(bankAcc._id, {
                    ifRevisionID: bankAcc._rev,
                    set: { currentBalance: nextBankBalance },
                });
        }

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'CREATE',
                'payments',
                paymentId,
                `Pembayaran dicatat untuk ${loaded.doc._type === 'freightNota' ? 'nota' : 'arsip invoice'} ${invoiceRef}`
            );
            return NextResponse.json({ data: paymentDoc, id: paymentId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                const latest = await loadReceivableSnapshot(invoiceRef);
                if (!('error' in latest)) {
                    return NextResponse.json(
                        {
                            error:
                                latest.remainingAmount === 0 || amount > latest.remainingAmount
                                    ? `Pembayaran berubah karena ada transaksi lain. Sisa tagihan sekarang ${latest.remainingAmount}. Muat ulang lalu coba lagi.`
                                    : 'Pembayaran berubah karena ada transaksi lain. Muat ulang lalu coba lagi.',
                        },
                        { status: 409 }
                    );
                }

                return NextResponse.json(
                    { error: 'Pembayaran berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pembayaran berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleCustomerReceiptCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const totalAmount = normalizeCurrencyNumber(data.totalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return NextResponse.json({ error: 'Total penerimaan tidak valid' }, { status: 400 });
    }

    const receiptDate =
        typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10);
    assertIsoDate(receiptDate, 'Tanggal penerimaan');

    const paymentMethod = typeof data.method === 'string' ? data.method as PaymentMethod : 'TRANSFER';
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const rawAllocations = Array.isArray(data.allocations) ? data.allocations : [];
    const allocations = rawAllocations
        .filter(isPlainObject)
        .map<CustomerReceiptAllocationInput>((row) => {
            const invoiceRef = normalizeText(row.invoiceRef);
            const amount = normalizeCurrencyNumber(row.amount);
            const note = normalizeOptionalText(row.note);

            if (!invoiceRef) {
                throw new Error('Semua alokasi penerimaan wajib memilih nota');
            }
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error('Nominal alokasi penerimaan tidak valid');
            }

            return { invoiceRef, amount, note };
        });

    const uniqueInvoiceRefs = [...new Set(allocations.map(item => item.invoiceRef))];
    if (uniqueInvoiceRefs.length !== allocations.length) {
        return NextResponse.json({ error: 'Satu nota hanya boleh muncul sekali dalam 1 penerimaan' }, { status: 400 });
    }

    const totalAllocated = allocations.reduce((sum, item) => sum + item.amount, 0);
    if (totalAllocated - totalAmount > 0.00001) {
        return NextResponse.json(
            { error: `Total alokasi (${totalAllocated}) tidak boleh melebihi total penerimaan (${totalAmount})` },
            { status: 400 }
        );
    }
    const unappliedAmount = Math.max(totalAmount - totalAllocated, 0);

    const explicitCustomerRef = typeof data.customerRef === 'string' && data.customerRef ? data.customerRef : undefined;
    const receiptNote = normalizeOptionalText(data.note);
    if (!explicitCustomerRef && allocations.length === 0) {
        return NextResponse.json({ error: 'Customer wajib dipilih untuk menyimpan kredit customer' }, { status: 400 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        let loadedSnapshots: ReceivableSnapshot[] = [];
        if (allocations.length > 0) {
            const snapshots = await Promise.all(allocations.map(item => loadReceivableSnapshot(item.invoiceRef)));
            for (const result of snapshots) {
                if ('error' in result) {
                    return result.error;
                }
            }

            loadedSnapshots = snapshots as ReceivableSnapshot[];
        }

        let baseCustomerRef = explicitCustomerRef;
        let customerName = '-';
        if (loadedSnapshots.length > 0) {
            const matchedExplicitCustomerRef =
                explicitCustomerRef && loadedSnapshots.every(snapshot => snapshot.customerRef === explicitCustomerRef)
                    ? explicitCustomerRef
                    : undefined;
            const derivedCustomerRef = matchedExplicitCustomerRef ?? loadedSnapshots[0]?.customerRef;
            const baseCustomerName = loadedSnapshots[0]?.customerName || '-';

            if (
                loadedSnapshots.some(snapshot =>
                    (derivedCustomerRef && snapshot.customerRef !== derivedCustomerRef) ||
                    (!derivedCustomerRef && snapshot.customerName !== baseCustomerName)
                )
            ) {
                return NextResponse.json(
                    { error: 'Penerimaan customer hanya boleh dialokasikan ke nota customer yang sama' },
                    { status: 409 }
                );
            }

            baseCustomerRef = derivedCustomerRef;
            customerName = baseCustomerName;
        } else if (explicitCustomerRef) {
            const customer = await sanityGetById<ReceiptCustomerSource>(explicitCustomerRef);
            if (!customer) {
                return NextResponse.json({ error: 'Customer tidak ditemukan' }, { status: 404 });
            }
            if (customer.active === false) {
                return NextResponse.json({ error: 'Customer tidak aktif' }, { status: 409 });
            }
            baseCustomerRef = customer._id;
            customerName = normalizeText(customer.name) || '-';
        }

        for (const snapshot of loadedSnapshots) {
            if (!snapshot.doc._rev) {
                return NextResponse.json({ error: 'Revisi dokumen tagihan tidak tersedia' }, { status: 409 });
            }
        }

        for (const allocation of allocations) {
            const snapshot = loadedSnapshots.find(item => item.doc._id === allocation.invoiceRef);
            if (!snapshot) {
                return NextResponse.json({ error: 'Nota alokasi tidak ditemukan' }, { status: 404 });
            }
            if (allocation.amount > snapshot.remainingAmount) {
                return NextResponse.json(
                    { error: `Alokasi ke ${snapshot.label} melebihi sisa netto (${snapshot.remainingAmount})` },
                    { status: 400 }
                );
            }
        }

        const resolvedBank = await resolveReceiptBankAccount(paymentMethod, selectedAccountRef);
        if ('error' in resolvedBank) return resolvedBank.error;
        const { bankAcc } = resolvedBank;

        const receiptId = crypto.randomUUID();
        const incomeId = crypto.randomUUID();
        const bankTransactionId = crypto.randomUUID();
        const receiptNumber = await sanityGetNextNumber('receipt');
        const transaction = getSanityClient()
            .transaction()
            .create({
                _id: receiptId,
                _type: 'customerReceipt',
                receiptNumber,
                customerRef: baseCustomerRef,
                customerName,
                date: receiptDate,
                totalAmount,
                allocatedAmount: totalAllocated,
                unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
                allocationCount: allocations.length,
                method: paymentMethod,
                bankAccountRef: bankAcc?._id,
                bankAccountName: bankAcc?.bankName,
                bankAccountNumber: bankAcc?.accountNumber,
                note: receiptNote,
            })
            .create({
                _id: incomeId,
                _type: 'income',
                sourceType: 'CUSTOMER_RECEIPT',
                receiptRef: receiptId,
                date: receiptDate,
                amount: totalAmount,
                note: `Penerimaan customer ${receiptNumber}`,
            });

        if (bankAcc) {
            const nextBankBalance = (bankAcc.currentBalance || 0) + totalAmount;
            transaction
                .create({
                    _id: bankTransactionId,
                    _type: 'bankTransaction',
                    bankAccountRef: bankAcc._id,
                    bankAccountName: bankAcc.bankName,
                    bankAccountNumber: bankAcc.accountNumber,
                    type: 'CREDIT',
                    amount: totalAmount,
                    date: receiptDate,
                    description:
                        bankAcc.accountType === 'CASH'
                            ? `Penerimaan tunai customer ${receiptNumber}`
                            : `Penerimaan customer ${receiptNumber}`,
                    balanceAfter: nextBankBalance,
                    relatedReceiptRef: receiptId,
                })
                .patch(bankAcc._id, {
                    ifRevisionID: bankAcc._rev,
                    set: { currentBalance: nextBankBalance },
                });
        }

        const createdPaymentIds: string[] = [];
        for (const allocation of allocations) {
            const snapshot = loadedSnapshots.find(item => item.doc._id === allocation.invoiceRef);
            if (!snapshot || !snapshot.doc._rev) continue;
            const paymentId = crypto.randomUUID();
            createdPaymentIds.push(paymentId);
            transaction
                .create({
                    _id: paymentId,
                    _type: 'payment',
                    invoiceRef: allocation.invoiceRef,
                    receiptRef: receiptId,
                    receiptNumber,
                    bankAccountRef: bankAcc?._id,
                    bankAccountName: bankAcc?.bankName,
                    bankAccountNumber: bankAcc?.accountNumber,
                    date: receiptDate,
                    amount: allocation.amount,
                    method: paymentMethod,
                    note: allocation.note ?? receiptNote,
                })
                .patch(allocation.invoiceRef, {
                    ifRevisionID: snapshot.doc._rev,
                    set: buildReceivablePatch(
                        snapshot,
                        snapshot.totalPaid + allocation.amount,
                        snapshot.totalAdjustmentAmount,
                    ),
                });
        }

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'CREATE',
                'customer-receipts',
                receiptId,
                `Penerimaan ${receiptNumber} diterima untuk customer ${customerName}${allocations.length > 0 ? `, dialokasikan ke ${allocations.length} nota` : ''}${unappliedAmount > 0 ? `, kredit tersisa ${unappliedAmount}` : ''}`
            );
            for (const paymentId of createdPaymentIds) {
                await addAuditLog(
                    session,
                    'CREATE',
                    'payments',
                    paymentId,
                    `Alokasi penerimaan ${receiptNumber} dicatat`
                );
            }
            return NextResponse.json({
                data: {
                    _id: receiptId,
                    _type: 'customerReceipt',
                    receiptNumber,
                    customerRef: baseCustomerRef,
                    customerName,
                    date: receiptDate,
                    totalAmount,
                    allocatedAmount: totalAllocated,
                    unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
                    allocationCount: allocations.length,
                    method: paymentMethod,
                    bankAccountRef: bankAcc?._id,
                    bankAccountName: bankAcc?.bankName,
                    bankAccountNumber: bankAcc?.accountNumber,
                    note: receiptNote,
                },
                id: receiptId,
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Penerimaan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Penerimaan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleInvoiceAdjustmentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi nota wajib diisi' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal klaim/potongan tidak valid' }, { status: 400 });
    }

    const date = typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10);
    assertIsoDate(date, 'Tanggal klaim/potongan');

    const kind = typeof data.kind === 'string' ? data.kind as InvoiceAdjustmentKind : 'OTHER';
    if (!INVOICE_ADJUSTMENT_KIND_SET.has(kind)) {
        return NextResponse.json({ error: 'Jenis klaim/potongan tidak valid' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = await loadReceivableSnapshot(invoiceRef);
        if ('error' in snapshot) return snapshot.error;
        if (!snapshot.doc._rev) {
            return NextResponse.json({ error: 'Revisi dokumen tagihan tidak tersedia' }, { status: 409 });
        }

        const nextAdjustmentAmount = snapshot.totalAdjustmentAmount + amount;
        if (nextAdjustmentAmount > snapshot.grossAmount) {
            return NextResponse.json(
                { error: `Total potongan melebihi nilai bruto tagihan (${snapshot.grossAmount})` },
                { status: 400 }
            );
        }

        const adjustmentId = crypto.randomUUID();
        const transaction = getSanityClient()
            .transaction()
            .create({
                _id: adjustmentId,
                _type: 'invoiceAdjustment',
                invoiceRef,
                customerRef: snapshot.customerRef,
                customerName: snapshot.customerName,
                date,
                amount,
                kind,
                status: 'APPROVED',
                note,
                createdBy: session._id,
                createdByName: session.name,
            })
            .patch(invoiceRef, {
                ifRevisionID: snapshot.doc._rev,
                set: buildReceivablePatch(snapshot, snapshot.totalPaid, nextAdjustmentAmount),
            });

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'CREATE',
                'invoice-adjustments',
                adjustmentId,
                `Potongan/klaim ${amount} dicatat untuk ${snapshot.label}`
            );
            return NextResponse.json({ data: { _id: adjustmentId }, id: adjustmentId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }
            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Klaim/potongan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Klaim/potongan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleInvoiceAdjustmentVoid(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const adjustmentId = typeof data.id === 'string' ? data.id : '';
    if (!adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak valid' }, { status: 400 });
    }

    const adjustment = await sanityGetById<InvoiceAdjustmentDoc & {
        kind?: string;
        note?: string;
    }>(adjustmentId);
    if (!adjustment || adjustment._id !== adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak ditemukan' }, { status: 404 });
    }
    if (adjustment.status === 'VOID') {
        return NextResponse.json({ error: 'Adjustment sudah void' }, { status: 409 });
    }

    const invoiceRef = normalizeText(adjustment.invoiceRef);
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi nota pada adjustment tidak valid' }, { status: 409 });
    }

    const snapshot = await loadReceivableSnapshot(invoiceRef);
    if ('error' in snapshot) return snapshot.error;
    if (!snapshot.doc._rev || !adjustment._rev) {
        return NextResponse.json({ error: 'Revisi adjustment/tagihan tidak tersedia' }, { status: 409 });
    }

    const nextAdjustmentAmount = Math.max(snapshot.totalAdjustmentAmount - normalizeNumber(adjustment.amount || 0), 0);
    await getSanityClient()
        .transaction()
        .patch(adjustmentId, {
            ifRevisionID: adjustment._rev,
            set: {
                status: 'VOID',
                voidedAt: new Date().toISOString(),
                voidedBy: session._id,
                voidedByName: session.name,
            },
        })
        .patch(invoiceRef, {
            ifRevisionID: snapshot.doc._rev,
            set: buildReceivablePatch(snapshot, snapshot.totalPaid, nextAdjustmentAmount),
        })
        .commit();

    await addAuditLog(
        session,
        'UPDATE',
        'invoice-adjustments',
        adjustmentId,
        `Adjustment ${adjustmentId} di-void untuk ${snapshot.label}`
    );
    return NextResponse.json({ success: true });
}

export async function handleBankTransfer(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal transfer tidak valid' }, { status: 400 });
    }

    const fromAccountRef = typeof data.fromAccountRef === 'string' ? data.fromAccountRef : '';
    const toAccountRef = typeof data.toAccountRef === 'string' ? data.toAccountRef : '';
    if (!fromAccountRef || !toAccountRef || fromAccountRef === toAccountRef) {
        return NextResponse.json({ error: 'Rekening transfer tidak valid' }, { status: 400 });
    }

    const transferDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(transferDate, 'Tanggal transfer');

    const transferId = `transfer-${Date.now()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const fromAcc = await getLedgerAccount(fromAccountRef);
        const toAcc = await getLedgerAccount(toAccountRef);
        if (!fromAcc || !toAcc) {
            return NextResponse.json({ error: 'Akun sumber atau tujuan tidak ditemukan' }, { status: 404 });
        }
        if (!fromAcc._rev || !toAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        const fromBalance = (fromAcc.currentBalance || 0) - amount;
        const toBalance = (toAcc.currentBalance || 0) + amount;
        const transaction = getSanityClient()
            .transaction()
            .create({
                _id: `${transferId}-out`,
                _type: 'bankTransaction',
                bankAccountRef: fromAccountRef,
                bankAccountName: fromAcc.bankName,
                bankAccountNumber: fromAcc.accountNumber,
                type: 'TRANSFER_OUT',
                amount,
                date: transferDate,
                description: `Transfer ke ${toAcc.bankName}`,
                balanceAfter: fromBalance,
                relatedTransferRef: transferId,
            })
            .create({
                _id: `${transferId}-in`,
                _type: 'bankTransaction',
                bankAccountRef: toAccountRef,
                bankAccountName: toAcc.bankName,
                bankAccountNumber: toAcc.accountNumber,
                type: 'TRANSFER_IN',
                amount,
                date: transferDate,
                description: `Transfer dari ${fromAcc.bankName}`,
                balanceAfter: toBalance,
                relatedTransferRef: transferId,
            })
            .patch(fromAccountRef, {
                ifRevisionID: fromAcc._rev,
                set: { currentBalance: fromBalance },
            })
            .patch(toAccountRef, {
                ifRevisionID: toAcc._rev,
                set: { currentBalance: toBalance },
            });

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'CREATE',
                'bank-transactions',
                transferId,
                `Transfer ${amount} dari ${fromAcc.bankName} ke ${toAcc.bankName}`
            );
            return NextResponse.json({ success: true, transferId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Transfer berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Transfer berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleExpenseCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const categoryRef = typeof data.categoryRef === 'string' ? data.categoryRef : '';
    if (!categoryRef) {
        return NextResponse.json({ error: 'Kategori pengeluaran wajib dipilih' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pengeluaran tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof data.date === 'string' && data.date ? data.date : new Date().toISOString().slice(0, 10);
    assertIsoDate(expenseDate, 'Tanggal pengeluaran');

    const category = await sanityGetById<{ _id: string; name?: string }>(categoryRef);
    if (!category) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak ditemukan' }, { status: 404 });
    }

    const relatedVehicleRef =
        typeof data.relatedVehicleRef === 'string' && data.relatedVehicleRef ? data.relatedVehicleRef : undefined;
    let relatedVehiclePlate: string | undefined;
    if (relatedVehicleRef) {
        const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(relatedVehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        relatedVehiclePlate = vehicle.plateNumber;
    }

    const requestedPrivacyLevel = data.privacyLevel === 'ownerOnly' ? 'ownerOnly' : 'internal';
    if (requestedPrivacyLevel === 'ownerOnly' && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Hanya OWNER yang boleh membuat pengeluaran owner-only' }, { status: 403 });
    }
    const privacyLevel = requestedPrivacyLevel;

    const expenseDocBase: { _type: 'expense'; [key: string]: unknown } = {
        _type: 'expense',
        categoryRef,
        categoryName: category.name,
        date: expenseDate,
        amount,
        note: normalizeOptionalText(data.note),
        description: normalizeOptionalText(data.description),
        receiptUrl: normalizeOptionalText(data.receiptUrl),
        privacyLevel,
        relatedVehicleRef,
        relatedVehiclePlate,
        relatedIncidentRef: typeof data.relatedIncidentRef === 'string' ? data.relatedIncidentRef : undefined,
        relatedMaintenanceRef: typeof data.relatedMaintenanceRef === 'string' ? data.relatedMaintenanceRef : undefined,
        boronganRef: typeof data.boronganRef === 'string' ? data.boronganRef : undefined,
        voucherRef: typeof data.voucherRef === 'string' ? data.voucherRef : undefined,
    };
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;

    if (!selectedAccountRef) {
        const created = await sanityCreate(expenseDocBase);
        const expenseId = (created as Record<string, unknown>)._id as string;
        await addAuditLog(session, 'CREATE', 'expenses', expenseId, `Created expenses: ${expenseId}`);
        return NextResponse.json({ data: created, id: expenseId });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
        if (!bankAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        const expenseId = crypto.randomUUID();
        const newBalance = (bankAcc.currentBalance || 0) - amount;
        const expenseDoc = {
            _id: expenseId,
            ...expenseDocBase,
            bankAccountRef: selectedAccountRef,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
        };

        const transaction = getSanityClient()
            .transaction()
            .create(expenseDoc)
            .create({
                _id: crypto.randomUUID(),
                _type: 'bankTransaction',
                bankAccountRef: selectedAccountRef,
                bankAccountName: bankAcc.bankName,
                bankAccountNumber: bankAcc.accountNumber,
                type: 'DEBIT',
                amount,
                date: expenseDate,
                description:
                    (typeof data.description === 'string' && data.description) ||
                    (typeof data.note === 'string' && data.note) ||
                    'Pengeluaran',
                balanceAfter: newBalance,
                relatedExpenseRef: expenseId,
            })
            .patch(selectedAccountRef, {
                ifRevisionID: bankAcc._rev,
                set: { currentBalance: newBalance },
            });

        try {
            await transaction.commit();
            await addAuditLog(session, 'CREATE', 'expenses', expenseId, `Created expenses: ${expenseId}`);
            return NextResponse.json({ data: expenseDoc, id: expenseId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Pengeluaran berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pengeluaran berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleFreightNotaCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let billingMode = normalizeFreightNotaBillingMode(data.billingMode);
    let resolvedCustomerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeText(data.customerName);

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    const rows = rawRows
        .filter(isPlainObject)
        .filter(row => !isFreightNotaRowEmpty(row))
        .map<NormalizedFreightNotaRow>(row => {
            const date = normalizeText(row.date);
            const doRef = normalizeOptionalText(row.doRef);
            const doNumber = normalizeOptionalText(row.doNumber);
            const noSJ = normalizeText(row.noSJ);
            const tujuan = normalizeText(row.tujuan);
            const dari = normalizeText(row.dari);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeCurrencyNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if ((!date || !noSJ || !tujuan) && !doRef) {
                throw new Error('Baris nota wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if ((!Number.isFinite(beratKg) || beratKg <= 0) && !doRef) {
                throw new Error('Berat pada baris nota harus lebih besar dari 0');
            }
            if (!Number.isFinite(tarip) || tarip <= 0) {
                throw new Error('Tarif nota pada baris harus lebih besar dari 0');
            }
            if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris nota tidak valid');
            }

            return {
                doRef,
                doNumber,
                vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                date,
                noSJ,
                dari,
                tujuan,
                barang: normalizeOptionalText(row.barang),
                collie: collie > 0 ? collie : undefined,
                beratKg,
                tarip,
                uangRp: normalizeFreightNotaAmount(calculateFreightNotaRowAmount({ beratKg, tarip, billingMode })),
                ket: normalizeOptionalText(row.ket),
            };
        });

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris nota wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    if (uniqueDoRefs.length !== doRefs.length) {
        return NextResponse.json({ error: 'DO yang sama tidak boleh dimasukkan dua kali dalam nota' }, { status: 400 });
    }

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<Array<{
            _id: string;
            status?: string;
            orderRef?: unknown;
            doNumber?: string;
            customerDoNumber?: string;
            vehiclePlate?: string;
            pickupAddress?: string;
            receiverAddress?: string;
            date?: string;
        }>>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                status,
                orderRef,
                doNumber,
                customerDoNumber,
                vehiclePlate,
                pickupAddress,
                receiverAddress,
                date
            }`,
            { ids: uniqueDoRefs }
        )
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO nota tidak ditemukan' }, { status: 404 });
    }

    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await getSanityClient().fetch<FreightNotaOrderSource[]>(
            `*[_type == "order" && _id in $ids]{
                _id,
                customerRef,
                pickupAddress,
                receiverAddress
            }`,
            { ids: orderRefs }
        )
        : [];
    const deliveryOrderItems = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<FreightNotaDeliveryOrderItemSource[]>(
            `*[_type == "deliveryOrderItem" && deliveryOrderRef in $ids]{
                deliveryOrderRef,
                orderItemDescription,
                orderItemQtyKoli,
                orderItemWeight,
                actualQtyKoli,
                actualWeightKg
            }`,
            { ids: uniqueDoRefs }
        )
        : [];

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(sourceOrders.map(order => [order._id, order]));
    const doItemMap = new Map<string, FreightNotaDeliveryOrderItemSource[]>();
    for (const item of deliveryOrderItems) {
        const deliveryOrderRef = normalizeOptionalText(item.deliveryOrderRef);
        if (!deliveryOrderRef) continue;
        const current = doItemMap.get(deliveryOrderRef) || [];
        current.push(item);
        doItemMap.set(deliveryOrderRef, current);
    }

    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'DO nota tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status !== 'DELIVERED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} belum selesai dikirim` }, { status: 409 });
        }
        const orderRef = extractRefId(deliveryOrder.orderRef);
        const sourceOrder = orderRef ? orderMap.get(orderRef) : undefined;
        const itemSummary = summarizeDeliveryOrderItems(doItemMap.get(row.doRef) || []);

        row.doNumber = normalizeOptionalText(deliveryOrder.doNumber) || row.doNumber;
        row.noSJ =
            normalizeOptionalText(deliveryOrder.customerDoNumber) ||
            row.noSJ ||
            '';
        row.vehiclePlate = normalizeOptionalText(deliveryOrder.vehiclePlate) || row.vehiclePlate;
        row.date = normalizeOptionalText(deliveryOrder.date) || row.date || '';
        row.dari =
            normalizeOptionalText(deliveryOrder.pickupAddress) ||
            normalizeOptionalText(sourceOrder?.pickupAddress) ||
            row.dari ||
            '';
        row.tujuan =
            normalizeOptionalText(deliveryOrder.receiverAddress) ||
            normalizeOptionalText(sourceOrder?.receiverAddress) ||
            row.tujuan ||
            '';
        row.barang = itemSummary.barang || row.barang || undefined;
        if (itemSummary.collie > 0) {
            row.collie = itemSummary.collie;
        } else if (!row.collie || row.collie <= 0) {
            row.collie = undefined;
        }
        if (itemSummary.beratKg > 0) {
            row.beratKg = itemSummary.beratKg;
        } else if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
            row.beratKg = itemSummary.beratKg;
        }
        row.uangRp = normalizeFreightNotaAmount(
            calculateFreightNotaRowAmount({ beratKg: row.beratKg, tarip: row.tarip, billingMode })
        );
    }

    for (const row of rows) {
        if (!row.date || !row.noSJ || !row.tujuan) {
            return NextResponse.json(
                { error: `Baris nota ${row.doNumber || row.noSJ || row.doRef || ''} masih kurang tanggal, nomor SJ, atau tujuan` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
            return NextResponse.json(
                { error: `Berat pada baris nota ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            return NextResponse.json(
                { error: `Tarif nota pada baris ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = normalizeFreightNotaAmount(
            calculateFreightNotaRowAmount({ beratKg: row.beratKg, tarip: row.tarip, billingMode })
        );
    }

    if (uniqueDoRefs.length > 0) {
        const existingNotaItems = await getSanityClient().fetch<Array<{ doRef?: string; doNumber?: string }>>(
            `*[_type == "freightNotaItem" && doRef in $ids]{ doRef, doNumber }`,
            { ids: uniqueDoRefs }
        );
        if (existingNotaItems.length > 0) {
            const duplicate = existingNotaItems[0];
            return NextResponse.json(
                { error: `DO ${duplicate.doNumber || duplicate.doRef || ''} sudah tercantum di nota lain` },
                { status: 409 }
            );
        }
    }

    const orderCustomerMap = new Map(
        sourceOrders.map(order => [order._id, extractRefId(order.customerRef)])
    );
    const inferredCustomerRefs = [...new Set(
        deliveryOrders
            .map(deliveryOrder => {
                const orderRef = extractRefId(deliveryOrder.orderRef);
                return orderRef ? orderCustomerMap.get(orderRef) : undefined;
            })
            .filter((ref): ref is string => Boolean(ref))
    )];

    if (inferredCustomerRefs.length > 1) {
        return NextResponse.json(
            { error: 'DO yang dipilih berasal dari customer berbeda. Pisahkan per nota.' },
            { status: 409 }
        );
    }

    const inferredCustomerRef = inferredCustomerRefs[0];
    if (resolvedCustomerRef && inferredCustomerRef && resolvedCustomerRef !== inferredCustomerRef) {
        return NextResponse.json(
            { error: 'Customer nota tidak cocok dengan customer pada DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedCustomerRef && inferredCustomerRef) {
        resolvedCustomerRef = inferredCustomerRef;
    }

    if (resolvedCustomerRef && deliveryOrders.length > 0) {
        for (const deliveryOrder of deliveryOrders) {
            const orderRef = extractRefId(deliveryOrder.orderRef);
            if (orderRef && orderCustomerMap.get(orderRef) !== resolvedCustomerRef) {
                return NextResponse.json(
                    { error: `DO ${deliveryOrder.doNumber || deliveryOrder._id} bukan milik customer yang dipilih` },
                    { status: 409 }
                );
            }
        }
    }

    const issueDate = normalizeText(data.issueDate) || new Date().toISOString().slice(0, 10);
    const customerDerivedFromDo = Boolean(inferredCustomerRef && inferredCustomerRef === resolvedCustomerRef && deliveryOrders.length > 0);
    let finalCustomerName = customerName;
    let finalCustomerAddress = normalizeOptionalText(data.customerAddress);
    let finalCustomerContactPerson = normalizeOptionalText(data.customerContactPerson);
    let finalCustomerPhone = normalizeOptionalText(data.customerPhone);
    let customerTermDays: number | null = null;
    if (resolvedCustomerRef) {
        const customerDoc = await getSanityClient().fetch<{
            _id: string;
            name?: string;
            address?: string;
            contactPerson?: string;
            phone?: string;
            defaultPaymentTerm?: number;
            defaultFreightNotaBillingMode?: string;
            active?: boolean;
        } | null>(
            `*[_type == "customer" && _id == $id][0]{ _id, name, address, contactPerson, phone, defaultPaymentTerm, defaultFreightNotaBillingMode, active }`,
            { id: resolvedCustomerRef }
        );
        if (!customerDoc) {
            return NextResponse.json({ error: 'Customer nota tidak ditemukan' }, { status: 404 });
        }
        if (customerDoc.active === false && !customerDerivedFromDo) {
            return NextResponse.json({ error: 'Customer nota tidak aktif untuk nota manual' }, { status: 409 });
        }
        if (customerDoc?.name) {
            finalCustomerName = customerDoc.name;
        }
        finalCustomerAddress = normalizeOptionalText(customerDoc?.address) || finalCustomerAddress;
        finalCustomerContactPerson = normalizeOptionalText(customerDoc?.contactPerson) || finalCustomerContactPerson;
        finalCustomerPhone = normalizeOptionalText(customerDoc?.phone) || finalCustomerPhone;
        if (typeof customerDoc?.defaultPaymentTerm === 'number' && Number.isFinite(customerDoc.defaultPaymentTerm) && customerDoc.defaultPaymentTerm >= 0) {
            customerTermDays = customerDoc.defaultPaymentTerm;
        }
        if (!Object.prototype.hasOwnProperty.call(data, 'billingMode')) {
            billingMode = normalizeFreightNotaBillingMode(customerDoc?.defaultFreightNotaBillingMode);
            for (const row of rows) {
                row.uangRp = normalizeFreightNotaAmount(
                    calculateFreightNotaRowAmount({ beratKg: row.beratKg, tarip: row.tarip, billingMode })
                );
            }
        }
    }
    if (!finalCustomerName) {
        return NextResponse.json({ error: 'Nama customer nota wajib diisi' }, { status: 400 });
    }

    const totalAmount = normalizeFreightNotaAmount(rows.reduce((sum, row) => sum + row.uangRp, 0));
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total nota harus lebih besar dari 0' }, { status: 400 });
    }

    const notaId = crypto.randomUUID();
    const notaNumber = await sanityGetNextNumber('nota');
    const {
        instructionAccounts,
        notaSeriesCode,
        footerNote,
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
    } = await loadFreightNotaDocumentSettings();
    const notaDisplayNumber = buildFreightNotaDisplayNumberFromParts(
        notaNumber,
        issueDate,
        notaSeriesCode,
    );
    let resolvedDueDate = normalizeOptionalText(data.dueDate);
    if (!resolvedDueDate) {
        let termDays = customerTermDays;
        if (termDays === null) {
            const companyDoc = await getSanityClient().fetch<{
                invoiceSettings?: {
                    dueDateDays?: number;
                    defaultTermDays?: number;
                };
            } | null>(
                `*[_type == "companyProfile"][0]{ invoiceSettings }`
            );
            const companyTerm = companyDoc?.invoiceSettings?.dueDateDays ?? companyDoc?.invoiceSettings?.defaultTermDays;
            if (typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0) {
                termDays = companyTerm;
            }
        }

        if (termDays !== null) {
            const dueDate = new Date(issueDate);
            if (!Number.isNaN(dueDate.getTime())) {
                dueDate.setDate(dueDate.getDate() + termDays);
                resolvedDueDate = dueDate.toISOString().slice(0, 10);
            }
        }
    }

    const notaDoc = {
        _id: notaId,
        _type: 'freightNota',
        issuerCompanyName,
        issuerCompanyAddress,
        issuerCompanyPhone,
        issuerCompanyEmail,
        issuerCompanyLogoUrl,
        issuerCompanySignatureStampUrl,
        issuerCompanySignatureName,
        issuerCompanyNpwp,
        customerRef: resolvedCustomerRef,
        customerName: finalCustomerName,
        customerAddress: finalCustomerAddress,
        customerContactPerson: finalCustomerContactPerson,
        customerPhone: finalCustomerPhone,
        issueDate,
        notaDisplayNumber,
        dueDate: resolvedDueDate,
        status: 'UNPAID',
        totalAmount,
        totalAdjustmentAmount: 0,
        netAmount: totalAmount,
        totalCollie,
        totalWeightKg,
        billingMode,
        instructionAccounts: instructionAccounts.length > 0 ? instructionAccounts : undefined,
        footerNote,
        notes: normalizeOptionalText(data.notes),
        notaNumber,
    };

    const transaction = getSanityClient().transaction().create(notaDoc);
    for (const row of rows) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'freightNotaItem',
            notaRef: notaId,
            doRef: row.doRef,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
            dari: row.dari,
            tujuan: row.tujuan,
            barang: row.barang,
            collie: row.collie,
            beratKg: row.beratKg,
            tarip: row.tarip,
            uangRp: row.uangRp,
            ket: row.ket,
        });
    }

    await transaction.commit();
    await addAuditLog(session, 'CREATE', 'freight-notas', notaId, `Created freight-notas: ${notaNumber}`);
    return NextResponse.json({ data: notaDoc, id: notaId });
}

export async function handleFreightNotaDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Nota tidak valid' }, { status: 400 });
    }

    const nota = await sanityGetById<{ _id: string; notaNumber?: string }>(id);
    if (!nota) {
        return NextResponse.json({ error: 'Nota tidak ditemukan' }, { status: 404 });
    }

    const existingPayments = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[_type == "payment" && invoiceRef == $ref]{ _id }`,
        { ref: id }
    );
    if (existingPayments.length > 0) {
        return NextResponse.json({ error: 'Nota yang sudah punya pembayaran tidak boleh dihapus' }, { status: 409 });
    }

    const existingAdjustments = await getSanityClient().fetch<Array<{ _id: string }>>(
        `*[_type == "invoiceAdjustment" && invoiceRef == $ref && status == "APPROVED"]{ _id }`,
        { ref: id }
    );
    if (existingAdjustments.length > 0) {
        return NextResponse.json({ error: 'Nota yang sudah punya klaim/potongan tidak boleh dihapus' }, { status: 409 });
    }

    const itemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "freightNotaItem" && notaRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const itemId of itemIds) {
        transaction.delete(itemId);
    }
    transaction.delete(id);
    await transaction.commit();

    await addAuditLog(session, 'DELETE', 'freight-notas', id, `Deleted freight-notas ${nota.notaNumber || id}`);
    return NextResponse.json({ success: true });
}
