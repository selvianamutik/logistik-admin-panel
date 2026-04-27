import fs from 'node:fs/promises';
import path from 'node:path';

import { deriveTripSuratJalanDocs } from './_trip-surat-jalan-seed-utils.mjs';

function getArgValue(flag, fallback = '') {
    const match = process.argv.find(arg => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : fallback;
}

function getDocsByType(docs, type) {
    return docs.filter(doc => doc && doc._type === type);
}

function buildIdMap(docs) {
    return docs.reduce((acc, doc) => {
        acc.set(doc._id, doc);
        return acc;
    }, new Map());
}

function collectDuplicateIds(docs) {
    const seen = new Set();
    const duplicates = new Set();
    for (const doc of docs) {
        if (!doc || typeof doc._id !== 'string') continue;
        if (seen.has(doc._id)) {
            duplicates.add(doc._id);
            continue;
        }
        seen.add(doc._id);
    }
    return [...duplicates].sort();
}

function compareIdSets(expectedDocs, actualDocs) {
    const expectedIds = new Set(expectedDocs.map(doc => doc._id));
    const actualIds = new Set(actualDocs.map(doc => doc._id));

    const missing = [...expectedIds].filter(id => !actualIds.has(id)).sort();
    const unexpected = [...actualIds].filter(id => !expectedIds.has(id)).sort();

    return { missing, unexpected };
}

function collectBrokenRefs(docs, fieldName, targetMap) {
    return docs
        .filter(doc => {
            const ref = doc?.[fieldName];
            return typeof ref === 'string' && ref.trim() && !targetMap.has(ref);
        })
        .map(doc => ({ id: doc._id, ref: doc[fieldName] }))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function printList(label, values, formatter = value => `  - ${value}`) {
    if (!values.length) return;
    console.log(label);
    for (const value of values) {
        console.log(formatter(value));
    }
}

async function main() {
    const inputPath = getArgValue('--input', path.join('artifacts', 'default-supabase-seed.trip-surat-jalan.json'));
    const raw = await fs.readFile(path.resolve(process.cwd(), inputPath), 'utf8');
    const docs = JSON.parse(raw);

    if (!Array.isArray(docs)) {
        throw new Error('Seed input must be a JSON array.');
    }

    const legacyDeliveryOrders = getDocsByType(docs, 'deliveryOrder');
    const legacyDeliveryOrderItems = getDocsByType(docs, 'deliveryOrderItem');
    const tripDocs = getDocsByType(docs, 'trip');
    const suratJalanDocs = getDocsByType(docs, 'suratJalan');
    const suratJalanItemDocs = getDocsByType(docs, 'suratJalanItem');

    const expected = legacyDeliveryOrders.length > 0
        ? deriveTripSuratJalanDocs(docs)
        : null;

    const tripMap = buildIdMap(tripDocs);
    const suratJalanMap = buildIdMap(suratJalanDocs);

    const duplicateTrips = collectDuplicateIds(tripDocs);
    const duplicateSuratJalan = collectDuplicateIds(suratJalanDocs);
    const duplicateSuratJalanItems = collectDuplicateIds(suratJalanItemDocs);

    const brokenTripRefs = collectBrokenRefs(suratJalanDocs, 'tripRef', tripMap);
    const brokenSuratJalanRefs = collectBrokenRefs(suratJalanItemDocs, 'suratJalanRef', suratJalanMap);
    const brokenTripItemRefs = collectBrokenRefs(suratJalanItemDocs, 'tripRef', tripMap);

    const issues = [];

    if (duplicateTrips.length) issues.push(`duplicate trip ids: ${duplicateTrips.length}`);
    if (duplicateSuratJalan.length) issues.push(`duplicate surat jalan ids: ${duplicateSuratJalan.length}`);
    if (duplicateSuratJalanItems.length) issues.push(`duplicate surat jalan item ids: ${duplicateSuratJalanItems.length}`);
    if (brokenTripRefs.length) issues.push(`surat jalan docs with missing tripRef: ${brokenTripRefs.length}`);
    if (brokenSuratJalanRefs.length) issues.push(`surat jalan items with missing suratJalanRef: ${brokenSuratJalanRefs.length}`);
    if (brokenTripItemRefs.length) issues.push(`surat jalan items with missing tripRef: ${brokenTripItemRefs.length}`);

    let tripDiff = null;
    let suratJalanDiff = null;
    let suratJalanItemDiff = null;

    if (expected) {
        tripDiff = compareIdSets(expected.tripDocs, tripDocs);
        suratJalanDiff = compareIdSets(expected.suratJalanDocs, suratJalanDocs);
        suratJalanItemDiff = compareIdSets(expected.suratJalanItemDocs, suratJalanItemDocs);

        if (tripDiff.missing.length || tripDiff.unexpected.length) {
            issues.push(`trip set mismatch: missing ${tripDiff.missing.length}, unexpected ${tripDiff.unexpected.length}`);
        }
        if (suratJalanDiff.missing.length || suratJalanDiff.unexpected.length) {
            issues.push(`surat jalan set mismatch: missing ${suratJalanDiff.missing.length}, unexpected ${suratJalanDiff.unexpected.length}`);
        }
        if (suratJalanItemDiff.missing.length || suratJalanItemDiff.unexpected.length) {
            issues.push(`surat jalan item set mismatch: missing ${suratJalanItemDiff.missing.length}, unexpected ${suratJalanItemDiff.unexpected.length}`);
        }
    }

    console.log('Seed Trip / Surat Jalan Verification');
    console.log(`- Input: ${inputPath}`);
    console.log(`- Legacy delivery orders: ${legacyDeliveryOrders.length}`);
    console.log(`- Legacy delivery order items: ${legacyDeliveryOrderItems.length}`);
    console.log(`- Trip docs present: ${tripDocs.length}`);
    console.log(`- Surat jalan docs present: ${suratJalanDocs.length}`);
    console.log(`- Surat jalan item docs present: ${suratJalanItemDocs.length}`);
    if (expected) {
        console.log(`- Expected trips from legacy docs: ${expected.tripDocs.length}`);
        console.log(`- Expected surat jalan docs from legacy docs: ${expected.suratJalanDocs.length}`);
        console.log(`- Expected surat jalan item docs from legacy docs: ${expected.suratJalanItemDocs.length}`);
    } else {
        console.log('- Legacy docs not present; running structural verification only');
    }

    if (issues.length === 0) {
        console.log('Verification passed');
        return;
    }

    console.log('Verification failed');
    printList('Issues:', issues);

    if (tripDiff) {
        printList('Missing trip ids:', tripDiff.missing);
        printList('Unexpected trip ids:', tripDiff.unexpected);
    }
    if (suratJalanDiff) {
        printList('Missing surat jalan ids:', suratJalanDiff.missing);
        printList('Unexpected surat jalan ids:', suratJalanDiff.unexpected);
    }
    if (suratJalanItemDiff) {
        printList('Missing surat jalan item ids:', suratJalanItemDiff.missing);
        printList('Unexpected surat jalan item ids:', suratJalanItemDiff.unexpected);
    }

    printList('Broken surat jalan -> trip refs:', brokenTripRefs, value => `  - ${value.id} -> ${value.ref}`);
    printList('Broken surat jalan item -> surat jalan refs:', brokenSuratJalanRefs, value => `  - ${value.id} -> ${value.ref}`);
    printList('Broken surat jalan item -> trip refs:', brokenTripItemRefs, value => `  - ${value.id} -> ${value.ref}`);

    process.exitCode = 1;
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
