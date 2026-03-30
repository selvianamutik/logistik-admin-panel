import { NextResponse } from 'next/server';

import { resolveCompanyLogoUrl } from '@/lib/branding';
import { getSanityClient, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import type { CompanyProfile } from '@/lib/types';

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
    buildRouteLabel,
    computeDriverVoucherTotals,
    getDriverVoucherInitialCash,
    getDriverVoucherIssuedAmount,
    isDriverBoronganRowEmpty,
    summarizeBoronganDeliveryOrderItems,
    toCategoryRef,
    type DriverBoronganDeliveryOrderItemSummarySource,
} from './driver-workflow-support';

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
    customerDoNumber?: string;
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
            const noSJ = normalizeText(row.noSJ);
            const tujuan = normalizeText(row.tujuan);
            const beratKg = normalizeNumber(row.beratKg);
            const tarip = normalizeCurrencyNumber(row.tarip);
            const collie = normalizeNumber(row.collie ?? 0);

            if ((!date || !noSJ || !tujuan) && !doRef) {
                throw new Error('Baris borongan wajib punya tanggal, nomor SJ, dan tujuan');
            }
            if (!Number.isFinite(beratKg) || beratKg < 0) {
                throw new Error('Berat pada baris borongan tidak valid');
            }
            if ((!Number.isFinite(tarip) || tarip <= 0) && !doRef) {
                throw new Error('Tarif borongan pada baris harus lebih besar dari 0');
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
                uangRp: tarip,
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
                customerDoNumber,
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
        ? await getSanityClient().fetch<DriverBoronganDeliveryOrderItemSummarySource[]>(
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
    const doItemMap = new Map<string, DriverBoronganDeliveryOrderItemSummarySource[]>();
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

        row.doNumber = normalizeOptionalText(deliveryOrder.doNumber) || row.doNumber;
        row.noSJ =
            normalizeOptionalText(deliveryOrder.customerDoNumber) ||
            row.noSJ ||
            '';
        row.vehiclePlate = normalizeOptionalText(deliveryOrder.vehiclePlate) || row.vehiclePlate;
        row.date = normalizeOptionalText(deliveryOrder.date) || row.date || '';
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
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            row.tarip = normalizeNumber(deliveryOrder.taripBorongan || 0);
        }
        row.ket = row.ket || normalizeOptionalText(deliveryOrder.keteranganBorongan);
        row.uangRp = row.tarip;
    }

    for (const row of rows) {
        if (!row.date || !row.noSJ || !row.tujuan) {
            return NextResponse.json(
                { error: `Baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} masih kurang tanggal, nomor SJ, atau tujuan` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.beratKg) || row.beratKg < 0) {
            return NextResponse.json(
                { error: `Berat pada baris borongan ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        if (!Number.isFinite(row.tarip) || row.tarip <= 0) {
            return NextResponse.json(
                { error: `Tarif borongan pada baris ${row.doNumber || row.noSJ || row.doRef || ''} tidak valid` },
                { status: 400 }
            );
        }
        row.uangRp = row.tarip;
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

        const existingVoucherTrips = await getSanityClient().fetch<Array<{ doNumber?: string; bonNumber?: string }>>(
            `*[
                _type == "driverVoucher" &&
                (deliveryOrderRef in $ids || deliveryOrderRef._ref in $ids)
            ]{
                doNumber,
                bonNumber
            }`,
            { ids: uniqueDoRefs }
        );
        if (existingVoucherTrips.length > 0) {
            const duplicateVoucher = existingVoucherTrips[0];
            return NextResponse.json(
                {
                    error: `DO ${duplicateVoucher.doNumber || ''} sudah memakai settlement trip di bon ${duplicateVoucher.bonNumber || ''}. Jangan dobel lewat slip borongan.`,
                },
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

    const driverDerivedFromDo = Boolean(inferredDriverRef && inferredDriverRef === resolvedDriverRef && deliveryOrders.length > 0);
    let finalDriverName = driverName;
    if (resolvedDriverRef) {
        const driverDoc = await getSanityClient().fetch<{ _id: string; name?: string; active?: boolean } | null>(
            `*[_type == "driver" && _id == $id][0]{ _id, name, active }`,
            { id: resolvedDriverRef }
        );
        if (!driverDoc) {
            return NextResponse.json({ error: 'Supir borongan tidak ditemukan' }, { status: 404 });
        }
        if (driverDoc.active === false && !driverDerivedFromDo) {
            return NextResponse.json({ error: 'Supir borongan tidak aktif untuk slip manual' }, { status: 409 });
        }
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
    const companyProfile = await getSanityClient().fetch<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'> | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl
        }`
    );
    const boronganDoc = {
        _id: boronganId,
        _type: 'driverBorongan',
        issuerCompanyName: companyProfile?.name,
        issuerCompanyAddress: companyProfile?.address,
        issuerCompanyPhone: companyProfile?.phone,
        issuerCompanyEmail: companyProfile?.email,
        issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
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
    await addAuditLog(session, 'CREATE', 'driver-borongans', boronganId, `Created driver-borongans: ${boronganNumber}`);
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

    await addAuditLog(session, 'DELETE', 'driver-borongans', id, `Deleted driver-borongans ${borongan.boronganNumber || id}`);
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

    const amount = normalizeCurrencyNumber(data.amount);
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
        if (paymentMethod === 'CASH' && bankAccount?.accountType && bankAccount.accountType !== 'CASH') {
            return NextResponse.json(
                { error: 'Metode tunai harus memakai akun Kas Tunai, bukan rekening bank' },
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
            await addAuditLog(
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

async function getDriverVoucherState(voucherId: string) {
    const voucher = await sanityGetById<{
        _id: string;
        _rev?: string;
        bonNumber: string;
        status: string;
        cashGiven: number;
        initialCashGiven?: number;
        totalIssuedAmount?: number;
        topUpCount?: number;
        driverFeeAmount?: number;
        totalClaimAmount?: number;
        issuedDate: string;
        issueBankRef?: string;
        issueBankName?: string;
        vehicleRef?: string;
        vehiclePlate?: string;
        driverName?: string;
        deliveryOrderRef?: string;
    }>(voucherId);

        if (!voucher) {
        return { error: NextResponse.json({ error: 'Bon supir tidak ditemukan' }, { status: 404 }) };
    }

    const items = await getSanityClient().fetch<Array<{ _id: string; category: string; description?: string; amount: number; expenseDate?: string }>>(
        `*[_type == "driverVoucherItem" && voucherRef == $ref] | order(coalesce(expenseDate, _createdAt) asc){ _id, expenseDate, category, description, amount }`,
        { ref: voucherId }
    );

    const disbursements = await getSanityClient().fetch<Array<{
        _id: string;
        kind: 'INITIAL' | 'TOP_UP';
        date: string;
        amount: number;
        bankAccountRef?: string;
        bankAccountName?: string;
        bankAccountNumber?: string;
        bankTransactionRef?: string;
        note?: string;
    }>>(
        `*[_type == "driverVoucherDisbursement" && voucherRef == $ref] | order(date asc, _createdAt asc){
            _id,
            kind,
            date,
            amount,
            bankAccountRef,
            bankAccountName,
            bankAccountNumber,
            bankTransactionRef,
            note
        }`,
        { ref: voucherId }
    );

    return { voucher, items, disbursements };
}

export async function handleDriverVoucherCreate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const cashGiven = normalizeCurrencyNumber(data.cashGiven);
    if (!Number.isFinite(cashGiven) || cashGiven <= 0) {
        return NextResponse.json({ error: 'Nominal uang jalan trip tidak valid' }, { status: 400 });
    }

    const deliveryOrderRef = typeof data.deliveryOrderRef === 'string' ? data.deliveryOrderRef : '';
    if (!deliveryOrderRef) {
        return NextResponse.json({ error: 'Bon supir wajib dikaitkan ke 1 surat jalan / trip' }, { status: 400 });
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

    const requestedDriverFeeAmount = normalizeCurrencyNumber(data.driverFeeAmount ?? 0);
    if (!Number.isFinite(requestedDriverFeeAmount) || requestedDriverFeeAmount < 0) {
        return NextResponse.json({ error: 'Upah trip pada bon tidak valid' }, { status: 400 });
    }

    const deliveryOrder = await sanityGetById<{
        _id: string;
        _rev?: string;
        doNumber?: string;
        status?: string;
        driverRef?: unknown;
        driverName?: string;
        vehicleRef?: string;
        vehiclePlate?: string;
        receiverAddress?: string;
        pickupAddress?: string;
        taripBorongan?: number;
        orderRef?: unknown;
    }>(deliveryOrderRef);
    if (!deliveryOrder) {
        return NextResponse.json({ error: 'Surat jalan bon tidak ditemukan' }, { status: 404 });
    }
    if (deliveryOrder.status && !['CREATED', 'HEADING_TO_PICKUP', 'ON_DELIVERY', 'ARRIVED', 'DELIVERED'].includes(deliveryOrder.status)) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} dengan status ${deliveryOrder.status} tidak bisa dipakai untuk uang jalan trip.` },
            { status: 409 }
        );
    }

    const driverRef = extractRefId(deliveryOrder.driverRef);
    if (!driverRef) {
        return NextResponse.json(
            { error: `Tetapkan supir pada DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    const driver = await sanityGetById<{ _id: string; name?: string; active?: boolean }>(driverRef);
    if (!driver) {
        return NextResponse.json({ error: 'Supir trip tidak ditemukan' }, { status: 404 });
    }
    if (driver.active === false) {
        return NextResponse.json({ error: 'Supir trip tidak aktif' }, { status: 409 });
    }

    if (!deliveryOrder.vehicleRef && !deliveryOrder.vehiclePlate) {
        return NextResponse.json(
            { error: `Tetapkan kendaraan pada DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    const canonicalDriverName = driver.name || deliveryOrder.driverName || '';
    let canonicalDoNumber =
        typeof data.doNumber === 'string' && data.doNumber.trim()
            ? data.doNumber.trim()
            : undefined;
    let canonicalVehicleRef =
        typeof data.vehicleRef === 'string' && data.vehicleRef.trim()
            ? data.vehicleRef.trim()
            : undefined;
    let canonicalVehiclePlate =
        typeof data.vehiclePlate === 'string' && data.vehiclePlate.trim()
            ? data.vehiclePlate.trim()
            : undefined;
    let canonicalRoute =
        typeof data.route === 'string' && data.route.trim()
            ? data.route.trim()
            : undefined;

    if (
        canonicalVehicleRef &&
        deliveryOrder.vehicleRef &&
        canonicalVehicleRef !== deliveryOrder.vehicleRef
    ) {
        return NextResponse.json(
            { error: 'Kendaraan bon tidak cocok dengan kendaraan pada surat jalan' },
            { status: 409 }
        );
    }

    canonicalDoNumber = deliveryOrder.doNumber || canonicalDoNumber;
    canonicalVehicleRef = deliveryOrder.vehicleRef || canonicalVehicleRef || undefined;
    canonicalVehiclePlate = deliveryOrder.vehiclePlate || canonicalVehiclePlate || undefined;

    const orderRef = extractRefId(deliveryOrder.orderRef);
    const order = orderRef
        ? await sanityGetById<{ _id: string; pickupAddress?: string; receiverAddress?: string }>(orderRef)
        : null;
    canonicalRoute = buildRouteLabel(
        deliveryOrder.pickupAddress || order?.pickupAddress,
        deliveryOrder.receiverAddress || order?.receiverAddress,
    ) || canonicalRoute;

    const existingVoucher = await getSanityClient().fetch<{ bonNumber?: string; status?: string } | null>(
        `*[
            _type == "driverVoucher" &&
            (deliveryOrderRef == $ref || deliveryOrderRef._ref == $ref)
        ][0]{
            bonNumber,
            status
        }`,
        { ref: deliveryOrderRef }
    );
    if (existingVoucher) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} sudah punya bon ${existingVoucher.bonNumber || ''}. Gunakan satu bon per perjalanan agar settlement tidak bercampur.` },
            { status: 409 }
        );
    }

    const existingBoronganItem = await getSanityClient().fetch<{ doNumber?: string } | null>(
        `*[_type == "driverBoronganItem" && doRef == $ref][0]{ doNumber }`,
        { ref: deliveryOrderRef }
    );
    if (existingBoronganItem) {
        return NextResponse.json(
            { error: `DO ${deliveryOrder.doNumber || deliveryOrderRef} sudah tercantum di slip borongan. Trip ini harus settle lewat uang jalan trip, bukan dobel.` },
            { status: 409 }
        );
    }

    const deliveryOrderTripFee = normalizeNumber(deliveryOrder.taripBorongan || 0);
    const effectiveDriverFeeAmount =
        requestedDriverFeeAmount > 0
            ? requestedDriverFeeAmount
            : deliveryOrderTripFee;
    if (!Number.isFinite(effectiveDriverFeeAmount) || effectiveDriverFeeAmount <= 0) {
        return NextResponse.json(
            { error: `Isi upah trip saat membuat bon untuk DO ${deliveryOrder.doNumber || deliveryOrderRef}.` },
            { status: 409 }
        );
    }

    data.driverFeeAmount = effectiveDriverFeeAmount;
    const shouldSyncDriverFeeToDo = Math.abs(deliveryOrderTripFee - effectiveDriverFeeAmount) > 0.01;

    if (canonicalVehicleRef && !canonicalVehiclePlate) {
        const vehicle = await sanityGetById<{ _id: string; plateNumber?: string }>(canonicalVehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan bon tidak ditemukan' }, { status: 404 });
        }
        canonicalVehiclePlate = vehicle.plateNumber;
    }

    const bonNumber = await sanityGetNextNumber('bon');
    const voucherId = crypto.randomUUID();
    const initialDisbursementId = crypto.randomUUID();
    const issueTransactionId = crypto.randomUUID();
    const companyProfile = await getSanityClient().fetch<Pick<CompanyProfile, 'name' | 'address' | 'phone' | 'email' | 'logoUrl'> | null>(
        `*[_type == "companyProfile"][0]{
            name,
            address,
            phone,
            email,
            logoUrl
        }`
    );
    const driverFeeAmount = normalizeCurrencyNumber(data.driverFeeAmount ?? requestedDriverFeeAmount);
    const voucherTotals = computeDriverVoucherTotals(cashGiven, 0, driverFeeAmount);

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
            issuerCompanyName: companyProfile?.name,
            issuerCompanyAddress: companyProfile?.address,
            issuerCompanyPhone: companyProfile?.phone,
            issuerCompanyEmail: companyProfile?.email,
            issuerCompanyLogoUrl: resolveCompanyLogoUrl(companyProfile),
            driverRef,
            driverName: canonicalDriverName,
            deliveryOrderRef,
            doNumber: canonicalDoNumber,
            vehicleRef: canonicalVehicleRef,
            vehiclePlate: canonicalVehiclePlate,
            route: canonicalRoute,
            bonNumber,
            issuedDate: issueDate,
            cashGiven,
            initialCashGiven: cashGiven,
            totalIssuedAmount: cashGiven,
            topUpCount: 0,
            driverFeeAmount: voucherTotals.driverFeeAmount,
            totalClaimAmount: voucherTotals.totalClaimAmount,
            issueBankRef,
            issueBankName: issueBank.bankName,
            totalSpent: voucherTotals.totalSpent,
            balance: voucherTotals.balance,
            status: 'ISSUED',
            notes: normalizeOptionalText(data.notes),
        };

        const transaction = getSanityClient()
            .transaction()
            .create(voucherDoc)
            .create({
                _id: initialDisbursementId,
                _type: 'driverVoucherDisbursement',
                voucherRef: voucherId,
                date: issueDate,
                amount: cashGiven,
                kind: 'INITIAL',
                bankAccountRef: issueBankRef,
                bankAccountName: issueBank.bankName,
                bankAccountNumber: issueBank.accountNumber,
                bankTransactionRef: issueTransactionId,
                createdBy: session._id,
                createdByName: session.name,
            })
            .create({
                _id: issueTransactionId,
                _type: 'bankTransaction',
                bankAccountRef: issueBankRef,
                bankAccountName: issueBank.bankName,
                bankAccountNumber: issueBank.accountNumber,
                type: 'DEBIT',
                amount: cashGiven,
                date: issueDate,
                description: `Pencairan uang jalan trip ${bonNumber}`,
                balanceAfter: newBalance,
                relatedVoucherRef: voucherId,
            })
            .patch(issueBankRef, {
                ifRevisionID: issueBank._rev,
                set: { currentBalance: newBalance },
            });

        if (shouldSyncDriverFeeToDo) {
            transaction.patch(deliveryOrderRef, {
                set: { taripBorongan: effectiveDriverFeeAmount },
            });
        }

        try {
            await transaction.commit();
            await addAuditLog(
                session,
                'CREATE',
                'driver-vouchers',
                voucherId,
                `Bon trip diterbitkan: ${bonNumber} untuk DO ${canonicalDoNumber || deliveryOrderRef}`
            );
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

export async function handleDriverVoucherTopUp(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherId = typeof data.id === 'string' ? data.id : '';
    if (!voucherId) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal tambahan bon tidak valid' }, { status: 400 });
    }

    const bankAccountRef = typeof data.bankAccountRef === 'string' ? data.bankAccountRef : '';
    if (!bankAccountRef) {
        return NextResponse.json({ error: 'Rekening sumber tambahan bon wajib dipilih' }, { status: 400 });
    }

    const topUpDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(topUpDate, 'Tanggal tambahan bon');

    const note = normalizeOptionalText(data.note);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(voucherId);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa ditambah lagi' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const bank = await getLedgerAccount(bankAccountRef);
        if (!bank) {
            return NextResponse.json({ error: 'Rekening sumber tambahan bon tidak ditemukan' }, { status: 404 });
        }
        if (!bank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber tidak tersedia' }, { status: 409 });
        }

        const nextIssuedAmount = getDriverVoucherIssuedAmount(state.voucher) + amount;
        const nextTopUpCount = Math.max(state.voucher.topUpCount || 0, 0) + 1;
        const totals = computeDriverVoucherTotals(
            nextIssuedAmount,
            state.items.reduce((sum, item) => sum + item.amount, 0),
            normalizeNumber(state.voucher.driverFeeAmount || 0)
        );
        const transactionId = crypto.randomUUID();
        const disbursementId = crypto.randomUUID();
        const nextBankBalance = (bank.currentBalance || 0) - amount;

        try {
            await getSanityClient()
                .transaction()
                .create({
                    _id: disbursementId,
                    _type: 'driverVoucherDisbursement',
                    voucherRef: voucherId,
                    date: topUpDate,
                    amount,
                    kind: 'TOP_UP',
                    bankAccountRef,
                    bankAccountName: bank.bankName,
                    bankAccountNumber: bank.accountNumber,
                    bankTransactionRef: transactionId,
                    note,
                    createdBy: session._id,
                    createdByName: session.name,
                })
                .create({
                    _id: transactionId,
                    _type: 'bankTransaction',
                    bankAccountRef,
                    bankAccountName: bank.bankName,
                    bankAccountNumber: bank.accountNumber,
                    type: 'DEBIT',
                    amount,
                    date: topUpDate,
                    description: `Tambahan bon ${state.voucher.bonNumber}`,
                    balanceAfter: nextBankBalance,
                    relatedVoucherRef: voucherId,
                })
                .patch(bankAccountRef, {
                    ifRevisionID: bank._rev,
                    set: { currentBalance: nextBankBalance },
                })
                .patch(voucherId, {
                    ifRevisionID: state.voucher._rev,
                    set: {
                        totalIssuedAmount: nextIssuedAmount,
                        topUpCount: nextTopUpCount,
                        totalSpent: totals.totalSpent,
                        totalClaimAmount: totals.totalClaimAmount,
                        balance: totals.balance,
                    },
                })
                .commit();

            const updatedVoucher = {
                ...state.voucher,
                totalIssuedAmount: nextIssuedAmount,
                topUpCount: nextTopUpCount,
                totalSpent: totals.totalSpent,
                totalClaimAmount: totals.totalClaimAmount,
                balance: totals.balance,
            };
            const disbursementDoc = {
                _id: disbursementId,
                _type: 'driverVoucherDisbursement' as const,
                voucherRef: voucherId,
                date: topUpDate,
                amount,
                kind: 'TOP_UP' as const,
                bankAccountRef,
                bankAccountName: bank.bankName,
                bankAccountNumber: bank.accountNumber,
                bankTransactionRef: transactionId,
                note,
                createdBy: session._id,
                createdByName: session.name,
            };

            await addAuditLog(
                session,
                'UPDATE',
                'driver-vouchers',
                voucherId,
                `Tambah bon ${state.voucher.bonNumber}: ${amount} dari ${bank.bankName}`
            );

            return NextResponse.json({
                data: disbursementDoc,
                voucher: updatedVoucher,
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Tambahan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Tambahan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
        { status: 409 }
    );
}

export async function handleDriverVoucherItemCreate(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const voucherRef = typeof data.voucherRef === 'string' ? data.voucherRef : '';
    if (!voucherRef) {
        return NextResponse.json({ error: 'Bon supir tidak valid' }, { status: 400 });
    }

    const amount = normalizeCurrencyNumber(data.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'Nominal item tidak valid' }, { status: 400 });
    }

    const expenseDate =
        typeof data.expenseDate === 'string' && data.expenseDate
            ? data.expenseDate
            : new Date().toISOString().slice(0, 10);
    assertIsoDate(expenseDate, 'Tanggal biaya perjalanan');

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
        const nextOperationalSpent = state.items.reduce((sum, item) => sum + item.amount, 0) + amount;
        const nextTotals = computeDriverVoucherTotals(
            getDriverVoucherIssuedAmount(state.voucher),
            nextOperationalSpent,
            normalizeNumber(state.voucher.driverFeeAmount || 0)
        );
        const itemDoc = {
            _id: itemId,
            _type: 'driverVoucherItem',
            voucherRef,
            expenseDate,
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
                        totalSpent: nextTotals.totalSpent,
                        totalClaimAmount: nextTotals.totalClaimAmount,
                        balance: nextTotals.balance,
                    },
                })
                .commit();

            await addAuditLog(
                session,
                'CREATE',
                'driver-voucher-items',
                itemId,
                `Menambah item bon ${state.voucher.bonNumber}: ${itemDoc.category} ${itemDoc.description ? `- ${itemDoc.description}` : ''} (${itemDoc.amount})`
            );
            return NextResponse.json({
                data: itemDoc,
                voucher: {
                    ...state.voucher,
                    totalSpent: nextTotals.totalSpent,
                    totalClaimAmount: nextTotals.totalClaimAmount,
                    balance: nextTotals.balance,
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

export async function handleDriverVoucherItemDelete(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
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

        const nextOperationalSpent = state.items
            .filter(existing => existing._id !== itemId)
            .reduce((sum, existing) => sum + existing.amount, 0);
        const nextTotals = computeDriverVoucherTotals(
            getDriverVoucherIssuedAmount(state.voucher),
            nextOperationalSpent,
            normalizeNumber(state.voucher.driverFeeAmount || 0)
        );
        const deletedItem = state.items.find(existing => existing._id === itemId);

        try {
            await getSanityClient()
                .transaction()
                .delete(itemId)
                .patch(item.voucherRef, {
                    ifRevisionID: state.voucher._rev,
                    set: {
                        totalSpent: nextTotals.totalSpent,
                        totalClaimAmount: nextTotals.totalClaimAmount,
                        balance: nextTotals.balance,
                    },
                })
                .commit();

            await addAuditLog(
                session,
                'DELETE',
                'driver-voucher-items',
                itemId,
                `Menghapus item bon ${state.voucher.bonNumber}: ${deletedItem?.category || 'Item'}${deletedItem?.description ? ` - ${deletedItem.description}` : ''}`
            );
            return NextResponse.json({
                success: true,
                voucher: {
                    ...state.voucher,
                    totalSpent: nextTotals.totalSpent,
                    totalClaimAmount: nextTotals.totalClaimAmount,
                    balance: nextTotals.balance,
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

export async function handleDriverVoucherDisbursementDelete(
    session: Pick<ApiSession, '_id' | 'name'>,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    const disbursementId = typeof data.id === 'string' ? data.id : '';
    if (!disbursementId) {
        return NextResponse.json({ error: 'Tambahan bon tidak valid' }, { status: 400 });
    }

    const disbursement = await sanityGetById<{
        _id: string;
        _rev?: string;
        voucherRef?: string;
        amount?: number;
        kind?: 'INITIAL' | 'TOP_UP';
        bankAccountRef?: string;
        bankTransactionRef?: string;
        note?: string;
    }>(disbursementId);
    if (!disbursement?.voucherRef) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan' }, { status: 404 });
    }
    if (disbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa dihapus dari riwayat pencairan' }, { status: 409 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(disbursement.voucherRef);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa dikoreksi' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const amount = normalizeNumber(disbursement.amount || 0);
        if (amount <= 0) {
            return NextResponse.json({ error: 'Nominal tambahan bon tidak valid' }, { status: 409 });
        }

        let bank: BankAccountSummary | null = null;
        if (disbursement.bankAccountRef) {
            bank = await sanityGetById<BankAccountSummary>(disbursement.bankAccountRef);
            if (!bank) {
                return NextResponse.json({ error: 'Rekening historis tambahan bon tidak ditemukan' }, { status: 404 });
            }
            if (!bank._rev) {
                return NextResponse.json({ error: 'Revisi rekening historis tambahan bon tidak tersedia' }, { status: 409 });
            }
        }

        const nextIssuedAmount = Math.max(getDriverVoucherIssuedAmount(state.voucher) - amount, getDriverVoucherInitialCash(state.voucher));
        const nextTopUpCount = Math.max((state.voucher.topUpCount || 0) - 1, 0);
        const totals = computeDriverVoucherTotals(
            nextIssuedAmount,
            state.items.reduce((sum, item) => sum + item.amount, 0),
            normalizeNumber(state.voucher.driverFeeAmount || 0)
        );

        const transaction = getSanityClient().transaction().delete(disbursementId);
        if (disbursement.bankTransactionRef) {
            transaction.delete(disbursement.bankTransactionRef);
        }
        if (bank && disbursement.bankAccountRef) {
            transaction.patch(disbursement.bankAccountRef, {
                ifRevisionID: bank._rev,
                set: { currentBalance: (bank.currentBalance || 0) + amount },
            });
        }
        transaction.patch(disbursement.voucherRef, {
            ifRevisionID: state.voucher._rev,
            set: {
                totalIssuedAmount: nextIssuedAmount,
                topUpCount: nextTopUpCount,
                totalSpent: totals.totalSpent,
                totalClaimAmount: totals.totalClaimAmount,
                balance: totals.balance,
            },
        });

        try {
            await transaction.commit();

            const updatedVoucher = {
                ...state.voucher,
                totalIssuedAmount: nextIssuedAmount,
                topUpCount: nextTopUpCount,
                totalSpent: totals.totalSpent,
                totalClaimAmount: totals.totalClaimAmount,
                balance: totals.balance,
            };

            await addAuditLog(
                session,
                'DELETE',
                'driver-voucher-disbursements',
                disbursementId,
                `Menghapus tambahan bon ${state.voucher.bonNumber}${disbursement.note ? ` - ${disbursement.note}` : ''}`
            );

            return NextResponse.json({
                success: true,
                voucher: updatedVoucher,
            });
        } catch (err) {
            if (!isMutationConflictError(err)) {
                throw err;
            }

            if (attempt === 2) {
                return NextResponse.json(
                    { error: 'Tambahan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Tambahan bon berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
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
        const driverFeeAmount = normalizeNumber(state.voucher.driverFeeAmount || 0);
        if (state.items.length === 0 && driverFeeAmount <= 0) {
            return NextResponse.json({ error: 'Isi biaya perjalanan atau upah supir sebelum penyelesaian trip' }, { status: 400 });
        }

        const existingExpense = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "expense" && voucherRef == $ref][0]{ _id }`,
            { ref: voucherId }
        );
        if (existingExpense) {
            return NextResponse.json({ error: 'Bon supir ini sudah pernah diposting ke pengeluaran' }, { status: 409 });
        }

        if (state.voucher.deliveryOrderRef) {
            const existingBoronganItem = await getSanityClient().fetch<{ doNumber?: string } | null>(
                `*[_type == "driverBoronganItem" && doRef == $ref][0]{ doNumber }`,
                { ref: state.voucher.deliveryOrderRef }
            );
            if (existingBoronganItem) {
                return NextResponse.json(
                    { error: `DO ${existingBoronganItem.doNumber || state.voucher.deliveryOrderRef} sudah ada di slip borongan. Trip ini tidak boleh settle di dua workflow.` },
                    { status: 409 }
                );
            }
        }

        const totalSpent = state.items.reduce((sum, item) => sum + item.amount, 0);
        const totals = computeDriverVoucherTotals(
            getDriverVoucherIssuedAmount(state.voucher),
            totalSpent,
            driverFeeAmount
        );
        const balance = totals.balance;
        const requestedSettlementBankRef =
            typeof data.settlementBankRef === 'string' && data.settlementBankRef
                ? data.settlementBankRef
                : undefined;
        const settlementBankRef =
            balance !== 0
                ? requestedSettlementBankRef || state.voucher.issueBankRef || ''
                : undefined;
        let settlementBank: BankAccountSummary | null = null;

        if (balance !== 0) {
            if (!settlementBankRef) {
                return NextResponse.json({ error: 'Rekening settlement wajib dipilih untuk selisih bon' }, { status: 400 });
            }

            settlementBank = await getLedgerAccount(settlementBankRef);
            if (!settlementBank) {
                return NextResponse.json(
                    {
                        error: requestedSettlementBankRef
                            ? 'Rekening settlement tidak ditemukan'
                            : 'Pilih rekening settlement aktif untuk selisih bon',
                    },
                    { status: requestedSettlementBankRef ? 404 : 400 }
                );
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
                date: item.expenseDate || settledDate,
                amount: item.amount,
                description: item.description || `Pengeluaran uang jalan trip ${state.voucher.bonNumber}`,
                note: `Uang jalan trip ${state.voucher.bonNumber}`,
                privacyLevel: 'internal',
                relatedVehicleRef: state.voucher.vehicleRef,
                relatedVehiclePlate: state.voucher.vehiclePlate,
                voucherRef: voucherId,
            });
        }

        if (driverFeeAmount > 0) {
            transaction.create({
                _id: crypto.randomUUID(),
                _type: 'expense',
                categoryRef: 'driver-borongan',
                categoryName: 'Borongan Supir',
                date: settledDate,
                amount: driverFeeAmount,
                description: `Upah supir ${state.voucher.driverName || '-'} - ${state.voucher.bonNumber}`,
                note: `Settlement uang jalan trip ${state.voucher.bonNumber}`,
                privacyLevel: 'internal',
                relatedVehicleRef: state.voucher.vehicleRef,
                relatedVehiclePlate: state.voucher.vehiclePlate,
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
                totalSpent: totals.totalSpent,
                driverFeeAmount: totals.driverFeeAmount,
                totalClaimAmount: totals.totalClaimAmount,
                balance: totals.balance,
                settlementBankRef,
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
                totalSpent: totals.totalSpent,
                driverFeeAmount: totals.driverFeeAmount,
                totalClaimAmount: totals.totalClaimAmount,
                balance: totals.balance,
                settlementBankRef,
                settlementBankName: settlementBank?.bankName,
            };

            await addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Bon supir settle: ${state.voucher.bonNumber}`);
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
            initialCashGiven?: number;
            totalIssuedAmount?: number;
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

        const existingInitialDisbursement = await getSanityClient().fetch<{ _id: string } | null>(
            `*[_type == "driverVoucherDisbursement" && voucherRef == $ref && kind == "INITIAL"][0]{ _id }`,
            { ref: voucherId }
        );

        const bank = await getLedgerAccount(issueBankRef);
        if (!bank) {
            return NextResponse.json({ error: 'Rekening sumber tidak ditemukan' }, { status: 404 });
        }
        if (!bank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber tidak tersedia' }, { status: 409 });
        }

        const initialAmount = getDriverVoucherInitialCash(voucher);
        const newBalance = (bank.currentBalance || 0) - initialAmount;
        const repairTransactionId = crypto.randomUUID();
        try {
            const transaction = getSanityClient()
                .transaction()
                .create({
                    _id: repairTransactionId,
                    _type: 'bankTransaction',
                    bankAccountRef: issueBankRef,
                    bankAccountName: bank.bankName,
                    bankAccountNumber: bank.accountNumber,
                    type: 'DEBIT',
                    amount: initialAmount,
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
                        initialCashGiven: initialAmount,
                        totalIssuedAmount: getDriverVoucherIssuedAmount(voucher),
                    },
                });
            if (!existingInitialDisbursement) {
                transaction.create({
                    _id: crypto.randomUUID(),
                    _type: 'driverVoucherDisbursement',
                    voucherRef: voucherId,
                    date: voucher.issuedDate,
                    amount: initialAmount,
                    kind: 'INITIAL',
                    bankAccountRef: issueBankRef,
                    bankAccountName: bank.bankName,
                    bankAccountNumber: bank.accountNumber,
                    bankTransactionRef: repairTransactionId,
                    createdBy: session._id,
                    createdByName: session.name,
                });
            }
            await transaction.commit();

            const updatedVoucher = {
                ...voucher,
                issueBankRef,
                issueBankName: bank.bankName,
                initialCashGiven: initialAmount,
                totalIssuedAmount: getDriverVoucherIssuedAmount(voucher),
            };

            await addAuditLog(session, 'UPDATE', 'driver-vouchers', voucherId, `Rekonsiliasi pencairan bon: ${voucher.bonNumber}`);
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
