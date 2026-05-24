import { loadScriptEnv } from './_env';

loadScriptEnv();

import { getAllDocuments, updateDocument } from '../src/lib/repositories/document-store';

type UserRow = {
    _id: string;
    email?: string;
};

const DRIVER_PASSWORD_HASH = '$2b$10$O9./WCIZQXNxhcLle.E9n.eJh35t9ej64F8sx9b2wKkCn93sTLmh.';

async function main() {
    const users = await getAllDocuments<UserRow>('user');
    const imam = users.find(user => (user.email || '').toLowerCase() === 'imam@driver');
    const patches: Array<[string, Record<string, string>]> = [
        ['user-driver-001', { driverRef: 'drv-001', driverName: 'Agus Santoso', passwordHash: DRIVER_PASSWORD_HASH }],
        ['user-driver-002', { email: 'driver.budi@company.local', driverRef: 'drv-002', driverName: 'Budi Hartono', passwordHash: DRIVER_PASSWORD_HASH }],
        ['user-driver-003', { driverRef: 'drv-003', driverName: 'Catur Wibowo', passwordHash: DRIVER_PASSWORD_HASH }],
        ['user-driver-005', { driverRef: 'drv-005', driverName: 'Eko Prasetyo', passwordHash: DRIVER_PASSWORD_HASH }],
    ];

    if (imam?._id) {
        patches.push([imam._id, { driverRef: 'drv-007', driverName: "Imam Syafi'i", passwordHash: DRIVER_PASSWORD_HASH }]);
    }

    for (const [id, patch] of patches) {
        await updateDocument(id, patch, 'user');
    }

    console.log(JSON.stringify(patches.map(([id, patch]) => ({ id, ...patch })), null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
