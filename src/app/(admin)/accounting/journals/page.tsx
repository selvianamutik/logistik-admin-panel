"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";

import FormattedNumberInput from "@/components/FormattedNumberInput";
import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import { formatAccountingCurrency } from "@/lib/accounting-reports";
import { getBusinessDateValue } from "@/lib/business-date";
import { hasPermission } from "@/lib/rbac";
import type { ChartOfAccount, JournalEntry, JournalLine } from "@/lib/types";
import { useApp, useToast } from "../../layout";

type JournalStatusFilter = "POSTED" | "VOID" | "ALL";

type DraftLine = {
  id: string;
  accountRef: string;
  debit: number;
  credit: number;
  memo: string;
};

function createDraftLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    accountRef: "",
    debit: 0,
    credit: 0,
    memo: "",
  };
}

const WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS = new Set([
  "cash_on_hand",
  "bank",
  "accounts_receivable",
  "accounts_payable",
  "inventory",
  "driver_advance",
  "customer_deposit",
]);

function isWorkflowControlAccount(account?: ChartOfAccount) {
  return Boolean(account?.systemKey && WORKFLOW_CONTROL_ACCOUNT_SYSTEM_KEYS.has(account.systemKey));
}

export default function JournalEntriesPage() {
  const { user } = useApp();
  const { addToast } = useToast();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<JournalStatusFilter>("POSTED");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    entryDate: getBusinessDateValue(),
    sourceNumber: "",
    memo: "",
    lines: [createDraftLine(), createDraftLine()],
  });

  const canCreateManualJournal = user ? hasPermission(user.role, "reports", "create") : false;
  const canVoidManualJournal = user ? hasPermission(user.role, "reports", "update") : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entryRows, lineRows, accountRows] = await Promise.all([
        fetchAllAdminCollectionData<JournalEntry>(
          "/api/data?entity=journal-entries&sortField=entryDate&sortDir=desc",
          "Gagal memuat jurnal",
        ),
        fetchAllAdminCollectionData<JournalLine>(
          "/api/data?entity=journal-lines&sortField=lineNumber&sortDir=asc",
          "Gagal memuat detail jurnal",
        ),
        fetchAllAdminCollectionData<ChartOfAccount>(
          "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
          "Gagal memuat akun perkiraan",
        ),
      ]);
      setEntries(entryRows || []);
      setLines(lineRows || []);
      setAccounts((accountRows || []).filter(account => account.active !== false));
    } catch (error) {
      addToast("error", error instanceof Error ? error.message : "Gagal memuat jurnal");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const accountById = useMemo(() => new Map(accounts.map(account => [account._id, account])), [accounts]);
  const journalAccountOptions = useMemo(
    () => accounts.filter(account => !isWorkflowControlAccount(account)),
    [accounts],
  );

  const linesByEntry = useMemo(() => {
    const grouped = new Map<string, JournalLine[]>();
    for (const line of lines) {
      const next = grouped.get(line.journalEntryRef) || [];
      next.push(line);
      grouped.set(line.journalEntryRef, next);
    }
    for (const group of grouped.values()) {
      group.sort((left, right) => left.lineNumber - right.lineNumber);
    }
    return grouped;
  }, [lines]);

  const postedCount = useMemo(() => entries.filter(entry => entry.status !== "VOID").length, [entries]);
  const voidCount = useMemo(() => entries.filter(entry => entry.status === "VOID").length, [entries]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return entries.filter(entry => {
      if (statusFilter === "POSTED" && entry.status === "VOID") return false;
      if (statusFilter === "VOID" && entry.status !== "VOID") return false;
      if (!keyword) return true;
      return `${entry.entryNumber} ${entry.memo} ${entry.sourceType || ""} ${entry.sourceNumber || ""} ${entry.sourceLabel || ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [entries, search, statusFilter]);

  const draftTotals = useMemo(() => {
    const debit = form.lines.reduce((sum, line) => sum + Math.max(Number(line.debit || 0), 0), 0);
    const credit = form.lines.reduce((sum, line) => sum + Math.max(Number(line.credit || 0), 0), 0);
    return { debit, credit, gap: debit - credit };
  }, [form.lines]);

  const draftLineError = useMemo(() => {
    const activeLines = form.lines.filter(line => line.accountRef || line.debit > 0 || line.credit > 0);
    if (activeLines.length < 2) return "Minimal isi 2 baris akun.";
    if (activeLines.some(line => !line.accountRef)) return "Semua baris aktif wajib memilih akun.";
    if (activeLines.some(line => line.debit > 0 && line.credit > 0)) return "Satu baris hanya boleh debit atau kredit.";
    if (activeLines.some(line => line.debit <= 0 && line.credit <= 0)) return "Semua baris aktif wajib punya nominal.";
    if (activeLines.some(line => isWorkflowControlAccount(accountById.get(line.accountRef)))) {
      return "Akun kontrol workflow tidak bisa dipakai di jurnal manual.";
    }
    return "";
  }, [accountById, form.lines]);
  const shouldShowDraftLineError = Boolean(
    draftLineError &&
    (
      form.memo.trim() ||
      form.sourceNumber.trim() ||
      form.lines.some(line => line.accountRef || line.debit > 0 || line.credit > 0)
    )
  );

  const resetForm = () => {
    setForm({
      entryDate: getBusinessDateValue(),
      sourceNumber: "",
      memo: "",
      lines: [createDraftLine(), createDraftLine()],
    });
  };

  const updateDraftLine = (lineId: string, updates: Partial<DraftLine>) => {
    setForm(current => ({
      ...current,
      lines: current.lines.map(line => line.id === lineId ? { ...line, ...updates } : line),
    }));
  };

  const removeDraftLine = (lineId: string) => {
    setForm(current => ({
      ...current,
      lines: current.lines.length <= 2 ? current.lines : current.lines.filter(line => line.id !== lineId),
    }));
  };

  const handleSave = async () => {
    if (!form.memo.trim()) {
      addToast("error", "Memo jurnal wajib diisi");
      return;
    }
    if (draftLineError) {
      addToast("error", draftLineError);
      return;
    }
    if (Math.abs(draftTotals.gap) > 0.01 || draftTotals.debit <= 0 || draftTotals.credit <= 0) {
      addToast("error", "Jurnal harus balance");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "journal-entries",
          action: "create-manual",
          data: {
            entryDate: form.entryDate,
            sourceNumber: form.sourceNumber,
            memo: form.memo,
            lines: form.lines.map(line => ({
              accountRef: line.accountRef,
              debit: line.debit,
              credit: line.credit,
              memo: line.memo,
            })),
          },
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        addToast("error", payload.error || "Gagal membuat jurnal");
        return;
      }

      addToast("success", "Jurnal manual dibuat");
      setShowModal(false);
      resetForm();
      await load();
    } catch {
      addToast("error", "Gagal membuat jurnal");
    } finally {
      setSaving(false);
    }
  };

  const handleVoidManualJournal = async (entry: JournalEntry) => {
    if (!window.confirm(`Batalkan jurnal manual ${entry.entryNumber}? Jurnal tidak dihapus, hanya dibatalkan dari perhitungan laporan.`)) {
      return;
    }
    setVoidingId(entry._id);
    try {
      const res = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity: "journal-entries",
          action: "void-manual",
          data: { id: entry._id },
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        addToast("error", payload.error || "Gagal membatalkan jurnal");
        return;
      }
      addToast("success", "Jurnal manual dibatalkan");
      await load();
    } catch {
      addToast("error", "Gagal membatalkan jurnal");
    } finally {
      setVoidingId(null);
    }
  };

  const canSubmit = form.memo.trim() && !draftLineError && Math.abs(draftTotals.gap) <= 0.01 && draftTotals.debit > 0 && draftTotals.credit > 0;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Jurnal Umum</h1>
        </div>
        <div className="page-actions">
          {canCreateManualJournal && (
            <button className="btn btn-primary" onClick={() => { resetForm(); setShowModal(true); }}>
              <Plus size={18} /> Tambah Jurnal
            </button>
          )}
        </div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left accounting-filter-toolbar">
            <label className="table-search accounting-search">
              <Search className="table-search-icon" />
              <input
                className="form-input"
                style={{ paddingLeft: "2.5rem" }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari nomor jurnal, memo, sumber..."
              />
            </label>
            <select
              className="form-select accounting-filter"
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as JournalStatusFilter)}
            >
              <option value="POSTED">Posted ({postedCount})</option>
              <option value="VOID">Dibatalkan ({voidCount})</option>
              <option value="ALL">Semua Jurnal ({entries.length})</option>
            </select>
          </div>
        </div>

        <div>
          {filtered.map(entry => {
            const entryLines = linesByEntry.get(entry._id) || [];
            const isVoid = entry.status === "VOID";
            const isManual = entry.sourceType === "MANUAL_JOURNAL";
            return (
              <article
                key={entry._id}
                style={{
                  padding: "1.25rem",
                  borderTop: "1px solid var(--color-gray-100)",
                  opacity: isVoid ? 0.72 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <p style={{ fontWeight: 700, color: "var(--color-gray-900)" }}>{entry.entryNumber}</p>
                      <span className={`badge badge-${isVoid ? "danger" : "success"}`}>
                        {isVoid ? "Dibatalkan" : "Posted"}
                      </span>
                      {isManual && <span className="badge badge-info">Manual</span>}
                    </div>
                    <p style={{ fontSize: "0.875rem", color: "var(--color-gray-500)" }}>
                      {entry.entryDate} | {entry.memo}
                    </p>
                    {entry.sourceNumber && (
                      <p style={{ fontSize: "0.8125rem", color: "var(--color-gray-500)" }}>
                        Ref: {entry.sourceNumber}
                      </p>
                    )}
                    {isVoid && entry.voidedByName && (
                      <p style={{ fontSize: "0.8125rem", color: "var(--color-danger)", marginTop: "0.25rem" }}>
                        Dibatalkan oleh {entry.voidedByName}{entry.voidedAt ? ` pada ${entry.voidedAt.slice(0, 10)}` : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
                    <div style={{ fontSize: "0.875rem", fontWeight: 700, color: isVoid ? "var(--color-gray-500)" : "var(--color-gray-700)" }}>
                      Debit {formatAccountingCurrency(entry.totalDebit)} | Kredit {formatAccountingCurrency(entry.totalCredit)}
                    </div>
                    {canVoidManualJournal && isManual && !isVoid && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleVoidManualJournal(entry)}
                        disabled={voidingId === entry._id}
                      >
                        <RotateCcw size={14} /> {voidingId === entry._id ? "Memproses..." : "Batalkan"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="table-wrapper table-desktop-only" style={{ marginTop: "1rem" }}>
                  <table style={{ minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th>Akun</th>
                        <th>Memo</th>
                        <th style={{ textAlign: "right" }}>Debit</th>
                        <th style={{ textAlign: "right" }}>Kredit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entryLines.map(line => (
                        <tr key={line._id} style={isVoid ? { color: "var(--color-gray-500)" } : undefined}>
                          <td>{line.accountCode} - {line.accountName}</td>
                          <td>{line.memo || "-"}</td>
                          <td style={{ textAlign: "right" }}>{line.debit ? formatAccountingCurrency(line.debit) : "-"}</td>
                          <td style={{ textAlign: "right" }}>{line.credit ? formatAccountingCurrency(line.credit) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-record-list" style={{ marginTop: "1rem" }}>
                  {entryLines.map(line => (
                    <div key={line._id} className="mobile-record-card" style={isVoid ? { color: "var(--color-gray-500)" } : undefined}>
                      <div className="mobile-record-kv">
                        <span className="mobile-record-label">Akun</span>
                        <span className="mobile-record-value">{line.accountCode} - {line.accountName}</span>
                      </div>
                      <div className="mobile-record-meta">
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Debit</span>
                          <span className="mobile-record-value">{line.debit ? formatAccountingCurrency(line.debit) : "-"}</span>
                        </div>
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Kredit</span>
                          <span className="mobile-record-value">{line.credit ? formatAccountingCurrency(line.credit) : "-"}</span>
                        </div>
                      </div>
                      {line.memo && (
                        <div className="mobile-record-kv">
                          <span className="mobile-record-label">Memo</span>
                          <span className="mobile-record-value">{line.memo}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada jurnal.</div>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
          <div className="modal" onClick={event => event.stopPropagation()} style={{ maxWidth: 920 }}>
            <div className="modal-header">
              <h3 className="modal-title">Tambah Jurnal Manual</h3>
              <button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tanggal <span className="required">*</span></label>
                  <input
                    className="form-input"
                    type="date"
                    value={form.entryDate}
                    onChange={event => setForm(current => ({ ...current, entryDate: event.target.value }))}
                    disabled={saving}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">No. Referensi</label>
                  <input
                    className="form-input"
                    value={form.sourceNumber}
                    onChange={event => setForm(current => ({ ...current, sourceNumber: event.target.value }))}
                    disabled={saving}
                    placeholder="Opsional"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Memo <span className="required">*</span></label>
                <input
                  className="form-input"
                  value={form.memo}
                  onChange={event => setForm(current => ({ ...current, memo: event.target.value }))}
                  disabled={saving}
                  placeholder="Mis. Penyesuaian saldo awal hutang biaya"
                />
              </div>

              <div style={{ display: "grid", gap: "0.75rem" }}>
                {form.lines.map((line, index) => {
                  const account = accountById.get(line.accountRef);
                  return (
                    <div key={line.id} className="card" style={{ padding: "1rem", boxShadow: "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", marginBottom: "0.75rem" }}>
                        <strong>Baris {index + 1}</strong>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => removeDraftLine(line.id)}
                          disabled={saving || form.lines.length <= 2}
                          type="button"
                        >
                          <Trash2 size={14} /> Hapus
                        </button>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label className="form-label">Akun <span className="required">*</span></label>
                          <select
                            className="form-select"
                            value={line.accountRef}
                            onChange={event => updateDraftLine(line.id, { accountRef: event.target.value })}
                            disabled={saving}
                          >
                            <option value="">Pilih akun</option>
                            {journalAccountOptions.map(item => (
                              <option key={item._id} value={item._id}>{item.code} - {item.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Debit</label>
                          <FormattedNumberInput
                            allowDecimal={false}
                            value={line.debit}
                            disabled={saving}
                            onValueChange={value => updateDraftLine(line.id, { debit: value, credit: value > 0 ? 0 : line.credit })}
                            placeholder="0"
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Kredit</label>
                          <FormattedNumberInput
                            allowDecimal={false}
                            value={line.credit}
                            disabled={saving}
                            onValueChange={value => updateDraftLine(line.id, { credit: value, debit: value > 0 ? 0 : line.debit })}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Memo Baris</label>
                        <input
                          className="form-input"
                          value={line.memo}
                          onChange={event => updateDraftLine(line.id, { memo: event.target.value })}
                          disabled={saving}
                          placeholder={account ? `${account.code} - ${account.name}` : "Opsional"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setForm(current => ({ ...current, lines: [...current.lines, createDraftLine()] }))}
                  disabled={saving}
                >
                  <Plus size={16} /> Tambah Baris
                </button>
                <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", fontWeight: 700 }}>
                  <span>Debit {formatAccountingCurrency(draftTotals.debit)}</span>
                  <span>Kredit {formatAccountingCurrency(draftTotals.credit)}</span>
                  <span style={{ color: Math.abs(draftTotals.gap) <= 0.01 ? "var(--color-success)" : "var(--color-danger)" }}>
                    Selisih {formatAccountingCurrency(Math.abs(draftTotals.gap))}
                  </span>
                </div>
              </div>
              {shouldShowDraftLineError && (
                <p style={{ marginTop: "0.75rem", color: "var(--color-danger)", fontWeight: 700 }}>
                  {draftLineError}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !canSubmit}>
                <Save size={16} /> {saving ? "Menyimpan..." : "Simpan Jurnal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
