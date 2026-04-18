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

function parseNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function toKg(value, unit) {
    const amount = parseNumber(value);
    return unit === 'TON' ? amount * 1000 : amount;
}

function round3(value) {
    return Math.round(value * 1000) / 1000;
}

function buildShipperReferences(deliveryOrder) {
    const references = [];
    const seen = new Set();
    for (const item of deliveryOrder.shipperReferences || []) {
        const referenceNumber = normalizeText(item.referenceNumber);
        if (!referenceNumber) continue;
        const key = referenceNumber.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        references.push(item);
    }
    const legacy = normalizeText(deliveryOrder.customerDoNumber);
    if (legacy && !seen.has(legacy.toLowerCase())) {
        references.push({ referenceNumber: legacy });
    }
    return references;
}

function sumActualDropPoints(items = []) {
    return items.reduce((acc, item) => {
        acc.qtyKoli += parseNumber(item.qtyKoli);
        acc.weightKg += parseNumber(item.weightKg) || toKg(item.weightInputValue, item.weightInputUnit);
        return acc;
    }, { qtyKoli: 0, weightKg: 0 });
}

function sumActualCargoItems(items = []) {
    return items.reduce((acc, item) => {
        acc.qtyKoli += parseNumber(item.actualQtyKoli);
        acc.weightKg += parseNumber(item.actualWeightKg) || toKg(item.actualWeightInputValue, item.actualWeightInputUnit);
        return acc;
    }, { qtyKoli: 0, weightKg: 0 });
}

function logIssue(issues, scope, message) {
    issues.push({ scope, message });
}

