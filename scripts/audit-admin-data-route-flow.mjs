import fs from 'node:fs';
import path from 'node:path';

const routePath = path.join(process.cwd(), 'src/app/api/data/route.ts');
const source = fs.readFileSync(routePath, 'utf8');
const financeWorkflowPath = path.join(process.cwd(), 'src/lib/api/finance-workflows.ts');
const financeWorkflowSource = fs.readFileSync(financeWorkflowPath, 'utf8');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function extractBalancedBlock(label, startNeedle) {
    const startIndex = source.indexOf(startNeedle);
    assert(startIndex >= 0, `${label} tidak ditemukan.`);

    const openIndex = source.indexOf('{', startIndex);
    assert(openIndex >= 0, `Block ${label} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return source.slice(openIndex, index + 1);
        }
    }

    throw new Error(`Block ${label} tidak tertutup.`);
}

function assertActionMappedToUpdate(block, action) {
    assert(
        block.includes(`action === '${action}'`),
        `Action ${action} belum masuk getMutationPermissionAction sebagai update.`
    );
}

function assertDispatch(block, entity, action, handler) {
    const actionIndex = block.indexOf(`entity === '${entity}' && action === '${action}'`);
    assert(actionIndex >= 0, `Dispatch action ${entity}/${action} tidak ditemukan di POST /api/data.`);
    const handlerIndex = block.indexOf(handler, actionIndex);
    assert(handlerIndex >= 0, `Action ${entity}/${action} tidak mengarah ke ${handler}.`);

    const nextDeliveryOrderDispatchIndex = block.indexOf(`entity === '${entity}' && action ===`, actionIndex + 1);
    assert(
        nextDeliveryOrderDispatchIndex < 0 || handlerIndex < nextDeliveryOrderDispatchIndex,
        `Handler ${handler} untuk action ${entity}/${action} berada di luar block dispatch yang benar.`
    );
}

function extractSpecialPermissionBlock(block, action) {
    const marker = `entity === 'delivery-orders' && action === '${action}'`;
    const markerIndex = block.indexOf(marker);
    if (markerIndex < 0) return null;

    const ifStart = block.lastIndexOf('if', markerIndex);
    assert(ifStart >= 0, `Special permission ${action} tidak punya if block.`);
    const openIndex = block.indexOf('{', markerIndex);
    assert(openIndex >= 0, `Special permission ${action} tidak punya pembuka.`);

    let depth = 0;
    for (let index = openIndex; index < block.length; index += 1) {
        const char = block[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return block.slice(ifStart, index + 1);
        }
    }

    throw new Error(`Special permission ${action} tidak tertutup.`);
}

function assertSpecialRoles(block, action, expectedRoles) {
    const permissionBlock = extractSpecialPermissionBlock(block, action);
    assert(permissionBlock, `Special permission ${action} tidak ditemukan.`);

    for (const role of expectedRoles) {
        assert(
            permissionBlock.includes(`role === '${role}'`),
            `Special permission ${action} belum mengizinkan ${role}.`
        );
    }

    for (const role of ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) {
        if (!expectedRoles.includes(role)) {
            assert(
                !permissionBlock.includes(`role === '${role}'`),
                `Special permission ${action} tidak boleh mengizinkan ${role}.`
            );
        }
    }
}

const mutationPermissionBlock = extractBalancedBlock(
    'getMutationPermissionAction',
    'function getMutationPermissionAction'
);
const specialPermissionBlock = extractBalancedBlock(
    'hasSpecialMutationPermission',
    'function hasSpecialMutationPermission'
);
const postBlock = extractBalancedBlock('POST /api/data', 'export async function POST');

const deliveryOrderActions = [
    {
        action: 'set-status',
        handler: 'handleDeliveryOrderStatusUpdate',
        specialRoles: null,
    },
    {
        action: 'assign-trip-resources',
        handler: 'handleDeliveryOrderTripResourceAssign',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'append-cargo-items',
        handler: 'handleDeliveryOrderAppendCargoItems',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-cargo-item',
        handler: 'handleDeliveryOrderCargoItemUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'remove-cargo-item',
        handler: 'handleDeliveryOrderCargoItemRemove',
        specialRoles: ['OWNER', 'OPERASIONAL', 'ARMADA'],
    },
    {
        action: 'update-shipper-reference',
        handler: 'handleDeliveryOrderShipperReferenceUpdate',
        specialRoles: ['OWNER', 'OPERASIONAL', 'FINANCE'],
    },
    {
        action: 'reject-driver-status-request',
        handler: 'handleDeliveryOrderDriverStatusRequestReject',
        specialRoles: null,
    },
];

for (const item of deliveryOrderActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'delivery-orders', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );

    if (item.specialRoles) {
        assertSpecialRoles(specialPermissionBlock, item.action, item.specialRoles);
    } else {
        assert(
            !extractSpecialPermissionBlock(specialPermissionBlock, item.action),
            `Action ${item.action} seharusnya memakai permission module umum, bukan special role override.`
        );
    }
}

const freightNotaUpdateActions = [
    {
        action: 'update-with-items',
        handler: 'handleFreightNotaUpdate',
    },
    {
        action: 'update-pph23',
        handler: 'handleFreightNotaPph23Update',
    },
];

for (const item of freightNotaUpdateActions) {
    assertActionMappedToUpdate(mutationPermissionBlock, item.action);
    assertDispatch(postBlock, 'freight-notas', item.action, item.handler);
    assert(
        source.includes(item.handler),
        `Handler ${item.handler} belum di-import atau tidak dipakai di route.`
    );
}

assert(
    postBlock.includes("session.role === 'DRIVER'") &&
        postBlock.includes('Driver tidak diizinkan mengakses API admin'),
    'POST /api/data harus tetap menolak role DRIVER karena driver memakai route /api/driver.'
);

const hardCodedReceivableLegacyUpdates = financeWorkflowSource.match(
    /updateDocument\([\s\S]{0,220}buildReceivablePatch\([\s\S]{0,220}['"]invoice['"]\)/g
) || [];
assert(
    hardCodedReceivableLegacyUpdates.length === 0,
    'Mutasi piutang tidak boleh hard-code updateDocument(..., buildReceivablePatch(...), "invoice") karena invoice aktif memakai freightNota.'
);
assert(
    financeWorkflowSource.includes('function getReceivableDocumentType') &&
        financeWorkflowSource.includes('async function updateReceivableSnapshot'),
    'Finance workflow harus memakai helper updateReceivableSnapshot agar tipe dokumen piutang mengikuti snapshot.'
);

console.log(`Admin data route audit OK: ${deliveryOrderActions.length} delivery-order actions, ${freightNotaUpdateActions.length} freight-nota update actions, and receivable document-type guard verified.`);
