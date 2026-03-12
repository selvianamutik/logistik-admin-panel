'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Save } from 'lucide-react';
import type { CompanyProfile } from '@/lib/types';

export default function CompanyPage() {
    const { addToast } = useToast();
    const [data, setData] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch('/api/data?entity=company').then(r => r.json()).then(d => {
            const profile = d.data || {};
            // Ensure nested settings objects exist with defaults
            profile.numberingSettings = profile.numberingSettings || { resiPrefix: 'R-', resiCounter: 0, doPrefix: 'DO-', doCounter: 0, invoicePrefix: 'INV-', invoiceCounter: 0, notaPrefix: 'NOTA-', notaCounter: 0, boronganPrefix: 'BRG-', boronganCounter: 0, bonPrefix: 'BON-', bonCounter: 0, incidentPrefix: 'INC-', incidentCounter: 0 };
            profile.invoiceSettings = profile.invoiceSettings || { defaultTermDays: 30, dueDateDays: 14, footerNote: '', invoiceMode: 'ORDER' };
            profile.documentSettings = profile.documentSettings || { showContact: true, dateFormat: 'DD/MM/YYYY' };
            setData(profile); setLoading(false);
        });
    }, []);

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
    const uNum = (field: string, value: unknown) => setData(prev => prev ? { ...prev, numberingSettings: { ...(prev.numberingSettings || {}), [field]: value } } as CompanyProfile : prev);

    // Live theme preview — apply CSS vars instantly
    const previewTheme = (hex: string) => {
        u('themeColor', hex);
        if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const ri = parseInt(hex.slice(1, 3), 16), gi = parseInt(hex.slice(3, 5), 16), bi = parseInt(hex.slice(5, 7), 16);
        const [h, s, l] = (() => {
            const r = ri / 255, g = gi / 255, b = bi / 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b), lv = (max + min) / 2;
            if (max === min) return [0, 0, lv * 100];
            const d = max - min, sv = lv > 0.5 ? d / (2 - max - min) : d / (max + min);
            let hv = 0;
            if (max === r) hv = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) hv = ((b - r) / d + 2) / 6;
            else hv = ((r - g) / d + 4) / 6;
            return [hv * 360, sv * 100, lv * 100];
        })();
        const toHex = (hh: number, ss: number, ll: number) => {
            const s2 = ss / 100, l2 = ll / 100, a = s2 * Math.min(l2, 1 - l2);
            const f = (n: number) => { const k = (n + hh / 30) % 12; return l2 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
            const tx = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
            return `#${tx(f(0))}${tx(f(8))}${tx(f(4))}`;
        };
        const root = document.documentElement;
        root.style.setProperty('--color-primary', hex);
        root.style.setProperty('--color-primary-hover', toHex(h, s, Math.max(0, l - 8)));
        root.style.setProperty('--color-primary-light', toHex(h, Math.min(100, s + 20), 96));
        root.style.setProperty('--color-primary-50', toHex(h, Math.min(100, s + 10), 93));
        root.style.setProperty('--color-primary-100', toHex(h, Math.min(100, s + 5), 88));
        root.style.setProperty('--color-primary-200', toHex(h, s, 80));
        root.style.setProperty('--color-primary-600', hex);
        root.style.setProperty('--color-primary-700', toHex(h, s, Math.max(0, l - 8)));
        root.style.setProperty('--color-primary-800', toHex(h, s, Math.max(0, l - 16)));
        // Sidebar active colors
        root.style.setProperty('--sidebar-active-bg', hex + '33');
        root.style.setProperty('--sidebar-active-text', toHex(h, Math.min(100, s + 15), Math.min(85, l + 30)));
    };

    if (loading || !data) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Pengaturan Perusahaan</h1><p className="page-subtitle">Kelola profil, branding, dan dokumen aktif perusahaan</p></div>
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
                        <div className="form-section-title">Logo Perusahaan</div>
                        <div className="form-group">
                            <label className="form-label">Upload / Import Logo</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
                                {data.logoUrl ? (
                                    <div style={{ position: 'relative', width: 64, height: 64, borderRadius: '0.5rem', border: '2px solid var(--border-color)', overflow: 'hidden', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={data.logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        <button type="button" onClick={() => u('logoUrl', '')} style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#ef4444', color: '#fff', fontSize: '0.65rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                                    </div>
                                ) : (
                                    <div style={{ width: 64, height: 64, borderRadius: '0.5rem', border: '2px dashed var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.7rem', flexShrink: 0, background: 'var(--bg-secondary)' }}>
                                        No Logo
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)', color: 'var(--color-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', background: 'transparent' }}
                                        onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-primary)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                                        onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}>
                                        📁 Pilih File
                                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            if (file.size > 500 * 1024) { alert('Ukuran file max 500KB'); return; }
                                            const reader = new FileReader();
                                            reader.onload = () => { u('logoUrl', reader.result as string); };
                                            reader.readAsDataURL(file);
                                        }} />
                                    </label>
                                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>PNG, JPG, SVG • Max 500KB</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>atau URL:</span>
                                <input className="form-input" value={data.logoUrl?.startsWith('data:') ? '' : (data.logoUrl || '')} onChange={e => u('logoUrl', e.target.value)} placeholder="https://example.com/logo.png" style={{ fontSize: '0.8rem' }} />
                            </div>
                            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Logo tampil di sidebar, cetak, dan export dokumen aktif (PDF, Excel).</p>
                        </div>
                        <div className="form-section-title">🎨 Tema Warna Aplikasi</div>
                        <div className="form-group">
                            <label className="form-label">Pilih Warna Tema</label>
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                                {[
                                    { color: '#4f46e5', name: 'Indigo' },
                                    { color: '#2563eb', name: 'Biru' },
                                    { color: '#0891b2', name: 'Cyan' },
                                    { color: '#059669', name: 'Hijau' },
                                    { color: '#d97706', name: 'Orange' },
                                    { color: '#dc2626', name: 'Merah' },
                                    { color: '#7c3aed', name: 'Ungu' },
                                    { color: '#db2777', name: 'Pink' },
                                ].map(t => (
                                    <button key={t.color} onClick={() => previewTheme(t.color)} title={t.name}
                                        style={{
                                            width: 40, height: 40, borderRadius: '0.5rem', border: data.themeColor === t.color ? '3px solid #1e293b' : '2px solid #e2e8f0',
                                            background: t.color, cursor: 'pointer', boxShadow: data.themeColor === t.color ? '0 0 0 2px white, 0 0 0 4px ' + t.color : 'none',
                                            transition: 'all 0.15s'
                                        }} />
                                ))}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <input type="color" value={data.themeColor || '#4f46e5'} onChange={e => previewTheme(e.target.value)}
                                    style={{ width: 40, height: 36, padding: 0, border: '1px solid #e2e8f0', borderRadius: '0.375rem', cursor: 'pointer' }} />
                                <input className="form-input" value={data.themeColor || '#4f46e5'} onChange={e => previewTheme(e.target.value)} placeholder="#4f46e5" style={{ maxWidth: 140 }} />
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Warna kustom</span>
                            </div>
                            {/* Live Preview Bar */}
                            <div style={{ padding: '0.75rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Preview:</span>
                                <button className="btn btn-primary btn-sm" style={{ pointerEvents: 'none' }}>Tombol Primary</button>
                                <button className="btn btn-secondary btn-sm" style={{ pointerEvents: 'none' }}>Secondary</button>
                                <span className="badge badge-primary" style={{ pointerEvents: 'none' }}>Badge</span>
                                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--color-primary)' }} />
                            </div>
                        </div>
                        <div className="form-section-title">Rekening Penerimaan Utama</div>
                        <div className="form-row">
                            <div className="form-group"><label className="form-label">Bank</label><input className="form-input" value={data.bankName || ''} onChange={e => u('bankName', e.target.value)} /></div>
                            <div className="form-group"><label className="form-label">No. Rekening</label><input className="form-input" value={data.bankAccount || ''} onChange={e => u('bankAccount', e.target.value)} /></div>
                        </div>
                        <div className="form-group"><label className="form-label">Atas Nama</label><input className="form-input" value={data.bankHolder || ''} onChange={e => u('bankHolder', e.target.value)} /></div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Dipakai sebagai rekening penerimaan default pada dokumen cetak dan export. Ini berbeda dari modul <strong>Rekening &amp; Kas</strong> yang melacak saldo operasional.
                        </p>
                    </div>
                </div>

                <div>
                    <div className="card mb-6">
                        <div className="card-header"><span className="card-header-title">Workflow Tagihan Aktif</span></div>
                        <div className="card-body">
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                Tagihan operasional yang aktif di aplikasi ini adalah <strong>Nota Ongkos</strong> pada modul <code>/invoices</code>.
                                Pengaturan invoice legacy tetap disimpan untuk kompatibilitas data lama, tetapi tidak lagi dipakai di workflow harian.
                            </p>
                        </div>
                    </div>

                    <div className="card mb-6">
                        <div className="card-header"><span className="card-header-title">Penomoran Dokumen</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Resi</label><input className="form-input" value={data.numberingSettings.resiPrefix} onChange={e => uNum('resiPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix DO</label><input className="form-input" value={data.numberingSettings.doPrefix} onChange={e => uNum('doPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Nota</label><input className="form-input" value={data.numberingSettings.notaPrefix || 'NOTA-'} onChange={e => uNum('notaPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Borongan</label><input className="form-input" value={data.numberingSettings.boronganPrefix || 'BRG-'} onChange={e => uNum('boronganPrefix', e.target.value)} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Prefix Bon</label><input className="form-input" value={data.numberingSettings.bonPrefix || 'BON-'} onChange={e => uNum('bonPrefix', e.target.value)} /></div>
                                <div className="form-group"><label className="form-label">Prefix Insiden</label><input className="form-input" value={data.numberingSettings.incidentPrefix} onChange={e => uNum('incidentPrefix', e.target.value)} /></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
