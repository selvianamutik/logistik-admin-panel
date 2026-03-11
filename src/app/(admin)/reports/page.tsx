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
import { formatCurrency, formatDate } from "@/lib/utils";
import { exportToExcel } from "@/lib/export";
import type {
  BankAccount,
  BankTransaction,
  CompanyProfile,
  DriverVoucher,
  Expense,
  FreightNota,
  Invoice,
  Payment,
} from "@/lib/types";

type Tab = "pnl" | "cashflow";

export default function ReportsPage() {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("pnl");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
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
  const [periodMode, setPeriodMode] = useState<"month" | "year" | "all">(
    "month",
  );
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
    const fetchEntity = async <T,>(entity: string): Promise<T> => {
      const res = await fetch(`/api/data?entity=${entity}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || `Gagal memuat ${entity}`);
      return payload.data;
    };

    async function loadReportData() {
      try {
        const [pay, exp, inv, nota, vouchers, banks, txs, companyProfile] =
          await Promise.all([
            fetchEntity<Payment[]>("payments"),
            fetchEntity<Expense[]>("expenses"),
            fetchEntity<Invoice[]>("invoices"),
            fetchEntity<FreightNota[]>("freight-notas"),
            fetchEntity<DriverVoucher[]>("driver-vouchers"),
            fetchEntity<BankAccount[]>("bank-accounts"),
            fetchEntity<BankTransaction[]>("bank-transactions"),
            fetchEntity<CompanyProfile | null>("company"),
          ]);
        setPayments(pay || []);
        setExpenses(exp || []);
        setInvoices(inv || []);
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

  const inPeriod = (dateStr: string) => {
    if (periodMode === "all") return true;
    const date = new Date(dateStr);
    if (periodMode === "year") return date.getFullYear() === year;
    return date.getFullYear() === year && date.getMonth() === month;
  };

  const periodLabel =
    periodMode === "all"
      ? "Semua Periode"
      : periodMode === "year"
        ? `Tahun ${year}`
        : `${monthNames[month]} ${year}`;
  const filteredPayments = payments.filter((item) => inPeriod(item.date));
  const filteredExpenses = expenses.filter((item) => inPeriod(item.date));
  const filteredBankTx = bankTransactions.filter((item) => inPeriod(item.date));
  const sortedFilteredBankTx = [...filteredBankTx].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const totalRevenue = filteredPayments.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const totalExpense = filteredExpenses.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const netProfit = totalRevenue - totalExpense;
  const totalInvoiced = [
    ...invoices
      .filter((item) => inPeriod(item.issueDate))
      .map((item) => item.totalAmount),
    ...freightNotas
      .filter((item) => inPeriod(item.issueDate))
      .map((item) => item.totalAmount),
  ].reduce((sum, amount) => sum + amount, 0);
  const totalOutstanding = [
    ...invoices
      .filter((item) => item.status !== "PAID" && inPeriod(item.issueDate))
      .map((item) => item.totalAmount),
    ...freightNotas
      .filter((item) => item.status !== "PAID" && inPeriod(item.issueDate))
      .map((item) => item.totalAmount),
  ].reduce((sum, amount) => sum + amount, 0);
  const openDriverVouchers = driverVouchers
    .filter((item) => item.status !== "SETTLED")
    .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
  const openVoucherCash = openDriverVouchers.reduce(
    (sum, item) => sum + (item.cashGiven || 0),
    0,
  );
  const openVoucherSpent = openDriverVouchers.reduce(
    (sum, item) => sum + (item.totalSpent || 0),
    0,
  );
  const openVoucherReturn = openDriverVouchers.reduce(
    (sum, item) => sum + Math.max(item.balance || 0, 0),
    0,
  );
  const openVoucherShortage = openDriverVouchers.reduce(
    (sum, item) => sum + Math.abs(Math.min(item.balance || 0, 0)),
    0,
  );
  const expenseByCategory = filteredExpenses.reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.categoryName || "Lainnya"] =
        (acc[item.categoryName || "Lainnya"] || 0) + item.amount;
      return acc;
    },
    {},
  );
  const sortedCategories = Object.entries(expenseByCategory).sort(
    ([, a], [, b]) => b - a,
  );
  const cashFlowByBank = filteredBankTx.reduce<
    Record<string, { bankName: string; inflow: number; outflow: number }>
  >((acc, item) => {
    const bankName =
      allBankAccounts.find((account) => account._id === item.bankAccountRef)
        ?.bankName || "Unknown";
    if (!acc[item.bankAccountRef])
      acc[item.bankAccountRef] = { bankName, inflow: 0, outflow: 0 };
    if (item.type === "CREDIT" || item.type === "TRANSFER_IN")
      acc[item.bankAccountRef].inflow += item.amount;
    else acc[item.bankAccountRef].outflow += item.amount;
    return acc;
  }, {});
  const fmtN = (n: number) => new Intl.NumberFormat("id-ID").format(n);

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
    if (tab === "pnl") {
        const rows = [
        ...filteredPayments.map((item) => ({
          tipe: "Pendapatan",
          tanggal: item.date,
          deskripsi: item.note || "Pembayaran Nota",
          jumlah: item.amount,
        })),
        ...filteredExpenses.map((item) => ({
          tipe: "Pengeluaran",
          tanggal: item.date,
          deskripsi: item.note || item.categoryName || "-",
          jumlah: -item.amount,
        })),
      ];
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
      const rows = sortedFilteredBankTx.map((item) => ({
        bank:
          allBankAccounts.find((account) => account._id === item.bankAccountRef)
            ?.bankName || "-",
        tanggal: item.date,
        tipe: item.type,
        deskripsi: item.description,
        jumlah: item.amount,
        saldo: item.balanceAfter,
      }));
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
  };

  const handleBrandedPrint = () => {
    const isPnl = tab === "pnl";
    openBrandedPrint({
      title: isPnl ? "Laporan Laba Rugi" : "Laporan Arus Kas",
      subtitle: periodLabel,
      company,
      bodyHtml: isPnl
        ? `<div class="stats-row"><div class="stat-box"><div class="stat-label">Pendapatan</div><div class="stat-value s">${fmtN(totalRevenue)}</div></div><div class="stat-box"><div class="stat-label">Pengeluaran</div><div class="stat-value d">${fmtN(totalExpense)}</div></div><div class="stat-box"><div class="stat-label">Laba/Rugi Bersih</div><div class="stat-value ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</div></div></div><table><thead><tr><th>Kategori</th><th class="r">Jumlah</th><th class="r">%</th></tr></thead><tbody><tr class="b"><td>PENDAPATAN</td><td class="r s">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr><tr><td style="padding-left:1.5rem">Pembayaran Nota (${filteredPayments.length}x)</td><td class="r">${fmtN(totalRevenue)}</td><td class="r">100%</td></tr><tr class="b" style="border-top:2px solid #e2e8f0"><td>PENGELUARAN</td><td class="r d">${fmtN(totalExpense)}</td><td class="r">100%</td></tr>${sortedCategories.map(([cat, amt]) => `<tr><td style="padding-left:1.5rem">${cat}</td><td class="r">${fmtN(amt)}</td><td class="r">${totalExpense > 0 ? ((amt / totalExpense) * 100).toFixed(1) : 0}%</td></tr>`).join("")}<tr class="b" style="border-top:2px solid #1e293b"><td>LABA / RUGI BERSIH</td><td class="r ${netProfit >= 0 ? "s" : "d"}">${netProfit >= 0 ? "+" : ""}${fmtN(netProfit)}</td><td></td></tr></tbody></table>`
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
              const bankName =
                allBankAccounts.find(
                  (account) => account._id === item.bankAccountRef,
                )?.bankName || "-";
              return `<tr><td>${bankName}</td><td>${item.date ? new Date(item.date).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</td><td>${item.type}</td><td>${item.description}</td><td class="r ${isIn ? "s" : "d"} b">${isIn ? "+" : "-"}${fmtN(item.amount)}</td><td class="r b">${fmtN(item.balanceAfter)}</td></tr>`;
            })
            .join("")}</tbody></table>`,
    });
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
          <p className="page-subtitle">Laba rugi dan arus kas per periode</p>
        </div>
        <div className="page-actions" style={{ flexWrap: "wrap" }}>
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div className="tabs" style={{ borderBottom: "none", marginBottom: 0 }}>
          <button
            className={`tab ${tab === "pnl" ? "active" : ""}`}
            onClick={() => setTab("pnl")}
          >
            <DollarSign size={14} style={{ marginRight: 4 }} /> Laba Rugi
          </button>
          <button
            className={`tab ${tab === "cashflow" ? "active" : ""}`}
            onClick={() => setTab("cashflow")}
          >
            <Landmark size={14} style={{ marginRight: 4 }} /> Arus Kas
          </button>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
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
            <>
              <button className="btn btn-secondary btn-sm" onClick={prevPeriod}>
                <ChevronLeft size={14} />
              </button>
              <input
                className="form-input"
                style={{ width: 100 }}
                type="number"
                value={year}
                onChange={(event) =>
                  setYear(Number(event.target.value) || now.getFullYear())
                }
              />
              <button className="btn btn-secondary btn-sm" onClick={nextPeriod}>
                <ChevronRight size={14} />
              </button>
            </>
          )}
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {periodLabel}
          </span>
        </div>
      </div>

      {tab === "cashflow" && (
        <div
          className="card"
          style={{ marginBottom: "1rem", background: "var(--color-gray-25)" }}
        >
          <div className="card-body" style={{ padding: "0.9rem 1rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
              Catatan Arus Kas
            </div>
            <div style={{ fontSize: "0.82rem", color: "var(--color-gray-600)" }}>
              Tab ini hanya menampilkan mutasi rekening bank dari{" "}
              <code style={{ margin: "0 0.25rem" }}>bankTransaction</code>.
              Transaksi tunai tanpa rekening tetap masuk ke laba rugi, tetapi
              tidak muncul di arus kas bank.
            </div>
          </div>
        </div>
      )}

      {tab === "pnl" ? (
        <div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "1rem",
              marginBottom: "1.5rem",
            }}
          >
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
                label: "Tagihan Outstanding",
                value: formatCurrency(totalOutstanding),
                note: `Total terbit ${formatCurrency(totalInvoiced)}`,
                color: "var(--color-warning)",
              },
              {
                label: "Bon Belum Settle",
                value: formatCurrency(openVoucherSpent),
                note: `${openDriverVouchers.length} bon aktif`,
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
              <span className="card-header-title">Bon Supir Belum Settle</span>
            </div>
            <div className="card-body">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.75rem",
                  marginBottom: "1rem",
                }}
              >
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
                    Uang Dicairkan
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
                    Biaya Belum Diposting
                  </div>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      color: "var(--color-danger)",
                    }}
                  >
                    {formatCurrency(openVoucherSpent)}
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
              <div className="table-wrapper" style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 720 }}>
                  <thead>
                    <tr>
                      <th>No. Bon</th>
                      <th>Tanggal</th>
                      <th>Supir</th>
                      <th>Rekening</th>
                      <th style={{ textAlign: "right" }}>Uang</th>
                      <th style={{ textAlign: "right" }}>Terpakai</th>
                      <th style={{ textAlign: "right" }}>Selisih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openDriverVouchers.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          style={{
                            textAlign: "center",
                            padding: "2rem 1rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          Tidak ada bon supir yang masih aktif
                        </td>
                      </tr>
                    ) : (
                      openDriverVouchers.map((item) => (
                        <tr key={item._id}>
                          <td style={{ fontWeight: 600 }}>{item.bonNumber}</td>
                          <td>{formatDate(item.issuedDate)}</td>
                          <td>{item.driverName || "-"}</td>
                          <td>{item.issueBankName || "-"}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>
                            {formatCurrency(item.cashGiven)}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {formatCurrency(item.totalSpent)}
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
                      ))
                    )}
                  </tbody>
                </table>
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
                    <span>Pembayaran Nota ({filteredPayments.length}x)</span>
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
            {bankAccounts.map((account) => {
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
            <div className="table-wrapper" style={{ overflowX: "auto" }}>
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
                      const bankName =
                        allBankAccounts.find(
                          (account) => account._id === item.bankAccountRef,
                        )?.bankName || "-";
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
          </div>
        </div>
      )}
    </div>
  );
}