function unique(array) {
    return [...new Set(array)];
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
    const [customers, deliveryOrders, deliveryOrderItems, freightNotas, freightNotaItems] = await Promise.all([
        client.fetch(`*[_type == "customer"]{ _id, name }`),
        client.fetch(`*[_type == "deliveryOrder"]{
            _id,
            doNumber,
            status,
            customerRef,
            customerName,
            customerDoNumber,
            shipperReferences[]{
                _key,
                referenceNumber,
                billingCustomerRef,
                billingCustomerName,
                receiverAddress
            },
            pendingDriverStatus,
            pendingDriverActualCargoItems[]{
                deliveryOrderItemRef,
                actualQtyKoli,
                actualWeightKg,
                actualWeightInputValue,
                actualWeightInputUnit
            },
            pendingDriverActualDropPoints[]{
                qtyKoli,
                weightKg,
                weightInputValue,
                weightInputUnit
            },
            actualDropPoints[]{
                qtyKoli,
                weightKg,
                weightInputValue,
                weightInputUnit
            },
            freightNotaRef
        }`),
        client.fetch(`*[_type == "deliveryOrderItem"]{
            _id,
            deliveryOrderRef,
            actualQtyKoli,
            actualWeightKg,
            actualWeightInputValue,
            actualWeightInputUnit,
            shipperReferenceNumber,
            shipperReferenceKey
        }`),
        client.fetch(`*[_type == "freightNota"]{ _id, notaNumber, customerRef, customerName }`),
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
    ]);

    const issues = [];
    const customerMap = new Map(customers.map(item => [item._id, item]));
    const doMap = new Map(deliveryOrders.map(item => [item._id, item]));
    const notaMap = new Map(freightNotas.map(item => [item._id, item]));
    const doItemsByDo = new Map();

    for (const item of deliveryOrderItems) {
        const key = item.deliveryOrderRef;
        if (!doItemsByDo.has(key)) doItemsByDo.set(key, []);
        doItemsByDo.get(key).push(item);
    }

    for (const deliveryOrder of deliveryOrders) {
        const doScope = deliveryOrder.doNumber || deliveryOrder._id;
        const references = buildShipperReferences(deliveryOrder);
        const referenceNumbers = references.map(item => normalizeText(item.referenceNumber));
        const normalizedNumbers = referenceNumbers.map(item => item.toLowerCase()).filter(Boolean);

        if (normalizedNumbers.length !== unique(normalizedNumbers).length) {
            logIssue(issues, doScope, 'Duplicate SJ pengirim ditemukan dalam satu DO.');
        }

        const legacyCustomerDoNumber = normalizeText(deliveryOrder.customerDoNumber);
        if (legacyCustomerDoNumber && referenceNumbers.length > 0 && legacyCustomerDoNumber !== referenceNumbers[0]) {
            logIssue(issues, doScope, `customerDoNumber legacy (${legacyCustomerDoNumber}) tidak sinkron dengan SJ pertama (${referenceNumbers[0]}).`);
        }

        for (const reference of references) {
            const billingCustomerRef = normalizeText(reference.billingCustomerRef);
            const billingCustomerName = normalizeText(reference.billingCustomerName);
            if (billingCustomerRef && !customerMap.has(billingCustomerRef)) {
                logIssue(issues, doScope, `SJ ${reference.referenceNumber} memakai billingCustomerRef tidak dikenal: ${billingCustomerRef}.`);
            }
            const mappedCustomerName = customerMap.get(billingCustomerRef)?.name;
            if (billingCustomerRef && billingCustomerName && mappedCustomerName && billingCustomerName !== mappedCustomerName) {
                logIssue(issues, doScope, `SJ ${reference.referenceNumber} punya billingCustomerName (${billingCustomerName}) yang tidak cocok dengan master customer (${mappedCustomerName}).`);
            }
        }

        const doItems = doItemsByDo.get(deliveryOrder._id) || [];
        for (const item of doItems) {
            const refNumber = normalizeText(item.shipperReferenceNumber);
            if (refNumber && !normalizedNumbers.includes(refNumber.toLowerCase())) {
                logIssue(issues, doScope, `Item ${item._id} mengarah ke SJ ${refNumber} yang tidak ada di header DO.`);
            }
        }

        if ((deliveryOrder.actualDropPoints || []).length > 0) {
            const actualFromDrops = sumActualDropPoints(deliveryOrder.actualDropPoints);
            const actualFromItems = sumActualCargoItems(doItems);
            if (round3(actualFromDrops.qtyKoli) !== round3(actualFromItems.qtyKoli) || round3(actualFromDrops.weightKg) !== round3(actualFromItems.weightKg)) {
                logIssue(
                    issues,
                    doScope,
                    `Total actualDropPoints (${actualFromDrops.qtyKoli} koli / ${actualFromDrops.weightKg} kg) tidak sama dengan total actual item (${actualFromItems.qtyKoli} koli / ${actualFromItems.weightKg} kg).`
                );
            }
        }

        if (deliveryOrder.pendingDriverStatus === 'DELIVERED') {
            const pendingCargo = sumActualCargoItems(deliveryOrder.pendingDriverActualCargoItems || []);
            const pendingDrops = sumActualDropPoints(deliveryOrder.pendingDriverActualDropPoints || []);
            if ((deliveryOrder.pendingDriverActualDropPoints || []).length === 0) {
                logIssue(issues, doScope, 'pendingDriverStatus DELIVERED tidak punya pendingDriverActualDropPoints.');
            } else if (round3(pendingCargo.qtyKoli) !== round3(pendingDrops.qtyKoli) || round3(pendingCargo.weightKg) !== round3(pendingDrops.weightKg)) {
                logIssue(
                    issues,
                    doScope,
                    `Draft delivered driver tidak sinkron: cargo ${pendingCargo.qtyKoli} koli / ${pendingCargo.weightKg} kg vs drop ${pendingDrops.qtyKoli} koli / ${pendingDrops.weightKg} kg.`
                );
            }
        }
    }

    const notaCustomerGroups = new Map();
    const notaCoverageKeys = new Map();
    const doToNotaRefs = new Map();

    for (const item of freightNotaItems) {
        const note = notaMap.get(item.notaRef);
        const deliveryOrder = doMap.get(item.doRef);
        const scope = `${note?.notaNumber || item.notaRef} / ${item.noSJ || '-'}`;

        if (!notaCustomerGroups.has(item.notaRef)) notaCustomerGroups.set(item.notaRef, new Set());
        if (item.customerRef) notaCustomerGroups.get(item.notaRef).add(item.customerRef);

        const doRefsForItem = unique([item.deliveryOrderItemRef, ...(item.deliveryOrderItemRefs || [])].map(normalizeText).filter(Boolean)).sort();
        const coverageKey = `${normalizeText(item.doRef)}::${normalizeText(item.noSJ).toLowerCase()}::${doRefsForItem.join('|') || 'no-items'}`;
        if (notaCoverageKeys.has(coverageKey)) {
            logIssue(issues, scope, `Coverage DO/SJ duplikat dengan item nota ${notaCoverageKeys.get(coverageKey)}.`);
        } else {
            notaCoverageKeys.set(coverageKey, item._id);
        }

        if (item.doRef) {
            if (!doToNotaRefs.has(item.doRef)) doToNotaRefs.set(item.doRef, new Set());
            doToNotaRefs.get(item.doRef).add(item.notaRef);
        }

        if (!deliveryOrder) {
            logIssue(issues, scope, `Mengarah ke DO yang tidak ditemukan: ${item.doRef}.`);
            continue;
        }

        const references = buildShipperReferences(deliveryOrder);
        const normalizedNoSJ = normalizeText(item.noSJ).toLowerCase();
        const matchedReference = references.find(reference => normalizeText(reference.referenceNumber).toLowerCase() === normalizedNoSJ);
        const matchesLegacyDoNumber = normalizedNoSJ && normalizedNoSJ === normalizeText(deliveryOrder.doNumber).toLowerCase();
        if (!matchedReference && !matchesLegacyDoNumber) {
            logIssue(issues, scope, `No. SJ ${item.noSJ} tidak ditemukan pada header DO ${deliveryOrder.doNumber || deliveryOrder._id}.`);
            continue;
        }
        if (!matchedReference && matchesLegacyDoNumber) {
            continue;
        }

        const billingCustomerRef = normalizeText(matchedReference.billingCustomerRef) || normalizeText(deliveryOrder.customerRef);
        const billingCustomerName = normalizeText(matchedReference.billingCustomerName) || normalizeText(customerMap.get(billingCustomerRef)?.name) || normalizeText(deliveryOrder.customerName);
        const receiverAddress = normalizeText(matchedReference.receiverAddress);

        if (billingCustomerRef && normalizeText(item.customerRef) !== billingCustomerRef) {
            logIssue(issues, scope, `Customer nota (${item.customerRef || '-'}) tidak cocok dengan billing customer SJ (${billingCustomerRef}).`);
        }
        if (billingCustomerName && normalizeText(item.customerName) && normalizeText(item.customerName) !== billingCustomerName) {
            logIssue(issues, scope, `Nama customer nota (${item.customerName}) tidak cocok dengan billing customer SJ (${billingCustomerName}).`);
        }
        if (receiverAddress && normalizeText(item.tujuan) !== receiverAddress) {
            logIssue(issues, scope, `Tujuan nota (${item.tujuan || '-'}) tidak cocok dengan tujuan SJ (${receiverAddress}).`);
        }
    }

    for (const [notaRef, customerRefs] of notaCustomerGroups.entries()) {
        if (customerRefs.size > 1) {
            const note = notaMap.get(notaRef);
            logIssue(issues, note?.notaNumber || notaRef, `Satu nota memuat lebih dari satu customer tagihan: ${[...customerRefs].join(', ')}.`);
        }
    }

    for (const deliveryOrder of deliveryOrders) {
        const legacyNotaRef = normalizeText(deliveryOrder.freightNotaRef);
        const relatedNotaRefs = doToNotaRefs.get(deliveryOrder._id) || new Set();
        if (legacyNotaRef && relatedNotaRefs.size > 0 && !relatedNotaRefs.has(legacyNotaRef)) {
            logIssue(issues, deliveryOrder.doNumber || deliveryOrder._id, `freightNotaRef legacy (${legacyNotaRef}) tidak sinkron dengan freightNotaItem coverage (${[...relatedNotaRefs].join(', ')}).`);
        }
        if (relatedNotaRefs.size > 1 && legacyNotaRef) {
            logIssue(issues, deliveryOrder.doNumber || deliveryOrder._id, `DO punya coverage ke banyak nota (${[...relatedNotaRefs].join(', ')}) tapi masih menyimpan freightNotaRef tunggal (${legacyNotaRef}).`);
        }
    }

    console.log('Audit DO Flow');
    console.log(`Dataset: ${cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production'}`);
    console.log('');

    if (issues.length === 0) {
        console.log('Semua invariant DO/SJ/drop/nota: OK');
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
    console.error('Audit DO Flow gagal:', error);
    process.exit(1);
});
