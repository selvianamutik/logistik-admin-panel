import { DEFAULT_CHART_OF_ACCOUNTS, type AccountingSystemKey } from './accounting';
import type { ExpenseCategory } from './types';

export type ExpenseCategoryScope = 'GENERAL' | 'TRIP' | 'MAINTENANCE' | 'INCIDENT' | 'DRIVER_FEE';

export const EXPENSE_CATEGORY_SCOPE_OPTIONS: Array<{ value: ExpenseCategoryScope; label: string }> = [
  { value: 'GENERAL', label: 'Pengeluaran Umum' },
  { value: 'TRIP', label: 'Uang Jalan Trip' },
  { value: 'MAINTENANCE', label: 'Maintenance Armada' },
  { value: 'INCIDENT', label: 'Insiden' },
  { value: 'DRIVER_FEE', label: 'Upah Driver' },
];

const VALID_SCOPES = new Set<ExpenseCategoryScope>(EXPENSE_CATEGORY_SCOPE_OPTIONS.map(option => option.value));
const VALID_ACCOUNT_KEYS = new Set<AccountingSystemKey>(DEFAULT_CHART_OF_ACCOUNTS.map(account => account.systemKey));

export function isExpenseCategoryScope(value: unknown): value is ExpenseCategoryScope {
  return typeof value === 'string' && VALID_SCOPES.has(value as ExpenseCategoryScope);
}

export function inferExpenseCategoryScope(category: Pick<ExpenseCategory, 'name' | 'scope'>): ExpenseCategoryScope {
  if (isExpenseCategoryScope(category.scope)) return category.scope;
  const name = String(category.name || '').toLowerCase();
  if (/borongan|upah supir|upah driver/.test(name)) return 'DRIVER_FEE';
  if (/insiden|kecelakaan|santunan|towing|evakuasi/.test(name)) return 'INCIDENT';
  if (/maintenance|perawatan|servis|service|oli|ban|sparepart/.test(name)) return 'MAINTENANCE';
  if (/bbm|solar|tol|parkir|bongkar|makan driver|uang jalan|trip/.test(name)) return 'TRIP';
  return 'GENERAL';
}

export function getExpenseCategoryScopeLabel(scope: unknown) {
  const normalized = isExpenseCategoryScope(scope) ? scope : 'GENERAL';
  return EXPENSE_CATEGORY_SCOPE_OPTIONS.find(option => option.value === normalized)?.label || 'Pengeluaran Umum';
}

export function resolveExpenseCategoryAccountKey(
  category: Pick<ExpenseCategory, 'name' | 'scope' | 'accountSystemKey'>
): AccountingSystemKey {
  if (typeof category.accountSystemKey === 'string' && VALID_ACCOUNT_KEYS.has(category.accountSystemKey as AccountingSystemKey)) {
    return category.accountSystemKey as AccountingSystemKey;
  }

  switch (inferExpenseCategoryScope(category)) {
    case 'TRIP':
      return 'trip_misc_expense';
    case 'MAINTENANCE':
      return 'maintenance_expense';
    case 'INCIDENT':
      return 'incident_expense';
    case 'DRIVER_FEE':
      return 'driver_fee_expense';
    case 'GENERAL':
    default:
      return 'operational_expense';
  }
}

export function isManualExpenseCategory(category: Pick<ExpenseCategory, 'name' | 'scope' | 'allowManual' | 'active'>) {
  if (category.active === false) return false;
  const scope = inferExpenseCategoryScope(category);
  return scope === 'GENERAL' && category.allowManual !== false;
}
