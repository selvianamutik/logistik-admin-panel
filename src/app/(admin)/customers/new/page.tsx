'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { ArrowLeft, Save } from 'lucide-react';

export default function CustomerNewPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        name: '', address: '', contactPerson: '', phone: '', email: '',
        defaultPaymentTerm: 14, npwp: ''
    });

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name || !form.phone) {
            addToast('error', 'Nama dan telepon wajib diisi');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'customers', data: { ...form, active: true } }),
            });
            const d = await res.json();
            addToast('success', 'Customer berhasil ditambahkan');
            router.push(`/customers/${d.data?._id || d.id || ''}`);
        } catch { addToast('error', 'Gagal menyimpan'); }
        setSaving(false);
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-ghost btn-sm" onClick={() => router.push('/customers')} style={{ flexShrink: 0 }}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Tambah Customer Baru</h1>
                </div>
            </div>
            <form onSubmit={handleSave}>
                <div className="card" style={{ maxWidth: 640 }}>
                    <div className="card-header"><span className="card-header-title">Informasi Customer</span></div>
                    <div className="card-body">
                        <div className="form-group">
                            <label className="form-label">Nama Perusahaan <span className="required">*</span></label>
                            <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="PT..." />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Alamat</label>
                            <textarea className="form-textarea" rows={2} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Contact Person</label><input className="form-input" value={form.contactPerson} onChange={e => setForm({ ...form, contactPerson: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Telepon <span className="required">*</span></label><input className="form-input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Email</label><input type="email" className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={form.npwp} onChange={e => setForm({ ...form, npwp: e.target.value })} /></div>
                        </div>
                        <div className="form-group" style={{ maxWidth: 200 }}>
                            <label className="form-label">Default Payment Term (hari)</label>
                            <input type="number" className="form-input" value={form.defaultPaymentTerm} onChange={e => setForm({ ...form, defaultPaymentTerm: Number(e.target.value) })} />
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24, maxWidth: 640 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/customers')}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button>
                </div>
            </form>
        </div>
    );
}
