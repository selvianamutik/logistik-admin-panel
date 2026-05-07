import type { User } from '@/lib/types';

import { getDocumentById, listDocumentsByFilter, updateDocument } from './document-store';

export type LoginUser = User & { _rev?: string };

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

export async function getUserById(id: string) {
    return getDocumentById<User>(id, 'user');
}

export async function findActiveUserByEmail(email: string): Promise<LoginUser | null> {
    const normalizedEmail = normalizeEmail(email);
    const users = await listDocumentsByFilter<LoginUser>('user', {
        active: true,
        email: normalizedEmail,
    });
    return users[0] || null;
}

export async function updateUserLoginState(
    id: string,
    updates: {
        lastLoginAt: string;
        passwordHash?: string;
    }
) {
    return updateDocument<User>(id, {
        lastLoginAt: updates.lastLoginAt,
        ...(updates.passwordHash ? { passwordHash: updates.passwordHash } : {}),
    }, 'user');
}
