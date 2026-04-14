'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Pencil, Plus, Printer, ReceiptText, Save, Trash2, XCircle } from 'lucide-react';

import CurrencyInput from '@/components/CurrencyInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import {
    buildIncidentPrintHtml,
    canDeleteIncidentSettlementLine,
    canEditIncidentSettlementLine,
    canMarkIncidentRecoveryPosted,
    canPostIncidentSettlementLine,
    createDefaultIncidentExpensePostForm,
    createDefaultIncidentSettlementForm,
    getAvailableIncidentStatusesForContext,
    getIncidentSettlementCategoryOptions,
    hasUnsettledIncidentSettlementLines,
    sortIncidentActionLogs,
    sortIncidentSettlementLines,
    summarizeIncidentSettlements,
} from '@/lib/fleet-incident-detail-support';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { hasPermission } from '@/lib/rbac';
import type {
    BankAccount,
    ExpenseCategory,
    Incident,
    IncidentActionLog,
    IncidentSettlementCategory,
    IncidentSettlementLine,
    IncidentSettlementLineType,
} from '@/lib/types';
import {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatQuantity,
    INCIDENT_SETTLEMENT_CATEGORY_MAP,
    INCIDENT_SETTLEMENT_LINE_TYPE_MAP,
    INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP,
    INCIDENT_SETTLEMENT_STATUS_MAP,
    INCIDENT_STATUS_MAP,
    INCIDENT_TYPE_MAP,
    URGENCY_MAP,
} from '@/lib/utils';
import { useApp, useToast } from '../../../layout';

const TYPE_OPTIONS: Array<{ value: IncidentSettlementLineType; label: string }> = [
    { value: 'COST', label: 'Biaya' },
    { value: 'COMPENSATION', label: 'Santunan' },
    { value: 'RECOVERY', label: 'Recovery' },
];
const RECIPIENT_OPTIONS = ['DRIVER', 'KERNET', 'THIRD_PARTY', 'FAMILY', 'VENDOR', 'INSURANCE', 'INTERNAL', 'OTHER'] as const;

