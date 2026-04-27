import fs from 'node:fs';
import path from 'node:path';

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

function loadEnv(baseDir = process.cwd()) {
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

function requireAnyEnv(names) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    throw new Error(`Missing required environment variable. Expected one of: ${names.join(', ')}`);
}

loadEnv();

const supabaseUrl = requireAnyEnv(['SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PROJECT_URL']);
const serviceRoleKey = requireAnyEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE']);
const shouldWrite = process.argv.includes('--write');
const FETCH_BATCH_SIZE = 500;

function summarizeSample(ids) {
    return ids.slice(0, 5).join(', ');
}

function toArray(value) {
    return Array.isArray(value) ? value : [];
}

function toObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function createCargoSummary() {
    return { qtyKoli: 0, weightKg: 0, volumeM3: 0 };
}

function addCargoSummary(target, source) {
    target.qtyKoli += toNumber(source.qtyKoli);
    target.weightKg += toNumber(source.weightKg);
    target.volumeM3 += toNumber(source.volumeM3);
    return target;
}

function getWeightKg(point) {
    const direct = toNumber(point.weightKg);
    if (direct > 0) return direct;
    const input = toNumber(point.weightInputValue);
    const unit = String(point.weightInputUnit || 'KG').toUpperCase();
    return unit === 'TON' ? input * 1000 : input;
}

function getVolumeM3(point) {
    const direct = toNumber(point.volumeM3);
    if (direct > 0) return direct;
    const input = toNumber(point.volumeInputValue);
    const unit = String(point.volumeInputUnit || 'M3').toUpperCase();
    return unit === 'LITER' ? input / 1000 : input;
}

function normalizeCargoPoint(point) {
    return {
        qtyKoli: toNumber(point.qtyKoli),
        weightKg: getWeightKg(point),
        volumeM3: getVolumeM3(point),
    };
}

function isBillableStopType(stopType) {
    return String(stopType || '').toUpperCase() === 'DROP';
}

function isHoldStopType(stopType) {
    return ['HOLD', 'TRANSIT'].includes(String(stopType || '').toUpperCase());
}

function isReturnStopType(stopType) {
    return ['RETURN', 'RETUR'].includes(String(stopType || '').toUpperCase());
}

async function supabaseRequest(pathname, init = {}) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
        ...init,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

async function fetchAllRows(table) {
    const rows = [];
    for (let offset = 0; ; offset += FETCH_BATCH_SIZE) {
        const response = await supabaseRequest(`${table}?select=*&limit=${FETCH_BATCH_SIZE}&offset=${offset}`);
        const batch = await response.json();
        if (!Array.isArray(batch) || batch.length === 0) {
            break;
        }
        rows.push(...batch);
        if (batch.length < FETCH_BATCH_SIZE) {
            break;
        }
    }
    return rows;
}

function mapTripRecord(deliveryOrderRow) {
    return {
        _id: deliveryOrderRow.source_document_id,
        _type: 'trip',
        deliveryOrderRef: deliveryOrderRow.source_document_id,
        orderRef: deliveryOrderRow.order_ref || undefined,
        tripNumber: deliveryOrderRow.do_number || deliveryOrderRow.source_document_id,
        masterResi: deliveryOrderRow.master_resi || undefined,
        customerRef: deliveryOrderRow.customer_ref || undefined,
        customerName: deliveryOrderRow.customer_name || undefined,
        vehicleRef: deliveryOrderRow.vehicle_ref || undefined,
        vehiclePlate: deliveryOrderRow.vehicle_plate || undefined,
        driverRef: deliveryOrderRow.driver_ref || undefined,
        driverName: deliveryOrderRow.driver_name || undefined,
        tripDate: deliveryOrderRow.date,
        status: deliveryOrderRow.status,
        pickupAddress: deliveryOrderRow.pickup_address || undefined,
        receiverName: deliveryOrderRow.receiver_name || undefined,
        receiverPhone: deliveryOrderRow.receiver_phone || undefined,
        receiverAddress: deliveryOrderRow.receiver_address || undefined,
        receiverCompany: deliveryOrderRow.receiver_company || undefined,
        serviceRef: deliveryOrderRow.service_ref || undefined,
        serviceName: deliveryOrderRow.service_name || undefined,
        vehicleServiceRef: deliveryOrderRow.vehicle_service_ref || undefined,
        vehicleServiceName: deliveryOrderRow.vehicle_service_name || undefined,
        vehicleCategoryOverrideReason: deliveryOrderRow.vehicle_category_override_reason || undefined,
        tripRouteRateRef: deliveryOrderRow.trip_route_rate_ref || undefined,
        tripOriginArea: deliveryOrderRow.trip_origin_area || undefined,
        tripDestinationArea: deliveryOrderRow.trip_destination_area || undefined,
        trackingState: deliveryOrderRow.tracking_state || undefined,
        trackingStartedAt: deliveryOrderRow.tracking_started_at || undefined,
        trackingStoppedAt: deliveryOrderRow.tracking_stopped_at || undefined,
        trackingLastSeenAt: deliveryOrderRow.tracking_last_seen_at || undefined,
        pendingDriverStatus: deliveryOrderRow.pending_driver_status || undefined,
        cargoFinalizedAt: deliveryOrderRow.cargo_finalized_at || undefined,
        taripBorongan: deliveryOrderRow.tarip_borongan ?? undefined,
        notes: deliveryOrderRow.notes || undefined,
    };
}

