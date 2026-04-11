'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';

import CurrencyInput from '@/components/CurrencyInput';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    calculateFreightNotaRowAmount,
    FREIGHT_NOTA_BILLING_MODE_OPTIONS,
    formatFreightNotaDisplayWeight,
    getFreightNotaBillingModeLabel,
    getFreightNotaDisplayWeightValue,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from '@/lib/freight-nota-billing';
import {
    buildNotaRowsFromDeliveryOrder,
    createEmptyNotaRow,
    getSuggestedNotaDueDate,
    isEmptyNotaRow,
    type NotaItemRow,
} from '@/lib/invoice-create-page-support';
import { convertWeightToKg } from '@/lib/measurement';
import { buildPph23Label, calculatePph23Summary, DEFAULT_PPH23_RATE_PERCENT, PPH23_BASE_MODE_OPTIONS } from '@/lib/pph23';
import type { CompanyProfile, Customer, DeliveryOrder, DeliveryOrderItem, FreightNotaBillingMode, Order } from '@/lib/types';
import { formatCurrency, formatInternalDeliveryOrderNumber, formatQuantity, formatShipperDeliveryOrderNumber } from '@/lib/utils';

import { useToast } from '../../layout';

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
    const [issueDate, setIssueDate] = useState(getBusinessDateValue());
    const [dueDate, setDueDate] = useState('');
    const [dueDateTouched, setDueDateTouched] = useState(false);
    const [notes, setNotes] = useState('');
    const [rows, setRows] = useState<NotaItemRow[]>([createEmptyNotaRow()]);
    const [billingMode, setBillingMode] = useState<FreightNotaBillingMode>('PER_KG');
    const [pph23Enabled, setPph23Enabled] = useState(false);
    const [pph23RatePercent, setPph23RatePercent] = useState(DEFAULT_PPH23_RATE_PERCENT);
    const [pph23BaseMode, setPph23BaseMode] = useState<'BEFORE_CLAIM' | 'AFTER_CLAIM'>('BEFORE_CLAIM');

    useEffect(() => {
        async function loadData() {
            try {
                const [cust, comp, dos, ords, doItems, notaItems] = await Promise.all([
                    fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat customer'),
                    fetchAdminData<CompanyProfile | null>('/api/data?entity=company', 'Gagal memuat profil perusahaan').catch(() => null),
                    fetchAdminCollectionData<DeliveryOrder[]>('/api/data?entity=delivery-orders', 'Gagal memuat surat jalan'),
                    fetchAdminCollectionData<Order[]>('/api/data?entity=orders', 'Gagal memuat order'),
                    fetchAdminCollectionData<DeliveryOrderItem[]>('/api/data?entity=delivery-order-items', 'Gagal memuat item DO'),
                    fetchAdminCollectionData<Array<{ doRef?: string }>>('/api/data?entity=freight-nota-items', 'Gagal memuat pemakaian DO nota'),
                ]);
                setCustomers((cust || []).filter(customer => customer.active !== false));
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

    useEffect(() => {
        const nextDueDate = getSuggestedNotaDueDate({
            customerRef,
            customers,
            company,
            issueDate,
            dueDateTouched,
        });
        if (nextDueDate) {
            setDueDate(nextDueDate);
        }
    }, [company, customerRef, customers, dueDateTouched, issueDate]);

    useEffect(() => {
        if (!customerRef) return;
        const selectedCustomer = customers.find(item => item._id === customerRef);
        if (!selectedCustomer) return;
        setBillingMode(normalizeFreightNotaBillingMode(selectedCustomer.defaultFreightNotaBillingMode));
        setPph23Enabled(selectedCustomer.defaultPph23Enabled === true);
        setPph23RatePercent(
            typeof selectedCustomer.defaultPph23RatePercent === 'number'
                ? selectedCustomer.defaultPph23RatePercent
                : DEFAULT_PPH23_RATE_PERCENT
        );
        setPph23BaseMode(selectedCustomer.defaultPph23BaseMode === 'AFTER_CLAIM' ? 'AFTER_CLAIM' : 'BEFORE_CLAIM');
    }, [customerRef, customers]);

    useEffect(() => {
        setRows(previous => previous.map(row => ({
            ...row,
            uangRp: Math.round(calculateFreightNotaRowAmount({
                beratKg: row.beratKg,
                tarip: row.tarip,
                billingMode,
            })),
        })));
    }, [billingMode]);

    const updateRow = (id: string, field: keyof NotaItemRow, value: string | number) => {
        setRows(previous =>
            previous.map(row => {
                if (row.id !== id) return row;
                const updated = { ...row, [field]: value };
                if (field === 'beratKg' || field === 'tarip') {
                    updated.uangRp = Math.round(calculateFreightNotaRowAmount({
                        beratKg: updated.beratKg,
                        tarip: updated.tarip,
                        billingMode,
                    }));
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

        const nextRows = buildNotaRowsFromDeliveryOrder({
            deliveryOrder,
            orders,
            deliveryOrderItems,
        });
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
            const emptyIndex = previous.findIndex(isEmptyNotaRow);
            if (emptyIndex === -1) {
                return [...previous, ...nextRows];
            }

            const next = [...previous];
            const [firstRow, ...remainingRows] = nextRows;
            next[emptyIndex] = { ...firstRow, id: previous[emptyIndex].id };
            if (remainingRows.length > 0) {
                next.push(...remainingRows);
            }
            return next;
        });
    };

    const removeRow = (id: string) => {
        setRows(previous => {
            const next = previous.filter(row => row.id !== id);
            return next.length > 0 ? next : [createEmptyNotaRow()];
        });
    };

    const totalCollie = rows.reduce((sum, row) => sum + (row.collie || 0), 0);
    const totalBerat = rows.reduce((sum, row) => sum + (row.beratKg || 0), 0);
    const totalAmount = rows.reduce((sum, row) => sum + (row.uangRp || 0), 0);
    const pph23Summary = calculatePph23Summary({
        grossAmount: totalAmount,
        claimAmount: 0,
        enabled: pph23Enabled,
        ratePercent: pph23RatePercent,
        baseMode: pph23BaseMode,
    });
    const hasSelectedRows = rows.some(row => Boolean(row.doRef));
    const totalBeratLabel = formatFreightNotaDisplayWeight({
        beratKg: totalBerat,
        billingMode,
        includeCanonical: billingMode === 'PER_TON',
    });

    const handleSave = async () => {
        if (!customerName) {
            addToast('error', 'Nama customer wajib diisi');
            return;
        }
        const filledRows = rows.filter(row => !isEmptyNotaRow(row));
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
                        billingMode,
                        pph23Enabled,
                        pph23RatePercent,
                        pph23BaseMode,
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
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/invoices" />
                    <h1 className="page-title" style={{ margin: 0 }}>Buat Nota Ongkos Angkut</h1>
                </div>
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
                                    Customer / Penagih <span className="required">*</span>
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
                            </div>

                            {!customerRef && (
                                <div className="form-group">
                                    <label className="form-label">Atau ketik nama customer / penagih</label>
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
                                </div>
                            </div>

                            <div className="form-group" style={{ maxWidth: 320 }}>
                                <label className="form-label">Basis Billing Nota</label>
                                <select
                                    className="form-select"
                                    value={billingMode}
                                    onChange={event => setBillingMode(event.target.value as FreightNotaBillingMode)}
                                >
                                    {FREIGHT_NOTA_BILLING_MODE_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Default customer akan terpakai otomatis. Kamu masih bisa override per nota kalau customer minta tagihan dalam ton.
                                </div>
                            </div>
                            <div className="card" style={{ marginTop: '1rem', border: '1px solid var(--color-border)' }}>
                                <div className="card-body" style={{ padding: '1rem' }}>
                                    <div className="form-row">
                                        <div className="form-group">
                                            <label className="form-label">PPh 23</label>
                                            <select
                                                className="form-select"
                                                value={pph23Enabled ? 'YA' : 'TIDAK'}
                                                onChange={event => {
                                                    const nextEnabled = event.target.value === 'YA';
                                                    setPph23Enabled(nextEnabled);
                                                    if (nextEnabled && pph23RatePercent <= 0) {
                                                        setPph23RatePercent(DEFAULT_PPH23_RATE_PERCENT);
                                                    }
                                                }}
                                            >
                                                <option value="TIDAK">Tidak dipotong</option>
                                                <option value="YA">Potong PPh 23</option>
                                            </select>
                                        </div>
                                        <div className="form-group" style={{ maxWidth: 180 }}>
                                            <label className="form-label">Tarif PPh 23 (%)</label>
                                            <FormattedNumberInput
                                                maxFractionDigits={2}
                                                value={pph23RatePercent}
                                                onValueChange={value => setPph23RatePercent(value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="form-group" style={{ maxWidth: 280 }}>
                                        <label className="form-label">Basis Hitung PPh 23</label>
                                        <select
                                            className="form-select"
                                            value={pph23BaseMode}
                                            onChange={event => setPph23BaseMode(event.target.value as 'BEFORE_CLAIM' | 'AFTER_CLAIM')}
                                        >
                                            {PPH23_BASE_MODE_OPTIONS.map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                            {buildPph23Label({ enabled: pph23Enabled, ratePercent: pph23RatePercent, baseMode: pph23BaseMode })}. Masih bisa diubah lagi di detail nota sebelum ada pembayaran.
                                        </div>
                                    </div>
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
                                                {formatInternalDeliveryOrderNumber(deliveryOrder)}{deliveryOrder.customerDoNumber ? ` | SJ ${formatShipperDeliveryOrderNumber(deliveryOrder)}` : ''} - {deliveryOrder.vehiclePlate || '-'} - {deliveryOrder.receiverAddress || '-'}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                {availableOtherDOs.length > 0 && (
                                    <optgroup label={`DO Customer Lain (${availableOtherDOs.length})`}>
                                        {availableOtherDOs.map(deliveryOrder => (
                                            <option key={deliveryOrder._id} value={deliveryOrder._id}>
                                                {formatInternalDeliveryOrderNumber(deliveryOrder)}{deliveryOrder.customerDoNumber ? ` | SJ ${formatShipperDeliveryOrderNumber(deliveryOrder)}` : ''} - {deliveryOrder.vehiclePlate || '-'} - {deliveryOrder.receiverAddress || '-'}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
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
                                Tagihan Bruto
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
                                <strong>{formatQuantity(totalCollie)}</strong>
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
                                <strong>{totalBeratLabel}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                                >
                                    <span className="text-muted">Basis Billing</span>
                                    <strong>{getFreightNotaBillingModeLabel(billingMode)}</strong>
                                </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '0.5rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">PPh 23</span>
                                <strong>{pph23Enabled ? `-${formatCurrency(pph23Summary.amount)}` : '-'}</strong>
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginBottom: '1rem',
                                    fontSize: '0.85rem',
                                }}
                            >
                                <span className="text-muted">Tagihan Transfer Final</span>
                                <strong>{formatCurrency(pph23Summary.netAmount)}</strong>
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
                                    <button className="btn btn-secondary btn-sm" onClick={() => setRows(previous => [...previous, createEmptyNotaRow()])}>
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
                                <th style={{ minWidth: 90 }}>{getFreightNotaWeightColumnLabel(billingMode)}</th>
                                <th style={{ minWidth: 100 }}>{getFreightNotaRateColumnLabel(billingMode)}</th>
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
                                        <FormattedNumberInput
                                            maxFractionDigits={2}
                                            value={row.collie}
                                            onValueChange={value => updateRow(row.id, 'collie', value)}
                                        />
                                    </td>
                                    <td>
                                        <FormattedNumberInput
                                            maxFractionDigits={billingMode === 'PER_TON' ? 3 : 2}
                                            value={getFreightNotaDisplayWeightValue(row.beratKg, billingMode)}
                                            onValueChange={value => updateRow(
                                                row.id,
                                                'beratKg',
                                                convertWeightToKg(value, billingMode === 'PER_TON' ? 'TON' : 'KG'),
                                            )}
                                        />
                                    </td>
                                    <td>
                                        <CurrencyInput
                                            value={row.tarip}
                                            onValueChange={value => updateRow(row.id, 'tarip', value)}
                                            placeholder={billingMode === 'PER_TON' ? 'Ketik tarif per ton' : 'Ketik tarif per kg'}
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
                                <td>{formatQuantity(totalCollie)}</td>
                                <td>{getFreightNotaDisplayWeightValue(totalBerat, billingMode).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: billingMode === 'PER_TON' ? 3 : 2 })}</td>
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
