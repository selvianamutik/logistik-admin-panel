import { NextResponse } from 'next/server';

import { addDaysToDateValue, getBusinessDateValue } from '@/lib/business-date';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import {
    calculateFreightNotaRowAmount,
    normalizeFreightNotaBillingMode,
    resolveFreightNotaBillingModeInput,
} from '@/lib/freight-nota-billing';
import { getSanityClient, sanityCreate, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import { buildFreightNotaDisplayNumberFromParts } from '@/lib/nota-numbering';
import { DEFAULT_PPH23_RATE_PERCENT, normalizePph23BaseMode, normalizePph23Enabled, normalizePph23RatePercent } from '@/lib/pph23';
import type {
    CustomerOverpaymentRefund,
    FreightNotaInstructionAccount,
    InvoiceAdjustmentKind,
    Payment,
    PaymentMethod,
    Pph23BaseMode,
} from '@/lib/types';

import {
    assertIsoDate,
    computeLedgerDebitBalance,
    ensureCashAccount,
    extractRefId,
    getLedgerAccount,
    isMutationConflictError,
    isPlainObject,
    normalizeCurrencyNumber,
    normalizeNumber,
    normalizeOptionalText,
    normalizePaymentMethod,
    normalizeText,
    readLedgerBalance,
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

function validateIsoDateOrResponse(dateValue: string, label: string, fallbackMessage: string) {
    try {
        assertIsoDate(dateValue, label);
        return null;
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : fallbackMessage },
            { status: 400 }
        );
    }
}

function normalizeFreightNotaAmount(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.round(value);
}

function normalizeWholeMoneyAmount(value: unknown) {
    const normalized = normalizeNumber(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return 0;
    }
    return Math.round(normalized);
}

function formatAuditMoney(amount: number) {
    return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

function normalizePph23SettingsInput(
    data: Record<string, unknown>,
    fallback?: {
        enabled?: boolean;
        ratePercent?: number;
        baseMode?: Pph23BaseMode;
    }
) {
    const enabled = Object.prototype.hasOwnProperty.call(data, 'pph23Enabled')
        ? normalizePph23Enabled(data.pph23Enabled, fallback?.enabled ?? false)
        : fallback?.enabled ?? false;
    const ratePercent = Object.prototype.hasOwnProperty.call(data, 'pph23RatePercent')
        ? normalizePph23RatePercent(data.pph23RatePercent, fallback?.ratePercent ?? DEFAULT_PPH23_RATE_PERCENT)
        : fallback?.ratePercent ?? DEFAULT_PPH23_RATE_PERCENT;
    const baseMode = Object.prototype.hasOwnProperty.call(data, 'pph23BaseMode')
        ? normalizePph23BaseMode(data.pph23BaseMode, fallback?.baseMode ?? 'BEFORE_CLAIM')
        : fallback?.baseMode ?? 'BEFORE_CLAIM';

    if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
        throw new Error('Tarif PPh 23 tidak valid');
    }
    if (enabled && ratePercent <= 0) {
        throw new Error('Tarif PPh 23 harus lebih dari 0%');
    }

    return {
        pph23Enabled: enabled,
        pph23RatePercent: ratePercent,
        pph23BaseMode: baseMode,
    };
}

function buildExpenseAuditSummary(input: {
    amount: number;
    categoryName?: string;
    bankName?: string;
    note?: string;
    description?: string;
}) {
    const contextLabel = normalizeOptionalText(input.note) || normalizeOptionalText(input.description);
    const summary = [
        `Pengeluaran ${formatAuditMoney(input.amount)}`,
        input.categoryName ? `untuk ${input.categoryName}` : '',
        input.bankName ? `via ${input.bankName}` : 'tanpa rekening',
    ]
        .filter(Boolean)
        .join(' ');

    return contextLabel ? `${summary} - ${contextLabel}` : summary;
}

function sanitizePatchSet(input: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined)
    );
}

