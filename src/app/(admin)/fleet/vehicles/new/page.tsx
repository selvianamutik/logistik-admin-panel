'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';

import { useApp, useToast } from '../../../layout';
import type { Service } from '@/lib/types';

export default function VehicleNewPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [saving, setSaving] = useState(false);
    const [services, setServices] = useState<Service[]>([]);
    const [form, setForm] = useState({
        unitCode: '',
        plateNumber: '',
        vehicleType: 'Truck',
        brandModel: '',
        year: new Date().getFullYear(),
        capacityKg: 0,
        capacityVolume: 0,
        serviceRef: '',
        chassisNumber: '',
        engineNumber: '',
        base: '',
        notes: '',
    });
    const isOwner = user?.role === 'OWNER';

    useEffect(() => {
        const loadServices = async () => {
            try {
                const res = await fetch('/api/data?entity=services');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat kategori armada');
                }
                setServices((payload.data || []).filter((service: Service) => service.active !== false));
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kategori armada');
            }
        };

        void loadServices();
    }, [addToast]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.plateNumber || !form.brandModel) {
            addToast('error', 'Plat nomor dan merk/model wajib');
            return;
        }
        if (!form.serviceRef) {
            addToast('error', 'Kategori armada wajib dipilih');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                unitCode: form.unitCode,
                plateNumber: form.plateNumber,
                vehicleType: form.vehicleType,
                brandModel: form.brandModel,
                year: form.year,
                capacityKg: form.capacityKg,
                capacityVolume: form.capacityVolume,
                serviceRef: form.serviceRef || undefined,
                base: form.base,
                notes: form.notes,
                status: 'ACTIVE',
                lastOdometer: 0,
                ...(isOwner ? { chassisNumber: form.chassisNumber, engineNumber: form.engineNumber } : {}),
            };
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'vehicles', data: payload }),
            });
            const d = await res.json();
            if (!res.ok) {
                throw new Error(d.error || 'Gagal menyimpan kendaraan');
            }
            addToast('success', 'Kendaraan berhasil ditambahkan');
            router.push(`/fleet/vehicles/${d.data?._id || d.id}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyimpan');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push('/fleet/vehicles')}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Tambah Kendaraan Baru</h1>
                </div>
            </div>
            <form onSubmit={handleSave}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Kendaraan</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kode Unit</label><input className="form-input" value={form.unitCode} onChange={e => setForm({ ...form, unitCode: e.target.value.toUpperCase() })} placeholder="Kosongkan untuk auto-generate dari kategori" /></div>
                                <div className="form-group"><label className="form-label">Plat Nomor <span className="required">*</span></label><input className="form-input" value={form.plateNumber} onChange={e => setForm({ ...form, plateNumber: e.target.value })} placeholder="B 1234 XYZ" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Kendaraan</label>
                                    <select className="form-select" value={form.vehicleType} onChange={e => setForm({ ...form, vehicleType: e.target.value })}>
                                        <option>Truck</option><option>Pickup</option><option>Van</option><option>Trailer</option><option>Motor</option><option>Other</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Merk/Model <span className="required">*</span></label><input className="form-input" value={form.brandModel} onChange={e => setForm({ ...form, brandModel: e.target.value })} placeholder="Mitsubishi Colt Diesel FE 74" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Kategori Truk / Armada</label>
                                    <select className="form-select" value={form.serviceRef} onChange={e => setForm({ ...form, serviceRef: e.target.value })}>
                                        <option value="">Pilih kategori armada</option>
                                        {services.map(service => <option key={service._id} value={service._id}>{service.code} - {service.name}</option>)}
                                    </select>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                        Kategori ini dipakai untuk mencocokkan kendaraan dengan order saat membuat surat jalan. Kode unit akan mengikuti prefix kode kategori.
                                    </div>
                                </div>
                                <div className="form-group"><label className="form-label">Base / Lokasi</label><input className="form-input" value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} placeholder="Jakarta" /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tahun</label><input type="number" className="form-input" value={form.year} onChange={e => setForm({ ...form, year: Number(e.target.value) })} /></div>
                            </div>
                        </div>
                    </div>
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Spesifikasi</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kapasitas (kg)</label><input type="number" className="form-input" value={form.capacityKg || ''} onChange={e => setForm({ ...form, capacityKg: Number(e.target.value) })} /></div>
                                <div className="form-group"><label className="form-label">Volume (m3)</label><input type="number" className="form-input" value={form.capacityVolume || ''} onChange={e => setForm({ ...form, capacityVolume: Number(e.target.value) })} /></div>
                            </div>
                            {isOwner && <div className="form-row">
                                <div className="form-group"><label className="form-label">No. Rangka</label><input className="form-input" value={form.chassisNumber} onChange={e => setForm({ ...form, chassisNumber: e.target.value })} placeholder="MHMFE74P..." /></div>
                                <div className="form-group"><label className="form-label">No. Mesin</label><input className="form-input" value={form.engineNumber} onChange={e => setForm({ ...form, engineNumber: e.target.value })} placeholder="4D34T..." /></div>
                            </div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push('/fleet/vehicles')}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Kendaraan'}</button>
                </div>
            </form>
        </div>
    );
}
