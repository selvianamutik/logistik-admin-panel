/* ============================================================
   LOGISTIK - Excel Export Utility
   Uses SheetJS (xlsx) for spreadsheet generation
   ============================================================ */

import * as XLSX from 'xlsx';
import { fetchCompanyProfile, fmtDate, fmtNumber, formatFreightNotaDisplayNumber } from './print';
import type { CompanyProfile, FreightNota, FreightNotaItem } from './types';

type ExportValue = string | number | boolean | Date | null | undefined;

interface ExportColumn {
    header: string;
    key: string;
    width?: number;
    formatter?: (value: unknown, row: Record<string, unknown>) => ExportValue;
}

interface ExportMetaItem {
    label: string;
    value: ExportValue;
}

interface ExportTotalRow {
    label: string;
    values?: Record<string, ExportValue>;
}

interface ExportOptions {
    title?: string;
    subtitle?: string;
    company?: CompanyProfile | null;
    metadata?: ExportMetaItem[];
    footnotes?: string[];
    totalRow?: ExportTotalRow;
    emptyMessage?: string;
    showCompanyHeader?: boolean;
    includeRowCount?: boolean;
}

function sanitizeSheetName(name: string) {
    const normalized = name.replace(/[\\/?*[\]:]/g, ' ').trim();
    return normalized.slice(0, 31) || 'Data';
}

function timestampLabel() {
    return new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date());
}

function textValue(value: ExportValue) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return fmtDate(value.toISOString());
    return String(value);
}

function resolveCellValue(column: ExportColumn, row: Record<string, unknown>) {
    const rawValue = row[column.key];
    if (column.formatter) return column.formatter(rawValue, row);
    if (rawValue === undefined || rawValue === null) return '';
    return rawValue as ExportValue;
}

function setCellFormat(
    ws: XLSX.WorkSheet,
    rowIndex: number,
    colIndex: number,
    value: ExportValue,
    column?: ExportColumn,
) {
    const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    const cell = ws[ref];
    if (!cell) return;

    if (value instanceof Date) {
        cell.t = 'd';
        cell.z = 'dd-mmm-yy';
        return;
    }

    if (typeof value === 'number' && !column?.formatter) {
        cell.t = 'n';
        if (/jumlah|saldo|total|uang|ongkos|tarip|biaya|nominal/i.test(column?.header || '')) {
            cell.z = '#,##0';
        }
    }
}

function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob(
        [wbout],
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    );

    const safeFilename = `${filename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim() || 'export'}.xlsx`;
    if (
        typeof window !== 'undefined'
        && (window.navigator as unknown as Record<string, unknown>).msSaveOrOpenBlob
    ) {
        (window.navigator as unknown as Record<string, (...args: unknown[]) => void>)
            .msSaveOrOpenBlob(blob, safeFilename);
        return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = url;
    link.download = safeFilename;
    link.setAttribute('download', safeFilename);
    document.body.appendChild(link);

    setTimeout(() => {
        link.click();
        setTimeout(() => {
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }, 200);
    }, 0);
}

