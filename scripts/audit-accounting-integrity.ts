import { loadScriptEnv } from './_env';

loadScriptEnv();

import { getAllDocuments } from '../src/lib/repositories/document-store';
import type { ChartOfAccount, JournalEntry, JournalLine } from '../src/lib/types';

function normalizeAmount(value: unknown) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function journalSourceKey(entry: JournalEntry) {
    return [
        entry.sourceType || '',
        entry.sourceRef || '',
        entry.sourceEvent || '',
    ].join('::');
}

async function main() {
    const [accounts, entries, lines] = await Promise.all([
        getAllDocuments<ChartOfAccount>('chartOfAccount'),
        getAllDocuments<JournalEntry>('journalEntry'),
        getAllDocuments<JournalLine>('journalLine'),
    ]);

    const accountById = new Map(accounts.map(account => [account._id, account]));
    const entryById = new Map(entries.map(entry => [entry._id, entry]));
    const linesByEntry = new Map<string, JournalLine[]>();

    for (const line of lines) {
        assert(entryById.has(line.journalEntryRef), `Journal line ${line._id} orphan: entry ${line.journalEntryRef} tidak ditemukan.`);
        assert(accountById.has(line.accountRef), `Journal line ${line._id} memakai akun ${line.accountRef} yang tidak ditemukan.`);
        assert(normalizeAmount(line.debit) >= 0 && normalizeAmount(line.credit) >= 0, `Journal line ${line._id} punya nilai negatif.`);
        assert(
            normalizeAmount(line.debit) === 0 || normalizeAmount(line.credit) === 0,
            `Journal line ${line._id} tidak boleh punya debit dan kredit sekaligus.`
        );

        const next = linesByEntry.get(line.journalEntryRef) || [];
        next.push(line);
        linesByEntry.set(line.journalEntryRef, next);
    }

    const postedSourceKeys = new Map<string, string>();
    let postedCount = 0;
    let voidCount = 0;
    let postedDebit = 0;
    let postedCredit = 0;

    for (const entry of entries) {
        const entryLines = linesByEntry.get(entry._id) || [];
        assert(entry.status === 'VOID' || entryLines.length > 0, `Journal entry ${entry.entryNumber || entry._id} tidak punya line.`);

        const lineDebit = entryLines.reduce((sum, line) => sum + normalizeAmount(line.debit), 0);
        const lineCredit = entryLines.reduce((sum, line) => sum + normalizeAmount(line.credit), 0);
        assert(lineDebit === normalizeAmount(entry.totalDebit), `Journal entry ${entry.entryNumber || entry._id} total debit header tidak sama dengan line.`);
        assert(lineCredit === normalizeAmount(entry.totalCredit), `Journal entry ${entry.entryNumber || entry._id} total kredit header tidak sama dengan line.`);
        assert(lineDebit === lineCredit, `Journal entry ${entry.entryNumber || entry._id} tidak balance: debit ${lineDebit}, kredit ${lineCredit}.`);

        if (entry.status === 'VOID') {
            voidCount += 1;
            continue;
        }

        postedCount += 1;
        postedDebit += lineDebit;
        postedCredit += lineCredit;

        const sourceKey = journalSourceKey(entry);
        if (sourceKey !== '::::') {
            const existingEntryId = postedSourceKeys.get(sourceKey);
            assert(
                !existingEntryId,
                `Duplicate posted journal source ${sourceKey}: ${existingEntryId} dan ${entry._id}.`
            );
            postedSourceKeys.set(sourceKey, entry._id);
        }
    }

    assert(postedDebit === postedCredit, `Total jurnal POSTED tidak balance: debit ${postedDebit}, kredit ${postedCredit}.`);

    console.log(JSON.stringify({
        ok: true,
        summary: {
            accounts: accounts.length,
            entries: entries.length,
            postedEntries: postedCount,
            voidEntries: voidCount,
            lines: lines.length,
            postedDebit,
            postedCredit,
        },
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
