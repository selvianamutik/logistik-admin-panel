"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  Edit,
  Eye,
  FileDown,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import AppPagination from "@/components/AppPagination";
import CurrencyInput from "@/components/CurrencyInput";
import { exportToExcel } from "@/lib/export";
import { openBrandedPrint } from "@/lib/print";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import type { BankAccount, CompanyProfile } from "@/lib/types";
import { useToast } from "../layout";

const BANK_PRESETS: Record<
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

function isCashAccount(account: Pick<BankAccount, "accountType" | "systemKey">) {
  return (
    account.accountType === "CASH" || account.systemKey === "cash-on-hand"
  );
}

function getBankPreset(bankName: string) {
  const key = Object.keys(BANK_PRESETS).find(
    (candidate) =>
      candidate !== "OTHER" &&
      bankName.toUpperCase().includes(candidate.toUpperCase()),
  );
  return BANK_PRESETS[key || "OTHER"];
}

function getAccountNextAction(account: BankAccount) {
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

function BankLogo({ name }: { name: string }) {
  const preset = getBankPreset(name);
  if (preset.logo) {
    return (
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "0.5rem",
          background: "#fff",
          border: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: 4,
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preset.logo}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: "0.5rem",
        background: preset.gradient,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {name.slice(0, 3).toUpperCase()}
    </div>
  );
}

export default function BankAccountsPage() {
  const { addToast } = useToast();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [totalBalance, setTotalBalance] = useState(0);
  const [totalInitial, setTotalInitial] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankBalance, setBankBalance] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
    null,
  );
  const [editAccount, setEditAccount] = useState<BankAccount | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [form, setForm] = useState({
    bankName: "",
    accountNumber: "",
    accountHolder: "",
    initialBalance: 0,
    notes: "",
  });
  const [transferForm, setTransferForm] = useState({
    fromAccountRef: "",
    toAccountRef: "",
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(n);
  const fmtN = (n: number) => new Intl.NumberFormat("id-ID").format(n);

  const buildAccountsQuery = useCallback(
    (targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) =>
      new URLSearchParams({
        entity: "bank-accounts",
        page: String(targetPage),
        pageSize: String(targetPageSize),
        sortField: "bankName",
        sortDir: "asc",
        filter: JSON.stringify({ active: true }),
      }).toString(),
    [page],
  );

  const fetchAllAccounts = useCallback(async () => {
    const pageSize = 200;
    let currentPage = 1;
    let total = 0;
    const allItems: BankAccount[] = [];

    do {
      const res = await fetch(`/api/data?${buildAccountsQuery(currentPage, pageSize)}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Gagal memuat rekening bank");
      }
      const nextItems = (payload.data || []) as BankAccount[];
      total = payload.meta?.total || nextItems.length;
      allItems.push(...nextItems);
      if (nextItems.length === 0) break;
      currentPage += 1;
    } while (allItems.length < total);

    return allItems.sort((a, b) => {
      const aCash = isCashAccount(a) ? 0 : 1;
      const bCash = isCashAccount(b) ? 0 : 1;
      if (aCash !== bCash) return aCash - bCash;
      return (a.bankName || "").localeCompare(b.bankName || "");
    });
  }, [buildAccountsQuery]);

  const loadAccounts = useCallback(async () => {
    const [listRes, summaryRes] = await Promise.all([
      fetch(`/api/data?${buildAccountsQuery()}`),
      fetch("/api/data?entity=bank-accounts-summary"),
    ]);
    const [listPayload, summaryPayload] = await Promise.all([
      listRes.json(),
      summaryRes.json(),
    ]);
    if (!listRes.ok) {
      throw new Error(listPayload.error || "Gagal memuat rekening bank");
    }
    if (!summaryRes.ok) {
      throw new Error(summaryPayload.error || "Gagal memuat ringkasan rekening");
    }
    const nextAccounts = ((listPayload.data || []) as BankAccount[]).sort((a, b) => {
      const aCash = isCashAccount(a) ? 0 : 1;
      const bCash = isCashAccount(b) ? 0 : 1;
      if (aCash !== bCash) return aCash - bCash;
      return (a.bankName || "").localeCompare(b.bankName || "");
    });
    setAccounts(nextAccounts);
    setTotalAccounts(listPayload.meta?.total || 0);
    setTotalBalance(summaryPayload.data?.totalBalance || 0);
    setTotalInitial(summaryPayload.data?.totalInitial || 0);
    setCashBalance(summaryPayload.data?.cashBalance || 0);
    setBankBalance(summaryPayload.data?.bankBalance || 0);
  }, [buildAccountsQuery]);

  useEffect(() => {
    async function load() {
      try {
        const loadCompany = async () => {
          const res = await fetch("/api/data?entity=company");
          const payload = await res.json();
          if (!res.ok) {
            throw new Error(
              payload.error || "Gagal memuat profil perusahaan",
            );
          }
          return payload.data || null;
        };
        const [accountsRes, companyRes] = await Promise.all([
          loadAccounts(),
          loadCompany(),
        ]);
        void accountsRes;
        setCompany(companyRes);
      } catch (error) {
        addToast(
          "error",
          error instanceof Error ? error.message : "Gagal memuat rekening bank",
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [addToast, loadAccounts]);

  const openNew = () => {
    setEditAccount(null);
    setForm({
      bankName: "",
      accountNumber: "",
      accountHolder: "",
      initialBalance: 0,
      notes: "",
    });
    setShowModal(true);
  };

  const openEdit = (account: BankAccount) => {
    setEditAccount(account);
    setForm({
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountHolder: account.accountHolder,
      initialBalance: account.initialBalance,
      notes: account.notes || "",
    });
    setShowModal(true);
  };

  const refreshAccounts = async () => {
    try {
      await loadAccounts();
    } catch (error) {
      addToast(
        "error",
        error instanceof Error ? error.message : "Gagal memuat rekening bank",
      );
    }
  };

  const handleSave = async () => {
    if (!form.bankName || !form.accountNumber) {
      addToast("error", "Nama bank dan nomor rekening wajib");
      return;
    }

    const body = editAccount
      ? {
          entity: "bank-accounts",
          action: "update",
          data: {
            id: editAccount._id,
            updates: {
              bankName: form.bankName,
              accountNumber: form.accountNumber,
              accountHolder: form.accountHolder,
              notes: form.notes,
            },
          },
        }
      : { entity: "bank-accounts", data: { ...form, active: true } };

    setSavingAccount(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast(
          "error",
          result.error ||
            (editAccount
              ? "Gagal memperbarui rekening"
              : "Gagal menambahkan rekening"),
        );
        return;
      }

      setShowModal(false);
      addToast(
        "success",
        editAccount ? "Rekening diperbarui" : "Rekening ditambahkan",
      );
      await refreshAccounts();
    } catch {
      addToast(
        "error",
        editAccount ? "Gagal memperbarui rekening" : "Gagal menambahkan rekening",
      );
    } finally {
      setSavingAccount(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingAccountId(id);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "bank-accounts",
          action: "update",
          data: { id, updates: { active: false } },
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast("error", result.error || "Gagal menonaktifkan rekening");
        return;
      }

      setDeleteConfirm(null);
      addToast("success", "Rekening dinonaktifkan");
      await refreshAccounts();
    } catch {
      addToast("error", "Gagal menonaktifkan rekening");
    } finally {
      setDeletingAccountId((current) => (current === id ? null : current));
    }
  };

  const handleTransfer = async () => {
    if (
      !transferForm.fromAccountRef ||
      !transferForm.toAccountRef ||
      transferForm.amount <= 0
    ) {
      addToast("error", "Lengkapi data transfer");
      return;
    }
    if (transferForm.fromAccountRef === transferForm.toAccountRef) {
      addToast("error", "Rekening sumber dan tujuan tidak boleh sama");
      return;
    }

    setTransferring(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "bank-transactions",
          action: "transfer",
          data: transferForm,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        addToast("error", result.error || "Transfer gagal");
        return;
      }

      setShowTransfer(false);
      setTransferForm({
        fromAccountRef: "",
        toAccountRef: "",
        amount: 0,
        date: new Date().toISOString().slice(0, 10),
      });
      addToast("success", "Transfer berhasil");
      await refreshAccounts();
    } catch {
      addToast("error", "Transfer gagal");
    } finally {
      setTransferring(false);
    }
  };

  const handleExportExcel = async () => {
    const printableAccounts = await fetchAllAccounts();
    const rows = printableAccounts.map((account) => ({
      accountType: isCashAccount(account) ? "Kas Tunai" : "Bank",
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountHolder: account.accountHolder,
      initialBalance: account.initialBalance,
      currentBalance: account.currentBalance,
    }));
    exportToExcel(
      rows as unknown as Record<string, unknown>[],
      [
        { header: "Tipe", key: "accountType", width: 12 },
        { header: "Bank", key: "bankName", width: 18 },
        { header: "No. Rekening", key: "accountNumber", width: 20 },
        { header: "Atas Nama", key: "accountHolder", width: 25 },
        { header: "Saldo Awal", key: "initialBalance", width: 18 },
        { header: "Saldo Saat Ini", key: "currentBalance", width: 18 },
      ],
      `rekening-dan-kas-${new Date().toISOString().split("T")[0]}`,
      "Rekening dan Kas",
    );
    addToast("success", "Excel berhasil di-download");
  };

  const handleBrandedPrint = async () => {
    const printableAccounts = await fetchAllAccounts();
    const change = totalBalance - totalInitial;
    openBrandedPrint({
      title: "Laporan Rekening dan Kas",
      company,
      bodyHtml: `
                <div class="stats-row">
                    <div class="stat-box"><div class="stat-label">Total Saldo</div><div class="stat-value">${fmtN(totalBalance)}</div></div>
                    <div class="stat-box"><div class="stat-label">Saldo Awal</div><div class="stat-value">${fmtN(totalInitial)}</div></div>
                    <div class="stat-box"><div class="stat-label">Perubahan</div><div class="stat-value ${change >= 0 ? "s" : "d"}">${change >= 0 ? "+" : ""}${fmtN(change)}</div></div>
                </div>
                <table>
                    <thead><tr><th>Tipe</th><th>Nama</th><th>No. Referensi</th><th>Atas Nama</th><th class="r">Saldo Awal</th><th class="r">Saldo Saat Ini</th><th class="r">Perubahan</th></tr></thead>
                    <tbody>
                        ${printableAccounts
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
            `,
    });
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Rekening &amp; Kas</h1>
          <p className="page-subtitle">
            Pantau posisi uang operasional di rekening bank dan kas tunai.
          </p>
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
          <button
            className="btn btn-secondary"
            onClick={() => setShowTransfer(true)}
          >
            <ArrowRightLeft size={16} /> Transfer
          </button>
          <button className="btn btn-primary" onClick={openNew}>
            <Plus size={18} /> Tambah Rekening
          </button>
        </div>
      </div>

      <div className="responsive-stat-grid" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Total Saldo
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {fmt(totalBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Saldo Bank
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {fmt(bankBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Saldo Kas Tunai
            </div>
            <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {fmt(cashBalance)}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div
              className="text-muted"
              style={{ fontSize: "0.75rem", textTransform: "uppercase" }}
            >
              Perubahan dari Saldo Awal
            </div>
            <div
              style={{
                fontSize: "1.6rem",
                fontWeight: 700,
                color:
                  totalBalance - totalInitial >= 0
                    ? "var(--success)"
                    : "var(--danger)",
              }}
            >
              {totalBalance - totalInitial >= 0 ? "+" : ""}
              {fmt(totalBalance - totalInitial)}
            </div>
          </div>
        </div>
      </div>

      <div
        className="card"
        style={{ marginBottom: "1.5rem", background: "var(--color-gray-25)" }}
      >
        <div className="card-body" style={{ padding: "0.9rem 1rem" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>
            Ringkasan Kas &amp; Bank
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--color-gray-600)" }}>
            Halaman ini menunjukkan posisi uang yang benar-benar tercatat di rekening bank dan kas tunai. Transfer antar rekening tidak mengubah total uang, hanya memindahkan posisinya.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "1rem",
        }}
      >
        {loading
          ? [1, 2, 3].map((i) => (
              <div key={i} className="card">
                <div className="card-body">
                  <div className="skeleton skeleton-title" />
                  <div className="skeleton skeleton-text" />
                  <div className="skeleton skeleton-text" />
                </div>
              </div>
            ))
          : accounts.map((account) => {
              const preset = isCashAccount(account)
                ? BANK_PRESETS.CASH
                : getBankPreset(account.bankName);
              const diff =
                (account.currentBalance || 0) - (account.initialBalance || 0);
              const systemCash = isCashAccount(account);
              return (
                <div
                  key={account._id}
                  className="card"
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ height: 4, background: preset.gradient }} />
                  <div className="card-body" style={{ padding: "1.25rem" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        marginBottom: "1rem",
                      }}
                    >
                      <BankLogo name={account.bankName} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            display: "flex",
                            alignItems: "center",
                            gap: "0.4rem",
                            flexWrap: "wrap",
                          }}
                        >
                          {account.bankName}
                          {systemCash && (
                            <span className="badge badge-success">
                              Kas Tunai
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted)",
                            fontFamily: "var(--font-mono, monospace)",
                          }}
                        >
                          {account.accountNumber}
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "var(--text-muted)",
                        marginBottom: "0.5rem",
                      }}
                    >
                      a.n. {account.accountHolder}
                    </div>
                    <div
                      style={{
                        fontSize: "0.78rem",
                        fontWeight: 600,
                        marginBottom: "0.75rem",
                        color: "var(--color-primary)",
                      }}
                    >
                      Tindak lanjut: {getAccountNextAction(account)}
                    </div>
                    <div
                      style={{
                        background: "var(--bg-secondary, #f8fafc)",
                        borderRadius: "0.5rem",
                        padding: "0.75rem 1rem",
                        marginBottom: "0.75rem",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          marginBottom: "0.2rem",
                        }}
                      >
                        Saldo
                      </div>
                      <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>
                        {fmt(account.currentBalance || 0)}
                      </div>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          color: diff >= 0 ? "var(--success)" : "var(--danger)",
                        }}
                      >
                        {diff >= 0 ? "+" : ""}
                        {fmt(diff)} dari saldo awal
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <Link
                        href={`/bank-accounts/${account._id}`}
                        className="btn btn-sm btn-secondary"
                        style={{ flex: 1, justifyContent: "center" }}
                      >
                        <Eye size={13} /> Detail
                      </Link>
                      {!systemCash && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => openEdit(account)}
                        >
                          <Edit size={13} />
                        </button>
                      )}
                      {!systemCash && (
                        <button
                          className="btn btn-sm"
                          style={{
                            color: "var(--danger)",
                            border: "1px solid var(--danger)",
                            background: "transparent",
                          }}
                          onClick={() => setDeleteConfirm(account._id)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        {!loading && (
          <div
            className="card"
            style={{
              border: "2px dashed var(--border-color)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 200,
            }}
            onClick={openNew}
          >
            <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
              <Plus
                size={32}
                style={{ marginBottom: "0.5rem", opacity: 0.5 }}
              />
                <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                Tambah Rekening Bank
                </div>
            </div>
          </div>
        )}
      </div>
      {totalAccounts > 0 && (
        <AppPagination
          page={page}
          pageSize={DEFAULT_PAGE_SIZE}
          totalItems={totalAccounts}
          onPageChange={setPage}
          info={({ startIndex, endIndex, totalItems }) => (
            <>Menampilkan {startIndex}-{endIndex} dari {totalItems} rekening / kas</>
          )}
        />
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!savingAccount) setShowModal(false); }}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">
                {editAccount ? "Edit Rekening" : "Tambah Rekening Baru"}
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowModal(false)}
                disabled={savingAccount}
              >
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Jenis Bank <span className="required">*</span>
                </label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: "0.4rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  {Object.entries(BANK_PRESETS)
                    .filter(([key]) => key !== "OTHER" && key !== "CASH")
                    .map(([key, preset]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() =>
                          setForm({ ...form, bankName: preset.label })
                        }
                        style={{
                          padding: "0.45rem 0.25rem",
                          borderRadius: "0.5rem",
                          border:
                            form.bankName === preset.label
                              ? `2px solid ${preset.color}`
                              : "1px solid var(--border-color)",
                          background:
                            form.bankName === preset.label
                              ? `${preset.color}10`
                              : "var(--bg-primary)",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.25rem",
                          fontSize: "0.65rem",
                          fontWeight: 600,
                        }}
                      >
                        <BankLogo name={key} />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: "100%",
                          }}
                        >
                          {preset.label}
                        </span>
                      </button>
                    ))}
                </div>
                <input
                  className="form-input"
                  placeholder="Atau ketik nama bank manual..."
                  value={form.bankName}
                  onChange={(event) =>
                    setForm({ ...form, bankName: event.target.value })
                  }
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Nomor Rekening <span className="required">*</span>
                  </label>
                  <input
                    className="form-input"
                    value={form.accountNumber}
                    onChange={(event) =>
                      setForm({ ...form, accountNumber: event.target.value })
                    }
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Atas Nama</label>
                  <input
                    className="form-input"
                    value={form.accountHolder}
                    onChange={(event) =>
                      setForm({ ...form, accountHolder: event.target.value })
                    }
                  />
                </div>
              </div>
              {!editAccount && (
                <div className="form-group">
                  <label className="form-label">Saldo Awal (Rp)</label>
                  <CurrencyInput
                    value={form.initialBalance}
                    onValueChange={(value) =>
                      setForm({
                        ...form,
                        initialBalance: value,
                      })
                    }
                    placeholder="Ketik saldo awal"
                  />
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Catatan</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={form.notes}
                  onChange={(event) =>
                    setForm({ ...form, notes: event.target.value })
                  }
                  placeholder="Catatan opsional..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
                disabled={savingAccount}
              >
                Batal
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={savingAccount}
              >
                {savingAccount ? "Menyimpan..." : "Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransfer && (
        <div className="modal-overlay" onClick={() => { if (!transferring) setShowTransfer(false); }}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 500 }}
          >
            <div className="modal-header">
              <h3
                className="modal-title"
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                <ArrowRightLeft size={18} /> Transfer Antar Rekening
              </h3>
              <button
                className="modal-close"
                onClick={() => setShowTransfer(false)}
                disabled={transferring}
              >
                x
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  Dari Rekening <span className="required">*</span>
                </label>
                <select
                  className="form-select"
                  value={transferForm.fromAccountRef}
                  disabled={transferring}
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      fromAccountRef: event.target.value,
                    })
                  }
                >
                  <option value="">-- Pilih sumber --</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account._id}>
                      {account.bankName} - {account.accountNumber} (
                      {fmt(account.currentBalance || 0)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">
                  Ke Rekening <span className="required">*</span>
                </label>
                <select
                  className="form-select"
                  value={transferForm.toAccountRef}
                  disabled={transferring}
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      toAccountRef: event.target.value,
                    })
                  }
                >
                  <option value="">-- Pilih tujuan --</option>
                  {accounts
                    .filter(
                      (account) => account._id !== transferForm.fromAccountRef,
                    )
                    .map((account) => (
                      <option key={account._id} value={account._id}>
                        {account.bankName} - {account.accountNumber} (
                        {fmt(account.currentBalance || 0)})
                      </option>
                    ))}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">
                    Jumlah (Rp) <span className="required">*</span>
                  </label>
                  <CurrencyInput
                    value={transferForm.amount}
                    disabled={transferring}
                    onValueChange={(value) =>
                      setTransferForm({
                        ...transferForm,
                        amount: value,
                      })
                    }
                    placeholder="Ketik nominal transfer"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tanggal</label>
                  <input
                    className="form-input"
                    type="date"
                    value={transferForm.date}
                    disabled={transferring}
                    onChange={(event) =>
                      setTransferForm({
                        ...transferForm,
                        date: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowTransfer(false)}
                  disabled={transferring}
                >
                Batal
              </button>
              <button className="btn btn-primary" onClick={handleTransfer} disabled={transferring}>
                <ArrowRightLeft size={16} /> {transferring ? "Memproses..." : "Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 400 }}
          >
            <div className="modal-header">
              <h3 className="modal-title">Hapus Rekening?</h3>
            </div>
            <div className="modal-body">
              <p>
                Rekening akan dinonaktifkan. Data transaksi tetap tersimpan.
              </p>
            </div>
            <div className="modal-footer">
                <button
                  className="btn btn-secondary"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deletingAccountId === deleteConfirm}
                >
                  Batal
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleDelete(deleteConfirm)}
                  disabled={deletingAccountId === deleteConfirm}
                >
                  {deletingAccountId === deleteConfirm ? "Menghapus..." : "Hapus"}
                </button>
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
