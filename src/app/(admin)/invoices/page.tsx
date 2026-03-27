'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, FileText, Printer, FileDown, Receipt } from 'lucide-react';
import AppPagination from '@/components/AppPagination';
import CurrencyInput from '@/components/CurrencyInput';
import { fetchAdminCollectionData } from '@/lib/api/admin-client';
import { formatDate, formatCurrency, getReceivableNetAmount, PAYMENT_METHOD_MAP } from '@/lib/utils';
import { buildFreightNotaPrintDocument, openBrandedPrint, fetchCompanyProfile, formatFreightNotaDisplayNumber } from '@/lib/print';
import { exportFreightNotaDetail, exportInvoices } from '@/lib/export';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { BankAccount, CompanyProfile, Customer, CustomerReceipt, FreightNota, FreightNotaItem, Payment } from '@/lib/types';
import { hasPermission } from '@/lib/rbac';

import { useApp, useToast } from '../layout';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    UNPAID: { label: 'Belum Lunas', color: 'danger' },
    PARTIAL: { label: 'Sebagian', color: 'warning' },
    PAID: { label: 'Lunas', color: 'success' },
};

const getNextInvoiceAction = (nota: FreightNota, remainingAmount: number) => {
    if (nota.status === 'UNPAID') {
        return 'Tagih atau catat penerimaan';
    }
    if (nota.status === 'PARTIAL') {
        return remainingAmount > 0 ? 'Follow up sisa pembayaran nota' : 'Cek alokasi penerimaan';
    }
    return (nota.totalAdjustmentAmount || 0) > 0 ? 'Arsip + cek potongan tagihan' : 'Arsip / cetak';
};