function getReferenceIdentity(reference, fallbackIndex) {
    return reference._key || reference.referenceNumber || `reference-${fallbackIndex + 1}`;
}

function getPrimarySuratJalanNumber(deliveryOrderRow) {
    return deliveryOrderRow.customer_do_number || deliveryOrderRow.do_number || deliveryOrderRow.source_document_id;
}

function mapSuratJalanRecords(deliveryOrderRow, deliveryOrderItems) {
    const extraData = toObject(deliveryOrderRow.extra_data);
    const shipperReferences = toArray(extraData.shipperReferences);
    const actualDropPoints = toArray(extraData.actualDropPoints);
    const references = shipperReferences.length > 0 ? shipperReferences : [null];

    return references.map((reference, index) => {
        const suratJalanNumber = reference?.referenceNumber || getPrimarySuratJalanNumber(deliveryOrderRow);
        const referenceKey = reference ? getReferenceIdentity(reference, index) : undefined;
        const matchedItems = reference
            ? deliveryOrderItems.filter(item =>
                item.shipper_reference_key === reference._key ||
                item.shipper_reference_number === reference.referenceNumber
            )
            : deliveryOrderItems.filter(item => !item.shipper_reference_key && !item.shipper_reference_number);

        const cargoSummary = matchedItems.reduce((sum, item) => addCargoSummary(sum, {
            qtyKoli: item.order_item_qty_koli ?? item.shipped_qty_koli,
            weightKg: item.order_item_weight_kg ?? item.shipped_weight_kg,
            volumeM3: item.order_item_volume_m3,
        }), createCargoSummary());

        const billableCargo = createCargoSummary();
        const holdCargo = createCargoSummary();
        const returnCargo = createCargoSummary();

        for (const point of actualDropPoints) {
            const sameReference = reference
                ? point.shipperReferenceKey === reference._key || point.shipperReferenceNumber === reference.referenceNumber
                : !point.shipperReferenceKey && !point.shipperReferenceNumber;
            if (!sameReference) continue;
            const cargoPoint = normalizeCargoPoint(point);
            if (isBillableStopType(point.stopType)) addCargoSummary(billableCargo, cargoPoint);
            if (isHoldStopType(point.stopType)) addCargoSummary(holdCargo, cargoPoint);
            if (isReturnStopType(point.stopType)) addCargoSummary(returnCargo, cargoPoint);
        }

        return {
            _id: `${deliveryOrderRow.source_document_id}:${referenceKey || 'primary'}`,
            _type: 'suratJalan',
            tripRef: deliveryOrderRow.source_document_id,
            deliveryOrderRef: deliveryOrderRow.source_document_id,
            orderRef: deliveryOrderRow.order_ref || undefined,
            customerRef: deliveryOrderRow.customer_ref || undefined,
            customerName: deliveryOrderRow.customer_name || undefined,
            referenceKey,
            suratJalanNumber,
            pickupAddress: reference?.pickupAddress || deliveryOrderRow.pickup_address || undefined,
            receiverName: reference?.receiverName || deliveryOrderRow.receiver_name || undefined,
            receiverCompany: reference?.receiverCompany || deliveryOrderRow.receiver_company || undefined,
            receiverAddress: reference?.receiverAddress || deliveryOrderRow.receiver_address || undefined,
            tripDate: deliveryOrderRow.date || undefined,
            tripStatus: deliveryOrderRow.status || undefined,
            vehiclePlate: deliveryOrderRow.vehicle_plate || undefined,
            driverName: deliveryOrderRow.driver_name || undefined,
            itemCount: matchedItems.length,
            cargoSummary,
            billableCargo,
            holdCargo,
            returnCargo,
        };
    });
}

