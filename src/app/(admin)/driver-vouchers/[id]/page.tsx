'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Pencil, Plus, Printer, Save, Trash2, X } from 'lucide-react';

import CollapsibleCard from '@/components/CollapsibleCard';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PageBackButton from '@/components/PageBackButton';
import { fetchAdminCollectionData, fetchAdminData, fetchAllAdminCollectionData } from '@/lib/api/admin-client';
import { getBusinessDateValue } from '@/lib/business-date';
import {
    buildDriverVoucherCashBreakdown,
    buildDriverVoucherDetailSummary,
    buildDriverVoucherPrintHtml,
    createDefaultDriverVoucherItemForm,
    createDefaultDriverVoucherTopUpForm,
    DRIVER_VOUCHER_EXPENSE_CATEGORIES,
    getDriverVoucherDisbursementLabel,
    sortDriverVoucherItems,
    sortDriverVoucherDisbursements,
} from '@/lib/driver-voucher-detail-support';
import { formatDriverVoucherRouteForDisplay } from '@/lib/driver-voucher-route';
import { useApp, useToast } from '../../layout';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow, resolveDocumentIssuerProfile } from '@/lib/print';
import { hasPageAccess, normalizeUserRole } from '@/lib/rbac';
import type { BankAccount, DeliveryOrder, DriverVoucher, DriverVoucherDisbursement, DriverVoucherItem } from '@/lib/types';
import { formatCurrency, formatDate } from '@/lib/utils';