export default function NotaListPage() {
    const router = useRouter();
    const { user } = useApp();
    const { addToast } = useToast();
    const [items, setItems] = useState<FreightNota[]>([]);
    const [payments, setPayments] = useState<Payment[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [customerReceipts, setCustomerReceipts] = useState<CustomerReceipt[]>([]);
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalInvoices, setTotalInvoices] = useState(0);
    const [summary, setSummary] = useState({
        filteredNetTotal: 0,
        filteredOutstandingTotal: 0,
        unpaidCount: 0,
        partialCount: 0,
        paidCount: 0,
        customerCreditTotal: 0,
    });
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [receiving, setReceiving] = useState(false);
    const [receiptCustomerRef, setReceiptCustomerRef] = useState('');
    const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
    const [receiptMethod, setReceiptMethod] = useState('TRANSFER');
    const [receiptAmount, setReceiptAmount] = useState(0);
    const [receiptNote, setReceiptNote] = useState('');
    const [receiptBankRef, setReceiptBankRef] = useState('');
    const [receiptAllocations, setReceiptAllocations] = useState<Record<string, number>>({});
    const [receiptOpenNotas, setReceiptOpenNotas] = useState<FreightNota[]>([]);
    const [receiptOpenPayments, setReceiptOpenPayments] = useState<Payment[]>([]);
    const [receiptNotesLoading, setReceiptNotesLoading] = useState(false);
    const canCreateInvoice = user ? hasPermission(user.role, 'freightNotas', 'create') : false;
    const canCreateReceipt = user ? hasPermission(user.role, 'freightNotas', 'update') : false;
    const canExportInvoices = user ? hasPermission(user.role, 'freightNotas', 'export') : false;
    const canPrintInvoices = user ? hasPermission(user.role, 'freightNotas', 'print') : false;

    const buildInvoicesQuery = useCallback((targetPage = page, targetPageSize = DEFAULT_PAGE_SIZE) => {
        const params = new URLSearchParams({
            entity: 'freight-notas',
            page: String(targetPage),
            pageSize: String(targetPageSize),
            sortPreset: 'work-queue',
        });

        if (search.trim()) {
            params.set('q', search.trim());
            params.set('searchFields', 'notaNumber,customerName');
        }

        if (statusFilter) {
            params.set('filter', JSON.stringify({ status: statusFilter }));
        }

        return params.toString();
    }, [page, search, statusFilter]);

    const fetchAllMatchingInvoices = useCallback(async () => {
        const pageSize = 200;
        let currentPage = 1;
        let total = 0;
        const allItems: FreightNota[] = [];

        do {
            const res = await fetch(`/api/data?${buildInvoicesQuery(currentPage, pageSize)}`);
            const payload = await res.json();
            if (!res.ok) {
                throw new Error(payload.error || 'Gagal memuat nota ongkos');
            }

            const nextItems = (payload.data || []) as FreightNota[];
            total = payload.meta?.total || nextItems.length;
            allItems.push(...nextItems);
            if (nextItems.length === 0) break;
            currentPage += 1;
        } while (allItems.length < total);

        return allItems;
    }, [buildInvoicesQuery]);

    const reloadData = useCallback(async () => {
        setLoading(true);
        const summaryParams = new URLSearchParams({ entity: 'freight-notas-summary' });
        if (search.trim()) {
            summaryParams.set('q', search.trim());
        }
        if (statusFilter) {
            summaryParams.set('status', statusFilter);
        }

        const [notaRes, summaryRes, customerRes, receiptRes, bankRes, companyPayload] = await Promise.all([
            fetch(`/api/data?${buildInvoicesQuery()}`),
            fetch(`/api/data?${summaryParams.toString()}`),
            fetchAdminCollectionData<Customer[]>('/api/data?entity=customers', 'Gagal memuat customer'),
            fetchAdminCollectionData<CustomerReceipt[]>('/api/data?entity=customer-receipts', 'Gagal memuat penerimaan customer'),
            fetchAdminCollectionData<BankAccount[]>('/api/data?entity=bank-accounts', 'Gagal memuat rekening'),
            fetchCompanyProfile(),
        ]);

        const [notaPayload, summaryPayload] = await Promise.all([
            notaRes.json(),
            summaryRes.json(),
        ]);

        if (!notaRes.ok) throw new Error(notaPayload.error || 'Gagal memuat nota ongkos');
        if (!summaryRes.ok) throw new Error(summaryPayload.error || 'Gagal memuat ringkasan nota');

        const notaRows = (notaPayload.data || []) as FreightNota[];
        const notaIds = notaRows.map(nota => nota._id).filter(Boolean);
        let paymentRows: Payment[] = [];

        if (notaIds.length > 0) {
            paymentRows = await fetchAdminCollectionData<Payment[]>(
                `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaIds }))}`,
                'Gagal memuat pembayaran nota'
            );
        }

        setItems(notaRows);
        setPayments(paymentRows);
        setTotalInvoices(notaPayload.meta?.total || 0);
        setSummary({
            filteredNetTotal: summaryPayload.data?.filteredNetTotal || 0,
            filteredOutstandingTotal: summaryPayload.data?.filteredOutstandingTotal || 0,
            unpaidCount: summaryPayload.data?.unpaidCount || 0,
            partialCount: summaryPayload.data?.partialCount || 0,
            paidCount: summaryPayload.data?.paidCount || 0,
            customerCreditTotal: summaryPayload.data?.customerCreditTotal || 0,
        });
        setCustomers((customerRes || []).filter(customer => customer.active !== false));
        setCustomerReceipts(receiptRes || []);
        setBankAccounts((bankRes || []).filter(account => account.active !== false));
        setCompany(companyPayload);
    }, [buildInvoicesQuery, search, statusFilter]);

    useEffect(() => {
        reloadData()
            .catch(error => {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat nota ongkos');
            })
            .finally(() => {
                setLoading(false);
            });
    }, [addToast, reloadData]);

    useEffect(() => {
        setPage(1);
    }, [search, statusFilter]);

    const paymentTotalsByInvoice = payments.reduce<Record<string, number>>((acc, payment) => {
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + payment.amount;
        return acc;
    }, {});

    const getNotaRemaining = (nota: FreightNota) =>
        Math.max(getReceivableNetAmount(nota) - (paymentTotalsByInvoice[nota._id] || 0), 0);

    const receiptCustomerOptions = Array.from(
        customers.reduce<Map<string, { ref: string; name: string }>>((map, customer) => {
            map.set(customer._id, { ref: customer._id, name: customer.name });
            return map;
        }, new Map()).values()
    );
    receiptCustomerOptions.sort((a, b) => a.name.localeCompare(b.name));

    const selectedReceiptCustomer = receiptCustomerOptions.find(option => option.ref === receiptCustomerRef) || null;
    const receiptPaymentTotals = receiptOpenPayments.reduce<Record<string, number>>((acc, payment) => {
        acc[payment.invoiceRef] = (acc[payment.invoiceRef] || 0) + payment.amount;
        return acc;
    }, {});
    const receiptOpenNotaItems = receiptOpenNotas
        .map(nota => ({
            nota,
            paidAmount: receiptPaymentTotals[nota._id] || 0,
            netAmount: getReceivableNetAmount(nota),
            remainingAmount: Math.max(getReceivableNetAmount(nota) - (receiptPaymentTotals[nota._id] || 0), 0),
        }))
        .filter(item => item.remainingAmount > 0)
        .sort((a, b) => a.nota.issueDate.localeCompare(b.nota.issueDate));
    const singleOpenNota = receiptOpenNotaItems.length === 1 ? receiptOpenNotaItems[0] : null;
    const hasSingleOpenNota = Boolean(singleOpenNota);

    const totalAllocated = Object.values(receiptAllocations).reduce((sum, amount) => sum + amount, 0);
    const unappliedReceiptAmount = Math.max(receiptAmount - totalAllocated, 0);
    const customerCreditByRef = customerReceipts.reduce<Record<string, number>>((acc, receipt) => {
        const key = receipt.customerRef || receipt.customerName;
        if (!key) return acc;
        const unappliedAmount = typeof receipt.unappliedAmount === 'number' ? receipt.unappliedAmount : 0;
        if (unappliedAmount <= 0) return acc;
        acc[key] = (acc[key] || 0) + unappliedAmount;
        return acc;
    }, {});
    const selectedCustomerStoredCredit = customerCreditByRef[receiptCustomerRef] || 0;
    const selectedCustomerOpenTotal = receiptOpenNotaItems.reduce((sum, item) => sum + item.remainingAmount, 0);
    const receiptOpenCount = receiptOpenNotaItems.length;
    const receiptPrimaryLabel = receiptOpenCount === 0
        ? 'Simpan Kredit Customer'
        : unappliedReceiptAmount > 0
            ? 'Simpan Penerimaan & Kredit'
            : 'Simpan Penerimaan';

    useEffect(() => {
        if (!showReceiptModal || !receiptCustomerRef) {
            setReceiptOpenNotas([]);
            setReceiptOpenPayments([]);
            setReceiptNotesLoading(false);
            return;
        }

        let cancelled = false;

        const loadReceiptOpenNotas = async () => {
            setReceiptNotesLoading(true);
            try {
                const fetchNotaBatch = async (filterObj: Record<string, unknown>) => {
                    return fetchAdminCollectionData<FreightNota[]>(
                        `/api/data?entity=freight-notas&sortPreset=work-queue&filter=${encodeURIComponent(JSON.stringify(filterObj))}`,
                        'Gagal memuat nota terbuka customer'
                    );
                };

                const [byCustomerRef, byCustomerName] = await Promise.all([
                    fetchNotaBatch({ customerRef: receiptCustomerRef, status: ['UNPAID', 'PARTIAL'] }),
                    selectedReceiptCustomer?.name
                        ? fetchNotaBatch({ customerName: selectedReceiptCustomer.name, status: ['UNPAID', 'PARTIAL'] })
                        : Promise.resolve([] as FreightNota[]),
                ]);

                const notaMap = new Map<string, FreightNota>();
                [...byCustomerRef, ...byCustomerName].forEach(nota => {
                    notaMap.set(nota._id, nota);
                });
                const notaRows = Array.from(notaMap.values());
                const notaIds = notaRows.map(nota => nota._id).filter(Boolean);
                let paymentRows: Payment[] = [];

                if (notaIds.length > 0) {
                    paymentRows = await fetchAdminCollectionData<Payment[]>(
                        `/api/data?entity=payments&filter=${encodeURIComponent(JSON.stringify({ invoiceRef: notaIds }))}`,
                        'Gagal memuat alokasi penerimaan'
                    );
                }

                if (cancelled) return;
                setReceiptOpenNotas(notaRows);
                setReceiptOpenPayments(paymentRows);
            } catch (error) {
                if (cancelled) return;
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat nota terbuka customer');
            } finally {
                if (!cancelled) {
                    setReceiptNotesLoading(false);
                }
            }
        };

        void loadReceiptOpenNotas();

        return () => {
            cancelled = true;
        };
    }, [addToast, receiptCustomerRef, selectedReceiptCustomer?.name, showReceiptModal]);

    useEffect(() => {
        if (!singleOpenNota) {
            return;
        }

        const maxAllowed = singleOpenNota.remainingAmount;
        const nextAmount = receiptAmount > 0 ? receiptAmount : maxAllowed;
        const nextAllocation = Math.min(nextAmount, maxAllowed);
        const currentAmount = receiptAllocations[singleOpenNota.nota._id] || 0;
        const allocationKeys = Object.keys(receiptAllocations);

        if (receiptAmount !== nextAmount) {
            setReceiptAmount(nextAmount);
            return;
        }

        if (currentAmount !== nextAllocation || allocationKeys.length !== 1 || allocationKeys[0] !== singleOpenNota.nota._id) {
            setReceiptAllocations(nextAllocation > 0 ? { [singleOpenNota.nota._id]: nextAllocation } : {});
        }
    }, [singleOpenNota, receiptAmount, receiptAllocations]);

    const resetReceiptModal = () => {
        setReceiptCustomerRef('');
        setReceiptDate(new Date().toISOString().split('T')[0]);
        setReceiptMethod('TRANSFER');
        setReceiptAmount(0);
        setReceiptNote('');
        setReceiptBankRef('');
        setReceiptAllocations({});
    };

    const openReceiptModal = () => {
        resetReceiptModal();
        setShowReceiptModal(true);
    };

    const updateReceiptAllocation = (notaId: string, amount: number) => {
        setReceiptAllocations(prev => {
            const next = { ...prev };
            if (!Number.isFinite(amount) || amount <= 0) {
                delete next[notaId];
            } else {
                next[notaId] = amount;
            }
            return next;
        });
    };

    const handleCreateCustomerReceipt = async () => {
        const allocations = receiptOpenNotaItems
            .map(item => ({
                invoiceRef: item.nota._id,
                amount: receiptAllocations[item.nota._id] || 0,
            }))
            .filter(item => item.amount > 0);

        if (!receiptCustomerRef) {
            addToast('error', 'Pilih customer dulu');
            return;
        }
        if (receiptAmount <= 0) {
            addToast('error', 'Total penerimaan harus lebih dari 0');
            return;
        }
        if (totalAllocated - receiptAmount > 0.00001) {
            addToast('error', 'Total alokasi tidak boleh melebihi total penerimaan');
            return;
        }
        if (receiptMethod === 'TRANSFER' && !receiptBankRef) {
            addToast('error', 'Pilih rekening untuk transfer');
            return;
        }

        setReceiving(true);
        try {
            const res = await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    entity: 'customer-receipts',
                    data: {
                        customerRef: receiptCustomerRef,
                        date: receiptDate,
                        totalAmount: receiptAmount,
                        method: receiptMethod,
                        note: receiptNote,
                        bankAccountRef: receiptBankRef || undefined,
                        allocations,
                    },
                }),
            });
            const payload = await res.json();
            if (!res.ok) {
                addToast('error', payload.error || 'Gagal mencatat penerimaan');
                return;
            }
            const unappliedAmount = typeof payload.data?.unappliedAmount === 'number' ? payload.data.unappliedAmount : 0;
            addToast(
                'success',
                unappliedAmount > 0
                    ? `Penerimaan customer berhasil dicatat. Kredit customer tersimpan ${formatCurrency(unappliedAmount)}`
                    : 'Penerimaan customer berhasil dicatat'
            );
            setShowReceiptModal(false);
            resetReceiptModal();
            setLoading(true);
            await reloadData();
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal mencatat penerimaan');
        } finally {
            setLoading(false);
            setReceiving(false);
        }
    };

    const grandTotal = summary.filteredNetTotal;
    const outstandingTotal = summary.filteredOutstandingTotal;
    const queueCounts = {
        needPayment: summary.unpaidCount,
        partialPayment: summary.partialCount,
        paid: summary.paidCount,
    };

    const fetchNotaItems = async (notaId: string) => {
        const response = await fetch(`/api/data?entity=freight-nota-items&filter=${encodeURIComponent(JSON.stringify({ notaRef: notaId }))}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Gagal memuat item nota');
        }
        return (payload.data || []) as FreightNotaItem[];
    };

    const fetchCustomerSummary = async (customerRef?: string) => {
        if (!customerRef) return null;
        const response = await fetch(`/api/data?entity=customers&id=${customerRef}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.error || 'Gagal memuat customer');
        }
        return (payload.data || null) as Pick<Customer, '_id' | 'name' | 'address' | 'contactPerson' | 'phone'> | null;
    };

    const handlePrintNota = async (nota: FreightNota) => {
        try {
            const [resolvedCompany, notaItems, customer] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile(),
                fetchNotaItems(nota._id),
                fetchCustomerSummary(nota.customerRef),
            ]);
            setCompany(resolvedCompany);
            const doc = buildFreightNotaPrintDocument({
                nota,
                items: notaItems,
                company: resolvedCompany,
                customer,
                invoiceBankAccounts: bankAccounts,
            });
            openBrandedPrint({
                title: doc.title,
                subtitle: doc.subtitle,
                company: resolvedCompany,
                bodyHtml: doc.bodyHtml,
                extraStyles: doc.extraStyles,
                showCompanyHeader: doc.showCompanyHeader,
                showFooter: doc.showFooter,
            });
        } catch {
            addToast('error', 'Gagal menyiapkan cetak nota');
        }
    };

    const handleExportNota = async (nota: FreightNota) => {
        try {
            const [resolvedCompany, notaItems] = await Promise.all([
                company ? Promise.resolve(company) : fetchCompanyProfile(),
                fetchNotaItems(nota._id),
            ]);
            setCompany(resolvedCompany);
            await exportFreightNotaDetail(nota, notaItems, resolvedCompany, bankAccounts);
            addToast('success', 'Excel nota berhasil di-download');
        } catch {
            addToast('error', 'Gagal menyiapkan Excel nota');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left">
                    <h1 className="page-title">Nota Ongkos Angkut</h1>
                </div>
                <div className="page-actions">
                    {canCreateReceipt && <button className="btn btn-success" onClick={openReceiptModal}><Plus size={18} /> Catat Penerimaan</button>}
                    {canExportInvoices && <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            try {
                                const allMatchingNotas = await fetchAllMatchingInvoices();
                                await exportInvoices(allMatchingNotas as unknown as Record<string, unknown>[]);
                                addToast('success', 'Excel daftar nota berhasil di-download');
                            } catch (error) {
                                addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel daftar nota');
                            }
                        }}
                    >
                        <FileDown size={15} /> Excel
                    </button>}
                    {canPrintInvoices && <button className="btn btn-secondary btn-sm" onClick={async () => {
                        const co = company ?? await fetchCompanyProfile();
                        const allMatchingNotas = await fetchAllMatchingInvoices();
                        setCompany(co);
                        openBrandedPrint({
                            title: 'Daftar Nota Ongkos Angkut', company: co, bodyHtml: `
                            <table><thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th class="r">Tagihan Netto</th><th>Status</th></tr></thead>
                            <tbody>${allMatchingNotas.map(n => `<tr><td><div class="b">${formatFreightNotaDisplayNumber(n, co)}</div><div style="font-size:11px;color:#64748b">${n.notaNumber}</div></td><td>${n.customerName}</td><td>${formatDate(n.issueDate)}</td><td>${n.totalCollie || 0}</td><td>${n.totalWeightKg || 0} kg</td><td class="r b">${formatCurrency(getReceivableNetAmount(n))}</td><td>${STATUS_MAP[n.status]?.label || n.status}</td></tr>`).join('')}
                            <tr style="border-top:2px solid #1e293b"><td colspan="5" class="r b">TOTAL</td><td class="r b">${formatCurrency(grandTotal)}</td><td></td></tr></tbody></table>`
                        });
                    }}><Printer size={15} /> Print</button>}
                    {canCreateInvoice && <button className="btn btn-primary" onClick={() => router.push('/invoices/new')}><Plus size={18} /> Buat Nota Baru</button>}
                </div>
            </div>

            {/* KPI */}
            <div className="kpi-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="kpi-card">
                    <div className="kpi-icon danger"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Sisa Piutang</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem', color: 'var(--color-danger)' }}>{formatCurrency(outstandingTotal)}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon warning"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Perlu Ditagih</div>
                        <div className="kpi-value">{queueCounts.needPayment}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon success"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Follow Up Parsial</div>
                        <div className="kpi-value">{queueCounts.partialPayment}</div>
                    </div>
                </div>
                <div className="kpi-card">
                    <div className="kpi-icon info"><Receipt size={20} /></div>
                    <div className="kpi-content">
                        <div className="kpi-label">Kredit Customer</div>
                        <div className="kpi-value" style={{ fontSize: '1.05rem' }}>{formatCurrency(summary.customerCreditTotal)}</div>
                    </div>
                </div>
            </div>

            <div className="table-container">
                <div className="table-toolbar">
                    <div className="table-toolbar-left">
                        <div className="table-search"><Search size={16} className="table-search-icon" /><input placeholder="Cari nota, customer..." value={search} onChange={e => setSearch(e.target.value)} /></div>
                        <select className="form-select" style={{ width: 'auto', minWidth: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="">Semua Status</option>
                            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="table-wrapper table-desktop-only">
                    <table>
                        <thead><tr><th>No. Nota</th><th>Customer</th><th>Tanggal</th><th>Total Collie</th><th>Total Berat</th><th>Tagihan Netto</th><th>Status</th><th>Tindak Lanjut</th><th>Aksi</th></tr></thead>
                        <tbody>
                            {loading ? [1, 2, 3].map(i => <tr key={i}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(j => <td key={j}><div className="skeleton skeleton-text" /></td>)}</tr>) :
                                totalInvoices === 0 ? (
                                    <tr><td colSpan={9}><div className="empty-state"><FileText size={48} className="empty-state-icon" /><div className="empty-state-title">Belum ada nota</div><div className="empty-state-text">Belum ada nota yang bisa ditampilkan</div></div></td></tr>
                                ) : items.map(n => (
                                    <tr key={n._id}>
                                        <td>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                style={{ padding: 0, textAlign: 'left', color: 'var(--color-primary)' }}
                                                onClick={() => router.push(`/invoices/${n._id}`)}
                                            >
                                                <div className="font-semibold">{formatFreightNotaDisplayNumber(n, company)}</div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{n.notaNumber}</div>
                                            </button>
                                        </td>
                                        <td>{n.customerName}</td>
                                        <td className="text-muted">{formatDate(n.issueDate)}</td>
                                        <td>{n.totalCollie || 0}</td>
                                        <td>{(n.totalWeightKg || 0).toLocaleString('id')} kg</td>
                                        <td>
                                            <div className="font-semibold">{formatCurrency(getReceivableNetAmount(n))}</div>
                                            {(n.totalAdjustmentAmount || 0) > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bruto {formatCurrency(n.totalAmount)}</div>}
                                        </td>
                                        <td><span className={`badge badge-${STATUS_MAP[n.status]?.color}`}><span className="badge-dot" /> {STATUS_MAP[n.status]?.label}</span></td>
                                        <td><span style={{ fontWeight: 500 }}>{getNextInvoiceAction(n, getNotaRemaining(n))}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                <button className="table-action-btn" onClick={() => router.push(`/invoices/${n._id}`)}>Buka</button>
                                                {canExportInvoices && <button className="table-action-btn" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>}
                                                {canPrintInvoices && <button className="table-action-btn" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                </div>
                {!loading && (
                    <div className="mobile-record-list">
                        {totalInvoices === 0 ? (
                            <div className="mobile-record-card">
                                <div className="mobile-record-title">Belum ada nota</div>
                                <div className="mobile-record-subtitle">Belum ada nota yang bisa ditampilkan.</div>
                            </div>
                        ) : items.map(n => (
                            <div key={n._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{formatFreightNotaDisplayNumber(n, company)}</div>
                                        <div className="mobile-record-subtitle">{n.customerName || '-'} • {formatDate(n.issueDate)}</div>
                                    </div>
                                    <span className={`badge badge-${STATUS_MAP[n.status]?.color}`}>
                                        <span className="badge-dot" /> {STATUS_MAP[n.status]?.label}
                                    </span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">No. Internal</span>
                                        <span className="mobile-record-value">{n.notaNumber}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Total Collie</span>
                                        <span className="mobile-record-value">{n.totalCollie || 0}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Total Berat</span>
                                        <span className="mobile-record-value">{(n.totalWeightKg || 0).toLocaleString('id')} kg</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tagihan Netto</span>
                                        <span className="mobile-record-value" style={{ fontWeight: 700 }}>{formatCurrency(getReceivableNetAmount(n))}</span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Tindak Lanjut</span>
                                        <span className="mobile-record-value">{getNextInvoiceAction(n, getNotaRemaining(n))}</span>
                                    </div>
                                </div>
                                <div className="mobile-record-actions">
                                    <button className="btn btn-secondary" onClick={() => router.push(`/invoices/${n._id}`)}>Buka</button>
                                    {canExportInvoices && <button className="btn btn-secondary" onClick={() => void handleExportNota(n)}><FileDown size={13} /> Excel</button>}
                                    {canPrintInvoices && <button className="btn btn-secondary" onClick={() => void handlePrintNota(n)}><Printer size={13} /> Cetak</button>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {totalInvoices > 0 && (
                    <AppPagination
                        page={page}
                        pageSize={DEFAULT_PAGE_SIZE}
                        totalItems={totalInvoices}
                        onPageChange={setPage}
                        info={({ startIndex, endIndex, totalItems }) => (
                            <>
                                Menampilkan {startIndex}-{endIndex} dari {totalItems} nota. Urutan dimulai dari tagihan yang paling perlu ditindaklanjuti. Total netto terfilter: <strong style={{ color: 'var(--color-danger)' }}>{formatCurrency(grandTotal)}</strong>
                            </>
                        )}
                    />
                )}
            </div>
            {canCreateReceipt && showReceiptModal && (
                <div className="modal-overlay" onClick={() => { if (!receiving) setShowReceiptModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
                        <div className="modal-header">
                            <h3 className="modal-title">Catat Penerimaan Customer</h3>
                            <button className="modal-close" onClick={() => setShowReceiptModal(false)} disabled={receiving}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Customer</label>
                                    <select className="form-select" value={receiptCustomerRef} onChange={e => { setReceiptCustomerRef(e.target.value); setReceiptAllocations({}); setReceiptAmount(0); }} disabled={receiving}>
                                        <option value="">-- Pilih customer --</option>
                                        {receiptCustomerOptions.map(option => <option key={option.ref} value={option.ref}>{option.name}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Tanggal Penerimaan</label>
                                    <input type="date" className="form-input" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} disabled={receiving} />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Metode</label>
                                    <select className="form-select" value={receiptMethod} onChange={e => setReceiptMethod(e.target.value)} disabled={receiving}>
                                        {Object.entries(PAYMENT_METHOD_MAP).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Rekening / Kas</label>
                                    <select className="form-select" value={receiptBankRef} onChange={e => setReceiptBankRef(e.target.value)} disabled={receiving}>
                                        <option value="">{receiptMethod === 'CASH' ? '-- Otomatis ke Kas Tunai --' : '-- Pilih --'}</option>
                                        {bankAccounts.map(account => <option key={account._id} value={account._id}>{account.bankName} - {account.accountNumber}{account.accountType === 'CASH' ? ' (Kas Tunai)' : ''}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">Total Penerimaan (Rp)</label>
                                    <CurrencyInput value={receiptAmount} onValueChange={value => setReceiptAmount(value)} disabled={receiving} placeholder="Ketik total penerimaan" />
                                </div>
                                {!hasSingleOpenNota && (
                                    <div className="form-group" style={{ alignSelf: 'end' }}>
                                        <button className="btn btn-secondary" type="button" onClick={() => setReceiptAmount(totalAllocated)} disabled={receiving || totalAllocated <= 0}>Samakan Dengan Total Alokasi</button>
                                    </div>
                                )}
                            </div>
                            <div className="form-group">
                                <label className="form-label">Catatan</label>
                                <textarea className="form-textarea" rows={2} value={receiptNote} onChange={e => setReceiptNote(e.target.value)} disabled={receiving} placeholder="Contoh: Transfer gabungan invoice Arwana batch 1" />
                            </div>
                            <div style={{ background: 'var(--color-gray-50)', borderRadius: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.78rem', color: 'var(--color-gray-600)', marginBottom: '1rem' }}>
                                Satu penerimaan customer mewakili satu uang masuk nyata di bank/kas. Penerimaan ini bisa dialokasikan ke beberapa nota customer yang sama. Jika ada sisa yang belum dialokasikan, sistem menyimpannya sebagai kredit customer.
                            </div>
                            {receiptCustomerRef && (
                                <div style={{ background: 'var(--color-primary-50)', border: '1px solid var(--color-primary-100)', borderRadius: '0.75rem', padding: '0.9rem 1rem', marginBottom: '1rem' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', fontSize: '0.82rem' }}>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Jumlah Nota Terbuka</div>
                                            <div style={{ fontWeight: 700 }}>{receiptOpenCount} nota</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Nota Terbuka Saat Ini</div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrency(selectedCustomerOpenTotal)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Kredit Customer Tersimpan</div>
                                            <div style={{ fontWeight: 700 }}>{formatCurrency(selectedCustomerStoredCredit)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Belum Dialokasikan dari Penerimaan Ini</div>
                                            <div style={{ fontWeight: 700, color: unappliedReceiptAmount > 0 ? 'var(--color-warning)' : 'inherit' }}>{formatCurrency(unappliedReceiptAmount)}</div>
                                        </div>
                                        <div>
                                            <div style={{ color: 'var(--text-muted)' }}>Mode Penerimaan</div>
                                            <div style={{ fontWeight: 700 }}>
                                                {receiptOpenCount === 0
                                                    ? 'Semua jadi kredit'
                                                    : hasSingleOpenNota
                                                        ? 'Alokasi otomatis'
                                                        : 'Alokasi manual'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {!receiptCustomerRef ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Pilih customer</div>
                                    <div className="empty-state-text">Daftar nota terbuka dan kredit customer akan muncul setelah customer dipilih.</div>
                                </div>
                            ) : receiptNotesLoading ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Memuat nota terbuka</div>
                                    <div className="empty-state-text">Sedang mengambil sisa tagihan customer ini.</div>
                                </div>
                            ) : receiptOpenNotaItems.length === 0 ? (
                                <div className="empty-state">
                                    <div className="empty-state-title">Tidak ada nota terbuka</div>
                                    <div className="empty-state-text">Customer ini tidak punya sisa tagihan netto. Kamu tetap bisa menyimpan penerimaan ini sebagai kredit customer.</div>
                                </div>
                            ) : hasSingleOpenNota && singleOpenNota ? (
                                <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '0.75rem', padding: '0.9rem', background: 'var(--color-gray-50)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Alokasi Otomatis ke Satu Nota</div>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'grid', gap: '0.25rem' }}>
                                        <div>Nota: <strong>{formatFreightNotaDisplayNumber(singleOpenNota.nota, company)}</strong></div>
                                        <div>No. Internal: {singleOpenNota.nota.notaNumber}</div>
                                        <div>Sisa tagihan: <strong>{formatCurrency(singleOpenNota.remainingAmount)}</strong></div>
                                        <div>Penerimaan yang kamu isi di atas akan langsung dialokasikan ke nota ini sampai penuh. Jika nominalnya lebih besar, sisanya otomatis menjadi kredit customer.</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="table-wrapper" style={{ overflowX: 'auto' }}>
                                    <table style={{ minWidth: 720 }}>
                                        <thead><tr><th>No. Nota</th><th>Tgl</th><th>Netto</th><th>Sudah Dibayar</th><th>Sisa</th><th>Alokasi Penerimaan</th></tr></thead>
                                        <tbody>
                                            {receiptOpenNotaItems.map(item => (
                                                <tr key={item.nota._id}>
                                                    <td>
                                                        <div className="font-semibold">{formatFreightNotaDisplayNumber(item.nota, company)}</div>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{item.nota.notaNumber}</div>
                                                    </td>
                                                    <td>{formatDate(item.nota.issueDate)}</td>
                                                    <td>{formatCurrency(item.netAmount)}</td>
                                                    <td>{formatCurrency(item.paidAmount)}</td>
                                                    <td>
                                                        <div className="font-semibold">{formatCurrency(item.remainingAmount)}</div>
                                                        <button className="table-action-btn" type="button" onClick={() => updateReceiptAllocation(item.nota._id, item.remainingAmount)} disabled={receiving}>Isi penuh</button>
                                                    </td>
                                                    <td><CurrencyInput value={receiptAllocations[item.nota._id] || 0} onValueChange={value => updateReceiptAllocation(item.nota._id, value)} disabled={receiving} placeholder="Alokasi" /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
                                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total alokasi: <strong>{formatCurrency(totalAllocated)}</strong></div>
                                <div style={{ fontSize: '0.85rem', color: totalAllocated - receiptAmount > 0.00001 ? 'var(--color-danger)' : unappliedReceiptAmount > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                                    {totalAllocated - receiptAmount > 0.00001
                                        ? 'Total alokasi melebihi total penerimaan'
                                        : unappliedReceiptAmount > 0
                                            ? `Belum dialokasikan / kredit customer: ${formatCurrency(unappliedReceiptAmount)}`
                                            : 'Total alokasi sudah cocok dengan penerimaan'}
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowReceiptModal(false)} disabled={receiving}>Batal</button>
                            <button className="btn btn-success" onClick={() => void handleCreateCustomerReceipt()} disabled={receiving}>{receiving ? 'Memproses...' : receiptPrimaryLabel}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
