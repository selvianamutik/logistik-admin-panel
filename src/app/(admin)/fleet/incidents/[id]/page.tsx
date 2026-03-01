'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useToast } from '../../../layout';
import { ArrowLeft, Printer, Save, Plus } from 'lucide-react';
import { formatDate, formatDateTime, INCIDENT_STATUS_MAP, URGENCY_MAP, INCIDENT_TYPE_MAP } from '@/lib/utils';
import type { Incident, IncidentActionLog } from '@/lib/types';

export default function IncidentDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { addToast } = useToast();
    const [incident, setIncident] = useState<Incident | null>(null);
    const [logs, setLogs] = useState<IncidentActionLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [actionNote, setActionNote] = useState('');

    useEffect(() => {
        const id = params.id as string;
        Promise.all([
            fetch(`/api/data?entity=incidents&id=${id}`).then(r => r.json()),
            fetch(`/api/data?entity=incident-action-logs`).then(r => r.json()),
        ]).then(([inc, al]) => {
            setIncident(inc.data);
            setLogs((al.data || []).filter((l: IncidentActionLog) => l.incidentRef === id).sort((a: IncidentActionLog, b: IncidentActionLog) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));
            setLoading(false);
        });
    }, [params.id]);

    const updateStatus = async () => {
        if (!newStatus || !actionNote) { addToast('error', 'Status dan catatan wajib'); return; }
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'incidents', action: 'update', data: { id: incident?._id, updates: { status: newStatus } } }) });
        await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'incident-action-logs', data: { incidentRef: incident?._id, timestamp: new Date().toISOString(), note: actionNote } }) });
        setIncident(prev => prev ? { ...prev, status: newStatus as Incident['status'] } : prev);
        setLogs(prev => [...prev, { _id: 'new-' + Date.now(), _type: 'incidentActionLog', incidentRef: incident?._id || '', timestamp: new Date().toISOString(), note: actionNote }]);
        setShowStatusModal(false); setActionNote('');
        addToast('success', 'Status insiden diperbarui');
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!incident) return <div className="empty-state"><div className="empty-state-title">Insiden tidak ditemukan</div></div>;

    const nextStatuses: Record<string, string[]> = { OPEN: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED'], RESOLVED: ['CLOSED'] };
    const available = nextStatuses[incident.status] || [];

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <button className="btn btn-ghost btn-sm" onClick={() => router.push('/fleet/incidents')} style={{ flexShrink: 0 }}><ArrowLeft size={16} /></button>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {incident.incidentNumber}
                        <span className={`badge badge-${INCIDENT_STATUS_MAP[incident.status]?.color}`}><span className="badge-dot" /> {INCIDENT_STATUS_MAP[incident.status]?.label}</span>
                        <span className={`badge badge-${URGENCY_MAP[incident.urgency]?.color}`}>{URGENCY_MAP[incident.urgency]?.label}</span>
                    </h1>
                </div>
                <div className="page-actions">
                    {available.length > 0 && <button className="btn btn-primary" onClick={() => setShowStatusModal(true)}><Save size={16} /> Ubah Status</button>}
                    <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Detail Insiden</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType}</div></div><div className="detail-item"><div className="detail-label">Waktu</div><div className="detail-value">{formatDateTime(incident.dateTime)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value font-semibold">{incident.vehiclePlate}</div></div><div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{incident.driverName || '-'}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi</div><div className="detail-value">{incident.locationText}</div></div><div className="detail-item"><div className="detail-label">Odometer</div><div className="detail-value">{incident.odometer?.toLocaleString()} km</div></div></div>
                        {incident.relatedDONumber && <div className="mt-2"><div className="detail-label">DO Terkait</div><div className="detail-value"><a href={`/delivery-orders/${incident.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{incident.relatedDONumber}</a></div></div>}
                    </div>
                </div>
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Kronologi</span></div>
                    <div className="card-body"><p style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.8 }}>{incident.description}</p></div>
                </div>
            </div>

            <div className="card mt-6">
                <div className="card-header"><span className="card-header-title">Timeline Penanganan</span></div>
                <div className="card-body">
                    <div className="timeline">
                        {logs.map((l, idx) => (
                            <div key={l._id} className="timeline-item">
                                <div className={`timeline-dot ${idx === logs.length - 1 ? 'active' : ''}`} />
                                <div className="timeline-content"><div className="timeline-title">{l.note}</div><div className="timeline-meta">{formatDateTime(l.timestamp)} {l.userName ? `oleh ${l.userName}` : ''}</div></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {showStatusModal && (
                <div className="modal-overlay" onClick={() => setShowStatusModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Ubah Status Insiden</h3></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Status Baru</label>
                                <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}><option value="">Pilih</option>{available.map(s => <option key={s} value={s}>{INCIDENT_STATUS_MAP[s]?.label}</option>)}</select></div>
                            <div className="form-group"><label className="form-label">Catatan <span className="required">*</span></label><textarea className="form-textarea" rows={3} value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Jelaskan tindakan yang dilakukan..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowStatusModal(false)}>Batal</button><button className="btn btn-primary" onClick={updateStatus}><Save size={16} /> Simpan</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