export default function IncidentDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const incidentId = params.id as string;
    const canManageIncident = user ? hasPermission(user.role, 'incidents', 'update') : false;
    const canCreateExpense = user ? hasPermission(user.role, 'expenses', 'create') : false;

    const [incident, setIncident] = useState<Incident | null>(null);
    const [logs, setLogs] = useState<IncidentActionLog[]>([]);
    const [lines, setLines] = useState<IncidentSettlementLine[]>([]);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showStatusModal, setShowStatusModal] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [actionNote, setActionNote] = useState('');
    const [savingStatus, setSavingStatus] = useState(false);
    const [showLineModal, setShowLineModal] = useState(false);
    const [editingLine, setEditingLine] = useState<IncidentSettlementLine | null>(null);
    const [lineForm, setLineForm] = useState(createDefaultIncidentSettlementForm());
    const [savingLine, setSavingLine] = useState(false);
    const [showExpenseModal, setShowExpenseModal] = useState(false);
    const [postingLine, setPostingLine] = useState<IncidentSettlementLine | null>(null);
    const [expenseForm, setExpenseForm] = useState(createDefaultIncidentExpensePostForm());
    const [postingExpense, setPostingExpense] = useState(false);

    const loadDetail = useCallback(async () => {
        setLoading(true);
        try {
            const filter = encodeURIComponent(JSON.stringify({ incidentRef: incidentId }));
            const tasks: Array<Promise<unknown>> = [
                fetchAdminData<Incident | null>(`/api/data?entity=incidents&id=${incidentId}`, 'Gagal memuat insiden'),
                fetchAllAdminCollectionData<IncidentActionLog>(`/api/data?entity=incident-action-logs&filter=${filter}`, 'Gagal memuat log insiden'),
                fetchAllAdminCollectionData<IncidentSettlementLine>(`/api/data?entity=incident-settlement-lines&filter=${filter}`, 'Gagal memuat detail biaya insiden'),
            ];
            if (canCreateExpense) {
                tasks.push(
                    fetchAdminCollectionData<ExpenseCategory[]>('/api/data?entity=expense-categories', 'Gagal memuat referensi pengeluaran'),
                    fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat referensi pengeluaran'),
                );
            }
            const [incidentData, actionLogs, lineRows, categoryRows, accountRows] = await Promise.all(tasks);
            setIncident((incidentData as Incident | null) || null);
            setLogs(sortIncidentActionLogs((actionLogs as IncidentActionLog[]) || []));
            setLines(sortIncidentSettlementLines((lineRows as IncidentSettlementLine[]) || []));
            setExpenseCategories(canCreateExpense ? (((categoryRows as ExpenseCategory[]) || []).filter(item => item.active !== false)) : []);
            setBankAccounts(canCreateExpense ? (((accountRows as BankAccount[]) || []).filter(item => item.active !== false)) : []);
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail insiden');
        } finally {
            setLoading(false);
        }
    }, [addToast, canCreateExpense, incidentId]);

    useEffect(() => { void loadDetail(); }, [loadDetail]);

    const summary = useMemo(() => summarizeIncidentSettlements(lines), [lines]);
    const grossExposure = summary.totalCost + summary.totalCompensation;
    const netExposure = grossExposure - summary.postedRecovery;
    const hasPendingSettlement = useMemo(() => hasUnsettledIncidentSettlementLines(lines), [lines]);
    const availableStatuses = incident ? getAvailableIncidentStatusesForContext(incident.status, lines) : [];
    const lineCategories = getIncidentSettlementCategoryOptions(lineForm.lineType);
    const incidentClosed = incident?.status === 'CLOSED';

    const resetLineModal = () => {
        setShowLineModal(false);
        setEditingLine(null);
        setLineForm(createDefaultIncidentSettlementForm());
    };

    const openLineModal = (line?: IncidentSettlementLine) => {
        if (line) {
            setEditingLine(line);
            setLineForm({
                lineType: line.lineType,
                category: line.category,
                date: line.date,
                amount: line.amount,
                description: line.description,
                payeeName: line.payeeName || '',
                recipientType: line.recipientType || '',
                note: line.note || '',
            });
        } else {
            setEditingLine(null);
            setLineForm(createDefaultIncidentSettlementForm());
        }
        setShowLineModal(true);
    };

    const setLineType = (lineType: IncidentSettlementLineType) => {
        const categories = getIncidentSettlementCategoryOptions(lineType);
        setLineForm(prev => ({ ...prev, lineType, category: categories[0] as IncidentSettlementCategory, recipientType: lineType === 'COMPENSATION' ? prev.recipientType : '' }));
    };

    const handleIncidentStatusSave = async () => {
        if (!incident?._id || !incident._rev || !newStatus || !actionNote.trim()) {
            addToast('error', 'Status dan catatan wajib diisi');
            return;
        }
        setSavingStatus(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incidents', action: 'set-status', data: { id: incident._id, revision: incident._rev, status: newStatus, note: actionNote.trim() } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal memperbarui status insiden');
            addToast('success', 'Status insiden diperbarui');
            setShowStatusModal(false);
            setNewStatus('');
            setActionNote('');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal memperbarui status insiden');
        } finally {
            setSavingStatus(false);
        }
    };

    const handleLineSave = async () => {
        if (!incident?._id || !lineForm.description.trim() || lineForm.amount <= 0) return addToast('error', 'Deskripsi dan nominal wajib diisi');
        if (lineForm.lineType === 'COMPENSATION' && (!lineForm.payeeName.trim() || !lineForm.recipientType)) return addToast('error', 'Penerima santunan dan jenis penerima wajib diisi');
        if (lineForm.lineType === 'RECOVERY' && !lineForm.payeeName.trim()) return addToast('error', 'Sumber recovery wajib diisi');
        setSavingLine(true);
        try {
            const body = editingLine
                ? { entity: 'incident-settlement-lines', action: 'update', data: { id: editingLine._id, revision: editingLine._rev, updates: { ...lineForm, payeeName: lineForm.payeeName || undefined, recipientType: lineForm.recipientType || undefined, note: lineForm.note || undefined } } }
                : { entity: 'incident-settlement-lines', data: { incidentRef: incident._id, ...lineForm, payeeName: lineForm.payeeName || undefined, recipientType: lineForm.recipientType || undefined, note: lineForm.note || undefined } };
            const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal menyimpan detail insiden');
            addToast('success', editingLine ? 'Detail insiden diperbarui' : 'Detail insiden ditambahkan');
            resetLineModal();
            await loadDetail();
        } catch {
            addToast('error', 'Gagal menyimpan detail insiden');
        } finally {
            setSavingLine(false);
        }
    };

    const updateLineStatus = async (line: IncidentSettlementLine, status: string) => {
        if (!line._rev) return addToast('error', 'Revisi detail insiden tidak tersedia. Refresh halaman lalu coba lagi.');
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incident-settlement-lines', action: 'set-status', data: { id: line._id, revision: line._rev, status } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal mengubah status detail insiden');
            addToast('success', 'Status detail insiden diperbarui');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal mengubah status detail insiden');
        }
    };

    const deleteLine = async (line: IncidentSettlementLine) => {
        if (!line._rev) return addToast('error', 'Revisi detail insiden tidak tersedia. Refresh halaman lalu coba lagi.');
        if (!window.confirm('Hapus detail insiden draft ini?')) return;
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'incident-settlement-lines', action: 'delete', data: { id: line._id, revision: line._rev } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal menghapus detail insiden');
            addToast('success', 'Detail insiden dihapus');
            await loadDetail();
        } catch {
            addToast('error', 'Gagal menghapus detail insiden');
        }
    };

    const openExpenseModal = (line: IncidentSettlementLine) => {
        setPostingLine(line);
        setExpenseForm({ date: line.date, categoryRef: '', bankAccountRef: '', note: line.note || line.payeeName || '', description: line.description || '' });
        setShowExpenseModal(true);
    };

    const postExpense = async () => {
        if (!incident?._id || !postingLine?._id || !postingLine._rev) return addToast('error', 'Detail insiden tidak valid untuk diposting');
        if (!expenseForm.categoryRef) return addToast('error', 'Kategori pengeluaran wajib dipilih');
        setPostingExpense(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entity: 'expenses', data: { categoryRef: expenseForm.categoryRef, date: expenseForm.date, amount: postingLine.amount, note: expenseForm.note || undefined, description: expenseForm.description || undefined, bankAccountRef: expenseForm.bankAccountRef || undefined, relatedIncidentRef: incident._id, relatedIncidentSettlementLineRef: postingLine._id, relatedIncidentSettlementLineRevision: postingLine._rev } }),
            });
            const payload = await res.json();
            if (!res.ok) return addToast('error', payload.error || 'Gagal memposting pengeluaran insiden');
            addToast('success', 'Pengeluaran insiden berhasil diposting');
            setShowExpenseModal(false);
            setPostingLine(null);
            setExpenseForm(createDefaultIncidentExpensePostForm());
            await loadDetail();
        } catch {
            addToast('error', 'Gagal memposting pengeluaran insiden');
        } finally {
            setPostingExpense(false);
        }
    };

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak insiden...');
        if (!printWindow) return addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
        try {
            const company = resolveDocumentIssuerProfile(incident, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({ title: 'Laporan Insiden Armada', subtitle: incident?.incidentNumber, company, targetWindow: printWindow, bodyHtml: buildIncidentPrintHtml(incident as Incident, logs, lines) });
        } catch {
            try { printWindow.close(); } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    const renderActions = (line: IncidentSettlementLine) => (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {canManageIncident && !incidentClosed && canEditIncidentSettlementLine(line) && <button className="table-action-btn" onClick={() => openLineModal(line)}><Pencil size={14} /> Edit</button>}
            {canManageIncident && !incidentClosed && line.status === 'DRAFT' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'APPROVED')}><CheckCircle2 size={14} /> Approve</button>}
            {canManageIncident && !incidentClosed && line.status === 'APPROVED' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'DRAFT')}><XCircle size={14} /> Draft</button>}
            {canCreateExpense && canPostIncidentSettlementLine(line) && <button className="table-action-btn" onClick={() => openExpenseModal(line)}><ReceiptText size={14} /> Post Expense</button>}
            {canManageIncident && canMarkIncidentRecoveryPosted(line) && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'POSTED')}><CheckCircle2 size={14} /> Tandai Diterima</button>}
            {canManageIncident && line.status !== 'VOID' && line.status !== 'POSTED' && <button className="table-action-btn" onClick={() => void updateLineStatus(line, 'VOID')}><XCircle size={14} /> Void</button>}
            {canManageIncident && !incidentClosed && canDeleteIncidentSettlementLine(line) && <button className="table-action-btn danger" onClick={() => void deleteLine(line)}><Trash2 size={14} /> Hapus</button>}
        </div>
    );

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 260 }} /></div>;
    if (!incident) return <div className="empty-state"><div className="empty-state-title">Insiden tidak ditemukan</div></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <PageBackButton href="/fleet/incidents" />
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        {incident.incidentNumber}
                        <span className={`badge badge-${INCIDENT_STATUS_MAP[incident.status]?.color}`}>{INCIDENT_STATUS_MAP[incident.status]?.label}</span>
                        <span className={`badge badge-${URGENCY_MAP[incident.urgency]?.color}`}>{URGENCY_MAP[incident.urgency]?.label}</span>
                    </h1>
                </div>
                <div className="page-actions">
                    {canManageIncident && availableStatuses.length > 0 && <button className="btn btn-primary" onClick={() => setShowStatusModal(true)}><Save size={16} /> Ubah Status</button>}
                    {canManageIncident && !incidentClosed && <button className="btn btn-secondary" onClick={() => openLineModal()}><Plus size={16} /> Tambah Detail Biaya</button>}
                    <button className="btn btn-secondary" onClick={handlePrint}><Printer size={16} /> Print</button>
                </div>
            </div>

            <div className="detail-grid">
                <div className="card"><div className="card-header"><span className="card-header-title">Detail Insiden</span></div><div className="card-body">
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Tipe</div><div className="detail-value">{INCIDENT_TYPE_MAP[incident.incidentType] || incident.incidentType}</div></div><div className="detail-item"><div className="detail-label">Waktu</div><div className="detail-value">{formatDateTime(incident.dateTime)}</div></div></div>
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Kendaraan</div><div className="detail-value font-semibold">{incident.vehiclePlate}</div></div><div className="detail-item"><div className="detail-label">Driver</div><div className="detail-value">{incident.driverName || '-'}</div></div></div>
                    <div className="detail-row"><div className="detail-item"><div className="detail-label">Lokasi</div><div className="detail-value">{incident.locationText}</div></div><div className="detail-item"><div className="detail-label">Odometer</div><div className="detail-value">{incident.odometer ? `${formatQuantity(incident.odometer, 0)} km` : '-'}</div></div></div>
                    {incident.relatedDONumber && <div className="mt-2"><div className="detail-label">DO Internal Terkait</div><div className="detail-value"><a href={`/delivery-orders/${incident.relatedDeliveryOrderRef}`} style={{ color: 'var(--color-primary)' }}>{incident.relatedDONumber}</a></div></div>}
                </div></div>
                <div className="card"><div className="card-header"><span className="card-header-title">Kronologi</span></div><div className="card-body"><p style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.8 }}>{incident.description}</p></div></div>
            </div>

            <div className="kpi-grid" style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Biaya</div><div className="kpi-value" style={{ color: 'var(--color-danger)', fontSize: '1.05rem' }}>{formatCurrency(summary.totalCost)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Total Santunan</div><div className="kpi-value" style={{ color: 'var(--color-warning)', fontSize: '1.05rem' }}>{formatCurrency(summary.totalCompensation)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Recovery Diterima</div><div className="kpi-value" style={{ color: 'var(--color-success)', fontSize: '1.05rem' }}>{formatCurrency(summary.postedRecovery)}</div></div></div>
                <div className="kpi-card"><div className="kpi-content"><div className="kpi-label">Net Exposure</div><div className="kpi-value" style={{ fontSize: '1.05rem' }}>{formatCurrency(netExposure)}</div></div></div>
            </div>

            <div className="card" style={{ marginBottom: '1.5rem' }}><div className="card-header"><span className="card-header-title">Ringkasan Finansial</span></div><div className="card-body">
                <div className="detail-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <div className="detail-item"><div className="detail-label">Gross Exposure</div><div className="detail-value font-semibold">{formatCurrency(grossExposure)}</div></div>
                    <div className="detail-item"><div className="detail-label">Biaya Sudah Diposting</div><div className="detail-value">{formatCurrency(summary.postedCost)}</div></div>
                    <div className="detail-item"><div className="detail-label">Biaya Belum Diposting</div><div className="detail-value">{formatCurrency(summary.openCost)}</div></div>
                    <div className="detail-item"><div className="detail-label">Recovery Belum Diterima</div><div className="detail-value">{formatCurrency(summary.pendingRecovery)}</div></div>
                </div>
                <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>Recovery baru mengurangi exposure ketika statusnya sudah ditandai diterima.</div>
                {incident.status === 'RESOLVED' && hasPendingSettlement && (
                    <div style={{ marginTop: '0.85rem', fontSize: '0.82rem', color: 'var(--color-warning)' }}>
                        Insiden belum bisa ditutup karena masih ada detail biaya, santunan, atau recovery yang belum diposting atau di-void.
                    </div>
                )}
            </div></div>

            <div className="card mt-6"><div className="card-header"><span className="card-header-title">Detail Biaya, Santunan, dan Recovery</span></div><div className="card-body">
                <div className="table-wrapper table-desktop-only"><table><thead><tr><th>Tanggal</th><th>Tipe</th><th>Kategori</th><th>Deskripsi</th><th>Pihak</th><th>Status</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody>
                    {lines.length === 0 ? <tr><td colSpan={8}><div className="empty-state"><div className="empty-state-title">Belum ada detail biaya insiden</div><div className="empty-state-text">Tambahkan biaya, santunan, atau recovery supaya settlement insiden bisa ditracking dari halaman ini.</div></div></td></tr> : lines.map(line => (
                        <tr key={line._id}>
                            <td className="text-muted">{formatDate(line.date)}</td>
                            <td><span className={`badge badge-${INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.color}`}>{INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.label}</span></td>
                            <td>{INCIDENT_SETTLEMENT_CATEGORY_MAP[line.category] || line.category}</td>
                            <td><div className="font-semibold">{line.description}</div>{line.note && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>{line.note}</div>}{line.linkedExpenseRef && <div style={{ fontSize: '0.72rem', color: 'var(--color-success)', marginTop: '0.25rem' }}>Expense {line.linkedExpenseRef}</div>}</td>
                            <td><div>{line.payeeName || '-'}</div>{line.recipientType && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[line.recipientType] || line.recipientType}</div>}</td>
                            <td><span className={`badge badge-${INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.color}`}>{INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.label}</span></td>
                            <td className="font-semibold">{formatCurrency(line.amount)}</td>
                            <td>{renderActions(line)}</td>
                        </tr>
                    ))}
                </tbody></table></div>
                <div className="mobile-record-list">
                    {lines.length === 0 ? <div className="mobile-record-card"><div className="mobile-record-title">Belum ada detail biaya insiden</div><div className="mobile-record-subtitle">Tambahkan dari halaman ini.</div></div> : lines.map(line => (
                        <div key={line._id} className="mobile-record-card">
                            <div className="mobile-record-header"><div><div className="mobile-record-title">{line.description}</div><div className="mobile-record-subtitle">{formatDate(line.date)} | {INCIDENT_SETTLEMENT_CATEGORY_MAP[line.category] || line.category}</div></div><div className="text-right"><div className="font-semibold">{formatCurrency(line.amount)}</div><div style={{ marginTop: 4 }}><span className={`badge badge-${INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.color}`}>{INCIDENT_SETTLEMENT_STATUS_MAP[line.status]?.label}</span></div></div></div>
                            <div className="mobile-record-meta"><div className="mobile-record-kv"><span className="mobile-record-label">Tipe</span><span className="mobile-record-value">{INCIDENT_SETTLEMENT_LINE_TYPE_MAP[line.lineType]?.label}</span></div><div className="mobile-record-kv"><span className="mobile-record-label">Pihak</span><span className="mobile-record-value">{line.payeeName || '-'}</span></div>{line.recipientType && <div className="mobile-record-kv"><span className="mobile-record-label">Kategori Pihak</span><span className="mobile-record-value">{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[line.recipientType] || line.recipientType}</span></div>}{line.note && <div className="mobile-record-kv"><span className="mobile-record-label">Catatan</span><span className="mobile-record-value">{line.note}</span></div>}</div>
                            {canManageIncident && <div className="mobile-record-actions">{renderActions(line)}</div>}
                        </div>
                    ))}
                </div>
            </div></div>

            <div className="card mt-6"><div className="card-header"><span className="card-header-title">Timeline Penanganan</span></div><div className="card-body"><div className="timeline">{logs.map((item, idx) => <div key={item._id} className="timeline-item"><div className={`timeline-dot ${idx === logs.length - 1 ? 'active' : ''}`} /><div className="timeline-content"><div className="timeline-title">{item.note}</div><div className="timeline-meta">{formatDateTime(item.timestamp)} {item.userName ? `oleh ${item.userName}` : ''}</div></div></div>)}</div></div></div>

            {showStatusModal && <div className="modal-overlay" onClick={() => { if (!savingStatus) setShowStatusModal(false); }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Ubah Status Insiden</h3></div><div className="modal-body"><div className="form-group"><label className="form-label">Status Baru</label><select className="form-select" value={newStatus} onChange={event => setNewStatus(event.target.value)}><option value="">Pilih</option>{availableStatuses.map(status => <option key={status} value={status}>{INCIDENT_STATUS_MAP[status]?.label}</option>)}</select></div><div className="form-group"><label className="form-label">Catatan <span className="required">*</span></label><textarea className="form-textarea" rows={3} value={actionNote} onChange={event => setActionNote(event.target.value)} placeholder="Jelaskan tindakan yang dilakukan..." /></div></div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowStatusModal(false)} disabled={savingStatus}>Batal</button><button className="btn btn-primary" onClick={handleIncidentStatusSave} disabled={savingStatus}><Save size={16} /> {savingStatus ? 'Menyimpan...' : 'Simpan'}</button></div></div></div>}

            {showLineModal && <div className="modal-overlay" onClick={() => { if (!savingLine) resetLineModal(); }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">{editingLine ? 'Edit Detail Insiden' : 'Tambah Detail Insiden'}</h3></div><div className="modal-body">
                <div className="form-row"><div className="form-group"><label className="form-label">Tipe Detail</label><select className="form-select" value={lineForm.lineType} onChange={event => setLineType(event.target.value as IncidentSettlementLineType)}>{TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="form-group"><label className="form-label">Tanggal</label><input type="date" className="form-input" value={lineForm.date} onChange={event => setLineForm(prev => ({ ...prev, date: event.target.value }))} /></div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Kategori</label><select className="form-select" value={lineForm.category} onChange={event => setLineForm(prev => ({ ...prev, category: event.target.value as IncidentSettlementCategory }))}>{lineCategories.map(category => <option key={category} value={category}>{INCIDENT_SETTLEMENT_CATEGORY_MAP[category]}</option>)}</select></div><div className="form-group"><label className="form-label">Nominal</label><CurrencyInput value={lineForm.amount} onValueChange={value => setLineForm(prev => ({ ...prev, amount: value }))} placeholder="Masukkan nominal" /></div></div>
                <div className="form-group"><label className="form-label">Deskripsi <span className="required">*</span></label><input className="form-input" value={lineForm.description} onChange={event => setLineForm(prev => ({ ...prev, description: event.target.value }))} placeholder="Contoh: Derek ke bengkel, santunan driver, recovery asuransi" /></div>
                <div className="form-row"><div className="form-group"><label className="form-label">{lineForm.lineType === 'COMPENSATION' ? 'Penerima Santunan' : lineForm.lineType === 'RECOVERY' ? 'Sumber Recovery' : 'Vendor / Pihak Terkait'}{lineForm.lineType !== 'COST' && <span className="required"> *</span>}</label><input className="form-input" value={lineForm.payeeName} onChange={event => setLineForm(prev => ({ ...prev, payeeName: event.target.value }))} placeholder={lineForm.lineType === 'RECOVERY' ? 'Contoh: PT Asuransi ABC' : 'Nama pihak terkait'} /></div>{lineForm.lineType === 'COMPENSATION' && <div className="form-group"><label className="form-label">Jenis Penerima <span className="required">*</span></label><select className="form-select" value={lineForm.recipientType} onChange={event => setLineForm(prev => ({ ...prev, recipientType: event.target.value }))}><option value="">Pilih</option>{RECIPIENT_OPTIONS.map(option => <option key={option} value={option}>{INCIDENT_SETTLEMENT_RECIPIENT_TYPE_MAP[option]}</option>)}</select></div>}</div>
                <div className="form-group"><label className="form-label">Catatan</label><textarea className="form-textarea" rows={3} value={lineForm.note} onChange={event => setLineForm(prev => ({ ...prev, note: event.target.value }))} placeholder="Keterangan tambahan, nomor kuitansi, atau konteks approval" /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={resetLineModal} disabled={savingLine}>Batal</button><button className="btn btn-primary" onClick={handleLineSave} disabled={savingLine}><Save size={16} /> {savingLine ? 'Menyimpan...' : 'Simpan'}</button></div></div></div>}

            {showExpenseModal && postingLine && <div className="modal-overlay" onClick={() => { if (!postingExpense) { setShowExpenseModal(false); setPostingLine(null); } }}><div className="modal" onClick={event => event.stopPropagation()}><div className="modal-header"><h3 className="modal-title">Posting ke Pengeluaran</h3></div><div className="modal-body">
                <div style={{ padding: '0.85rem 1rem', borderRadius: 12, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', marginBottom: '1rem' }}><div style={{ fontWeight: 700 }}>{postingLine.description}</div><div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>{INCIDENT_SETTLEMENT_CATEGORY_MAP[postingLine.category]} | {formatCurrency(postingLine.amount)}</div></div>
                <div className="form-row"><div className="form-group"><label className="form-label">Tanggal Posting</label><input type="date" className="form-input" value={expenseForm.date} onChange={event => setExpenseForm(prev => ({ ...prev, date: event.target.value }))} /></div><div className="form-group"><label className="form-label">Kategori Pengeluaran <span className="required">*</span></label><select className="form-select" value={expenseForm.categoryRef} onChange={event => setExpenseForm(prev => ({ ...prev, categoryRef: event.target.value }))}><option value="">Pilih kategori</option>{expenseCategories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></div></div>
                <div className="form-group"><label className="form-label">Bayar dari Rekening / Kas</label><select className="form-select" value={expenseForm.bankAccountRef} onChange={event => setExpenseForm(prev => ({ ...prev, bankAccountRef: event.target.value }))}><option value="">-- Tidak dipilih --</option>{bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}</select></div>
                <div className="form-group"><label className="form-label">Catatan Pengeluaran</label><input className="form-input" value={expenseForm.note} onChange={event => setExpenseForm(prev => ({ ...prev, note: event.target.value }))} placeholder="Catatan singkat pengeluaran" /></div>
                <div className="form-group"><label className="form-label">Deskripsi Pengeluaran</label><textarea className="form-textarea" rows={3} value={expenseForm.description} onChange={event => setExpenseForm(prev => ({ ...prev, description: event.target.value }))} placeholder="Deskripsi yang akan tersimpan di modul pengeluaran" /></div>
            </div><div className="modal-footer"><button className="btn btn-secondary" onClick={() => { setShowExpenseModal(false); setPostingLine(null); }} disabled={postingExpense}>Batal</button><button className="btn btn-primary" onClick={postExpense} disabled={postingExpense}><ReceiptText size={16} /> {postingExpense ? 'Memposting...' : 'Posting Pengeluaran'}</button></div></div></div>}
        </div>
    );
}
