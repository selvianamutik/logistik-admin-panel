'use client';

import { useState, useEffect } from 'react';
import { useToast } from '../../layout';
import { Plus, Search, Disc3, CheckCircle, Clock } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import type { TireEvent, Vehicle } from '@/lib/types';

const TIRE_TYPES = ['Tubeless', 'Tube Type', 'Solid'] as const;

export default function TiresPage() {
    const { addToast } = useToast();
    const [events, setEvents] = useState<TireEvent[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterVehicle, setFilterVehicle] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'replaced'>('all');
    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<TireEvent | null>(null);
    const [form, setForm] = useState({
        vehicleRef: '',
        posisi: '',
        tireType: 'Tubeless' as 'Tubeless' | 'Tube Type' | 'Solid',
        tireBrand: '',
        tireSize: '',
        installDate: new Date().toISOString().split('T')[0],
        replaceDate: '',
        notes: '',
    });

    const loadData = () => {
        Promise.all([
            fetch('/api/data?entity=tire-events').then(r => r.json()),
            fetch('/api/data?entity=vehicles').then(r => r.json()),
        ]).then(([te, v]) => {
            setEvents(te.data || []);
            setVehicles(v.data || []);
            setLoading(false);
        }).catch(() => setLoading(false));
    };

    useEffect(() => { loadData(); }, []);

    const openAdd = () => {
        setEditTarget(null);
        setForm({ vehicleRef: '', posisi: '', tireType: 'Tubeless', tireBrand: '', tireSize: '', installDate: new Date().toISOString().split('T')[0], replaceDate: '', notes: '' });
        setShowModal(true);
    };

    const openEdit = (ev: TireEvent) => {
        setEditTarget(ev);
        setForm({
            vehicleRef: ev.vehicleRef,
            posisi: ev.posisi,
            tireType: ev.tireType,
            tireBrand: ev.tireBrand,
            tireSize: ev.tireSize,
            installDate: ev.installDate,
            replaceDate: ev.replaceDate || '',
            notes: ev.notes || '',
        });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.vehicleRef) { addToast('error', 'Pilih kendaraan'); return; }
        if (!form.posisi) { addToast('error', 'Isi posisi ban'); return; }
        if (!form.tireBrand) { addToast('error', 'Isi merk/tipe ban'); return; }
        if (!form.tireSize) { addToast('error', 'Isi ukuran ban'); return; }
        try {
            const veh = vehicles.find(v => v._id === form.vehicleRef);
            const payload = { ...form, vehiclePlate: veh?.plateNumber, replaceDate: form.replaceDate || undefined };
            if (editTarget) {
                await fetch('/api/data', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', action: 'update', data: { id: editTarget._id, updates: payload } }),
                });
                addToast('success', 'Data ban berhasil diperbarui');
            } else {
                await fetch('/api/data', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entity: 'tire-events', data: payload }),
                });
                addToast('success', 'Ban berhasil dicatat');
            }
            setShowModal(false);
            loadData();
        } catch { addToast('error', 'Gagal menyimpan'); }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Hapus catatan ban ini?')) return;
        try {
            await fetch('/api/data', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'tire-events', action: 'delete', data: { id } }),
            });
            addToast('success', 'Catatan ban dihapus');
            loadData();
        } catch { addToast('error', 'Gagal menghapus'); }
    };

    const filtered = events.filter(e => {
        const matchSearch = !search || e.vehiclePlate?.toLowerCase().includes(search.toLowerCase()) || e.posisi?.toLowerCase().includes(search.toLowerCase()) || e.tireBrand?.toLowerCase().includes(search.toLowerCase());
        const matchVehicle = !filterVehicle || e.vehicleRef === filterVehicle;
        const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? !e.replaceDate : !!e.replaceDate);
        return matchSearch && matchVehicle && matchStatus;
    });

    const activeBans = filtered.filter(e => !e.replaceDate);
    const replacedBans = filtered.filter(e => !!e.replaceDate);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Manajemen Ban</h1>
                    <p className="page-subtitle">Catat dan pantau kondisi ban tiap kendaraan</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-primary" onClick={openAdd}><Plus size={16} /> Catat Ban</button>
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card"><div className="kpi-icon success"><CheckCircle size={20} /></div><div className="kpi-content"><div className="kpi-label">Ban Terpasang</div><div className="kpi-value">{events.filter(e => !e.replaceDate).length}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><Clock size={20} /></div><div className="kpi-content"><div className="kpi-label">Sudah Diganti</div><div className="kpi-value">{events.filter(e => !!e.replaceDate).length}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon info"><Disc3 size={20} /></div><div className="kpi-content"><div className="kpi-label">Total Catatan</div><div className="kpi-value">{events.length}</div></div></div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search">
                            <Search size={16} className="table-search-icon" />
                            <input type="text" placeholder="Cari plat, posisi, merk..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="form-select" style={{ width: 'auto' }} value={filterVehicle} onChange={e => setFilterVehicle(e.target.value)}>
                            <option value="">Semua Kendaraan</option>
                            {vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber}</option>)}
                        </select>
                        <select className="form-select" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value as 'all' | 'active' | 'replaced')}>
                            <option value="all">Semua Status</option>
                            <option value="active">Terpasang</option>
                            <option value="replaced">Sudah Diganti</option>
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead>
                            <tr>
                                <th>Kendaraan</th>
                                <th>Posisi</th>
                                <th>Jenis</th>
                                <th>Merk & Tipe</th>
                                <th>Ukuran</th>
                                <th>Tgl Pasang</th>
                                <th>Tgl Ganti</th>
                                <th>Status</th>
                                <th>Catatan</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? (
                                    <tr><td colSpan={10}>
                                        <div className="empty-state">
                                            <Disc3 size={48} className="empty-state-icon" />
                                            <div className="empty-state-title">Belum ada catatan ban</div>
                                            <div className="empty-state-text">Catat ban yang terpasang pada tiap kendaraan</div>
                                        </div>
                                    </td></tr>
                                ) : filtered.map(ev => (
                                    <tr key={ev._id}>
                                        <td className="font-medium">{ev.vehiclePlate || '-'}</td>
                                        <td>{ev.posisi}</td>
                                        <td><span className="badge badge-blue"><span className="badge-dot" />{ev.tireType}</span></td>
                                        <td className="font-medium">{ev.tireBrand}</td>
                                        <td className="font-mono">{ev.tireSize}</td>
                                        <td className="text-muted">{formatDate(ev.installDate)}</td>
                                        <td className="text-muted">{ev.replaceDate ? formatDate(ev.replaceDate) : <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>Terpasang</span>}</td>
                                        <td>{ev.replaceDate ? <span className="badge badge-gray"><span className="badge-dot" />Diganti</span> : <span className="badge badge-green"><span className="badge-dot" />Aktif</span>}</td>
                                        <td className="text-muted">{ev.notes || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => openEdit(ev)}>Edit</button>
                                                <button className="btn" style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'var(--color-danger)', color: 'white' }} onClick={() => handleDelete(ev._id)}>Hapus</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && (
                    <div className="pagination">
                        <div className="pagination-info">{activeBans.length} terpasang · {replacedBans.length} sudah diganti · {filtered.length} total</div>
                    </div>
                )}
            </div>

            {/* Add/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">{editTarget ? 'Edit Catatan Ban' : 'Catat Ban'}</h3>
                            <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Kendaraan</label>
                                <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })} disabled={!!editTarget}>
                                    <option value="">Pilih kendaraan</option>
                                    {vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber} — {v.brandModel}</option>)}
                                </select>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Posisi Ban</label>
                                    <input type="text" className="form-input" placeholder="cth: Depan Kiri, Belakang Kanan Luar" value={form.posisi} onChange={e => setForm({ ...form, posisi: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jenis Ban</label>
                                    <select className="form-select" value={form.tireType} onChange={e => setForm({ ...form, tireType: e.target.value as 'Tubeless' | 'Tube Type' | 'Solid' })}>
                                        {TIRE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Merk & Tipe Ban</label>
                                    <input type="text" className="form-input" placeholder="cth: Bridgestone R150" value={form.tireBrand} onChange={e => setForm({ ...form, tireBrand: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Ukuran Ban</label>
                                    <input type="text" className="form-input" placeholder="cth: 11.00-20, 295/80R22.5" value={form.tireSize} onChange={e => setForm({ ...form, tireSize: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Pemakaian</label>
                                    <input type="date" className="form-input" value={form.installDate} onChange={e => setForm({ ...form, installDate: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Penggantian <span className="text-muted">(kosong = masih aktif)</span></label>
                                    <input type="date" className="form-input" value={form.replaceDate} onChange={e => setForm({ ...form, replaceDate: e.target.value })} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} placeholder="Catatan tambahan..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSave}><Plus size={16} /> {editTarget ? 'Simpan Perubahan' : 'Simpan'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
