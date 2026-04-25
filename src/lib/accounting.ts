import type { AccountingAccountType, AccountingNormalBalance, ChartOfAccount } from './types';

export type AccountingSystemKey =
  | 'cash_on_hand'
  | 'bank'
  | 'accounts_receivable'
  | 'inventory'
  | 'driver_advance'
  | 'prepaid_pph23'
  | 'fixed_assets'
  | 'accumulated_depreciation'
  | 'accounts_payable'
  | 'accrued_expense'
  | 'customer_deposit'
  | 'tax_payable'
  | 'equity_capital'
  | 'retained_earnings'
  | 'freight_revenue'
  | 'sales_deduction'
  | 'operational_expense'
  | 'trip_misc_expense'
  | 'driver_fee_expense'
  | 'maintenance_expense'
  | 'incident_expense'
  | 'inventory_usage_expense';

export type AccountingAccountDefinition = {
  systemKey: AccountingSystemKey;
  code: string;
  name: string;
  accountType: AccountingAccountType;
  normalBalance: AccountingNormalBalance;
  description?: string;
};

export const DEFAULT_CHART_OF_ACCOUNTS: AccountingAccountDefinition[] = [
  { systemKey: 'cash_on_hand', code: '1100', name: 'Kas Tunai', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'bank', code: '1110', name: 'Bank', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'accounts_receivable', code: '1200', name: 'Piutang Usaha', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'inventory', code: '1300', name: 'Persediaan Barang Gudang', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'driver_advance', code: '1400', name: 'Uang Muka Supir / Bon', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'prepaid_pph23', code: '1500', name: 'PPh 23 Dipotong di Muka', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'fixed_assets', code: '1700', name: 'Aktiva Tetap', accountType: 'ASSET', normalBalance: 'DEBIT' },
  { systemKey: 'accumulated_depreciation', code: '1790', name: 'Akumulasi Penyusutan', accountType: 'ASSET', normalBalance: 'CREDIT' },
  { systemKey: 'accounts_payable', code: '2100', name: 'Hutang Dagang', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { systemKey: 'accrued_expense', code: '2200', name: 'Hutang Biaya', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { systemKey: 'customer_deposit', code: '2300', name: 'Titipan / Kelebihan Bayar Customer', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { systemKey: 'tax_payable', code: '2400', name: 'Hutang Pajak', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { systemKey: 'equity_capital', code: '3100', name: 'Modal', accountType: 'EQUITY', normalBalance: 'CREDIT' },
  { systemKey: 'retained_earnings', code: '3200', name: 'Laba Ditahan', accountType: 'EQUITY', normalBalance: 'CREDIT' },
  { systemKey: 'freight_revenue', code: '4100', name: 'Pendapatan Ongkos', accountType: 'REVENUE', normalBalance: 'CREDIT' },
  { systemKey: 'sales_deduction', code: '4200', name: 'Klaim / Potongan Penjualan', accountType: 'CONTRA_REVENUE', normalBalance: 'DEBIT' },
  { systemKey: 'operational_expense', code: '5100', name: 'Biaya Operasional', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { systemKey: 'trip_misc_expense', code: '5200', name: 'Biaya Lain-lain Trip', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { systemKey: 'driver_fee_expense', code: '5300', name: 'Upah Borongan Supir', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { systemKey: 'maintenance_expense', code: '5400', name: 'Biaya Maintenance Armada', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { systemKey: 'incident_expense', code: '5500', name: 'Biaya Insiden', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { systemKey: 'inventory_usage_expense', code: '5600', name: 'Pemakaian Barang Gudang', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
];

export function buildChartOfAccountId(systemKey: AccountingSystemKey) {
  return `coa-${systemKey}`;
}

export function getAccountingAccountDefinition(systemKey: AccountingSystemKey) {
  const definition = DEFAULT_CHART_OF_ACCOUNTS.find(account => account.systemKey === systemKey);
  if (!definition) {
    throw new Error(`Akun sistem ${systemKey} belum didefinisikan`);
  }
  return definition;
}

export function buildDefaultChartOfAccountDocument(definition: AccountingAccountDefinition): ChartOfAccount {
  return {
    _id: buildChartOfAccountId(definition.systemKey),
    _type: 'chartOfAccount',
    code: definition.code,
    name: definition.name,
    accountType: definition.accountType,
    normalBalance: definition.normalBalance,
    systemKey: definition.systemKey,
    active: true,
    description: definition.description,
  };
}

export function formatJournalNumber(dateValue: string, sequence: number) {
  const period = dateValue.replace(/-/g, '').slice(0, 6) || '000000';
  return `JRN-${period}-${String(sequence).padStart(5, '0')}`;
}

export function normalizeLedgerAmount(value: unknown) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value.replace(/\./g, '').replace(',', '.'))
      : 0;
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}
