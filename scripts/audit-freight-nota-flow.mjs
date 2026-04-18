import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@sanity/client';

function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;
    const separator = trimmed.indexOf('=');
    if (separator < 0) return null;
    const key = trimmed.slice(0, separator).trim();
    if (!key) return null;
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]+|['"]+$/g, '');
    return { key, value };
}

function loadScriptEnv(baseDir = process.cwd()) {
    for (const file of ['.env.production', '.env.local']) {
        const fullPath = path.join(baseDir, file);
        if (!fs.existsSync(fullPath)) continue;
        const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
        for (const line of lines) {
            const parsed = parseEnvLine(line);
            if (!parsed) continue;
            process.env[parsed.key] = parsed.value;
        }
    }
}

function cleanEnv(value) {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.replace(/^['"]+|['"]+$/g, '');
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function addIssue(issues, scope, message) {
    issues.push({ scope, message });
}

loadScriptEnv();

const client = createClient({
    projectId: cleanEnv(process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) || 'p6do50hl',
    dataset: cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production',
    apiVersion: cleanEnv(process.env.SANITY_API_VERSION) || '2024-01-01',
    token: cleanEnv(process.env.SANITY_API_TOKEN),
    useCdn: false,
});

async function main() {
    const [notas, notaItems, payments, refunds, adjustments, deliveryOrders, deliveryOrderItems] = await Promise.all([
        client.fetch(`*[_type == "freightNota"]{
            _id,
            notaNumber,
            customerRef,
            customerName,
            status,
            totalAmount,
            refundedOverpaymentAmount,
            totalAdjustmentAmount
        }`),
        client.fetch(`*[_type == "freightNotaItem"]{
            _id,
            notaRef,
            doRef,
            noSJ,
            tujuan,
            customerRef,
            customerName,
            deliveryOrderItemRef,
            deliveryOrderItemRefs
        }`),
        client.fetch(`*[_type == "payment"]{
            _id,
            invoiceRef,
            amount
        }`),
        client.fetch(`*[_type == "customerOverpaymentRefund"]{
            _id,
            sourceInvoiceRef,
            amount
        }`),
        client.fetch(`*[_type == "invoiceAdjustment"]{
            _id,
            invoiceRef,
            amount,
            status
        }`),
        client.fetch(`*[_type == "deliveryOrder"]{
            _id,
            doNumber,
            status
        }`),
        client.fetch(`*[_type == "deliveryOrderItem"]{
            _id,
            deliveryOrderRef
        }`),
    ]);

    const issues = [];
    const doMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const doItemMap = new Map(deliveryOrderItems.map(item => [item._id, item]));
    const itemsByNota = new Map();
    const paymentsByNota = new Map();
    const refundsByNota = new Map();
    const adjustmentsByNota = new Map();

    for (const item of notaItems) {
        if (!itemsByNota.has(item.notaRef)) itemsByNota.set(item.notaRef, []);
        itemsByNota.get(item.notaRef).push(item);
    }

    for (const item of payments) {
        if (!item.invoiceRef) continue;
        if (!paymentsByNota.has(item.invoiceRef)) paymentsByNota.set(item.invoiceRef, []);
        paymentsByNota.get(item.invoiceRef).push(item);
    }

    for (const item of refunds) {
        if (!item.sourceInvoiceRef) continue;
        if (!refundsByNota.has(item.sourceInvoiceRef)) refundsByNota.set(item.sourceInvoiceRef, []);
        refundsByNota.get(item.sourceInvoiceRef).push(item);
    }

    for (const item of adjustments) {
        if (!item.invoiceRef || item.status !== 'APPROVED') continue;
        if (!adjustmentsByNota.has(item.invoiceRef)) adjustmentsByNota.set(item.invoiceRef, []);
        adjustmentsByNota.get(item.invoiceRef).push(item);
    }

    for (const nota of notas) {
        const scope = nota.notaNumber || nota._id;
        const relatedItems = itemsByNota.get(nota._id) || [];
        const relatedPayments = paymentsByNota.get(nota._id) || [];
        const relatedRefunds = refundsByNota.get(nota._id) || [];
        const relatedAdjustments = adjustmentsByNota.get(nota._id) || [];

        if (relatedItems.length === 0) {
            addIssue(issues, scope, 'Nota tidak punya freightNotaItem.');
            continue;
        }

        const itemCustomerRefs = [...new Set(relatedItems.map(item => normalizeText(item.customerRef)).filter(Boolean))];
        if (itemCustomerRefs.length > 1) {
            addIssue(issues, scope, `Nota memuat lebih dari satu customer item: ${itemCustomerRefs.join(', ')}.`);
        }
        if (normalizeText(nota.customerRef) && itemCustomerRefs.length === 1 && itemCustomerRefs[0] !== normalizeText(nota.customerRef)) {
            addIssue(issues, scope, `Customer nota (${nota.customerRef}) tidak sama dengan customer item (${itemCustomerRefs[0]}).`);
        }

        const itemCustomerNames = [...new Set(relatedItems.map(item => normalizeText(item.customerName)).filter(Boolean))];
        if (normalizeText(nota.customerName) && itemCustomerNames.length === 1 && itemCustomerNames[0] !== normalizeText(nota.customerName)) {
            addIssue(issues, scope, `Nama customer nota (${nota.customerName}) tidak sama dengan nama customer item (${itemCustomerNames[0]}).`);
        }

        for (const item of relatedItems) {
            const rowScope = `${scope} / ${item.noSJ || '-'}`;
            if (!item.doRef) {
                addIssue(issues, rowScope, 'Item nota tidak punya doRef.');
                continue;
            }

            const deliveryOrder = doMap.get(item.doRef);
            if (!deliveryOrder) {
                addIssue(issues, rowScope, `Item nota mengarah ke DO yang tidak ditemukan: ${item.doRef}.`);
                continue;
            }

            if (deliveryOrder.status !== 'DELIVERED') {
                addIssue(issues, rowScope, `Item nota mengarah ke DO ${deliveryOrder.doNumber || item.doRef} dengan status ${deliveryOrder.status}, bukan DELIVERED.`);
            }

            const itemRefs = [...new Set([normalizeText(item.deliveryOrderItemRef), ...(item.deliveryOrderItemRefs || []).map(normalizeText)].filter(Boolean))];
            for (const itemRef of itemRefs) {
                const doItem = doItemMap.get(itemRef);
                if (!doItem) {
                    addIssue(issues, rowScope, `deliveryOrderItemRef ${itemRef} tidak ditemukan.`);
                    continue;
                }
                if (doItem.deliveryOrderRef !== item.doRef) {
                    addIssue(issues, rowScope, `deliveryOrderItemRef ${itemRef} milik DO lain (${doItem.deliveryOrderRef}).`);
                }
            }

            if (!normalizeText(item.noSJ)) {
                addIssue(issues, rowScope, 'Item nota tidak punya noSJ.');
            }
            if (!normalizeText(item.tujuan)) {
                addIssue(issues, rowScope, 'Item nota tidak punya tujuan.');
            }
        }

        const hasFinancialLock = relatedPayments.length > 0 || relatedRefunds.length > 0 || relatedAdjustments.length > 0;
        const totalPayments = relatedPayments.reduce((sum, item) => sum + parseMoney(item.amount), 0);
        const totalRefunds = relatedRefunds.reduce((sum, item) => sum + parseMoney(item.amount), 0);
        const totalAdjustments = relatedAdjustments.reduce((sum, item) => sum + parseMoney(item.amount), 0);

        if (relatedPayments.length > 0 && totalPayments <= 0) {
            addIssue(issues, scope, 'Nota punya payment tapi total payment tidak positif.');
        }
        if (relatedRefunds.length > 0 && totalRefunds <= 0) {
            addIssue(issues, scope, 'Nota punya refund tapi total refund tidak positif.');
        }
        if (relatedAdjustments.length > 0 && totalAdjustments <= 0) {
            addIssue(issues, scope, 'Nota punya adjustment approved tapi total adjustment tidak positif.');
        }

        if (hasFinancialLock && normalizeText(nota.status).toUpperCase() === 'DRAFT') {
            addIssue(issues, scope, 'Nota masih berstatus DRAFT padahal sudah punya transaksi finance terkait.');
        }
    }

    console.log('Audit Freight Nota Flow');
    console.log(`Dataset: ${cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production'}`);
    console.log('');

    if (issues.length === 0) {
        console.log('Semua invariant nota/coverage/lock finance: OK');
        return;
    }

    for (const issue of issues) {
        console.log(`- [${issue.scope}] ${issue.message}`);
    }
    console.log('');
    console.log(`Total temuan: ${issues.length}`);
    process.exitCode = 1;
}

main().catch(error => {
    console.error('Audit Freight Nota Flow gagal:', error);
    process.exit(1);
});
