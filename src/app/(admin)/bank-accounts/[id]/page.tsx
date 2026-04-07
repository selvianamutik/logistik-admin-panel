'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { ArrowRightLeft, FileDown, Printer, TrendingDown, TrendingUp } from 'lucide-react';

import PageBackButton from '@/components/PageBackButton';
import { useApp, useToast } from '../../layout';
import { fetchAdminCollectionData, fetchAdminData } from '@/lib/api/admin-client';
import { formatBusinessDate, getBusinessDateValue } from '@/lib/business-date';
import {
    buildExpenseLookup,
    buildPaymentLookup,
    buildPurchaseLookup,
    buildRefundLookup,
    resolveBankTransactionSourceLink,
} from '@/lib/bank-transaction-links';
import { exportToExcel } from '@/lib/export';
import { parseFormattedNumberish } from '@/lib/formatted-number';
import { fetchCompanyProfile, openBrandedPrint, openPrintWindow } from '@/lib/print';
import type { BankAccount, BankTransaction, CompanyProfile, CustomerOverpaymentRefund, Expense, FreightNota, Payment, Purchase } from '@/lib/types';
import { hasPageAccess, hasPermission } from '@/lib/rbac';

const BANK_LOGOS: Record<string, { logo: string; color: string; gradient: string }> = {
    CASH: { color: '#14532d', gradient: 'linear-gradient(135deg, #14532d 0%, #16a34a 100%)', logo: '' },
    BCA: { color: '#003b7b', gradient: 'linear-gradient(135deg, #003b7b 0%, #0060c7 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Bank_Central_Asia.svg/200px-Bank_Central_Asia.svg.png' },
    MANDIRI: { color: '#003868', gradient: 'linear-gradient(135deg, #003868 0%, #005ba5 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/Bank_Mandiri_logo_2016.svg/200px-Bank_Mandiri_logo_2016.svg.png' },
    BRI: { color: '#00529c', gradient: 'linear-gradient(135deg, #00529c 0%, #0078d4 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/BANK_BRI_logo.svg/200px-Bank_BRI_logo.svg.png' },
    BNI: { color: '#e35205', gradient: 'linear-gradient(135deg, #e35205 0%, #f97316 100%)', logo: 'https://upload.wikimedia.org/wikipedia/id/thumb/5/55/BNI_logo.svg/200px-BNI_logo.svg.png' },
    BSI: { color: '#00a650', gradient: 'linear-gradient(135deg, #00a650 0%, #22c55e 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Bank_Syariah_Indonesia.svg/200px-Bank_Syariah_Indonesia.svg.png' },
    DEFAULT: { color: '#6b7280', gradient: 'linear-gradient(135deg, #374151 0%, #6b7280 100%)', logo: '' },
};

function isCashAccount(account: Pick<BankAccount, 'accountType' | 'systemKey'>) {
    return account.accountType === 'CASH' || account.systemKey === 'cash-on-hand';
}

function getBankInfo(name: string) {
    const key = Object.keys(BANK_LOGOS).find(bank => bank !== 'DEFAULT' && name.toUpperCase().includes(bank));
    return BANK_LOGOS[key || 'DEFAULT'];
}

