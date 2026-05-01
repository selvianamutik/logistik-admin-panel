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
const completionPath = path.join(
    appDir,
    'apps/driver_app/lib/src/features/tracking/presentation/delivery_completion_page.dart'
);

const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const serviceSource = fs.readFileSync(servicePath, 'utf8');
const completionSource = fs.readFileSync(completionPath, 'utf8');

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
    "'actualItems'",
    "'actualDropPoints'",
    "'referenceNumber'",
    "'shipperReferenceNumber'",
    "'shipperReferenceKey'",
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
assertIncludes(
    manifestSource,
    '_normalizeManifestItemPatch',
    'Mobile manifest harus menormalisasi perubahan barang/koli agar berat terkunci tetap sinkron.'
);
assertIncludes(
    manifestSource,
    'final nextQty = currentQty > 0',
    'Mobile manifest harus mempertahankan koli yang sudah diinput saat master barang diganti.'
);
assertIncludes(
    manifestSource,
    '_productWeightPerKoliKg(selectedProduct)',
    'Mobile manifest harus menghitung ulang berat dari master barang per koli.'
);
assertIncludes(
    manifestSource,
    'enabled: !item.isWeightLocked',
    'Mobile manifest harus mengunci input berat manual jika barang master dan koli sudah menentukan berat.'
);
assertIncludes(
    completionSource,
    'key: ValueKey(draft.itemId)',
    'Mobile completion cargo card harus punya key stabil agar controller tidak tertukar.'
);
assertIncludes(
    completionSource,
    'key: ValueKey(entry.value.id)',
    'Mobile completion drop card harus punya key stabil agar controller tidak tertukar.'
);
assertIncludes(
    completionSource,
    'class _SyncedTextFormField extends StatefulWidget',
    'Mobile completion harus memakai field controller sinkron untuk input aktual/drop yang stabil.'
);
assertIncludes(
    completionSource,
    'required this.customerRecipients',
    'Mobile completion harus menerima master tujuan customer untuk finalisasi titik drop.'
);
assertIncludes(
    completionSource,
    'labelText: \'Master Tujuan Customer\'',
    'Mobile completion harus menyediakan dropdown master tujuan saat finalisasi drop.'
);
assertNotIncludes(
    completionSource,
    "locationName: (trip.receiverName ?? trip.destinationLabel).trim()",
    'Mobile completion tidak boleh mengisi tujuan default dari receiver/route sebelum finalisasi.'
);
assertNotIncludes(
    completionSource,
    'shipperReferenceNumber: target.shipperReferenceNumber',
    'Mobile completion tidak boleh membuat titik drop default per SJ sebelum tujuan aktual diisi driver.'
);
assertIncludes(
    serviceSource,
    "'shipperReferenceNumber': shipperReferenceNumber",
    'Mobile completion payload harus mengirim relasi titik drop ke nomor SJ.'
);
assertIncludes(
    serviceSource,
    "decoded['customerRecipients']",
    'Mobile service harus membaca master tujuan customer dari portal driver.'
);
assertIncludes(
    serviceSource,
    'destinationLabel: destinationLabel',
    'Mobile service harus memakai rute trip, bukan alamat tujuan invoice/order, untuk label perjalanan.'
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

for (const unstableCompletionPattern of [
    'initialValue: draft.qtyKoli',
    'initialValue: draft.weightInputValue',
    'initialValue: draft.volumeInputValue',
    'initialValue: draft.locationName',
    'initialValue: draft.locationAddress',
    'initialValue: draft.note',
]) {
    assertNotIncludes(
        completionSource,
        unstableCompletionPattern,
        `Mobile completion masih punya field tidak sinkron: ${unstableCompletionPattern}.`
    );
}

console.log('Mobile driver manifest audit OK: endpoints, payloads, multi-SJ, completion, and stable inputs verified.');
