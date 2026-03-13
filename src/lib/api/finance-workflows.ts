import { NextResponse } from 'next/server';

import { getSanityClient, sanityCreate, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import type { Payment } from '@/lib/types';

import {
    assertIsoDate,
    ensureCashAccount,
    extractRefId,
    getLedgerAccount,
    isMutationConflictError,
    isPlainObject,
    normalizeNumber,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
    type BankAccountSummary,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type NormalizedFreightNotaRow = {
    doRef?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket?: string;
};

type FreightNotaOrderSource = {
    _id: string;
    customerRef?: unknown;
    pickupAddress?: string;
    receiverAddress?: string;
};

type FreightNotaDeliveryOrderItemSource = {
    deliveryOrderRef?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
};

function summarizeDeliveryOrderItems(items: FreightNotaDeliveryOrderItemSource[]) {
    const descriptions = [...new Set(
        items
            .map(item => normalizeOptionalText(item.orderItemDescription))
            .filter((value): value is string => Boolean(value))
    )];
    const collie = items.reduce((sum, item) => sum + normalizeNumber(item.orderItemQtyKoli || 0), 0);
    const beratKg = items.reduce((sum, item) => sum + normalizeNumber(item.orderItemWeight || 0), 0);

    return {
        barang: descriptions.join(', '),
        collie,
        beratKg,
    };
}

function isFreightNotaRowEmpty(row: Record<string, unknown>) {
    return (
        !normalizeOptionalText(row.doRef) &&
        !normalizeText(row.noSJ) &&
        !normalizeText(row.tujuan) &&
        !normalizeText(row.barang) &&
        normalizeNumber(row.collie || 0) === 0 &&
        normalizeNumber(row.beratKg || 0) === 0 &&
        normalizeNumber(row.tarip || 0) === 0
    );
}

async function loadPaymentTarget(invoiceRef: string) {
    const doc = await sanityGetById<
        Record<string, unknown> & {
            _id: string;
            _rev?: string;
            _type: 'freightNota' | 'invoice';
            totalAmount?: number;
        }
    >(invoiceRef);
    if (!doc) {
        return { error: NextResponse.json({ error: 'Dokumen tagihan tidak ditemukan' }, { status: 404 }) };
    }
    if (doc._type !== 'freightNota' && doc._type !== 'invoice') {
        return {
            error: NextResponse.json(
                { error: 'Pembayaran hanya boleh dicatat untuk nota ongkos atau invoice legacy' },
                { status: 409 }
            ),
        };
    }

    const totalAmount = typeof doc.totalAmount === 'number' ? doc.totalAmount : Number(doc.totalAmount || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
        return { error: NextResponse.json({ error: 'Total tagihan tidak valid' }, { status: 400 }) };
    }

    const allPayments = await getSanityClient().fetch<Payment[]>(
        `*[_type == "payment" && invoiceRef == $ref]`,
        { ref: invoiceRef }
    );
    const totalPaid = allPayments.reduce((sum, item) => sum + item.amount, 0);

    return { doc, totalAmount, totalPaid };
}

function deriveBillingStatus(totalAmount: number, totalPaid: number) {
    if (totalPaid >= totalAmount) return 'PAID';
    if (totalPaid > 0) return 'PARTIAL';
    return 'UNPAID';
}

export async function handlePaymentCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran tidak valid' }, { status: 400 });
    }

    const invoiceRef = typeof data.invoiceRef === 'string' ? data.invoiceRef : '';
    if (!invoiceRef) {
        return NextResponse.json({ error: 'Referensi tagihan wajib diisi' }, { status: 400 });
    }

    const paymentMethod = typeof data.method === 'string' ? data.method : 'CASH';
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
        const loaded = await loadPaymentTarget(invoiceRef);
        if ('error' in loaded) return loaded.error;
        if (!loaded.doc._rev) {
            return NextResponse.json({ error: 'Revisi dokumen tagihan tidak tersedia' }, { status: 409 });
        }

        const remaining = Math.max(loaded.totalAmount - loaded.totalPaid, 0);
        if (amount > remaining) {
            return NextResponse.json(
                { error: `Pembayaran melebihi sisa tagihan (${remaining})` },
                { status: 400 }
            );
        }

        let bankAcc: BankAccountSummary | null = null;
        if (selectedAccountRef) {
            bankAcc = await getLedgerAccount(selectedAccountRef);
            if (!bankAcc) {
                return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
            }
        } else if (paymentMethod === 'CASH') {
            bankAcc = await ensureCashAccount();
        }
        if (paymentMethod === 'TRANSFER' && bankAcc?.accountType === 'CASH') {
            return NextResponse.json(
                { error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' },
                { status: 400 }
            );
        }
        if (bankAcc && !bankAcc._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        const nextTotalPaid = loaded.totalPaid + amount;
        const nextStatus = deriveBillingStatus(loaded.totalAmount, nextTotalPaid);
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
                note: loaded.doc._type === 'freightNota' ? 'Pembayaran nota ongkos' : 'Pembayaran invoice',
            })
            .patch(invoiceRef, {
                ifRevisionID: loaded.doc._rev,
                set: { status: nextStatus },
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
                                : 'Pembayaran invoice masuk',
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
            void addAuditLog(
                session,
                'CREATE',
                'payments',
                paymentId,
                `Pembayaran dicatat untuk ${loaded.doc._type === 'freightNota' ? 'nota' : 'invoice'} ${invoiceRef}`
            );
            return NextResponse.json({ data: paymentDoc, id: paymentId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                const latest = await loadPaymentTarget(invoiceRef);
                if (!('error' in latest)) {
                    const latestRemaining = Math.max(latest.totalAmount - latest.totalPaid, 0);
                    return NextResponse.json(
                        {
                            error:
                                latestRemaining === 0 || amount > latestRemaining
                                    ? `Pembayaran berubah karena ada transaksi lain. Sisa tagihan sekarang ${latestRemaining}. Muat ulang lalu coba lagi.`
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

export async function handleBankTransfer(data: Record<string, unknown>) {
    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
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

    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
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

    const privacyLevel = data.privacyLevel === 'ownerOnly' ? 'ownerOnly' : 'internal';

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
        void addAuditLog(session, 'CREATE', 'expenses', expenseId, `Created expenses: ${expenseId}`);
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
            void addAuditLog(session, 'CREATE', 'expenses', expenseId, `Created expenses: ${expenseId}`);
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
            const noSJ = normalizeText(row.noSJ) || doNumber || '';
            const tujuan = normalizeText(row.tujuan);
            const dari = normalizeText(row.dari);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if ((!date || !noSJ || !tujuan) && !doRef) {
                throw new Error('Baris nota wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if ((!Number.isFinite(beratKg) || beratKg <= 0) && !doRef) {
                throw new Error('Berat pada baris nota harus lebih besar dari 0');
            }
            if (!Number.isFinite(tarip) || tarip <= 0) {
                throw new Error('Tarip pada baris nota harus lebih besar dari 0');
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
                uangRp: beratKg * tarip,
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
                orderItemWeight
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
        row.noSJ = normalizeOptionalText(deliveryOrder.doNumber) || row.doNumber || row.noSJ || '';
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
        row.uangRp = row.beratKg * row.tarip;
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
                { error: `Tarip pada baris nota ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = row.beratKg * row.tarip;
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
    let finalCustomerName = customerName;
    let customerTermDays: number | null = null;
    if (resolvedCustomerRef) {
        const customerDoc = await getSanityClient().fetch<{ name?: string; defaultPaymentTerm?: number } | null>(
            `*[_type == "customer" && _id == $id][0]{ name, defaultPaymentTerm }`,
            { id: resolvedCustomerRef }
        );
        if (customerDoc?.name) {
            finalCustomerName = customerDoc.name;
        }
        if (typeof customerDoc?.defaultPaymentTerm === 'number' && Number.isFinite(customerDoc.defaultPaymentTerm) && customerDoc.defaultPaymentTerm >= 0) {
            customerTermDays = customerDoc.defaultPaymentTerm;
        }
    }
    if (!finalCustomerName) {
        return NextResponse.json({ error: 'Nama customer nota wajib diisi' }, { status: 400 });
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.uangRp, 0);
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total nota harus lebih besar dari 0' }, { status: 400 });
    }

    const notaId = crypto.randomUUID();
    const notaNumber = await sanityGetNextNumber('nota');
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
        customerRef: resolvedCustomerRef,
        customerName: finalCustomerName,
        issueDate,
        dueDate: resolvedDueDate,
        status: 'UNPAID',
        totalAmount,
        totalCollie,
        totalWeightKg,
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
    void addAuditLog(session, 'CREATE', 'freight-notas', notaId, `Created freight-notas: ${notaNumber}`);
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

    void addAuditLog(session, 'DELETE', 'freight-notas', id, `Deleted freight-notas ${nota.notaNumber || id}`);
    return NextResponse.json({ success: true });
}
