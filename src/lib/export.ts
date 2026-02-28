/* ============================================================
   LOGISTIK — Excel/CSV Export Utility
   Uses SheetJS (xlsx) for spreadsheet generation
   ============================================================ */

import * as XLSX from 'xlsx';

interface ExportColumn {
    header: string;
    key: string;
    width?: number;
    formatter?: (value: unknown) => string;
}

export function exportToExcel(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string,
    sheetName: string = 'Data'
) {
    const headers = columns.map(c => c.header);
    const rows = data.map(item =>
        columns.map(col => {
            const value = item[col.key];
            if (col.formatter) return col.formatter(value);
            if (value === undefined || value === null) return '';
            return typeof value === 'number' ? value : String(value);
        })
    );

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws['!cols'] = columns.map(col => ({ wch: col.width || 20 }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Generate proper binary .xlsx file
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Robust download with proper filename
    const fullFilename = `${filename}.xlsx`;
    if (typeof window !== 'undefined' && (window.navigator as unknown as Record<string, unknown>).msSaveOrOpenBlob) {
        // IE/Edge legacy
        (window.navigator as unknown as Record<string, (...args: unknown[]) => void>).msSaveOrOpenBlob(blob, fullFilename);
    } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.style.display = 'none';
        link.href = url;
        link.download = fullFilename;
        link.setAttribute('download', fullFilename);
        document.body.appendChild(link);
        // Use setTimeout to ensure the browser processes the download attribute
        setTimeout(() => {
            link.click();
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 200);
        }, 0);
    }
}

export function exportToCSV(
    data: Record<string, unknown>[],
    columns: ExportColumn[],
    filename: string
) {
    const headers = columns.map(c => c.header);
    const rows = data.map(item =>
        columns.map(col => {
            const value = item[col.key];
            if (col.formatter) return col.formatter(value);
            if (value === undefined || value === null) return '';
            const str = String(value);
            // Escape CSV values with commas or quotes
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        })
    );

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Pre-configured exports for common entities ───

export function exportOrders(orders: Record<string, unknown>[]) {
    exportToExcel(orders, [
        { header: 'No. Resi', key: 'masterResi', width: 20 },
        { header: 'Customer', key: 'customerName', width: 25 },
        { header: 'Penerima', key: 'receiverName', width: 20 },
        { header: 'Layanan', key: 'serviceName', width: 15 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Tanggal', key: 'createdAt', width: 15 },
    ], `orders-${new Date().toISOString().split('T')[0]}`, 'Orders');
}

export function exportInvoices(invoices: Record<string, unknown>[]) {
    exportToExcel(invoices, [
        { header: 'No. Invoice', key: 'invoiceNumber', width: 20 },
        { header: 'Customer', key: 'customerName', width: 25 },
        { header: 'Tanggal', key: 'issueDate', width: 15 },
        { header: 'Jatuh Tempo', key: 'dueDate', width: 15 },
        { header: 'Total', key: 'totalAmount', width: 18 },
        { header: 'Status', key: 'status', width: 12 },
    ], `invoices-${new Date().toISOString().split('T')[0]}`, 'Invoices');
}

export function exportExpenses(expenses: Record<string, unknown>[]) {
    exportToExcel(expenses, [
        { header: 'Tanggal', key: 'date', width: 15 },
        { header: 'Kategori', key: 'categoryName', width: 20 },
        { header: 'Deskripsi', key: 'note', width: 35 },
        { header: 'Jumlah', key: 'amount', width: 18 },
        { header: 'Privacy', key: 'privacyLevel', width: 12 },
    ], `expenses-${new Date().toISOString().split('T')[0]}`, 'Expenses');
}

export function exportVehicles(vehicles: Record<string, unknown>[]) {
    exportToExcel(vehicles, [
        { header: 'Kode', key: 'unitCode', width: 12 },
        { header: 'Plat Nomor', key: 'plateNumber', width: 15 },
        { header: 'Merk/Model', key: 'brandModel', width: 25 },
        { header: 'Tipe', key: 'vehicleType', width: 12 },
        { header: 'Tahun', key: 'year', width: 8 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Odometer', key: 'lastOdometer', width: 12 },
    ], `vehicles-${new Date().toISOString().split('T')[0]}`, 'Vehicles');
}
