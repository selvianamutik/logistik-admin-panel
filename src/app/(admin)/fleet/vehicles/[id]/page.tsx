'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp, useToast } from '../../../layout';
import { ArrowLeft, Save, Car, Wrench, AlertTriangle, Truck } from 'lucide-react';
import { VEHICLE_STATUS_MAP, MAINTENANCE_STATUS_MAP, INCIDENT_STATUS_MAP, DO_STATUS_MAP, formatDate, formatCurrency } from '@/lib/utils';
import type { Vehicle, Maintenance, Incident, DeliveryOrder, TireEvent, Expense } from '@/lib/types';

export default function VehicleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [vehicle, setVehicle] = useState<Vehicle | null>(null);
    const [maints, setMaints] = useState<Maintenance[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [dos, setDos] = useState<DeliveryOrder[]>([]);
    const [tireEvents, setTireEvents] = useState<TireEvent[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('profil');
    const isOwner = user?.role === 'OWNER';

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=vehicles&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=maintenances`).then(r => r.json()),
            fetch(`/api/data?entity=incidents`).then(r => r.json()),
            fetch(`/api/data?entity=delivery-orders`).then(r => r.json()),
            fetch(`/api/data?entity=tire-events`).then(r => r.json()),
            fetch(`/api/data?entity=expenses`).then(r => r.json()),
        ]).then(([v, m, i, d, t, e]) => {
            setVehicle(v.data);
            setMaints((m.data || []).filter((x: Maintenance) => x.vehicleRef === id));
            setIncidents((i.data || []).filter((x: Incident) => x.vehicleRef === id));
            setDos((d.data || []).filter((x: DeliveryOrder) => x.vehicleRef === id));
            setTireEvents((t.data || []).filter((x: TireEvent) => x.vehicleRef === id));
            setExpenses((e.data || []).filter((x: Expense) => x.relatedVehicleRef === id));
            setLoading(false);
        });
    }, [params.id]);

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    if (!vehicle) return <div className="empty-state"><div className="empty-state-title">Kendaraan tidak ditemukan</div></div>;

    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn-back" onClick={() => router.push('/fleet/vehicles')}><ArrowLeft size={16} /></button>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {vehicle.plateNumber}
                        <span className={`badge badge-${VEHICLE_STATUS_MAP[vehicle.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[vehicle.status]?.label}</span>
                    </h1>
                    <p className="page-subtitle">{vehicle.brandModel} - {vehicle.unitCode}</p>
                </div>
            </div>

            <div className="tabs">
                {['profil', 'do', 'maintenance', 'ban', 'insiden', ...(isOwner ? ['biaya'] : [])].map(t => (
                    <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                        {t === 'profil' ? 'Profil' : t === 'do' ? 'Riwayat DO' : t === 'maintenance' ? 'Maintenance' : t === 'ban' ? 'Ban' : t === 'insiden' ? 'Insiden' : 'Biaya'}
                    </button>
                ))}
            </div>

            {tab === 'profil' && (
                <div className="card">
                    <div className="card-body">
                        <div className="detail-grid">
                            <div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kode Unit</div><div className="detail-value font-mono">{vehicle.unitCode}</div></div><div className="detail-item"><div className="detail-label">Plat Nomor</div><div className="detail-value font-semibold">{vehicle.plateNumber}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{vehicle.vehicleType}</div></div><div className="detail-item"><div className="detail-label">Tahun</div><div className="detail-value">{vehicle.year}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Merk/Model</div><div className="detail-value">{vehicle.brandModel}</div></div><div className="detail-item"><div className="detail-label">Base</div><div className="detail-value">{vehicle.base || '-'}</div></div></div>
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Kapasitas (kg)</div><div className="detail-value">{vehicle.capacityKg || '-'}</div></div><div className="detail-item"><div className="detail-label">Kapasitas Vol (m3)</div><div className="detail-value">{vehicle.capacityVolume || '-'}</div></div></div>
                                {isOwner && <div className="detail-row"><div className="detail-item"><div className="detail-label">No. Rangka</div><div className="detail-value font-mono">{vehicle.chassisNumber || '-'}</div></div><div className="detail-item"><div className="detail-label">No. Mesin</div><div className="detail-value font-mono">{vehicle.engineNumber || '-'}</div></div></div>}
                                <div className="detail-row"><div className="detail-item"><div className="detail-label">Odometer Terakhir</div><div className="detail-value">{vehicle.lastOdometer ? `${vehicle.lastOdometer.toLocaleString()} km` : '-'}</div></div><div className="detail-item"><div className="detail-label">Tanggal Update</div><div className="detail-value">{formatDate(vehicle.lastOdometerAt)}</div></div></div>
                            </div>
                            <div>
                                <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                                    <div className="kpi-card"><div className="kpi-icon info"><Truck size={20} /></div><div className="kpi-content"><div className="kpi-label">Total DO</div><div className="kpi-value">{dos.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon warning"><Wrench size={20} /></div><div className="kpi-content"><div className="kpi-label">Maintenance</div><div className="kpi-value">{maints.length}</div></div></div>
                                    <div className="kpi-card"><div className="kpi-icon danger"><AlertTriangle size={20} /></div><div className="kpi-content"><div className="kpi-label">Insiden</div><div className="kpi-value">{incidents.length}</div></div></div>
                                    {isOwner && <div className="kpi-card"><div className="kpi-icon primary"><Car size={20} /></div><div className="kpi-content"><div className="kpi-label">Total Biaya</div><div className="kpi-value" style={{ fontSize: '1rem' }}>{formatCurrency(totalExpenses)}</div></div></div>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'do' && (
                <div className="card"><div className="table-wrapper"><table>
                    <thead><tr><th>No. DO</th><th>Tanggal</th><th>Customer</th><th>Status</th></tr></thead>
                    <tbody>{dos.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada riwayat DO</td></tr> : dos.map(d => (
                        <tr key={d._id}><td><a href={`/delivery-orders/${d._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{d.doNumber}</a></td><td>{formatDate(d.date)}</td><td>{d.customerName}</td><td><span className={`badge badge-${DO_STATUS_MAP[d.status]?.color}`}>{DO_STATUS_MAP[d.status]?.label}</span></td></tr>
                    ))}</tbody>
                </table></div></div>
            )}

            {tab === 'maintenance' && (
                <div className="card"><div className="table-wrapper"><table>
                    <thead><tr><th>Tipe</th><th>Jadwal</th><th>Status</th><th>Odometer</th><th>Vendor</th></tr></thead>
                    <tbody>{maints.length === 0 ? <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada maintenance</td></tr> : maints.map(m => (
                        <tr key={m._id}><td>{m.type}</td><td>{m.scheduleType === 'DATE' ? formatDate(m.plannedDate) : `${(m.plannedOdometer || 0).toLocaleString()} km`}</td><td><span className={`badge badge-${MAINTENANCE_STATUS_MAP[m.status]?.color}`}>{MAINTENANCE_STATUS_MAP[m.status]?.label}</span></td><td>{m.odometerAtService ? `${m.odometerAtService.toLocaleString()} km` : '-'}</td><td>{m.vendor || '-'}</td></tr>
                    ))}</tbody>
                </table></div></div>
            )}

            {tab === 'ban' && (
                <div className="card"><div className="card-body">
                    {tireEvents.length === 0 ? <p className="text-center text-muted">Belum ada riwayat ban</p> :
                        <div className="timeline">{tireEvents.map(te => (
                            <div key={te._id} className="timeline-item"><div className="timeline-dot active" /><div className="timeline-content"><div className="timeline-title">{te.action} - {te.tirePosition}</div><div className="timeline-meta">{formatDate(te.date)} - {te.odometer.toLocaleString()} km</div>{te.notes && <div className="timeline-text">{te.notes}</div>}</div></div>
                        ))}</div>}
                </div></div>
            )}

            {tab === 'insiden' && (
                <div className="card"><div className="table-wrapper"><table>
                    <thead><tr><th>No.</th><th>Tanggal</th><th>Tipe</th><th>Lokasi</th><th>Status</th></tr></thead>
                    <tbody>{incidents.length === 0 ? <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '2rem' }}>Tidak ada insiden</td></tr> : incidents.map(i => (
                        <tr key={i._id}><td><a href={`/fleet/incidents/${i._id}`} className="font-semibold" style={{ color: 'var(--color-primary)' }}>{i.incidentNumber}</a></td><td>{formatDate(i.dateTime)}</td><td>{i.incidentType}</td><td>{i.locationText}</td><td><span className={`badge badge-${INCIDENT_STATUS_MAP[i.status]?.color}`}>{INCIDENT_STATUS_MAP[i.status]?.label}</span></td></tr>
                    ))}</tbody>
                </table></div></div>
            )}

            {tab === 'biaya' && isOwner && (
                <div className="card"><div className="table-wrapper"><table>
                    <thead><tr><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th></tr></thead>
                    <tbody>{expenses.length === 0 ? <tr><td colSpan={4} className="text-center text-muted" style={{ padding: '2rem' }}>Belum ada pengeluaran</td></tr> : expenses.map(e => (
                        <tr key={e._id}><td>{formatDate(e.date)}</td><td>{e.categoryName}</td><td>{e.note || e.description}</td><td className="font-medium">{formatCurrency(e.amount)}</td></tr>
                    ))}</tbody>
                </table></div></div>
            )}
        </div>
    );
}
