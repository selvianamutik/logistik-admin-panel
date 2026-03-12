/* ============================================================
   LOGISTIK - Print Utility
   ============================================================ */

import type { CompanyProfile, FreightNota, FreightNotaItem } from './types';

export async function fetchCompanyProfile(): Promise<CompanyProfile | null> {
    try {
        const res = await fetch('/api/data?entity=company');
        const data = await res.json();
        return data.data || null;
    } catch {
        return null;
    }
}

export function openBrandedPrint(opts: {
    title: string;
    subtitle?: string;
    company: CompanyProfile | null;
    bodyHtml: string;
    extraStyles?: string;
    showCompanyHeader?: boolean;
    showFooter?: boolean;
}) {
    const w = window.open('', '_blank');
    if (!w) return;

    const {
        title,
        subtitle,
        company,
        bodyHtml,
        extraStyles,
        showCompanyHeader = true,
        showFooter = true,
    } = opts;

    const companyName = company?.name || 'LOGISTIK';
    const companyLogo = company?.logoUrl || '';
    const printDate = new Date().toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });

    const browserTitle = `${title}${subtitle ? ` - ${subtitle}` : ''} - ${companyName}`;

    w.document.write(`<!DOCTYPE html><html><head><title>${browserTitle}</title><style>
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
        .r { text-align: right; }
        .c { text-align: center; }
        .b { font-weight: 700; }
        .s { color: #16a34a; }
        .d { color: #dc2626; }
        .w { color: #d97706; }
        .p { color: #7c3aed; }
        .stats-row { display: flex; gap: 1rem; margin-bottom: 1rem; }
        .stat-box { flex: 1; text-align: center; padding: 0.6rem; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .stat-label { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
        .stat-value { font-size: 1rem; font-weight: 700; margin-top: 0.15rem; }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #1e293b; margin: 1rem 0 0.5rem; padding-bottom: 0.25rem; border-bottom: 1px solid #e2e8f0; }
        @media print { body { padding: 0.5rem; } .no-print { display: none; } }
        ${extraStyles || ''}
    </style></head><body>
        ${showCompanyHeader ? `
            <div class="print-header">
                ${companyLogo ? `<img src="${companyLogo}" />` : ''}
                <div>
                    <div class="co-name">${companyName}</div>
                    <div class="co-sub">${title}${subtitle ? ` - ${subtitle}` : ''}</div>
                </div>
                <div class="print-date">Dicetak:<br/>${printDate}</div>
            </div>
        ` : ''}
        ${bodyHtml}
        ${showFooter ? `
            <div class="print-footer">
                <span>${companyName}</span>
                <span>Dicetak: ${printDate}</span>
            </div>
        ` : ''}
    </body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
}

function escapeHtml(value: unknown) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtPrintDate(value?: string) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}-${month}-${year}`;
}

function fmtLongPrintDate(value?: string) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

const ROMAN_MONTHS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function formatFreightNotaDisplayNumber(
    nota: Pick<FreightNota, 'notaNumber' | 'issueDate'>,
    company?: CompanyProfile | null,
) {
    const date = new Date(nota.issueDate);
    if (Number.isNaN(date.getTime())) {
        return nota.notaNumber;
    }

    const year = String(date.getFullYear()).slice(-2);
    const romanMonth = ROMAN_MONTHS[date.getMonth()] || String(date.getMonth() + 1);
    const sequenceMatch = nota.notaNumber.match(/(\d+)(?!.*\d)/);
    const sequence = sequenceMatch ? String(Number(sequenceMatch[1])).padStart(3, '0') : nota.notaNumber;
    const seriesCode = company?.numberingSettings?.notaSeriesCode?.trim() || '3';

    return `${year}/${romanMonth}/${seriesCode}/${sequence}`;
}

