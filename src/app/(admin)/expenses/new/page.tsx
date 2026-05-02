'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp, useToast } from '../../layout';
import { Save } from 'lucide-react';
import { getBusinessDateValue } from '@/lib/business-date';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { isManualExpenseCategory } from '@/lib/expense-category-scope';
import type { ExpenseCategory, BankAccount } from '@/lib/types';

export default function ExpenseNewPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [form, setForm] = useState({
        categoryRef: '', categoryName: '',
        date: getBusinessDateValue(),
        amount: 0, note: '',
        privacyLevel: 'internal' as 'internal' | 'ownerOnly',
        bankAccountRef: '', bankAccountName: ''
    });
    const isOwner = user?.role === 'OWNER';
    const manualCategories = useMemo(
        () => categories.filter(isManualExpenseCategory),
        [categories]
    );

    useEffect(() => {
        Promise.all([
            fetchAdminCollectionData<ExpenseCategory[]>('/api/data?entity=expense-categories', 'Gagal memuat form pengeluaran'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat form pengeluaran'),
        ]).then(([categoryRows, accountRows]) => {
            setCategories(categoryRows || []);
            setBankAccounts((accountRows || []).filter((a) => a.active !== false));
        }).catch(error => {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat form pengeluaran');
        });
    }, [addToast]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.categoryRef || form.amount <= 0) {
            addToast('error', 'Kategori dan jumlah wajib diisi');
            return;
        }
        if (!manualCategories.some(category => category._id === form.categoryRef)) {
            addToast('error', 'Kategori ini tidak boleh dipakai untuk pengeluaran manual');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', data: form }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyimpan');
                return;
            }
            addToast('success', 'Pengeluaran berhasil dicatat');
            router.push('/expenses');
        } catch {
            addToast('error', 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/expenses" />
                    <h1 className="page-title">Tambah Pengeluaran</h1>
                </div>
            </div>
            <form onSubmit={handleSave}>
                <div className="card" style={{ maxWidth: 640 }}>
                    <div className="card-header"><span className="card-header-title">Detail Pengeluaran</span></div>
                    <div className="card-body">
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Kategori <span className="required">*</span></label>
                                <select className="form-select" value={form.categoryRef} onChange={e => {
                                    const cat = manualCategories.find(c => c._id === e.target.value);
                                    setForm({ ...form, categoryRef: e.target.value, categoryName: cat?.name || '' });
                                }}>
                                    <option value="">Pilih kategori umum</option>
                                    {manualCategories.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal</label>
                                <input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Jumlah (Rp) <span className="required">*</span></label>
                                <FormattedNumberInput allowDecimal={false} value={form.amount} onValueChange={value => setForm({ ...form, amount: value })} placeholder="Ketik nominal pengeluaran" />
                            </div>
                            {isOwner && (
                                <div className="form-group">
                                    <label className="form-label">Privacy Level</label>
                                    <select className="form-select" value={form.privacyLevel} onChange={e => setForm({ ...form, privacyLevel: e.target.value as 'internal' | 'ownerOnly' })}>
                                        <option value="internal">Internal (semua admin)</option>
                                        <option value="ownerOnly">Owner Only</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="form-group">
                            <label className="form-label">Catatan / Deskripsi</label>
                            <textarea className="form-textarea" rows={3} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Keterangan pengeluaran..." />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Bayar dari Rekening / Kas</label>
                            <select className="form-select" value={form.bankAccountRef} onChange={e => {
                                const acc = bankAccounts.find(a => a._id === e.target.value);
                                setForm({ ...form, bankAccountRef: e.target.value, bankAccountName: acc?.bankName || '' });
                            }}>
                                <option value="">-- Tidak dipilih --</option>
                                {bankAccounts.map(a => <option key={a._id} value={a._id}>{a.bankName} - {a.accountNumber}{a.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                            </select>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, maxWidth: 640 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/expenses')}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
                </div>
            </form>
        </div>
    );
}
