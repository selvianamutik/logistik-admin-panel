import { getBusinessDateValue } from '@/lib/business-date';
import type { ExpenseCategory } from '@/lib/types';

export type CancelTripExpenseFormState = {
    expenseDate: string;
    categoryRef: string;
    bankAccountRef: string;
    description: string;
    amount: number;
};

export function createDefaultCancelTripExpenseForm(): CancelTripExpenseFormState {
    return {
        expenseDate: getBusinessDateValue(),
        categoryRef: '',
        bankAccountRef: '',
        description: '',
        amount: 0,
    };
}

export function isOperationalCancelExpenseCategory(category: ExpenseCategory) {
    return category.active !== false && category.scope === 'GENERAL' && category.allowManual !== false;
}

export function getDefaultCancelExpenseCategoryRef(categories: ExpenseCategory[]) {
    const operationalCategories = categories.filter(isOperationalCancelExpenseCategory);
    return (
        operationalCategories.find(category => /batal|pembatalan/i.test(category.name))?._id ||
        operationalCategories.find(category => /lain-lain umum/i.test(category.name))?._id ||
        operationalCategories.find(category => /operasional/i.test(category.name))?._id ||
        operationalCategories[0]?._id ||
        ''
    );
}
