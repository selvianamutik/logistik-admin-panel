import { NextResponse } from 'next/server';

import { getSanityClient, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';

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

type NormalizedDriverBoronganRow = {
    doRef?: string;
    doNumber?: string;
    vehiclePlate?: string;
    date: string;
    noSJ: string;
    tujuan: string;
    barang?: string;
    collie?: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket?: string;
};

type DriverBoronganDeliveryOrderSource = {
    _id: string;
    status?: string;
    orderRef?: unknown;
    doNumber?: string;
    vehiclePlate?: string;
    driverRef?: unknown;
    receiverAddress?: string;
    date?: string;
    taripBorongan?: number;
    keteranganBorongan?: string;
};

type DriverBoronganOrderSource = {
    _id: string;
    receiverAddress?: string;
};

type DriverBoronganDeliveryOrderItemSource = {
    deliveryOrderRef?: string;
    orderItemDescription?: string;
    orderItemQtyKoli?: number;
    orderItemWeight?: number;
};

function summarizeBoronganDeliveryOrderItems(items: DriverBoronganDeliveryOrderItemSource[]) {
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

function isDriverBoronganRowEmpty(row: Record<string, unknown>) {
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

export async function handleDriverBoronganCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let resolvedDriverRef = normalizeOptionalText(data.driverRef);
    const driverName = normalizeText(data.driverName);

    const periodStart = normalizeText(data.periodStart) || new Date().toISOString().slice(0, 10);
    const periodEnd = normalizeText(data.periodEnd) || periodStart;
    if (periodEnd < periodStart) {
        return NextResponse.json({ error: 'Periode akhir borongan tidak boleh sebelum periode mulai' }, { status: 400 });
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    const rows = rawRows
        .filter(isPlainObject)
        .filter(row => !isDriverBoronganRowEmpty(row))
        .map<NormalizedDriverBoronganRow>(row => {
            const date = normalizeText(row.date);
            const doRef = normalizeOptionalText(row.doRef);
            const doNumber = normalizeOptionalText(row.doNumber);
            const noSJ = normalizeText(row.noSJ) || doNumber || '';
            const tujuan = normalizeText(row.tujuan);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if ((!date || !noSJ || !tujuan) && !doRef) {
                throw new Error('Baris borongan wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if ((!Number.isFinite(beratKg) || beratKg <= 0) && !doRef) {
                throw new Error('Berat pada baris borongan harus lebih besar dari 0');
            }
            if ((!Number.isFinite(tarip) || tarip <= 0) && !doRef) {
                throw new Error('Tarip pada baris borongan harus lebih besar dari 0');
            }
            if (!Number.isFinite(collie) || collie < 0) {
                throw new Error('Collie pada baris borongan tidak valid');
            }

            return {
                doRef,
                doNumber,
                vehiclePlate: normalizeOptionalText(row.vehiclePlate),
                date,
                noSJ,
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
        return NextResponse.json({ error: 'Minimal 1 baris borongan wajib diisi' }, { status: 400 });
    }

    const doRefs = rows.flatMap(row => (row.doRef ? [row.doRef] : []));
    const uniqueDoRefs = [...new Set(doRefs)];
    if (uniqueDoRefs.length !== doRefs.length) {
        return NextResponse.json({ error: 'DO yang sama tidak boleh dimasukkan dua kali dalam slip borongan' }, { status: 400 });
    }

    const deliveryOrders = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<DriverBoronganDeliveryOrderSource[]>(
            `*[_type == "deliveryOrder" && _id in $ids]{
                _id,
                status,
                orderRef,
                doNumber,
                vehiclePlate,
                driverRef,
                receiverAddress,
                date,
                taripBorongan,
                keteranganBorongan
            }`,
            { ids: uniqueDoRefs }
        )
        : [];

    if (deliveryOrders.length !== uniqueDoRefs.length) {
        return NextResponse.json({ error: 'Sebagian DO borongan tidak ditemukan' }, { status: 404 });
    }

    const orderRefs = [...new Set(
        deliveryOrders
            .map(item => extractRefId(item.orderRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    const sourceOrders = orderRefs.length > 0
        ? await getSanityClient().fetch<DriverBoronganOrderSource[]>(
            `*[_type == "order" && _id in $ids]{
                _id,
                receiverAddress
            }`,
            { ids: orderRefs }
        )
        : [];
    const deliveryOrderItems = uniqueDoRefs.length > 0
        ? await getSanityClient().fetch<DriverBoronganDeliveryOrderItemSource[]>(
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
    const doItemMap = new Map<string, DriverBoronganDeliveryOrderItemSource[]>();
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
            return NextResponse.json({ error: 'DO borongan tidak ditemukan' }, { status: 404 });
        }
        if (deliveryOrder.status !== 'DELIVERED') {
            return NextResponse.json({ error: `DO ${deliveryOrder.doNumber || row.doRef} belum selesai dikirim` }, { status: 409 });
        }
        if (resolvedDriverRef) {
            const deliveryOrderDriverRef = extractRefId(deliveryOrder.driverRef);
            if (deliveryOrderDriverRef && deliveryOrderDriverRef !== resolvedDriverRef) {
                return NextResponse.json(
                    { error: `DO ${deliveryOrder.doNumber || deliveryOrder._id} bukan milik supir yang dipilih` },
                    { status: 409 }
                );
            }
        }
        const orderRef = extractRefId(deliveryOrder.orderRef);
        const sourceOrder = orderRef ? orderMap.get(orderRef) : undefined;
        const itemSummary = summarizeBoronganDeliveryOrderItems(doItemMap.get(row.doRef) || []);

        row.doNumber = row.doNumber || deliveryOrder.doNumber;
        row.noSJ = row.noSJ || row.doNumber || deliveryOrder.doNumber || '';
        row.vehiclePlate = row.vehiclePlate || deliveryOrder.vehiclePlate;
        row.date = row.date || normalizeOptionalText(deliveryOrder.date) || '';
        row.tujuan =
            row.tujuan ||
            normalizeOptionalText(deliveryOrder.receiverAddress) ||
            normalizeOptionalText(sourceOrder?.receiverAddress) ||
            '';
        row.barang = row.barang || itemSummary.barang || undefined;
        if (!row.collie || row.collie <= 0) {
            row.collie = itemSummary.collie > 0 ? itemSummary.collie : undefined;
        }
        if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
            row.beratKg = itemSummary.beratKg;
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            row.tarip = normalizeNumber(deliveryOrder.taripBorongan || 0);
        }
        row.ket = row.ket || normalizeOptionalText(deliveryOrder.keteranganBorongan);
        row.uangRp = row.beratKg * row.tarip;
    }

    for (const row of rows) {
        if (!row.date || !row.noSJ || !row.tujuan) {
            return NextResponse.json(
                { error: `Baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} masih kurang tanggal, nomor SJ, atau tujuan` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.beratKg) || row.beratKg <= 0) {
            return NextResponse.json(
                { error: `Berat pada baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            return NextResponse.json(
                { error: `Tarip pada baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = row.beratKg * row.tarip;
    }

    if (uniqueDoRefs.length > 0) {
        const existingBoronganItems = await getSanityClient().fetch<Array<{ doRef?: string; doNumber?: string }>>(
            `*[_type == "driverBoronganItem" && doRef in $ids]{ doRef, doNumber }`,
            { ids: uniqueDoRefs }
        );
        if (existingBoronganItems.length > 0) {
            const duplicate = existingBoronganItems[0];
            return NextResponse.json(
                { error: `DO ${duplicate.doNumber || duplicate.doRef || ''} sudah tercantum di slip borongan lain` },
                { status: 409 }
            );
        }
    }

    const inferredDriverRefs = [...new Set(
        deliveryOrders
            .map(deliveryOrder => extractRefId(deliveryOrder.driverRef))
            .filter((ref): ref is string => Boolean(ref))
    )];
    if (inferredDriverRefs.length > 1) {
        return NextResponse.json(
            { error: 'DO yang dipilih berasal dari supir berbeda. Pisahkan per slip borongan.' },
            { status: 409 }
        );
    }

    const inferredDriverRef = inferredDriverRefs[0];
    if (resolvedDriverRef && inferredDriverRef && resolvedDriverRef !== inferredDriverRef) {
        return NextResponse.json(
            { error: 'Supir borongan tidak cocok dengan DO yang dipilih' },
            { status: 409 }
        );
    }
    if (!resolvedDriverRef && inferredDriverRef) {
        resolvedDriverRef = inferredDriverRef;
    }

    let finalDriverName = driverName;
    if (resolvedDriverRef) {
        const driverDoc = await getSanityClient().fetch<{ name?: string } | null>(
            `*[_type == "driver" && _id == $id][0]{ name }`,
            { id: resolvedDriverRef }
        );
        if (driverDoc?.name) {
            finalDriverName = driverDoc.name;
        }
    }
    if (!finalDriverName) {
        return NextResponse.json({ error: 'Nama supir borongan wajib diisi' }, { status: 400 });
    }

    const totalAmount = rows.reduce((sum, row) => sum + row.uangRp, 0);
    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalWeightKg = rows.reduce((sum, row) => sum + row.beratKg, 0);
    if (totalAmount <= 0) {
        return NextResponse.json({ error: 'Total borongan harus lebih besar dari 0' }, { status: 400 });
    }

    const boronganId = crypto.randomUUID();
    const boronganNumber = await sanityGetNextNumber('borong');
    const boronganDoc = {
        _id: boronganId,
        _type: 'driverBorongan',
        driverRef: resolvedDriverRef,
        driverName: finalDriverName,
        periodStart,
        periodEnd,
        status: 'UNPAID',
        totalAmount,
        totalCollie,
        totalWeightKg,
        notes: normalizeOptionalText(data.notes),
        boronganNumber,
    };

    const transaction = getSanityClient().transaction().create(boronganDoc);
    for (const row of rows) {
        transaction.create({
            _id: crypto.randomUUID(),
            _type: 'driverBoronganItem',
            boronganRef: boronganId,
            doRef: row.doRef,
            doNumber: row.doNumber,
            vehiclePlate: row.vehiclePlate,
            date: row.date,
            noSJ: row.noSJ,
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
    void addAuditLog(session, 'CREATE', 'driver-borongans', boronganId, `Created driver-borongans: ${boronganNumber}`);
    return NextResponse.json({ data: boronganDoc, id: boronganId });
}

export async function handleDriverBoronganDelete(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const id = typeof data.id === 'string' ? data.id : '';
    if (!id) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const borongan = await sanityGetById<{ _id: string; boronganNumber?: string; status?: string }>(id);
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (borongan.status === 'PAID') {
        return NextResponse.json({ error: 'Slip borongan yang sudah dibayar tidak boleh dihapus' }, { status: 409 });
    }

    const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
        `*[_type == "expense" && boronganRef == $ref][0]{ _id }`,
        { ref: id }
    );
    if (existingExpense) {
        return NextResponse.json({ error: 'Slip borongan yang sudah punya pengeluaran tidak boleh dihapus' }, { status: 409 });
    }

    const itemIds = await getSanityClient().fetch<string[]>(
        `*[_type == "driverBoronganItem" && boronganRef == $ref]._id`,
        { ref: id }
    );
    const transaction = getSanityClient().transaction();
    for (const itemId of itemIds) {
        transaction.delete(itemId);
    }
    transaction.delete(id);
    await transaction.commit();

    void addAuditLog(session, 'DELETE', 'driver-borongans', id, `Deleted driver-borongans ${borongan.boronganNumber || id}`);
    return NextResponse.json({ success: true });
}

export async function handleBoronganPayment(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const boronganId = typeof data.id === 'string' ? data.id : '';
    if (!boronganId) {
        return NextResponse.json({ error: 'Borongan tidak valid' }, { status: 400 });
    }

    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal pembayaran borongan tidak valid' }, { status: 400 });
    }

    const paymentMethod = typeof data.paymentMethod === 'string' ? data.paymentMethod : 'CASH';
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paidDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(paidDate, 'Tanggal pembayaran');
    const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined;
    const expenseId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const borongan = await sanityGetById<{
            _id: string;
            _rev?: string;
            boronganNumber: string;
            driverName: string;
            totalAmount: number;
            status: string;
        }>(boronganId);
        if (!borongan) {
            return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
        }
        if (!borongan._rev) {
            return NextResponse.json({ error: 'Revisi borongan tidak tersedia' }, { status: 409 });
        }
        if (borongan.status === 'PAID') {
            return NextResponse.json({ error: 'Borongan ini sudah dibayar' }, { status: 409 });
        }
        if (amount !== borongan.totalAmount) {
            return NextResponse.json({ error: 'Pembayaran borongan harus sama dengan total borongan' }, { status: 400 });
        }

        const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "expense" && boronganRef == $ref][0]{ _id }`,
            { ref: boronganId }
        );
        if (existingExpense) {
            return NextResponse.json({ error: 'Pengeluaran borongan sudah pernah dicatat' }, { status: 409 });
        }

        let bankAccount: BankAccountSummary | null = null;
        if (selectedAccountRef) {
            bankAccount = await getLedgerAccount(selectedAccountRef);
            if (!bankAccount) {
                return NextResponse.json({ error: 'Rekening bank tidak ditemukan' }, { status: 404 });
            }
        } else if (paymentMethod === 'CASH') {
            bankAccount = await ensureCashAccount();
        }
        if (paymentMethod === 'TRANSFER' && bankAccount?.accountType === 'CASH') {
            return NextResponse.json(
                { error: 'Metode transfer harus memakai rekening bank, bukan akun Kas Tunai' },
                { status: 400 }
            );
        }
        if (bankAccount && !bankAccount._rev) {
            return NextResponse.json({ error: 'Revisi rekening tidak tersedia' }, { status: 409 });
        }

        const bankAccountRef = bankAccount?._id;
        const transaction = getSanityClient()
            .transaction()
            .create({
                _id: expenseId,
                _type: 'expense',
                categoryRef: 'driver-borongan',
                categoryName: 'Borongan Supir',
                date: paidDate,
                amount,
                description: `Upah borongan supir ${borongan.driverName} - ${borongan.boronganNumber}`,
                note,
                privacyLevel: 'internal',
                paymentMethod,
                bankAccountRef,
                bankAccountName: bankAccount?.bankName,
                bankAccountNumber: bankAccount?.accountNumber,
                boronganRef: boronganId,
            })
            .patch(boronganId, {
                ifRevisionID: borongan._rev,
                set: {
                    status: 'PAID',
                    paidDate,
                    paidMethod: paymentMethod,
                    paidBankRef: bankAccountRef,
                    paidBankName: bankAccount?.bankName,
                    paidBankNumber: bankAccount?.accountNumber,
                },
            });

        if (bankAccount && bankAccountRef) {
            const newBalance = (bankAccount.currentBalance || 0) - amount;
            transaction
                .create({
                    _id: bankTransactionId,
                    _type: 'bankTransaction',
                    bankAccountRef,
                    bankAccountName: bankAccount.bankName,
                    bankAccountNumber: bankAccount.accountNumber,
                    type: 'DEBIT',
                    amount,
                    date: paidDate,
                    description: `Pembayaran borongan ${borongan.boronganNumber}`,
                    balanceAfter: newBalance,
                    relatedExpenseRef: expenseId,
                })
                .patch(bankAccountRef, {
                    ifRevisionID: bankAccount._rev,
                    set: { currentBalance: newBalance },
                });
        }

        try {
            await transaction.commit();
            void addAuditLog(
                session,
                'CREATE',
                'driver-borongans',
                boronganId,
                `Pembayaran borongan dicatat: ${borongan.boronganNumber}`
            );
            return NextResponse.json({
                data: {
                    ...borongan,
                    status: 'PAID',
                    paidDate,
                    paidMethod: paymentMethod,
                    paidBankRef: bankAccountRef,
                    paidBankName: bankAccount?.bankName,
                    paidBankNumber: bankAccount?.accountNumber,
                },
                expenseId,
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Pembayaran borongan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pembayaran borongan berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

function toCategoryRef(categoryName: string) {
    const slug = categoryName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `driver-voucher-${slug || 'misc'}`;
}

async function getDriverVoucherState(voucherId: string) {
    const voucher = await sanityGetById<{
        _id: string;
        _rev?: string;
        bonNumber: string;
        status: string;
        cashGiven: number;
        issuedDate: string;
        issueBankRef?: string;
        issueBankName?: string;
        vehicleRef?: string;
    }>(voucherId);

    if (!voucher) {
        return { error: NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 }) };
    }

    const items = await getSanityClient().fetch<Array<{ _id: string; category: string; description?: string; amount: number }>>(
        `*[_type == "driverVoucherItem" && voucherRef == $ref] | order(_createdAt asc){ _id, category, description, amount }`,
        { ref: voucherId }
    );

    return { voucher, items };
}

export async function handleDriverVoucherCreate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const cashGiven = typeof data.cashGiven === 'number' ? data.cashGiven : Number(data.cashGiven);
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
        return NextResponse.json({ error: 'Nominal bon supir tidak valid' }, { status: 400 });
    }

    const driverRef = typeof data.driverRef === 'string' ? data.driverRef : '';
    if (!driverRef) {
        return NextResponse.json({ error: 'Supir wajib dipilih' }, { status: 400 });
    }

    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!issueBankRef) {
        return NextResponse.json({ error: 'Rekening sumber bon wajib dipilih' }, { status: 400 });
    }

    const issueDate =
        typeof data.issuedDate === 'string' && data.issuedDate
            ? data.issuedDate
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(issueDate, 'Tanggal bon');
    const bonNumber = await sanityGetNextNumber('bon');
    const voucherId = crypto.randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const issueBank = await getLedgerAccount(issueBankRef);
        if (!issueBank) {
            return NextResponse.json({ error: 'Rekening sumber bon tidak ditemukan' }, { status: 404 });
        }
        if (!issueBank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber tidak tersedia' }, { status: 409 });
        }

        const newBalance = (issueBank.currentBalance || 0) - cashGiven;
        const voucherDoc = {
            _id: voucherId,
            _type: 'driverVoucher',
            ...data,
            bonNumber,
            issuedDate: issueDate,
            cashGiven,
            issueBankRef,
            issueBankName: issueBank.bankName,
            totalSpent: 0,
            balance: cashGiven,
            status: 'ISSUED',
        };

        const transaction = getSanityClient()
            .transaction()
            .create(voucherDoc)
            .create({
                _id: crypto.randomUUID(),
                _type: 'bankTransaction',
                bankAccountRef: issueBankRef,
                bankAccountName: issueBank.bankName,
                bankAccountNumber: issueBank.accountNumber,
                type: 'DEBIT',
                amount: cashGiven,
                date: issueDate,
                description: `Pencairan bon supir ${bonNumber}`,
                balanceAfter: newBalance,
                relatedVoucherRef: voucherId,
            })
            .patch(issueBankRef, {
                ifRevisionID: issueBank._rev,
                set: { currentBalance: newBalance },
            });

        try {
            await transaction.commit();
            void addAuditLog(session, 'CREATE', 'driver-vouchers', voucherId, `Bon supir diterbitkan: ${bonNumber}`);
            return NextResponse.json({ data: voucherDoc, id: voucherId });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Pencairan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pencairan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleDriverVoucherItemCreate(data: Record<string, unknown>) {
    const voucherRef = typeof data.voucherRef === 'string' ? data.voucherRef : '';
    if (!voucherRef) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = typeof data.amount === 'number' ? data.amount : Number(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal item tidak valid' }, { status: 400 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(voucherRef);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const itemId = crypto.randomUUID();
        const nextTotal = state.items.reduce((sum, item) => sum + item.amount, 0) + amount;
        const nextBalance = (state.voucher.cashGiven || 0) - nextTotal;
        const itemDoc = {
            _id: itemId,
            _type: 'driverVoucherItem',
            voucherRef,
            category: typeof data.category === 'string' && data.category.trim() ? data.category.trim() : 'Lain-lain',
            description: typeof data.description === 'string' ? data.description.trim() : '',
            amount,
        };

        try {
            await getSanityClient()
                .transaction()
                .create(itemDoc)
                .patch(voucherRef, {
                    ifRevisionID: state.voucher._rev,
                    set: {
                        totalSpent: nextTotal,
                        balance: nextBalance,
                    },
                })
                .commit();

            return NextResponse.json({
                data: itemDoc,
                voucher: {
                    ...state.voucher,
                    totalSpent: nextTotal,
                    balance: nextBalance,
                },
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleDriverVoucherItemDelete(data: Record<string, unknown>) {
    const itemId = typeof data.id === 'string' ? data.id : '';
    if (!itemId) {
        return NextResponse.json({ error: 'Item bon tidak valid' }, { status: 400 });
    }

    const item = await sanityGetById<{ _id: string; voucherRef: string }>(itemId);
    if (!item?.voucherRef) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan' }, { status: 404 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(item.voucherRef);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const nextTotal = state.items
            .filter(existing => existing._id !== itemId)
            .reduce((sum, existing) => sum + existing.amount, 0);
        const nextBalance = (state.voucher.cashGiven || 0) - nextTotal;

        try {
            await getSanityClient()
                .transaction()
                .delete(itemId)
                .patch(item.voucherRef, {
                    ifRevisionID: state.voucher._rev,
                    set: {
                        totalSpent: nextTotal,
                        balance: nextBalance,
                    },
                })
                .commit();

            return NextResponse.json({
                success: true,
                voucher: {
                    ...state.voucher,
                    totalSpent: nextTotal,
                    balance: nextBalance,
                },
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleDriverVoucherSettlement(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const settledDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(settledDate, 'Tanggal settlement');

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(voucherId);
        if ('error' in state) return state.error;
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon supir ini sudah settle' }, { status: 409 });
        }
        if (state.items.length === 0) {
            return NextResponse.json({ error: 'Tambahkan minimal satu item pengeluaran sebelum settle' }, { status: 400 });
        }

        const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "expense" && voucherRef == $ref][0]{ _id }`,
            { ref: voucherId }
        );
        if (existingExpense) {
            return NextResponse.json({ error: 'Bon supir ini sudah pernah diposting ke pengeluaran' }, { status: 409 });
        }

        const totalSpent = state.items.reduce((sum, item) => sum + item.amount, 0);
        const balance = (state.voucher.cashGiven || 0) - totalSpent;
        const settlementBankRef =
            typeof data.settlementBankRef === 'string' && data.settlementBankRef
                ? data.settlementBankRef
                : state.voucher.issueBankRef || '';
        let settlementBank: BankAccountSummary | null = null;

        if (balance !== 0) {
            if (!settlementBankRef) {
                return NextResponse.json({ error: 'Rekening settlement wajib dipilih untuk selisih bon' }, { status: 400 });
            }

            settlementBank = await getLedgerAccount(settlementBankRef);
            if (!settlementBank) {
                return NextResponse.json({ error: 'Rekening settlement tidak ditemukan' }, { status: 404 });
            }
            if (!settlementBank._rev) {
                return NextResponse.json({ error: 'Revisi rekening settlement tidak tersedia' }, { status: 409 });
            }
        }

        const transaction = getSanityClient().transaction();
        for (const item of state.items) {
            transaction.create({
                _id: crypto.randomUUID(),
                _type: 'expense',
                categoryRef: toCategoryRef(item.category),
                categoryName: item.category,
                date: settledDate,
                amount: item.amount,
                description: item.description || `Pengeluaran bon supir ${state.voucher.bonNumber}`,
                note: `Bon supir ${state.voucher.bonNumber}`,
                privacyLevel: 'internal',
                relatedVehicleRef: state.voucher.vehicleRef,
                voucherRef: voucherId,
            });
        }

        if (settlementBank && settlementBankRef) {
            const adjustmentAmount = Math.abs(balance);
            const nextBankBalance =
                balance > 0
                    ? (settlementBank.currentBalance || 0) + adjustmentAmount
                    : (settlementBank.currentBalance || 0) - adjustmentAmount;
            transaction
                .create({
                    _id: crypto.randomUUID(),
                    _type: 'bankTransaction',
                    bankAccountRef: settlementBankRef,
                    bankAccountName: settlementBank.bankName,
                    bankAccountNumber: settlementBank.accountNumber,
                    type: balance > 0 ? 'CREDIT' : 'DEBIT',
                    amount: adjustmentAmount,
                    date: settledDate,
                    description:
                        balance > 0
                            ? `Pengembalian sisa bon ${state.voucher.bonNumber}`
                            : `Kekurangan bon ${state.voucher.bonNumber}`,
                    balanceAfter: nextBankBalance,
                    relatedVoucherRef: voucherId,
                })
                .patch(settlementBankRef, {
                    ifRevisionID: settlementBank._rev,
                    set: { currentBalance: nextBankBalance },
                });
        }

        transaction.patch(voucherId, {
            ifRevisionID: state.voucher._rev,
            set: {
                status: 'SETTLED',
                settledDate,
                settledBy: session.name,
                totalSpent,
                balance,
                settlementBankRef: settlementBankRef || undefined,
                settlementBankName: settlementBank?.bankName,
            },
        });

        try {
            await transaction.commit();

            const updatedVoucher = {
                ...state.voucher,
                status: 'SETTLED',
                settledDate,
                settledBy: session.name,
                totalSpent,
                balance,
                settlementBankRef: settlementBankRef || undefined,
                settlementBankName: settlementBank?.bankName,
            };

            void addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Bon supir settle: ${state.voucher.bonNumber}`);
            return NextResponse.json({ data: updatedVoucher });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Settlement bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Settlement bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleDriverVoucherIssueRepair(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    const issueBankRef = typeof data.issueBankRef === 'string' ? data.issueBankRef : '';
    if (!voucherId || !issueBankRef) {
        return NextResponse.json({ error: 'Data rekonsiliasi bon tidak lengkap' }, { status: 400 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const voucher = await sanityGetById<{
            _id: string;
            _rev?: string;
            bonNumber: string;
            issuedDate: string;
            cashGiven: number;
            issueBankRef?: string;
        }>(voucherId);
        if (!voucher) {
            return NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 });
        }
        if (!voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }
        if (voucher.issueBankRef) {
            return NextResponse.json({ error: 'Bon ini sudah punya rekening sumber' }, { status: 409 });
        }

        const existingTx = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "bankTransaction" && relatedVoucherRef == $ref][0]{ _id }`,
            { ref: voucherId }
        );
        if (existingTx) {
            return NextResponse.json({ error: 'Bon ini sudah punya mutasi bank terkait' }, { status: 409 });
        }

        const bank = await getLedgerAccount(issueBankRef);
        if (!bank) {
            return NextResponse.json({ error: 'Rekening sumber tidak ditemukan' }, { status: 404 });
        }
        if (!bank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber tidak tersedia' }, { status: 409 });
        }

        const newBalance = (bank.currentBalance || 0) - (voucher.cashGiven || 0);
        try {
            await getSanityClient()
                .transaction()
                .create({
                    _id: crypto.randomUUID(),
                    _type: 'bankTransaction',
                    bankAccountRef: issueBankRef,
                    bankAccountName: bank.bankName,
                    bankAccountNumber: bank.accountNumber,
                    type: 'DEBIT',
                    amount: voucher.cashGiven || 0,
                    date: voucher.issuedDate,
                    description: `Rekonsiliasi pencairan bon ${voucher.bonNumber}`,
                    balanceAfter: newBalance,
                    relatedVoucherRef: voucherId,
                })
                .patch(issueBankRef, {
                    ifRevisionID: bank._rev,
                    set: { currentBalance: newBalance },
                })
                .patch(voucherId, {
                    ifRevisionID: voucher._rev,
                    set: {
                        issueBankRef,
                        issueBankName: bank.bankName,
                    },
                })
                .commit();

            const updatedVoucher = {
                ...voucher,
                issueBankRef,
                issueBankName: bank.bankName,
            };

            void addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Rekonsiliasi pencairan bon: ${voucher.bonNumber}`);
            return NextResponse.json({ data: updatedVoucher });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Rekonsiliasi bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Rekonsiliasi bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}
