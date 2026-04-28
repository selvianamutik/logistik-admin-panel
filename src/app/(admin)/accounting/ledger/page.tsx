"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildBalanceSheetFromLedger,
  buildJournalLineLookup,
  buildLedgerSummary,
  buildProfitLossFromLedger,
  formatAccountingCurrency,
  getJournalLinesForPeriod,
  getJournalLinesUntil,
} from "@/lib/accounting-reports";
import type { ChartOfAccount, JournalEntry, JournalLine } from "@/lib/types";

function todayYear() {
  return new Date().getFullYear();
}

function getYearPeriod(year: number) {
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

export default function LedgerPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [year, setYear] = useState(todayYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [accountRows, entryRows, lineRows] = await Promise.all([
          fetchAllAdminCollectionData<ChartOfAccount>(
            "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
            "Gagal memuat akun",
          ),
          fetchAllAdminCollectionData<JournalEntry>(
            "/api/data?entity=journal-entries&sortField=entryDate&sortDir=asc",
            "Gagal memuat jurnal",
          ),
          fetchAllAdminCollectionData<JournalLine>(
            "/api/data?entity=journal-lines&sortField=lineNumber&sortDir=asc",
            "Gagal memuat detail jurnal",
          ),
        ]);
        setAccounts(accountRows || []);
        setEntries((entryRows || []).filter(entry => entry.status !== "VOID"));
        setLines(lineRows || []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([todayYear(), year]);
    entries.forEach(entry => {
      const parsed = Number(String(entry.entryDate || "").slice(0, 4));
      if (Number.isFinite(parsed)) years.add(parsed);
    });
    return [...years].sort((left, right) => right - left);
  }, [entries, year]);

  const period = useMemo(() => getYearPeriod(year), [year]);

  const periodLines = useMemo(
    () => getJournalLinesForPeriod(entries, lines, period.startDate, period.endDate),
    [entries, lines, period.endDate, period.startDate],
  );

  const cumulativeLines = useMemo(
    () => getJournalLinesUntil(entries, lines, period.endDate),
    [entries, lines, period.endDate],
  );

  const periodSummaries = useMemo(() => buildLedgerSummary(accounts, periodLines), [accounts, periodLines]);
  const balanceSummaries = useMemo(() => buildLedgerSummary(accounts, cumulativeLines), [accounts, cumulativeLines]);

  const pnl = useMemo(() => buildProfitLossFromLedger(periodSummaries), [periodSummaries]);
  const balanceSheet = useMemo(() => buildBalanceSheetFromLedger(balanceSummaries), [balanceSummaries]);
  const recentLedgerLines = useMemo(
    () => buildJournalLineLookup(entries, periodLines)
      .sort((left, right) =>
        String(right.entryDate || "").localeCompare(String(left.entryDate || "")) ||
        String(right.entryNumber || "").localeCompare(String(left.entryNumber || "")) ||
        Number(left.lineNumber || 0) - Number(right.lineNumber || 0),
      )
      .slice(0, 40),
    [entries, periodLines],
  );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Buku Besar</h1>
        </div>
      </div>

      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <span className="period-label-pill">Tahun {year}</span>
        </div>
        <div className="page-toolbar-side">
          <div className="period-controls">
            <select className="form-select accounting-period-filter" value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {yearOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Pendapatan Bersih</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.netRevenue)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Total Beban</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.expenses)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Laba / Rugi</p>
            <p className="kpi-value">{formatAccountingCurrency(pnl.netProfit)}</p>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-content">
            <p className="kpi-label">Selisih Neraca per 31/12/{year}</p>
            <p className="kpi-value" style={{ color: Math.abs(balanceSheet.balanceGap) > 0.01 ? "var(--color-danger)" : "var(--color-success)" }}>
              {formatAccountingCurrency(balanceSheet.balanceGap)}
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <h2 className="card-header-title">Mutasi Akun {year}</h2>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr>
                <th>Akun</th>
                <th>Tipe</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Kredit</th>
                <th style={{ textAlign: "right" }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {periodSummaries.map(summary => (
                <tr key={summary.account._id}>
                  <td style={{ fontWeight: 700 }}>{summary.account.code} - {summary.account.name}</td>
                  <td>{summary.account.accountType}</td>
                  <td style={{ textAlign: "right" }}>{formatAccountingCurrency(summary.debit)}</td>
                  <td style={{ textAlign: "right" }}>{formatAccountingCurrency(summary.credit)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{formatAccountingCurrency(summary.balance)}</td>
                </tr>
              ))}
              {!loading && periodSummaries.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada mutasi jurnal.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list">
          {periodSummaries.map(summary => (
            <article key={summary.account._id} className="mobile-record-card">
              <div>
                <p className="mobile-record-title">{summary.account.code} - {summary.account.name}</p>
                <p className="mobile-record-subtitle">{summary.account.accountType}</p>
              </div>
              <strong>{formatAccountingCurrency(summary.balance)}</strong>
            </article>
          ))}
          {!loading && periodSummaries.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Belum ada mutasi jurnal.</p>
            </article>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <h2 className="card-header-title">Mutasi Terakhir</h2>
        </div>
        <div className="table-wrapper table-desktop-only">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Jurnal</th>
                <th>Akun</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Kredit</th>
              </tr>
            </thead>
            <tbody>
              {recentLedgerLines.map(line => (
                <tr key={line._id}>
                  <td>{line.entryDate || "-"}</td>
                  <td>{line.entryNumber || "-"}</td>
                  <td>{line.accountCode} - {line.accountName}</td>
                  <td style={{ textAlign: "right" }}>{line.debit ? formatAccountingCurrency(line.debit) : "-"}</td>
                  <td style={{ textAlign: "right" }}>{line.credit ? formatAccountingCurrency(line.credit) : "-"}</td>
                </tr>
              ))}
              {!loading && recentLedgerLines.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada mutasi jurnal.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mobile-record-list" style={{ padding: "var(--space-3)" }}>
          {recentLedgerLines.map(line => (
            <article key={line._id} className="mobile-record-card">
              <div className="mobile-record-header">
                <div>
                  <p className="mobile-record-title">{line.entryNumber || "-"}</p>
                  <p className="mobile-record-subtitle">{line.entryDate || "-"}</p>
                </div>
              </div>
              <div className="mobile-record-meta">
                <div className="mobile-record-kv">
                  <span className="mobile-record-label">Akun</span>
                  <span className="mobile-record-value">{line.accountCode} - {line.accountName}</span>
                </div>
                <div className="mobile-record-kv">
                  <span className="mobile-record-label">Debit</span>
                  <span className="mobile-record-value">{line.debit ? formatAccountingCurrency(line.debit) : "-"}</span>
                </div>
                <div className="mobile-record-kv">
                  <span className="mobile-record-label">Kredit</span>
                  <span className="mobile-record-value">{line.credit ? formatAccountingCurrency(line.credit) : "-"}</span>
                </div>
              </div>
            </article>
          ))}
          {!loading && recentLedgerLines.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Belum ada mutasi jurnal.</p>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
