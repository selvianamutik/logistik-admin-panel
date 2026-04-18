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

function normalizeRef(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object' && '_ref' in value && typeof value._ref === 'string') {
        return value._ref.trim();
    }
    return '';
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
    const [orders, deliveryOrders] = await Promise.all([
        client.fetch(`*[_type == "order"]{
            _id,
            masterResi,
            pickupStops[]{
                _key
            },
            tripPlans[]{
                _key,
                sequence,
                pickupStopKeys,
                vehicleRef,
                vehiclePlate,
                driverRef,
                driverName,
                linkedDeliveryOrderRef,
                linkedDeliveryOrderNumber
            }
        }`),
        client.fetch(`*[_type == "deliveryOrder"]{
            _id,
            doNumber,
            orderRef,
            status,
            vehicleRef,
            vehiclePlate,
            driverRef,
            driverName
        }`),
    ]);

    const issues = [];
    const doMap = new Map(deliveryOrders.map(item => [item._id, item]));

    for (const order of orders) {
        const scope = order.masterResi || order._id;
        const tripPlans = Array.isArray(order.tripPlans) ? order.tripPlans : [];
        const pickupStopKeys = new Set((order.pickupStops || []).map(stop => normalizeText(stop?._key)).filter(Boolean));
        const seenPlanKeys = new Set();
        const seenLinkedDoRefs = new Set();

        for (const [index, plan] of tripPlans.entries()) {
            const planScope = `${scope} / Trip ${plan.sequence || index + 1}`;
            const planKey = normalizeText(plan._key);
            if (!planKey) {
                addIssue(issues, planScope, 'Trip plan tidak punya _key stabil.');
            } else if (seenPlanKeys.has(planKey)) {
                addIssue(issues, planScope, `Trip plan _key ${planKey} duplikat dalam order yang sama.`);
            } else {
                seenPlanKeys.add(planKey);
            }

            for (const stopKey of plan.pickupStopKeys || []) {
                const normalizedStopKey = normalizeText(stopKey);
                if (normalizedStopKey && pickupStopKeys.size > 0 && !pickupStopKeys.has(normalizedStopKey)) {
                    addIssue(issues, planScope, `pickupStopKey ${normalizedStopKey} tidak ditemukan di order.`);
                }
            }

            const linkedDeliveryOrderRef = normalizeText(plan.linkedDeliveryOrderRef);
            if (!linkedDeliveryOrderRef) {
                continue;
            }
            if (seenLinkedDoRefs.has(linkedDeliveryOrderRef)) {
                addIssue(issues, planScope, `linkedDeliveryOrderRef ${linkedDeliveryOrderRef} dipakai lebih dari satu trip plan.`);
                continue;
            }
            seenLinkedDoRefs.add(linkedDeliveryOrderRef);

            const linkedDeliveryOrder = doMap.get(linkedDeliveryOrderRef);
            if (!linkedDeliveryOrder) {
                addIssue(issues, planScope, `DO linked ${linkedDeliveryOrderRef} tidak ditemukan.`);
                continue;
            }

            if (normalizeRef(linkedDeliveryOrder.orderRef) !== order._id) {
                addIssue(issues, planScope, `DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef} tidak kembali ke order yang sama.`);
            }

            if (normalizeText(plan.linkedDeliveryOrderNumber) && normalizeText(plan.linkedDeliveryOrderNumber) !== normalizeText(linkedDeliveryOrder.doNumber)) {
                addIssue(
                    issues,
                    planScope,
                    `linkedDeliveryOrderNumber ${plan.linkedDeliveryOrderNumber} tidak sinkron dengan DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef}.`
                );
            }

            if (normalizeRef(plan.vehicleRef) && normalizeRef(plan.vehicleRef) !== normalizeRef(linkedDeliveryOrder.vehicleRef)) {
                addIssue(
                    issues,
                    planScope,
                    `Kendaraan trip plan (${normalizeRef(plan.vehicleRef)}) tidak sinkron dengan DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef}.`
                );
            }

            if (normalizeText(plan.vehiclePlate) && normalizeText(plan.vehiclePlate) !== normalizeText(linkedDeliveryOrder.vehiclePlate)) {
                addIssue(
                    issues,
                    planScope,
                    `Plat kendaraan trip plan (${plan.vehiclePlate}) tidak sinkron dengan DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef}.`
                );
            }

            if (normalizeRef(plan.driverRef) && normalizeRef(plan.driverRef) !== normalizeRef(linkedDeliveryOrder.driverRef)) {
                addIssue(
                    issues,
                    planScope,
                    `Supir trip plan (${normalizeRef(plan.driverRef)}) tidak sinkron dengan DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef}.`
                );
            }

            if (normalizeText(plan.driverName) && normalizeText(plan.driverName) !== normalizeText(linkedDeliveryOrder.driverName)) {
                addIssue(
                    issues,
                    planScope,
                    `Nama supir trip plan (${plan.driverName}) tidak sinkron dengan DO ${linkedDeliveryOrder.doNumber || linkedDeliveryOrderRef}.`
                );
            }
        }
    }

    console.log('Audit Order Trip Handoff');
    console.log(`Dataset: ${cleanEnv(process.env.NEXT_PUBLIC_SANITY_DATASET) || 'production'}`);
    console.log('');

    if (issues.length === 0) {
        console.log('Semua invariant order/trip plan/DO link: OK');
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
    console.error(error);
    process.exitCode = 1;
});
