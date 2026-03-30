'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast, useApp } from '../layout';
import { Plus, Search, Wallet, Save, X, FileDown, Printer } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import CurrencyInput from '@/components/CurrencyInput';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { formatDate, formatCurrency } from '@/lib/utils';
import { exportExpenses } from '@/lib/export';
import { openBrandedPrint, openPrintWindow, fetchCompanyProfile } from '@/lib/print';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { BankAccount, Expense, ExpenseCategory, Vehicle } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';

type ExpenseCategoryTotal = {
    name: string;
    total: number;
};

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
    const [filteredTotalExpenses, setFilteredTotalExpenses] = useState(0);
    const [grandTotal, setGrandTotal] = useState(0);
    const [transactionCount, setTransactionCount] = useState(0);
    const [avgAmount, setAvgAmount] = useState(0);
    const [categoryTotals, setCategoryTotals] = useState<ExpenseCategoryTotal[]>([]);
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

    const isOwner = user?.role === 'OWNER';
    const canExportExpenses = user ? hasPermission(user.role, 'expenses', 'export') : false;
    const canPrintExpenses = user ? hasPermission(user.role, 'expenses', 'print') : false;
    const vehicleMap = useMemo(() => new Map(vehicles.map(vehicle => [vehicle._id, vehicle])), [vehicles]);
    const accountMap = useMemo(() => new Map(bankAccounts.map(account => [account._id, account])), [bankAccounts]);

    useEffect(() => {
        setPage(1);
    }, [search]);

    const buildExpensesQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'expenses',
            page: String(targetPage),
            pageSize: String(targetPageSize),
        });

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'note,description,categoryName,relatedVehiclePlate');
        }

        if (!isOwner) {
            params.set('filter', JSON.stringify({ privacyLevel: 'internal' }));
        }

        return params.toString();
    }, [isOwner, page, search]);

    const fetchAllMatchingExpenses = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: Expense[] = [];

        do {
            const res = await fetch(`/api/data?${buildExpensesQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat data pengeluaran');
            }

            const nextItems = (payload.data || []) as Expense[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildExpensesQuery]);

    const loadExpenses = useCallback(async () => {
        if (!user) return;

        setLoading(true);
        try {
            const fetchOptionalCollection = async <T,>(url: string, fallbackData: T): Promise<T> => {
                try {
                    return await fetchAdminCollectionData<T>(url, 'Gagal memuat data pengeluaran');
                } catch (error) {
                    if (error instanceof Error && /403|forbidden|akses/i.test(error.message)) {
                        return fallbackData;
                    }
                    throw error;
                }
            };

            const [listRes, summaryRes, categoryRows, accountRows, vehicleRows] = await Promise.all([
                fetch(`/api/data?${buildExpensesQuery()}`),
                fetch(`/api/data?entity=expenses-summary${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`),
                fetchOptionalCollection<ExpenseCategory[]>('/api/data?entity=expense-categories', []),
                fetchOptionalCollection<BankAccount[]>('/api/data?entity=bank-accounts', []),
                user.role === 'FINANCE'
                    ? Promise.resolve([] as Vehicle[])
                    : fetchOptionalCollection<Vehicle[]>('/api/data?entity=vehicles', []),
            ]);

            const [listPayload, summaryPayload] = await Promise.all([listRes.json(), summaryRes.json()]);
            if (!listRes.ok) {
                throw new Error(listPayload.error || 'Gagal memuat data pengeluaran');
            }
            if (!summaryRes.ok) {
                throw new Error(summaryPayload.error || 'Gagal memuat ringkasan pengeluaran');
            }

            setItems((listPayload.data || []) as Expense[]);
            setFilteredTotalExpenses(listPayload.meta?.total || 0);
            setGrandTotal(summaryPayload.data?.grandTotal || 0);
            setTransactionCount(summaryPayload.data?.transactionCount || 0);
            setAvgAmount(summaryPayload.data?.avgAmount || 0);
            setCategoryTotals(summaryPayload.data?.categoryTotals || []);
            setCategories((categoryRows || []).filter(category => category.active !== false));
            setBankAccounts((accountRows || []).filter(account => account.active !== false));
            setVehicles((vehicleRows || []).filter(vehicle => vehicle.status !== 'SOLD'));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat data pengeluaran');
        } finally {
            setLoading(false);
        }
    }, [addToast, buildExpensesQuery, search, user]);

    useEffect(() => {
        void loadExpenses();
    }, [loadExpenses]);

    const handleSave = async () => {
        if (!form.categoryRef || !form.amount) {
            addToast('error', 'Kategori dan nominal wajib');
            return;
        }
        const category = categories.find(item => item._id === form.categoryRef);
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', data: { ...form, categoryName: category?.name || '' } }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mencatat pengeluaran');
                return;
            }
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
            if (page !== 1) {
                setPage(1);
            } else {
                await loadExpenses();
            }
        } catch {
            addToast('error', 'Gagal mencatat pengeluaran');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengeluaran</h1></div>
                <div className="page-actions">
                    {canExportExpenses && <button className="btn btn-secondary btn-sm" onClick={async () => {
                        try {
                            await exportExpenses(await fetchAllMatchingExpenses() as unknown as Record<string, unknown>[]);
                            addToast('success', 'Excel pengeluaran berhasil di-download');
                        } catch (error) {
                            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel pengeluaran');
                        }
                    }}><FileDown size={15} /> Excel</button>}
                    {canPrintExpenses && <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const printWindow = openPrintWindow('Menyiapkan print pengeluaran...');
                        if (!printWindow) {
                            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
                            return;
                        }
                        try {
                            const company = await fetchCompanyProfile().catch(() => null);
                            const printableExpenses = await fetchAllMatchingExpenses();
                            const describeExpense = (expense: Expense) => {
                                const vehicleLabel =
                                    expense.relatedVehiclePlate ||
                                    (expense.relatedVehicleRef ? vehicleMap.get(expense.relatedVehicleRef)?.plateNumber : '') ||
                                    '';
                                const matchedAccount = expense.bankAccountRef ? accountMap.get(expense.bankAccountRef) : undefined;
                                const accountLabel = expense.bankAccountName
                                    ? `${expense.bankAccountName}${expense.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${expense.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`
                                    : matchedAccount
                                        ? `${matchedAccount.bankName} - ${matchedAccount.accountNumber}`
                                        : '';
                                const detailLines = [
                                    expense.note || expense.description || '-',
                                    vehicleLabel ? `Kendaraan: ${vehicleLabel}` : '',
                                    accountLabel ? `Via: ${accountLabel}` : '',
                                ].filter(Boolean);
                                return detailLines.join('<br/>');
                            };
                            openBrandedPrint({
                                title: 'Daftar Pengeluaran', company, targetWindow: printWindow, bodyHtml: `
                                <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th class="r">Jumlah</th></tr></thead>
                                <tbody>${printableExpenses.map(expense => `<tr><td>${formatDate(expense.date)}</td><td class="b">${expense.categoryName || '-'}</td><td>${describeExpense(expense)}</td><td class="r b">${formatCurrency(expense.amount)}</td></tr>`).join('')}
                                <tr style="border-top:2px solid #1e293b"><td colspan="3" class="r b">TOTAL</td><td class="r b">${formatCurrency(grandTotal)}</td></tr></tbody></table>`
                            });
                        } catch (error) {
                            try {
                                printWindow.close();
                            } catch {}
                            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan dokumen print pengeluaran');
                        }
                    }}><Printer size={15} /> Print</button>}
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={18} /> Tambah Pengeluaran</button>
                </div></div>

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
                        <div className="kpi-value">{transactionCount}</div>
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

            {!loading && categoryTotals.length > 1 && (
                <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Breakdown per Kategori</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        {categoryTotals.map(category => (
                            <div key={category.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.75rem' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{category.name}</span>
                                <span style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 700 }}>{formatCurrency(category.total)}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>({grandTotal > 0 ? Math.round((category.total / grandTotal) * 100) : 0}%)</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari..." value={search} onChange={event => setSearch(event.target.value)} /></div></div></div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{isOwner && <th>Privacy</th>}</tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filteredTotalExpenses === 0 ? <tr><td colSpan={isOwner ? 5 : 4}><div className="empty-state"><Wallet size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada pengeluaran</div></div></td></tr> :
                                    items.map(expense => (
                                        <tr key={expense._id}>
                                            <td className="text-muted">{formatDate(expense.date)}</td>
                                            <td><span className="badge badge-gray">{expense.categoryName}</span></td>
                                            <td>
                                                <div>{expense.note || expense.description}</div>
                                                {expense.relatedVehiclePlate && (
                                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                                                        kendaraan {expense.relatedVehiclePlate}
                                                    </div>
                                                )}
                                                {(() => {
                                                    const matchedAccount = expense.bankAccountRef ? accountMap.get(expense.bankAccountRef) : undefined;
                                                    const accountLabel = expense.bankAccountName
                                                        ? `${expense.bankAccountName}${expense.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${expense.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`
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
                                            <td className="font-medium">{formatCurrency(expense.amount)}</td>
                                            {isOwner && <td><span className={`badge ${expense.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{expense.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span></td>}
                                        </tr>
                                    ))}
                            {!loading && filteredTotalExpenses > 0 && (
                                <tr style={{ background: 'var(--color-bg-secondary)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={3} className="font-semibold" style={{ textAlign: 'right', color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>TOTAL</td>
                                    <td className="font-semibold" style={{ color: 'var(--color-danger)', fontSize: '1rem' }}>{formatCurrency(grandTotal)}</td>
                                    {isOwner && <td />}
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {filteredTotalExpenses === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada pengeluaran</div>
                                <div className="mobile-record-subtitle">Catat pengeluaran pertama untuk mulai melihat rangkuman kas operasional.</div>
                            </div>
                        ) : (
                            items.map(expense => {
                                const matchedAccount = expense.bankAccountRef ? accountMap.get(expense.bankAccountRef) : undefined;
                                const accountLabel = expense.bankAccountName
                                    ? `${expense.bankAccountName}${expense.bankAccountNumber || matchedAccount?.accountNumber ? ` - ${expense.bankAccountNumber || matchedAccount?.accountNumber}` : ''}`
                                    : matchedAccount
                                        ? `${matchedAccount.bankName} - ${matchedAccount.accountNumber}`
                                        : '';
                                return (
                                    <div key={expense._id} className="mobile-record-card">
                                        <div className="mobile-record-header">
                                            <div>
                                                <div className="mobile-record-title">{expense.note || expense.description || 'Pengeluaran tanpa catatan'}</div>
                                                <div className="mobile-record-subtitle">{formatDate(expense.date)} | {expense.categoryName || 'Tanpa kategori'}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(expense.amount)}</div>
                                                {isOwner && <span className={`badge ${expense.privacyLevel === 'ownerOnly' ? 'badge-purple' : 'badge-info'}`}>{expense.privacyLevel === 'ownerOnly' ? 'Owner Only' : 'Internal'}</span>}
                                            </div>
                                        </div>
                                        <div className="mobile-record-meta">
                                            <div className="mobile-record-kv">
                                                <span className="mobile-record-label">Kategori</span>
                                                <span className="mobile-record-value">{expense.categoryName || '-'}</span>
                                            </div>
                                            {expense.relatedVehiclePlate && (
                                                <div className="mobile-record-kv">
                                                    <span className="mobile-record-label">Kendaraan</span>
                                                    <span className="mobile-record-value">{expense.relatedVehiclePlate}</span>
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
                {filteredTotalExpenses > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={filteredTotalExpenses}
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
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Pengeluaran</h3><button className="modal-close" onClick={() => setShowModal(false)} disabled={saving}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kategori <span className="required">*</span></label>
                                <select className="form-select" value={form.categoryRef} onChange={event => setForm({ ...form, categoryRef: event.target.value })} disabled={saving}>
                                    <option value="">Pilih kategori</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} disabled={saving} /></div>
                                <div className="form-group"><label className="form-label">Nominal <span className="required">*</span></label><CurrencyInput value={form.amount} onValueChange={value => setForm({ ...form, amount: value })} disabled={saving} placeholder="Ketik nominal pengeluaran" /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan/Deskripsi</label><textarea className="form-textarea" rows={2} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} disabled={saving} /></div>
                            <div className="form-group"><label className="form-label">Kendaraan Terkait</label>
                                <select className="form-select" value={form.relatedVehicleRef} onChange={event => setForm({ ...form, relatedVehicleRef: event.target.value })} disabled={saving || vehicles.length === 0}>
                                    <option value="">-- Tidak terkait kendaraan tertentu --</option>
                                    {vehicles.map(vehicle => <option key={vehicle._id} value={vehicle._id}>{vehicle.plateNumber} - {vehicle.brandModel}</option>)}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Bayar dari Rekening / Kas</label>
                                <select className="form-select" value={form.bankAccountRef} onChange={event => {
                                    const account = bankAccounts.find(item => item._id === event.target.value);
                                    setForm({ ...form, bankAccountRef: event.target.value, bankAccountName: account?.bankName || '' });
                                }} disabled={saving}>
                                    <option value="">-- Tidak dipilih --</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            {isOwner && <div className="form-group"><label className="form-label">Privacy Level</label>
                                <select className="form-select" value={form.privacyLevel} onChange={event => setForm({ ...form, privacyLevel: event.target.value as 'internal' | 'ownerOnly' })} disabled={saving}>
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
