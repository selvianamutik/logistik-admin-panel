/* ============================================================
   LOGISTIK - Excel Export Utility
   Uses ExcelJS for spreadsheet generation
   ============================================================ */

import ExcelJS from 'exceljs';
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

interface MergeRange {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
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

function assignCellValue(
    worksheet: ExcelJS.Worksheet,
    rowIndex: number,
    colIndex: number,
    value: ExportValue,
    column?: ExportColumn,
) {
    const cell = worksheet.getRow(rowIndex).getCell(colIndex + 1);

    if (value === undefined || value === null || value === '') {
        cell.value = '';
        return;
    }

    if (value instanceof Date) {
        cell.value = value;
        cell.numFmt = 'dd-mmm-yy';
        return;
    }

    cell.value = value as ExcelJS.CellValue;

    if (typeof value === 'number' && !column?.formatter) {
        if (/jumlah|saldo|total|uang|ongkos|tarip|biaya|nominal/i.test(column?.header || '')) {
            cell.numFmt = '#,##0';
        }
    }
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob(
        [buffer],
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

function applyMerges(worksheet: ExcelJS.Worksheet, merges: MergeRange[]) {
    merges.forEach((merge) => {
        if (merge.endCol > merge.startCol || merge.endRow > merge.startRow) {
            worksheet.mergeCells(merge.startRow, merge.startCol, merge.endRow, merge.endCol);
        }
    });
}

function setColumnWidths(worksheet: ExcelJS.Worksheet, columns: ExportColumn[]) {
    columns.forEach((column, index) => {
        worksheet.getColumn(index + 1).width = column.width || 20;
    });
}

function addRows(worksheet: ExcelJS.Worksheet, rows: ExportValue[][]) {
    rows.forEach((row) => {
        worksheet.addRow(row);
    });
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
    const merges: MergeRange[] = [];

    const addMergedRow = (value: ExportValue) => {
        const rowNumber = rows.length + 1;
        rows.push([value]);
        if (totalColumns > 1) {
            merges.push({
                startRow: rowNumber,
                startCol: 1,
                endRow: rowNumber,
                endCol: totalColumns,
            });
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
    const headerRowIndex = rows.length + 1;
    rows.push(columns.map((column) => column.header));

    if (data.length === 0) {
        const rowNumber = rows.length + 1;
        rows.push([options.emptyMessage || 'Tidak ada data untuk diekspor']);
        if (totalColumns > 1) {
            merges.push({
                startRow: rowNumber,
                startCol: 1,
                endRow: rowNumber,
                endCol: totalColumns,
            });
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
            const rowNumber = rows.length + 1;
            rows.push([note]);
            if (totalColumns > 1) {
                merges.push({
                    startRow: rowNumber,
                    startCol: 1,
                    endRow: rowNumber,
                    endCol: totalColumns,
                });
            }
        });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = company?.name || 'LOGISTIK';
    workbook.company = company?.name || 'LOGISTIK';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = options.subtitle || sheetName;
    workbook.title = title;

    const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
    addRows(worksheet, rows);
    setColumnWidths(worksheet, columns);
    applyMerges(worksheet, merges);

    if (columns.length > 0) {
        const dataRowCount = Math.max(data.length, 1);
        worksheet.autoFilter = {
            from: { row: headerRowIndex, column: 1 },
            to: { row: headerRowIndex + dataRowCount - 1, column: columns.length },
        };
    }

    const dataStartRowIndex = headerRowIndex + 1;
    data.forEach((item, itemIndex) => {
        columns.forEach((column, colIndex) => {
            const value = resolveCellValue(column, item);
            assignCellValue(worksheet, dataStartRowIndex + itemIndex, colIndex, value, column);
        });
    });

    if (options.totalRow) {
        const totalRowIndex = dataStartRowIndex + Math.max(data.length, 1);
        columns.forEach((column, colIndex) => {
            const value = colIndex === 0
                ? options.totalRow?.label
                : options.totalRow?.values?.[column.key];
            assignCellValue(worksheet, totalRowIndex, colIndex, value, column);
        });
    }

    await downloadWorkbook(workbook, filename);
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
    const company = await fetchCompanyProfile();
    await exportToExcel(
        invoices.map((invoice) => ({
            ...invoice,
            notaDisplayNumber: formatFreightNotaDisplayNumber(
                {
                    notaNumber: String(invoice.notaNumber || ''),
                    issueDate: String(invoice.issueDate || ''),
                },
                company,
            ),
        })),
        [
            { header: 'No. Cetak Nota', key: 'notaDisplayNumber', width: 22 },
            { header: 'No. Sistem', key: 'notaNumber', width: 22 },
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
            company,
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
            beratKg: string | number;
            tarip: string | number;
            uangRp: string | number;
            ket: string;
        }>;
    }>>((groups, item) => {
        const vehiclePlate = item.vehiclePlate || '';
        const date = fmtDate(item.date || '');
        const key = `${vehiclePlate}__${date}`;
        const existing = groups.find((group) => `${group.vehiclePlate}__${group.date}` === key);
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

        if (existing) {
            existing.entries.push(entry);
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

    const rows: ExportValue[][] = [];
    const merges: MergeRange[] = [];
    const totalColumns = 12;
    const companyLine = [resolvedCompany?.phone ? `TELP. ${resolvedCompany.phone}` : '', resolvedCompany?.email ? `EMAIL : ${resolvedCompany.email}` : '']
        .filter(Boolean)
        .join('  ');
    const noteLine = resolvedCompany?.bankName && resolvedCompany?.bankAccount
        ? `${resolvedCompany.bankName} A/C ${resolvedCompany.bankAccount}${resolvedCompany.bankHolder ? ` A/N ${resolvedCompany.bankHolder}` : ''}`
        : '';
    const extraNote = [resolvedCompany?.invoiceSettings?.footerNote, nota.notes].filter(Boolean).join(' ');

    rows.push([resolvedCompany?.name || 'LOGISTIK', '', '', '', '', `PERINCIAN ONGKOS ANGKUT NO.${displayNumber}`, '', '', '', '', 'TGL.', fmtDate(nota.issueDate)]);
    merges.push({ startRow: 1, startCol: 1, endRow: 1, endCol: 5 });
    merges.push({ startRow: 1, startCol: 6, endRow: 1, endCol: 10 });

    rows.push([resolvedCompany?.address || '', '', '', '', '', 'KEPADA YANG TERHORMAT :']);
    merges.push({ startRow: 2, startCol: 1, endRow: 2, endCol: 5 });
    merges.push({ startRow: 2, startCol: 6, endRow: 2, endCol: 12 });

    rows.push([companyLine, '', '', '', '', nota.customerName]);
    merges.push({ startRow: 3, startCol: 1, endRow: 3, endCol: 5 });
    merges.push({ startRow: 3, startCol: 6, endRow: 3, endCol: 12 });

    rows.push([]);

    const headerRowIndex = rows.length + 1;
    rows.push(['NO', 'NO.TRUCK', 'TANGGAL', 'NO. SJ', 'DARI', 'TUJUAN', 'BARANG', 'COLLIE', 'BERAT KG', 'TARIP', 'UANG RP.', 'KET']);

    groupedRows.forEach((group) => {
        const groupStartRow = rows.length + 1;
        group.entries.forEach((entry, index) => {
            rows.push([
                index === 0 ? group.no : '',
                index === 0 ? group.vehiclePlate : '',
                index === 0 ? group.date : '',
                entry.noSJ,
                entry.dari,
                entry.tujuan,
                entry.barang,
                entry.collie,
                entry.beratKg,
                entry.tarip,
                entry.uangRp,
                entry.ket,
            ]);
        });

        const groupEndRow = rows.length;
        if (groupEndRow > groupStartRow) {
            merges.push({ startRow: groupStartRow, startCol: 1, endRow: groupEndRow, endCol: 1 });
            merges.push({ startRow: groupStartRow, startCol: 2, endRow: groupEndRow, endCol: 2 });
            merges.push({ startRow: groupStartRow, startCol: 3, endRow: groupEndRow, endCol: 3 });
        }
    });

    const fillerCount = Math.max(13 - items.length, 0);
    for (let i = 0; i < fillerCount; i += 1) {
        rows.push(Array.from({ length: totalColumns }, () => ''));
    }

    const totalRowIndex = rows.length + 1;
    rows.push(['Jumlah', '', '', '', '', '', '', nota.totalCollie || 0, nota.totalWeightKg ? fmtNumber(nota.totalWeightKg) : 0, '', nota.totalAmount ? fmtNumber(nota.totalAmount) : 0, '']);
    merges.push({ startRow: totalRowIndex, startCol: 1, endRow: totalRowIndex, endCol: 7 });

    rows.push([]);
    rows.push(['NOTE : ONGKOS ANGKUTAN HARAP DITRANSFER KE :']);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    if (noteLine) {
        rows.push([noteLine]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    }

    if (extraNote) {
        rows.push([extraNote]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    }

    rows.push([`NO. SISTEM : ${nota.notaNumber}`]);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = resolvedCompany?.name || 'LOGISTIK';
    workbook.company = resolvedCompany?.name || 'LOGISTIK';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = `Nota ${displayNumber}`;
    workbook.title = `Perincian Ongkos Angkut ${displayNumber}`;

    const worksheet = workbook.addWorksheet(sanitizeSheetName('Nota Detail'));
    addRows(worksheet, rows);
    applyMerges(worksheet, merges);

    const columnWidths = [6, 14, 12, 20, 16, 16, 14, 8, 10, 10, 14, 12];
    columnWidths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
    });

    worksheet.autoFilter = {
        from: { row: headerRowIndex, column: 1 },
        to: { row: Math.max(headerRowIndex + Math.max(items.length, 1) - 1, headerRowIndex), column: totalColumns },
    };

    const numberColumns = new Set([8, 9, 10, 11]);
    rows.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
            assignCellValue(worksheet, rowIndex + 1, colIndex, value);
            const cell = worksheet.getRow(rowIndex + 1).getCell(colIndex + 1);
            if (numberColumns.has(colIndex + 1) && typeof value === 'number') {
                cell.numFmt = '#,##0';
            }
        });
    });

    await downloadWorkbook(workbook, `nota-${displayNumber}`);
}
