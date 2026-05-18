import { NextResponse } from 'next/server';

import { formatJournalNumber, normalizeLedgerAmount } from '@/lib/accounting';
import {
    createDocument,
    getAllDocuments,
    getDocumentById,
    listDocumentsByFilter,
    updateDocument,
} from '@/lib/repositories/document-store';
import type { ChartOfAccount, JournalEntry, JournalLine } from '@/lib/types';

import {
    assertIsoDate,
    isPlainObject,
    normalizeOptionalText,
    normalizeText,
    type ApiSession,
} from './data-helpers';

type AuditLogFn = (
    session: Pick<ApiSession, '_id' | 'name'>,
    action: string,
    entityType: string,
    entityRef: string,
    summary: string
) => void | Promise<void>;

type NormalizedManualJournalLine = {
    accountRef: string;
    debit: number;
    credit: number;
    memo?: string;
};

const WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS = new Set([
    'cash_on_hand',
    'bank',
    'accounts_receivable',
    'accounts_payable',
    'inventory',
    'driver_advance',
    'customer_deposit',
]);

const WORKFLOW_CONTROL_ACCOUNT_LABELS: Record<string, string> = {
    cash_on_hand: 'Kas Tunai',
    bank: 'Bank',
    accounts_receivable: 'Piutang Usaha',
    accounts_payable: 'Hutang Dagang',
    inventory: 'Persediaan Barang Gudang',
    driver_advance: 'Uang Muka Supir / Bon',
    customer_deposit: 'Titipan / Kelebihan Bayar Customer',
};

function cleanAmount(value: unknown) {
    return Math.max(normalizeLedgerAmount(value), 0);
}

