"use client";

import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchAdminData, fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildBalanceSheetFromLedger,
  buildLedgerSummary,
  buildProfitLossFromLedger,
  formatAccountingCurrency,
  isDateInPeriod,
  type LedgerAccountSummary,
} from "@/lib/accounting-reports";
import { getBusinessCalendarDateParts } from "@/lib/business-date";
import { openBrandedPrint } from "@/lib/print";
import type { ChartOfAccount, CompanyProfile, JournalEntry, JournalLine } from "@/lib/types";
import { useToast } from "../../layout";

type StatementTab = "profit-loss" | "balance-sheet";
type PeriodMode = "month" | "year";

const MONTH_NAMES = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function getDefaultPeriod() {
  const businessToday = getBusinessCalendarDateParts();
  const now = new Date();
  const year = Number(businessToday?.year || now.getFullYear());
  const month = Math.max(Number(businessToday?.month || now.getMonth() + 1) - 1, 0);
  return { year, month };
}

function getPeriodRange(mode: PeriodMode, year: number, month: number) {
  const startDate = mode === "year"
    ? `${year}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDay = new Date(year, month + 1, 0).getDate();
  const endDate = mode === "year"
    ? `${year}-12-31`
    : `${year}-${String(month + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

function getPeriodLabel(mode: PeriodMode, year: number, month: number) {
  return mode === "year" ? `Tahun ${year}` : `${MONTH_NAMES[month]} ${year}`;
}

function buildRowsHtml(rows: LedgerAccountSummary[]) {
  if (rows.length === 0) {
    return `<tr><td colspan="2">Tidak ada data</td></tr>`;
  }
  return rows
    .map(row => `<tr><td>${row.account.code} - ${row.account.name}</td><td class="r">${formatAccountingCurrency(row.balance)}</td></tr>`)
    .join("");
}

export default function AccountingStatementsPage() {
  const { addToast } = useToast();
  const defaultPeriod = getDefaultPeriod();
  const [tab, setTab] = useState<StatementTab>("profit-loss");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [year, setYear] = useState(defaultPeriod.year);
  const [month, setMonth] = useState(defaultPeriod.month);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [accountRows, entryRows, lineRows, companyProfile] = await Promise.all([
          fetchAllAdminCollectionData<ChartOfAccount>(
            "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
            "Gagal memuat akun perkiraan",
          ),
          fetchAllAdminCollectionData<JournalEntry>(
            "/api/data?entity=journal-entries&sortField=entryDate&sortDir=asc",
            "Gagal memuat jurnal",
          ),
          fetchAllAdminCollectionData<JournalLine>(
            "/api/data?entity=journal-lines&sortField=lineNumber&sortDir=asc",
            "Gagal memuat detail jurnal",
          ),
          fetchAdminData<CompanyProfile | null>("/api/data?entity=company", "Gagal memuat profil perusahaan").catch(() => null),
        ]);
        setAccounts(accountRows || []);
        setEntries((entryRows || []).filter(entry => entry.status !== "VOID"));
        setLines(lineRows || []);
        setCompany(companyProfile || null);
      } catch (error) {
        addToast("error", error instanceof Error ? error.message : "Gagal memuat laporan keuangan");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [addToast]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([defaultPeriod.year, year]);
    entries.forEach(entry => {
      const parsed = Number(String(entry.entryDate || "").slice(0, 4));
      if (Number.isFinite(parsed)) years.add(parsed);
    });
    return [...years].sort((left, right) => right - left);
  }, [defaultPeriod.year, entries, year]);

  const period = useMemo(() => getPeriodRange(periodMode, year, month), [month, periodMode, year]);
  const periodLabel = useMemo(() => getPeriodLabel(periodMode, year, month), [month, periodMode, year]);

  const entryById = useMemo(() => new Map(entries.map(entry => [entry._id, entry])), [entries]);

  const periodLines = useMemo(() => {
    const activeEntryRefs = new Set(
      entries
        .filter(entry => isDateInPeriod(entry.entryDate, period.startDate, period.endDate))
        .map(entry => entry._id),
    );
    return lines.filter(line => activeEntryRefs.has(line.journalEntryRef));
  }, [entries, lines, period.endDate, period.startDate]);

  const cumulativeLines = useMemo(() => (
    lines.filter(line => {
      const entry = entryById.get(line.journalEntryRef);
      return Boolean(entry?.entryDate && entry.entryDate <= period.endDate);
    })
  ), [entryById, lines, period.endDate]);

  const pnlSummaries = useMemo(() => buildLedgerSummary(accounts, periodLines), [accounts, periodLines]);
  const balanceSummaries = useMemo(() => buildLedgerSummary(accounts, cumulativeLines), [accounts, cumulativeLines]);
  const profitLoss = useMemo(() => buildProfitLossFromLedger(pnlSummaries), [pnlSummaries]);
  const balanceSheet = useMemo(() => buildBalanceSheetFromLedger(balanceSummaries), [balanceSummaries]);

  const revenueRows = pnlSummaries.filter(row => row.account.accountType === "REVENUE" && row.balance !== 0);
  const deductionRows = pnlSummaries.filter(row => row.account.accountType === "CONTRA_REVENUE" && row.balance !== 0);
  const expenseRows = pnlSummaries.filter(row => row.account.accountType === "EXPENSE" && row.balance !== 0);
  const assetRows = balanceSummaries.filter(row => row.account.accountType === "ASSET" && row.balance !== 0);
  const liabilityRows = balanceSummaries.filter(row => row.account.accountType === "LIABILITY" && row.balance !== 0);
  const equityRows = balanceSummaries.filter(row => row.account.accountType === "EQUITY" && row.balance !== 0);

  const handlePrint = () => {
    const isProfitLoss = tab === "profit-loss";
    const bodyHtml = isProfitLoss
      ? `<div class="stats-row"><div class="stat-box"><div class="stat-label">Pendapatan Bersih</div><div class="stat-value s">${formatAccountingCurrency(profitLoss.netRevenue)}</div></div><div class="stat-box"><div class="stat-label">Total Beban</div><div class="stat-value d">${formatAccountingCurrency(profitLoss.expenses)}</div></div><div class="stat-box"><div class="stat-label">Laba / Rugi</div><div class="stat-value ${profitLoss.netProfit >= 0 ? "s" : "d"}">${formatAccountingCurrency(profitLoss.netProfit)}</div></div></div><table><thead><tr><th>Akun</th><th class="r">Nilai</th></tr></thead><tbody><tr class="b"><td>Pendapatan</td><td class="r">${formatAccountingCurrency(profitLoss.revenue)}</td></tr>${buildRowsHtml(revenueRows)}<tr class="b"><td>Potongan/Klaim</td><td class="r">${formatAccountingCurrency(profitLoss.deductions)}</td></tr>${buildRowsHtml(deductionRows)}<tr class="b"><td>Beban</td><td class="r">${formatAccountingCurrency(profitLoss.expenses)}</td></tr>${buildRowsHtml(expenseRows)}<tr class="b"><td>Laba / Rugi Bersih</td><td class="r">${formatAccountingCurrency(profitLoss.netProfit)}</td></tr></tbody></table>`
      : `<div class="stats-row"><div class="stat-box"><div class="stat-label">Total Aktiva</div><div class="stat-value s">${formatAccountingCurrency(balanceSheet.assets)}</div></div><div class="stat-box"><div class="stat-label">Total Pasiva</div><div class="stat-value s">${formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</div></div><div class="stat-box"><div class="stat-label">Selisih</div><div class="stat-value ${Math.abs(balanceSheet.balanceGap) <= 0.01 ? "s" : "d"}">${formatAccountingCurrency(balanceSheet.balanceGap)}</div></div></div><table><thead><tr><th>Akun</th><th class="r">Nilai</th></tr></thead><tbody><tr class="b"><td>Aktiva</td><td class="r">${formatAccountingCurrency(balanceSheet.assets)}</td></tr>${buildRowsHtml(assetRows)}<tr class="b"><td>Hutang</td><td class="r">${formatAccountingCurrency(balanceSheet.liabilities)}</td></tr>${buildRowsHtml(liabilityRows)}<tr class="b"><td>Modal</td><td class="r">${formatAccountingCurrency(balanceSheet.totalEquity)}</td></tr>${buildRowsHtml(equityRows)}<tr><td>Laba Tahun Berjalan</td><td class="r">${formatAccountingCurrency(balanceSheet.currentEarnings)}</td></tr><tr class="b"><td>Total Pasiva</td><td class="r">${formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</td></tr></tbody></table>`;

    openBrandedPrint({
      title: isProfitLoss ? "Laporan Laba Rugi" : "Neraca",
      subtitle: isProfitLoss ? periodLabel : `Per ${period.endDate}`,
      company,
      bodyHtml,
    });
  };

  if (loading) {
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 260 }} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Laporan Keuangan</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={handlePrint}>
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <div className="segmented-tabs" aria-label="Jenis laporan">
            <button
              className={`segmented-tab ${tab === "profit-loss" ? "active" : ""}`}
              onClick={() => setTab("profit-loss")}
            >
              Laba Rugi
            </button>
            <button
              className={`segmented-tab ${tab === "balance-sheet" ? "active" : ""}`}
              onClick={() => setTab("balance-sheet")}
            >
              Neraca
            </button>
          </div>
        </div>
        <div className="page-toolbar-side">
          <select className="form-select" value={periodMode} onChange={event => setPeriodMode(event.target.value as PeriodMode)}>
            <option value="month">Bulanan</option>
            <option value="year">Tahunan</option>
          </select>
          {periodMode === "month" && (
            <select className="form-select" value={month} onChange={event => setMonth(Number(event.target.value))}>
              {MONTH_NAMES.map((name, index) => (
                <option key={name} value={index}>{name}</option>
              ))}
            </select>
          )}
          <select className="form-select" value={year} onChange={event => setYear(Number(event.target.value))}>
            {yearOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      {tab === "profit-loss" ? (
        <div>
          <div className="kpi-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Pendapatan Bersih</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.netRevenue)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Beban</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.expenses)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Laba / Rugi</p>
                <p className="kpi-value">{formatAccountingCurrency(profitLoss.netProfit)}</p>
              </div>
            </div>
          </div>

          <div className="table-container">
            <div className="card-header">
              <span className="card-header-title">Laba Rugi {periodLabel}</span>
            </div>
            <StatementTable rows={revenueRows} title="Pendapatan" total={profitLoss.revenue} />
            <StatementTable rows={deductionRows} title="Potongan / Klaim" total={profitLoss.deductions} />
            <StatementTable rows={expenseRows} title="Beban" total={profitLoss.expenses} />
            <div className="statement-total-row">
              <span>Laba / Rugi Bersih</span>
              <strong>{formatAccountingCurrency(profitLoss.netProfit)}</strong>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="kpi-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Aktiva</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.assets)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Total Pasiva</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</p>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-content">
                <p className="kpi-label">Selisih Neraca</p>
                <p className="kpi-value">{formatAccountingCurrency(balanceSheet.balanceGap)}</p>
              </div>
            </div>
          </div>

          <div className="table-container">
            <div className="card-header">
              <span className="card-header-title">Neraca per {period.endDate}</span>
            </div>
            <StatementTable rows={assetRows} title="Aktiva" total={balanceSheet.assets} />
            <StatementTable rows={liabilityRows} title="Hutang" total={balanceSheet.liabilities} />
            <StatementTable rows={equityRows} title="Modal" total={balanceSheet.equity} />
            <div className="statement-line-row">
              <span>Laba Tahun Berjalan</span>
              <strong>{formatAccountingCurrency(balanceSheet.currentEarnings)}</strong>
            </div>
            <div className="statement-total-row">
              <span>Total Pasiva</span>
              <strong>{formatAccountingCurrency(balanceSheet.liabilitiesAndEquity)}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementTable({ rows, title, total }: { rows: LedgerAccountSummary[]; title: string; total: number }) {
  return (
    <section className="statement-section">
      <div className="statement-total-row statement-section-title">
        <span>{title}</span>
        <strong>{formatAccountingCurrency(total)}</strong>
      </div>
      {rows.length === 0 ? (
        <div className="statement-empty">Tidak ada data</div>
      ) : (
        rows.map(row => (
          <div key={row.account._id} className="statement-line-row">
            <span>{row.account.code} - {row.account.name}</span>
            <strong>{formatAccountingCurrency(row.balance)}</strong>
          </div>
        ))
      )}
    </section>
  );
}
