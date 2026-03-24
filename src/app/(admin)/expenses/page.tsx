'use client';

import { useState, useEffect } from 'react';
import { useToast, useApp } from '../layout';
import { Plus, Search, Wallet, Save, X, FileDown, Printer } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import CurrencyInput from '@/components/CurrencyInput';
import { formatDate, formatCurrency } from '@/lib/utils';
import { exportExpenses } from '@/lib/export';
import { openBrandedPrint, fetchCompanyProfile } from '@/lib/print';
import { DEFAULT_PAGE_SIZE, paginateItems } from '@/lib/pagination';
import type { BankAccount, Expense, ExpenseCategory, Vehicle } from '@/lib/types';

export default function ExpensesPage() {
    const { addToast } = useToast();
    const { user } = useApp();
    const [items, setItems] = useState<Expense[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        categoryRef: '',
        date: new Date().toISOString().split('T')[0],
        amount: 0,
        note: '',
        description: '',
        privacyLevel: 'internal' as 'internal' | 'ownerOnly',
        relatedVehicleRef: '',
        bankAccountRef: '',
        bankAccountName: '',
    });

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data pengeluaran');
            }
            return payload.data as T;
        };

        Promise.all([
            fetchEntity<Expense[]>('/api/data?entity=expenses'),
            fetchEntity<ExpenseCategory[]>('/api/data?entity=expense-categories'),
            fetchEntity<BankAccount[]>('/api/data?entity=bank-accounts'),
            fetchEntity<Vehicle[]>('/api/data?entity=vehicles'),
        ]).then(([expenseRows, categoryRows, accountRows, vehicleRows]) => {
            setItems(expenseRows || []);
            setCategories(categoryRows || []);
            setBankAccounts((accountRows || []).filter(account => account.active !== false));
            setVehicles((vehicleRows || []).filter(vehicle => vehicle.status !== 'SOLD'));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data pengeluaran');
        }).finally(() => {
            setLoading(false);
        });
    }, [addToast]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const isOwner = user?.role === 'OWNER';
    const vehicleMap = new Map(vehicles.map(vehicle => [vehicle._id, vehicle]));
    const filtered = items.filter(e => {
        const query = search.toLowerCase();
        const vehicleLabel =
            e.relatedVehiclePlate ||
            (e.relatedVehicleRef ? vehicleMap.get(e.relatedVehicleRef)?.plateNumber : '') ||
            '';

        return !search ||
            e.note?.toLowerCase().includes(query) ||
            e.description?.toLowerCase().includes(query) ||
            e.categoryName?.toLowerCase().includes(query) ||
            vehicleLabel.toLowerCase().includes(query);
    });
    const paginatedExpenses = paginateItems(filtered, page, DEFAULT_PAGE_SIZE);

    const handleSave = async () => {
        if (!form.categoryRef || !form.amount) { addToast('error', 'Kategori dan nominal wajib'); return; }
        const cat = categories.find(c => c._id === form.categoryRef);
        setSaving(true);
        try {
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'expenses', data: { ...form, categoryName: cat?.name || '' } }) });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal mencatat pengeluaran');
                return;
            }
            setItems(prev => [...prev, d.data]);
            addToast('success', 'Pengeluaran dicatat');
            setShowModal(false);
            setForm({
                categoryRef: '',
                date: new Date().toISOString().split('T')[0],
                amount: 0,
                note: '',
                description: '',
                privacyLevel: 'internal',
                relatedVehicleRef: '',
                bankAccountRef: '',
                bankAccountName: '',
            });
        } catch {
            addToast('error', 'Gagal mencatat pengeluaran');
        } finally {
            setSaving(false);
        }
    };

    // Compute totals per category for breakdown
    const categoryTotals = filtered.reduce<Record<string, number>>((acc, e) => {
        const cat = e.categoryName || 'Lainnya';
        acc[cat] = (acc[cat] || 0) + e.amount;
        return acc;
    }, {});
    const grandTotal = filtered.reduce((s, e) => s + e.amount, 0);
    const avgAmount = filtered.length > 0 ? grandTotal / filtered.length : 0;
    const accountMap = new Map(bankAccounts.map(account => [account._id, account]));

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengeluaran</h1><p className="page-subtitle">Kelola catatan pengeluaran</p></div>
                <div className="page-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => exportExpenses(filtered as unknown as Record<string, unknown>[])}><FileDown size={15} /> Excel</button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = await fetchCompanyProfile();
                        const describeExpense = (expense: Expense) => {
                            const vehicleLabel =
                                expense.relatedVehiclePlate ||
                                (expense.relatedVehicleRef ? vehicleMap.get(expense.relatedVehicleRef)?.plateNumber : '') ||
                                '';
                            const accountLabel = expense.bankAccountName
                                ? `${expense.bankAccountName}${expense.bankAccountNumber || accountMap.get(expense.bankAccountRef || '')?.accountNumber ? ` - ${expense.bankAccountNumber || accountMap.get(expense.bankAccountRef || '')?.accountNumber}` : ''}`
                                : expense.bankAccountRef
                                    ? (() => {
                                        const account = accountMap.get(expense.bankAccountRef);
                                        return account ? `${account.bankName} - ${account.accountNumber}` : '';
                                    })()
                                    : '';
                            const detailLines = [
                                expense.note || expense.description || '-',
                                vehicleLabel ? `Kendaraan: ${vehicleLabel}` : '',
                                accountLabel ? `Via: ${accountLabel}` : '',
                            ].filter(Boolean);
                            return detailLines.join('<br/>');
                        };
                        openBrandedPrint({
                            title: 'Daftar Pengeluaran', company: co, bodyHtml: `
                            <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
                            <tbody>${filtered.map(e => `<tr><td>${formatDate(e.date)}</td><td class="b">${e.categoryName || '-'}</td><td>${describeExpense(e)}</td><td class="r b">${formatCurrency(e.amount)}</td></tr>`).join('')}
                            <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">TOTAL</td><td class="r b">${formatCurrency(filtered.reduce((s, e) => s + e.amount, 0))}</td></tr></tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={18} /> Tambah Pengeluaran</button>
                </div></div>

            {/* KPI Summary */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Total Pengeluaran</div>
                        <div className="kpi-value" style={{ fontSize: '1.1rem', color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Search size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Jumlah Transaksi</div>
                        <div className="kpi-value">{filtered.length}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Wallet size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Rata-rata / Transaksi</div>
                        <div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(Math.round(avgAmount))}</div>
                    </div>
                </div>
            </div>

            {/* Category Breakdown */}
            {!loading && Object.keys(categoryTotals).length > 1 && (
                <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Breakdown per Kategori</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, total]) => (
                            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.75rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{cat}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 700 }}>{formatCurrency(total)}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>({grandTotal > 0 ? Math.round((total / grandTotal) * 100) : 0}%)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{isOwner && <th>Privacy</th>}</tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                paginatedExpenses.totalItems === 0 ? <tr><td colSpan={isOwner ? 5 : 4}><div className="empty-state"><Wallet size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada pengeluaran</div></div></td></tr> :
                                    paginatedExpenses.items.map(e => (
                                        <tr key={e._id}>
                                            <td className="text-muted">{formatDate(e.date)}</td>
                                            <td><span className="badge badge-gray">{e.categoryName}</span></td>
                                            <td>
                                                <div>{e.note || e.description}</div>
                                                {(() => {
                                                    const vehicleLabel =
                                                        e.relatedVehiclePlate ||
                                                        (e.relatedVehicleRef ? vehicleMap.get(e.relatedVehicleRef)?.plateNumber : '') ||
                                                        '';
                                                    return vehicleLabel ? (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                            kendaraan {vehicleLabel}
                                                        </div>
                                                    ) : null;
                                                })()}
                                                {(() => {
                                                    const matchedAccount = e.bankAccountRef ? accountMap.get(e.bankAccountRef) : undefined;
                                                    const accountLabel = e.bankAccountName
                                                        ? `${e.bankAccountName}${e.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${e.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`
                                                        : matchedAccount
                                                            ? `${matchedAccount.bankName} - ${matchedAccount.accountNumber}`
                                                            : '';
                                                    return accountLabel ? (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                            via {accountLabel}
                                                        </div>
                                                    ) : null;
                                                })()}
                                            </td>
                                            <td className="font-medium">{formatCurrency(e.amount)}</td>
                                            {isOwner && <td><span className={`badge ${e.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{e.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span></td>}
                                        </tr>
                                    ))}
                            {/* Total row */}
                            {!loading && paginatedExpenses.totalItems > 0 && (
                                <tr style={{ background: 'var(--color-bg-secondary)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={isOwner ? 3 : 3} className="font-semibold" style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>TOTAL</td>
                                    <td className="font-semibold" style={{ color: 'var(--color-danger)', fontSize: '1rem' }}>{formatCurrency(grandTotal)}</td>
                                    {isOwner && <td />}
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {paginatedExpenses.totalItems === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada pengeluaran</div>
                                <div className="mobile-record-subtitle">Catat pengeluaran pertama untuk mulai melihat rangkuman kas operasional.</div>
                            </div>
                        ) : (
                            paginatedExpenses.items.map(e => {
                                const vehicleLabel =
                                    e.relatedVehiclePlate ||
                                    (e.relatedVehicleRef ? vehicleMap.get(e.relatedVehicleRef)?.plateNumber : '') ||
                                    '';
                                const matchedAccount = e.bankAccountRef ? accountMap.get(e.bankAccountRef) : undefined;
                                const accountLabel = e.bankAccountName
                                    ? `${e.bankAccountName}${e.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${e.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`
                                    : matchedAccount
                                        ? `${matchedAccount.bankName} - ${matchedAccount.accountNumber}`
                                        : '';
                                return (
                                    <div key={e._id} className="mobile-record-card">
                                        <div className="mobile-record-header">
                                            <div>
                                                <div className="mobile-record-title">{e.note || e.description || 'Pengeluaran tanpa catatan'}</div>
                                                <div className="mobile-record-subtitle">{formatDate(e.date)} • {e.categoryName || 'Tanpa kategori'}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(e.amount)}</div>
                                                {isOwner && <span className={`badge ${e.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{e.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span>}
                                            </div>
                                        </div>
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Kategori</span>
                                                <span className="mobile-record-value">{e.categoryName || '-'}</span>
                                            </div>
                                            {vehicleLabel && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Kendaraan</span>
                                                    <span className="mobile-record-value">{vehicleLabel}</span>
                                                </div>
                                            )}
                                            {accountLabel && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Dibayar dari</span>
                                                    <span className="mobile-record-value">{accountLabel}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
                {paginatedExpenses.totalItems > 0 && (
                    <AppPagination
                        page={paginatedExpenses.currentPage}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={paginatedExpenses.totalItems}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} transaksi | Total: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong>
                            </>
                        )}
                    />
                )}
            </div>


            {showModal && (
                <div className="modal-overlay" onClick={() => { if (!saving) setShowModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pengeluaran</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--color-gray-600)' }}>
                                Catat hanya pengeluaran yang sudah pasti keluar. Jika dibayar dari rekening atau kas tertentu, pilih sumber dana agar posisi arus kas ikut sinkron.
                            </div>
                            <div className="form-group"><label className="form-label">Kategori <span className="required">*</span></label>
                                <select className="form-select" value={form.categoryRef} onChange={e => setForm({ ...form, categoryRef: e.target.value })} disabled={saving}>
                                    <option value="">Pilih kategori</option>{categories.filter(c => c.active !== false).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} disabled={saving} /></div>
                                <div className="form-group"><label className="form-label">Nominal <span className="required">*</span></label><CurrencyInput value={form.amount} onValueChange={value => setForm({ ...form, amount: value })} disabled={saving} placeholder="Ketik nominal pengeluaran" /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan/Deskripsi</label><textarea className="form-textarea" rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} disabled={saving} /></div>
                            <div className="form-group"><label className="form-label">Kendaraan Terkait</label>
                                <select className="form-select" value={form.relatedVehicleRef} onChange={e => setForm({ ...form, relatedVehicleRef: e.target.value })} disabled={saving}>
                                    <option value="">-- Tidak terkait kendaraan tertentu --</option>
                                    {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Bayar dari Rekening / Kas</label>
                                <select className="form-select" value={form.bankAccountRef} onChange={e => {
                                    const acc = bankAccounts.find(account => account._id === e.target.value);
                                    setForm({ ...form, bankAccountRef: e.target.value, bankAccountName: acc?.bankName || '' });
                                }} disabled={saving}>
                                    <option value="">-- Tidak dipilih --</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            {isOwner && <div className="form-group"><label className="form-label">Privacy Level</label>
                                <select className="form-select" value={form.privacyLevel} onChange={e => setForm({ ...form, privacyLevel: e.target.value as 'internal' | 'ownerOnly' })} disabled={saving}>
                                    <option value="internal">Internal</option><option value="ownerOnly">Owner Only</option>
                                </select>
                            </div>}
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Batal</button><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
