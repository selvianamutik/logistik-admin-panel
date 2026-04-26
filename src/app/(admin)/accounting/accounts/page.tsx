"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { fetchAllAdminCollectionData } from "@/lib/api/admin-client";
import type { ChartOfAccount } from "@/lib/types";

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const rows = await fetchAllAdminCollectionData<ChartOfAccount>(
          "/api/data?entity=chart-of-accounts&sortField=code&sortDir=asc",
          "Gagal memuat akun perkiraan",
        );
        setAccounts(rows || []);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return accounts;
    return accounts.filter(account =>
      `${account.code} ${account.name} ${account.accountType} ${account.systemKey || ""}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [accounts, search]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Akun Perkiraan</h1>
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
                placeholder="Cari kode, akun, tipe..."
              />
            </label>
          </div>
        </div>

        <div className="table-wrapper table-desktop-only">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama Akun</th>
                <th>Tipe</th>
                <th>Saldo Normal</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(account => (
                <tr key={account._id}>
                  <td style={{ fontWeight: 700 }}>{account.code}</td>
                  <td>{account.name}</td>
                  <td>{account.accountType}</td>
                  <td>{account.normalBalance}</td>
                  <td>
                    <span className={`badge badge-${account.active === false ? "secondary" : "success"}`}>
                      {account.active === false ? "Nonaktif" : "Aktif"}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "2rem 1rem", textAlign: "center", color: "var(--color-gray-500)" }}>Tidak ada akun.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list">
          {filtered.map(account => (
            <article key={account._id} className="mobile-record-card">
              <div>
                <p className="mobile-record-title">{account.code} - {account.name}</p>
                <p className="mobile-record-subtitle">{account.accountType} | {account.normalBalance}</p>
              </div>
              <span className={`badge badge-${account.active === false ? "secondary" : "success"}`}>
                {account.active === false ? "Nonaktif" : "Aktif"}
              </span>
            </article>
          ))}
          {!loading && filtered.length === 0 && (
            <article className="mobile-record-card">
              <p className="mobile-record-title">Tidak ada akun.</p>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
