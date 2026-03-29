"use client";

import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileDown,
  Landmark,
  Printer,
} from "lucide-react";
import { useToast } from "../layout";
import { openBrandedPrint } from "@/lib/print";
import { fetchAdminData, fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import {
  buildCashflowExportRows,
  buildPeriodLabel,
  buildProfitLossExportRows,
  buildReportsSnapshot,
  resolveBankTransactionAccountName,
  type ReportPeriodMode,
} from "@/lib/reports-support";
import {
  formatCurrency,
  formatDate,
  getDriverVoucherIssuedAmount,
} from "@/lib/utils";
import { exportToExcel } from "@/lib/export";
import type {
  BankAccount,
  BankTransaction,
  CompanyProfile,
  DriverVoucher,
  Expense,
  FreightNota,
  Payment,
} from "@/lib/types";

type Tab = "pnl" | "cashflow";

export default function ReportsPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("pnl");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [freightNotas, setFreightNotas] = useState<FreightNota[]>([]);
  const [driverVouchers, setDriverVouchers] = useState<DriverVoucher[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccount[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>(
    [],
  );
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [periodMode, setPeriodMode] = useState<ReportPeriodMode>("month");
  const monthNames = [
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

  useEffect(() => {
    async function loadReportData() {
      try {
        const [pay, exp, nota, vouchers, banks, txs, companyProfile] =
          await Promise.all([
            fetchAllAdminCollectionData<Payment>("/api/data?entity=payments", "Gagal memuat payments"),
            fetchAllAdminCollectionData<Expense>("/api/data?entity=expenses", "Gagal memuat expenses"),
            fetchAllAdminCollectionData<FreightNota>("/api/data?entity=freight-notas", "Gagal memuat freight-notas"),
            fetchAllAdminCollectionData<DriverVoucher>("/api/data?entity=driver-vouchers", "Gagal memuat driver-vouchers"),
            fetchAllAdminCollectionData<BankAccount>("/api/data?entity=bank-accounts", "Gagal memuat bank-accounts"),
            fetchAllAdminCollectionData<BankTransaction>("/api/data?entity=bank-transactions", "Gagal memuat bank-transactions"),
            fetchAdminData<CompanyProfile | null>("/api/data?entity=company", "Gagal memuat company"),
          ]);
        setPayments(pay || []);
        setExpenses(exp || []);
        setFreightNotas(nota || []);
        setDriverVouchers(vouchers || []);
        setAllBankAccounts(banks || []);
        setBankAccounts(
          (banks || []).filter((account) => account.active !== false),
        );
        setBankTransactions(txs || []);
        setCompany(companyProfile || null);
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Gagal memuat laporan",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReportData();
  }, [addToast]);
  const periodLabel = buildPeriodLabel(periodMode, month, year, monthNames);
  const {
    filteredPayments,
    filteredExpenses,
    sortedFilteredBankTx,
    totalRevenue,
    totalExpense,
    netProfit,
    totalNotaIssued,
    totalNotaOutstanding,
    openDriverVouchers,
    openVoucherCash,
    openVoucherOperationalSpent,
    openVoucherDriverFees,
    openVoucherClaims,
    openVoucherReturn,
    openVoucherShortage,
    sortedCategories,
    cashFlowByBank,
  } = buildReportsSnapshot({
    payments,
    expenses,
    freightNotas,
    driverVouchers,
    allBankAccounts,
    bankTransactions,
    periodMode,
    month,
    year,
  });
  const fmtN = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  const cashflowSummaryAccounts = [
    ...bankAccounts,
    ...Object.entries(cashFlowByBank)
      .filter(([accountRef]) => !bankAccounts.some((account) => account._id === accountRef))
      .map(([accountRef, flow]) => ({
        _id: accountRef,
        bankName: flow.bankName,
        accountNumber: flow.bankAccountNumber,
        currentBalance:
          allBankAccounts.find((account) => account._id === accountRef)
            ?.currentBalance || 0,
        accountType: "BANK" as const,
        active: false,
      })),
  ];

  const prevPeriod = () => {
    if (periodMode === "year") setYear((value) => value - 1);
    else if (month === 0) {
      setMonth(11);
      setYear((value) => value - 1);
    } else setMonth((value) => value - 1);
  };
  const nextPeriod = () => {
    if (periodMode === "year") setYear((value) => value + 1);
    else if (month === 11) {
      setMonth(0);
      setYear((value) => value + 1);
    } else setMonth((value) => value + 1);
  };

  const handleExportExcel = () => {
    try {
      if (tab === "pnl") {
        const rows = buildProfitLossExportRows(filteredPayments, filteredExpenses);
        exportToExcel(
          rows as unknown as Record<string, unknown>[],
          [
            { header: "Tipe", key: "tipe", width: 15 },
            { header: "Tanggal", key: "tanggal", width: 15 },
            { header: "Deskripsi", key: "deskripsi", width: 35 },
            { header: "Jumlah", key: "jumlah", width: 18 },
          ],
          `laba-rugi-${periodLabel.replace(/\s/g, "-")}`,
          "Laba Rugi",
        );
      } else {
        const rows = buildCashflowExportRows(
          sortedFilteredBankTx,
          allBankAccounts,
        );
        exportToExcel(
          rows as unknown as Record<string, unknown>[],
          [
            { header: "Bank", key: "bank", width: 15 },
            { header: "Tanggal", key: "tanggal", width: 15 },
            { header: "Tipe", key: "tipe", width: 15 },
            { header: "Deskripsi", key: "deskripsi", width: 30 },
            { header: "Jumlah", key: "jumlah", width: 18 },
            { header: "Saldo", key: "saldo", width: 18 },
          ],
          `arus-kas-${periodLabel.replace(/\s/g, "-")}`,
          "Arus Kas",
        );
      }
      addToast("success", "Excel berhasil di-download");
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal menyiapkan Excel laporan",
      );
    }
  };

  const handleBrandedPrint = () => {
    try {
      const isPnl = tab === "pnl";
      openBrandedPrint({
        title: isPnl ? "Laporan Laba Rugi" : "Laporan Arus Kas",
        subtitle: periodLabel,
        company,
        bodyHtml: isPnl
          ? `<div class="stats-row"><div class="stat-box"><div class="stat-label">Pendapatan</div><div class="stat-value s">${fmtN(totalRevenue)}</div></div><div class="stat-box"><div class="stat-label">Pengeluaran</div><div class="stat-value d">${fmtN(totalExpense)}</div></div><div class="stat-box"><div class="stat-label">Laba/Rugi Bersih</div><div class="stat-value ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</div></div></div><table><thead><tr><th>Kategori</th><th class="r">Jumlah</th><th class="r">%</th></tr></thead><tbody><tr class="b"><td>PENDAPATAN</td><td class="r s">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr><tr><td style="padding-left:1.5rem">Pembayaran customer (${filteredPayments.length}x)</td><td class="r">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr><tr class="b" style="border-top:2px solid #e2e8f0"><td>PENGELUARAN</td><td class="r d">${fmtN(totalExpense)}</td><td class="r">100%</td></tr>${sortedCategories.map(([cat, amt]) => `<tr><td style="padding-left:1.5rem">${cat}</td><td class="r">${fmtN(amt)}</td><td class="r">${totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : 0}%</td></tr>`).join("")}<tr class="b" style="border-top:2px solid #1e293b"><td>LABA / RUGI BERSIH</td><td class="r ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</td><td></td></tr></tbody></table>`
          : `<div class="stats-row">${Object.entries(cashFlowByBank)
              .map(
                ([, value]) =>
                  `<div class="stat-box"><div class="stat-label">${value.bankName}</div><div class="stat-value s">+${fmtN(value.inflow)}</div><div class="d" style="font-size:0.78rem;margin-top:0.15rem">-${fmtN(value.outflow)}</div></div>`,
              )
              .join(
                "",
              )}</div><table><thead><tr><th>Bank</th><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr></thead><tbody>${sortedFilteredBankTx
              .map((item) => {
                const isIn =
                  item.type === "CREDIT" || item.type === "TRANSFER_IN";
                const bankName = resolveBankTransactionAccountName(
                  item,
                  allBankAccounts,
                );
                return `<tr><td>${bankName}</td><td>${item.date ? new Date(item.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td><td>${item.type}</td><td>${item.description}</td><td class="r ${isIn ? "s" : "d"} b">${isIn ? "+" : "-"}${fmtN(item.amount)}</td><td class="r b">${fmtN(item.balanceAfter)}</td></tr>`;
              })
              .join("")}</tbody></table>`,
      });
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal menyiapkan dokumen print laporan",
      );
    }
  };

  if (loading)
    return (
      <div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-card" style={{ height: 200 }} />
      </div>
    );

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Laporan Keuangan</h1>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleExportExcel}
          >
            <FileDown size={15} /> Excel
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleBrandedPrint}
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>
      <div className="page-toolbar">
        <div className="page-toolbar-main">
          <div className="segmented-tabs" aria-label="Jenis laporan">
            <button
              className={`segmented-tab ${tab === "pnl" ? "active" : ""}`}
              onClick={() => setTab("pnl")}
            >
              <DollarSign size={14} /> Laba Rugi
            </button>
            <button
              className={`segmented-tab ${tab === "cashflow" ? "active" : ""}`}
              onClick={() => setTab("cashflow")}
            >
              <Landmark size={14} /> Arus Kas
            </button>
          </div>
        </div>
        <div className="page-toolbar-side">
          <div className="period-controls">
          <select
            className="form-select"
            value={periodMode}
            onChange={(event) =>
              setPeriodMode(event.target.value as "month" | "year" | "all")
            }
          >
            <option value="month">Bulanan</option>
            <option value="year">Tahunan</option>
            <option value="all">Semua</option>
          </select>
          {periodMode === "month" && (
            <select
              className="form-select"
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {periodMode !== "all" && (
            <div className="period-nav-group">
              <button
                className="btn btn-secondary btn-sm"
                onClick={prevPeriod}
                aria-label="Periode sebelumnya"
                title="Periode sebelumnya"
              >
                <ChevronLeft size={14} />
              </button>
              <input
                className="form-input"
                type="number"
                value={year}
                onChange={(event) =>
                  setYear(Number(event.target.value) || now.getFullYear())
                }
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={nextPeriod}
                aria-label="Periode berikutnya"
                title="Periode berikutnya"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
            <span className="period-label-pill">{periodLabel}</span>
          </div>
        </div>
      </div>

      {tab === "pnl" ? (
        <div>
          <div className="responsive-stat-grid" style={{ marginBottom: "1.5rem" }}>
            {[
              {
                label: "Pendapatan",
                value: formatCurrency(totalRevenue),
                note: `${filteredPayments.length} pembayaran`,
                color: "var(--color-success)",
              },
              {
                label: "Pengeluaran",
                value: formatCurrency(totalExpense),
                note: `${filteredExpenses.length} transaksi`,
                color: "var(--color-danger)",
              },
              {
                label: "Laba Bersih",
                value: `${netProfit >= 0 ? "+" : ""}${formatCurrency(netProfit)}`,
                note: `Margin ${totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0"}%`,
                color:
                  netProfit >= 0
                    ? "var(--color-success)"
                    : "var(--color-danger)",
              },
              {
                label: "Piutang Nota Aktif",
                value: formatCurrency(totalNotaOutstanding),
                note: `Nota terbit ${formatCurrency(totalNotaIssued)}`,
                color: "var(--color-warning)",
              },
              {
                label: "Uang Jalan Trip Belum Diselesaikan",
                value: formatCurrency(openVoucherClaims),
                note: `${openDriverVouchers.length} trip aktif`,
                color: "var(--color-primary)",
              },
            ].map((item) => (
              <div key={item.label} className="card">
                <div className="card-body">
                  <div
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: "1.4rem",
                      fontWeight: 700,
                      color: item.color,
                    }}
                  >
                    {item.value}
                  </div>
                  <div
                    style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                  >
                    {item.note}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: "1.5rem" }}>
            <div className="card-header">
                <span className="card-header-title">Uang Jalan Trip yang Masih Berjalan</span>
            </div>
            <div className="card-body">
              <div className="responsive-stat-grid" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Total Uang Diberikan
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherCash)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Biaya Perjalanan
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    {formatCurrency(openVoucherOperationalSpent)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Upah Trip Pending
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherDriverFees)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Total Hak Trip Pending
                  </div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                    {formatCurrency(openVoucherClaims)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Potensi Uang Kembali
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-success)",
                    }}
                  >
                    {formatCurrency(openVoucherReturn)}
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--color-gray-50)",
                    borderRadius: "0.6rem",
                    padding: "0.85rem 1rem",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.68rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    Potensi Tambahan Bayar
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    {formatCurrency(openVoucherShortage)}
                  </div>
                </div>
              </div>
              <div className="table-wrapper table-desktop-only" style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th>No. Bon</th>
                      <th>Tanggal</th>
                      <th>Supir</th>
                      <th>Rekening</th>
                      <th style={{ textAlign: "right" }}>Total Diberikan</th>
                      <th style={{ textAlign: "right" }}>Biaya</th>
                      <th style={{ textAlign: "right" }}>Upah Trip</th>
                      <th style={{ textAlign: "right" }}>Total Hak Trip</th>
                      <th style={{ textAlign: "right" }}>Selisih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openDriverVouchers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          style={{
                            textAlign: "center",
                            padding: "2rem 1rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          Tidak ada uang jalan trip yang masih aktif
                        </td>
                      </tr>
                    ) : (
                      openDriverVouchers.map((item) => {
                        const totalClaimAmount =
                          item.totalClaimAmount ||
                          (item.totalSpent || 0) + (item.driverFeeAmount || 0);
                        return (
                          <tr key={item._id}>
                            <td style={{ fontWeight: 600 }}>{item.bonNumber}</td>
                            <td>{formatDate(item.issuedDate)}</td>
                            <td>{item.driverName || "-"}</td>
                            <td>{item.issueBankName || "-"}</td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {formatCurrency(getDriverVoucherIssuedAmount(item))}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatCurrency(item.totalSpent)}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatCurrency(item.driverFeeAmount || 0)}
                            </td>
                            <td style={{ textAlign: "right", fontWeight: 600 }}>
                              {formatCurrency(totalClaimAmount)}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                fontWeight: 700,
                                color:
                                  item.balance < 0
                                    ? "var(--color-danger)"
                                    : "var(--color-success)",
                              }}
                            >
                              {formatCurrency(item.balance)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mobile-record-list">
                {openDriverVouchers.length === 0 ? (
                  <div className="mobile-record-card">
                    <div className="mobile-record-title">
                      Tidak ada uang jalan trip yang masih aktif
                    </div>
                    <div className="mobile-record-subtitle">
                      Semua uang jalan trip pada periode ini sudah diselesaikan.
                    </div>
                  </div>
                ) : (
                  openDriverVouchers.map((item) => {
                    const totalClaimAmount =
                      item.totalClaimAmount ||
                      (item.totalSpent || 0) + (item.driverFeeAmount || 0);
                    return (
                      <div key={item._id} className="mobile-record-card">
                        <div className="mobile-record-header">
                          <div>
                            <div className="mobile-record-title">
                              {item.bonNumber}
                            </div>
                            <div className="mobile-record-subtitle">
                              {item.driverName || "-"} | {formatDate(item.issuedDate)}
                            </div>
                          </div>
                          <span className="badge badge-warning">Belum Diselesaikan</span>
                        </div>
                        <div className="mobile-record-meta">
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Rekening</span>
                            <span className="mobile-record-value">
                              {item.issueBankName || "-"}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Total Diberikan</span>
                            <span className="mobile-record-value">
                              {formatCurrency(getDriverVoucherIssuedAmount(item))}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Biaya</span>
                            <span className="mobile-record-value">
                              {formatCurrency(item.totalSpent)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Upah Trip</span>
                            <span className="mobile-record-value">
                              {formatCurrency(item.driverFeeAmount || 0)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Total Hak Trip</span>
                            <span className="mobile-record-value">
                              {formatCurrency(totalClaimAmount)}
                            </span>
                          </div>
                          <div className="mobile-record-kv">
                            <span className="mobile-record-label">Selisih</span>
                            <span
                              className="mobile-record-value"
                              style={{
                                fontWeight: 700,
                                color:
                                  item.balance < 0
                                    ? "var(--color-danger)"
                                    : "var(--color-success)",
                              }}
                            >
                              {formatCurrency(item.balance)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <div className="detail-grid">
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">Laporan Laba Rugi</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(5,150,105,0.05)",
                    borderBottom: "1px solid var(--color-gray-100)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      color: "var(--color-success)",
                    }}
                  >
                    <span>PENDAPATAN</span>
                    <span>{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.5rem 1rem 0.5rem 2rem",
                    borderBottom: "1px solid var(--color-gray-100)",
                    fontSize: "0.82rem",
                  }}
                >
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span>Pembayaran Customer ({filteredPayments.length}x)</span>
                    <span style={{ fontWeight: 600 }}>
                      {formatCurrency(totalRevenue)}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    padding: "0.75rem 1rem",
                    background: "rgba(220,38,38,0.05)",
                    borderBottom: "1px solid var(--color-gray-100)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    <span>PENGELUARAN</span>
                    <span>{formatCurrency(totalExpense)}</span>
                  </div>
                </div>
                {sortedCategories.map(([category, amount]) => (
                  <div
                    key={category}
                    style={{
                      padding: "0.5rem 1rem 0.5rem 2rem",
                      borderBottom: "1px solid var(--color-gray-100)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{category}</span>
                      <div style={{ display: "flex", gap: "1.5rem" }}>
                        <span style={{ fontWeight: 600 }}>
                          {formatCurrency(amount)}
                        </span>
                        <span
                          style={{
                            color: "var(--color-gray-400)",
                            fontSize: "0.72rem",
                            minWidth: 40,
                            textAlign: "right",
                          }}
                        >
                          {totalExpense > 0
                            ? ((amount / totalExpense) * 100).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    padding: "1rem",
                    background: "var(--color-gray-50)",
                    borderTop: "2px solid var(--color-gray-300)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      fontSize: "1rem",
                    }}
                  >
                    <span>LABA / RUGI BERSIH</span>
                    <span
                      style={{
                        color:
                          netProfit >= 0
                            ? "var(--color-success)"
                            : "var(--color-danger)",
                      }}
                    >
                      {netProfit >= 0 ? "+" : ""}
                      {formatCurrency(netProfit)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <span className="card-header-title">
                  Pengeluaran per Kategori
                </span>
              </div>
              <div className="card-body">
                {sortedCategories.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--color-gray-400)",
                      padding: "2rem 0",
                    }}
                  >
                    Tidak ada pengeluaran
                  </div>
                ) : (
                  sortedCategories.map(([category, amount]) => {
                    const pct =
                      totalExpense > 0 ? (amount / totalExpense) * 100 : 0;
                    return (
                      <div key={category} style={{ marginBottom: "0.75rem" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: "0.82rem",
                            marginBottom: "0.2rem",
                          }}
                        >
                          <span style={{ fontWeight: 500 }}>{category}</span>
                          <span style={{ fontWeight: 600 }}>
                            {formatCurrency(amount)}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 6,
                            background: "var(--color-gray-100)",
                            borderRadius: 3,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background:
                                "linear-gradient(90deg, var(--color-danger), #f87171)",
                              borderRadius: 3,
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: "0.68rem",
                            color: "var(--color-gray-400)",
                            marginTop: "0.1rem",
                          }}
                        >
                          {pct.toFixed(1)}%
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            {cashflowSummaryAccounts.map((account) => {
              const flow = cashFlowByBank[account._id] || {
                inflow: 0,
                outflow: 0,
              };
              return (
                <div key={account._id} className="card">
                  <div className="card-body">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        marginBottom: "0.6rem",
                      }}
                    >
                      <Landmark
                        size={16}
                        style={{ color: "var(--color-primary)" }}
                      />
                      <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>
                        {account.bankName}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span style={{ color: "var(--color-success)" }}>
                        Masuk
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--color-success)",
                        }}
                      >
                        +{formatCurrency(flow.inflow)}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                        marginBottom: "0.3rem",
                      }}
                    >
                      <span style={{ color: "var(--color-danger)" }}>
                        Keluar
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "var(--color-danger)",
                        }}
                      >
                        -{formatCurrency(flow.outflow)}
                      </span>
                    </div>
                    <div
                      style={{
                        borderTop: "1px solid var(--color-gray-100)",
                        marginTop: "0.3rem",
                        paddingTop: "0.3rem",
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "0.78rem",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Saldo</span>
                      <span style={{ fontWeight: 700 }}>
                        {formatCurrency(account.currentBalance || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card">
            <div
              className="card-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="card-header-title">Transaksi Arus Kas</span>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {sortedFilteredBankTx.length} transaksi
              </span>
            </div>
            <div className="table-wrapper table-desktop-only" style={{ overflowX: "auto" }}>
              <table style={{ minWidth: 650 }}>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Bank</th>
                    <th>Tipe</th>
                    <th>Deskripsi</th>
                    <th style={{ textAlign: "right" }}>Jumlah</th>
                    <th style={{ textAlign: "right" }}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredBankTx.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          textAlign: "center",
                          padding: "2.5rem 1rem",
                          color: "var(--color-gray-400)",
                        }}
                      >
                        Tidak ada transaksi dalam periode ini
                      </td>
                    </tr>
                  ) : (
                    sortedFilteredBankTx.map((item) => {
                      const isIn =
                        item.type === "CREDIT" || item.type === "TRANSFER_IN";
                      const bankName = resolveBankTransactionAccountName(
                        item,
                        allBankAccounts,
                      );
                      return (
                        <tr key={item._id}>
                          <td
                            style={{
                              whiteSpace: "nowrap",
                              fontSize: "0.82rem",
                            }}
                          >
                            {formatDate(item.date)}
                          </td>
                          <td style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                            {bankName}
                          </td>
                          <td>
                            <span
                              className={`badge badge-${isIn ? "success" : "danger"}`}
                              style={{ fontSize: "0.65rem" }}
                            >
                              {isIn ? "Masuk" : "Keluar"}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.82rem" }}>
                            {item.description}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: 700,
                              color: isIn
                                ? "var(--color-success)"
                                : "var(--color-danger)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {isIn ? "+" : "-"}
                            {formatCurrency(item.amount)}
                          </td>
                          <td
                            style={{
                              textAlign: "right",
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {formatCurrency(item.balanceAfter)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="mobile-record-list">
              {sortedFilteredBankTx.length === 0 ? (
                <div className="mobile-record-card">
                  <div className="mobile-record-title">
                    Tidak ada transaksi dalam periode ini
                  </div>
                  <div className="mobile-record-subtitle">
                    Ubah periode untuk melihat mutasi bank atau kas lainnya.
                  </div>
                </div>
              ) : (
                sortedFilteredBankTx.map((item) => {
                  const isIn =
                    item.type === "CREDIT" || item.type === "TRANSFER_IN";
                  const bankName = resolveBankTransactionAccountName(
                    item,
                    allBankAccounts,
                  );
                  return (
                    <div key={item._id} className="mobile-record-card">
                      <div className="mobile-record-header">
                        <div>
                          <div className="mobile-record-title">{bankName}</div>
                          <div className="mobile-record-subtitle">
                            {formatDate(item.date)} • {item.description}
                          </div>
                        </div>
                        <span
                          className={`badge badge-${isIn ? "success" : "danger"}`}
                        >
                          {isIn ? "Masuk" : "Keluar"}
                        </span>
                      </div>
                      <div className="mobile-record-meta">
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Jumlah</span>
                          <span
                            className="mobile-record-value"
                            style={{
                              fontWeight: 700,
                              color: isIn
                                ? "var(--color-success)"
                                : "var(--color-danger)",
                            }}
                          >
                            {isIn ? "+" : "-"}
                            {formatCurrency(item.amount)}
                          </span>
                        </div>
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Saldo Setelah</span>
                          <span className="mobile-record-value">
                            {formatCurrency(item.balanceAfter)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
