import { loadScriptEnv } from './_env';

loadScriptEnv();

import { handleManualJournalCreate } from '../src/lib/api/accounting-workflows';
import { assertAccountingPeriodOpen } from '../src/lib/api/accounting-period-lock';
import {
    sanitizeJournalEntriesForRole,
    sanitizeJournalLinesForRole,
} from '../src/lib/api/accounting-privacy';
import {
    createDocument,
    deleteDocument,
    getAllDocuments,
    updateDocument,
} from '../src/lib/repositories/document-store';
import type { AccountingPeriod, ChartOfAccount, Expense, ExpenseCategory, JournalEntry, JournalLine } from '../src/lib/types';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function main() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expenseId = `audit-owner-expense-${suffix}`;
    const entryId = `audit-owner-journal-${suffix}`;
    const debitLineId = `audit-owner-line-debit-${suffix}`;
    const creditLineId = `audit-owner-line-credit-${suffix}`;
    const periodId = `audit-accounting-period-${suffix}`;
    const period = `AUDIT-${suffix}`;
    const auditDate = '2026-02-14';
    const cleanup: Array<() => Promise<unknown>> = [];

    try {
        const [accounts, categories] = await Promise.all([
            getAllDocuments<ChartOfAccount>('chartOfAccount'),
            getAllDocuments<ExpenseCategory>('expenseCategory'),
        ]);
        const expenseAccount = accounts.find(account => account.systemKey === 'operational_expense');
        const bankAccount = accounts.find(account => account.systemKey === 'bank');
        const category = categories[0];
        assert(expenseAccount, 'Akun biaya operasional tidak ditemukan');
        assert(bankAccount, 'Akun bank tidak ditemukan');
        assert(category, 'Kategori biaya tidak ditemukan');

        const expenseDoc: Expense = {
            _id: expenseId,
            _type: 'expense',
            categoryRef: category._id,
            categoryName: category.name || 'Biaya Rahasia Owner',
            date: auditDate,
            amount: 123456,
            note: 'catatan owner-only audit',
            description: 'detail sensitif owner-only audit',
            privacyLevel: 'ownerOnly',
        };
        await createDocument(expenseDoc as unknown as { _type: string; [key: string]: unknown });
        cleanup.push(() => deleteDocument(expenseId, 'expense'));

        const entryDoc: JournalEntry = {
            _id: entryId,
            _type: 'journalEntry',
            entryNumber: `AUDIT-${suffix}`,
            entryDate: auditDate,
            memo: 'detail sensitif owner-only audit',
            sourceType: 'EXPENSE',
            sourceRef: expenseId,
            sourceEvent: 'CREATE',
            sourceLabel: 'Biaya Rahasia Owner',
            status: 'POSTED',
            totalDebit: 123456,
            totalCredit: 123456,
        };
        await createDocument(entryDoc as unknown as { _type: string; [key: string]: unknown });
        cleanup.push(() => deleteDocument(entryId, 'journalEntry'));

        const debitLine: JournalLine = {
            _id: debitLineId,
            _type: 'journalLine',
            journalEntryRef: entryId,
            lineNumber: 1,
            accountRef: expenseAccount._id,
            accountCode: expenseAccount.code,
            accountName: expenseAccount.name,
            accountType: expenseAccount.accountType,
            debit: 123456,
            credit: 0,
            memo: 'line sensitif owner-only audit',
            entityRef: expenseId,
            entityType: 'expense',
        };
        const creditLine: JournalLine = {
            _id: creditLineId,
            _type: 'journalLine',
            journalEntryRef: entryId,
            lineNumber: 2,
            accountRef: bankAccount._id,
            accountCode: bankAccount.code,
            accountName: bankAccount.name,
            accountType: bankAccount.accountType,
            debit: 0,
            credit: 123456,
            entityRef: 'audit-bank',
            entityType: 'bankAccount',
        };
        await createDocument(debitLine as unknown as { _type: string; [key: string]: unknown });
        cleanup.push(() => deleteDocument(debitLineId, 'journalLine'));
        await createDocument(creditLine as unknown as { _type: string; [key: string]: unknown });
        cleanup.push(() => deleteDocument(creditLineId, 'journalLine'));

        const [financeEntry] = await sanitizeJournalEntriesForRole([entryDoc], 'FINANCE');
        const [ownerEntry] = await sanitizeJournalEntriesForRole([entryDoc], 'OWNER');
        assert(financeEntry.memo === 'Pengeluaran internal owner', 'FINANCE harus melihat memo owner-only tersamarkan');
        assert(financeEntry.sourceRef === undefined, 'FINANCE tidak boleh menerima sourceRef expense owner-only');
        assert(financeEntry.sourceLabel === 'Internal Owner', 'FINANCE harus melihat label owner-only umum');
        assert(ownerEntry.sourceRef === expenseId, 'OWNER harus tetap melihat sourceRef asli');
        assert(ownerEntry.memo === entryDoc.memo, 'OWNER harus tetap melihat memo asli');

        const financeLines = await sanitizeJournalLinesForRole([debitLine, creditLine], 'FINANCE');
        const ownerLines = await sanitizeJournalLinesForRole([debitLine, creditLine], 'OWNER');
        assert(financeLines.every(line => line.entityRef === undefined), 'FINANCE tidak boleh menerima entityRef line owner-only');
        assert(financeLines.every(line => line.entityType === 'ownerOnlyExpense'), 'FINANCE harus menerima entityType tersamarkan');
        assert(ownerLines[0].entityRef === expenseId, 'OWNER harus tetap melihat entityRef asli');

        const periodDoc: AccountingPeriod = {
            _id: periodId,
            _type: 'accountingPeriod',
            period,
            startDate: '2026-02-01',
            endDate: '2026-02-28',
            status: 'CLOSED',
            closedAt: new Date().toISOString(),
            closedBy: 'audit',
            closedByName: 'Audit',
        };
        await createDocument(periodDoc as unknown as { _type: string; [key: string]: unknown });
        cleanup.push(() => deleteDocument(periodId, 'accountingPeriod'));

        let lockedError = '';
        try {
            await assertAccountingPeriodOpen(auditDate, 'Audit transaksi');
        } catch (error) {
            lockedError = error instanceof Error ? error.message : String(error);
        }
        assert(/sudah dikunci/i.test(lockedError), 'Tanggal dalam periode CLOSED harus ditolak');

        const blockedResponse = await handleManualJournalCreate(
            { _id: 'audit-finance', name: 'Audit Finance', role: 'FINANCE' },
            {
                entryDate: auditDate,
                memo: 'Jurnal audit harus tertolak',
                lines: [
                    { accountRef: expenseAccount._id, debit: 1000 },
                    { accountRef: bankAccount._id, credit: 1000 },
                ],
            },
            async () => undefined,
        );
        assert(blockedResponse.status === 409, `Jurnal manual periode terkunci harus 409, got ${blockedResponse.status}`);

        await updateDocument(periodId, {
            status: 'OPEN',
            closedAt: null,
            closedBy: null,
            closedByName: null,
        }, 'accountingPeriod');
        await assertAccountingPeriodOpen(auditDate, 'Audit transaksi');

        console.log(JSON.stringify({
            ok: true,
            ownerOnlyJournalMaskedForFinance: true,
            ownerStillSeesOriginalJournal: true,
            closedPeriodBlocksManualJournal: true,
            reopenedPeriodAllowsDate: true,
        }, null, 2));
    } finally {
        for (const clean of cleanup.reverse()) {
            await clean().catch(() => undefined);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
