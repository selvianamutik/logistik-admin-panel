/* ============================================================
   LOGISTIK — PDF: Invoice Template
   Pure jsPDF — no autoTable dependency
   ============================================================ */

import jsPDF from 'jspdf';
import type { Invoice, InvoiceItem, CompanyProfile, Payment } from '@/lib/types';
import { formatDate, formatCurrency, terbilang } from '@/lib/utils';

// ── Simple table drawing helper ──
function drawTable(
    doc: jsPDF,
    startY: number,
    headers: string[],
    rows: string[][],
    colWidths: number[],
    margin: number,
    alignRight?: number[] // indices of right-aligned columns
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
        if (alignRight?.includes(i)) {
            doc.text(h, x + colWidths[i] - 2, y + 6, { align: 'right' });
        } else {
            doc.text(h, x + 2, y + 6);
        }
        x += colWidths[i];
    });
    y += headerHeight;

    // Data rows
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rows.forEach((row, rIdx) => {
        if (rIdx % 2 === 0) {
            doc.setFillColor(245, 245, 250);
            doc.rect(margin, y, colWidths.reduce((a, b) => a + b, 0), rowHeight, 'F');
        }
        x = margin;
        row.forEach((cell, cIdx) => {
            doc.setDrawColor(200, 200, 210);
            doc.rect(x, y, colWidths[cIdx], rowHeight);
            if (alignRight?.includes(cIdx)) {
                doc.text(cell, x + colWidths[cIdx] - 2, y + 5.5, { align: 'right' });
            } else {
                doc.text(cell, x + 2, y + 5.5, { maxWidth: colWidths[cIdx] - 4 });
            }
            x += colWidths[cIdx];
        });
        y += rowHeight;
    });

    return y;
}

export function generateInvoicePdf(
    invoice: Invoice,
    items: InvoiceItem[],
    payments: Payment[],
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
    if (company.npwp) {
        y += 4;
        doc.text(`NPWP: ${company.npwp}`, margin, y);
    }
    y += 8;

    // ─── Divider ───
    doc.setDrawColor(100, 100, 100);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;

    // ─── Title ───
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`No: ${invoice.invoiceNumber}`, pageWidth / 2, y, { align: 'center' });
    y += 10;

    // ─── Billing Info ───
    const col2X = pageWidth / 2 + 10;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Kepada:', margin, y);
    doc.text('Detail:', col2X, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.text(invoice.customerName || '-', margin, y);
    doc.text(`Tanggal: ${formatDate(invoice.issueDate)}`, col2X, y);
    y += 4;
    doc.text(`Jatuh Tempo: ${formatDate(invoice.dueDate)}`, col2X, y);
    y += 4;
    if (invoice.masterResi) {
        doc.text(`Referensi Resi: ${invoice.masterResi}`, col2X, y);
    }
    y += 8;

    // ─── Items Table ───
    const colWidths = [12, contentWidth - 97, 15, 35, 35];
    const tableRows = items.map((item, idx) => [
        `${idx + 1}`,
        item.description,
        `${item.qty || 1}`,
        formatCurrency(item.price),
        formatCurrency(item.subtotal),
    ]);

    y = drawTable(
        doc, y,
        ['No', 'Deskripsi', 'Qty', 'Harga', 'Subtotal'],
        tableRows, colWidths, margin,
        [3, 4] // right-align price and subtotal
    );
    y += 5;

    // ─── Totals ───
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = invoice.totalAmount - totalPaid;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Total:', pageWidth - margin - 60, y);
    doc.text(formatCurrency(invoice.totalAmount), pageWidth - margin, y, { align: 'right' });
    y += 5;

    if (totalPaid > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Sudah Dibayar:', pageWidth - margin - 60, y);
        doc.text(formatCurrency(totalPaid), pageWidth - margin, y, { align: 'right' });
        y += 5;
        doc.setFont('helvetica', 'bold');
        doc.text('Sisa:', pageWidth - margin - 60, y);
        doc.text(formatCurrency(remaining), pageWidth - margin, y, { align: 'right' });
        y += 5;
    }

    // ─── Terbilang ───
    y += 3;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    const amt = remaining > 0 ? remaining : invoice.totalAmount;
    doc.text(`Terbilang: ${terbilang(amt)} rupiah`, margin, y, { maxWidth: contentWidth });
    y += 10;

    // ─── Bank Info ───
    if (company.bankName) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('Pembayaran ditransfer ke:', margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.text(`Bank: ${company.bankName}`, margin, y);
        y += 4;
        doc.text(`No. Rekening: ${company.bankAccount || '-'}`, margin, y);
        y += 4;
        doc.text(`Atas Nama: ${company.bankHolder || '-'}`, margin, y);
        y += 8;
    }

    // ─── Footer Note ───
    if (company.invoiceSettings?.footerNote) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(company.invoiceSettings.footerNote, margin, y, { maxWidth: contentWidth });
        y += 10;
    }

    // ─── Signature ───
    const sigY = y + 5;
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Hormat Kami,', pageWidth - margin - 50, sigY);
    doc.setFont('helvetica', 'normal');
    doc.rect(pageWidth - margin - 55, sigY + 3, 50, 25);
    doc.text(`(${company.name})`, pageWidth - margin - 30, sigY + 33, { align: 'center' });

    // ─── Page Footer ───
    const footerY = doc.internal.pageSize.getHeight() - 10;
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, margin, footerY);
    doc.text(`${company.name} — ${invoice.invoiceNumber}`, pageWidth - margin, footerY, { align: 'right' });

    doc.save(`Invoice-${invoice.invoiceNumber}.pdf`);
}
