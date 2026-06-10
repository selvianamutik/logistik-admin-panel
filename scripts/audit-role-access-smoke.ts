import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import {
    createDocument,
    deleteDocument,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type { UserRole } from '../src/lib/types';
import type { SuratJalanDetailSnapshot, SuratJalanDocument } from '../src/lib/trip-document-types';

type InternalAuditRole = Extract<UserRole, 'OWNER' | 'OPERASIONAL' | 'FINANCE' | 'ARMADA'>;

type AuditUser = {
    id: string;
    email: string;
    name: string;
    role: UserRole;
};

type Session = AuditUser & {
    cookie: string;
};

type ApiResult<T = unknown> = {
    status: number;
    body: {
        data?: T;
        error?: string;
        [key: string]: unknown;
    };
};

const BASE_URL = (process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 45000);
const AUDIT_ID_PREFIX = 'audit-role-smoke-';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function auditStep(message: string) {
    console.log(`[audit:role-access-smoke] ${message}`);
}

function allowedFor(roles: InternalAuditRole[]) {
    return new Set<UserRole>(roles);
}

function sessionsByRole(sessions: Session[]) {
    return {
        owner: sessions.find(session => session.role === 'OWNER'),
        ops: sessions.find(session => session.role === 'OPERASIONAL'),
        finance: sessions.find(session => session.role === 'FINANCE'),
        armada: sessions.find(session => session.role === 'ARMADA'),
    };
}

async function fetchWithTimeout(url: string, init: RequestInit, label: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`${label} timeout ${REQUEST_TIMEOUT_MS} ms`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function readCookieHeader(response: Response) {
    const cookies = typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie') || ''];
    return cookies
        .flatMap(cookie => cookie.split(/,(?=[^;]+=[^;]+)/g))
        .map(cookie => cookie.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

async function login(user: AuditUser, password: string): Promise<Session> {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
        },
        body: JSON.stringify({ email: user.email, password, scope: 'ADMIN' }),
    }, `login ${user.role} ${user.email}`);
    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`Login ${user.email} gagal (${response.status}): ${bodyText}`);
    }
    const cookie = readCookieHeader(response);
    assert(cookie.includes('logistik-session='), `Login ${user.email} tidak mengembalikan cookie admin`);
    return { ...user, cookie };
}

async function expectDriverAdminLoginDenied(user: AuditUser, password: string) {
    const response = await fetchWithTimeout(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BASE_URL,
            Referer: `${BASE_URL}/login`,
        },
        body: JSON.stringify({ email: user.email, password, scope: 'ADMIN' }),
    }, 'login DRIVER ke admin');
    const body = await response.json().catch(() => ({})) as { error?: string };
    assert(response.status === 403, `DRIVER harus ditolak dari admin login, got ${response.status}`);
    assert(/driver/i.test(body.error || ''), `Pesan login DRIVER harus menjelaskan akun driver, got ${body.error || '-'}`);
}

async function fetchPage(session: Session, path: string) {
    return fetchWithTimeout(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: { Cookie: session.cookie },
        redirect: 'manual',
    }, `GET page ${path} as ${session.role}`);
}

function isRedirectTo(response: Response, targetPath: string) {
    const location = response.headers.get('location') || '';
    return [301, 302, 303, 307, 308].includes(response.status) && location.includes(targetPath);
}

async function expectPage(session: Session, path: string, allowed: boolean) {
    const response = await fetchPage(session, path);
    if (allowed) {
        assert(response.status === 200, `${session.role} harus bisa buka ${path}, got ${response.status}`);
        return;
    }
    assert(
        isRedirectTo(response, '/dashboard'),
        `${session.role} harus dialihkan dari ${path}, got ${response.status} -> ${response.headers.get('location') || '-'}`
    );
}

async function apiGet<T = Record<string, unknown>>(session: Session, path: string): Promise<ApiResult<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: { Cookie: session.cookie },
    }, `GET ${path} as ${session.role}`);
    const text = await response.text();
    const body = text ? JSON.parse(text) as ApiResult<T>['body'] : {};
    return { status: response.status, body };
}

async function apiPost<T = Record<string, unknown>>(
    session: Session,
    path: string,
    payload: unknown,
    options: { includeOrigin?: boolean; refererPath?: string } = {}
): Promise<ApiResult<T>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
    };
    if (options.includeOrigin !== false) {
        headers.Origin = BASE_URL;
        headers.Referer = `${BASE_URL}${options.refererPath || '/dashboard'}`;
    }

    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
    }, `POST ${path} as ${session.role}`);
    const text = await response.text();
    const body = text ? JSON.parse(text) as ApiResult<T>['body'] : {};
    return { status: response.status, body };
}

function expectStatus(result: ApiResult, expectedStatus: number, label: string) {
    assert(
        result.status === expectedStatus,
        `${label} harus status ${expectedStatus}, got ${result.status}: ${result.body.error || JSON.stringify(result.body)}`
    );
}

