/* ============================================================
   LOGISTIK — PDF: Surat Jalan (DO) Template
   Pure jsPDF — no autoTable dependency
   ============================================================ */

import jsPDF from 'jspdf';
import type { DeliveryOrder, DeliveryOrderItem, CompanyProfile } from '@/lib/types';
import { DO_ACTUAL_DROP_TYPE_MAP, formatDate, formatDeliveryOrderDisplayNumber } from '@/lib/utils';
import { formatCargoSummary } from '@/lib/measurement';

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
    doc.text(`No: ${formatDeliveryOrderDisplayNumber(doData)}`, pageWidth / 2, y, { align: 'center' });
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
    addRow('No. Internal', doData.doNumber || '-', col2X, y);
    y += 5;
    addRow('Resi', doData.masterResi || '-', margin, y);
    addRow('Customer', doData.customerName || '-', col2X, y);
    y += 5;
    addRow('Penerima', doData.receiverName || '-', margin, y);
    addRow('Kendaraan', doData.vehiclePlate || '-', col2X, y);
    y += 5;
    addRow('Driver', doData.driverName || '-', margin, y);
    addRow('Armada Diminta', doData.serviceName || '-', col2X, y);
    y += 5;
    addRow('Armada Aktual', doData.vehicleServiceName || doData.serviceName || '-', margin, y);
    addRow('Kendaraan', doData.vehiclePlate || '-', col2X, y);
    y += 5;
    if (doData.vehicleCategoryOverrideReason) {
        addRow('Override Armada', doData.vehicleCategoryOverrideReason, margin, y);
        y += 5;
    }
    addRow('Alamat', doData.receiverAddress || '-', margin, y);
    y += 8;

    // ─── Items Table ───
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Route Tagihan', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Asal: ${doData.pickupAddress || '-'}`, margin, y, { maxWidth: contentWidth });
    y += 4.5;
    doc.text(`Tujuan: ${doData.receiverAddress || '-'}`, margin, y, { maxWidth: contentWidth });
    y += 6;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Realisasi Drop', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const actualDropPoints = doData.actualDropPoints || [];
    if (actualDropPoints.length > 0) {
        actualDropPoints
            .slice()
            .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
            .forEach((point) => {
                const line = `${point.sequence}. ${DO_ACTUAL_DROP_TYPE_MAP[point.stopType]?.label || point.stopType} - ${point.locationName || '-'} | ${formatCargoSummary({
                    qtyKoli: point.qtyKoli,
                    weightKg: point.weightKg,
                    weightInputValue: point.weightInputValue,
                    weightInputUnit: point.weightInputUnit,
                    volumeM3: point.volumeM3,
                    volumeInputValue: point.volumeInputValue,
                    volumeInputUnit: point.volumeInputUnit,
                })}${point.note ? ` | ${point.note}` : ''}`;
                doc.text(line, margin, y, { maxWidth: contentWidth });
                y += 4.5;
                if (point.locationAddress) {
                    doc.setTextColor(100, 100, 100);
                    doc.text(point.locationAddress, margin + 4, y, { maxWidth: contentWidth - 4 });
                    doc.setTextColor(0, 0, 0);
                    y += 4.2;
                }
            });
    } else {
        doc.text('Belum ada realisasi drop terpisah. Tagihan mengikuti tujuan utama surat jalan.', margin, y, { maxWidth: contentWidth });
        y += 4.5;
    }
    y += 4;

    const colWidths = [12, contentWidth - 82, 20, 50];
    const tableRows = doItems.map((item, idx) => [
        `${idx + 1}`,
        item.orderItemDescription || '-',
        `${item.actualQtyKoli ?? item.orderItemQtyKoli ?? 1}`,
        formatCargoSummary(
            item.actualQtyKoli !== undefined || item.actualWeightKg !== undefined || item.actualVolumeM3 !== undefined
                ? {
                    qtyKoli: item.actualQtyKoli,
                    weightKg: item.actualWeightKg,
                    weightInputValue: item.actualWeightInputValue,
                    weightInputUnit: item.actualWeightInputUnit,
                    volumeM3: item.actualVolumeM3,
                    volumeInputValue: item.actualVolumeInputValue,
                    volumeInputUnit: item.actualVolumeInputUnit,
                }
                : {
                    qtyKoli: item.orderItemQtyKoli,
                    weightKg: item.orderItemWeight,
                    weightInputValue: item.orderItemWeightInputValue,
                    weightInputUnit: item.orderItemWeightInputUnit,
                    volumeM3: item.orderItemVolumeM3,
                    volumeInputValue: item.orderItemVolumeInputValue,
                    volumeInputUnit: item.orderItemVolumeInputUnit,
                }
        ),
    ]);

    y = drawTable(doc, y, ['No', 'Deskripsi Barang', 'Koli', 'Muatan'], tableRows, colWidths, margin);
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
    doc.text(`${company.name} — ${formatDeliveryOrderDisplayNumber(doData)}`, pageWidth - margin, footerY, { align: 'right' });

    doc.save(`Surat-Jalan-${formatDeliveryOrderDisplayNumber(doData)}.pdf`);
}
