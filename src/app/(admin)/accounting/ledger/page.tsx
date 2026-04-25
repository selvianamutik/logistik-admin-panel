"use client";

import { useEffect, useMemo, useState } from "react";

import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildBalanceSheetFromLedger,
  buildJournalLineLookup,
  buildLedgerSummary,
  buildProfitLossFromLedger,
  formatAccountingCurrency,
  isDateInPeriod,
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

  const periodSummaries = useMemo(() => buildLedgerSummary(accounts, periodLines), [accounts, periodLines]);
  const balanceSummaries = useMemo(() => buildLedgerSummary(accounts, cumulativeLines), [accounts, cumulativeLines]);

  const pnl = useMemo(() => buildProfitLossFromLedger(periodSummaries), [periodSummaries]);
  const balanceSheet = useMemo(() => buildBalanceSheetFromLedger(balanceSummaries), [balanceSummaries]);
  const ledgerLines = useMemo(() => buildJournalLineLookup(entries, lines), [entries, lines]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Buku Besar</h1>
        </div>
        <select className="form-select" value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {yearOptions.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
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
        </div>
      </div>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <h2 className="card-header-title">Mutasi Terakhir</h2>
        </div>
        <div className="table-wrapper">
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
              {ledgerLines
                .filter(line => isDateInPeriod(line.entryDate, period.startDate, period.endDate))
                .slice(-40)
                .reverse()
                .map(line => (
                  <tr key={line._id}>
                    <td>{line.entryDate || "-"}</td>
                    <td>{line.entryNumber || "-"}</td>
                    <td>{line.accountCode} - {line.accountName}</td>
                    <td style={{ textAlign: "right" }}>{line.debit ? formatAccountingCurrency(line.debit) : "-"}</td>
                    <td style={{ textAlign: "right" }}>{line.credit ? formatAccountingCurrency(line.credit) : "-"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