export function buildFreightNotaPrintDocument(opts: {
    nota: FreightNota;
    items: FreightNotaItem[];
    company: CompanyProfile | null;
}) {
    const { nota, items, company } = opts;
    const displayNumber = formatFreightNotaDisplayNumber(nota, company);
    const groupedRows = items.reduce<Array<{
        no: number;
        vehiclePlate: string;
        date: string;
        entries: Array<{
            noSJ: string;
            dari: string;
            tujuan: string;
            barang: string;
            collie: string | number;
            beratKg: string;
            tarip: string;
            uangRp: string;
            ket: string;
        }>;
    }>>((groups, item) => {
        const vehiclePlate = item.vehiclePlate || '';
        const date = fmtPrintDate(item.date);
        const key = `${vehiclePlate}__${date}`;
        const current = groups.find(group => `${group.vehiclePlate}__${group.date}` === key);
        const entry = {
            noSJ: item.noSJ || item.doNumber || '',
            dari: item.dari || '',
            tujuan: item.tujuan || '',
            barang: item.barang || '',
            collie: item.collie || '',
            beratKg: item.beratKg ? fmtNumber(item.beratKg) : '',
            tarip: item.tarip ? fmtNumber(item.tarip) : '',
            uangRp: item.uangRp ? fmtNumber(item.uangRp) : '',
            ket: item.ket || '',
        };

        if (current) {
            current.entries.push(entry);
            return groups;
        }

        groups.push({
            no: groups.length + 1,
            vehiclePlate,
            date,
            entries: [entry],
        });
        return groups;
    }, []);
    const minPrintableRows = Math.max(items.length, 13);
    const fillerCount = Math.max(minPrintableRows - items.length, 0);
    const groupedRowsHtml = groupedRows.map(group => {
        const span = Math.max(group.entries.length, 1);
        return group.entries.map((entry, entryIndex) => `
            <tr>
                ${entryIndex === 0 ? `
                    <td class="c group-cell" rowspan="${span}">${group.no}</td>
                    <td class="group-cell" rowspan="${span}">${escapeHtml(group.vehiclePlate)}</td>
                    <td class="c group-cell" rowspan="${span}">${escapeHtml(group.date)}</td>
                ` : ''}
                <td>${escapeHtml(entry.noSJ)}</td>
                <td>${escapeHtml(entry.dari)}</td>
                <td>${escapeHtml(entry.tujuan)}</td>
                <td>${escapeHtml(entry.barang)}</td>
                <td class="r">${escapeHtml(entry.collie)}</td>
                <td class="r">${escapeHtml(entry.beratKg)}</td>
                <td class="r">${escapeHtml(entry.tarip)}</td>
                <td class="r">${escapeHtml(entry.uangRp)}</td>
                <td>${escapeHtml(entry.ket)}</td>
            </tr>
        `).join('');
    }).join('');
    const fillerRowsHtml = Array.from({ length: fillerCount }, () => `
        <tr class="nota-filler-row">
            <td class="c">&nbsp;</td>
            <td>&nbsp;</td>
            <td class="c">&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td>&nbsp;</td>
            <td class="r">&nbsp;</td>
            <td class="r">&nbsp;</td>
            <td class="r">&nbsp;</td>
            <td class="r">&nbsp;</td>
            <td>&nbsp;</td>
        </tr>
    `).join('');

    const bankTransferLine = company?.bankName && company?.bankAccount
        ? `${company.bankName} A/C ${company.bankAccount}${company.bankHolder ? ` A/N ${company.bankHolder}` : ''}`
        : '';
    const extraNote = [company?.invoiceSettings?.footerNote, nota.notes].filter(Boolean).join(' ');
    const companyLines = [
        company?.name,
        company?.address,
        [company?.phone ? `TELP. ${company.phone}` : '', company?.email ? `EMAIL : ${company.email}` : '']
            .filter(Boolean)
            .join('  '),
    ].filter(Boolean);

    const bodyHtml = `
        <div class="nota-sheet">
            <div class="nota-header">
                <div class="nota-company">
                    ${companyLines.map((line, index) => `<div class="${index === 0 ? 'nota-company-name' : 'nota-company-line'}">${escapeHtml(line)}</div>`).join('')}
                </div>
                <div class="nota-heading">
                    <div class="nota-heading-top">
                        <div class="nota-title">PERINCIAN ONGKOS ANGKUT NO.${escapeHtml(displayNumber)}</div>
                        <div class="nota-issued"><span class="b">TGL. :</span> ${escapeHtml(fmtLongPrintDate(nota.issueDate))}</div>
                    </div>
                    <div class="nota-recipient-label">KEPADA YANG TERHORMAT :</div>
                    <div class="nota-recipient-value">${escapeHtml(nota.customerName)}</div>
                </div>
            </div>

            <table class="nota-table">
                <colgroup>
                    <col style="width: 4.5%" />
                    <col style="width: 11%" />
                    <col style="width: 11%" />
                    <col style="width: 16%" />
                    <col style="width: 12%" />
                    <col style="width: 12%" />
                    <col style="width: 11%" />
                    <col style="width: 5.5%" />
                    <col style="width: 7.5%" />
                    <col style="width: 6.5%" />
                    <col style="width: 12%" />
                    <col style="width: 8%" />
                </colgroup>
                <thead>
                    <tr>
                        <th class="c">NO</th>
                        <th>NO.TRUCK</th>
                        <th>TANGGAL</th>
                        <th>NO. SJ</th>
                        <th>DARI</th>
                        <th>TUJUAN</th>
                        <th>BARANG</th>
                        <th class="r">COLLIE</th>
                        <th class="r">BERAT KG</th>
                        <th class="r">TARIP</th>
                        <th class="r">UANG RP.</th>
                        <th>KET</th>
                    </tr>
                </thead>
                <tbody>
                    ${groupedRowsHtml}
                    ${fillerRowsHtml}
                    <tr class="nota-total-row">
                        <td colspan="7" class="r b">Jumlah</td>
                        <td class="r b">${escapeHtml(nota.totalCollie || 0)}</td>
                        <td class="r b">${escapeHtml(fmtNumber(nota.totalWeightKg || 0))}</td>
                        <td></td>
                        <td class="r b">${escapeHtml(fmtNumber(nota.totalAmount || 0))}</td>
                        <td></td>
                    </tr>
                </tbody>
            </table>

            <div class="nota-note-row">
                <div class="nota-note">
                    <div><span class="b">NOTE :</span> ONGKOS ANGKUTAN HARAP DITRANSFER KE :</div>
                    ${bankTransferLine ? `<div class="nota-bank-line">${escapeHtml(bankTransferLine)}</div>` : ''}
                    ${extraNote ? `<div class="nota-extra-note">${escapeHtml(extraNote)}</div>` : ''}
                </div>
            </div>
        </div>
    `;

    const extraStyles = `
        body { font-family: Arial, Helvetica, sans-serif; padding: 0.6rem 0.8rem; color: #111827; max-width: 1120px; }
        .nota-sheet { font-size: 9px; line-height: 1.15; }
        .nota-header { display: grid; grid-template-columns: 36% 64%; gap: 0.6rem; align-items: start; }
        .nota-company-name { font-weight: 700; font-size: 11px; text-transform: uppercase; margin-bottom: 0.1rem; }
        .nota-company-line { font-size: 9px; text-transform: uppercase; margin-bottom: 0.08rem; }
        .nota-heading-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
        .nota-title { font-weight: 700; font-size: 11px; text-transform: uppercase; }
        .nota-issued { white-space: nowrap; font-size: 9px; }
        .nota-recipient-label { font-weight: 700; margin-top: 0.25rem; margin-bottom: 0.08rem; }
        .nota-recipient-value { font-weight: 700; text-transform: uppercase; margin-bottom: 0.4rem; }
        .nota-table { margin-top: 0.25rem; table-layout: fixed; }
        .nota-table th, .nota-table td { padding: 0.12rem 0.18rem; border: 1px solid #1f2937; font-size: 8.8px; vertical-align: top; min-height: 18px; }
        .nota-table td { height: 18px; }
        .nota-table th { background: #fff; color: #111827; text-align: center; font-weight: 700; }
        .group-cell { vertical-align: top; font-weight: 700; }
        .nota-filler-row td { color: transparent; }
        .nota-note-row { margin-top: 0.35rem; }
        .nota-note { font-size: 9px; }
        .nota-bank-line { margin-top: 0.12rem; padding-left: 1.6rem; font-weight: 700; }
        .nota-extra-note { margin-top: 0.12rem; }
        .nota-total-row td { font-weight: 700; }
        .c { text-align: center; }
        .r { text-align: right; }
        .b { font-weight: 700; }
        @page { size: A4 portrait; margin: 8mm; }
        @media print { body { padding: 0; } }
    `;

    return {
        title: 'Perincian Ongkos Angkut',
        subtitle: displayNumber,
        bodyHtml,
        extraStyles,
        showCompanyHeader: false,
        showFooter: false,
    };
}

export const fmtCurrency = (n: number) =>
    new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
    }).format(n);

export const fmtNumber = (n: number) => new Intl.NumberFormat('id-ID').format(n);

export const fmtDate = (d: string) => {
    try {
        return new Date(d).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return d;
    }
};