export async function exportToExcel(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string,
    sheetName = 'Data',
    options: ExportOptions = {},
) {
    const company = options.company ?? await fetchCompanyProfile();
    const totalColumns = Math.max(columns.length, 1);
    const rows: ExportValue[][] = [];
    const merges: XLSX.Range[] = [];
    const mergeAcross = totalColumns - 1;

    const addMergedRow = (value: ExportValue) => {
        const rowIndex = rows.length;
        rows.push([value]);
        if (mergeAcross > 0) {
            merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: mergeAcross } });
        }
    };

    const title = options.title || sheetName;
    if (options.showCompanyHeader !== false) {
        addMergedRow(company?.name || 'LOGISTIK');
    }
    addMergedRow(title);
    if (options.subtitle) addMergedRow(options.subtitle);
    addMergedRow(`Diekspor: ${timestampLabel()}`);
    if (options.includeRowCount !== false) {
        addMergedRow(`Jumlah data: ${fmtNumber(data.length)}`);
    }

    if (options.metadata && options.metadata.length > 0) {
        rows.push([]);
        options.metadata.forEach((item) => {
            rows.push([item.label, textValue(item.value)]);
        });
    }

    rows.push([]);
    const headerRowIndex = rows.length;
    rows.push(columns.map((column) => column.header));

    if (data.length === 0) {
        const emptyRowIndex = rows.length;
        rows.push([options.emptyMessage || 'Tidak ada data untuk diekspor']);
        if (mergeAcross > 0) {
            merges.push({ s: { r: emptyRowIndex, c: 0 }, e: { r: emptyRowIndex, c: mergeAcross } });
        }
    } else {
        data.forEach((item) => {
            rows.push(columns.map((column) => resolveCellValue(column, item)));
        });
    }

    if (options.totalRow) {
        rows.push(
            columns.map((column, index) => {
                if (index === 0) return options.totalRow?.label;
                return options.totalRow?.values?.[column.key] ?? '';
            }),
        );
    }

    if (options.footnotes && options.footnotes.length > 0) {
        rows.push([]);
        options.footnotes.forEach((note) => {
            const rowIndex = rows.length;
            rows.push([note]);
            if (mergeAcross > 0) {
                merges.push({ s: { r: rowIndex, c: 0 }, e: { r: rowIndex, c: mergeAcross } });
            }
        });
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    ws['!cols'] = columns.map((column) => ({ wch: column.width || 20 }));
    ws['!merges'] = merges;

    const dataStartRowIndex = headerRowIndex + 1;
    if (columns.length > 0) {
        const filterEndRow = Math.max(dataStartRowIndex, rows.length - 1);
        ws['!autofilter'] = {
            ref: XLSX.utils.encode_range({
                s: { r: headerRowIndex, c: 0 },
                e: { r: filterEndRow, c: columns.length - 1 },
            }),
        };
    }

    data.forEach((item, itemIndex) => {
        columns.forEach((column, colIndex) => {
            const value = resolveCellValue(column, item);
            setCellFormat(ws, dataStartRowIndex + itemIndex, colIndex, value, column);
        });
    });

    if (options.totalRow) {
        const totalRowIndex = dataStartRowIndex + Math.max(data.length, 1);
        columns.forEach((column, colIndex) => {
            const value = colIndex === 0
                ? options.totalRow?.label
                : options.totalRow?.values?.[column.key];
            setCellFormat(ws, totalRowIndex, colIndex, value, column);
        });
    }

    const wb = XLSX.utils.book_new();
    wb.Props = {
        Title: title,
        Subject: options.subtitle || sheetName,
        Author: company?.name || 'LOGISTIK',
        Company: company?.name || 'LOGISTIK',
        CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));

    downloadWorkbook(wb, filename);
}

