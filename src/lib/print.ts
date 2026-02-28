/* ============================================================
   LOGISTIK — Print Utility (Company Branded Print Templates)
   ============================================================ */

import type { CompanyProfile } from './types';

// Fetch company profile
export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
    try {
        const res = await fetch('/api/data?entity=company');
        const data = await res.json();
        return data.data || null;
    } catch { return null; }
}

// Generate branded print HTML and open in new window
export function openBrandedPrint(opts: {
    title: string;
    subtitle?: string;
    company: CompanyProfile | null;
    bodyHtml: string;
    extraStyles?: string;
}) {
    const w = window.open('', '_blank');
    if (!w) return;
    const { title, subtitle, company, bodyHtml, extraStyles } = opts;
    const companyName = company?.name || 'LOGISTIK';
    const companyLogo = company?.logoUrl || '';
    const printDate = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

    w.document.write(`<!DOCTYPE html><html><head><title>${title} — ${companyName}</title><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', -apple-system, sans-serif; padding: 2rem; color: #1e293b; max-width: 900px; margin: 0 auto; font-size: 14px; }
        .print-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid #1e293b; }
        .print-header img { height: 48px; width: auto; object-fit: contain; }
        .print-header .co-name { font-size: 1.3rem; font-weight: 800; color: #1e293b; }
        .print-header .co-sub { color: #64748b; font-size: 0.85rem; }
        .print-header .print-date { margin-left: auto; text-align: right; font-size: 0.72rem; color: #94a3b8; }
        .print-footer { margin-top: 1.5rem; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 0.75rem; display: flex; justify-content: space-between; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 0.5rem 0.65rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.82rem; }
        th { background: #f1f5f9; font-weight: 600; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #475569; }
        .r { text-align: right; } .c { text-align: center; } .b { font-weight: 700; }
        .s { color: #16a34a; } .d { color: #dc2626; } .w { color: #d97706; } .p { color: #7c3aed; }
        .stats-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
        .stat-box { flex: 1; text-align: center; padding: 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .stat-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .stat-value { font-size: 1rem; font-weight: 700; margin-top: 0.15rem; }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #1e293b; margin: 1rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 1px solid #e2e8f0; }
        @media print { body { padding: 0.5rem; } .no-print { display: none; } }
        ${extraStyles || ''}
    </style></head><body>
        <div class="print-header">
            ${companyLogo ? `<img src="${companyLogo}" />` : ''}
            <div>
                <div class="co-name">${companyName}</div>
                <div class="co-sub">${title}${subtitle ? ' — ' + subtitle : ''}</div>
            </div>
            <div class="print-date">Dicetak:<br/>${printDate}</div>
        </div>
        ${bodyHtml}
        <div class="print-footer">
            <span>${companyName}</span>
            <span>Dicetak: ${printDate}</span>
        </div>
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
}

// Format helpers
export const fmtCurrency = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
export const fmtNumber = (n: number) => new Intl.NumberFormat('id-ID').format(n);
export const fmtDate = (d: string) => { try { return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return d; } };