function expectNotForbidden(result: ApiResult, label: string) {
    assert(
        result.status !== 401 && result.status !== 403,
        `${label} tidak boleh tertahan permission, got ${result.status}: ${result.body.error || JSON.stringify(result.body)}`
    );
}

async function cleanupStaleSmokeUsers() {
    const users = await listDocumentsByFilter<{ _id: string }>('user', {});
    for (const user of users.filter(item => String(item._id || '').startsWith(AUDIT_ID_PREFIX))) {
        await deleteDocument(user._id, 'user').catch(() => undefined);
    }
}

async function createAuditUsers(passwordHash: string, suffix: string) {
    const specs: UserRole[] = ['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA', 'DRIVER'];
    const users: AuditUser[] = [];

    for (const role of specs) {
        const id = `${AUDIT_ID_PREFIX}${role.toLowerCase()}-${suffix}`;
        const user: AuditUser = {
            id,
            email: `audit.smoke.${role.toLowerCase()}.${suffix}@company.local`,
            name: `Audit Smoke ${role}`,
            role,
        };
        await createDocument({
            _id: id,
            _type: 'user',
            name: user.name,
            email: user.email,
            role: user.role,
            active: true,
            passwordHash,
        });
        users.push(user);
    }

    return users;
}

async function auditPageSmoke(sessions: Session[]) {
    auditStep('cek halaman wakil per area role');
    const rules = [
        { path: '/dashboard', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/orders', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/trips', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/invoices', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/bank-accounts', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/accounting/statements', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/inventory/items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/fleet/vehicles', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/settings/users', allowed: allowedFor(['OWNER']) },
    ];

    await Promise.all(
        sessions.flatMap(session => rules.map(rule =>
            expectPage(session, rule.path, rule.allowed.has(session.role))
        ))
    );

    return rules.length * sessions.length;
}

async function auditApiReadSmoke(sessions: Session[]) {
    auditStep('cek API read wakil modul sensitif');
    const rules = [
        { entity: 'users', allowed: allowedFor(['OWNER']) },
        { entity: 'delivery-orders', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'freight-notas', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'bank-accounts', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'chart-of-accounts', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { entity: 'warehouse-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'vehicles', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'audit-logs', allowed: allowedFor(['OWNER']) },
    ];

    await Promise.all(
        sessions.flatMap(session => rules.map(async rule => {
            const result = await apiGet(session, `/api/data?entity=${rule.entity}&pageSize=1`);
            if (rule.allowed.has(session.role)) {
                assert(result.status === 200, `${session.role} harus bisa baca ${rule.entity}, got ${result.status}: ${result.body.error || '-'}`);
            } else {
                expectStatus(result, 403, `${session.role} baca ${rule.entity}`);
            }
        }))
    );

    return rules.length * sessions.length;
}

async function auditDetailSmoke(sessions: Session[]) {
    auditStep('cek detail view-only dan pesan akses tidak kosong');
    const { owner, armada } = sessionsByRole(sessions);
    assert(owner && armada, 'Detail smoke butuh OWNER dan ARMADA.');

    const result = {
        suratJalanDetail: false,
        invoiceDetailBlockedForArmada: false,
    };

    const sjList = await apiGet<SuratJalanDocument[]>(owner, '/api/data?entity=surat-jalan&pageSize=1&sortField=tripDate&sortDir=desc');
    assert(sjList.status === 200, `OWNER harus bisa baca daftar SJ, got ${sjList.status}: ${sjList.body.error || '-'}`);
    const sj = Array.isArray(sjList.body.data) ? sjList.body.data[0] : undefined;
    if (sj?._id) {
        const detail = await apiGet<SuratJalanDetailSnapshot>(
            armada,
            `/api/data?entity=surat-jalan-detail&id=${encodeURIComponent(sj._id)}`
        );
        assert(detail.status === 200, `ARMADA harus bisa baca detail inti SJ, got ${detail.status}: ${detail.body.error || '-'}`);
        assert(detail.body.data?.suratJalanDocument?._id === sj._id, 'ARMADA membaca detail SJ yang salah.');
        assert(detail.body.data?.deliveryOrder?._id, 'Detail SJ ARMADA harus membawa data trip inti.');
        if (detail.body.data.deliveryOrder.customerRef) {
            const customerProducts = await apiGet(
                armada,
                `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: detail.body.data.deliveryOrder.customerRef, active: true }))}`
            );
            expectStatus(customerProducts, 403, 'ARMADA baca master barang customer pendukung SJ');
        }
        result.suratJalanDetail = true;
    } else {
        auditStep('lewati detail SJ karena data sample belum ada');
    }

    const invoiceList = await apiGet<Array<{ _id: string }>>(owner, '/api/data?entity=freight-notas&pageSize=1');
    assert(invoiceList.status === 200, `OWNER harus bisa baca daftar invoice, got ${invoiceList.status}: ${invoiceList.body.error || '-'}`);
    const invoice = Array.isArray(invoiceList.body.data) ? invoiceList.body.data[0] : undefined;
    if (invoice?._id) {
        await expectPage(armada, `/invoices/${encodeURIComponent(invoice._id)}`, false);
        result.invoiceDetailBlockedForArmada = true;
    } else {
        auditStep('lewati detail invoice blocked karena data sample belum ada');
    }

    return result;
}

async function auditMutationSmoke(sessions: Session[]) {
    auditStep('cek batas mutasi wakil finance/operasional/armada');
    const { ops, finance, armada } = sessionsByRole(sessions);
    assert(ops && finance && armada, 'Mutation smoke butuh OPERASIONAL, FINANCE, dan ARMADA.');

    const opsImport = await apiPost(ops, '/api/data-import', {
        action: 'preview',
        target: 'warehouse-items',
        mode: 'updateOnly',
        rows: [{ itemCode: '', name: '' }],
    }, { refererPath: '/settings/import-data' });
    expectNotForbidden(opsImport, 'OPERASIONAL preview import invalid');

    const financeImport = await apiPost(finance, '/api/data-import', {
        action: 'preview',
        target: 'warehouse-items',
        mode: 'updateOnly',
        rows: [{ itemCode: '', name: '' }],
    }, { refererPath: '/settings/import-data' });
    expectStatus(financeImport, 403, 'FINANCE preview import');

    const financePayment = await apiPost(finance, '/api/data', {
        entity: 'purchase-payments',
        action: 'record-payment',
        data: { purchaseRef: '', amount: 0 },
    }, { refererPath: '/inventory/purchases' });
    expectNotForbidden(financePayment, 'FINANCE record payment pembelian invalid');

    const opsPayment = await apiPost(ops, '/api/data', {
        entity: 'purchase-payments',
        action: 'record-payment',
        data: { purchaseRef: '', amount: 0 },
    }, { refererPath: '/inventory/purchases' });
    expectStatus(opsPayment, 403, 'OPERASIONAL record payment pembelian');

    const armadaActual = await apiPost(armada, '/api/data', {
        entity: 'delivery-orders',
        action: 'update-surat-jalan-actual-cargo',
        data: { id: '', suratJalanRef: '', actualItems: [] },
    }, { refererPath: '/trips' });
    expectNotForbidden(armadaActual, 'ARMADA update aktual SJ invalid');

    const financeActual = await apiPost(finance, '/api/data', {
        entity: 'delivery-orders',
        action: 'update-surat-jalan-actual-cargo',
        data: { id: '', suratJalanRef: '', actualItems: [] },
    }, { refererPath: '/trips' });
    expectStatus(financeActual, 403, 'FINANCE update aktual SJ');

    const armadaDriverAccounts = await apiGet(armada, '/api/driver/accounts?countOnly=1');
    assert(armadaDriverAccounts.status === 200, `ARMADA harus bisa lihat akun driver, got ${armadaDriverAccounts.status}`);

    const opsDriverAccounts = await apiGet(ops, '/api/driver/accounts?countOnly=1');
    expectStatus(opsDriverAccounts, 403, 'OPERASIONAL baca akun driver mobile');

    return 8;
}

async function cleanupUsers(userIds: string[]) {
    for (const userId of [...userIds].reverse()) {
        await deleteDocument(userId, 'user').catch(() => undefined);
    }
}

async function main() {
    const startedAt = Date.now();
    const suffix = `${Date.now().toString().slice(-7)}${Math.random().toString(36).slice(2, 5)}`;
    const password = `RoleSmoke${suffix}!`;
    const passwordHash = await hashPassword(password);
    const createdUserIds: string[] = [];
    let auditFailed = false;

    try {
        await cleanupStaleSmokeUsers();

        auditStep('buat user audit sementara: owner, operasional, finance, armada, driver');
        const users = await createAuditUsers(passwordHash, suffix);
        createdUserIds.push(...users.map(user => user.id));

        const driverUser = users.find(user => user.role === 'DRIVER');
        assert(driverUser, 'User DRIVER audit tidak terbentuk.');
        await expectDriverAdminLoginDenied(driverUser, password);

        auditStep('login role internal lewat API auth asli');
        const sessions = await Promise.all(
            users
                .filter((user): user is AuditUser & { role: InternalAuditRole } => user.role !== 'DRIVER')
                .map(user => login(user, password))
        );

        const pageChecks = await auditPageSmoke(sessions);
        const apiReadChecks = await auditApiReadSmoke(sessions);
        const detailSmoke = await auditDetailSmoke(sessions);
        const mutationChecks = await auditMutationSmoke(sessions);

        console.log(JSON.stringify({
            ok: true,
            durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
            users: {
                owner: 1,
                operasional: 1,
                finance: 1,
                armada: 1,
                driverAdminDenied: true,
            },
            checks: {
                pageChecks,
                apiReadChecks,
                mutationChecks,
                detailSmoke,
            },
        }, null, 2));
    } catch (error) {
        auditFailed = true;
        throw error;
    } finally {
        await cleanupUsers(createdUserIds);
        if (auditFailed) {
            await cleanupStaleSmokeUsers();
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
