import { DEFAULT_PAGE_SIZE } from './pagination';
import type { BankAccount } from './types';

export type BankAccountFormState = {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  initialBalance: number;
  notes: string;
};

export type BankTransferFormState = {
  fromAccountRef: string;
  toAccountRef: string;
  amount: number;
  date: string;
};

export const BANK_PRESETS: Record<
  string,
  { label: string; color: string; gradient: string; logo: string }
> = {
  CASH: {
    label: "Kas Tunai",
    color: "#14532d",
    gradient: "linear-gradient(135deg, #14532d 0%, #16a34a 100%)",
    logo: "",
  },
  BCA: {
    label: "BCA",
    color: "#003b7b",
    gradient: "linear-gradient(135deg, #003b7b 0%, #0060c7 100%)",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Bank_Central_Asia.svg/200px-Bank_Central_Asia.svg.png",
  },
  Mandiri: {
    label: "Mandiri",
    color: "#003868",
    gradient: "linear-gradient(135deg, #003868 0%, #005ba5 100%)",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Bank_Mandiri_logo_2016.svg/200px-Bank_Mandiri_logo_2016.svg.png",
  },
  BRI: {
    label: "BRI",
    color: "#00529c",
    gradient: "linear-gradient(135deg, #00529c 0%, #0078d4 100%)",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/BANK_BRI_logo.svg/200px-BANK_BRI_logo.svg.png",
  },
  BNI: {
    label: "BNI",
    color: "#e35205",
    gradient: "linear-gradient(135deg, #e35205 0%, #f97316 100%)",
    logo: "https://upload.wikimedia.org/wikipedia/id/thumb/5/55/BNI_logo.svg/200px-BNI_logo.svg.png",
  },
  OTHER: {
    label: "Lainnya",
    color: "#6b7280",
    gradient: "linear-gradient(135deg, #374151 0%, #6b7280 100%)",
    logo: "",
  },
};

export function isCashAccount(account: Pick<BankAccount, "accountType" | "systemKey">) {
  return account.accountType === "CASH" || account.systemKey === "cash-on-hand";
}

export function getBankPreset(bankName: string) {
  const key = Object.keys(BANK_PRESETS).find(
    (candidate) =>
      candidate !== "OTHER" &&
      bankName.toUpperCase().includes(candidate.toUpperCase()),
  );
  return BANK_PRESETS[key || "OTHER"];
}

export function formatBankAccountCurrency(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

export function buildBankAccountsQuery(params: {
  page?: number;
  pageSize?: number;
}) {
  return new URLSearchParams({
    entity: "bank-accounts",
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? DEFAULT_PAGE_SIZE),
    sortField: "bankName",
    sortDir: "asc",
    filter: JSON.stringify({ active: true }),
  }).toString();
}

export function createDefaultBankAccountForm(): BankAccountFormState {
  return {
    bankName: "",
    accountNumber: "",
    accountHolder: "",
    initialBalance: 0,
    notes: "",
  };
}

export function createDefaultBankTransferForm(): BankTransferFormState {
  return {
    fromAccountRef: "",
    toAccountRef: "",
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
  };
}

export function getAccountNextAction(account: BankAccount) {
  if (isCashAccount(account)) {
    return account.currentBalance > 0
      ? "Siap dipakai untuk operasional harian"
      : "Cek perlu isi saldo kas";
  }

  if ((account.currentBalance || 0) <= 0) {
    return "Cek saldo / mutasi rekening";
  }

  return "Pantau mutasi atau transfer";
}

export function sortBankAccountsForDisplay(accounts: BankAccount[]) {
  return [...accounts].sort((a, b) => {
    const aCash = isCashAccount(a) ? 0 : 1;
    const bCash = isCashAccount(b) ? 0 : 1;
    if (aCash !== bCash) return aCash - bCash;
    return (a.bankName || "").localeCompare(b.bankName || "");
  });
}

export function buildBankAccountExportRows(accounts: BankAccount[]) {
  return accounts.map((account) => ({
    accountType: isCashAccount(account) ? "Kas Tunai" : "Bank",
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    accountHolder: account.accountHolder,
    initialBalance: account.initialBalance,
    currentBalance: account.currentBalance,
  }));
}

export function buildBankAccountPrintHtml(params: {
  accounts: BankAccount[];
  totalBalance: number;
  totalInitial: number;
}) {
  const { accounts, totalBalance, totalInitial } = params;
  const fmtN = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  const change = totalBalance - totalInitial;

  return `
    <div class="stats-row">
      <div class="stat-box"><div class="stat-label">Total Saldo</div><div class="stat-value">${fmtN(totalBalance)}</div></div>
      <div class="stat-box"><div class="stat-label">Saldo Awal</div><div class="stat-value">${fmtN(totalInitial)}</div></div>
      <div class="stat-box"><div class="stat-label">Perubahan</div><div class="stat-value ${change >= 0 ? "s" : "d"}">${change >= 0 ? "+" : ""}${fmtN(change)}</div></div>
    </div>
    <table>
      <thead><tr><th>Tipe</th><th>Nama</th><th>No. Referensi</th><th>Atas Nama</th><th class="r">Saldo Awal</th><th class="r">Saldo Saat Ini</th><th class="r">Perubahan</th></tr></thead>
      <tbody>
        ${accounts
          .map((account) => {
            const delta =
              (account.currentBalance || 0) -
              (account.initialBalance || 0);
            const accountType = isCashAccount(account) ? "Kas Tunai" : "Bank";
            return `<tr><td>${accountType}</td><td class="b">${account.bankName}</td><td>${account.accountNumber}</td><td>${account.accountHolder}</td><td class="r">${fmtN(account.initialBalance || 0)}</td><td class="r b">${fmtN(account.currentBalance || 0)}</td><td class="r ${delta >= 0 ? "s" : "d"}">${delta >= 0 ? "+" : ""}${fmtN(delta)}</td></tr>`;
          })
          .join("")}
        <tr style="background:#f8fafc;font-weight:700"><td colspan="4">TOTAL</td><td class="r">${fmtN(totalInitial)}</td><td class="r">${fmtN(totalBalance)}</td><td class="r ${change >= 0 ? "s" : "d"}">${change >= 0 ? "+" : ""}${fmtN(change)}</td></tr>
      </tbody>
    </table>
  `;
}
