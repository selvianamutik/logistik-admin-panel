'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Search, Eye, Edit, Car, FileDown, Printer } from 'lucide-react';
import { useToast } from '../../layout';
import { VEHICLE_STATUS_MAP, formatDate } from '@/lib/utils';
import { exportVehicles } from '@/lib/export';
import { fetchCompanyProfile, openBrandedPrint } from '@/lib/print';
import type { Vehicle } from '@/lib/types';

export default function VehiclesPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [items, setItems] = useState<Vehicle[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    useEffect(() => {
        const loadVehicles = async () => {
            try {
                const res = await fetch('/api/data?entity=vehicles');
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || 'Gagal memuat data kendaraan');
                }
                setItems(payload.data || []);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data kendaraan');
            } finally {
                setLoading(false);
            }
        };

        void loadVehicles();
    }, [addToast]);

    const filtered = items.filter(v => {
        const m = !search || v.plateNumber?.toLowerCase().includes(search.toLowerCase()) || v.brandModel?.toLowerCase().includes(search.toLowerCase()) || v.unitCode?.toLowerCase().includes(search.toLowerCase());
        const s = !statusFilter || v.status === statusFilter;
        return m && s;
    });

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left"><h1 className="page-title">Kendaraan</h1><p className="page-subtitle">Kelola armada kendaraan perusahaan</p></div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => exportVehicles(filtered as unknown as Record<string, unknown>[])}>
                        <FileDown size={15} /> Excel
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const company = await fetchCompanyProfile();
                        openBrandedPrint({
                            title: 'Daftar Kendaraan',
                            company,
                            bodyHtml: `
                            <table><thead><tr><th>Kode</th><th>Plat Nomor</th><th>Merk/Model</th><th>Tipe</th><th>Tahun</th><th>Status</th><th>Odometer</th><th>Tgl Update</th></tr></thead>
                            <tbody>${filtered.map(v => `<tr><td class="b">${v.unitCode || '-'}</td><td>${v.plateNumber}</td><td>${v.brandModel}</td><td>${v.vehicleType}</td><td>${v.year}</td><td>${VEHICLE_STATUS_MAP[v.status]?.label || v.status}</td><td class="r">${v.lastOdometer ? `${v.lastOdometer.toLocaleString('id-ID')} km` : '-'}</td><td>${formatDate(v.lastOdometerAt)}</td></tr>`).join('')}</tbody></table>`,
                        });
                    }}>
                        <Printer size={15} /> Print
                    </button>
                    <Link href="/fleet/vehicles/new" className="btn btn-primary"><Plus size={18} /> Tambah Kendaraan</Link>
                </div>
            </div>
            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari plat, merk..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(VEHICLE_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper">
                    <table>
                        <thead><tr><th>Kode</th><th>Plat Nomor</th><th>Merk/Model</th><th>Tipe</th><th>Tahun</th><th>Status</th><th>Odometer</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                filtered.length === 0 ? <tr><td colSpan={8}><div className="empty-state"><Car size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada kendaraan</div></div></td></tr> :
                                    filtered.map(v => (
                                        <tr key={v._id}>
                                            <td className="font-mono text-muted">{v.unitCode}</td>
                                            <td className="font-semibold">{v.plateNumber}</td>
                                            <td>{v.brandModel}</td>
                                            <td>{v.vehicleType}</td>
                                            <td>{v.year}</td>
                                            <td><span className={`badge badge-${VEHICLE_STATUS_MAP[v.status]?.color}`}><span className="badge-dot" /> {VEHICLE_STATUS_MAP[v.status]?.label}</span></td>
                                            <td>{v.lastOdometer ? `${v.lastOdometer.toLocaleString()} km` : '-'}</td>
                                            <td><div className="table-actions">
                                                <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${v._id}`)}><Eye size={14} /> Lihat</button>
                                                <button className="table-action-btn" onClick={() => router.push(`/fleet/vehicles/${v._id}/edit`)}><Edit size={14} /> Edit</button>
                                            </div></td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
                {filtered.length > 0 && <div className="pagination"><div className="pagination-info">Menampilkan {filtered.length} kendaraan</div></div>}
            </div>
        </div>
    );
}
