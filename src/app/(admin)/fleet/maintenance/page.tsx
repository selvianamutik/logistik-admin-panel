'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Plus, Search, Wrench, Save, X } from 'lucide-react';
import { formatDate, MAINTENANCE_STATUS_MAP } from '@/lib/utils';
import type { Maintenance, Vehicle } from '@/lib/types';

export default function MaintenancePage() {
    const { addToast } = useToast();
    const [items, setItems] = useState<Maintenance[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ vehicleRef: '', type: '', scheduleType: 'DATE' as 'DATE' | 'ODOMETER', plannedDate: '', plannedOdometer: 0, notes: '' });

    useEffect(() => {
        Promise.all([fetch('/api/data?entity=maintenances').then(r => r.json()), fetch('/api/data?entity=vehicles').then(r => r.json())]).then(([m, v]) => { setItems(m.data || []); setVehicles(v.data || []); setLoading(false); });
    }, []);

    const filtered = items.filter(m => !search || m.type?.toLowerCase().includes(search.toLowerCase()) || m.vehiclePlate?.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!form.vehicleRef || !form.type) { addToast('error', 'Kendaraan dan tipe wajib'); return; }
        const veh = vehicles.find(v => v._id === form.vehicleRef);
        const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'maintenances', data: { ...form, vehiclePlate: veh?.plateNumber, status: 'SCHEDULED' } }) });
        const d = await res.json();
        if (!res.ok) {
            addToast('error', d.error || 'Gagal menjadwalkan maintenance');
            return;
        }
        setItems(prev => [...prev, d.data]);
        setForm({ vehicleRef: '', type: '', scheduleType: 'DATE', plannedDate: '', plannedOdometer: 0, notes: '' });
        addToast('success', 'Maintenance dijadwalkan');
        setShowModal(false);
    };

    const updateStatus = async (id: string, status: string) => {
        const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'maintenances', action: 'update', data: { id, updates: { status, completedDate: new Date().toISOString().split('T')[0] } } }) });
        const d = await res.json();
        if (!res.ok) {
            addToast('error', d.error || 'Gagal memperbarui maintenance');
            return;
        }
        setItems(prev => prev.map(m => m._id === id ? { ...m, status: status as Maintenance['status'] } : m));
        addToast('success', `Status maintenance diubah ke ${MAINTENANCE_STATUS_MAP[status]?.label}`);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Maintenance</h1><p className="page-subtitle">Jadwal dan riwayat servis kendaraan</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={18} /> Jadwalkan Servis</button></div></div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Kendaraan</th><th>Tipe Servis</th><th>Jadwal</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={5}><div className="empty-state"><Wrench size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada jadwal maintenance</div></div></td></tr> :
                                    filtered.map(m => (
                                        <tr key={m._id}>
                                            <td className="font-semibold">{m.vehiclePlate}</td>
                                            <td>{m.type}</td>
                                            <td>{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${(m.plannedOdometer || 0).toLocaleString()} km`}</td>
                                            <td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}><span className="badge-dot" /> {MAINTENANCE_STATUS_MAP[m.status]?.label}</span></td>
                                            <td><div className="table-actions">
                                                {m.status === 'SCHEDULED' && <><button className="table-action-btn" onClick={() => updateStatus(m._id, 'DONE')}>Selesai</button><button className="table-action-btn" onClick={() => updateStatus(m._id, 'SKIPPED')}>Lewati</button></>}
                                            </div></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Jadwalkan Maintenance</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label>
                                <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })}><option value="">Pilih</option>{vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber} - {v.brandModel}</option>)}</select></div>
                            <div className="form-group"><label className="form-label">Tipe Servis <span className="required">*</span></label>
                                <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                                    <option value="">Pilih</option><option>Servis Berkala</option><option>Ganti Oli</option><option>Ganti Rem</option><option>Ganti Ban</option><option>Spooring</option><option>Lainnya</option>
                                </select></div>
                            <div className="form-group"><label className="form-label">Jadwal Berdasarkan</label>
                                <select className="form-select" value={form.scheduleType} onChange={e => setForm({ ...form, scheduleType: e.target.value as 'DATE' | 'ODOMETER' })}>
                                    <option value="DATE">Tanggal</option><option value="ODOMETER">Odometer</option>
                                </select></div>
                            {form.scheduleType === 'DATE' ? <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.plannedDate} onChange={e => setForm({ ...form, plannedDate: e.target.value })} /></div> :
                                <div className="form-group"><label className="form-label">Odometer (km)</label><input type="number" className="form-input" value={form.plannedOdometer || ''} onChange={e => setForm({ ...form, plannedOdometer: Number(e.target.value) })} /></div>}
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-primary" onClick={handleSave}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