function mapSuratJalanItemRecords(suratJalanRecords, deliveryOrderItems) {
    return suratJalanRecords.flatMap(record => {
        const matchedItems = record.referenceKey
            ? deliveryOrderItems.filter(item =>
                item.shipper_reference_key === record.referenceKey ||
                item.shipper_reference_number === record.suratJalanNumber
            )
            : deliveryOrderItems.filter(item => !item.shipper_reference_key && !item.shipper_reference_number);

        return matchedItems.map(item => ({
            _id: `${record._id}:${item.source_document_id}`,
            _type: 'suratJalanItem',
            suratJalanRef: record._id,
            tripRef: record.tripRef,
            deliveryOrderItemRef: item.source_document_id,
            referenceKey: record.referenceKey,
            suratJalanNumber: record.suratJalanNumber,
            orderItemDescription: item.order_item_description || undefined,
            plannedCargo: {
                qtyKoli: toNumber(item.order_item_qty_koli ?? item.shipped_qty_koli),
                weightKg: toNumber(item.order_item_weight_kg ?? item.shipped_weight_kg),
                volumeM3: toNumber(item.order_item_volume_m3),
            },
            actualCargo: {
                qtyKoli: toNumber(item.actual_qty_koli),
                weightKg: toNumber(item.actual_weight_kg),
                volumeM3: toNumber(item.actual_volume_m3),
            },
        }));
    });
}

async function upsertDocs(table, docs) {
    if (docs.length === 0) return;
    const allKeys = new Set();
    for (const doc of docs) {
        for (const key of Object.keys(doc)) {
            allKeys.add(key);
        }
    }

    const payload = docs.map(doc => {
        const normalized = {};
        for (const key of allKeys) {
            const value = Object.prototype.hasOwnProperty.call(doc, key) ? doc[key] : null;
            normalized[key] = value === undefined ? null : value;
        }
        return normalized;
    });

    await supabaseRequest(table, {
        method: 'POST',
        headers: {
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(payload),
    });
}

async function main() {
    const [deliveryOrders, deliveryOrderItems] = await Promise.all([
        fetchAllRows('delivery_orders'),
        fetchAllRows('delivery_order_items'),
    ]);

    const itemsByDoRef = deliveryOrderItems.reduce((acc, item) => {
        const rows = acc.get(item.delivery_order_ref) || [];
        rows.push(item);
        acc.set(item.delivery_order_ref, rows);
        return acc;
    }, new Map());

    const tripRecords = [];
    const suratJalanRecords = [];
    const suratJalanItemRecords = [];

    for (const deliveryOrderRow of deliveryOrders) {
        const doItems = itemsByDoRef.get(deliveryOrderRow.source_document_id) || [];
        const tripRecord = mapTripRecord(deliveryOrderRow);
        const sjRecords = mapSuratJalanRecords(deliveryOrderRow, doItems);
        const sjItemRecords = mapSuratJalanItemRecords(sjRecords, doItems);
        tripRecords.push(tripRecord);
        suratJalanRecords.push(...sjRecords);
        suratJalanItemRecords.push(...sjItemRecords);
    }

    console.log('Backfill Trip / Surat Jalan Summary');
    console.log(`- Delivery orders source: ${deliveryOrders.length}`);
    console.log(`- Delivery order items source: ${deliveryOrderItems.length}`);
    console.log(`- Trip records planned: ${tripRecords.length}`);
    console.log(`- Surat jalan records planned: ${suratJalanRecords.length}`);
    console.log(`- Surat jalan item records planned: ${suratJalanItemRecords.length}`);
    console.log(`- Sample trip ids: ${summarizeSample(tripRecords.map(item => item._id)) || '-'}`);
    console.log(`- Sample surat jalan ids: ${summarizeSample(suratJalanRecords.map(item => item._id)) || '-'}`);

    if (!shouldWrite) {
        console.log('');
        console.log('Dry run only. No database changes were written.');
        console.log('Run with --write to upsert records into relational storage.');
        return;
    }

    await upsertDocs('trips', tripRecords);
    await upsertDocs('surat_jalan_documents', suratJalanRecords);
    await upsertDocs('surat_jalan_items', suratJalanItemRecords);

    console.log('');
    console.log('Backfill completed successfully.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
