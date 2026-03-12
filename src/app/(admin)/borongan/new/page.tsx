'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

import type { DeliveryOrder, DeliveryOrderItem, Driver } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

import { useToast } from '../../layout';

interface BoronganRow {
    id: string;
    doRef: string;
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket: string;
}

function createEmptyRow(): BoronganRow {
    return {
        id: Math.random().toString(36).slice(2),
        doRef: '',
        doNumber: '',
        vehiclePlate: '',
        date: new Date().toISOString().split('T')[0],
        noSJ: '',
        tujuan: '',
        barang: '',
        collie: 0,
        beratKg: 0,
        tarip: 0,
        uangRp: 0,
        ket: '',
    };
}

function isEmptyRow(row: BoronganRow) {
    return (
        !row.doRef &&
        !row.doNumber &&
        !row.vehiclePlate &&
        !row.noSJ &&
        !row.tujuan &&
        !row.barang &&
        !row.ket &&
        (row.collie || 0) === 0 &&
        (row.beratKg || 0) === 0 &&
        (row.tarip || 0) === 0 &&
        (row.uangRp || 0) === 0
    );
}

export default function NewBoronganPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [deliveryOrderItems, setDeliveryOrderItems] = useState<DeliveryOrderItem[]>([]);
    const [usedBoronganDoRefs, setUsedBoronganDoRefs] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const [driverRef, setDriverRef] = useState('');
    const [driverName, setDriverName] = useState('');
    const [periodStart, setPeriodStart] = useState(new Date().toISOString().split('T')[0]);
    const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<BoronganRow[]>([createEmptyRow()]);

    useEffect(() => {
        async function loadData() {
            try {
                const [driverResponse, deliveryOrderResponse, doItemResponse, boronganItemResponse] = await Promise.all([
                    fetch('/api/data?entity=drivers').then(response => response.json()),
                    fetch('/api/data?entity=delivery-orders').then(response => response.json()),
                    fetch('/api/data?entity=delivery-order-items').then(response => response.json()),
                    fetch('/api/data?entity=driver-borogan-items').then(response => response.json()),
                ]);
                setDrivers(driverResponse.data || []);
                setDeliveryOrders((deliveryOrderResponse.data || []).filter((item: DeliveryOrder) => item.status === 'DELIVERED'));
                setDeliveryOrderItems(doItemResponse.data || []);
                setUsedBoronganDoRefs(
                    (boronganItemResponse.data || [])
                        .map((item: { doRef?: string }) => item.doRef)
                        .filter((value: string | undefined): value is string => Boolean(value))
                );
            } catch {
                addToast('error', 'Gagal memuat data borongan');
            }
        }

        void loadData();
    }, [addToast]);

    const buildBoronganRowFromDO = (deliveryOrder: DeliveryOrder): BoronganRow => {
        const relatedItems = deliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
        const descriptions = [...new Set(
            relatedItems
                .map(item => item.orderItemDescription?.trim())
                .filter((value): value is string => Boolean(value))
        )];
        const collie = relatedItems.reduce((sum, item) => sum + Number(item.orderItemQtyKoli || 0), 0);
        const beratKg = relatedItems.reduce((sum, item) => sum + Number(item.orderItemWeight || 0), 0);
        const tarip = Number(deliveryOrder.taripBorongan || 0);

        return {
            id: Math.random().toString(36).slice(2),
            doRef: deliveryOrder._id,
            doNumber: deliveryOrder.doNumber || '',
            vehiclePlate: deliveryOrder.vehiclePlate || '',
            date: deliveryOrder.date || new Date().toISOString().split('T')[0],
            noSJ: deliveryOrder.doNumber || '',
            tujuan: deliveryOrder.receiverAddress || '',
            barang: descriptions.join(', '),
            collie,
            beratKg,
            tarip,
            uangRp: beratKg * tarip,
            ket: deliveryOrder.keteranganBorongan || '',
        };
    };

    const updateRow = (id: string, field: keyof BoronganRow, value: string | number) => {
        setRows(previous =>
            previous.map(row => {
                if (row.id !== id) return row;
                const updated = { ...row, [field]: value };
                if (field === 'beratKg' || field === 'tarip') {
                    updated.uangRp = updated.beratKg * updated.tarip;
                }
                return updated;
            })
        );
    };

    const addDORow = (doId: string) => {
        const deliveryOrder = deliveryOrders.find(item => item._id === doId);
        if (!deliveryOrder) {
            addToast('error', 'DO tidak ditemukan');
            return;
        }
        if (rows.some(row => row.doRef === doId)) {
            addToast('error', 'DO ini sudah ada di slip borongan');
            return;
        }
        if (usedBoronganDoRefs.includes(doId)) {
            addToast('error', 'DO ini sudah tercantum di slip borongan lain');
            return;
        }

        if (driverRef && deliveryOrder.driverRef && deliveryOrder.driverRef !== driverRef) {
            addToast('error', 'DO ini milik supir lain');
            return;
        }

        const nextRow = buildBoronganRowFromDO(deliveryOrder);
        if (!driverRef && deliveryOrder.driverRef) {
            setDriverRef(deliveryOrder.driverRef);
            setDriverName(deliveryOrder.driverName || drivers.find(driver => driver._id === deliveryOrder.driverRef)?.name || '');
        } else if (!driverName && deliveryOrder.driverName) {
            setDriverName(deliveryOrder.driverName);
        }

        if (!nextRow.tarip) {
            addToast('info', 'Tarip borongan DO ini belum diisi. Cek dan lengkapi sebelum simpan.');
        }

        setRows(previous => {
            const emptyIndex = previous.findIndex(isEmptyRow);
            if (emptyIndex === -1) {
                return [...previous, nextRow];
            }

            const next = [...previous];
            next[emptyIndex] = { ...nextRow, id: previous[emptyIndex].id };
            return next;
        });
    };

    const removeRow = (id: string) => {
        setRows(previous => {
            const next = previous.filter(row => row.id !== id);
            return next.length > 0 ? next : [createEmptyRow()];
        });
    };

    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalBerat = rows.reduce((sum, row) => sum + (row.beratKg || 0), 0);
    const totalAmount = rows.reduce((sum, row) => sum + (row.uangRp || 0), 0);
    const hasSelectedRows = rows.some(row => Boolean(row.doRef));

    const handleSave = async () => {
        if (!driverName) {
            addToast('error', 'Nama supir wajib diisi');
            return;
        }

        const filledRows = rows.filter(row => !isEmptyRow(row));
        if (filledRows.length === 0) {
            addToast('error', 'Minimal 1 baris perjalanan');
            return;
        }

        setSaving(true);
        try {
            const response = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-borongans',
                    action: 'create-with-items',
                    data: {
                        driverRef: driverRef || undefined,
                        driverName,
                        periodStart,
                        periodEnd,
                        notes: notes || undefined,
                        items: filledRows,
                    },
                }),
            });
            const payload = await response.json();
            if (!response.ok) {
                addToast('error', payload.error || 'Gagal membuat slip borongan');
                return;
            }

            addToast('success', 'Slip borongan berhasil dibuat');
            router.push(`/borongan/${payload.data._id}`);
        } catch {
            addToast('error', 'Gagal membuat slip borongan');
        } finally {
            setSaving(false);
        }
    };

    const driverDOs = driverRef
        ? deliveryOrders.filter(deliveryOrder => deliveryOrder.driverRef === driverRef)
        : deliveryOrders;

    const selectedDoRefs = new Set(rows.map(row => row.doRef).filter(Boolean));
    const blockedDoRefs = new Set(usedBoronganDoRefs);
    const availableDriverDOs = driverDOs.filter(
        deliveryOrder => !selectedDoRefs.has(deliveryOrder._id) && !blockedDoRefs.has(deliveryOrder._id)
    );

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="btn-back" onClick={() => router.push('/borongan')}>
                    <ArrowLeft size={16} />
                </button>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Buat Slip Borongan Supir</h1>
            </div>

            <div className="detail-grid">
                <div>
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Info Supir & Periode</span>
                        </div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">
                                    Supir <span className="required">*</span>
                                </label>
                                <select
                                    className="form-select"
                                    disabled={hasSelectedRows}
                                    value={driverRef}
                                    onChange={event => {
                                        const selectedId = event.target.value;
                                        setDriverRef(selectedId);
                                        const driver = drivers.find(item => item._id === selectedId);
                                        setDriverName(driver?.name || '');
                                    }}
                                >
                                    <option value="">-- Pilih Supir --</option>
                                    {drivers.map(driver => (
                                        <option key={driver._id} value={driver._id}>
                                            {driver.name}
                                        </option>
                                    ))}
                                </select>
                                {hasSelectedRows && (
                                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        Supir terkunci selama masih ada baris DO. Hapus dulu baris terkait jika ingin mengganti supir.
                                    </p>
                                )}
                            </div>
                            {!driverRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama supir</label>
                                    <input
                                        className="form-input"
                                        value={driverName}
                                        onChange={event => setDriverName(event.target.value)}
                                        placeholder="Nama supir..."
                                    />
                                </div>
                            )}
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Periode Mulai</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={periodStart}
                                        onChange={event => setPeriodStart(event.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Periode Akhir</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={periodEnd}
                                        onChange={event => setPeriodEnd(event.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea
                                    className="form-textarea"
                                    rows={2}
                                    value={notes}
                                    onChange={event => setNotes(event.target.value)}
                                    placeholder="Opsional..."
                                />
                            </div>
                        </div>
                    </div>

                    <div className="card" style={{ marginTop: '1rem' }}>
                        <div className="card-header">
                            <span className="card-header-title">Tambah dari Surat Jalan</span>
                        </div>
                        <div className="card-body">
                            <select
                                className="form-select"
                                onChange={event => {
                                    if (event.target.value) {
                                        addDORow(event.target.value);
                                        event.target.value = '';
                                    }
                                }}
                            >
                                <option value="">-- Pilih DO yang selesai --</option>
                                {availableDriverDOs.map(deliveryOrder => (
                                    <option key={deliveryOrder._id} value={deliveryOrder._id}>
                                        {deliveryOrder.doNumber} - {deliveryOrder.receiverAddress || '-'}
                                    </option>
                                ))}
                            </select>
                            <p style={{ margin: '0.65rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                DO yang sudah dipakai di slip lain atau sudah kamu pilih di tabel otomatis disembunyikan.
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', padding: '1.25rem' }}>
                            <div style={{ fontSize: '0.72rem', opacity: 0.8, textTransform: 'uppercase', marginBottom: '0.25rem' }}>
                                Total Upah Borongan
                            </div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Collie</span>
                                <strong>{totalCollie}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', fontSize: '0.85rem' }}>
                                <span className="text-muted">Total Berat</span>
                                <strong>{totalBerat.toLocaleString('id')} kg</strong>
                            </div>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Slip Borongan'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Perincian Perjalanan</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => setRows(previous => [...previous, createEmptyRow()])}>
                        <Plus size={14} /> Tambah Baris
                    </button>
                </div>
                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 800 }}>
                        <thead>
                            <tr>
                                <th>NO.TRUCK</th>
                                <th>TANGGAL</th>
                                <th>NO.SJ</th>
                                <th>TUJUAN</th>
                                <th>BARANG</th>
                                <th>COLLIE</th>
                                <th>BERAT KG</th>
                                <th>TARIP</th>
                                <th>UANG RP</th>
                                <th>KET</th>
                                <th style={{ width: 36 }} />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.id}>
                                    <td>
                                        <input
                                            className="form-input"
                                            style={{ minWidth: 75 }}
                                            value={row.vehiclePlate}
                                            onChange={event => updateRow(row.id, 'vehiclePlate', event.target.value)}
                                            placeholder="Plat..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="date"
                                            className="form-input"
                                            value={row.date}
                                            onChange={event => updateRow(row.id, 'date', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.noSJ}
                                            onChange={event => updateRow(row.id, 'noSJ', event.target.value)}
                                            placeholder="No. SJ..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.tujuan}
                                            onChange={event => updateRow(row.id, 'tujuan', event.target.value)}
                                            placeholder="Tujuan..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.barang}
                                            onChange={event => updateRow(row.id, 'barang', event.target.value)}
                                            placeholder="Barang..."
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="number"
                                            className="form-input"
                                            value={row.collie || ''}
                                            onChange={event => updateRow(row.id, 'collie', Number(event.target.value))}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="number"
                                            className="form-input"
                                            value={row.beratKg || ''}
                                            onChange={event => updateRow(row.id, 'beratKg', Number(event.target.value))}
                                        />
                                    </td>
                                    <td>
                                        <input
                                            type="number"
                                            className="form-input"
                                            value={row.tarip || ''}
                                            onChange={event => updateRow(row.id, 'tarip', Number(event.target.value))}
                                        />
                                    </td>
                                    <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{formatCurrency(row.uangRp)}</td>
                                    <td>
                                        <input
                                            className="form-input"
                                            value={row.ket}
                                            onChange={event => updateRow(row.id, 'ket', event.target.value)}
                                        />
                                    </td>
                                    <td>
                                        <button className="table-action-btn danger" onClick={() => removeRow(row.id)}>
                                            <Trash2 size={13} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            <tr style={{ background: 'var(--color-bg-secondary)', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
                                <td colSpan={5} style={{ textAlign: 'right', paddingRight: '0.75rem' }}>
                                    Jumlah
                                </td>
                                <td>{totalCollie}</td>
                                <td>{totalBerat.toLocaleString('id')}</td>
                                <td />
                                <td style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalAmount)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
