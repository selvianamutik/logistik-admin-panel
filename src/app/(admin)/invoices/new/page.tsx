'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';

import type { CompanyProfile, Customer, DeliveryOrder, DeliveryOrderItem, Order } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';

import { useToast } from '../../layout';

interface NotaItemRow {
    id: string;
    doRef: string;
    doNumber: string;
    vehiclePlate: string;
    date: string;
    noSJ: string;
    dari: string;
    tujuan: string;
    barang: string;
    collie: number;
    beratKg: number;
    tarip: number;
    uangRp: number;
    ket: string;
}

function createEmptyRow(): NotaItemRow {
    return {
        id: Math.random().toString(36).slice(2),
        doRef: '',
        doNumber: '',
        vehiclePlate: '',
        date: new Date().toISOString().split('T')[0],
        noSJ: '',
        dari: '',
        tujuan: '',
        barang: '',
        collie: 0,
        beratKg: 0,
        tarip: 0,
        uangRp: 0,
        ket: '',
    };
}

function isEmptyRow(row: NotaItemRow) {
    return (
        !row.doRef &&
        !row.doNumber &&
        !row.vehiclePlate &&
        !row.noSJ &&
        !row.dari &&
        !row.tujuan &&
        !row.barang &&
        !row.ket &&
        (row.collie || 0) === 0 &&
        (row.beratKg || 0) === 0 &&
        (row.tarip || 0) === 0 &&
        (row.uangRp || 0) === 0
    );
}

