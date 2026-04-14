import { NextResponse } from 'next/server';

import { getBusinessDateValue } from '@/lib/business-date';
import { resolveCompanyLogoUrl } from '@/lib/branding';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import { getSanityClient, sanityGetById, sanityGetNextNumber } from '@/lib/sanity';
import type { CompanyProfile } from '@/lib/types';

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

type SanityMutations = Parameters<ReturnType<typeof getSanityClient>['mutate']>[0];

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
    _rev?: string;
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

function parseOptionalStrictBoronganRowNumber(
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

export async function handleDriverBoronganCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn
) {
    let resolvedDriverRef = normalizeOptionalText(data.driverRef);
    const driverName = normalizeText(data.driverName);

    const periodStart = normalizeText(data.periodStart) || getBusinessDateValue();
    const periodStartError = validateIsoDateOrResponse(
        periodStart,
        'Periode mulai borongan',
        'Periode mulai borongan tidak valid'
    );
    if (periodStartError) {
        return periodStartError;
    }
    const periodEnd = normalizeText(data.periodEnd) || periodStart;
    const periodEndError = validateIsoDateOrResponse(
        periodEnd,
        'Periode akhir borongan',
        'Periode akhir borongan tidak valid'
    );
    if (periodEndError) {
        return periodEndError;
    }
    if (periodEnd < periodStart) {
        return NextResponse.json({ error: 'Periode akhir borongan tidak boleh sebelum periode mulai' }, { status: 400 });
    }

    const rawRows = Array.isArray(data.items) ? data.items : Array.isArray(data.rows) ? data.rows : [];
    let rows: NormalizedDriverBoronganRow[];
    try {
        rows = rawRows
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
                const collie = parseOptionalStrictBoronganRowNumber(
                    row.collie,
                    'Collie pada baris borongan tidak valid',
                    { maxFractionDigits: 2 }
                );

                if (date) {
                    assertIsoDate(date, 'Tanggal pada baris borongan');
                }
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
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Baris borongan tidak valid' },
            { status: 400 }
        );
    }

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
                _rev,
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
    let selectedDriver: { _id: string; _rev?: string; name?: string; active?: boolean } | null = null;
    if (resolvedDriverRef) {
        const driverDoc = await getSanityClient().fetch<{ _id: string; _rev?: string; name?: string; active?: boolean } | null>(
            `*[_type == "driver" && _id == $id][0]{ _id, _rev, name, active }`,
            { id: resolvedDriverRef }
        );
        if (!driverDoc) {
            return NextResponse.json({ error: 'Supir borongan tidak ditemukan' }, { status: 404 });
        }
        selectedDriver = driverDoc;
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
    const boronganNumber = await sanityGetNextNumber('borong', periodEnd);
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
    const mutationTimestamp = new Date().toISOString();
    if (selectedDriver?._id) {
        if (!selectedDriver._rev) {
            return NextResponse.json({ error: 'Revisi supir borongan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        transaction.patch(selectedDriver._id, patch =>
            patch.ifRevisionId(selectedDriver._rev!).set({ updatedAt: mutationTimestamp })
        );
    }
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
    if (uniqueDoRefs.length > 0) {
        for (const deliveryOrder of deliveryOrders) {
            if (!deliveryOrder._rev) {
                return NextResponse.json(
                    { error: `Revisi DO ${deliveryOrder.doNumber || deliveryOrder._id} tidak tersedia. Refresh lalu coba lagi.` },
                    { status: 409 }
                );
            }
            transaction.patch(deliveryOrder._id, patch => patch.ifRevisionId(deliveryOrder._rev!).set({ updatedAt: mutationTimestamp }));
        }
    }

    try {
        await transaction.commit();
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Slip borongan, supir, atau DO terkait berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }
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

    const borongan = await sanityGetById<{ _id: string; _rev?: string; boronganNumber?: string; status?: string }>(id);
    if (!borongan) {
        return NextResponse.json({ error: 'Borongan tidak ditemukan' }, { status: 404 });
    }
    if (!borongan._rev) {
        return NextResponse.json({ error: 'Revisi slip borongan tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
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
    const mutations: Array<Record<string, unknown>> = [];
    for (const itemId of itemIds) {
        mutations.push({
            delete: {
                id: itemId,
            },
        });
    }
    mutations.push({
        delete: {
            id,
            ifRevisionID: borongan._rev,
        },
    });
    try {
        await getSanityClient().mutate(mutations as unknown as SanityMutations);
    } catch (error) {
        if (isMutationConflictError(error)) {
            return NextResponse.json(
                { error: 'Slip borongan berubah karena ada update lain. Refresh lalu coba lagi.' },
                { status: 409 }
            );
        }
        throw error;
    }

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

    const paymentMethod = normalizePaymentMethod(data.paymentMethod);
    if (!paymentMethod) {
        return NextResponse.json({ error: 'Metode pembayaran borongan tidak valid' }, { status: 400 });
    }
    const selectedAccountRef =
        typeof data.bankAccountRef === 'string' && data.bankAccountRef ? data.bankAccountRef : undefined;
    if (paymentMethod === 'TRANSFER' && !selectedAccountRef) {
        return NextResponse.json({ error: 'Rekening bank wajib dipilih untuk transfer' }, { status: 400 });
    }

    const paidDate =
        typeof data.date === 'string' && data.date
            ? data.date
            : getBusinessDateValue();
    const paidDateError = validateIsoDateOrResponse(paidDate, 'Tanggal pembayaran', 'Tanggal pembayaran tidak valid');
    if (paidDateError) {
        return paidDateError;
    }
    const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : undefined;
    const expenseId = crypto.randomUUID();
    const bankTransactionId = crypto.randomUUID();

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const borongan = await sanityGetById<{
            _id: string;
            _rev?: string;
            _type?: string;
            _createdAt?: string;
            _updatedAt?: string;
            boronganNumber: string;
            driverName: string;
            driverRef?: string;
            issuerCompanyAddress?: string;
            issuerCompanyEmail?: string;
            issuerCompanyLogoUrl?: string;
            issuerCompanyName?: string;
            issuerCompanyPhone?: string;
            notes?: string;
            periodEnd?: string;
            periodStart?: string;
            totalAmount: number;
            totalCollie?: number;
            totalWeightKg?: number;
            status: string;
            paidDate?: string;
            paidMethod?: string;
            paidBankRef?: string;
            paidBankName?: string;
            paidBankNumber?: string;
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
        const [boronganItems, existingExpense] = await Promise.all([
            getSanityClient().fetch<Array<{ collie?: unknown; beratKg?: unknown; uangRp?: unknown }>>(
                `*[_type == "driverBoronganItem" && boronganRef == $ref]{ collie, beratKg, uangRp }`,
                { ref: boronganId }
            ),
            getSanityClient().fetch<{ _id: string } | null>(
                `*[_type == "expense" && boronganRef == $ref][0]{ _id }`,
                { ref: boronganId }
            ),
        ]);
        const derivedTotalAmount = boronganItems.reduce(
            (sum, item) => sum + Math.max(parseFormattedNumberish(item.uangRp ?? 0, { maxFractionDigits: 0 }), 0),
            0
        );
        const derivedTotalCollie = boronganItems.reduce(
            (sum, item) => sum + Math.max(parseFormattedNumberish(item.collie ?? 0, { maxFractionDigits: 2 }), 0),
            0
        );
        const derivedTotalWeightKg = boronganItems.reduce(
            (sum, item) => sum + Math.max(parseFormattedNumberish(item.beratKg ?? 0, { maxFractionDigits: 3 }), 0),
            0
        );
        if (derivedTotalAmount <= 0) {
            return NextResponse.json({ error: 'Total borongan tidak valid' }, { status: 409 });
        }
        if (amount !== derivedTotalAmount) {
            return NextResponse.json({ error: 'Pembayaran borongan harus sama dengan total borongan' }, { status: 400 });
        }
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
        if (bankAccount) {
            const { startingBalance, nextBalance } = computeLedgerDebitBalance(bankAccount.currentBalance, derivedTotalAmount);
            if (nextBalance < 0) {
                return NextResponse.json(
                    { error: `Saldo ${bankAccount.bankName} tidak cukup untuk pembayaran borongan. Saldo tersedia ${startingBalance}` },
                    { status: 409 }
                );
            }
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
                amount: derivedTotalAmount,
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
                    totalAmount: derivedTotalAmount,
                    totalCollie: derivedTotalCollie,
                    totalWeightKg: derivedTotalWeightKg,
                    status: 'PAID',
                    paidDate,
                    paidMethod: paymentMethod,
                    paidBankRef: bankAccountRef,
                    paidBankName: bankAccount?.bankName,
                    paidBankNumber: bankAccount?.accountNumber,
                },
            });

        if (bankAccount && bankAccountRef) {
            const { nextBalance: newBalance } = computeLedgerDebitBalance(bankAccount.currentBalance, derivedTotalAmount);
            transaction
                .create({
                    _id: bankTransactionId,
                    _type: 'bankTransaction',
                    bankAccountRef,
                    bankAccountName: bankAccount.bankName,
                    bankAccountNumber: bankAccount.accountNumber,
                    type: 'DEBIT',
                    amount: derivedTotalAmount,
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
                success: true,
                id: boronganId,
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

    const items = await getSanityClient().fetch<Array<{ _id: string; _rev?: string; category: string; description?: string; amount: number; expenseDate?: string }>>(
        `*[_type == "driverVoucherItem" && voucherRef == $ref] | order(coalesce(expenseDate, _createdAt) asc){ _id, _rev, expenseDate, category, description, amount }`,
        { ref: voucherId }
    );

    const disbursements = await getSanityClient().fetch<Array<{
        _id: string;
        _rev?: string;
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
            _rev,
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
            : getBusinessDateValue();
    const issueDateError = validateIsoDateOrResponse(issueDate, 'Tanggal bon', 'Tanggal bon tidak valid');
    if (issueDateError) {
        return issueDateError;
    }

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
    if (!deliveryOrder._rev) {
        return NextResponse.json({ error: 'Revisi surat jalan bon tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
    }

    const driverRef = extractRefId(deliveryOrder.driverRef);
    if (!driverRef) {
        return NextResponse.json(
            { error: `Tetapkan supir pada DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    const driver = await sanityGetById<{ _id: string; _rev?: string; name?: string; active?: boolean }>(driverRef);
    if (!driver) {
        return NextResponse.json({ error: 'Supir trip tidak ditemukan' }, { status: 404 });
    }
    if (driver.active === false) {
        return NextResponse.json({ error: 'Supir trip tidak aktif' }, { status: 409 });
    }
    if (!driver._rev) {
        return NextResponse.json({ error: 'Revisi supir trip tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
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
    if (requestedDriverFeeAmount > 0 && Math.abs(requestedDriverFeeAmount - deliveryOrderTripFee) > 0.01) {
        return NextResponse.json(
            { error: 'Upah trip mengikuti snapshot DO. Ubah DO terlebih dahulu sebelum menerbitkan uang jalan trip.' },
            { status: 409 }
        );
    }
    const effectiveDriverFeeAmount = deliveryOrderTripFee;
    if (!Number.isFinite(effectiveDriverFeeAmount) || effectiveDriverFeeAmount <= 0) {
        return NextResponse.json(
            { error: `Isi upah trip di DO ${deliveryOrder.doNumber || deliveryOrderRef} dulu sebelum menerbitkan uang jalan trip.` },
            { status: 409 }
        );
    }

    let linkedVehicle: { _id: string; _rev?: string; plateNumber?: string } | null = null;
    if (canonicalVehicleRef) {
        const vehicle = await sanityGetById<{ _id: string; _rev?: string; plateNumber?: string }>(canonicalVehicleRef);
        if (!vehicle) {
            return NextResponse.json({ error: 'Kendaraan bon tidak ditemukan' }, { status: 404 });
        }
        if (!vehicle._rev) {
            return NextResponse.json({ error: 'Revisi kendaraan bon tidak tersedia. Refresh lalu coba lagi.' }, { status: 409 });
        }
        linkedVehicle = vehicle;
        if (!canonicalVehiclePlate) {
            canonicalVehiclePlate = vehicle.plateNumber;
        }
    }

    const bonNumber = await sanityGetNextNumber('bon', issueDate);
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
    const driverFeeAmount = normalizeCurrencyNumber(effectiveDriverFeeAmount);
    const voucherTotals = computeDriverVoucherTotals(cashGiven, 0, driverFeeAmount);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const issueBank = await getLedgerAccount(issueBankRef);
        if (!issueBank) {
            return NextResponse.json({ error: 'Rekening sumber bon tidak ditemukan' }, { status: 404 });
        }
        if (!issueBank._rev) {
            return NextResponse.json({ error: 'Revisi rekening sumber tidak tersedia' }, { status: 409 });
        }

        const { startingBalance: issueStartingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(issueBank.currentBalance, cashGiven);
        if (newBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${issueBank.bankName} tidak cukup untuk pencairan bon. Saldo tersedia ${issueStartingBalance}` },
                { status: 409 }
            );
        }
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
            .patch(deliveryOrderRef, {
                ifRevisionID: deliveryOrder._rev,
                set: { updatedAt: new Date().toISOString() },
            })
            .patch(driverRef, {
                ifRevisionID: driver._rev,
                set: { updatedAt: new Date().toISOString() },
            })
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
        if (linkedVehicle) {
            transaction.patch(linkedVehicle._id, {
                ifRevisionID: linkedVehicle._rev,
                set: { updatedAt: new Date().toISOString() },
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
                    { error: 'Pencairan bon, surat jalan, supir, kendaraan, atau rekening berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
                    { status: 409 }
                );
            }
        }
    }

    return NextResponse.json(
        { error: 'Pencairan bon, surat jalan, supir, kendaraan, atau rekening berubah karena ada transaksi lain. Muat ulang lalu coba lagi.' },
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
            : getBusinessDateValue();
    const topUpDateError = validateIsoDateOrResponse(topUpDate, 'Tanggal tambahan bon', 'Tanggal tambahan bon tidak valid');
    if (topUpDateError) {
        return topUpDateError;
    }

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
            state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
            normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
        );
        const transactionId = crypto.randomUUID();
        const disbursementId = crypto.randomUUID();
        const { startingBalance: bankStartingBalance, nextBalance: nextBankBalance } = computeLedgerDebitBalance(bank.currentBalance, amount);
        if (nextBankBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bank.bankName} tidak cukup untuk tambahan bon. Saldo tersedia ${bankStartingBalance}` },
                { status: 409 }
            );
        }

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
            : getBusinessDateValue();
    const expenseDateError = validateIsoDateOrResponse(
        expenseDate,
        'Tanggal biaya perjalanan',
        'Tanggal biaya perjalanan tidak valid'
    );
    if (expenseDateError) {
        return expenseDateError;
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
        const nextOperationalSpent = state.items.reduce(
            (sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }),
            0
        ) + amount;
        const nextTotals = computeDriverVoucherTotals(
            getDriverVoucherIssuedAmount(state.voucher),
            nextOperationalSpent,
            normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
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

    const initialItem = await sanityGetById<{ _id: string; voucherRef: string }>(itemId);
    if (!initialItem?.voucherRef) {
        return NextResponse.json({ error: 'Item bon tidak ditemukan' }, { status: 404 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(initialItem.voucherRef);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa diubah' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const deletedItem = state.items.find(existing => existing._id === itemId);
        if (!deletedItem) {
            return NextResponse.json({ error: 'Item bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
        }
        if (!deletedItem._rev) {
            return NextResponse.json({ error: 'Revisi item bon tidak tersedia. Muat ulang lalu coba lagi.' }, { status: 409 });
        }

        const nextOperationalSpent = state.items
            .filter(existing => existing._id !== itemId)
            .reduce((sum, existing) => sum + existing.amount, 0);
        const nextTotals = computeDriverVoucherTotals(
            getDriverVoucherIssuedAmount(state.voucher),
            nextOperationalSpent,
            normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
        );

        try {
            await getSanityClient().mutate([
                {
                    delete: {
                        id: itemId,
                        ifRevisionID: deletedItem._rev,
                    },
                },
                {
                    patch: {
                        id: initialItem.voucherRef,
                        ifRevisionID: state.voucher._rev,
                        set: {
                            totalSpent: nextTotals.totalSpent,
                            totalClaimAmount: nextTotals.totalClaimAmount,
                            balance: nextTotals.balance,
                        },
                    },
                },
            ] as unknown as SanityMutations);

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

    const initialDisbursement = await sanityGetById<{
        _id: string;
        _rev?: string;
        voucherRef?: string;
        amount?: number;
        kind?: 'INITIAL' | 'TOP_UP';
        bankAccountRef?: string;
        bankTransactionRef?: string;
        note?: string;
    }>(disbursementId);
    if (!initialDisbursement?.voucherRef) {
        return NextResponse.json({ error: 'Tambahan bon tidak ditemukan' }, { status: 404 });
    }
    if (initialDisbursement.kind !== 'TOP_UP') {
        return NextResponse.json({ error: 'Bon awal tidak bisa dihapus dari riwayat pencairan' }, { status: 409 });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(initialDisbursement.voucherRef);
        if ('error' in state) return state.error;
        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon yang sudah settle tidak bisa dikoreksi' }, { status: 409 });
        }
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        const disbursement = state.disbursements.find(existing => existing._id === disbursementId);
        if (!disbursement) {
            return NextResponse.json({ error: 'Tambahan bon tidak ditemukan atau sudah berubah. Muat ulang lalu coba lagi.' }, { status: 404 });
        }
        if (disbursement.kind !== 'TOP_UP') {
            return NextResponse.json({ error: 'Bon awal tidak bisa dihapus dari riwayat pencairan' }, { status: 409 });
        }
        if (!disbursement._rev) {
            return NextResponse.json({ error: 'Revisi tambahan bon tidak tersedia. Muat ulang lalu coba lagi.' }, { status: 409 });
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
            state.items.reduce((sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }), 0),
            normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 })
        );

        const mutations: Array<Record<string, unknown>> = [
            {
                delete: {
                    id: disbursementId,
                    ifRevisionID: disbursement._rev,
                },
            },
        ];
        if (disbursement.bankTransactionRef) {
            mutations.push({
                delete: {
                    id: disbursement.bankTransactionRef,
                },
            });
        }
        if (bank && disbursement.bankAccountRef) {
            mutations.push({
                patch: {
                    id: disbursement.bankAccountRef,
                    ifRevisionID: bank._rev,
                    set: { currentBalance: readLedgerBalance(bank.currentBalance) + amount },
                },
            });
        }
        mutations.push({
            patch: {
                id: initialDisbursement.voucherRef,
                ifRevisionID: state.voucher._rev,
                set: {
                    totalIssuedAmount: nextIssuedAmount,
                    topUpCount: nextTopUpCount,
                    totalSpent: totals.totalSpent,
                    totalClaimAmount: totals.totalClaimAmount,
                    balance: totals.balance,
                },
            },
        });

        try {
            await getSanityClient().mutate(mutations as unknown as SanityMutations);

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
            : getBusinessDateValue();
    const settledDateError = validateIsoDateOrResponse(settledDate, 'Tanggal settlement', 'Tanggal settlement tidak valid');
    if (settledDateError) {
        return settledDateError;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const state = await getDriverVoucherState(voucherId);
        if ('error' in state) return state.error;
        if (!state.voucher._rev) {
            return NextResponse.json({ error: 'Revisi bon tidak tersedia' }, { status: 409 });
        }

        if (state.voucher.status === 'SETTLED') {
            return NextResponse.json({ error: 'Bon supir ini sudah settle' }, { status: 409 });
        }
        const driverFeeAmount = normalizeNumber(state.voucher.driverFeeAmount || 0, { maxFractionDigits: 0 });
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

        const totalSpent = state.items.reduce(
            (sum, item) => sum + normalizeNumber(item.amount || 0, { maxFractionDigits: 0 }),
            0
        );
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
                return NextResponse.json({ error: 'Rekening settlement wajib dipilih untuk net settlement akhir' }, { status: 400 });
            }

            settlementBank = await getLedgerAccount(settlementBankRef);
            if (!settlementBank) {
                return NextResponse.json(
                    {
                        error: requestedSettlementBankRef
                            ? 'Rekening settlement tidak ditemukan'
                            : 'Pilih rekening settlement aktif untuk penyelesaian akhir',
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
                amount: normalizeCurrencyNumber(item.amount),
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
                    ? readLedgerBalance(settlementBank.currentBalance) + adjustmentAmount
                    : computeLedgerDebitBalance(settlementBank.currentBalance, adjustmentAmount).nextBalance;
            if (balance < 0 && nextBankBalance < 0) {
                const { startingBalance } = computeLedgerDebitBalance(settlementBank.currentBalance, adjustmentAmount);
                return NextResponse.json(
                    { error: `Saldo ${settlementBank.bankName} tidak cukup untuk settlement bon. Saldo tersedia ${startingBalance}` },
                    { status: 409 }
                );
            }
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
        const { startingBalance: repairStartingBalance, nextBalance: newBalance } = computeLedgerDebitBalance(bank.currentBalance, initialAmount);
        if (newBalance < 0) {
            return NextResponse.json(
                { error: `Saldo ${bank.bankName} tidak cukup untuk rekonsiliasi pencairan bon. Saldo tersedia ${repairStartingBalance}` },
                { status: 409 }
            );
        }
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
