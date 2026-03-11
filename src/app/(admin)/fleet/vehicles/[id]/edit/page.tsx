'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useApp, useToast } from '../../../../layout';
import { ArrowLeft, Save } from 'lucide-react';

import { VEHICLE_STATUS_MAP } from '@/lib/utils';
import type { Vehicle, VehicleStatus } from '@/lib/types';

type VehicleForm = {
    unitCode: string;
    plateNumber: string;
    vehicleType: string;
    brandModel: string;
    year: number;
    capacityKg: number;
    capacityVolume: number;
    chassisNumber: string;
    engineNumber: string;
    base: string;
    notes: string;
    status: VehicleStatus;
    lastOdometer: number;
    lastOdometerAt: string;
};

const EMPTY_FORM: VehicleForm = {
    unitCode: '',
    plateNumber: '',
    vehicleType: 'Truck',
    brandModel: '',
    year: new Date().getFullYear(),
    capacityKg: 0,
    capacityVolume: 0,
    chassisNumber: '',
    engineNumber: '',
    base: '',
    notes: '',
    status: 'ACTIVE',
    lastOdometer: 0,
    lastOdometerAt: '',
};

export default function VehicleEditPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
    const isOwner = user?.role === 'OWNER';
    const vehicleId = params.id as string;

    useEffect(() => {
        const loadVehicle = async () => {
            try {
                const res = await fetch(`/api/data?entity=vehicles&id=${vehicleId}`);
                const payload = await res.json();
                if (!res.ok || !payload.data) {
                    throw new Error(payload.error || 'Kendaraan tidak ditemukan');
                }

                const vehicle = payload.data as Vehicle;
                setForm({
                    unitCode: vehicle.unitCode || '',
                    plateNumber: vehicle.plateNumber || '',
                    vehicleType: vehicle.vehicleType || 'Truck',
                    brandModel: vehicle.brandModel || '',
                    year: vehicle.year || new Date().getFullYear(),
                    capacityKg: vehicle.capacityKg || 0,
                    capacityVolume: vehicle.capacityVolume || 0,
                    chassisNumber: vehicle.chassisNumber || '',
                    engineNumber: vehicle.engineNumber || '',
                    base: vehicle.base || '',
                    notes: vehicle.notes || '',
                    status: vehicle.status || 'ACTIVE',
                    lastOdometer: vehicle.lastOdometer || 0,
                    lastOdometerAt: vehicle.lastOdometerAt || '',
                });
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat kendaraan');
                router.push('/fleet/vehicles');
            } finally {
                setLoading(false);
            }
        };

        void loadVehicle();
    }, [addToast, router, vehicleId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.plateNumber || !form.brandModel) {
            addToast('error', 'Plat nomor dan merk/model wajib diisi');
            return;
        }

        setSaving(true);
        try {
            const updates = {
                unitCode: form.unitCode,
                plateNumber: form.plateNumber,
                vehicleType: form.vehicleType,
                brandModel: form.brandModel,
                year: form.year,
                capacityKg: form.capacityKg,
                capacityVolume: form.capacityVolume,
                base: form.base,
                notes: form.notes,
                status: form.status,
                lastOdometer: form.lastOdometer,
                lastOdometerAt: form.lastOdometerAt || undefined,
                ...(isOwner ? { chassisNumber: form.chassisNumber, engineNumber: form.engineNumber } : {}),
            };

            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'vehicles',
                    action: 'update',
                    data: { id: vehicleId, updates },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memperbarui kendaraan');
            }

            addToast('success', 'Kendaraan berhasil diperbarui');
            router.push(`/fleet/vehicles/${vehicleId}`);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memperbarui kendaraan');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 320 }} /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push(`/fleet/vehicles/${vehicleId}`)}><ArrowLeft size={16} /></button>
                    <h1 className="page-title">Edit Kendaraan</h1>
                </div>
            </div>
            <form onSubmit={handleSubmit}>
                <div className="detail-grid">
                    <div className="card">
                        <div className="card-header"><span className="card-header-title">Informasi Kendaraan</span></div>
                        <div className="card-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kode Unit</label><input className="form-input" value={form.unitCode} onChange={e => setForm({ ...form, unitCode: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Plat Nomor <span className="required">*</span></label><input className="form-input" value={form.plateNumber} onChange={e => setForm({ ...form, plateNumber: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Kendaraan</label><input className="form-input" value={form.vehicleType} onChange={e => setForm({ ...form, vehicleType: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Merk/Model <span className="required">*</span></label><input className="form-input" value={form.brandModel} onChange={e => setForm({ ...form, brandModel: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tahun</label><input type="number" className="form-input" value={form.year} onChange={e => setForm({ ...form, year: Number(e.target.value) })} /></div>
                                <div className="form-group"><label className="form-label">Base / Lokasi</label><input className="form-input" value={form.base} onChange={e => setForm({ ...form, base: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Status</label>
                                    <select className="form-select" value={form.status} onChange={e => setForm({ ...form, status: e.target.value as VehicleStatus })}>
                                        {Object.entries(VEHICLE_STATUS_MAP).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Tanggal Update Odometer</label><input type="date" className="form-input" value={form.lastOdometerAt} onChange={e => setForm({ ...form, lastOdometerAt: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Odometer Terakhir</label><input type="number" className="form-input" value={form.lastOdometer || ''} onChange={e => setForm({ ...form, lastOdometer: Number(e.target.value) })} /></div>
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
                                <div className="form-group"><label className="form-label">No. Rangka</label><input className="form-input" value={form.chassisNumber} onChange={e => setForm({ ...form, chassisNumber: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">No. Mesin</label><input className="form-input" value={form.engineNumber} onChange={e => setForm({ ...form, engineNumber: e.target.value })} /></div>
                            </div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary" onClick={() => router.push(`/fleet/vehicles/${vehicleId}`)}>Batal</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}><Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Perubahan'}</button>
                </div>
            </form>
        </div>
    );
}
