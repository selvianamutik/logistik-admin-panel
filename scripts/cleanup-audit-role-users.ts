import { loadEnvConfig } from '@next/env';
import { listDocumentsByFilter, updateDocument } from '../src/lib/repositories/document-store';
import type { User } from '../src/lib/types';

loadEnvConfig(process.cwd());

const dryRun = process.argv.includes('--dry-run');

function isAuditRoleUser(user: Pick<User, '_id' | 'email' | 'name'>) {
    const id = String(user._id || '').trim();
    const email = String(user.email || '').trim();
    const name = String(user.name || '').trim();

    return /^audit-role-/i.test(id)
        || /^audit\.(owner|operasional|finance|armada|driver)\.\d+\./i.test(email)
        || /^Audit (OWNER|OPERASIONAL|FINANCE|ARMADA|DRIVER) \d+/i.test(name);
}

async function main() {
    const users = await listDocumentsByFilter<User>('user', {});
    const auditUsers = (users || []).filter(isAuditRoleUser);
    const activeAuditUsers = auditUsers.filter(user => user.active !== false);

    if (!dryRun) {
        for (const user of activeAuditUsers) {
            await updateDocument(user._id, { active: false }, 'user');
        }
    }

    console.log(JSON.stringify({
        ok: true,
        dryRun,
        matched: auditUsers.length,
        disabled: dryRun ? 0 : activeAuditUsers.length,
        wouldDisable: dryRun ? activeAuditUsers.length : 0,
        users: activeAuditUsers.map(user => ({
            id: user._id,
            email: user.email,
            role: user.role,
        })),
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