export async function exportToCSV(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string,
) {
    const headers = columns.map((column) => column.header);
    const rows = data.map((item) =>
        columns.map((column) => {
            const value = resolveCellValue(column, item);
            const output = textValue(value);
            if (output.includes(',') || output.includes('"') || output.includes('\n')) {
                return `"${output.replace(/"/g, '""')}"`;
            }
            return output;
        }),
    );

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export async function exportOrders(orders: Record<string, unknown>[]) {
    await exportToExcel(
        orders,
        [
            { header: 'No. Resi', key: 'masterResi', width: 20 },
            { header: 'Customer', key: 'customerName', width: 25 },
            { header: 'Penerima', key: 'receiverName', width: 20 },
            { header: 'Layanan', key: 'serviceName', width: 15 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Tanggal', key: 'createdAt', width: 18, formatter: (value) => fmtDate(String(value || '')) },
        ],
        `orders-${new Date().toISOString().split('T')[0]}`,
        'Orders',
        { title: 'Daftar Order / Resi' },
    );
}

export async function exportInvoices(invoices: Record<string, unknown>[]) {
    await exportToExcel(
        invoices,
        [
            { header: 'No. Nota', key: 'notaNumber', width: 22 },
            { header: 'Customer', key: 'customerName', width: 28 },
            { header: 'Tanggal', key: 'issueDate', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Jatuh Tempo', key: 'dueDate', width: 18, formatter: (value) => value ? fmtDate(String(value)) : '-' },
            { header: 'Total Collie', key: 'totalCollie', width: 14 },
            { header: 'Total Berat (Kg)', key: 'totalWeightKg', width: 16 },
            { header: 'Total Ongkos', key: 'totalAmount', width: 18 },
            { header: 'Status', key: 'status', width: 14 },
        ],
        `nota-ongkos-${new Date().toISOString().split('T')[0]}`,
        'Nota Ongkos',
        {
            title: 'Daftar Nota Ongkos Angkut',
            totalRow: {
                label: 'TOTAL',
                values: {
                    totalCollie: invoices.reduce((sum, item) => sum + Number(item.totalCollie || 0), 0),
                    totalWeightKg: invoices.reduce((sum, item) => sum + Number(item.totalWeightKg || 0), 0),
                    totalAmount: invoices.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0),
                },
            },
        },
    );
}

export async function exportExpenses(expenses: Record<string, unknown>[]) {
    await exportToExcel(
        expenses,
        [
            { header: 'Tanggal', key: 'date', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Kategori', key: 'categoryName', width: 22 },
            { header: 'Deskripsi', key: 'note', width: 35 },
            { header: 'Jumlah', key: 'amount', width: 18 },
            { header: 'Privasi', key: 'privacyLevel', width: 14 },
        ],
        `expenses-${new Date().toISOString().split('T')[0]}`,
        'Expenses',
        {
            title: 'Daftar Pengeluaran',
            totalRow: {
                label: 'TOTAL',
                values: {
                    amount: expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
                },
            },
        },
    );
}

export async function exportVehicles(vehicles: Record<string, unknown>[]) {
    await exportToExcel(
        vehicles,
        [
            { header: 'Kode', key: 'unitCode', width: 12 },
            { header: 'Plat Nomor', key: 'plateNumber', width: 16 },
            { header: 'Merk/Model', key: 'brandModel', width: 25 },
            { header: 'Tipe', key: 'vehicleType', width: 12 },
            { header: 'Tahun', key: 'year', width: 8 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Odometer', key: 'lastOdometer', width: 14 },
        ],
        `vehicles-${new Date().toISOString().split('T')[0]}`,
        'Vehicles',
        { title: 'Daftar Kendaraan' },
    );
}

export async function exportFreightNotaDetail(
    nota: FreightNota,
    items: FreightNotaItem[],
    company?: CompanyProfile | null,
) {
    const resolvedCompany = company ?? await fetchCompanyProfile();
    const displayNumber = formatFreightNotaDisplayNumber(nota, resolvedCompany);
    const transferLineParts = [
        resolvedCompany?.bankName && resolvedCompany?.bankAccount
            ? `NOTE: ONGKOS ANGKUTAN HARAP DITRANSFER KE: ${resolvedCompany.bankName} A/C ${resolvedCompany.bankAccount}${resolvedCompany.bankHolder ? ` A/N ${resolvedCompany.bankHolder}` : ''}`
            : '',
        resolvedCompany?.invoiceSettings?.footerNote || '',
        nota.notes ? `CATATAN: ${nota.notes}` : '',
    ].filter(Boolean);
    const transferLine = transferLineParts.join(' ');

    const companyLines = [
        resolvedCompany?.name,
        resolvedCompany?.address,
        `TGL: ${fmtDate(nota.issueDate)}`,
        [resolvedCompany?.phone ? `Telp. ${resolvedCompany.phone}` : '', resolvedCompany?.email ? `Email: ${resolvedCompany.email}` : '']
            .filter(Boolean)
            .join(' | '),
    ].filter(Boolean) as string[];

    await exportToExcel(
        items.map((item, index) => ({
            no: index + 1,
            vehiclePlate: item.vehiclePlate || '-',
            date: item.date,
            noSJ: item.noSJ,
            dari: item.dari,
            tujuan: item.tujuan,
            barang: item.barang || '-',
            collie: item.collie || 0,
            beratKg: item.beratKg || 0,
            tarip: item.tarip || 0,
            uangRp: item.uangRp || 0,
            ket: item.ket || '-',
        })),
        [
            { header: 'NO', key: 'no', width: 8 },
            { header: 'NO.TRUCK', key: 'vehiclePlate', width: 14 },
            { header: 'TANGGAL', key: 'date', width: 16, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'NO. SJ', key: 'noSJ', width: 22 },
            { header: 'DARI', key: 'dari', width: 18 },
            { header: 'TUJUAN', key: 'tujuan', width: 18 },
            { header: 'BARANG', key: 'barang', width: 18 },
            { header: 'COLLIE', key: 'collie', width: 10 },
            { header: 'BERAT KG', key: 'beratKg', width: 12 },
            { header: 'TARIP', key: 'tarip', width: 12 },
            { header: 'UANG RP.', key: 'uangRp', width: 16 },
            { header: 'KET', key: 'ket', width: 18 },
        ],
        `nota-${displayNumber}`,
        'Nota Detail',
        {
            title: `PERINCIAN ONGKOS ANGKUT NO. ${displayNumber}`,
            company: resolvedCompany,
            metadata: [
                { label: 'KEPADA YANG TERHORMAT :', value: nota.customerName },
                { label: 'NO. SISTEM :', value: nota.notaNumber },
            ],
            totalRow: {
                label: 'Jumlah',
                values: {
                    collie: nota.totalCollie || 0,
                    beratKg: nota.totalWeightKg || 0,
                    uangRp: nota.totalAmount || 0,
                },
            },
            footnotes: [
                transferLine,
                ...companyLines,
            ].filter(Boolean),
            showCompanyHeader: false,
            includeRowCount: false,
        },
    );
}
