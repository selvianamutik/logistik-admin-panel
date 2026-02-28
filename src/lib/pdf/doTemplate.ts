/* ============================================================
   LOGISTIK — PDF: Surat Jalan (DO) Template
   Pure jsPDF — no autoTable dependency
   ============================================================ */

import jsPDF from 'jspdf';
import type { DeliveryOrder, DeliveryOrderItem, CompanyProfile } from '@/lib/types';
import { formatDate } from '@/lib/utils';

// ── Simple table drawing helper ──
function drawTable(
    doc: jsPDF,
    startY: number,
    headers: string[],
    rows: string[][],
    colWidths: number[],
    margin: number
): number {
    const rowHeight = 8;
    const headerHeight = 9;
    let y = startY;

    // Header row
    doc.setFillColor(80, 80, 140);
    doc.rect(margin, y, colWidths.reduce((a, b) => a + b, 0), headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    let x = margin;
    headers.forEach((h, i) => {
        doc.text(h, x + 2, y + 6);
        x += colWidths[i];
    });
    y += headerHeight;

    // Data rows
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rows.forEach((row, rIdx) => {
        // Alternate row bg
        if (rIdx % 2 === 0) {
            doc.setFillColor(245, 245, 250);
            doc.rect(margin, y, colWidths.reduce((a, b) => a + b, 0), rowHeight, 'F');
        }
        // Cell borders
        x = margin;
        row.forEach((cell, cIdx) => {
            doc.setDrawColor(200, 200, 210);
            doc.rect(x, y, colWidths[cIdx], rowHeight);
            doc.text(cell, x + 2, y + 5.5, { maxWidth: colWidths[cIdx] - 4 });
            x += colWidths[cIdx];
        });
        y += rowHeight;
    });

    return y;
}

export function generateDOPdf(
    doData: DeliveryOrder,
    doItems: DeliveryOrderItem[],
    company: CompanyProfile
) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let y = 15;

    // ─── Header ───
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(company.name, margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(company.address, margin, y);
    y += 4;
    doc.text(`Telp: ${company.phone} | Email: ${company.email}`, margin, y);
    y += 8;

    // ─── Divider ───
    doc.setDrawColor(100, 100, 100);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // ─── Title ───
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('SURAT JALAN', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`No: ${doData.doNumber}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // ─── Info Grid ───
    const col2X = pageWidth / 2 + 10;
    doc.setFontSize(9);

    const addRow = (label: string, value: string, x: number, yPos: number) => {
        doc.setFont('helvetica', 'bold');
        doc.text(label, x, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(`: ${value}`, x + 30, yPos);
    };

    addRow('Tanggal', formatDate(doData.date), margin, y);
    addRow('Resi', doData.masterResi || '-', col2X, y);
    y += 5;
    addRow('Customer', doData.customerName || '-', margin, y);
    addRow('Kendaraan', doData.vehiclePlate || '-', col2X, y);
    y += 5;
    addRow('Penerima', doData.receiverName || '-', margin, y);
    addRow('Driver', doData.driverName || '-', col2X, y);
    y += 5;
    addRow('Alamat', doData.receiverAddress || '-', margin, y);
    y += 8;

    // ─── Items Table ───
    const colWidths = [12, contentWidth - 57, 20, 25];
    const tableRows = doItems.map((item, idx) => [
        `${idx + 1}`,
        item.orderItemDescription || '-',
        `${item.orderItemQtyKoli || 1}`,
        `${item.orderItemWeight || 0} kg`,
    ]);

    y = drawTable(doc, y, ['No', 'Deskripsi Barang', 'Koli', 'Berat'], tableRows, colWidths, margin);
    y += 6;

    // ─── Notes ───
    if (doData.notes) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Catatan:', margin, y);
        doc.setFont('helvetica', 'normal');
        y += 5;
        doc.text(doData.notes, margin, y, { maxWidth: contentWidth });
        y += 10;
    }

    // ─── Signature Fields ───
    y += 5;
    const sigWidth = contentWidth / 3;
    const sigY = y;
    ['Pengirim', 'Driver', 'Penerima'].forEach((label, idx) => {
        const sx = margin + idx * sigWidth;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text(label, sx + sigWidth / 2, sigY, { align: 'center' });
        doc.setDrawColor(180, 180, 180);
        doc.rect(sx + 5, sigY + 3, sigWidth - 10, 25);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('(                            )', sx + sigWidth / 2, sigY + 33, { align: 'center' });
    });

    // ─── Footer ───
    const footerY = doc.internal.pageSize.getHeight() - 10;
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, margin, footerY);
    doc.text(`${company.name} — ${doData.doNumber}`, pageWidth - margin, footerY, { align: 'right' });

    doc.save(`Surat-Jalan-${doData.doNumber}.pdf`);
}
