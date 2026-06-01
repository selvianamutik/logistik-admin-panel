import { inferExpenseCategoryScope } from '@/lib/expense-category-scope';
import type { ExpenseCategory } from '@/lib/types';

import {
    getDocumentById,
    listDocumentsByFilter,
} from '@/lib/repositories/document-store';
import { normalizeNumber } from './data-helpers';

export async function resolveCancelTripExpenseCategory(params: {
    categoryRef?: string;
    categoryName?: string;
}) {
    const categoryRows = await listDocumentsByFilter<ExpenseCategory>('expenseCategory', {});
    const activeOperationalCategories = categoryRows
        .filter(category =>
            category.active !== false &&
            inferExpenseCategoryScope(category) === 'GENERAL' &&
            category.allowManual !== false
        )
        .sort((left, right) => normalizeNumber(left.sortOrder ?? 0) - normalizeNumber(right.sortOrder ?? 0));
    let category = params.categoryRef
        ? await getDocumentById<ExpenseCategory>(params.categoryRef, 'expenseCategory')
        : null;
    if (!category && params.categoryName) {
        const categoryNameLower = params.categoryName.toLowerCase();
        category = activeOperationalCategories.find(item => item.name.toLowerCase() === categoryNameLower) || null;
    }
    category =
        category ||
        activeOperationalCategories.find(item => /batal|pembatalan/i.test(item.name)) ||
        activeOperationalCategories.find(item => /lain-lain umum/i.test(item.name)) ||
        activeOperationalCategories.find(item => /operasional/i.test(item.name)) ||
        activeOperationalCategories[0] ||
        null;
    if (!category) {
        return {
            category: null,
            error: 'Kategori pengeluaran umum untuk biaya batal trip belum tersedia.',
        };
    }
    if (
        category.active === false ||
        inferExpenseCategoryScope(category) !== 'GENERAL' ||
        category.allowManual === false
    ) {
        return {
            category: null,
            error: 'Kategori biaya batal trip harus berupa kategori pengeluaran umum aktif.',
        };
    }

    return {
        category,
        error: '',
    };
}
