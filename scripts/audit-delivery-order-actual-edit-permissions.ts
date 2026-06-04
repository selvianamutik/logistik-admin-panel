import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import { createDocument, deleteDocument } from '../src/lib/repositories/document-store';

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);

type ApiResponse = {
    error?: string;
};

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout setelah ${REQUEST_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function login(email: string, password: string) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
        },
        body: JSON.stringify({ email, password, scope: 'ADMIN' }),
    }, `login ${email}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login ${email} gagal (${response.status}): ${bodyText}`);
    }
    const cookie = response.headers.get('set-cookie') || '';
    assert(cookie, `Login ${email} tidak mengembalikan cookie`);
    return cookie.split(',').map(part => part.split(';')[0]).join('; ');
}

async function postInvalidActualEdit(cookieHeader: string) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/data`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/trips`,
            Cookie: cookieHeader,
        },
        body: JSON.stringify({
            entity: 'delivery-orders',
            action: 'update-surat-jalan-actual-cargo',
            data: {
                id: '',
                suratJalanRef: '',
                actualItems: [],
            },
        }),
    }, 'POST /api/data update-surat-jalan-actual-cargo');
    const bodyText = await response.text();
    const parsed = bodyText ? JSON.parse(bodyText) as ApiResponse : {};
    return { status: response.status, error: parsed.error || '' };
}

async function main() {
    const suffix = Date.now().toString().slice(-7);
    const password = `RoleAudit${suffix}!`;
    const passwordHash = await hashPassword(password);
    const users = [
        {
            id: `audit-role-armada-${suffix}`,
            email: `audit.armada.${suffix}@company.local`,
            role: 'ARMADA',
        },
        {
            id: `audit-role-finance-${suffix}`,
            email: `audit.finance.${suffix}@company.local`,
            role: 'FINANCE',
        },
    ];

    try {
        for (const user of users) {
            await createDocument({
                _id: user.id,
                _type: 'user',
                name: `Audit ${user.role} Role`,
                email: user.email,
                role: user.role,
                active: true,
                passwordHash,
            });
        }

        const armadaCookie = await login(users[0].email, password);
        const financeCookie = await login(users[1].email, password);
        const armadaResult = await postInvalidActualEdit(armadaCookie);
        const financeResult = await postInvalidActualEdit(financeCookie);

        assert(
            armadaResult.status === 400 && /Surat jalan tidak valid/i.test(armadaResult.error),
            `ARMADA harus lolos permission lalu kena validasi bisnis 400, got ${armadaResult.status}: ${armadaResult.error}`
        );
        assert(
            financeResult.status === 403 && financeResult.error === 'Forbidden',
            `FINANCE harus ditolak permission 403, got ${financeResult.status}: ${financeResult.error}`
        );

        console.log(JSON.stringify({
            ok: true,
            armada: armadaResult,
            finance: financeResult,
        }, null, 2));
    } finally {
        for (const user of users) {
            await deleteDocument(user.id, 'user').catch(() => undefined);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