async function buildManualJournalNumber(entryDate: string) {
    const monthPrefix = entryDate.replace(/-/g, '').slice(0, 6);
    const existingEntries = await getAllDocuments<JournalEntry>('journalEntry');
    const maxSequence = existingEntries.reduce((max, entry) => {
        const entryNumber = typeof entry.entryNumber === 'string' ? entry.entryNumber : '';
        if (!entryNumber.startsWith(`JRN-${monthPrefix}-`)) return max;
        const sequence = Number.parseInt(entryNumber.slice(`JRN-${monthPrefix}-`.length), 10);
        return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 0);
    return formatJournalNumber(entryDate, maxSequence + 1);
}

function normalizeManualLines(value: unknown) {
    if (!Array.isArray(value)) {
        throw new Error('Detail jurnal wajib diisi');
    }

    return value
        .filter(isPlainObject)
        .map((line): NormalizedManualJournalLine => ({
            accountRef: typeof line.accountRef === 'string' ? line.accountRef.trim() : '',
            debit: cleanAmount(line.debit),
            credit: cleanAmount(line.credit),
            memo: normalizeOptionalText(line.memo),
        }))
        .filter(line => line.accountRef || line.debit > 0 || line.credit > 0);
}

export async function handleManualJournalCreate(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const entryDate = normalizeText(data.entryDate);
    try {
        assertIsoDate(entryDate, 'Tanggal jurnal');
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Tanggal jurnal tidak valid' },
            { status: 400 },
        );
    }

    const memo = normalizeText(data.memo);
    if (!memo) {
        return NextResponse.json({ error: 'Memo jurnal wajib diisi' }, { status: 400 });
    }

    let normalizedLines: ReturnType<typeof normalizeManualLines>;
    try {
        normalizedLines = normalizeManualLines(data.lines);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Detail jurnal tidak valid' },
            { status: 400 },
        );
    }

    if (normalizedLines.length < 2) {
        return NextResponse.json({ error: 'Jurnal minimal memiliki 2 baris akun' }, { status: 400 });
    }

    const totalDebit = normalizedLines.reduce((sum, line) => sum + line.debit, 0);
    const totalCredit = normalizedLines.reduce((sum, line) => sum + line.credit, 0);
    if (totalDebit <= 0 || totalCredit <= 0) {
        return NextResponse.json({ error: 'Jurnal harus memiliki debit dan kredit' }, { status: 400 });
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return NextResponse.json(
            { error: `Jurnal belum balance. Debit ${totalDebit}, kredit ${totalCredit}` },
            { status: 400 },
        );
    }

    const accountCache = new Map<string, ChartOfAccount>();
    const resolvedLines: Array<typeof normalizedLines[number] & { account: ChartOfAccount }> = [];
    for (const line of normalizedLines) {
        if (!line.accountRef) {
            return NextResponse.json({ error: 'Semua baris jurnal wajib memilih akun' }, { status: 400 });
        }
        if (line.debit > 0 && line.credit > 0) {
            return NextResponse.json({ error: 'Satu baris jurnal hanya boleh berisi debit atau kredit' }, { status: 400 });
        }
        if (line.debit === 0 && line.credit === 0) {
            return NextResponse.json({ error: 'Nominal debit/kredit wajib diisi' }, { status: 400 });
        }

        let account = accountCache.get(line.accountRef);
        if (!account) {
            const loadedAccount = await getDocumentById<ChartOfAccount>(line.accountRef, 'chartOfAccount');
            if (!loadedAccount) {
                return NextResponse.json({ error: 'Akun jurnal tidak ditemukan' }, { status: 404 });
            }
            account = loadedAccount;
            if (account.active === false) {
                return NextResponse.json({ error: `Akun ${account.code} - ${account.name} tidak aktif` }, { status: 409 });
            }
            if (account.systemKey && WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS.has(account.systemKey)) {
                const accountLabel = WORKFLOW_CONTROL_ACCOUNT_LABELS[account.systemKey] || `${account.code} - ${account.name}`;
                return NextResponse.json(
                    { error: `Akun kontrol ${accountLabel} harus lewat workflow operasional terkait agar saldo rincian dan buku besar tetap sinkron.` },
                    { status: 409 },
                );
            }
            accountCache.set(line.accountRef, account);
        }
        resolvedLines.push({ ...line, account });
    }

    const entryId = `manual-journal-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const sourceNumber = normalizeOptionalText(data.sourceNumber);
    const entryNumber = await buildManualJournalNumber(entryDate);
    const entryDoc: JournalEntry = {
        _id: entryId,
        _type: 'journalEntry',
        entryNumber,
        entryDate,
        memo,
        sourceType: 'MANUAL_JOURNAL',
        sourceRef: entryId,
        sourceEvent: 'POST',
        sourceNumber,
        sourceLabel: 'Jurnal Manual',
        status: 'POSTED',
        totalDebit,
        totalCredit,
        postedAt: now,
        postedBy: session._id,
        postedByName: session.name,
    };

    await createDocument(entryDoc as unknown as { _type: string; [key: string]: unknown });
    for (const [index, line] of resolvedLines.entries()) {
        const lineDoc: JournalLine = {
            _id: `manual-journal-line-${crypto.randomUUID()}`,
            _type: 'journalLine',
            journalEntryRef: entryId,
            lineNumber: index + 1,
            accountRef: line.account._id,
            accountCode: line.account.code,
            accountName: line.account.name,
            accountType: line.account.accountType,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo,
        };
        await createDocument(lineDoc as unknown as { _type: string; [key: string]: unknown });
    }

    await addAuditLog(session, 'CREATE', 'journal-entries', entryId, `Jurnal manual ${entryNumber} dibuat`);
    return NextResponse.json({ data: entryDoc });
}

export async function handleManualJournalVoid(
    session: ApiSession,
    data: Record<string, unknown>,
    addAuditLog: AuditLogFn,
) {
    const id = normalizeText(data.id);
    if (!id) {
        return NextResponse.json({ error: 'Jurnal tidak valid' }, { status: 400 });
    }

    const entry = await getDocumentById<JournalEntry>(id, 'journalEntry');
    if (!entry) {
        return NextResponse.json({ error: 'Jurnal tidak ditemukan' }, { status: 404 });
    }
    if (entry.sourceType !== 'MANUAL_JOURNAL') {
        return NextResponse.json({ error: 'Hanya jurnal manual yang boleh dibatalkan dari halaman ini' }, { status: 409 });
    }
    if (entry.status === 'VOID') {
        return NextResponse.json({ error: 'Jurnal sudah dibatalkan' }, { status: 409 });
    }

    const activeDuplicates = await listDocumentsByFilter<JournalEntry>('journalEntry', {
        sourceType: 'MANUAL_JOURNAL',
        sourceRef: entry.sourceRef || id,
        sourceEvent: entry.sourceEvent || 'POST',
    });
    if (activeDuplicates.filter(item => item.status !== 'VOID').length > 1) {
        return NextResponse.json({ error: 'Ada lebih dari satu jurnal manual aktif untuk referensi ini. Audit dulu sebelum dibatalkan.' }, { status: 409 });
    }

    const updated = await updateDocument(id, {
        status: 'VOID',
        voidedAt: new Date().toISOString(),
        voidedBy: session._id,
        voidedByName: session.name,
    }, 'journalEntry');

    await addAuditLog(session, 'VOID', 'journal-entries', id, `Jurnal manual ${entry.entryNumber} dibatalkan`);
    return NextResponse.json({ data: updated });
}