function parseOptionalStrictNotaRowNumber(
    value: unknown,
    label: string,
    options?: { allowDecimal?: boolean; maxFractionDigits?: number }
) {
    if (value === undefined || value === null) {
        return 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return 0;
        }
        if (!/[0-9]/.test(trimmed) || /[a-z]/i.test(trimmed)) {
            throw new Error(label);
        }
    }

    const normalized = normalizeNumber(value, options);
    if (!Number.isFinite(normalized)) {
        throw new Error(label);
    }
    return normalized;
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

    const [allPayments, approvedAdjustments, overpaymentRefunds] = await Promise.all([
        getSanityClient().fetch<Payment[]>(
            `*[_type == "payment" && invoiceRef == $ref]`,
            { ref: invoiceRef }
        ),
        getSanityClient().fetch<InvoiceAdjustmentDoc[]>(
            `*[_type == "invoiceAdjustment" && invoiceRef == $ref && status == "APPROVED"]`,
            { ref: invoiceRef }
        ),
        getSanityClient().fetch<Array<Pick<CustomerOverpaymentRefund, 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "INVOICE_OVERPAID" && sourceInvoiceRef == $ref]{
                amount
            }`,
            { ref: invoiceRef }
        ),
    ]);

    return computeReceivableSnapshot(
        doc,
        allPayments,
        approvedAdjustments,
        overpaymentRefunds.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0)
    );
}

async function loadReceiptOverpaymentSnapshot(receiptRef: string) {
    const receipt = await sanityGetById<{
        _id: string;
        _rev?: string;
        _type?: string;
        receiptNumber?: string;
        customerRef?: string;
        customerName?: string;
        totalAmount?: unknown;
        date?: string;
    }>(receiptRef);
    if (!receipt || receipt._id !== receiptRef || receipt._type !== 'customerReceipt') {
        return { error: NextResponse.json({ error: 'Penerimaan customer tidak ditemukan' }, { status: 404 }) };
    }

    const [receiptPayments, refunds] = await Promise.all([
        getSanityClient().fetch<Array<Pick<Payment, 'amount'>>>(
            `*[_type == "payment" && receiptRef == $ref]{ amount }`,
            { ref: receiptRef }
        ),
        getSanityClient().fetch<Array<Pick<CustomerOverpaymentRefund, 'amount'>>>(
            `*[_type == "customerOverpaymentRefund" && sourceType == "RECEIPT_UNAPPLIED" && sourceReceiptRef == $ref]{
                amount
            }`,
            { ref: receiptRef }
        ),
    ]);

    const totalAmount = normalizeWholeMoneyAmount(receipt.totalAmount);
    const allocatedAmount = receiptPayments.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0);
    const rawOverpaymentAmount = Math.max(totalAmount - allocatedAmount, 0);
    const refundedOverpaymentAmount = Math.min(
        refunds.reduce((sum, item) => sum + normalizeWholeMoneyAmount(item.amount), 0),
        rawOverpaymentAmount
    );
    const openOverpaymentAmount = Math.max(rawOverpaymentAmount - refundedOverpaymentAmount, 0);

    return {
        receipt,
        totalAmount,
        allocatedAmount,
        rawOverpaymentAmount,
        refundedOverpaymentAmount,
        openOverpaymentAmount,
    };
}

function buildCustomerReceiptOverpaymentPatch(params: {
    totalAmount: number;
    allocatedAmount: number;
    refundedOverpaymentAmount: number;
}) {
    const unappliedAmount = Math.max(params.totalAmount - params.allocatedAmount, 0);
    const refundedOverpaymentAmount = Math.min(
        Math.max(params.refundedOverpaymentAmount, 0),
        unappliedAmount
    );
    const openOverpaymentAmount = Math.max(unappliedAmount - refundedOverpaymentAmount, 0);

    return {
        allocatedAmount: params.allocatedAmount,
        unappliedAmount: unappliedAmount > 0 ? unappliedAmount : undefined,
        refundedOverpaymentAmount: refundedOverpaymentAmount > 0 ? refundedOverpaymentAmount : undefined,
        openOverpaymentAmount: openOverpaymentAmount > 0 ? openOverpaymentAmount : undefined,
        overpaymentStatus:
            openOverpaymentAmount > 0
                ? 'OPEN'
                : refundedOverpaymentAmount > 0
                    ? 'REFUNDED'
                    : undefined,
    };
}

function validateAdjustmentChangeAgainstRefunds(
    snapshot: ReceivableSnapshot,
    nextAdjustmentAmount: number
) {
    const nextNetAmount = buildReceivablePatch(
        snapshot,
        snapshot.totalPaid,
        nextAdjustmentAmount
    ).netAmount;
    const nextRawOverpaymentAmount = Math.max(snapshot.paidBeforeRefund - nextNetAmount, 0);
    if (snapshot.refundedOverpaymentAmount > nextRawOverpaymentAmount) {
        return NextResponse.json(
            {
                error: 'Potongan tidak bisa dikurangi karena kelebihan bayar dari nota ini sudah dikonfirmasi transfer balik. Batalkan refund terkait dulu jika memang perlu.',
            },
            { status: 409 }
        );
    }
    return null;
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

    const paymentMethod = normalizePaymentMethod(data.method);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode pembayaran tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paymentDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const paymentDateError = validateIsoDateOrResponse(paymentDate, 'Tanggal pembayaran', 'Tanggal pembayaran tidak valid');
    if (paymentDateError) {
        return paymentDateError;
    }

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
        const paymentNote = normalizeOptionalText(data.note);
        const paymentAttachmentUrl = normalizeOptionalText(data.attachmentUrl);
        const paymentDoc: { _id: string; _type: 'payment'; [key: string]: unknown } = {
            _id: paymentId,
            _type: 'payment',
            invoiceRef,
            date: paymentDate,
            amount,
            method: paymentMethod,
        };
        if (paymentNote) {
            paymentDoc.note = paymentNote;
        }
        if (paymentAttachmentUrl) {
            paymentDoc.attachmentUrl = paymentAttachmentUrl;
        }
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
            const nextBankBalance = readLedgerBalance(bankAcc.currentBalance) + amount;
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
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const receiptDateError = validateIsoDateOrResponse(receiptDate, 'Tanggal penerimaan', 'Tanggal penerimaan tidak valid');
    if (receiptDateError) {
        return receiptDateError;
    }

    const paymentMethod = normalizePaymentMethod(data.method);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode penerimaan tidak valid' }, { status: 400 });
    }
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
            if (
                explicitCustomerRef &&
                loadedSnapshots.some(snapshot => snapshot.customerRef && snapshot.customerRef !== explicitCustomerRef)
            ) {
                return NextResponse.json(
                    { error: 'Customer penerimaan tidak cocok dengan nota yang dipilih' },
                    { status: 409 }
                );
            }

            const derivedCustomerRef = explicitCustomerRef ?? loadedSnapshots[0]?.customerRef;
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
        const receiptNumber = await sanityGetNextNumber('receipt', receiptDate);
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
            const nextBankBalance = readLedgerBalance(bankAcc.currentBalance) + totalAmount;
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

    const date = typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const adjustmentDateError = validateIsoDateOrResponse(date, 'Tanggal klaim/potongan', 'Tanggal klaim/potongan tidak valid');
    if (adjustmentDateError) {
        return adjustmentDateError;
    }

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

export async function handleInvoiceAdjustmentUpdate(
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
        date?: string;
        customerName?: string;
    }>(adjustmentId);
    if (!adjustment || adjustment._id !== adjustmentId) {
        return NextResponse.json({ error: 'Adjustment tidak ditemukan' }, { status: 404 });
    }
    if (adjustment.status === 'VOID') {
        return NextResponse.json({ error: 'Adjustment yang sudah dihapus/void tidak bisa diedit' }, { status: 409 });
    }

    const invoiceRef = normalizeText(adjustment.invoiceRef);
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi nota pada adjustment tidak valid' }, { status: 409 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal klaim/potongan tidak valid' }, { status: 400 });
    }

    const date = typeof data.date === 'string' && data.date ? data.date : adjustment.date || getBusinessDateValue();
    const adjustmentDateError = validateIsoDateOrResponse(date, 'Tanggal klaim/potongan', 'Tanggal klaim/potongan tidak valid');
    if (adjustmentDateError) {
        return adjustmentDateError;
    }

    const kind = typeof data.kind === 'string' ? data.kind as InvoiceAdjustmentKind : adjustment.kind as InvoiceAdjustmentKind;
    if (!INVOICE_ADJUSTMENT_KIND_SET.has(kind)) {
        return NextResponse.json({ error: 'Jenis klaim/potongan tidak valid' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);
    const previousAmount = normalizeWholeMoneyAmount(adjustment.amount);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const snapshot = await loadReceivableSnapshot(invoiceRef);
        if ('error' in snapshot) return snapshot.error;
        if (!snapshot.doc._rev || !adjustment._rev) {
            return NextResponse.json({ error: 'Revisi adjustment/tagihan tidak tersedia' }, { status: 409 });
        }

        const nextAdjustmentAmount = Math.max(snapshot.totalAdjustmentAmount - previousAmount + amount, 0);
        if (nextAdjustmentAmount > snapshot.grossAmount) {
            return NextResponse.json(
                { error: `Total potongan melebihi nilai bruto tagihan (${snapshot.grossAmount})` },
                { status: 400 }
            );
        }

        const refundConflict = validateAdjustmentChangeAgainstRefunds(snapshot, nextAdjustmentAmount);
        if (refundConflict) {
            return refundConflict;
        }

        const transaction = getSanityClient()
            .transaction()
            .patch(adjustmentId, {
                ifRevisionID: adjustment._rev,
                set: {
                    date,
                    amount,
                    kind,
                    note,
                    editedAt: new Date().toISOString(),
                    editedBy: session._id,
                    editedByName: session.name,
                },
                unset: note ? [] : ['note'],
            })
            .patch(invoiceRef, {
                ifRevisionID: snapshot.doc._rev,
                set: buildReceivablePatch(snapshot, snapshot.totalPaid, nextAdjustmentAmount),
            });

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'UPDATE',
                'invoice-adjustments',
                adjustmentId,
                `Potongan/klaim ${adjustmentId} diperbarui untuk ${snapshot.label}`
            );
            return NextResponse.json({ success: true, id: adjustmentId });
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

async function finalizeInvoiceAdjustmentDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
    auditAction: 'UPDATE' | 'DELETE',
    auditVerb: string
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
        return NextResponse.json({ error: 'Adjustment sudah dihapus/void' }, { status: 409 });
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
    const refundConflict = validateAdjustmentChangeAgainstRefunds(snapshot, nextAdjustmentAmount);
    if (refundConflict) {
        return refundConflict;
    }

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
        auditAction,
        'invoice-adjustments',
        adjustmentId,
        `Adjustment ${adjustmentId} ${auditVerb} untuk ${snapshot.label}`
    );
    return NextResponse.json({ success: true });
}

export async function handleInvoiceAdjustmentVoid(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    return finalizeInvoiceAdjustmentDelete(session, data, addAuditLog, 'UPDATE', 'di-void');
}

export async function handleInvoiceAdjustmentDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    return finalizeInvoiceAdjustmentDelete(session, data, addAuditLog, 'DELETE', 'dihapus');
}

export async function handleCustomerOverpaymentRefund(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const sourceType =
        data.sourceType === 'RECEIPT_UNAPPLIED' || data.sourceType === 'INVOICE_OVERPAID'
            ? data.sourceType
            : null;
    if (!sourceType) {
        return NextResponse.json({ error: 'Sumber kelebihan bayar tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal refund kelebihan bayar tidak valid' }, { status: 400 });
    }

    const refundDate =
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const refundDateError = validateIsoDateOrResponse(refundDate, 'Tanggal refund kelebihan bayar', 'Tanggal refund kelebihan bayar tidak valid');
    if (refundDateError) {
        return refundDateError;
    }

    const bankAccountRef = typeof data.bankAccountRef === 'string' ? data.bankAccountRef : '';
    if (!bankAccountRef) {
        return NextResponse.json({ error: 'Rekening atau kas sumber refund wajib dipilih' }, { status: 400 });
    }

    const note = normalizeOptionalText(data.note);
    const requestedReceiptRef =
        sourceType === 'RECEIPT_UNAPPLIED' && typeof data.sourceReceiptRef === 'string'
            ? data.sourceReceiptRef
            : '';
    const requestedInvoiceRef =
        sourceType === 'INVOICE_OVERPAID' && typeof data.sourceInvoiceRef === 'string'
            ? data.sourceInvoiceRef
            : '';

    if (sourceType === 'RECEIPT_UNAPPLIED' && !requestedReceiptRef) {
        return NextResponse.json({ error: 'Referensi penerimaan customer wajib diisi' }, { status: 400 });
    }
    if (sourceType === 'INVOICE_OVERPAID' && !requestedInvoiceRef) {
        return NextResponse.json({ error: 'Referensi nota wajib diisi' }, { status: 400 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const bankAcc = await getLedgerAccount(bankAccountRef);
        if (!bankAcc) {
            return NextResponse.json({ error: 'Rekening atau kas sumber refund tidak ditemukan' }, { status: 404 });
        }
        if (!bankAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        let customerRef: string | undefined;
        let customerName = '-';
        let sourceReceiptRef: string | undefined;
        let sourceReceiptNumber: string | undefined;
        let sourceInvoiceRef: string | undefined;
        let sourceInvoiceNumber: string | undefined;
        let openRefundableAmount = 0;
        let receiptPatch:
            | {
                receiptRef: string;
                receiptRev: string;
                totalAmount: number;
                allocatedAmount: number;
                nextRefundedOverpaymentAmount: number;
            }
            | undefined;
        let invoicePatch:
            | {
                invoiceRef: string;
                invoiceRev: string;
                nextTotalPaid: number;
                totalAdjustmentAmount: number;
                snapshot: ReceivableSnapshot;
            }
            | undefined;

        if (sourceType === 'RECEIPT_UNAPPLIED') {
            const receiptSnapshot = await loadReceiptOverpaymentSnapshot(requestedReceiptRef);
            if ('error' in receiptSnapshot) return receiptSnapshot.error;
            if (!receiptSnapshot.receipt._rev) {
                return NextResponse.json({ error: 'Revisi penerimaan customer tidak tersedia' }, { status: 409 });
            }

            sourceReceiptRef = receiptSnapshot.receipt._id;
            sourceReceiptNumber = normalizeOptionalText(receiptSnapshot.receipt.receiptNumber);
            customerRef = normalizeOptionalText(receiptSnapshot.receipt.customerRef) || undefined;
            customerName = normalizeText(receiptSnapshot.receipt.customerName) || '-';
            openRefundableAmount = receiptSnapshot.openOverpaymentAmount;
            receiptPatch = {
                receiptRef: receiptSnapshot.receipt._id,
                receiptRev: receiptSnapshot.receipt._rev,
                totalAmount: receiptSnapshot.totalAmount,
                allocatedAmount: receiptSnapshot.allocatedAmount,
                nextRefundedOverpaymentAmount: Math.min(
                    receiptSnapshot.refundedOverpaymentAmount + amount,
                    receiptSnapshot.rawOverpaymentAmount
                ),
            };
        } else {
            const snapshot = await loadReceivableSnapshot(requestedInvoiceRef);
            if ('error' in snapshot) return snapshot.error;
            if (snapshot.doc._type !== 'freightNota') {
                return NextResponse.json(
                    { error: 'Refund kelebihan bayar aktif hanya didukung untuk nota ongkos' },
                    { status: 409 }
                );
            }
            if (!snapshot.doc._rev) {
                return NextResponse.json({ error: 'Revisi dokumen tagihan tidak tersedia' }, { status: 409 });
            }

            sourceInvoiceRef = requestedInvoiceRef;
            sourceInvoiceNumber = normalizeOptionalText(snapshot.doc.notaNumber);
            customerRef = snapshot.customerRef;
            customerName = snapshot.customerName;
            openRefundableAmount = snapshot.creditAmount;
            invoicePatch = {
                invoiceRef: requestedInvoiceRef,
                invoiceRev: snapshot.doc._rev,
                nextTotalPaid: Math.max(snapshot.totalPaid - amount, 0),
                totalAdjustmentAmount: snapshot.totalAdjustmentAmount,
                snapshot,
            };
        }

        if (openRefundableAmount <= 0) {
            return NextResponse.json({ error: 'Tidak ada kelebihan bayar terbuka untuk ditransfer balik' }, { status: 409 });
        }
        if (amount > openRefundableAmount) {
            return NextResponse.json(
                { error: `Nominal refund melebihi kelebihan bayar terbuka (${openRefundableAmount})` },
                { status: 400 }
            );
        }

        const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankAcc.currentBalance, amount);
        if (nextBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bankAcc.bankName} tidak cukup untuk refund. Saldo tersedia ${startingBalance}` },
                { status: 409 }
            );
        }

        const refundId = crypto.randomUUID();
        const bankTransactionId = crypto.randomUUID();
        const transaction = getSanityClient()
            .transaction()
            .create({
                _id: refundId,
                _type: 'customerOverpaymentRefund',
                sourceType,
                sourceReceiptRef,
                sourceReceiptNumber,
                sourceInvoiceRef,
                sourceInvoiceNumber,
                customerRef,
                customerName,
                date: refundDate,
                amount,
                bankAccountRef: bankAcc._id,
                bankAccountName: bankAcc.bankName,
                bankAccountNumber: bankAcc.accountNumber,
                bankTransactionRef: bankTransactionId,
                note,
                createdBy: session._id,
                createdByName: session.name,
            })
            .create({
                _id: bankTransactionId,
                _type: 'bankTransaction',
                bankAccountRef: bankAcc._id,
                bankAccountName: bankAcc.bankName,
                bankAccountNumber: bankAcc.accountNumber,
                type: 'DEBIT',
                amount,
                date: refundDate,
                description:
                    sourceType === 'RECEIPT_UNAPPLIED'
                        ? `Refund kelebihan bayar customer ${sourceReceiptNumber || sourceReceiptRef || ''}`.trim()
                        : `Refund kelebihan bayar nota ${sourceInvoiceNumber || sourceInvoiceRef || ''}`.trim(),
                balanceAfter: nextBalance,
                relatedOverpaymentRefundRef: refundId,
            })
            .patch(bankAcc._id, {
                ifRevisionID: bankAcc._rev,
                set: { currentBalance: nextBalance },
            });

        if (receiptPatch) {
            transaction.patch(receiptPatch.receiptRef, {
                ifRevisionID: receiptPatch.receiptRev,
                set: buildCustomerReceiptOverpaymentPatch({
                    totalAmount: receiptPatch.totalAmount,
                    allocatedAmount: receiptPatch.allocatedAmount,
                    refundedOverpaymentAmount: receiptPatch.nextRefundedOverpaymentAmount,
                }),
            });
        }

        if (invoicePatch) {
            transaction.patch(invoicePatch.invoiceRef, {
                ifRevisionID: invoicePatch.invoiceRev,
                set: buildReceivablePatch(
                    invoicePatch.snapshot,
                    invoicePatch.nextTotalPaid,
                    invoicePatch.totalAdjustmentAmount
                ),
            });
        }

        try {
            await transaction.commit();
            const refundSourceLabel =
                sourceType === 'RECEIPT_UNAPPLIED'
                    ? sourceReceiptNumber || sourceReceiptRef || 'penerimaan customer'
                    : sourceInvoiceNumber || sourceInvoiceRef || 'nota';
            await addAuditLog(
                session,
                'CREATE',
                'customer-overpayment-refunds',
                refundId,
                note
                    ? `Refund kelebihan bayar ${formatAuditMoney(amount)} untuk ${refundSourceLabel} via ${bankAcc.bankName} - ${note}`
                    : `Refund kelebihan bayar ${formatAuditMoney(amount)} untuk ${refundSourceLabel} via ${bankAcc.bankName}`
            );
            return NextResponse.json({ success: true, id: refundId });
        } catch (error) {
            if (!isMutationConflictError(error)) {
                throw error;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Refund kelebihan bayar berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Refund kelebihan bayar berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
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
            : getBusinessDateValue();
    const transferDateError = validateIsoDateOrResponse(transferDate, 'Tanggal transfer', 'Tanggal transfer tidak valid');
    if (transferDateError) {
        return transferDateError;
    }
    const transferDescription = normalizeOptionalText(data.description);

    const transferId = `transfer-${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const fromAcc = await getLedgerAccount(fromAccountRef);
        const toAcc = await getLedgerAccount(toAccountRef);
        if (!fromAcc || !toAcc) {
            return NextResponse.json({ error: 'Akun sumber atau tujuan tidak ditemukan' }, { status: 404 });
        }
        if (!fromAcc._rev || !toAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        const { startingBalance: fromStartingBalance, nextBalance: fromBalance } = computeLedgerDebitBalance(fromAcc.currentBalance, amount);
        if (fromBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${fromAcc.bankName} tidak cukup untuk transfer. Saldo tersedia ${fromStartingBalance}` },
                { status: 409 }
            );
        }
        const toBalance = readLedgerBalance(toAcc.currentBalance) + amount;
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
                transferDescription
                    ? `Transfer ${formatAuditMoney(amount)} dari ${fromAcc.bankName} ke ${toAcc.bankName} - ${transferDescription}`
                    : `Transfer ${formatAuditMoney(amount)} dari ${fromAcc.bankName} ke ${toAcc.bankName}`
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
        typeof data.date === 'string' && data.date ? data.date : getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(expenseDate, 'Tanggal pengeluaran', 'Tanggal pengeluaran tidak valid');
    if (expenseDateError) {
        return expenseDateError;
    }

    const category = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(categoryRef);
    if (!category) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak ditemukan' }, { status: 404 });
    }
    if (category.active === false) {
        return NextResponse.json({ error: 'Kategori pengeluaran tidak aktif' }, { status: 409 });
    }

    let relatedVehicleRef =
        typeof data.relatedVehicleRef === 'string' && data.relatedVehicleRef ? data.relatedVehicleRef : undefined;
    let relatedVehiclePlate: string | undefined;
    if (relatedVehicleRef) {
        const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(relatedVehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        relatedVehiclePlate = vehicle.plateNumber;
    }

    let relatedIncidentRef =
        typeof data.relatedIncidentRef === 'string' && data.relatedIncidentRef ? data.relatedIncidentRef : undefined;
    const relatedIncidentSettlementLineRef =
        typeof data.relatedIncidentSettlementLineRef === 'string' && data.relatedIncidentSettlementLineRef
            ? data.relatedIncidentSettlementLineRef
            : undefined;
    const relatedIncidentSettlementLineRevision =
        typeof data.relatedIncidentSettlementLineRevision === 'string' && data.relatedIncidentSettlementLineRevision
            ? data.relatedIncidentSettlementLineRevision
            : undefined;
    const relatedMaintenanceRef =
        typeof data.relatedMaintenanceRef === 'string' && data.relatedMaintenanceRef ? data.relatedMaintenanceRef : undefined;
    const boronganRef =
        typeof data.boronganRef === 'string' && data.boronganRef ? data.boronganRef : undefined;
    const voucherRef =
        typeof data.voucherRef === 'string' && data.voucherRef ? data.voucherRef : undefined;
    const linkedWorkflowRefs = [relatedIncidentRef, relatedMaintenanceRef, boronganRef, voucherRef].filter(Boolean);
    if (linkedWorkflowRefs.length > 1) {
        return NextResponse.json(
            { error: 'Pengeluaran hanya boleh dikaitkan ke satu workflow: insiden, maintenance, slip borongan, atau bon trip' },
            { status: 409 }
        );
    }

    let incidentSettlementLine:
        | {
            _id: string;
            _rev?: string;
            incidentRef: string;
            lineType?: string;
            status?: string;
            amount?: number;
            description?: string;
            note?: string;
            payeeName?: string;
            linkedExpenseRef?: string;
        }
        | null = null;
    if (relatedIncidentSettlementLineRef) {
        incidentSettlementLine = await sanityGetById<{
            _id: string;
            _rev?: string;
            incidentRef: string;
            lineType?: string;
            status?: string;
            amount?: number;
            description?: string;
            note?: string;
            payeeName?: string;
            linkedExpenseRef?: string;
        }>(relatedIncidentSettlementLineRef);
        if (!incidentSettlementLine) {
            return NextResponse.json({ error: 'Detail insiden tidak ditemukan' }, { status: 404 });
        }
        if (
            !relatedIncidentSettlementLineRevision
            || !incidentSettlementLine._rev
            || relatedIncidentSettlementLineRevision !== incidentSettlementLine._rev
        ) {
            return NextResponse.json(
                { error: 'Detail insiden berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.lineType === 'RECOVERY') {
            return NextResponse.json(
                { error: 'Recovery tidak diposting sebagai pengeluaran. Gunakan tandai diterima pada detail insiden.' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.status !== 'APPROVED') {
            return NextResponse.json(
                { error: 'Hanya detail insiden berstatus disetujui yang boleh diposting ke pengeluaran' },
                { status: 409 }
            );
        }
        if (incidentSettlementLine.linkedExpenseRef) {
            return NextResponse.json(
                { error: 'Detail insiden ini sudah terhubung ke pengeluaran lain' },
                { status: 409 }
            );
        }
        if (amount !== Math.max(normalizeCurrencyNumber(incidentSettlementLine.amount ?? 0), 0)) {
            return NextResponse.json(
                { error: 'Nominal pengeluaran harus sama dengan nominal detail insiden yang diposting' },
                { status: 409 }
            );
        }
        if (relatedIncidentRef && relatedIncidentRef !== incidentSettlementLine.incidentRef) {
            return NextResponse.json(
                { error: 'Insiden pengeluaran tidak cocok dengan detail insiden yang dipilih' },
                { status: 409 }
            );
        }
        relatedIncidentRef = incidentSettlementLine.incidentRef;
    }

    if (relatedIncidentRef) {
        const incident = await sanityGetById<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(relatedIncidentRef);
        if (!incident) {
            return NextResponse.json({ error: 'Insiden terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        if (incident.vehicleRef) {
            if (relatedVehicleRef && incident.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada insiden terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = incident.vehicleRef;
            relatedVehiclePlate = incident.vehiclePlate || relatedVehiclePlate;
        }
    }

    if (relatedMaintenanceRef) {
        const maintenance = await sanityGetById<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(relatedMaintenanceRef);
        if (!maintenance) {
            return NextResponse.json({ error: 'Maintenance terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        if (maintenance.vehicleRef) {
            if (relatedVehicleRef && maintenance.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada maintenance terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = maintenance.vehicleRef;
            relatedVehiclePlate = maintenance.vehiclePlate || relatedVehiclePlate;
        }
    }

    let linkedBorongan:
        | {
            _id: string;
            _rev?: string;
        }
        | null = null;
    if (boronganRef) {
        linkedBorongan = await sanityGetById<{
            _id: string;
            _rev?: string;
        }>(boronganRef);
        if (!linkedBorongan) {
            return NextResponse.json({ error: 'Slip borongan terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
    }

    if (voucherRef) {
        const voucher = await sanityGetById<{ _id: string; vehicleRef?: string; vehiclePlate?: string }>(voucherRef);
        if (!voucher) {
            return NextResponse.json({ error: 'Bon trip terkait pengeluaran tidak ditemukan' }, { status: 404 });
        }
        if (voucher.vehicleRef) {
            if (relatedVehicleRef && voucher.vehicleRef !== relatedVehicleRef) {
                return NextResponse.json(
                    { error: 'Kendaraan pengeluaran tidak cocok dengan kendaraan pada bon trip terkait' },
                    { status: 409 }
                );
            }
            relatedVehicleRef = voucher.vehicleRef;
            relatedVehiclePlate = voucher.vehiclePlate || relatedVehiclePlate;
        }
    }

    const hasPrivacyLevel = Object.prototype.hasOwnProperty.call(data, 'privacyLevel');
    const rawPrivacyLevel = normalizeOptionalText(data.privacyLevel);
    if (hasPrivacyLevel && rawPrivacyLevel && rawPrivacyLevel !== 'ownerOnly' && rawPrivacyLevel !== 'internal') {
        return NextResponse.json({ error: 'Level privasi pengeluaran tidak valid' }, { status: 400 });
    }
    if (hasPrivacyLevel && !rawPrivacyLevel) {
        return NextResponse.json({ error: 'Level privasi pengeluaran tidak valid' }, { status: 400 });
    }
    const requestedPrivacyLevel =
        rawPrivacyLevel === 'ownerOnly'
            ? 'ownerOnly'
            : 'internal';
    if (requestedPrivacyLevel === 'ownerOnly' && session.role !== 'OWNER') {
        return NextResponse.json({ error: 'Hanya OWNER yang boleh membuat pengeluaran owner-only' }, { status: 403 });
    }
    const privacyLevel = requestedPrivacyLevel;

    let expenseNote = normalizeOptionalText(data.note);
    let expenseDescription = normalizeOptionalText(data.description);
    if (incidentSettlementLine) {
        expenseNote = expenseNote || incidentSettlementLine.note || incidentSettlementLine.payeeName;
        expenseDescription = expenseDescription || incidentSettlementLine.description;
    }
    const expenseDocBase: { _type: 'expense'; [key: string]: unknown } = {
        _type: 'expense',
        categoryRef,
        categoryName: category.name,
        date: expenseDate,
        amount,
        note: expenseNote,
        description: expenseDescription,
        receiptUrl: normalizeOptionalText(data.receiptUrl),
        privacyLevel,
        relatedVehicleRef,
        relatedVehiclePlate,
        relatedIncidentRef,
        relatedIncidentSettlementLineRef,
        relatedMaintenanceRef,
        boronganRef,
        voucherRef,
    };
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    const expenseAuditSummary = buildExpenseAuditSummary({
        amount,
        categoryName: category.name,
        bankName: undefined,
        note: expenseNote,
        description: expenseDescription,
    });

    if (!selectedAccountRef) {
        if (!incidentSettlementLine && !linkedBorongan) {
            const created = await sanityCreate(expenseDocBase);
            const expenseId = (created as Record<string, unknown>)._id as string;
            await addAuditLog(session, 'CREATE', 'expenses', expenseId, expenseAuditSummary);
            return NextResponse.json({ data: created, id: expenseId });
        }

        const expenseId = crypto.randomUUID();
        const now = new Date().toISOString();
        const expenseDoc = {
            _id: expenseId,
            ...expenseDocBase,
        };
        const transaction = getSanityClient().transaction().create(expenseDoc);
        if (linkedBorongan) {
            if (!linkedBorongan._rev) {
                return NextResponse.json(
                    { error: 'Revisi slip borongan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
            transaction.patch(linkedBorongan._id, {
                ifRevisionID: linkedBorongan._rev,
                set: { updatedAt: now },
            });
        }
        if (incidentSettlementLine) {
            const lineRef = relatedIncidentSettlementLineRef as string;
            transaction
                .patch(lineRef, {
                    ifRevisionID: incidentSettlementLine._rev,
                    set: sanitizePatchSet({
                        status: 'POSTED',
                        linkedExpenseRef: expenseId,
                        linkedExpenseDate: expenseDate,
                        linkedExpenseAmount: amount,
                        linkedExpenseCategoryRef: categoryRef,
                        linkedExpenseCategoryName: category.name,
                        postedAt: now,
                        postedBy: session._id,
                        postedByName: session.name,
                        updatedAt: now,
                        updatedBy: session._id,
                        updatedByName: session.name,
                    }),
                })
                .create({
                    _id: crypto.randomUUID(),
                    _type: 'incidentActionLog',
                    incidentRef: incidentSettlementLine.incidentRef,
                    timestamp: now,
                    note: `Detail insiden diposting ke pengeluaran: ${expenseDescription || expenseNote || category.name || 'Pengeluaran insiden'}`,
                    userRef: session._id,
                    userName: session.name,
                });
        }
        try {
            await transaction.commit();
            await addAuditLog(session, 'CREATE', 'expenses', expenseId, expenseAuditSummary);
            if (incidentSettlementLine) {
                await addAuditLog(
                    session,
                    'UPDATE',
                    'incident-settlement-lines',
                    incidentSettlementLine._id,
                    `Posted incident settlement line to expense ${expenseId}`
                );
            }
            return NextResponse.json({ data: expenseDoc, id: expenseId });
        } catch (err) {
            if (isMutationConflictError(err)) {
                return NextResponse.json(
                    { error: 'Pengeluaran atau workflow terkait berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
            throw err;
        }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const bankAcc = await getLedgerAccount(selectedAccountRef);
        if (!bankAcc) {
            return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
        }
        if (!bankAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }
        let linkedBoronganForAttempt = linkedBorongan;
        if (boronganRef) {
            linkedBoronganForAttempt = await sanityGetById<{
                _id: string;
                _rev?: string;
            }>(boronganRef);
            if (!linkedBoronganForAttempt) {
                return NextResponse.json({ error: 'Slip borongan terkait pengeluaran tidak ditemukan' }, { status: 404 });
            }
            if (!linkedBoronganForAttempt._rev) {
                return NextResponse.json(
                    { error: 'Revisi slip borongan tidak tersedia. Refresh lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }

        const expenseId = crypto.randomUUID();
        const { startingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(bankAcc.currentBalance, amount);
        if (newBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bankAcc.bankName} tidak cukup untuk pengeluaran. Saldo tersedia ${startingBalance}` },
                { status: 409 }
            );
        }
        const expenseDoc = {
            _id: expenseId,
            ...expenseDocBase,
            bankAccountRef: selectedAccountRef,
            bankAccountName: bankAcc.bankName,
            bankAccountNumber: bankAcc.accountNumber,
        };
        const expenseAuditSummaryWithBank = buildExpenseAuditSummary({
            amount,
            categoryName: category.name,
            bankName: bankAcc.bankName,
            note: expenseNote,
            description: expenseDescription,
        });

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
        if (linkedBoronganForAttempt) {
            transaction.patch(linkedBoronganForAttempt._id, {
                ifRevisionID: linkedBoronganForAttempt._rev,
                set: { updatedAt: new Date().toISOString() },
            });
        }
        if (incidentSettlementLine && typeof relatedIncidentSettlementLineRef === 'string') {
            const lineRef = relatedIncidentSettlementLineRef;
            const now = new Date().toISOString();
            transaction
                .patch(lineRef, {
                    ifRevisionID: incidentSettlementLine._rev,
                    set: sanitizePatchSet({
                        status: 'POSTED',
                        linkedExpenseRef: expenseId,
                        linkedExpenseDate: expenseDate,
                        linkedExpenseAmount: amount,
                        linkedExpenseCategoryRef: categoryRef,
                        linkedExpenseCategoryName: category.name,
                        postedAt: now,
                        postedBy: session._id,
                        postedByName: session.name,
                        updatedAt: now,
                        updatedBy: session._id,
                        updatedByName: session.name,
                    }),
                })
                .create({
                    _id: crypto.randomUUID(),
                    _type: 'incidentActionLog',
                    incidentRef: incidentSettlementLine.incidentRef,
                    timestamp: now,
                    note: `Detail insiden diposting ke pengeluaran: ${expenseDescription || expenseNote || category.name || 'Pengeluaran insiden'}`,
                    userRef: session._id,
                    userName: session.name,
                });
        }

        try {
            await transaction.commit();
            await addAuditLog(session, 'CREATE', 'expenses', expenseId, expenseAuditSummaryWithBank);
            if (incidentSettlementLine) {
                await addAuditLog(
                    session,
                    'UPDATE',
                    'incident-settlement-lines',
                    incidentSettlementLine._id,
                    `Posted incident settlement line to expense ${expenseId}`
                );
            }
            return NextResponse.json({ data: expenseDoc, id: expenseId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Pengeluaran, rekening, atau workflow terkait berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pengeluaran, rekening, atau workflow terkait berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleFreightNotaCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let billingMode = resolveFreightNotaBillingModeInput(data.billingMode, 'Basis billing nota', {
        defaultMode: 'PER_KG',
        allowEmpty: !Object.prototype.hasOwnProperty.call(data, 'billingMode'),
    });
    let resolvedCustomerRef = normalizeOptionalText(data.customerRef);
    const customerName = normalizeText(data.customerName);

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    let rows: NormalizedFreightNotaRow[];
    try {
        rows = rawRows
            .filter(isPlainObject)
            .filter(row => !isFreightNotaRowEmpty(row))
            .map<NormalizedFreightNotaRow>(row => {
                const date = normalizeText(row.date);
                const doRef = normalizeOptionalText(row.doRef);
                const deliveryOrderItemRef = normalizeOptionalText(row.deliveryOrderItemRef);
                const doNumber = normalizeOptionalText(row.doNumber);
                const noSJ = normalizeText(row.noSJ);
                const tujuan = normalizeText(row.tujuan);
                const dari = normalizeText(row.dari);
                const beratKg = normalizeNumber(row.beratKg);
                const tarip = normalizeCurrencyNumber(row.tarip);
                const collie = parseOptionalStrictNotaRowNumber(
                    row.collie,
                    'Collie pada baris nota tidak valid',
                    { maxFractionDigits: 2 }
                );

                if (date) {
                    assertIsoDate(date, 'Tanggal baris nota');
                }

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
                    deliveryOrderItemRef,
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
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Baris nota tidak valid' },
            { status: 400 }
        );
    }

    if (rows.length === 0) {
        return NextResponse.json({ error: 'Minimal 1 baris nota wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<Array<{
            _id: string;
            _rev?: string;
            status?: string;
            orderRef?: unknown;
            doNumber?: string;
            customerDoNumber?: string;
            vehiclePlate?: string;
            pickupAddress?: string;
            receiverAddress?: string;
            date?: string;
            freightNotaRef?: unknown;
        }>>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                _rev,
                status,
                orderRef,
                doNumber,
                customerDoNumber,
                vehiclePlate,
                pickupAddress,
                receiverAddress,
                date,
                freightNotaRef
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
    const referencedDeliveryOrderItemRefs = [
        ...new Set(
            rows
                .map(row => row.deliveryOrderItemRef)
                .filter((ref): ref is string => Boolean(ref))
        ),
    ];
    const deliveryOrderItems = uniqueDoRefs.length > 0 || referencedDeliveryOrderItemRefs.length > 0
        ? await getSanityClient().fetch<FreightNotaDeliveryOrderItemSource[]>(
            `*[
                _type == "deliveryOrderItem" &&
                (
                    deliveryOrderRef in $deliveryOrderRefs ||
                    _id in $itemRefs
                )
            ]{
                _id,
                deliveryOrderRef,
                orderItemDescription,
                orderItemQtyKoli,
                orderItemWeight,
                actualQtyKoli,
                actualWeightKg
            }`,
            {
                deliveryOrderRefs: uniqueDoRefs,
                itemRefs: referencedDeliveryOrderItemRefs,
            }
        )
        : [];

    const deliveryOrderMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const orderMap = new Map(sourceOrders.map(order => [order._id, order]));
    const doItemMap = new Map<string, FreightNotaDeliveryOrderItemSource[]>();
    const doItemById = new Map<string, FreightNotaDeliveryOrderItemSource>();
    for (const item of deliveryOrderItems) {
        const itemId = normalizeOptionalText(item._id);
        if (itemId) {
            doItemById.set(itemId, item);
        }
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
        const itemSource = row.deliveryOrderItemRef ? doItemById.get(row.deliveryOrderItemRef) : undefined;
        if (row.deliveryOrderItemRef && !itemSource) {
            return NextResponse.json(
                {
                    error: `Item DO ${row.deliveryOrderItemRef} tidak ditemukan untuk pembuatan nota`,
                },
                { status: 404 }
            );
        }
        if (itemSource) {
            const itemDeliveryOrderRef = normalizeOptionalText(itemSource.deliveryOrderRef);
            if (itemDeliveryOrderRef !== row.doRef) {
                return NextResponse.json(
                    {
                        error: `Item DO ${row.deliveryOrderItemRef} bukan milik surat jalan ${deliveryOrder.doNumber || row.doRef}`,
                    },
                    { status: 409 }
                );
            }
        }
        const itemSummary = itemSource
            ? summarizeDeliveryOrderItems([itemSource])
            : summarizeDeliveryOrderItems(doItemMap.get(row.doRef) || []);

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

    const payloadCoverageByDoRef = new Map<
        string,
        {
            fullDoIncluded: boolean;
            deliveryOrderItemRefs: Set<string>;
        }
    >();
    for (const row of rows) {
        if (!row.doRef) continue;
        const deliveryOrder = deliveryOrderMap.get(row.doRef);
        const coverage =
            payloadCoverageByDoRef.get(row.doRef) ||
            {
                fullDoIncluded: false,
                deliveryOrderItemRefs: new Set<string>(),
            };
        if (!row.deliveryOrderItemRef) {
            if (coverage.fullDoIncluded || coverage.deliveryOrderItemRefs.size > 0) {
                return NextResponse.json(
                    {
                        error: `DO ${deliveryOrder?.doNumber || row.doRef} duplikat dalam payload nota`,
                    },
                    { status: 409 }
                );
            }
            coverage.fullDoIncluded = true;
            payloadCoverageByDoRef.set(row.doRef, coverage);
            continue;
        }

        if (coverage.fullDoIncluded) {
            return NextResponse.json(
                {
                    error: `DO ${deliveryOrder?.doNumber || row.doRef} sudah dimasukkan penuh dalam payload nota`,
                },
                { status: 409 }
            );
        }
        if (coverage.deliveryOrderItemRefs.has(row.deliveryOrderItemRef)) {
            return NextResponse.json(
                {
                    error: `Item DO ${row.deliveryOrderItemRef} duplikat dalam payload nota`,
                },
                { status: 400 }
            );
        }
        coverage.deliveryOrderItemRefs.add(row.deliveryOrderItemRef);
        payloadCoverageByDoRef.set(row.doRef, coverage);
    }
    for (const [doRef, coverage] of payloadCoverageByDoRef.entries()) {
        if (coverage.fullDoIncluded || coverage.deliveryOrderItemRefs.size === 0) {
            continue;
        }
        const doItems = doItemMap.get(doRef) || [];
        const doItemIds = doItems
            .map(item => normalizeOptionalText(item._id))
            .filter((itemId): itemId is string => Boolean(itemId));
        const missingItemIds = doItemIds.filter(itemId => !coverage.deliveryOrderItemRefs.has(itemId));
        if (missingItemIds.length > 0) {
            const deliveryOrder = deliveryOrderMap.get(doRef);
            return NextResponse.json(
                {
                    error: `DO ${deliveryOrder?.doNumber || doRef} harus memasukkan semua item muatan dalam payload nota`,
                },
                { status: 409 }
            );
        }
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
        const lockedDeliveryOrder = deliveryOrders.find(item => normalizeOptionalText(item.freightNotaRef));
        if (lockedDeliveryOrder) {
            return NextResponse.json(
                { error: `DO ${lockedDeliveryOrder.doNumber || lockedDeliveryOrder._id} sudah tercantum di nota lain` },
                { status: 409 }
            );
        }
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

    const issueDate = normalizeText(data.issueDate) || getBusinessDateValue();
    const issueDateError = validateIsoDateOrResponse(issueDate, 'Tanggal nota', 'Tanggal nota tidak valid');
    if (issueDateError) {
        return issueDateError;
    }
    const customerDerivedFromDo = Boolean(inferredCustomerRef && inferredCustomerRef === resolvedCustomerRef && deliveryOrders.length > 0);
    let finalCustomerName = customerName;
    let finalCustomerAddress = normalizeOptionalText(data.customerAddress);
    let finalCustomerContactPerson = normalizeOptionalText(data.customerContactPerson);
    let finalCustomerPhone = normalizeOptionalText(data.customerPhone);
    let customerTermDays: number | null = null;
    let customerPph23Defaults: {
        enabled: boolean;
        ratePercent: number;
        baseMode: Pph23BaseMode;
    } | null = null;
    if (resolvedCustomerRef) {
        const customerDoc = await getSanityClient().fetch<{
            _id: string;
            name?: string;
            address?: string;
            contactPerson?: string;
            phone?: string;
            defaultPaymentTerm?: number;
            defaultFreightNotaBillingMode?: string;
            defaultPph23Enabled?: boolean;
            defaultPph23RatePercent?: number;
            defaultPph23BaseMode?: string;
            active?: boolean;
        } | null>(
            `*[_type == "customer" && _id == $id][0]{ _id, name, address, contactPerson, phone, defaultPaymentTerm, defaultFreightNotaBillingMode, defaultPph23Enabled, defaultPph23RatePercent, defaultPph23BaseMode, active }`,
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
        customerPph23Defaults = {
            enabled: normalizePph23Enabled(customerDoc?.defaultPph23Enabled),
            ratePercent: normalizePph23RatePercent(customerDoc?.defaultPph23RatePercent, DEFAULT_PPH23_RATE_PERCENT),
            baseMode: normalizePph23BaseMode(customerDoc?.defaultPph23BaseMode, 'BEFORE_CLAIM'),
        };
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
    let pph23Settings: {
        pph23Enabled: boolean;
        pph23RatePercent: number;
        pph23BaseMode: Pph23BaseMode;
    };
    try {
        pph23Settings = normalizePph23SettingsInput(data, customerPph23Defaults ? {
            enabled: customerPph23Defaults.enabled,
            ratePercent: customerPph23Defaults.ratePercent,
            baseMode: customerPph23Defaults.baseMode,
        } : undefined);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Pengaturan PPh 23 tidak valid' },
            { status: 400 }
        );
    }
    const initialReceivablePatch = buildReceivablePatch(
        {
            grossAmount: totalAmount,
            pph23Enabled: pph23Settings.pph23Enabled,
            pph23RatePercent: pph23Settings.pph23RatePercent,
            pph23BaseMode: pph23Settings.pph23BaseMode,
        },
        0,
        0,
    );

    const notaId = crypto.randomUUID();
    const notaNumber = await sanityGetNextNumber('nota', issueDate);
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
    if (resolvedDueDate) {
        const dueDateError = validateIsoDateOrResponse(
            resolvedDueDate,
            'Tanggal jatuh tempo nota',
            'Tanggal jatuh tempo nota tidak valid'
        );
        if (dueDateError) {
            return dueDateError;
        }
    }
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
            resolvedDueDate = addDaysToDateValue(issueDate, termDays);
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
        pph23Enabled: pph23Settings.pph23Enabled,
        pph23RatePercent: pph23Settings.pph23RatePercent,
        pph23BaseMode: pph23Settings.pph23BaseMode,
        pph23BaseAmount: initialReceivablePatch.pph23BaseAmount,
        pph23Amount: initialReceivablePatch.pph23Amount,
        netAmount: initialReceivablePatch.netAmount,
        totalCollie,
        totalWeightKg,
        billingMode,
        instructionAccounts: instructionAccounts.length > 0 ? instructionAccounts : undefined,
        footerNote,
        notes: normalizeOptionalText(data.notes),
        notaNumber,
    };

    const transaction = getSanityClient().transaction().create(notaDoc);
    for (const deliveryOrder of deliveryOrders) {
        if (!deliveryOrder._rev) {
            return NextResponse.json(
                { error: `Revisi surat jalan ${deliveryOrder.doNumber || deliveryOrder._id} tidak tersedia` },
                { status: 409 }
            );
        }
        transaction.patch(deliveryOrder._id, {
            ifRevisionID: deliveryOrder._rev,
            set: {
                freightNotaRef: notaId,
                freightNotaNumber: notaNumber,
            },
        });
    }
    for (const row of rows) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'freightNotaItem',
            notaRef: notaId,
            doRef: row.doRef,
            deliveryOrderItemRef: row.deliveryOrderItemRef,
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

    try {
        await transaction.commit();
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/revision|conflict|document/i.test(message)) {
            return NextResponse.json(
                { error: 'DO berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
    await addAuditLog(session, 'CREATE', 'freight-notas', notaId, `Created freight-notas: ${notaNumber}`);
    return NextResponse.json({ data: notaDoc, id: notaId });
}

export async function handleFreightNotaPph23Update(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const notaId = typeof data.id === 'string' ? data.id : '';
    if (!notaId) {
        return NextResponse.json({ error: 'Nota tidak valid' }, { status: 400 });
    }

    const snapshot = await loadReceivableSnapshot(notaId);
    if ('error' in snapshot) return snapshot.error;
    if (snapshot.doc._type !== 'freightNota') {
        return NextResponse.json({ error: 'Pengaturan PPh 23 hanya tersedia untuk nota ongkos' }, { status: 409 });
    }
    if (!snapshot.doc._rev) {
        return NextResponse.json({ error: 'Revisi nota tidak tersedia' }, { status: 409 });
    }
    if (snapshot.paidBeforeRefund > 0 || snapshot.refundedOverpaymentAmount > 0) {
        return NextResponse.json(
            { error: 'Pengaturan PPh 23 tidak bisa diubah setelah nota memiliki pembayaran' },
            { status: 409 }
        );
    }

    let pph23Settings: {
        pph23Enabled: boolean;
        pph23RatePercent: number;
        pph23BaseMode: Pph23BaseMode;
    };
    try {
        pph23Settings = normalizePph23SettingsInput(data, {
            enabled: snapshot.pph23Enabled,
            ratePercent: snapshot.pph23RatePercent,
            baseMode: snapshot.pph23BaseMode,
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Pengaturan PPh 23 tidak valid' },
            { status: 400 }
        );
    }

    const patch = buildReceivablePatch(snapshot, snapshot.totalPaid, snapshot.totalAdjustmentAmount, pph23Settings);

    try {
        await getSanityClient()
            .transaction()
            .patch(notaId, {
                ifRevisionID: snapshot.doc._rev,
                set: patch,
            })
            .commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Nota berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(
        session,
        'UPDATE',
        'freight-notas',
        notaId,
        `Pengaturan PPh 23 diperbarui untuk ${snapshot.label}`
    );

    return NextResponse.json({
        success: true,
        data: {
            _id: notaId,
            ...patch,
        },
    });
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
    const relatedDeliveryOrders = await getSanityClient().fetch<Array<{ _id: string; _rev?: string; freightNotaRef?: unknown }>>(
        `*[_type == "deliveryOrder" && freightNotaRef == $ref]{ _id, _rev, freightNotaRef }`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const itemId of itemIds) {
        transaction.delete(itemId);
    }
    for (const deliveryOrder of relatedDeliveryOrders) {
        if (!deliveryOrder._rev) {
            return NextResponse.json(
                { error: `Revisi surat jalan ${deliveryOrder._id} tidak tersedia` },
                { status: 409 }
            );
        }
        transaction.patch(deliveryOrder._id, {
            ifRevisionID: deliveryOrder._rev,
            unset: ['freightNotaRef', 'freightNotaNumber'],
        });
    }
    transaction.delete(id);
    try {
        await transaction.commit();
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/revision|conflict|document/i.test(message)) {
            return NextResponse.json(
                { error: 'Nota berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

    await addAuditLog(session, 'DELETE', 'freight-notas', id, `Deleted freight-notas ${nota.notaNumber || id}`);
    return NextResponse.json({ success: true });
}
