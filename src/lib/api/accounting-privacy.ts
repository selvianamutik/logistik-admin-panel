import { listDocumentsByFilter } from '@/lib/repositories/document-store';
import { normalizeUserRole } from '@/lib/rbac';
import type { Expense, JournalEntry, JournalLine, UserRole } from '@/lib/types';

const OWNER_ONLY_JOURNAL_MEMO = 'Pengeluaran internal owner';
const OWNER_ONLY_SOURCE_LABEL = 'Internal Owner';

function isOwner(role: UserRole) {
    return normalizeUserRole(role) === 'OWNER';
}

async function getOwnerOnlyExpenseIds(sourceRefs?: string[]) {
    const filter = sourceRefs && sourceRefs.length > 0
        ? { _id: [...new Set(sourceRefs)] }
        : { privacyLevel: 'ownerOnly' };
    const expenses = await listDocumentsByFilter<Pick<Expense, '_id' | 'privacyLevel'>>('expense', filter);
    return new Set(
        expenses
            .filter(expense => expense.privacyLevel === 'ownerOnly')
            .map(expense => expense._id)
            .filter(Boolean)
    );
}

function isOwnerOnlyExpenseEntry(entry: Pick<JournalEntry, 'sourceType' | 'sourceRef'>, ownerOnlyExpenseIds: Set<string>) {
    return entry.sourceType === 'EXPENSE' && Boolean(entry.sourceRef && ownerOnlyExpenseIds.has(entry.sourceRef));
}

function sanitizeOwnerOnlyJournalEntry<T extends JournalEntry>(entry: T): T {
    return {
        ...entry,
        memo: OWNER_ONLY_JOURNAL_MEMO,
        sourceRef: undefined,
        sourceNumber: undefined,
        sourceLabel: OWNER_ONLY_SOURCE_LABEL,
        postedBy: undefined,
        postedByName: undefined,
    };
}

function sanitizeOwnerOnlyJournalLine<T extends JournalLine>(line: T): T {
    return {
        ...line,
        memo: line.memo ? OWNER_ONLY_JOURNAL_MEMO : undefined,
        entityRef: undefined,
        entityType: 'ownerOnlyExpense',
    };
}

export async function sanitizeJournalEntriesForRole<T extends JournalEntry>(entries: T[], role: UserRole) {
    if (isOwner(role) || entries.length === 0) return entries;

    const expenseRefs = entries
        .filter(entry => entry.sourceType === 'EXPENSE' && typeof entry.sourceRef === 'string')
        .map(entry => entry.sourceRef as string);
    if (expenseRefs.length === 0) return entries;

    const ownerOnlyExpenseIds = await getOwnerOnlyExpenseIds(expenseRefs);
    if (ownerOnlyExpenseIds.size === 0) return entries;

    return entries.map(entry =>
        isOwnerOnlyExpenseEntry(entry, ownerOnlyExpenseIds)
            ? sanitizeOwnerOnlyJournalEntry(entry)
            : entry
    );
}

export async function sanitizeJournalLinesForRole<T extends JournalLine>(lines: T[], role: UserRole) {
    if (isOwner(role) || lines.length === 0) return lines;

    const entryRefs = [...new Set(lines.map(line => line.journalEntryRef).filter(Boolean))];
    if (entryRefs.length === 0) return lines;

    const entries = await listDocumentsByFilter<JournalEntry>('journalEntry', { _id: entryRefs });
    const expenseRefs = entries
        .filter(entry => entry.sourceType === 'EXPENSE' && typeof entry.sourceRef === 'string')
        .map(entry => entry.sourceRef as string);
    if (expenseRefs.length === 0) return lines;

    const ownerOnlyExpenseIds = await getOwnerOnlyExpenseIds(expenseRefs);
    if (ownerOnlyExpenseIds.size === 0) return lines;

    const ownerOnlyEntryIds = new Set(
        entries
            .filter(entry => isOwnerOnlyExpenseEntry(entry, ownerOnlyExpenseIds))
            .map(entry => entry._id)
    );

    return lines.map(line =>
        ownerOnlyEntryIds.has(line.journalEntryRef)
            ? sanitizeOwnerOnlyJournalLine(line)
            : line
    );
}
