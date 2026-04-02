/* ============================================================
   LOGISTIK - Excel Export Utility
   Uses ExcelJS for spreadsheet generation
   ============================================================ */

import ExcelJS from 'exceljs';
import { resolveCompanyLogoUrl } from './branding';
import { formatBusinessDateTime, getBusinessDateValue } from './business-date';
import {
    formatFreightNotaDisplayWeight,
    getFreightNotaRateColumnLabel,
    getFreightNotaWeightColumnLabel,
    normalizeFreightNotaBillingMode,
} from './freight-nota-billing';
import {
    buildInvoiceInstructionAccountText,
    fetchCompanyProfile,
    fmtDate,
    fmtNumber,
    formatFreightNotaDisplayNumber,
    resolveDocumentIssuerProfile,
    resolveFreightNotaIssuerProfile,
    resolveInvoiceInstructionAccounts,
    type InvoiceInstructionAccount,
} from './print';
import type { CompanyProfile, FreightNota, FreightNotaItem } from './types';
import { parseFormattedNumberish } from './formatted-number';
import { getReceivableNetAmount } from './utils';

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

type ExcelImageExtension = 'png' | 'jpeg' | 'gif';

function numericish(value: unknown): string | number | undefined {
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function sanitizeSheetName(name: string) {
    const normalized = name.replace(/[\\/?*[\]:]/g, ' ').trim();
    return normalized.slice(0, 31) || 'Data';
}

function timestampLabel() {
    return formatBusinessDateTime(new Date(), 'id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: undefined,
    }).replace(/\./g, ':');
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

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
                resolve(result);
                return;
            }
            reject(new Error('Gagal membaca logo perusahaan'));
        };
        reader.onerror = () => reject(reader.error ?? new Error('Gagal membaca logo perusahaan'));
        reader.readAsDataURL(blob);
    });
}

function getExcelImageExtension(base64: string): ExcelImageExtension | null {
    const match = base64.match(/^data:image\/(png|jpeg|jpg|gif);base64,/i);
    if (!match) return null;
    const extension = match[1].toLowerCase();
    if (extension === 'jpg') return 'jpeg';
    if (extension === 'png' || extension === 'jpeg' || extension === 'gif') return extension;
    return null;
}

async function resolveCompanyLogoBase64(company?: Pick<CompanyProfile, 'logoUrl'> | null) {
    const logoUrl = resolveCompanyLogoUrl(company);
    if (!logoUrl) return null;
    if (logoUrl.startsWith('data:image/')) return logoUrl;

    try {
        const response = await fetch(logoUrl, { cache: 'no-store' });
        if (!response.ok) return null;
        const blob = await response.blob();
        return await blobToDataUrl(blob);
    } catch {
        return null;
    }
}

