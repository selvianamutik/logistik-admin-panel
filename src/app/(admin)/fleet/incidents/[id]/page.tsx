'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useToast } from '../../../layout';
import { Printer, Save } from 'lucide-react';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildIncidentPrintHtml,
    getAvailableIncidentStatuses,
    sortIncidentActionLogs,
} from '@/lib/fleet-incident-detail-support';
import { formatDateTime, INCIDENT_STATUS_MAP, URGENCY_MAP, INCIDENT_TYPE_MAP } from '@/lib/utils';
import type { Incident, IncidentActionLog } from '@/lib/types';
import PageBackButton from '@/components/PageBackButton';

export default function IncidentDetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const incidentId = params.id as string;
    const [incident, setIncident] = useState<Incident | null>(null);
    const [logs, setLogs] = useState<IncidentActionLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [actionNote, setActionNote] = useState('');
    const [savingStatus, setSavingStatus] = useState(false);

    const loadIncidentDetail = useCallback(async () => {
        setLoading(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ incidentRef: incidentId }));
            const [incidentData, actionLogs] = await Promise.all([
                fetchAdminData<Incident | null>(`/api/data?entity=incidents&id=${incidentId}`, 'Gagal memuat insiden'),
                fetchAllAdminCollectionData<IncidentActionLog>(`/api/data?entity=incident-action-logs&filter=${filter}`, 'Gagal memuat log insiden'),
            ]);

            setIncident(incidentData);
            setLogs(sortIncidentActionLogs(actionLogs || []));
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail insiden');
        } finally {
            setLoading(false);
        }
    }, [addToast, incidentId]);

    useEffect(() => {
        void loadIncidentDetail();
    }, [loadIncidentDetail]);

    const updateStatus = async () => {
        if (!newStatus || !actionNote) { addToast('error', 'Status dan catatan wajib'); return; }
        setSavingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', action: 'set-status', data: { id: incident?._id, status: newStatus, note: actionNote } }),
            });
            const d = await res.json();
            if (!res.ok) {
                addToast('error', d.error || 'Gagal memperbarui status insiden');
                return;
            }

            const timestamp = new Date().toISOString();
            setIncident(prev => prev ? { ...prev, status: newStatus as Incident['status'] } : prev);
            setLogs(prev => [...prev, {
                _id: 'new-' + Date.now(),
                _type: 'incidentActionLog',
                incidentRef: incident?._id || '',
                timestamp,
                note: actionNote,
            }]);
            setShowStatusModal(false);
            setActionNote('');
            setNewStatus('');
            addToast('success', 'Status insiden diperbarui');
        } catch {
            addToast('error', 'Gagal memperbarui status insiden');
        } finally {
            setSavingStatus(false);
        }
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;
    if (!incident) return <div className="empty-state"><div className="empty-state-title">Insiden tidak ditemukan</div></div>;

    const available = getAvailableIncidentStatuses(incident.status);
    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak insiden...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const company = resolveDocumentIssuerProfile(incident, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({
                title: 'Laporan Insiden Armada',
                subtitle: incident.incidentNumber,
                company,
                targetWindow: printWindow,
                bodyHtml: buildIncidentPrintHtml(incident, logs),
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/incidents" />
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {incident.incidentNumber}
                        <span className={`badge badge-${INCIDENT_STATUS_MAP[incident.status]?.color}`}><span className="badge-dot" /> {INCIDENT_STATUS_MAP[incident.status]?.label}</span>
                        <span className={`badge badge-${URGENCY_MAP[incident.urgency]?.color}`}>{URGENCY_MAP[incident.urgency]?.label}</span>
                    </h1>
                </div>
                <div className="page-actions">
                    {available.length > 0 && <button className="btn btn-primary" onClick={() => setShowStatusModal(true)}><Save size={16} /> Ubah Status</button>}
                    <button className="btn btn-secondary" onClick={handlePrint}><Printer size={16} /> Print</button>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Detail Insiden</span></div>
                    <div className="card-body">
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType}</div></div><div className="detail-item"><div className="detail-label">Waktu</div><div className="detail-value">{formatDateTime(incident.dateTime)}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value font-semibold">{incident.vehiclePlate}</div></div><div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{incident.driverName || '-'}</div></div></div>
                        <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi</div><div className="detail-value">{incident.locationText}</div></div><div className="detail-item"><div className="detail-label">Odometer</div><div className="detail-value">{incident.odometer?.toLocaleString()} km</div></div></div>
                        {incident.relatedDONumber && <div className="mt-2"><div className="detail-label">DO Internal Terkait</div><div className="detail-value"><a href={`/delivery-orders/${incident.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{incident.relatedDONumber}</a></div></div>}
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
                <div className="modal-overlay" onClick={() => { if (!savingStatus) setShowStatusModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Ubah Status Insiden</h3></div>
                        <div className="modal-body">
                            <div className="form-group"><label className="form-label">Status Baru</label>
                                <select className="form-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}><option value="">Pilih</option>{available.map(s => <option key={s} value={s}>{INCIDENT_STATUS_MAP[s]?.label}</option>)}</select></div>
                            <div className="form-group"><label className="form-label">Catatan <span className="required">*</span></label><textarea className="form-textarea" rows={3} value={actionNote} onChange={e => setActionNote(e.target.value)} placeholder="Jelaskan tindakan yang dilakukan..." /></div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={savingStatus}>Batal</button><button className="btn btn-primary" onClick={updateStatus} disabled={savingStatus}><Save size={16} /> {savingStatus ? 'Menyimpan...' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
