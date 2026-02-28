'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Save, Building2 } from 'lucide-react';
import type { CompanyProfile } from '@/lib/types';

export default function CompanyPage() {
    const { addToast } = useToast();
    const [data, setData] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetch('/api/data?entity=company').then(r => r.json()).then(d => { setData(d.data); setLoading(false); }); }, []);

    const handleSave = async () => {
        if (!data) return;
        setSaving(true);
        try {
            await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'company', data }) });
            addToast('success', 'Pengaturan perusahaan disimpan');
        } catch { addToast('error', 'Gagal menyimpan'); }
        setSaving(false);
    };

    const u = (field: string, value: unknown) => setData(prev => prev ? { ...prev, [field]: value } : prev);
    const uNum = (field: string, value: unknown) => setData(prev => prev ? { ...prev, numberingSettings: { ...prev.numberingSettings, [field]: value } } : prev);
    const uInv = (field: string, value: unknown) => setData(prev => prev ? { ...prev, invoiceSettings: { ...prev.invoiceSettings, [field]: value } } : prev);

    if (loading || !data) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengaturan Perusahaan</h1><p className="page-subtitle">Kelola profil dan branding perusahaan</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={handleSave} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan'}</button></div></div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Profil Perusahaan</span></div>
                    <div className="card-body">
                        <div className="form-group"><label className="form-label">Nama Perusahaan</label><input className="form-input" value={data.name} onChange={e => u('name', e.target.value)} /></div>
                        <div className="form-group"><label className="form-label">Alamat</label><textarea className="form-textarea" rows={2} value={data.address} onChange={e => u('address', e.target.value)} /></div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Telepon / WhatsApp</label><input className="form-input" value={data.phone} onChange={e => u('phone', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={data.email} onChange={e => u('email', e.target.value)} /></div>
                        </div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">NPWP</label><input className="form-input" value={data.npwp || ''} onChange={e => u('npwp', e.target.value)} /></div>
                        </div>
                        <div className="form-section-title">Rekening Bank</div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Bank</label><input className="form-input" value={data.bankName || ''} onChange={e => u('bankName', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">No. Rekening</label><input className="form-input" value={data.bankAccount || ''} onChange={e => u('bankAccount', e.target.value)} /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Atas Nama</label><input className="form-input" value={data.bankHolder || ''} onChange={e => u('bankHolder', e.target.value)} /></div>
                    </div>
                </div>

                <div>
                    <div className="card mb-6">
                        <div className="card-header"><span className="card-header-title">Penomoran Dokumen</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Resi</label><input className="form-input" value={data.numberingSettings.resiPrefix} onChange={e => uNum('resiPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix DO</label><input className="form-input" value={data.numberingSettings.doPrefix} onChange={e => uNum('doPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Invoice</label><input className="form-input" value={data.numberingSettings.invoicePrefix} onChange={e => uNum('invoicePrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Insiden</label><input className="form-input" value={data.numberingSettings.incidentPrefix} onChange={e => uNum('incidentPrefix', e.target.value)} /></div>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Pengaturan Invoice</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Termin Default (hari)</label><input className="form-input" type="number" value={data.invoiceSettings.defaultTermDays} onChange={e => uInv('defaultTermDays', Number(e.target.value))} /></div>
                                <div className="form-group"><label className="form-label">Due Date (+N hari)</label><input className="form-input" type="number" value={data.invoiceSettings.dueDateDays} onChange={e => uInv('dueDateDays', Number(e.target.value))} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">Mode Invoice Default</label>
                                <select className="form-select" value={data.invoiceSettings.invoiceMode} onChange={e => uInv('invoiceMode', e.target.value)}>
                                    <option value="ORDER">Per Order</option><option value="DO">Per DO</option>
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Footer Note Invoice</label><textarea className="form-textarea" rows={3} value={data.invoiceSettings.footerNote} onChange={e => uInv('footerNote', e.target.value)} /></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
