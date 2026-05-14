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
const appPath = path.join(appDir, 'apps/driver_app/lib/src/app.dart');
const orderWorkflowPath = path.join(appDir, 'src/lib/api/order-workflows.ts');
const driverShipperReferencesRoutePath = path.join(
    appDir,
    'src/app/api/driver/delivery-orders/shipper-references/route.ts'
);

const manifestSource = fs.readFileSync(manifestPath, 'utf8');
const serviceSource = fs.readFileSync(servicePath, 'utf8');
const completionSource = fs.readFileSync(completionPath, 'utf8');
const appSource = fs.readFileSync(appPath, 'utf8');
const orderWorkflowSource = fs.readFileSync(orderWorkflowPath, 'utf8');
const driverShipperReferencesRouteSource = fs.readFileSync(driverShipperReferencesRoutePath, 'utf8');

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
    '/api/driver/delivery-orders/batch-status',
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
    "'selectedSuratJalanRefs'",
    "'targetSuratJalanRefs'",
    "'podReceiverName'",
    "'podReceivedDate'",
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
    'Satu trip bisa punya banyak SJ dan barang. Edit nomor langsung; hapus SJ tambahan sebelum approval/final.',
    'Copy mobile manifest harus menjelaskan multi-SJ, edit SJ, hapus SJ, dan multi-barang.'
);
assertIncludes(
    manifestSource,
    "label: const Text('Tambah SJ')",
    'Mobile manifest harus tetap bisa menambah banyak SJ.'
);
assertIncludes(
    manifestSource,
    "label: const Text('Hapus SJ')",
    'Mobile manifest harus menyediakan aksi eksplisit untuk menghapus SJ sebelum approval/final.'
);
assertIncludes(
    manifestSource,
    'onRemoveGroup: _groups.length > 1',
    'Mobile manifest harus mengizinkan hapus SJ tambahan tanpa mengizinkan submit tanpa nomor SJ.'
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
assertIncludes(
    completionSource,
    "labelText: 'Nama Penerima POD'",
    'Mobile completion harus meminta nama penerima POD sebelum finalisasi.'
);
assertIncludes(
    completionSource,
    "labelText: 'Tanggal Terima POD'",
    'Mobile completion harus meminta tanggal terima POD sebelum finalisasi.'
);
assertIncludes(
    completionSource,
    '_selectedSuratJalanDocumentIds',
    'Mobile completion harus mengirim pilihan batch SJ seperti admin.'
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
assertIncludes(
    serviceSource,
    'updateBatchSuratJalanStatus',
    'Mobile service harus bisa update status SJ batch seperti admin/portal driver.'
);
assertNotIncludes(
    appSource,
    '_requestLocationAccessOnLaunch',
    'Mobile app tidak boleh memblokir login hanya karena izin lokasi belum siap; izin lokasi dicek saat tracking berjalan.'
);
assertNotIncludes(
    appSource,
    'Geolocator.requestPermission()',
    'Mobile app root tidak boleh meminta izin lokasi sebelum driver login.'
);
assertIncludes(
    orderWorkflowSource,
    'autoAssignOrderCargoFromTripPlan',
    'Backend create DO driver harus otomatis memasukkan item order pending saat trip plan mobile hanya mengirim SJ.'
);
assertIncludes(
    orderWorkflowSource,
    'Trip ini memakai item order/resi. Dari aplikasi driver, isi 1 nomor SJ utama dulu',
    'Backend create DO driver harus menolak multi-SJ tanpa mapping barang pada mode barang mengikuti order/resi.'
);
assertIncludes(
    orderWorkflowSource,
    'No. SJ pengirim ${duplicateDeliveryOrderShipperReference} ditulis lebih dari sekali.',
    'Backend create DO harus menolak nomor SJ duplikat dalam payload driver/admin.'
);
assertIncludes(
    orderWorkflowSource,
    'shipperReferenceKey: autoAssignedShipperReference._key',
    'Auto-selected item order harus terhubung ke SJ driver supaya finalisasi batch tidak kosong.'
);
assertIncludes(
    orderWorkflowSource,
    'getActualDropTotalMismatchMessage(actualCargoByDoItemId, pendingDriverActualDropPoints,',
    'Backend driver approval harus menolak draft aktual jika total titik realisasi tidak sama dengan total barang.'
);
assertIncludes(
    orderWorkflowSource,
    "dropLabel = options?.billableOnly ? 'titik drop terkirim' : 'titik realisasi'",
    'Backend finalisasi harus punya guard mismatch berat aktual barang vs titik realisasi.'
);
assertIncludes(
    orderWorkflowSource,
    'billableOnly: true',
    'Backend batch SJ/approval driver harus membandingkan item aktual dengan titik drop terkirim tanpa memblok hold/return.'
);
assertIncludes(
    driverShipperReferencesRouteSource,
    'removeLinkedCargoItemsForRemovedShipperReferences: true',
    'Endpoint driver hapus/sync SJ harus meminta workflow menghapus barang terkait setelah validasi.'
);
assertIncludes(
    orderWorkflowSource,
    'getPendingShipperReferenceMutationMessage',
    'Workflow driver harus hanya mengunci SJ yang sedang pending approval, bukan seluruh manifest partial.'
);
assertIncludes(
    orderWorkflowSource,
    'getDeliveryOrderBillingMutationLockMessage',
    'Workflow driver harus mengunci perubahan SJ/barang saat DO sudah masuk invoice atau borongan.'
);
assertNotIncludes(
    driverShipperReferencesRouteSource,
    'handleDeliveryOrderCargoItemRemove',
    'Endpoint driver SJ tidak boleh menghapus barang sebelum validasi workflow selesai.'
);
assertIncludes(
    orderWorkflowSource,
    'itemsLinkedToRemovedReferences',
    'Workflow update SJ harus menghitung barang terkait SJ yang dihapus.'
);
assertIncludes(
    orderWorkflowSource,
    'removeLinkedCargoItemsForRemovedShipperReferences',
    'Workflow update SJ harus punya mode aman untuk hapus SJ driver beserta barang terkait.'
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

for (const source of [
    { name: 'manifest', value: manifestSource },
    { name: 'completion', value: completionSource },
]) {
    assertNotIncludes(
        source.value,
        "ValueKey('keyboard-open')",
        `Mobile ${source.name} tidak boleh menyembunyikan submit saat keyboard terbuka.`
    );
}

console.log('Mobile driver manifest audit OK: endpoints, payloads, multi-SJ, completion, and stable inputs verified.');