async function addCompanyLogoToWorksheet(
    workbook: ExcelJS.Workbook,
    worksheet: ExcelJS.Worksheet,
    company?: Pick<CompanyProfile, 'logoUrl'> | null,
    placement: {
        col: number;
        row: number;
        width: number;
        height: number;
    } = {
        col: 0.15,
        row: 0.15,
        width: 128,
        height: 56,
    },
) {
    const base64 = await resolveCompanyLogoBase64(company);
    const extension = base64 ? getExcelImageExtension(base64) : null;
    if (!base64 || !extension) return false;

    const imageId = workbook.addImage({ base64, extension });
    worksheet.addImage(imageId, {
        tl: { col: placement.col, row: placement.row },
        ext: { width: placement.width, height: placement.height },
    });
    return true;
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
        addMergedRow(company?.name || 'PT Gading Mas Surya');
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
    workbook.creator = company?.name || 'PT Gading Mas Surya';
    workbook.company = company?.name || 'PT Gading Mas Surya';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = options.subtitle || sheetName;
    workbook.title = title;

    const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName));
    addRows(worksheet, rows);
    setColumnWidths(worksheet, columns);
    applyMerges(worksheet, merges);
    const logoPlaced = await addCompanyLogoToWorksheet(workbook, worksheet, company, {
        col: Math.max(totalColumns - 2.2, 0.15),
        row: 0.15,
        width: 124,
        height: 54,
    });
    if (logoPlaced) {
        worksheet.getRow(1).height = Math.max(worksheet.getRow(1).height || 0, 26);
        worksheet.getRow(2).height = Math.max(worksheet.getRow(2).height || 0, 24);
        worksheet.getRow(3).height = Math.max(worksheet.getRow(3).height || 0, 22);
        worksheet.getRow(4).height = Math.max(worksheet.getRow(4).height || 0, 20);
    }

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
            { header: 'Kategori Truk', key: 'serviceName', width: 18 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Tanggal', key: 'createdAt', width: 18, formatter: (value) => fmtDate(String(value || '')) },
        ],
        `orders-${getBusinessDateValue()}`,
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
                    notaDisplayNumber: typeof invoice.notaDisplayNumber === 'string' ? invoice.notaDisplayNumber : undefined,
                },
                company,
            ),
            netAmount: getReceivableNetAmount({
                totalAmount: numericish(invoice.totalAmount),
                totalAdjustmentAmount: numericish(invoice.totalAdjustmentAmount),
                netAmount: numericish(invoice.netAmount),
            }),
        })),
        [
            { header: 'No. Cetak Nota', key: 'notaDisplayNumber', width: 22 },
            { header: 'No. Nota Internal', key: 'notaNumber', width: 22 },
            { header: 'Customer', key: 'customerName', width: 28 },
            { header: 'Tanggal', key: 'issueDate', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Jatuh Tempo', key: 'dueDate', width: 18, formatter: (value) => value ? fmtDate(String(value)) : '-' },
            { header: 'Total Collie', key: 'totalCollie', width: 14 },
            {
                header: 'Total Berat Tagih',
                key: 'totalWeightKg',
                width: 18,
                formatter: (value, row) => formatFreightNotaDisplayWeight({
                    beratKg: value,
                    billingMode: normalizeFreightNotaBillingMode(row.billingMode),
                    includeCanonical: false,
                }),
            },
            { header: 'Total Berat (Kg)', key: 'totalWeightKg', width: 16 },
            { header: 'Tagihan Final', key: 'netAmount', width: 18 },
            { header: 'Status', key: 'status', width: 14 },
        ],
        `nota-ongkos-${getBusinessDateValue()}`,
        'Nota Ongkos',
        {
            title: 'Daftar Nota Ongkos Angkut',
            company,
            totalRow: {
                label: 'TOTAL',
                values: {
                    totalCollie: invoices.reduce((sum, item) => sum + parseFormattedNumberish(item.totalCollie || 0), 0),
                    totalWeightKg: invoices.reduce((sum, item) => sum + parseFormattedNumberish(item.totalWeightKg || 0), 0),
                    netAmount: invoices.reduce((sum, item) => sum + getReceivableNetAmount({
                        totalAmount: numericish(item.totalAmount),
                        totalAdjustmentAmount: numericish(item.totalAdjustmentAmount),
                        netAmount: numericish(item.netAmount),
                    }), 0),
                },
            },
        },
    );
}

