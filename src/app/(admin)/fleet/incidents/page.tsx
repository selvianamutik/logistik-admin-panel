'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '../../layout';
import { Plus, Search, Eye, AlertTriangle, X } from 'lucide-react';
import { formatDateTime, INCIDENT_STATUS_MAP, URGENCY_MAP, INCIDENT_TYPE_MAP } from '@/lib/utils';
import type { Incident, Vehicle, DeliveryOrder } from '@/lib/types';

export default function IncidentsPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<Incident[]>([]);
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ vehicleRef: '', incidentType: 'OTHER' as Incident['incidentType'], urgency: 'MEDIUM' as Incident['urgency'], locationText: '', odometer: 0, description: '', dateTime: new Date().toISOString().slice(0, 16), relatedDeliveryOrderRef: '' });

    useEffect(() => {
        Promise.all([fetch('/api/data?entity=incidents').then(r => r.json()), fetch('/api/data?entity=vehicles').then(r => r.json()), fetch('/api/data?entity=delivery-orders').then(r => r.json())]).then(([i, v, d]) => { setItems(i.data || []); setVehicles(v.data || []); setDos(d.data || []); setLoading(false); });
    }, []);

    const filtered = items.filter(i => !search || i.incidentNumber?.toLowerCase().includes(search.toLowerCase()) || i.vehiclePlate?.toLowerCase().includes(search.toLowerCase()) || i.locationText?.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!form.vehicleRef || !form.description) { addToast('error', 'Kendaraan dan deskripsi wajib'); return; }
        const veh = vehicles.find(v => v._id === form.vehicleRef);
        const doData = dos.find(d => d._id === form.relatedDeliveryOrderRef);
        const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'incidents', data: { ...form, vehiclePlate: veh?.plateNumber, relatedDONumber: doData?.doNumber } }) });
        const d = await res.json();
        if (!res.ok) {
            addToast('error', d.error || 'Gagal membuat insiden');
            return;
        }
        setItems(prev => [...prev, d.data]);
        setForm({ vehicleRef: '', incidentType: 'OTHER', urgency: 'MEDIUM', locationText: '', odometer: 0, description: '', dateTime: new Date().toISOString().slice(0, 16), relatedDeliveryOrderRef: '' });
        addToast('success', `Insiden dilaporkan: ${d.data?.incidentNumber || ''}`);
        setShowModal(false);
    };

    return (
        <div>
            <div className="page-header"><div className="page-header-left"><h1 className="page-title">Insiden Kendaraan</h1><p className="page-subtitle">Laporan dan penanganan insiden armada</p></div>
                <div className="page-actions"><button className="btn btn-primary" onClick={() => setShowModal(true)}><Plus size={18} /> Laporkan Insiden</button></div></div>
            <div className="table-container">
                <div className="table-toolbar"><div className="table-toolbar-left"><div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari..." value={search} onChange={e => setSearch(e.target.value)} /></div></div></div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>No.</th><th>Waktu</th><th>Kendaraan</th><th>Tipe</th><th>Lokasi</th><th>Urgency</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={8}><div className="empty-state"><AlertTriangle size={48} className="empty-state-icon" /><div className="empty-state-title">Tidak ada insiden</div></div></td></tr> :
                                    filtered.map(i => (
                                        <tr key={i._id}>
                                            <td><Link href={`/fleet/incidents/${i._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{i.incidentNumber}</Link></td>
                                            <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(i.dateTime)}</td>
                                            <td className="font-medium">{i.vehiclePlate}</td>
                                            <td>{INCIDENT_TYPE_MAP[i.incidentType] || i.incidentType}</td>
                                            <td>{i.locationText}</td>
                                            <td><span className={`badge badge-${URGENCY_MAP[i.urgency]?.color}`}>{URGENCY_MAP[i.urgency]?.label}</span></td>
                                            <td><span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}><span className="badge-dot" /> {INCIDENT_STATUS_MAP[i.status]?.label}</span></td>
                                            <td><button className="table-action-btn" onClick={() => router.push(`/fleet/incidents/${i._id}`)}><Eye size={14} /> Lihat</button></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Laporkan Insiden</h3><button className="modal-close" onClick={() => setShowModal(false)}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Kendaraan <span className="required">*</span></label>
                                    <select className="form-select" value={form.vehicleRef} onChange={e => setForm({ ...form, vehicleRef: e.target.value })}><option value="">Pilih</option>{vehicles.map(v => <option key={v._id} value={v._id}>{v.plateNumber}</option>)}</select></div>
                                <div className="form-group"><label className="form-label">Waktu Insiden</label><input type="datetime-local" className="form-input" value={form.dateTime} onChange={e => setForm({ ...form, dateTime: e.target.value })} /></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Tipe Insiden</label>
                                    <select className="form-select" value={form.incidentType} onChange={e => setForm({ ...form, incidentType: e.target.value as Incident['incidentType'] })}>
                                        {Object.entries(INCIDENT_TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                    </select></div>
                                <div className="form-group"><label className="form-label">Urgency</label>
                                    <select className="form-select" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value as Incident['urgency'] })}>
                                        {Object.entries(URGENCY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                    </select></div>
                            </div>
                            <div className="form-row">
                                <div className="form-group"><label className="form-label">Lokasi</label><input className="form-input" value={form.locationText} onChange={e => setForm({ ...form, locationText: e.target.value })} placeholder="Tol Cikampek KM 45..." /></div>
                                <div className="form-group"><label className="form-label">Odometer</label><input type="number" className="form-input" value={form.odometer || ''} onChange={e => setForm({ ...form, odometer: Number(e.target.value) })} /></div>
                            </div>
                            <div className="form-group"><label className="form-label">DO Terkait (Opsional)</label>
                                <select className="form-select" value={form.relatedDeliveryOrderRef} onChange={e => setForm({ ...form, relatedDeliveryOrderRef: e.target.value })}><option value="">- Tidak ada -</option>{dos.map(d => <option key={d._id} value={d._id}>{d.doNumber}</option>)}</select></div>
                            <div className="form-group"><label className="form-label">Kronologi / Deskripsi <span className="required">*</span></label><textarea className="form-textarea" rows={4} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Jelaskan kronologi insiden secara detail..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Batal</button><button className="btn btn-danger" onClick={handleSave}><AlertTriangle size={16} /> Laporkan Insiden</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
