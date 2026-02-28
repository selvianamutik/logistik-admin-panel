'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Plus, Search, Wrench } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { TireEvent, Vehicle } from '@/lib/types';

const TIRE_POSITION_MAP: Record<string, string> = {
    FRONT_LEFT: 'Depan Kiri', FRONT_RIGHT: 'Depan Kanan',
    REAR_LEFT: 'Belakang Kiri', REAR_RIGHT: 'Belakang Kanan', SPARE: 'Cadangan'
};
const TIRE_ACTION_MAP: Record<string, { label: string; color: string }> = {
    PATCH: { label: 'Tambal', color: 'blue' }, REPLACE_NEW: { label: 'Ganti Baru', color: 'green' },
    ROTATE: { label: 'Rotasi', color: 'purple' }, VULCANIZE: { label: 'Vulkanisir', color: 'orange' }
};
const TIRE_CAUSE_MAP: Record<string, string> = {
    FLAT: 'Kempes', BLOWOUT: 'Meletus', WORN: 'Aus', NAIL: 'Paku', OTHER: 'Lainnya'
};

export default function TiresPage() {
    const { addToast } = useToast();
    const [events, setEvents] = useState<TireEvent[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({
        vehicleRef: '', date: new Date().toISOString().split('T')[0],
        odometer: 0, tirePosition: 'FRONT_LEFT', action: 'PATCH', cause: '', notes: ''
    });

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=tire-events').then(r => r.json()),
            fetch('/api/data?entity=vehicles').then(r => r.json()),
        ]).then(([te, v]) => {
            setEvents(te.data || []);
            setVehicles(v.data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        if (!form.vehicleRef) { addToast('error', 'Pilih kendaraan'); return; }
        try {
            const veh = vehicles.find(v => v._id === form.vehicleRef);
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'tire-events', data: { ...form, vehiclePlate: veh?.plateNumber } }),
            });
            addToast('success', 'Event ban berhasil dicatat');
            setShowModal(false);
            window.location.reload();
        } catch { addToast('error', 'Gagal menyimpan'); }
    };

    const filtered = events.filter(e => {
        if (!search) return true;
        const s = search.toLowerCase();
        return e.vehiclePlate?.toLowerCase().includes(s) || e.notes?.toLowerCase().includes(s);
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Manajemen Ban</h1>
                    <p className="page-subtitle">Catat semua event ban kendaraan</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={16} /> Catat Event</button>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari kendaraan..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr><th>Tanggal</th><th>Kendaraan</th><th>Posisi</th><th>Aksi</th><th>Penyebab</th><th>Odometer</th><th>Catatan</th></tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={7}>
                                        <div className="empty-state">
                                            <Wrench size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada event ban</div>
                                            <div className="empty-state-text">Catat event ban untuk tracking kondisi ban armada</div>
                                        </div>
                                    </td></tr>
                                ) : filtered.map(ev => (
                                    <tr key={ev._id}>
                                        <td className="text-muted">{formatDate(ev.date)}</td>
                                        <td className="font-medium">{ev.vehiclePlate || '-'}</td>
                                        <td>{TIRE_POSITION_MAP[ev.tirePosition] || ev.tirePosition}</td>
                                        <td><span className={`badge badge-${TIRE_ACTION_MAP[ev.action]?.color || 'gray'}`}><span className="badge-dot" /> {TIRE_ACTION_MAP[ev.action]?.label || ev.action}</span></td>
                                        <td>{ev.cause ? (TIRE_CAUSE_MAP[ev.cause] || ev.cause) : '-'}</td>
                                        <td className="font-mono">{ev.odometer?.toLocaleString()} km</td>
                                        <td className="text-muted">{ev.notes || '-'}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} event</div></div>}
            </div>

            {/* Add Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Catat Event Ban</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Kendaraan</label>
                                <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })}>
                                    <option value="">Pilih kendaraan</option>
                                    {vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber} — {v.brandModel}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                                <div className="form-group"><label className="form-label">Odometer (km)</label><input type="number" className="form-input" value={form.odometer || ''} onChange={e => setForm({ ...form, odometer: Number(e.target.value) })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Posisi Ban</label>
                                    <select className="form-select" value={form.tirePosition} onChange={e => setForm({ ...form, tirePosition: e.target.value })}>
                                        {Object.entries(TIRE_POSITION_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Aksi</label>
                                    <select className="form-select" value={form.action} onChange={e => setForm({ ...form, action: e.target.value })}>
                                        {Object.entries(TIRE_ACTION_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-group"><label className="form-label">Penyebab</label>
                                <select className="form-select" value={form.cause} onChange={e => setForm({ ...form, cause: e.target.value })}>
                                    <option value="">Tidak ada</option>
                                    {Object.entries(TIRE_CAUSE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                            </div>
                            <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave}><Plus size={16} /> Simpan</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