export async function exportExpenses(expenses: Record<string, unknown>[]) {
    await exportToExcel(
        expenses.map((expense) => {
            const accountLabel = expense.bankAccountName
                ? `${String(expense.bankAccountName)}${expense.bankAccountNumber ? ` - ${String(expense.bankAccountNumber)}` : ''}`
                : '';
            const vehicleLabel = expense.relatedVehiclePlate ? String(expense.relatedVehiclePlate) : '';

            return {
                ...expense,
                descriptionLabel: expense.note || expense.description || '',
                accountLabel,
                vehicleLabel,
            };
        }),
        [
            { header: 'Tanggal', key: 'date', width: 18, formatter: (value) => fmtDate(String(value || '')) },
            { header: 'Kategori', key: 'categoryName', width: 22 },
            { header: 'Deskripsi', key: 'descriptionLabel', width: 35 },
            { header: 'Kendaraan', key: 'vehicleLabel', width: 18 },
            { header: 'Rekening / Kas', key: 'accountLabel', width: 28 },
            { header: 'Jumlah', key: 'amount', width: 18 },
            { header: 'Privasi', key: 'privacyLevel', width: 14 },
        ],
        `expenses-${getBusinessDateValue()}`,
        'Expenses',
        {
            title: 'Daftar Pengeluaran',
            totalRow: {
                label: 'TOTAL',
                values: {
                    amount: expenses.reduce((sum, item) => sum + parseFormattedNumberish(item.amount || 0), 0),
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
            { header: 'Kategori Armada', key: 'serviceName', width: 20 },
            { header: 'Tipe', key: 'vehicleType', width: 12 },
            { header: 'Tahun', key: 'year', width: 8 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Odometer', key: 'lastOdometer', width: 14 },
        ],
        `vehicles-${getBusinessDateValue()}`,
        'Vehicles',
        { title: 'Daftar Kendaraan' },
    );
}

export async function exportFreightNotaDetail(
    nota: FreightNota,
    items: FreightNotaItem[],
    company?: CompanyProfile | null,
    invoiceBankAccounts: InvoiceInstructionAccount[] = [],
) {
    const resolvedCompany = company ?? await fetchCompanyProfile();
    const issuerProfile = resolveFreightNotaIssuerProfile(nota, resolvedCompany);
    const issuerBranding = resolveDocumentIssuerProfile(nota, resolvedCompany);
    const displayNumber = formatFreightNotaDisplayNumber(nota, resolvedCompany);
    const billingMode = normalizeFreightNotaBillingMode(nota.billingMode);
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
            billedWeight: string;
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
            noSJ: item.noSJ || '',
            dari: item.dari || '',
            tujuan: item.tujuan || '',
            barang: item.barang || '',
            collie: parseFormattedNumberish(item.collie || 0) || '',
            billedWeight: formatFreightNotaDisplayWeight({
                beratKg: item.beratKg || 0,
                billingMode,
                includeCanonical: false,
            }),
            tarip: item.tarip ? fmtNumber(parseFormattedNumberish(item.tarip)) : '',
            uangRp: item.uangRp ? fmtNumber(parseFormattedNumberish(item.uangRp)) : '',
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
    const companyLine = [issuerProfile.phone ? `TELP. ${issuerProfile.phone}` : '', issuerProfile.email ? `EMAIL : ${issuerProfile.email}` : '']
        .filter(Boolean)
        .join('  ');
    const invoiceInstructionLines = resolveInvoiceInstructionAccounts(resolvedCompany, invoiceBankAccounts, nota.instructionAccounts || [])
        .map(buildInvoiceInstructionAccountText);
    const extraNote = [nota.footerNote || resolvedCompany?.invoiceSettings?.footerNote, nota.notes].filter(Boolean).join(' ');

    rows.push(['', '', issuerProfile.name, '', '', `PERINCIAN ONGKOS ANGKUT NO.${displayNumber}`, '', '', '', '', 'TGL CETAK', timestampLabel()]);
    merges.push({ startRow: 1, startCol: 3, endRow: 1, endCol: 5 });
    merges.push({ startRow: 1, startCol: 6, endRow: 1, endCol: 10 });

    rows.push(['', '', issuerProfile.address || '', '', '', 'KEPADA YANG TERHORMAT :']);
    merges.push({ startRow: 2, startCol: 3, endRow: 2, endCol: 5 });
    merges.push({ startRow: 2, startCol: 6, endRow: 2, endCol: 12 });

    rows.push(['', '', companyLine, '', '', nota.customerName]);
    merges.push({ startRow: 3, startCol: 3, endRow: 3, endCol: 5 });
    merges.push({ startRow: 3, startCol: 6, endRow: 3, endCol: 12 });

    rows.push([]);

    const headerRowIndex = rows.length + 1;
    rows.push(['NO', 'NO.TRUCK', 'TANGGAL', 'NO. SJ', 'DARI', 'TUJUAN', 'BARANG', 'COLLIE', getFreightNotaWeightColumnLabel(billingMode), getFreightNotaRateColumnLabel(billingMode), 'UANG RP.', 'KET']);

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
                entry.billedWeight,
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
    rows.push([
        'Jumlah',
        '',
        '',
        '',
        '',
        '',
        '',
        parseFormattedNumberish(nota.totalCollie || 0) || 0,
        formatFreightNotaDisplayWeight({
            beratKg: nota.totalWeightKg || 0,
            billingMode,
            includeCanonical: false,
        }),
        '',
        nota.totalAmount ? fmtNumber(parseFormattedNumberish(nota.totalAmount)) : 0,
        '',
    ]);
    merges.push({ startRow: totalRowIndex, startCol: 1, endRow: totalRowIndex, endCol: 7 });

    rows.push([]);
    rows.push(['NOTE : ONGKOS ANGKUTAN HARAP DITRANSFER KE :']);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    invoiceInstructionLines.forEach(line => {
        rows.push([line]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    });

    if (extraNote) {
        rows.push([extraNote]);
        merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });
    }

    rows.push([`NO. SISTEM : ${nota.notaNumber}`]);
    merges.push({ startRow: rows.length, startCol: 1, endRow: rows.length, endCol: totalColumns });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = issuerProfile.name;
    workbook.company = issuerProfile.name;
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.subject = `Nota ${displayNumber}`;
    workbook.title = `Perincian Ongkos Angkut ${displayNumber}`;

    const worksheet = workbook.addWorksheet(sanitizeSheetName('Nota Detail'));
    addRows(worksheet, rows);
    applyMerges(worksheet, merges);
    const logoPlaced = await addCompanyLogoToWorksheet(workbook, worksheet, issuerBranding, {
        col: 0.1,
        row: 0.1,
        width: 88,
        height: 44,
    });
    if (logoPlaced) {
        worksheet.getRow(1).height = Math.max(worksheet.getRow(1).height || 0, 28);
        worksheet.getRow(2).height = Math.max(worksheet.getRow(2).height || 0, 22);
        worksheet.getRow(3).height = Math.max(worksheet.getRow(3).height || 0, 20);
    }

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