function BankDetailLogo({ name, size = 48 }: { name: string; size?: number }) {
    const info = getBankInfo(name);
    const [err, setErr] = useState(false);

    if (info.logo && !err) {
        return (
            <div style={{ width: size, height: size, borderRadius: '0.6rem', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', padding: size * 0.08 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={info.logo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={() => setErr(true)} />
            </div>
        );
    }

    return (
        <div style={{ width: size, height: size, borderRadius: '0.6rem', background: info.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: size * 0.32, flexShrink: 0, boxShadow: `0 2px 8px ${info.color}40` }}>
            {name.slice(0, 3).toUpperCase()}
        </div>
    );
}

export default function BankAccountDetailPage() {
    const params = useParams();
    const { user } = useApp();
    const { addToast } = useToast();
    const accountId = params.id as string;
    const [account, setAccount] = useState<BankAccount | null>(null);
    const [transactions, setTransactions] = useState<BankTransaction[]>([]);
    const [relatedPayments, setRelatedPayments] = useState<Array<Pick<Payment, '_id' | 'invoiceRef' | 'receiptNumber'>>>([]);
    const [relatedRefunds, setRelatedRefunds] = useState<Array<Pick<CustomerOverpaymentRefund, '_id' | 'sourceInvoiceRef' | 'sourceReceiptRef' | 'sourceReceiptNumber' | 'sourceType'>>>([]);
    const [relatedExpenses, setRelatedExpenses] = useState<Array<Pick<Expense, '_id' | 'voucherRef' | 'boronganRef' | 'relatedVehicleRef' | 'relatedIncidentRef'>>>([]);
    const [relatedPurchases, setRelatedPurchases] = useState<Array<Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierName'>>>([]);
    const [relatedFreightNotas, setRelatedFreightNotas] = useState<Array<Pick<FreightNota, '_id'>>>([]);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const canExportBankAccount = user ? hasPermission(user.role, 'bankAccounts', 'export') : false;
    const canPrintBankAccount = user ? hasPermission(user.role, 'bankAccounts', 'print') : false;
    const canOpenInvoices = user ? hasPageAccess(user.role, 'invoices') : false;
    const canOpenDriverVouchers = user ? hasPageAccess(user.role, 'driverVouchers') : false;
    const canOpenDriverBorongans = user ? hasPageAccess(user.role, 'driverBorongans') : false;
    const canOpenVehicles = user ? hasPageAccess(user.role, 'vehicles') : false;
    const canOpenIncidents = user ? hasPageAccess(user.role, 'incidents') : false;
    const canOpenPurchases = user ? hasPageAccess(user.role, 'purchases') : false;

    const paymentsById = useMemo(() => buildPaymentLookup(relatedPayments), [relatedPayments]);
    const refundsById = useMemo(() => buildRefundLookup(relatedRefunds), [relatedRefunds]);
    const expensesById = useMemo(() => buildExpenseLookup(relatedExpenses), [relatedExpenses]);
    const purchasesById = useMemo(() => buildPurchaseLookup(relatedPurchases), [relatedPurchases]);
    const invoiceIdsWithPages = useMemo(() => new Set(relatedFreightNotas.map(nota => nota._id)), [relatedFreightNotas]);

    useEffect(() => {
        const fetchEntity = async <T,>(url: string) => {
            const res = await fetch(url);
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || 'Gagal memuat detail rekening');
            }
            return result.data as T;
        };

        const fetchEntityByIds = async <T extends { _id: string }>(entity: string, ids: string[]) => {
            const uniqueIds = Array.from(new Set(ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
            if (uniqueIds.length === 0) {
                return [] as T[];
            }

            const rows = await Promise.all(
                uniqueIds.map(id =>
                    fetchAdminData<T | null>(`/api/data?entity=${entity}&id=${id}`, `Gagal memuat relasi ${entity}`).catch(() => null)
                )
            );
            return rows.filter((row) => Boolean(row?._id)) as T[];
        };

        const loadAccountDetail = async () => {
            setLoading(true);
            try {
                const [accountData, transactionData, companyData] = await Promise.all([
                    fetchEntity<BankAccount | null>(`/api/data?entity=bank-accounts&id=${accountId}`),
                    fetchAdminCollectionData<BankTransaction[]>(
                        `/api/data?entity=bank-transactions&filter=${encodeURIComponent(JSON.stringify({ bankAccountRef: accountId }))}`,
                        'Gagal memuat detail rekening'
                    ),
                    fetchCompanyProfile().catch(() => null),
                ]);
                const paymentRows = await fetchEntityByIds<Pick<Payment, '_id' | 'invoiceRef' | 'receiptNumber'>>(
                    'payments',
                    (transactionData || []).map(transaction => transaction.relatedPaymentRef || '')
                );
                const refundRows = await fetchEntityByIds<Pick<CustomerOverpaymentRefund, '_id' | 'sourceInvoiceRef' | 'sourceReceiptRef' | 'sourceReceiptNumber' | 'sourceType'>>(
                    'customer-overpayment-refunds',
                    (transactionData || []).map(transaction => transaction.relatedOverpaymentRefundRef || '')
                );
                const expenseRows = await fetchEntityByIds<Pick<Expense, '_id' | 'voucherRef' | 'boronganRef' | 'relatedVehicleRef' | 'relatedIncidentRef'>>(
                    'expenses',
                    (transactionData || []).map(transaction => transaction.relatedExpenseRef || '')
                );
                const purchaseRows = await fetchEntityByIds<Pick<Purchase, '_id' | 'purchaseNumber' | 'supplierName'>>(
                    'purchases',
                    (transactionData || []).map(transaction => transaction.relatedPurchaseRef || '')
                );
                const freightNotaRows = await fetchEntityByIds<Pick<FreightNota, '_id'>>(
                    'freight-notas',
                    [
                        ...paymentRows.map(payment => payment.invoiceRef || ''),
                        ...refundRows.map(refund => refund.sourceInvoiceRef || ''),
                    ].filter(id => /^nota-/i.test(id))
                );
                setAccount(accountData);
                setTransactions(
                    (transactionData || []).sort(
                        (a, b) =>
                            new Date(b.date || b._createdAt || '').getTime() -
                        new Date(a.date || a._createdAt || '').getTime()
                    )
                );
                setRelatedPayments(paymentRows);
                setRelatedRefunds(refundRows);
                setRelatedExpenses(expenseRows);
                setRelatedPurchases(purchaseRows);
                setRelatedFreightNotas(freightNotaRows);
                setCompany(companyData || null);
            } catch (error) {
                addToast('error', error instanceof Error ? error.message : 'Gagal memuat detail rekening');
            } finally {
                setLoading(false);
            }
        };

        void loadAccountDetail();
    }, [accountId, addToast]);

    const fmt = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
    const fmtN = (n: number) => new Intl.NumberFormat('id-ID').format(n);
    const parseWholeMoneyLike = (value: unknown) =>
        parseFormattedNumberish(value ?? 0, { maxFractionDigits: 0 });
    const fmtDate = (d: string) => {
        try {
            return formatBusinessDate(d, 'id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
            return d;
        }
    };

    const typeConfig: Record<string, { label: string; badge: string; sign: string; icon: ReactNode }> = {
        CREDIT: { label: 'Masuk', badge: 'badge-success', sign: '+', icon: <TrendingUp size={14} /> },
        DEBIT: { label: 'Keluar', badge: 'badge-danger', sign: '-', icon: <TrendingDown size={14} /> },
        TRANSFER_IN: { label: 'Transfer Masuk', badge: 'badge-success', sign: '+', icon: <ArrowRightLeft size={14} /> },
        TRANSFER_OUT: { label: 'Transfer Keluar', badge: 'badge-danger', sign: '-', icon: <ArrowRightLeft size={14} /> },
    };

    const handleExportExcel = async () => {
        try {
            await exportToExcel(
                transactions.map((tx) => ({
                    date: tx.date,
                    type: tx.type,
                    description: tx.description,
                    amount: parseWholeMoneyLike(tx.amount),
                    balanceAfter: parseWholeMoneyLike(tx.balanceAfter),
                })),
                [
                    { header: 'Tanggal', key: 'date', width: 15 },
                    { header: 'Tipe', key: 'type', width: 15 },
                    { header: 'Deskripsi', key: 'description', width: 35 },
                    { header: 'Jumlah', key: 'amount', width: 18 },
                    { header: 'Saldo Setelah', key: 'balanceAfter', width: 18 },
                ],
                `mutasi-${account?.bankName || 'akun'}-${getBusinessDateValue()}`,
                'Transaksi'
            );
            addToast('success', 'Excel mutasi rekening berhasil di-download');
        } catch (error) {
            addToast('error', error instanceof Error ? error.message : 'Gagal menyiapkan Excel mutasi rekening');
        }
    };

    if (loading) {
        return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 120 }} /><div className="skeleton skeleton-card" style={{ height: 300 }} /></div>;
    }

    if (!account) {
        return <div className="card"><div className="card-body">Rekening tidak ditemukan</div></div>;
    }

    const cashAccount = isCashAccount(account);
    const bankInfo = cashAccount ? BANK_LOGOS.CASH : getBankInfo(account.bankName);
    const invoiceBankAccountRefs = Array.isArray(company?.invoiceSettings?.invoiceBankAccountRefs)
        ? company.invoiceSettings.invoiceBankAccountRefs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
    const isInvoiceAccount = invoiceBankAccountRefs.includes(account._id);
    const isDefaultInvoiceAccount = company?.invoiceSettings?.defaultInvoiceBankAccountRef === account._id;
    const currentBalance = parseWholeMoneyLike(account.currentBalance);
    const totalIn = transactions
        .filter(tx => tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN')
        .reduce((sum, tx) => sum + parseWholeMoneyLike(tx.amount), 0);
    const totalOut = transactions
        .filter(tx => tx.type === 'DEBIT' || tx.type === 'TRANSFER_OUT')
        .reduce((sum, tx) => sum + parseWholeMoneyLike(tx.amount), 0);

    const handlePrint = async () => {
        const printWindow = openPrintWindow('Menyiapkan print rekening...');
        if (!printWindow) {
            addToast('error', 'Popup browser diblok. Izinkan pop-up lalu coba print lagi.');
            return;
        }
        try {
            const resolvedCompany = company ?? await fetchCompanyProfile().catch(() => null);
            const rows = transactions.length === 0
                ? '<tr><td colspan="5" class="c">Belum ada transaksi</td></tr>'
                : transactions.map(tx => {
                    const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                    const amount = parseWholeMoneyLike(tx.amount);
                    const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                    return `<tr><td>${fmtDate(tx.date)}</td><td>${cfg.label}</td><td>${tx.description}</td><td class="r ${cfg.sign === '+' ? 's' : 'd'} b">${cfg.sign}${fmtN(amount)}</td><td class="r b">${fmtN(balanceAfter)}</td></tr>`;
                }).join('');

            openBrandedPrint({
                title: cashAccount ? `Mutasi Kas ${account.bankName}` : `Mutasi Rekening ${account.bankName}`,
                subtitle: `${account.accountNumber} - a.n. ${account.accountHolder}`,
                company: resolvedCompany,
                targetWindow: printWindow,
                bodyHtml: `
                    <div class="stats-row">
                        <div class="stat-box"><div class="stat-label">Saldo Saat Ini</div><div class="stat-value">${fmtN(currentBalance)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Masuk</div><div class="stat-value s">${fmtN(totalIn)}</div></div>
                        <div class="stat-box"><div class="stat-label">Total Keluar</div><div class="stat-value d">${fmtN(totalOut)}</div></div>
                    </div>
                    <table>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th class="r">Jumlah</th><th class="r">Saldo</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                `,
            });
        } catch {
            try {
                printWindow.close();
            } catch {}
            addToast('error', 'Gagal menyiapkan dokumen print rekening');
        }
    };

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <PageBackButton href="/bank-accounts" />
                    <BankDetailLogo name={account.bankName} size={44} />
                    <div>
                        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {account.bankName}
                            {cashAccount && <span className="badge badge-success">Kas Tunai</span>}
                            {!cashAccount && isDefaultInvoiceAccount && <span className="badge badge-primary">Default Nota</span>}
                            {!cashAccount && isInvoiceAccount && !isDefaultInvoiceAccount && <span className="badge badge-info">Tampil di Nota</span>}
                        </h1>
                        <p className="page-subtitle" style={{ fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.03em' }}>{account.accountNumber} - a.n. {account.accountHolder}</p>
                    </div>
                </div>
                <div className="page-actions" style={{ flexWrap: 'wrap' }}>
                    {canExportBankAccount && <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}><FileDown size={15} /> Excel</button>}
                    {canPrintBankAccount && <button className="btn btn-secondary btn-sm" onClick={handlePrint}><Printer size={15} /> Print</button>}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ background: bankInfo.gradient, color: '#fff', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', right: -15, top: -15, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
                    <div className="card-body" style={{ padding: '1.1rem', position: 'relative' }}>
                        <div style={{ fontSize: '0.7rem', opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Saldo Saat Ini</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{fmt(currentBalance)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingUp size={14} style={{ color: 'var(--success)' }} /> Total Masuk
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--success)' }}>{fmt(totalIn)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>
                            <TrendingDown size={14} style={{ color: 'var(--danger)' }} /> Total Keluar
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--danger)' }}>{fmt(totalOut)}</div>
                    </div>
                </div>
                <div className="card" style={{ overflow: 'hidden' }}>
                    <div className="card-body" style={{ padding: '1.1rem' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Transaksi</div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{transactions.length}</div>
                    </div>
                </div>
            </div>

            <div className="card">
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-header-title">Riwayat Transaksi</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{transactions.length} transaksi</span>
                </div>
                <div className="table-wrapper table-desktop-only" style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: 600 }}>
                        <thead>
                            <tr><th>Tanggal</th><th>Tipe</th><th>Deskripsi</th><th style={{ textAlign: 'right' }}>Jumlah</th><th style={{ textAlign: 'right' }}>Saldo Setelah</th></tr>
                        </thead>
                        <tbody suppressHydrationWarning>
                            {transactions.length === 0 ? (
                                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.3 }}>-</div>
                                    <div>Belum ada transaksi</div>
                                </td></tr>
                            ) : transactions.map(tx => {
                                const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                                const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                                const amount = parseWholeMoneyLike(tx.amount);
                                const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                                const sourceLink = resolveBankTransactionSourceLink({
                                    transaction: tx,
                                    paymentsById,
                        refundsById,
                        expensesById,
                        purchasesById,
                        invoiceIdsWithPages,
                        permissions: {
                          canOpenInvoices,
                          canOpenDriverVouchers,
                          canOpenDriverBorongans,
                          canOpenVehicles,
                          canOpenIncidents,
                          canOpenPurchases,
                        },
                      });
                                return (
                                    <tr key={tx._id} style={{ transition: 'background 0.1s' }}
                                        onMouseEnter={event => (event.currentTarget.style.background = 'var(--bg-secondary, #f8fafc)')}
                                        onMouseLeave={event => (event.currentTarget.style.background = '')}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(tx.date)}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                <span style={{ color: isPositive ? 'var(--success)' : 'var(--danger)', display: 'flex' }}>{cfg.icon}</span>
                                                <span className={`badge ${cfg.badge}`} style={{ fontSize: '0.68rem' }}>{cfg.label}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div>{tx.description}</div>
                                            {sourceLink && (
                                                <div style={{ marginTop: '0.2rem' }}>
                                                    <Link href={sourceLink.href} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                        {sourceLink.label}
                                                    </Link>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', color: isPositive ? 'var(--success)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                                            {cfg.sign}{fmt(amount)}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', whiteSpace: 'nowrap' }}>{fmt(balanceAfter)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                <div className="mobile-record-list">
                    {transactions.length === 0 ? (
                        <div className="mobile-record-card">
                            <div className="mobile-record-title">Belum ada transaksi</div>
                        </div>
                    ) : transactions.map(tx => {
                        const cfg = typeConfig[tx.type] || typeConfig.CREDIT;
                        const isPositive = tx.type === 'CREDIT' || tx.type === 'TRANSFER_IN';
                        const amount = parseWholeMoneyLike(tx.amount);
                        const balanceAfter = parseWholeMoneyLike(tx.balanceAfter);
                        const sourceLink = resolveBankTransactionSourceLink({
                            transaction: tx,
                            paymentsById,
                      refundsById,
                      expensesById,
                      purchasesById,
                      invoiceIdsWithPages,
                      permissions: {
                        canOpenInvoices,
                        canOpenDriverVouchers,
                        canOpenDriverBorongans,
                        canOpenVehicles,
                        canOpenIncidents,
                        canOpenPurchases,
                      },
                    });
                        return (
                            <div key={tx._id} className="mobile-record-card">
                                <div className="mobile-record-header">
                                    <div>
                                        <div className="mobile-record-title">{cfg.label}</div>
                                        <div className="mobile-record-subtitle">{fmtDate(tx.date)} | {tx.description}</div>
                                        {sourceLink && (
                                            <div style={{ marginTop: '0.2rem' }}>
                                                <Link href={sourceLink.href} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                    {sourceLink.label}
                                                </Link>
                                            </div>
                                        )}
                                    </div>
                                    <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
                                </div>
                                <div className="mobile-record-meta">
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Jumlah</span>
                                        <span className="mobile-record-value" style={{ fontWeight: 700, color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
                                            {cfg.sign}{fmt(amount)}
                                        </span>
                                    </div>
                                    <div className="mobile-record-kv">
                                        <span className="mobile-record-label">Saldo Setelah</span>
                                        <span className="mobile-record-value">{fmt(balanceAfter)}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
