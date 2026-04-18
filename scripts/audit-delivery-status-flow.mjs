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

function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
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

function sumCargo(items = []) {
    return items.reduce((acc, item) => {
        acc.qtyKoli += parseNumber(item.actualQtyKoli);
        acc.weightKg += parseNumber(item.actualWeightKg) || toKg(item.actualWeightInputValue, item.actualWeightInputUnit);
        return acc;
    }, { qtyKoli: 0, weightKg: 0 });
}

function sumDrops(items = []) {
    return items.reduce((acc, item) => {
        acc.qtyKoli += parseNumber(item.qtyKoli);
        acc.weightKg += parseNumber(item.weightKg) || toKg(item.weightInputValue, item.weightInputUnit);
        return acc;
    }, { qtyKoli: 0, weightKg: 0 });
}

function round3(value) {
    return Math.round(value * 1000) / 1000;
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
    const [deliveryOrders, deliveryOrderItems] = await Promise.all([
        client.fetch(`*[_type == "deliveryOrder"]{
            _id,
            doNumber,
            status,
            pendingDriverStatus,
            pendingDriverStatusRequestedAt,
            pendingDriverStatusRequestedBy,
            pendingDriverStatusRequestedByName,
            pendingDriverStatusNote,
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
            podReceiverName,
            podReceivedDate,
            cargoFinalizedAt,
            cargoFinalizedBy
        }`),
        client.fetch(`*[_type == "deliveryOrderItem"]{
            _id,
            deliveryOrderRef,
            actualQtyKoli,
            actualWeightKg,
            actualWeightInputValue,
            actualWeightInputUnit
        }`),
    ]);

    const issues = [];
    const itemsByDo = new Map();
    for (const item of deliveryOrderItems) {
        if (!itemsByDo.has(item.deliveryOrderRef)) itemsByDo.set(item.deliveryOrderRef, []);
        itemsByDo.get(item.deliveryOrderRef).push(item);
    }

    for (const deliveryOrder of deliveryOrders) {
        const scope = deliveryOrder.doNumber || deliveryOrder._id;
        const doItems = itemsByDo.get(deliveryOrder._id) || [];
        const actualDrops = deliveryOrder.actualDropPoints || [];
        const pendingDrops = deliveryOrder.pendingDriverActualDropPoints || [];
        const pendingCargo = deliveryOrder.pendingDriverActualCargoItems || [];

        if (deliveryOrder.status === 'DELIVERED') {
            if (deliveryOrder.pendingDriverStatus) {
                addIssue(issues, scope, `Status sudah DELIVERED tapi masih menyimpan pendingDriverStatus ${deliveryOrder.pendingDriverStatus}.`);
            }
            if (actualDrops.length === 0) {
                addIssue(issues, scope, 'Status DELIVERED tetapi belum punya actualDropPoints.');
            }
            if (!deliveryOrder.podReceivedDate) {
                addIssue(issues, scope, 'Status DELIVERED tetapi podReceivedDate kosong.');
            }
            if (!deliveryOrder.cargoFinalizedAt || !deliveryOrder.cargoFinalizedBy) {
                addIssue(issues, scope, 'Status DELIVERED tetapi cargo finalization belum lengkap.');
            }
        } else {
            if (actualDrops.length > 0) {
                addIssue(issues, scope, `Status ${deliveryOrder.status} tidak DELIVERED tetapi sudah punya actualDropPoints.`);
            }
        }

        if (!deliveryOrder.pendingDriverStatus) {
            if (pendingCargo.length > 0 || pendingDrops.length > 0) {
                addIssue(issues, scope, 'Tidak ada pendingDriverStatus tapi draft driver masih tersimpan.');
            }
            continue;
        }

        if (!deliveryOrder.pendingDriverStatusRequestedAt || !deliveryOrder.pendingDriverStatusRequestedBy || !deliveryOrder.pendingDriverStatusRequestedByName) {
            addIssue(issues, scope, 'pendingDriverStatus ada tetapi metadata request driver tidak lengkap.');
        }

        if (deliveryOrder.pendingDriverStatus === 'DELIVERED') {
            if (deliveryOrder.status === 'DELIVERED') {
                addIssue(issues, scope, 'Pending DELIVERED masih tersimpan padahal status utama sudah DELIVERED.');
            }
            if (pendingCargo.length === 0) {
                addIssue(issues, scope, 'Pending DELIVERED tidak punya pendingDriverActualCargoItems.');
            }
            if (pendingDrops.length === 0) {
                addIssue(issues, scope, 'Pending DELIVERED tidak punya pendingDriverActualDropPoints.');
            }
            const cargoTotals = sumCargo(pendingCargo);
            const dropTotals = sumDrops(pendingDrops);
            if (round3(cargoTotals.qtyKoli) !== round3(dropTotals.qtyKoli) || round3(cargoTotals.weightKg) !== round3(dropTotals.weightKg)) {
                addIssue(
                    issues,
                    scope,
                    `Draft delivered driver tidak sinkron: cargo ${cargoTotals.qtyKoli} koli / ${cargoTotals.weightKg} kg vs drop ${dropTotals.qtyKoli} koli / ${dropTotals.weightKg} kg.`
                );
            }
        }

        if (deliveryOrder.pendingDriverStatus !== 'DELIVERED' && (pendingCargo.length > 0 || pendingDrops.length > 0)) {
            addIssue(issues, scope, `Pending status ${deliveryOrder.pendingDriverStatus} tidak semestinya membawa draft delivered cargo/drop.`);
        }

        const finalCargoTotals = sumCargo(doItems);
        const finalDropTotals = sumDrops(actualDrops);
        if (deliveryOrder.status === 'DELIVERED' && (round3(finalCargoTotals.qtyKoli) !== round3(finalDropTotals.qtyKoli) || round3(finalCargoTotals.weightKg) !== round3(finalDropTotals.weightKg))) {
            addIssue(
                issues,
                scope,
                `Data final DO tidak sinkron: item ${finalCargoTotals.qtyKoli} koli / ${finalCargoTotals.weightKg} kg vs drop ${finalDropTotals.qtyKoli} koli / ${finalDropTotals.weightKg} kg.`
            );
        }
    }

    console.log('Audit Delivery Status Flow');
    console.log(`Dataset: ${cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production'}`);
    console.log('');

    if (issues.length === 0) {
        console.log('Semua invariant status DO/pending approval/drop/POD: OK');
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
    console.error('Audit Delivery Status Flow gagal:', error);
    process.exit(1);
});
