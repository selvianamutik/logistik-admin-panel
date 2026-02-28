'use client';

import { useState, useEffect } from 'react';
import { BarChart3, FileDown, Printer } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import type { Expense, Income, Invoice, Payment } from '@/lib/types';

export default function ReportsPage() {
    const [incomes, setIncomes] = useState<Income[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState('all');

    useEffect(() => {
        Promise.all([
            fetch('/api/data?entity=incomes').then(r => r.json()),
            fetch('/api/data?entity=expenses').then(r => r.json()),
            fetch('/api/data?entity=invoices').then(r => r.json()),
        ]).then(([i, e, inv]) => {
            setIncomes(i.data || []);
            setExpenses(e.data || []);
            setInvoices(inv.data || []);
            setLoading(false);
        });
    }, []);

    const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
    const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
    const profit = totalIncome - totalExpense;
    const totalInvoiced = invoices.reduce((s, i) => s + i.totalAmount, 0);
    const totalPending = invoices.filter(i => i.status !== 'PAID').reduce((s, i) => s + i.totalAmount, 0);

    // Group expenses by category
    const expByCategory: Record<string, number> = {};
    expenses.forEach(e => {
        const cat = e.categoryName || 'Lainnya';
        expByCategory[cat] = (expByCategory[cat] || 0) + e.amount;
    });

    const handleExportCSV = () => {
        let csv = 'Tipe,Tanggal,Deskripsi,Jumlah\n';
        incomes.forEach(i => { csv += `Pendapatan,${i.date},${i.note || '-'},${i.amount}\n`; });
        expenses.forEach(e => { csv += `Pengeluaran,${e.date},${e.note || e.description || '-'},${e.amount}\n`; });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `laporan-keuangan-${new Date().toISOString().split('T')[0]}.csv`; a.click();
    };

    if (loading) return <div><div className="skeleton skeleton-title" /><div className="skeleton skeleton-card" style={{ height: 200 }} /></div>;

    return (
        <div>
            <div className="page-header">
                <div className="page-header-left"><h1 className="page-title">Laporan Keuangan</h1><p className="page-subtitle">Ringkasan pendapatan, pengeluaran, dan laba rugi</p></div>
                <div className="page-actions">
                    <button className="btn btn-secondary" onClick={handleExportCSV}><FileDown size={16} /> Export CSV</button>
                    <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
                </div>
            </div>

            <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-icon success"><BarChart3 size={24} /></div><div className="kpi-content"><div className="kpi-label">Total Pendapatan</div><div className="kpi-value" style={{ color: 'var(--color-success)' }}>{formatCurrency(totalIncome)}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon danger"><BarChart3 size={24} /></div><div className="kpi-content"><div className="kpi-label">Total Pengeluaran</div><div className="kpi-value" style={{ color: 'var(--color-danger)' }}>{formatCurrency(totalExpense)}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon primary"><BarChart3 size={24} /></div><div className="kpi-content"><div className="kpi-label">Laba / Rugi</div><div className="kpi-value" style={{ color: profit >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatCurrency(profit)}</div></div></div>
                <div className="kpi-card"><div className="kpi-icon warning"><BarChart3 size={24} /></div><div className="kpi-content"><div className="kpi-label">Invoice Outstanding</div><div className="kpi-value">{formatCurrency(totalPending)}</div></div></div>
            </div>

            <div className="chart-grid">
                <div className="card">
                    <div className="card-header"><span className="card-header-title">Pengeluaran per Kategori</span></div>
                    <div className="card-body">
                        {Object.entries(expByCategory).sort(([, a], [, b]) => b - a).map(([cat, amount]) => (
                            <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--color-gray-100)' }}>
                                <span className="font-medium">{cat}</span>
                                <span className="font-semibold">{formatCurrency(amount)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="card">
                    <div className="card-header"><span className="card-header-title">Arus Kas</span></div>
                    <div className="card-body">
                        <div className="form-section-title" style={{ color: 'var(--color-success)' }}>Pemasukan</div>
                        {incomes.map(i => (
                            <div key={i._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 'var(--font-size-sm)' }}>
                                <span>{formatDate(i.date)} - {i.note || 'Pembayaran'}</span>
                                <span className="font-medium" style={{ color: 'var(--color-success)' }}>+{formatCurrency(i.amount)}</span>
                            </div>
                        ))}
                        <div className="form-section-title mt-4" style={{ color: 'var(--color-danger)' }}>Pengeluaran</div>
                        {expenses.slice(0, 10).map(e => (
                            <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 'var(--font-size-sm)' }}>
                                <span>{formatDate(e.date)} - {e.note || e.categoryName}</span>
                                <span className="font-medium" style={{ color: 'var(--color-danger)' }}>-{formatCurrency(e.amount)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
