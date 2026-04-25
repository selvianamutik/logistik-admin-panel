"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import { formatAccountingCurrency } from "@/lib/accounting-reports";
import type { JournalEntry, JournalLine } from "@/lib/types";

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [entryRows, lineRows] = await Promise.all([
          fetchAllAdminCollectionData<JournalEntry>(
            "/api/data?entity=journal-entries&sortField=entryDate&sortDir=desc",
            "Gagal memuat jurnal",
          ),
          fetchAllAdminCollectionData<JournalLine>(
            "/api/data?entity=journal-lines&sortField=lineNumber&sortDir=asc",
            "Gagal memuat detail jurnal",
          ),
        ]);
        setEntries(entryRows || []);
        setLines(lineRows || []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

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

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter(entry =>
      `${entry.entryNumber} ${entry.memo} ${entry.sourceType || ""} ${entry.sourceNumber || ""} ${entry.sourceLabel || ""}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [entries, search]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Jurnal Umum</h1>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <label className="table-search">
            <Search className="table-search-icon" />
            <input
              className="form-input"
              style={{ paddingLeft: "2.5rem" }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari nomor jurnal, memo, sumber..."
            />
          </label>
        </div>

        <div>
          {filtered.map(entry => {
            const entryLines = linesByEntry.get(entry._id) || [];
            return (
              <article key={entry._id} style={{ padding: "1.25rem", borderTop: "1px solid var(--color-gray-100)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                  <div>
                    <p style={{ fontWeight: 700, color: "var(--color-gray-900)" }}>{entry.entryNumber}</p>
                    <p style={{ fontSize: "0.875rem", color: "var(--color-gray-500)" }}>{entry.entryDate} | {entry.memo}</p>
                  </div>
                  <div style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--color-gray-700)" }}>
                    Debit {formatAccountingCurrency(entry.totalDebit)} | Kredit {formatAccountingCurrency(entry.totalCredit)}
                  </div>
                </div>

                <div className="table-wrapper" style={{ marginTop: "1rem" }}>
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
                        <tr key={line._id}>
                          <td>{line.accountCode} - {line.accountName}</td>
                          <td>{line.memo || "-"}</td>
                          <td style={{ textAlign: "right" }}>{line.debit ? formatAccountingCurrency(line.debit) : "-"}</td>
                          <td style={{ textAlign: "right" }}>{line.credit ? formatAccountingCurrency(line.credit) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Belum ada jurnal.</div>
          )}
        </div>
      </div>
    </div>
  );
}
