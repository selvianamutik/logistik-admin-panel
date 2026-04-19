import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const manifestPath = path.join(
    appDir,
    'apps/driver_app/lib/src/features/tracking/presentation/delivery_manifest_page.dart'
);
const servicePath = path.join(
    appDir,
    'apps/driver_app/lib/src/features/tracking/data/delivery_order_service.dart'
);

const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const serviceSource = fs.readFileSync(servicePath, 'utf8');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertIncludes(source, expected, message) {
    assert(source.includes(expected), message);
}

function assertNotIncludes(source, forbidden, message) {
    assert(!source.includes(forbidden), message);
}

const requiredDriverEndpoints = [
    '/api/driver/delivery-orders',
    '/api/driver/delivery-orders/create',
    '/api/driver/delivery-orders/cargo',
    '/api/driver/delivery-orders/status',
];

for (const endpoint of requiredDriverEndpoints) {
    assertIncludes(
        serviceSource,
        endpoint,
        `Mobile driver service belum memakai endpoint ${endpoint}.`
    );
}

for (const payloadKey of [
    "'shipperReferences'",
    "'cargoItems'",
    "'referenceNumber'",
    "'shipperReferenceNumber'",
    "'pickupStopKey'",
    "'customerProductRef'",
    "'weightInputValue'",
    "'weightInputUnit'",
    "'volumeInputValue'",
    "'volumeInputUnit'",
]) {
    assertIncludes(
        serviceSource,
        payloadKey,
        `Payload mobile driver belum mengirim ${payloadKey}.`
    );
}

assertIncludes(
    manifestSource,
    'Satu trip bisa punya banyak SJ. Setiap SJ bisa punya banyak barang.',
    'Copy mobile manifest harus menjelaskan multi-SJ dan multi-barang.'
);
assertIncludes(
    manifestSource,
    "label: const Text('Tambah SJ')",
    'Mobile manifest harus tetap bisa menambah banyak SJ.'
);
assertIncludes(
    manifestSource,
    "label: const Text('Tambah Barang di SJ Ini')",
    'Mobile manifest harus tetap bisa menambah banyak barang per SJ.'
);
assertIncludes(
    manifestSource,
    'key: ValueKey(group.id)',
    'Group SJ mobile harus punya key stabil agar controller tidak tertukar.'
);
assertIncludes(
    manifestSource,
    'key: ValueKey(item.id)',
    'Item barang mobile harus punya key stabil agar controller tidak tertukar.'
);
assertIncludes(
    manifestSource,
    'class _SyncedTextFormField extends StatefulWidget',
    'Mobile manifest harus memakai field controller sinkron untuk input stabil.'
);

for (const unstableKeyPattern of [
    "ValueKey('sj-",
    "ValueKey('desc-",
    "ValueKey('koli-",
    "ValueKey('weight-",
    "ValueKey('volume-",
]) {
    assertNotIncludes(
        manifestSource,
        unstableKeyPattern,
        `Mobile manifest masih punya key field tidak stabil: ${unstableKeyPattern}.`
    );
}

console.log('Mobile driver manifest audit OK: endpoints, payloads, multi-SJ, and stable inputs verified.');