export default function NewNotaPage() {
    const router = useRouter();
    const { addToast } = useToast();
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
    const [deliveryOrderItems, setDeliveryOrderItems] = useState<DeliveryOrderItem[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [usedNotaDoRefs, setUsedNotaDoRefs] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    const [customerRef, setCustomerRef] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [issueDate, setIssueDate] = useState(new Date().toISOString().split('T')[0]);
    const [dueDate, setDueDate] = useState('');
    const [dueDateTouched, setDueDateTouched] = useState(false);
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<NotaItemRow[]>([createEmptyRow()]);

    useEffect(() => {
        async function loadData() {
            const fetchEntity = async <T,>(url: string, fallbackMessage: string) => {
                const res = await fetch(url);
                const payload = await res.json();
                if (!res.ok) {
                    throw new Error(payload.error || fallbackMessage);
                }
                return payload.data as T;
            };

            try {
                const [cust, comp, dos, ords, doItems, notaItems] = await Promise.all([
                    fetchEntity<Customer[]>('/api/data?entity=customers', 'Gagal memuat customer'),
                    fetchEntity<CompanyProfile | null>('/api/data?entity=company', 'Gagal memuat profil perusahaan'),
                    fetchEntity<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat surat jalan'),
                    fetchEntity<Order[]>('/api/data?entity=orders', 'Gagal memuat order'),
                    fetchEntity<DeliveryOrderItem[]>('/api/data?entity=delivery-order-items', 'Gagal memuat item DO'),
                    fetchEntity<Array<{ doRef?: string }>>('/api/data?entity=freight-nota-items', 'Gagal memuat pemakaian DO nota'),
                ]);
                setCustomers(cust || []);
                setCompany(comp || null);
                setDeliveryOrders((dos || []).filter((item: DeliveryOrder) => item.status === 'DELIVERED'));
                setOrders(ords || []);
                setDeliveryOrderItems(doItems || []);
                setUsedNotaDoRefs(
                    (notaItems || [])
                        .map((item: { doRef?: string }) => item.doRef)
                        .filter((value: string | undefined): value is string => Boolean(value))
                );
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat data nota');
            }
        }

        void loadData();
    }, [addToast]);

    const calculateDueDate = (baseDate: string, termDays: number) => {
        const parsed = new Date(baseDate);
        if (Number.isNaN(parsed.getTime())) {
            return '';
        }
        parsed.setDate(parsed.getDate() + termDays);
        return parsed.toISOString().slice(0, 10);
    };

    useEffect(() => {
        if (dueDateTouched) return;
        const customer = customerRef
            ? customers.find(item => item._id === customerRef)
            : null;
        const customerTerm = customer && Number.isFinite(customer.defaultPaymentTerm) && customer.defaultPaymentTerm >= 0
            ? customer.defaultPaymentTerm
            : null;
        const companyTerm = company?.invoiceSettings?.dueDateDays ?? company?.invoiceSettings?.defaultTermDays;
        const termDays = customerTerm ?? (
            typeof companyTerm === 'number' && Number.isFinite(companyTerm) && companyTerm >= 0
                ? companyTerm
                : null
        );
        if (termDays === null) return;
        setDueDate(calculateDueDate(issueDate, termDays));
    }, [company, customerRef, customers, dueDateTouched, issueDate]);

    const buildNotaRowFromDO = (deliveryOrder: DeliveryOrder): NotaItemRow => {
        const relatedOrder = orders.find(order => order._id === deliveryOrder.orderRef);
        const relatedItems = deliveryOrderItems.filter(item => item.deliveryOrderRef === deliveryOrder._id);
        const descriptions = [...new Set(
            relatedItems
                .map(item => item.orderItemDescription?.trim())
                .filter((value): value is string => Boolean(value))
        )];
        const collie = relatedItems.reduce((sum, item) => sum + Number(item.orderItemQtyKoli || 0), 0);
        const beratKg = relatedItems.reduce((sum, item) => sum + Number(item.orderItemWeight || 0), 0);

        return {
            id: Math.random().toString(36).slice(2),
            doRef: deliveryOrder._id,
            doNumber: deliveryOrder.doNumber || '',
            vehiclePlate: deliveryOrder.vehiclePlate || '',
            date: deliveryOrder.date || new Date().toISOString().split('T')[0],
            noSJ: deliveryOrder.doNumber || '',
            dari: relatedOrder?.pickupAddress || '',
            tujuan: deliveryOrder.receiverAddress || relatedOrder?.receiverAddress || '',
            barang: descriptions.join(', '),
            collie,
            beratKg,
            tarip: 0,
            uangRp: 0,
            ket: '',
        };
    };

    const updateRow = (id: string, field: keyof NotaItemRow, value: string | number) => {
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
            addToast('error', 'DO ini sudah ada di nota');
            return;
        }
        if (usedNotaDoRefs.includes(doId)) {
            addToast('error', 'DO ini sudah tercantum di nota lain');
            return;
        }

        const relatedOrder = orders.find(order => order._id === deliveryOrder.orderRef);
        if (customerRef && relatedOrder?.customerRef && relatedOrder.customerRef !== customerRef) {
            addToast('error', 'DO ini milik customer lain');
            return;
        }

        const nextRow = buildNotaRowFromDO(deliveryOrder);
        if (!customerRef && relatedOrder?.customerRef) {
            const resolvedCustomerName =
                relatedOrder.customerName ||
                customers.find(customer => customer._id === relatedOrder.customerRef)?.name ||
                '';
            setCustomerRef(relatedOrder.customerRef);
            setCustomerName(resolvedCustomerName);
        } else if (!customerName && relatedOrder?.customerName) {
            setCustomerName(relatedOrder.customerName);
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
        if (!customerName) {
            addToast('error', 'Nama customer wajib diisi');
            return;
        }
        const filledRows = rows.filter(row => !isEmptyRow(row));
        if (filledRows.length === 0) {
            addToast('error', 'Minimal 1 baris perjalanan');
            return;
        }

        setSaving(true);
        try {
            const notaResponse = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'freight-notas',
                    action: 'create-with-items',
                    data: {
                        customerRef: customerRef || undefined,
                        customerName,
                        issueDate,
                        dueDate: dueDate || undefined,
                        notes: notes || undefined,
                        items: filledRows,
                    },
                }),
            });
            const notaPayload = await notaResponse.json();
            if (!notaResponse.ok) {
                addToast('error', notaPayload.error || 'Gagal membuat nota');
                return;
            }

            addToast('success', 'Nota berhasil dibuat');
            router.push(`/invoices/${notaPayload.data._id}`);
        } catch {
            addToast('error', 'Gagal membuat nota');
        } finally {
            setSaving(false);
        }
    };

    const customerOrderIds = customerRef
        ? new Set(orders.filter(order => order.customerRef === customerRef).map(order => order._id))
        : null;

    const customerDOs = customerOrderIds
        ? deliveryOrders.filter(deliveryOrder => customerOrderIds.has(deliveryOrder.orderRef || ''))
        : deliveryOrders;

    const otherDOs = customerRef
        ? []
        : customerOrderIds
        ? deliveryOrders.filter(deliveryOrder => !customerOrderIds.has(deliveryOrder.orderRef || ''))
        : [];

    const selectedDoRefs = new Set(rows.map(row => row.doRef).filter(Boolean));
    const blockedDoRefs = new Set(usedNotaDoRefs);
    const availableCustomerDOs = customerDOs.filter(
        deliveryOrder => !selectedDoRefs.has(deliveryOrder._id) && !blockedDoRefs.has(deliveryOrder._id)
    );
    const availableOtherDOs = otherDOs.filter(
        deliveryOrder => !selectedDoRefs.has(deliveryOrder._id) && !blockedDoRefs.has(deliveryOrder._id)
    );

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button className="btn-back" onClick={() => router.push('/invoices')}>
                    <ArrowLeft size={16} />
                </button>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Buat Nota Ongkos Angkut</h1>
            </div>

            <div className="detail-grid">
                <div>
                    <div className="card">
                        <div className="card-header">
                            <span className="card-header-title">Info Nota</span>
                        </div>
                        <div className="card-body">
                            <div className="form-group">
                                <label className="form-label">
                                    Customer <span className="required">*</span>
                                </label>
                                <select
                                    className="form-select"
                                    disabled={hasSelectedRows}
                                    value={customerRef}
                                    onChange={event => {
                                        const selectedId = event.target.value;
                                        setCustomerRef(selectedId);
                                        const customer = customers.find(item => item._id === selectedId);
                                        setCustomerName(customer?.name || '');
                                    }}
                                >
                                    <option value="">-- Pilih Customer --</option>
                                    {customers.map(customer => (
                                        <option key={customer._id} value={customer._id}>
                                            {customer.name}
                                        </option>
                                    ))}
                                </select>
                                {hasSelectedRows && (
                                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        Customer terkunci selama masih ada baris DO. Hapus dulu baris terkait jika ingin mengganti customer.
                                    </p>
                                )}
                            </div>

                            {!customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama customer</label>
                                    <input
                                        className="form-input"
                                        value={customerName}
                                        onChange={event => setCustomerName(event.target.value)}
                                        placeholder="Nama perusahaan..."
                                    />
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Tanggal Nota</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={issueDate}
                                        onChange={event => setIssueDate(event.target.value)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Jatuh Tempo</label>
                                    <input
                                        type="date"
                                        className="form-input"
                                        value={dueDate}
                                        onChange={event => {
                                            setDueDateTouched(true);
                                            setDueDate(event.target.value);
                                        }}
                                    />
                                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        Otomatis mengikuti termin customer atau default perusahaan, tapi masih bisa kamu ubah manual.
                                    </p>
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
                                {availableCustomerDOs.length > 0 && (
                                    <optgroup
                                        label={
                                            customerRef
                                                ? `DO milik ${customerName} (${availableCustomerDOs.length})`
                                                : `Semua DO Selesai (${availableCustomerDOs.length})`
                                        }
                                    >
                                        {availableCustomerDOs.map(deliveryOrder => (
                                            <option key={deliveryOrder._id} value={deliveryOrder._id}>
                                                {deliveryOrder.doNumber} - {deliveryOrder.vehiclePlate || '-'} - {deliveryOrder.receiverAddress || '-'}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {availableOtherDOs.length > 0 && (
                                    <optgroup label={`DO Customer Lain (${availableOtherDOs.length})`}>
                                        {availableOtherDOs.map(deliveryOrder => (
                                            <option key={deliveryOrder._id} value={deliveryOrder._id}>
                                                {deliveryOrder.doNumber} - {deliveryOrder.vehiclePlate || '-'} - {deliveryOrder.receiverAddress || '-'}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                            <p style={{ margin: '0.65rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                DO yang sudah dipakai di nota lain atau sudah kamu pilih di tabel otomatis disembunyikan.
                            </p>
                            <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                Satu nota bisa memuat beberapa SJ/DO selesai, selama semuanya milik customer yang sama.
                            </p>
                        </div>
                    </div>
                </div>

                <div>
                    <div className="card" style={{ overflow: 'hidden' }}>
                        <div
                            style={{
                                background: 'linear-gradient(135deg, var(--color-primary) 0%, #7c3aed 100%)',
                                color: '#fff',
                                padding: '1.25rem',
                            }}
                        >
                            <div
                                style={{
                                    fontSize: '0.72rem',
                                    opacity: 0.8,
                                    textTransform: 'uppercase',
                                    marginBottom: '0.25rem',
                                }}
                            >
                                Total Ongkos Angkut
                            </div>
                            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{formatCurrency(totalAmount)}</div>
                        </div>
                        <div className="card-body">
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '0.5rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Total Collie</span>
                                <strong>{totalCollie}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Total Berat</span>
                                <strong>{totalBerat.toLocaleString('id')} kg</strong>
                            </div>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
                                <Save size={16} /> {saving ? 'Menyimpan...' : 'Simpan Nota'}
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
                    <table style={{ minWidth: 900 }}>
                        <thead>
                            <tr>
                                <th style={{ minWidth: 80 }}>NO.TRUCK</th>
                                <th style={{ minWidth: 90 }}>TANGGAL</th>
                                <th style={{ minWidth: 120 }}>NO.SJ</th>
                                <th style={{ minWidth: 100 }}>DARI</th>
                                <th style={{ minWidth: 120 }}>TUJUAN</th>
                                <th style={{ minWidth: 100 }}>BARANG</th>
                                <th style={{ minWidth: 70 }}>COLLIE</th>
                                <th style={{ minWidth: 80 }}>BERAT KG</th>
                                <th style={{ minWidth: 90 }}>TARIP</th>
                                <th style={{ minWidth: 110 }}>UANG RP</th>
                                <th style={{ minWidth: 80 }}>KET</th>
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
                                            value={row.dari}
                                            onChange={event => updateRow(row.id, 'dari', event.target.value)}
                                            placeholder="Dari..."
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
                            <tr
                                style={{
                                    background: 'var(--color-bg-secondary)',
                                    fontWeight: 700,
                                    borderTop: '2px solid var(--color-border)',
                                }}
                            >
                                <td colSpan={6} style={{ textAlign: 'right', paddingRight: '0.75rem' }}>
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