export default function DriverVoucherDetailPage() {
    const params = useParams();
    const { addToast } = useToast();
    const { user } = useApp();
    const [voucher, setVoucher] = useState<DriverVoucher | null>(null);
    const [linkedDeliveryOrder, setLinkedDeliveryOrder] = useState<DeliveryOrder | null>(null);
    const [items, setItems] = useState<DriverVoucherItem[]>([]);
    const [disbursements, setDisbursements] = useState<DriverVoucherDisbursement[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [showTopUpModal, setShowTopUpModal] = useState(false);
    const [showSettleModal, setShowSettleModal] = useState(false);
    const [settling, setSettling] = useState(false);
    const [savingItem, setSavingItem] = useState(false);
    const [toppingUp, setToppingUp] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
    const [deletingDisbursementId, setDeletingDisbursementId] = useState<string | null>(null);
    const [repairingIssueLedger, setRepairingIssueLedger] = useState(false);
    const [itemForm, setItemForm] = useState(createDefaultDriverVoucherItemForm());
    const [topUpForm, setTopUpForm] = useState(createDefaultDriverVoucherTopUpForm());
    const [settlementDate, setSettlementDate] = useState(getBusinessDateValue());
    const [settlementBankRef, setSettlementBankRef] = useState('');
    const [issueBankRepairRef, setIssueBankRepairRef] = useState('');
    const normalizedRole = user ? normalizeUserRole(user.role) : null;
    const canOpenDeliveryOrderPage = user ? hasPageAccess(user.role, 'deliveryOrders') : false;
    const canOpenDriverPage = user ? hasPageAccess(user.role, 'drivers') : false;
    const canOpenVehiclePage = user ? hasPageAccess(user.role, 'vehicles') : false;
    const canManageVoucherItems = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL';
    const canTopUpVoucher = normalizedRole === 'OWNER' || normalizedRole === 'OPERASIONAL';
    const canSettleVoucher = normalizedRole === 'OWNER' || normalizedRole === 'FINANCE';
    const canRepairIssueLedger = normalizedRole === 'OWNER' || normalizedRole === 'FINANCE';

    const loadVoucherDetail = useCallback(async () => {
        setLoading(true);
        try {
            const [voucherData, voucherItems, voucherDisbursements, accounts] = await Promise.all([
                fetchAdminData<DriverVoucher | null>(`/api/data?entity=driver-vouchers&id=${params.id}`, 'Gagal memuat detail uang jalan trip'),
                fetchAllAdminCollectionData<DriverVoucherItem>(`/api/data?entity=driver-voucher-items&filter=${encodeURIComponent(JSON.stringify({ voucherRef: params.id }))}`, 'Gagal memuat detail uang jalan trip'),
                fetchAllAdminCollectionData<DriverVoucherDisbursement>(`/api/data?entity=driver-voucher-disbursements&filter=${encodeURIComponent(JSON.stringify({ voucherRef: params.id }))}`, 'Gagal memuat detail uang jalan trip'),
                fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat detail uang jalan trip'),
            ]);
            const deliveryOrderData = voucherData?.deliveryOrderRef
                ? await fetchAdminData<DeliveryOrder | null>(
                    `/api/data?entity=delivery-orders&id=${voucherData.deliveryOrderRef}`,
                    'Gagal memuat referensi Surat Jalan'
                ).catch(() => null)
                : null;
            setVoucher(voucherData || null);
            setLinkedDeliveryOrder(deliveryOrderData || null);
            setItems(sortDriverVoucherItems(voucherItems || []));
            setDisbursements(sortDriverVoucherDisbursements(voucherDisbursements || []));
            setBankAccounts((accounts || []).filter((account) => account.active !== false));
            setIssueBankRepairRef(voucherData?.issueBankRef || '');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail uang jalan trip');
        } finally {
            setLoading(false);
        }
    }, [addToast, params.id]);

    useEffect(() => {
        void loadVoucherDetail();
    }, [loadVoucherDetail]);

    useEffect(() => {
        const activeBankRefSet = new Set(bankAccounts.map(account => account._id));

        if (issueBankRepairRef && !activeBankRefSet.has(issueBankRepairRef)) {
            setIssueBankRepairRef('');
        }
        if (settlementBankRef && !activeBankRefSet.has(settlementBankRef)) {
            setSettlementBankRef('');
        }
        if (topUpForm.bankAccountRef && !activeBankRefSet.has(topUpForm.bankAccountRef)) {
            setTopUpForm(previous => ({ ...previous, bankAccountRef: '' }));
        }
    }, [bankAccounts, issueBankRepairRef, settlementBankRef, topUpForm.bankAccountRef]);

    const {
        operationalSpent,
        operationalBalance,
        driverFeeAmount,
        totalClaimAmount,
        initialCashGiven,
        totalIssuedAmount,
        topUpAmount,
        balance,
        isSettled,
        statusConfig,
        settlementLabel,
        settlementPrimaryLabel,
    } = buildDriverVoucherDetailSummary(voucher, items);
    const cashBreakdown = buildDriverVoucherCashBreakdown(disbursements, { initialCashGiven, topUpAmount });
    const routeLabel = formatDriverVoucherRouteForDisplay(voucher?.route) || voucher?.route || '-';
    const linkedDoBaseTripFee =
        linkedDeliveryOrder?.baseTaripBorongan
        ?? linkedDeliveryOrder?.taripBorongan
        ?? 0;
    const linkedDoOvertonaseAmount = linkedDeliveryOrder?.overtonaseDriverAmount || 0;
    const linkedDoHasFinalActualWeight = (linkedDeliveryOrder?.actualTotalWeightKg || 0) > 0;
    const linkedDoFinalTripFee = linkedDeliveryOrder?.taripBorongan || driverFeeAmount;

    const openAddItemModal = () => {
        if (isSettled || !canManageVoucherItems) return;
        setEditingItemId(null);
        setItemForm(createDefaultDriverVoucherItemForm());
        setShowAddItem(true);
    };

    const openEditItemModal = (item: DriverVoucherItem) => {
        if (isSettled || !canManageVoucherItems) return;
        setEditingItemId(item._id);
        setItemForm({
            expenseDate: item.expenseDate || getBusinessDateValue(),
            category: item.category || 'Lain-lain',
            description: item.description || '',
            amount: item.amount || 0,
        });
        setShowAddItem(true);
    };

    const closeItemModal = () => {
        if (savingItem) return;
        setShowAddItem(false);
        setEditingItemId(null);
        setItemForm(createDefaultDriverVoucherItemForm());
    };

    const handleSaveItem = async () => {
        if (!canManageVoucherItems) return;
        if (!itemForm.amount || itemForm.amount <= 0) {
            addToast('error', 'Nominal harus diisi');
            return;
        }

        setSavingItem(true);
        try {
            const isEditing = Boolean(editingItemId);
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-voucher-items',
                    action: isEditing ? 'update' : undefined,
                    data: {
                        ...(isEditing
                            ? {
                                id: editingItemId,
                                updates: {
                                    expenseDate: itemForm.expenseDate,
                                    category: itemForm.category,
                                    description: itemForm.description,
                                    amount: itemForm.amount,
                                },
                            }
                            : {
                                voucherRef: params.id,
                                expenseDate: itemForm.expenseDate,
                                category: itemForm.category,
                                description: itemForm.description,
                                amount: itemForm.amount,
                            }),
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || (isEditing ? 'Gagal mengubah item' : 'Gagal menambah item'));
                return;
            }
            setItems(prev => sortDriverVoucherItems(
                isEditing
                    ? prev.map(item => item._id === editingItemId ? result.data : item)
                    : [...prev, result.data]
            ));
            if (result.voucher) {
                setVoucher(result.voucher);
            }
            addToast('success', isEditing ? 'Item pengeluaran diubah' : 'Item pengeluaran ditambahkan');
            setShowAddItem(false);
            setEditingItemId(null);
            setItemForm(createDefaultDriverVoucherItemForm());
        } catch {
            addToast('error', editingItemId ? 'Gagal mengubah item' : 'Gagal menambah item');
        } finally {
            setSavingItem(false);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if (!canManageVoucherItems) return;
        setDeletingItemId(itemId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-voucher-items',
                    action: 'delete',
                    data: { id: itemId },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus item');
                return;
            }

            setItems(prev => prev.filter(item => item._id !== itemId));
            if (result.voucher) {
                setVoucher(result.voucher);
            }
            addToast('success', 'Item dihapus');
        } catch {
            addToast('error', 'Gagal menghapus item');
        } finally {
            setDeletingItemId(current => current === itemId ? null : current);
        }
    };

    const openTopUpModal = () => {
        if (!canTopUpVoucher || !voucher) return;
        const defaultBankRef =
            voucher.issueBankRef && bankAccounts.some(account => account._id === voucher.issueBankRef)
                ? voucher.issueBankRef
                : '';
        setTopUpForm(createDefaultDriverVoucherTopUpForm(defaultBankRef));
        setShowTopUpModal(true);
    };

    const handleTopUp = async () => {
        if (!canTopUpVoucher || !voucher) return;
        if (!topUpForm.bankAccountRef) {
            addToast('error', 'Pilih rekening sumber tambahan bon');
            return;
        }
        if (!topUpForm.amount || topUpForm.amount <= 0) {
            addToast('error', 'Nominal tambahan bon harus diisi');
            return;
        }

        setToppingUp(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'top-up',
                    data: {
                        id: voucher._id,
                        date: topUpForm.date,
                        bankAccountRef: topUpForm.bankAccountRef,
                        amount: topUpForm.amount,
                        note: topUpForm.note || undefined,
                    },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menambah bon');
                return;
            }

            if (result.voucher) {
                setVoucher(result.voucher);
            }
            if (result.data) {
                setDisbursements(prev =>
                    sortDriverVoucherDisbursements([...prev, result.data])
                );
            }
            setShowTopUpModal(false);
            setTopUpForm(
                createDefaultDriverVoucherTopUpForm(
                    voucher.issueBankRef && bankAccounts.some(account => account._id === voucher.issueBankRef)
                        ? voucher.issueBankRef
                        : ''
                )
            );
            addToast('success', 'Tambahan bon berhasil dicatat');
        } catch {
            addToast('error', 'Gagal menambah bon');
        } finally {
            setToppingUp(false);
        }
    };

    const handleDeleteDisbursement = async (disbursementId: string) => {
        if (!canTopUpVoucher) return;
        setDeletingDisbursementId(disbursementId);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-voucher-disbursements',
                    action: 'delete',
                    data: { id: disbursementId },
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                addToast('error', result.error || 'Gagal menghapus tambahan bon');
                return;
            }

            setDisbursements(prev => prev.filter(item => item._id !== disbursementId));
            if (result.voucher) {
                setVoucher(result.voucher);
            }
            addToast('success', 'Tambahan bon dihapus');
        } catch {
            addToast('error', 'Gagal menghapus tambahan bon');
        } finally {
            setDeletingDisbursementId(current => current === disbursementId ? null : current);
        }
    };

    const handleRepairIssueLedger = async () => {
        if (!canRepairIssueLedger || !voucher) return;
        if (!issueBankRepairRef) {
            addToast('error', 'Pilih rekening sumber untuk rekonsiliasi');
            return;
        }

        setRepairingIssueLedger(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'repair-issue-ledger',
                    data: {
                        id: voucher._id,
                        issueBankRef: issueBankRepairRef,
                    },
                }),
            });
            const result = await res.json();

            if (!res.ok) {
                addToast('error', result.error || 'Gagal merekonsiliasi pencairan bon');
                return;
            }

            setVoucher(result.data);
            void loadVoucherDetail();
            addToast('success', 'Pencairan bon berhasil direkonsiliasi');
        } catch {
            addToast('error', 'Gagal merekonsiliasi pencairan bon');
        } finally {
            setRepairingIssueLedger(false);
        }
    };

    const openSettleModal = () => {
        if (!canSettleVoucher || !voucher) return;
        setSettlementDate(getBusinessDateValue());
        setSettlementBankRef(
            voucher.issueBankRef && bankAccounts.some(account => account._id === voucher.issueBankRef)
                ? voucher.issueBankRef
                : ''
        );
        setShowSettleModal(true);
    };

    const handleSettle = async () => {
        if (!canSettleVoucher || !voucher) return;
        if (items.length === 0 && driverFeeAmount <= 0) {
            addToast('error', 'Isi biaya lain-lain atau upah borongan sebelum penyelesaian trip');
            return;
        }
        if (balance !== 0 && !settlementBankRef) {
            addToast('error', 'Pilih rekening settlement untuk net settlement akhir');
            return;
        }

        setSettling(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'driver-vouchers',
                    action: 'settle',
                    data: {
                        id: params.id,
                        date: settlementDate,
                        settlementBankRef: settlementBankRef || undefined,
                    },
                }),
            });
            const result = await res.json();

            if (!res.ok) {
                addToast('error', result.error || 'Gagal menyelesaikan bon');
                return;
            }

            setVoucher(result.data);
            setShowSettleModal(false);
            addToast('success', 'Settlement trip selesai');
        } catch {
            addToast('error', 'Gagal menyelesaikan bon');
        } finally {
            setSettling(false);
        }
    };

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan cetak uang jalan trip...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba cetak lagi.');
            return;
        }
        try {
            const company = resolveDocumentIssuerProfile(voucher, await fetchCompanyProfile().catch(() => null));
            openBrandedPrint({
                title: `Uang Jalan Trip ${voucher?.bonNumber}`,
                company,
                targetWindow: printWindow,
                bodyHtml: voucher ? buildDriverVoucherPrintHtml({
                    voucher,
                    deliveryOrder: linkedDeliveryOrder,
                    items,
                    disbursements,
                    summary: buildDriverVoucherDetailSummary(voucher, items),
                }) : '',
                showFooter: false,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen cetak');
        }
    };

    if (loading || !voucher) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/driver-vouchers" />
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{voucher.bonNumber}</h1>
                            <span className={`badge ${statusConfig.cls}`}>{statusConfig.label}</span>
                        </div>
                        <p className="page-subtitle" style={{ margin: 0 }}>{voucher.driverName} | {formatDate(voucher.issuedDate)} | No. DO Internal {voucher.doNumber || '-'} | Uang Jalan Trip</p>
                    </div>
                </div>
                <div className="page-actions">
                    {voucher.deliveryOrderRef && canOpenDeliveryOrderPage && (
                        <Link className="btn btn-secondary btn-sm" href={`/delivery-orders/${voucher.deliveryOrderRef}`}>
                            Buka Surat Jalan
                        </Link>
                    )}
                    {!isSettled && canTopUpVoucher && <button className="btn btn-secondary btn-sm" onClick={openTopUpModal}><Plus size={15} /> Tambah Uang Jalan</button>}
                    {!isSettled && canSettleVoucher && (items.length > 0 || driverFeeAmount > 0) && <button className="btn btn-primary" onClick={openSettleModal}><CheckCircle size={16} /> Selesaikan Trip</button>}
                    <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print</button>
                </div>
            </div>

            {!voucher.issueBankRef && (
                <div className="card" style={{ marginBottom: '1rem', border: '1px solid #f59e0b', background: 'rgba(245,158,11,0.08)' }}>
                    <div className="card-body" style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 700, marginBottom: '0.35rem', color: '#92400e' }}>Pencairan lama belum tercatat ke rekening / kas</div>
                        <div style={{ fontSize: '0.82rem', color: '#92400e', marginBottom: '0.85rem' }}>
                            Uang jalan lama ini belum punya sumber dana yang tercatat, jadi mutasi kas atau rekeningnya belum terbentuk. Pilih sumber dana yang benar lalu catat pencairannya agar laporan tetap konsisten.
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div className="form-group" style={{ minWidth: 260, marginBottom: 0 }}>
                                <label className="form-label">Rekening / Kas Sumber</label>
                                <select className="form-select" value={issueBankRepairRef} onChange={event => setIssueBankRepairRef(event.target.value)}>
                                    <option value="">Pilih rekening atau kas</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            {canRepairIssueLedger ? (
                                <button className="btn btn-primary" onClick={handleRepairIssueLedger} disabled={repairingIssueLedger}>
                                    <CheckCircle size={16} /> {repairingIssueLedger ? 'Memproses...' : 'Catat Pencairan Lama'}
                                </button>
                            ) : (
                                <div className="text-muted text-sm">Menunggu finance / owner merekonsiliasi pencairan ini.</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Total Uang Diberikan</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(totalIssuedAmount)}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {cashBreakdown}
                    </div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Biaya Lain-lain</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(operationalSpent)}</div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Sisa Bon Operasional</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: operationalBalance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(operationalBalance))}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {operationalBalance >= 0 ? 'Sisa dana operasional yang masih dipegang driver' : 'Biaya lain-lain melebihi uang jalan operasional'}
                    </div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Upah Borongan</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(driverFeeAmount)}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {linkedDeliveryOrder
                            ? `Dasar ${formatCurrency(linkedDoBaseTripFee)}${linkedDoHasFinalActualWeight ? ` | Overtonase ${formatCurrency(linkedDoOvertonaseAmount)} | Final ${formatCurrency(linkedDoFinalTripFee)}` : ' | Overtonase menunggu aktual final'}`
                            : 'Nilai ini mengikuti upah borongan pada DO dan master biaya rute trip'}
                    </div>
                </div></div>
                <div className="card"><div className="card-body" style={{ padding: 'var(--space-4)' }}>
                    <div className="text-muted" style={{ fontSize: '0.75rem', marginBottom: 2 }}>Net Settlement Akhir</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(balance))}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        {balance >= 0 ? 'Kembali ke perusahaan setelah biaya lain-lain dan upah borongan diperhitungkan' : 'Tambahan bayar ke supir setelah biaya lain-lain dan upah borongan diperhitungkan'}
                    </div>
                </div></div>
            </div>

            <CollapsibleCard title="Informasi Trip">
                <div className="card-body">
                    <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SUPIR</div><div className="font-medium">{canOpenDriverPage && voucher.driverRef ? <Link href={`/fleet/drivers/${voucher.driverRef}`}>{voucher.driverName || '-'}</Link> : (voucher.driverName || '-')}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>NO. DO INTERNAL</div><div>{canOpenDeliveryOrderPage && voucher.deliveryOrderRef ? <Link href={`/delivery-orders/${voucher.deliveryOrderRef}`}>{voucher.doNumber || '-'}</Link> : (voucher.doNumber || '-')}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>KENDARAAN</div><div>{canOpenVehiclePage && voucher.vehicleRef ? <Link href={`/fleet/vehicles/${voucher.vehicleRef}`}>{voucher.vehiclePlate || '-'}</Link> : (voucher.vehiclePlate || '-')}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>RUTE</div><div>{routeLabel}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>BON PERTAMA</div><div>{formatCurrency(initialCashGiven)}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TOTAL UANG DIBERIKAN</div><div>{formatCurrency(totalIssuedAmount)}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>SISA BON OPERASIONAL</div><div>{formatCurrency(operationalBalance)}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>UPAH BORONGAN</div><div>{formatCurrency(driverFeeAmount)}</div></div>
                        {linkedDeliveryOrder && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>UPAH DASAR DO</div><div>{formatCurrency(linkedDoBaseTripFee)}</div></div>}
                        {linkedDeliveryOrder && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TAMBAHAN OVERTONASE</div><div>{linkedDoHasFinalActualWeight ? formatCurrency(linkedDoOvertonaseAmount) : 'Menunggu aktual final'}</div></div>}
                        {linkedDeliveryOrder && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>UPAH BORONGAN FINAL DO</div><div>{linkedDoHasFinalActualWeight ? formatCurrency(linkedDoFinalTripFee) : 'Menunggu aktual final'}</div></div>}
                        {linkedDeliveryOrder && linkedDoHasFinalActualWeight && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>BERAT AKTUAL FINAL</div><div>{linkedDeliveryOrder.actualTotalWeightKg} kg</div></div>}
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SUMBER</div><div>{voucher.issueBankName || '-'}</div></div>
                        <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>NET SETTLEMENT AKHIR</div><div>{formatCurrency(balance)}</div></div>
                        {voucher.notes && <div style={{ gridColumn: '1 / -1' }}><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>CATATAN</div><div>{voucher.notes}</div></div>}
                        {isSettled && voucher.settledDate && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>TANGGAL SELESAI</div><div>{formatDate(voucher.settledDate)}</div></div>}
                        {isSettled && <div><div className="text-muted" style={{ fontSize: '0.72rem', marginBottom: 2 }}>REKENING SETTLEMENT</div><div>{voucher.settlementBankName || '-'}</div></div>}
                    </div>
                </div>
            </CollapsibleCard>

            <CollapsibleCard title={`Riwayat Uang Jalan (${disbursements.length})`}>
                {!isSettled && canTopUpVoucher && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
                        <button className="btn btn-secondary btn-sm" onClick={openTopUpModal}><Plus size={14} /> Top Up Uang Jalan</button>
                    </div>
                )}
                <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrapper table-desktop-only">
                        <table>
                            <thead><tr><th>No</th><th>Tanggal</th><th>Jenis</th><th>Sumber Dana</th><th>Catatan</th><th>Jumlah</th>{!isSettled && canTopUpVoucher && <th>Aksi</th>}</tr></thead>
                            <tbody>
                                {disbursements.length === 0 ? (
                                    <tr><td colSpan={isSettled || !canTopUpVoucher ? 6 : 7} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Belum ada riwayat pencairan uang jalan</td></tr>
                                ) : disbursements.map((item, index) => {
                                    const bonLabel = getDriverVoucherDisbursementLabel(item, disbursements);
                                    return (
                                    <tr key={item._id}>
                                        <td>{index + 1}</td>
                                        <td>{formatDate(item.date)}</td>
                                        <td><span className={`badge ${item.kind === 'INITIAL' ? 'badge-blue' : 'badge-warning'}`}>{bonLabel}</span></td>
                                        <td>{item.bankAccountName || '-'}</td>
                                        <td>{item.note || '-'}</td>
                                        <td className="font-medium">{formatCurrency(item.amount)}</td>
                                        {!isSettled && canTopUpVoucher && (
                                            <td>
                                                {item.kind === 'TOP_UP' ? (
                                                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteDisbursement(item._id)} disabled={deletingDisbursementId === item._id}>
                                                        <Trash2 size={14} style={{ color: '#ef4444' }} />
                                                    </button>
                                                ) : (
                                                    <span className="text-muted" style={{ fontSize: '0.78rem' }}>Tetap</span>
                                                )}
                                            </td>
                                        )}
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="mobile-record-list">
                        {disbursements.length === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada riwayat pencairan uang jalan</div>
                            </div>
                        ) : disbursements.map(item => {
                            const bonLabel = getDriverVoucherDisbursementLabel(item, disbursements);
                            return (
                            <div key={item._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{bonLabel}</div>
                                        <div className="mobile-record-subtitle">{formatDate(item.date)} | {item.bankAccountName || '-'}</div>
                                    </div>
                                    <span className={`badge ${item.kind === 'INITIAL' ? 'badge-blue' : 'badge-warning'}`}>{formatCurrency(item.amount)}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Catatan</span>
                                        <span className="mobile-record-value">{item.note || '-'}</span>
                                    </div>
                                </div>
                                {!isSettled && canTopUpVoucher && item.kind === 'TOP_UP' && (
                                    <div className="mobile-record-actions">
                                        <button className="btn btn-secondary" onClick={() => handleDeleteDisbursement(item._id)} disabled={deletingDisbursementId === item._id}>
                                            <Trash2 size={14} /> Hapus Top Up
                                        </button>
                                    </div>
                                )}
                            </div>
                            );
                        })}
                    </div>
                </div>
            </CollapsibleCard>

            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="card-title">Catat Biaya Lain-lain ({items.length})</h3>
                    {!isSettled && canManageVoucherItems && <button className="btn btn-primary btn-sm" onClick={openAddItemModal}><Plus size={14} /> Tambah Biaya Lain-lain</button>}
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                    <div className="table-wrapper">
                        <table>
                            <thead><tr><th>No</th><th>Tanggal</th><th>Kategori</th><th>Deskripsi</th><th>Jumlah</th>{!isSettled && canManageVoucherItems && <th>Aksi</th>}</tr></thead>
                            <tbody>
                                {items.length === 0 ? (
                                    <tr><td colSpan={isSettled || !canManageVoucherItems ? 5 : 6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--text-muted)' }}>Belum ada biaya lain-lain aktual</td></tr>
                                ) : (
                                    items.map((item, index) => (
                                        <tr key={item._id}>
                                            <td>{index + 1}</td>
                                            <td>{item.expenseDate ? formatDate(item.expenseDate) : '-'}</td>
                                            <td><span className="badge badge-gray">{item.category}</span></td>
                                            <td>{item.description || '-'}</td>
                                            <td className="font-medium">{formatCurrency(item.amount)}</td>
                                            {!isSettled && canManageVoucherItems && (
                                                <td>
                                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => openEditItemModal(item)}
                                                            disabled={deletingItemId === item._id || savingItem}
                                                            aria-label={`Edit biaya lain-lain ${item.category}`}
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                        <button
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handleDeleteItem(item._id)}
                                                            disabled={deletingItemId === item._id}
                                                            aria-label={`Hapus biaya lain-lain ${item.category}`}
                                                        >
                                                            <Trash2 size={14} style={{ color: '#ef4444' }} />
                                                        </button>
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                                    ))
                                )}
                                {items.length > 0 && <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 700 }}><td colSpan={4} style={{ textAlign: 'right' }}>TOTAL BIAYA LAIN-LAIN</td><td>{formatCurrency(operationalSpent)}</td>{!isSettled && canManageVoucherItems && <td />}</tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {showAddItem && canManageVoucherItems && (
                <div className="modal-overlay" onClick={closeItemModal}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">{editingItemId ? 'Edit Biaya Lain-lain' : 'Tambah Biaya Lain-lain'}</h3><button className="modal-close" onClick={closeItemModal} disabled={savingItem}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Tanggal Biaya</label>
                                <input type="date" className="form-input" value={itemForm.expenseDate} onChange={event => setItemForm({ ...itemForm, expenseDate: event.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Kategori</label>
                                <select className="form-select" value={itemForm.category} onChange={event => setItemForm({ ...itemForm, category: event.target.value })}>
                                    {DRIVER_VOUCHER_EXPENSE_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Deskripsi</label>
                                <input className="form-input" value={itemForm.description} onChange={event => setItemForm({ ...itemForm, description: event.target.value })} placeholder="Keterangan pengeluaran..." />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah <span className="required">*</span></label>
                                <FormattedNumberInput allowDecimal={false} value={itemForm.amount} onValueChange={value => setItemForm({ ...itemForm, amount: value })} placeholder="Ketik nominal biaya" />
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={closeItemModal} disabled={savingItem}>Batal</button><button className="btn btn-primary" onClick={handleSaveItem} disabled={savingItem}><Save size={16} /> {savingItem ? 'Menyimpan...' : editingItemId ? 'Simpan Perubahan' : 'Simpan'}</button></div>
                    </div>
                </div>
            )}

            {showTopUpModal && canTopUpVoucher && (
                <div className="modal-overlay" onClick={() => { if (!toppingUp) setShowTopUpModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Tambah Uang Jalan</h3><button className="modal-close" onClick={() => setShowTopUpModal(false)} disabled={toppingUp}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', border: '1px solid var(--color-gray-200)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                                    <div>
                                        <div className="text-muted text-sm">Sudah Diberikan</div>
                                        <div className="font-semibold">{formatCurrency(totalIssuedAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Total Klaim Trip</div>
                                        <div className="font-semibold">{formatCurrency(totalClaimAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Net Settlement Saat Ini</div>
                                        <div className="font-semibold" style={{ color: balance < 0 ? 'var(--color-danger)' : 'inherit' }}>{formatCurrency(Math.abs(balance))}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Tambahan</label>
                                <input type="date" className="form-input" value={topUpForm.date} onChange={event => setTopUpForm({ ...topUpForm, date: event.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rekening / Kas Sumber <span className="required">*</span></label>
                                <select className="form-select" value={topUpForm.bankAccountRef} onChange={event => setTopUpForm({ ...topUpForm, bankAccountRef: event.target.value })}>
                                    <option value="">Pilih rekening atau kas</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Jumlah Tambahan <span className="required">*</span></label>
                                <FormattedNumberInput allowDecimal={false} value={topUpForm.amount} onValueChange={value => setTopUpForm({ ...topUpForm, amount: value })} placeholder="Ketik nominal tambahan bon" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={topUpForm.note} onChange={event => setTopUpForm({ ...topUpForm, note: event.target.value })} placeholder="Alasan tambahan bon, misalnya kurang solar, inap, atau kebutuhan lain..." />
                            </div>
                        </div>
                        <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowTopUpModal(false)} disabled={toppingUp}>Batal</button><button className="btn btn-primary" onClick={handleTopUp} disabled={toppingUp}><Plus size={16} /> {toppingUp ? 'Memproses...' : 'Tambah Uang Jalan'}</button></div>
                    </div>
                </div>
            )}

            {showSettleModal && canSettleVoucher && (
                <div className="modal-overlay" onClick={() => { if (!settling) setShowSettleModal(false); }}>
                    <div className="modal" onClick={event => event.stopPropagation()}>
                        <div className="modal-header"><h3 className="modal-title">Selesaikan Trip</h3><button className="modal-close" onClick={() => setShowSettleModal(false)} disabled={settling}><X size={20} /></button></div>
                        <div className="modal-body">
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.75rem', padding: '0.85rem 1rem', marginBottom: '1rem', border: '1px solid var(--color-gray-200)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                                    <div>
                                        <div className="text-muted text-sm">Total Uang Diberikan</div>
                                        <div className="font-semibold">{formatCurrency(totalIssuedAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Sisa Bon Operasional</div>
                                        <div className="font-semibold" style={{ color: operationalBalance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatCurrency(operationalBalance)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Total Klaim Trip</div>
                                        <div className="font-semibold">{formatCurrency(totalClaimAmount)}</div>
                                    </div>
                                    <div>
                                        <div className="text-muted text-sm">Net Settlement Akhir</div>
                                        <div className="font-semibold" style={{ color: balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatCurrency(Math.abs(balance))}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tanggal Selesaikan Trip</label>
                                <input type="date" className="form-input" value={settlementDate} onChange={event => setSettlementDate(event.target.value)} disabled={settling} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Rekening / Kas Penyelesaian Akhir {balance !== 0 ? <span className="required">*</span> : null}</label>
                                <select className="form-select" value={settlementBankRef} onChange={event => setSettlementBankRef(event.target.value)} disabled={settling}>
                                    <option value="">Pilih rekening atau kas</option>
                                    {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                </select>
                                <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '0.35rem' }}>{settlementLabel}</div>
                            </div>
                            <div style={{ background: 'var(--color-bg-secondary)', borderRadius: '0.6rem', padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Bon Pertama</span><strong>{formatCurrency(initialCashGiven)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Bon Tambahan</span><strong>{formatCurrency(topUpAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Total Uang Diberikan</span><strong>{formatCurrency(totalIssuedAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Biaya Lain-lain</span><strong>{formatCurrency(operationalSpent)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Sisa Bon Operasional</span><strong>{formatCurrency(operationalBalance)}</strong></div>
                                {linkedDeliveryOrder && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Upah Dasar DO</span><strong>{formatCurrency(linkedDoBaseTripFee)}</strong></div>}
                                {linkedDeliveryOrder && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Tambahan Overtonase</span><strong>{linkedDoHasFinalActualWeight ? formatCurrency(linkedDoOvertonaseAmount) : 'Menunggu aktual final'}</strong></div>}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Upah Borongan</span><strong>{formatCurrency(driverFeeAmount)}</strong></div>
                                {linkedDeliveryOrder && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Upah Borongan Final DO</span><strong>{linkedDoHasFinalActualWeight ? formatCurrency(linkedDoFinalTripFee) : 'Menunggu aktual final'}</strong></div>}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Total Klaim Trip</span><strong>{formatCurrency(totalClaimAmount)}</strong></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Net Settlement Akhir</span><strong style={{ color: balance >= 0 ? '#16a34a' : '#ef4444' }}>{formatCurrency(Math.abs(balance))}</strong></div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowSettleModal(false)} disabled={settling}>Batal</button>
                            <button className="btn btn-primary" onClick={handleSettle} disabled={settling}><CheckCircle size={16} /> {settling ? 'Memproses...' : settlementPrimaryLabel}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
