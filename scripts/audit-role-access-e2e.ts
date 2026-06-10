import { loadScriptEnv } from './_env';

loadScriptEnv();

import { hashPassword } from '../src/lib/auth';
import { createDocument, deleteDocument } from '../src/lib/repositories/document-store';
import type { UserRole, WarehouseItem } from '../src/lib/types';
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
const REQUEST_TIMEOUT_MS = Number(process.env.AUDIT_REQUEST_TIMEOUT_MS || 60000);

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function auditStep(message: string) {
    console.log(`[audit:role-access-e2e] ${message}`);
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function createAuditUsers(passwordHash: string, suffix: string) {
    const specs: Array<{ role: UserRole; count: number }> = [
        { role: 'OWNER', count: 1 },
        { role: 'OPERASIONAL', count: 2 },
        { role: 'FINANCE', count: 2 },
        { role: 'ARMADA', count: 2 },
        { role: 'DRIVER', count: 1 },
    ];
    const users: AuditUser[] = [];

    for (const spec of specs) {
        for (let index = 1; index <= spec.count; index += 1) {
            const id = `audit-role-${spec.role.toLowerCase()}-${index}-${suffix}`;
            const user: AuditUser = {
                id,
                email: `audit.${spec.role.toLowerCase()}.${index}.${suffix}@company.local`,
                name: `Audit ${spec.role} ${index}`,
                role: spec.role,
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
    }

    return users;
}

function sessionsByRole(sessions: Session[]) {
    return {
        owner: sessions.filter(session => session.role === 'OWNER'),
        ops: sessions.filter(session => session.role === 'OPERASIONAL'),
        finance: sessions.filter(session => session.role === 'FINANCE'),
        armada: sessions.filter(session => session.role === 'ARMADA'),
    };
}

function allowedFor(roles: InternalAuditRole[]) {
    return new Set<UserRole>(roles);
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await worker(item);
        }
    });
    await Promise.all(workers);
}

async function auditPageMatrix(sessions: Session[]) {
    auditStep('cek semua halaman menu admin via proxy untuk setiap role');
    const pageRules = [
        { path: '/dashboard', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/orders', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/orders/new', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/trips', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/delivery-orders', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/surat-jalan', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/driver-vouchers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/driver-vouchers/new', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/expenses', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/expenses/new', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/fleet/vehicles', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/fleet/vehicles/new', allowed: allowedFor(['OWNER', 'ARMADA']) },
        { path: '/fleet/drivers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/fleet/drivers/skors', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/fleet/maintenance', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/fleet/tires', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/fleet/incidents', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/suppliers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/inventory', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/inventory/items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/inventory/purchases', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/inventory/purchases/new', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/inventory/material-usage', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/inventory/stock-recap', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/invoices', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/invoices/new', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/bank-accounts', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/accounting/statements', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/accounting/journals', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/accounting/ledger', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/accounting/accounts', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { path: '/employees', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/attendance', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/customers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/customers/new', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/trip-rates', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/services', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { path: '/expense-categories', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { path: '/settings/profile', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/settings/password', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { path: '/settings/company', allowed: allowedFor(['OWNER']) },
        { path: '/settings/import-data', allowed: allowedFor(['OWNER', 'OPERASIONAL']) },
        { path: '/settings/users', allowed: allowedFor(['OWNER']) },
        { path: '/settings/audit-logs', allowed: allowedFor(['OWNER']) },
        { path: '/borongan', allowed: allowedFor(['OWNER']) },
        { path: '/borongan/new', allowed: allowedFor(['OWNER']) },
    ];

    await runWithConcurrency(
        sessions.flatMap(session => pageRules.map(rule => ({ session, rule }))),
        10,
        async ({ session, rule }) => {
            await expectPage(session, rule.path, rule.allowed.has(session.role));
        }
    );
}

async function auditApiReadMatrix(sessions: Session[]) {
    auditStep('cek baca data API langsung per role dan per module');
    const readRules = [
        { entity: 'users', allowed: allowedFor(['OWNER']) },
        { entity: 'employees', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'employee-attendance-records', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'suppliers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'supplier-item-prices', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'warehouse-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'stock-movements', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'purchases', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'purchase-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'purchase-payments', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'chart-of-accounts', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { entity: 'journal-entries', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { entity: 'journal-lines', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { entity: 'accounting-periods', allowed: allowedFor(['OWNER', 'FINANCE']) },
        { entity: 'customers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-products', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-billing-rates', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-recipients', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-pickups', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'trip-route-rates', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'services', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'expense-categories', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'drivers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'orders', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'order-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'delivery-orders', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'delivery-order-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'trip-records', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'surat-jalan', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'surat-jalan-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'surat-jalan-records', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'surat-jalan-record-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'tracking-logs', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']) },
        { entity: 'invoices', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'invoice-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'freight-notas', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'freight-nota-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'payments', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-receipts', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'customer-overpayment-refunds', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'invoice-adjustments', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'expenses', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'vehicles', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'maintenances', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'tire-events', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'tire-history-logs', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'incidents', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'incident-action-logs', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'incident-settlement-lines', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'bank-accounts', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'bank-transactions', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'driver-vouchers', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'driver-voucher-items', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'driver-voucher-disbursements', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']) },
        { entity: 'driver-scores', allowed: allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']) },
        { entity: 'audit-logs', allowed: allowedFor(['OWNER']) },
        { entity: 'driver-borongans', allowed: allowedFor(['OWNER']) },
        { entity: 'driver-borongan-items', allowed: allowedFor(['OWNER']) },
        { entity: 'driver-borogan-items', allowed: allowedFor(['OWNER']) },
    ];

    await runWithConcurrency(
        sessions.flatMap(session => readRules.map(rule => ({ session, rule }))),
        10,
        async ({ session, rule }) => {
            const result = await apiGet(session, `/api/data?entity=${rule.entity}&pageSize=1`);
            if (rule.allowed.has(session.role)) {
                assert(result.status === 200, `${session.role} harus bisa baca ${rule.entity}, got ${result.status}: ${result.body.error || '-'}`);
            } else {
                expectStatus(result, 403, `${session.role} baca ${rule.entity}`);
            }
        }
    );
}

async function auditDetailPageProxyMatrix(sessions: Session[]) {
    auditStep('cek halaman detail langsung via proxy untuk role yang boleh dan tidak boleh');
    const { owner } = sessionsByRole(sessions);
    assert(owner.length >= 1, 'Audit detail page proxy butuh OWNER.');

    const detailRules: Array<{ label: string; path: string; allowed: Set<UserRole> }> = [];
    const addDetailRule = async (
        label: string,
        entity: string,
        buildPath: (row: Record<string, unknown>) => string,
        allowed: Set<UserRole>,
        urlSuffix = 'pageSize=1'
    ) => {
        const separator = urlSuffix ? '&' : '';
        const result = await apiGet<Record<string, unknown>[]>(owner[0], `/api/data?entity=${entity}${separator}${urlSuffix}`);
        assert(result.status === 200, `OWNER harus bisa ambil sample ${label}, got ${result.status}: ${result.body.error || '-'}`);
        const row = Array.isArray(result.body.data) ? result.body.data[0] : undefined;
        if (!row?._id) {
            auditStep(`lewati detail ${label} karena sample ${entity} belum ada`);
            return;
        }
        detailRules.push({ label, path: buildPath(row), allowed });
    };

    await addDetailRule('Order', 'orders', row => `/orders/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL']));
    await addDetailRule('Trip', 'delivery-orders', row => `/trips/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']));
    await addDetailRule('Delivery Order', 'delivery-orders', row => `/delivery-orders/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']));
    await addDetailRule('Surat Jalan', 'surat-jalan', row => `/surat-jalan/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE', 'ARMADA']));
    await addDetailRule('Customer', 'customers', row => `/customers/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Supplier', 'suppliers', row => `/suppliers/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Barang Gudang', 'warehouse-items', row => `/inventory/items/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Pembelian', 'purchases', row => `/inventory/purchases/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Invoice', 'freight-notas', row => `/invoices/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Rekening', 'bank-accounts', row => `/bank-accounts/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Uang Jalan Trip', 'driver-vouchers', row => `/driver-vouchers/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'FINANCE']));
    await addDetailRule('Kendaraan', 'vehicles', row => `/fleet/vehicles/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']));
    await addDetailRule('Edit Kendaraan', 'vehicles', row => `/fleet/vehicles/${encodeURIComponent(String(row._id))}/edit`, allowedFor(['OWNER', 'ARMADA']));
    await addDetailRule('Supir', 'drivers', row => `/fleet/drivers/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']));
    await addDetailRule('Ban', 'tire-events', row => `/fleet/tires/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']));
    await addDetailRule('Insiden', 'incidents', row => `/fleet/incidents/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER', 'OPERASIONAL', 'ARMADA']));
    await addDetailRule('Borongan', 'driver-borongans', row => `/borongan/${encodeURIComponent(String(row._id))}`, allowedFor(['OWNER']));

    await runWithConcurrency(
        sessions.flatMap(session => detailRules.map(rule => ({ session, rule }))),
        8,
        async ({ session, rule }) => {
            await expectPage(session, rule.path, rule.allowed.has(session.role));
        }
    );

    return {
        checked: detailRules.map(rule => rule.label),
    };
}

async function auditArmadaSuratJalanDetailFlow(sessions: Session[]) {
    auditStep('cek Armada bisa lihat detail SJ meskipun master customer dibatasi');
    const { owner, armada } = sessionsByRole(sessions);
    assert(owner.length >= 1 && armada.length >= 2, 'Audit detail SJ butuh 1 OWNER dan 2 ARMADA.');

    const listResult = await apiGet<SuratJalanDocument[]>(owner[0], '/api/data?entity=surat-jalan&pageSize=1&sortField=tripDate&sortDir=desc');
    assert(listResult.status === 200, `OWNER harus bisa baca daftar SJ, got ${listResult.status}: ${listResult.body.error || '-'}`);
    const sample = Array.isArray(listResult.body.data) ? listResult.body.data[0] : undefined;
    if (!sample?._id) {
        auditStep('lewati detail SJ Armada karena belum ada data Surat Jalan di database audit');
        return { checked: false };
    }

    const detailResult = await apiGet<SuratJalanDetailSnapshot>(
        armada[0],
        `/api/data?entity=surat-jalan-detail&id=${encodeURIComponent(sample._id)}`
    );
    assert(
        detailResult.status === 200,
        `ARMADA harus bisa baca detail inti SJ ${sample._id}, got ${detailResult.status}: ${detailResult.body.error || '-'}`
    );
    assert(detailResult.body.data?.suratJalanDocument?._id === sample._id, 'ARMADA membaca detail SJ yang salah.');
    assert(detailResult.body.data?.deliveryOrder?._id, 'Detail SJ ARMADA harus membawa data trip inti.');

    const deliveryOrderRef = detailResult.body.data.deliveryOrder._id;
    const itemResult = await apiGet(
        armada[1],
        `/api/data?entity=delivery-order-items&filter=${encodeURIComponent(JSON.stringify({ deliveryOrderRef }))}`
    );
    assert(itemResult.status === 200, `ARMADA kedua harus bisa baca item muatan SJ, got ${itemResult.status}: ${itemResult.body.error || '-'}`);

    if (detailResult.body.data.deliveryOrder.customerRef) {
        const customerProductResult = await apiGet(
            armada[0],
            `/api/data?entity=customer-products&filter=${encodeURIComponent(JSON.stringify({ customerRef: detailResult.body.data.deliveryOrder.customerRef, active: true }))}`
        );
        expectStatus(customerProductResult, 403, 'ARMADA baca master barang customer pendukung SJ');
    }

    return { checked: true, suratJalanRef: sample._id };
}

async function auditRoleLimitedDetailSupportingData(sessions: Session[]) {
    auditStep('cek detail view-only tetap bisa baca data inti saat data pendukung dibatasi');
    const { owner, finance, armada, ops } = sessionsByRole(sessions);
    assert(owner.length >= 1 && finance.length >= 1 && armada.length >= 1 && ops.length >= 1, 'Audit detail role-limited butuh OWNER, FINANCE, ARMADA, dan OPERASIONAL.');

    const result = {
        customerDetail: { checked: false },
        incidentDetail: { checked: false },
        driverDetail: { checked: false },
        orderDetail: { checked: false },
    } as Record<string, Record<string, unknown>>;

    const customerList = await apiGet<Array<{ _id: string }>>(owner[0], '/api/data?entity=customers&pageSize=1');
    assert(customerList.status === 200, `OWNER harus bisa baca customer, got ${customerList.status}: ${customerList.body.error || '-'}`);
    const customer = Array.isArray(customerList.body.data) ? customerList.body.data[0] : undefined;
    if (customer?._id) {
        const financeCustomer = await apiGet(finance[0], `/api/data?entity=customers&id=${encodeURIComponent(customer._id)}`);
        assert(financeCustomer.status === 200, `FINANCE harus bisa baca inti customer, got ${financeCustomer.status}: ${financeCustomer.body.error || '-'}`);
        const financeServices = await apiGet(finance[0], '/api/data?entity=services&pageSize=1');
        expectStatus(financeServices, 403, 'FINANCE baca master jenis armada pendukung customer');
        result.customerDetail = { checked: true, customerRef: customer._id };
    } else {
        auditStep('lewati detail Customer karena belum ada customer di database audit');
    }

    const incidentList = await apiGet<Array<{ _id: string }>>(owner[0], '/api/data?entity=incidents&pageSize=1&sortField=dateTime&sortDir=desc');
    assert(incidentList.status === 200, `OWNER harus bisa baca insiden, got ${incidentList.status}: ${incidentList.body.error || '-'}`);
    const incident = Array.isArray(incidentList.body.data) ? incidentList.body.data[0] : undefined;
    if (incident?._id) {
        const armadaIncident = await apiGet(armada[0], `/api/data?entity=incidents&id=${encodeURIComponent(incident._id)}`);
        assert(armadaIncident.status === 200, `ARMADA harus bisa baca inti insiden, got ${armadaIncident.status}: ${armadaIncident.body.error || '-'}`);
        const armadaWarehouseItems = await apiGet(armada[0], '/api/data?entity=warehouse-items&pageSize=1');
        expectStatus(armadaWarehouseItems, 403, 'ARMADA baca master barang gudang pendukung insiden');
        result.incidentDetail = { checked: true, incidentRef: incident._id };
    } else {
        auditStep('lewati detail Insiden karena belum ada insiden di database audit');
    }

    const driverList = await apiGet<Array<{ _id: string }>>(owner[0], '/api/data?entity=drivers&pageSize=1');
    assert(driverList.status === 200, `OWNER harus bisa baca supir, got ${driverList.status}: ${driverList.body.error || '-'}`);
    const driver = Array.isArray(driverList.body.data) ? driverList.body.data[0] : undefined;
    if (driver?._id) {
        const opsDriver = await apiGet(ops[0], `/api/data?entity=drivers&id=${encodeURIComponent(driver._id)}`);
        assert(opsDriver.status === 200, `OPERASIONAL harus bisa baca inti supir, got ${opsDriver.status}: ${opsDriver.body.error || '-'}`);
        const opsDriverScores = await apiGet(ops[0], `/api/data?entity=driver-scores&filter=${encodeURIComponent(JSON.stringify({ driverRef: driver._id }))}&pageSize=1`);
        assert(opsDriverScores.status === 200, `OPERASIONAL harus bisa baca scoring supir, got ${opsDriverScores.status}: ${opsDriverScores.body.error || '-'}`);
        const opsDriverAccounts = await apiGet(ops[0], `/api/driver/accounts?driverRefs=${encodeURIComponent(driver._id)}`);
        expectStatus(opsDriverAccounts, 403, 'OPERASIONAL baca akun mobile pendukung detail supir');
        result.driverDetail = { checked: true, driverRef: driver._id };
    } else {
        auditStep('lewati detail Supir karena belum ada supir di database audit');
    }

    const orderList = await apiGet<Array<{ _id: string }>>(owner[0], '/api/data?entity=orders&pageSize=1&sortField=date&sortDir=desc');
    assert(orderList.status === 200, `OWNER harus bisa baca order, got ${orderList.status}: ${orderList.body.error || '-'}`);
    const order = Array.isArray(orderList.body.data) ? orderList.body.data[0] : undefined;
    if (order?._id) {
        const armadaOrder = await apiGet(armada[0], `/api/data?entity=orders&id=${encodeURIComponent(order._id)}`);
        assert(armadaOrder.status === 200, `ARMADA harus bisa baca inti order via API, got ${armadaOrder.status}: ${armadaOrder.body.error || '-'}`);
        const orderItems = await apiGet(armada[0], `/api/data?entity=order-items&filter=${encodeURIComponent(JSON.stringify({ orderRef: order._id }))}&pageSize=1`);
        assert(orderItems.status === 200, `ARMADA harus bisa baca item order, got ${orderItems.status}: ${orderItems.body.error || '-'}`);
        const freightItems = await apiGet(armada[0], '/api/data?entity=freight-nota-items&pageSize=1');
        expectStatus(freightItems, 403, 'ARMADA baca invoice pendukung detail order');
        result.orderDetail = { checked: true, orderRef: order._id };
    } else {
        auditStep('lewati detail Order karena belum ada order di database audit');
    }

    return result;
}

async function auditWarehouseTwoMemberFlow(sessions: Session[], suffix: string, createdItemIds: string[]) {
    auditStep('cek barang gudang dibuat anggota Operasional A, diubah Operasional B, dilihat role yang berhak');
    const { ops, finance, armada, owner } = sessionsByRole(sessions);
    assert(ops.length >= 2 && finance.length >= 2 && armada.length >= 2 && owner.length >= 1, 'Audit butuh 2 user OPS/FINANCE/ARMADA dan 1 OWNER.');

    const itemCode = `AUDROLE-${suffix}`;
    const createResult = await apiPost<WarehouseItem>(ops[0], '/api/data', {
        entity: 'warehouse-items',
        data: {
            itemCode,
            name: `Audit Role Item ${suffix}`,
            category: 'Audit Role',
            unit: 'PCS',
            trackingMode: 'STANDARD',
            minStockQty: 0,
            defaultPurchasePrice: 12000,
            notes: 'Dibuat Operasional A',
            active: true,
        },
    }, { refererPath: '/inventory/items' });
    assert(createResult.status === 200, `Operasional A harus bisa membuat barang gudang, got ${createResult.status}: ${createResult.body.error || JSON.stringify(createResult.body)}`);
    const createdItem = createResult.body.data;
    assert(createdItem?._id, 'Create barang gudang tidak mengembalikan id.');
    createdItemIds.push(createdItem._id);

    const updateResult = await apiPost<WarehouseItem>(ops[1], '/api/data', {
        entity: 'warehouse-items',
        action: 'update',
        data: {
            id: createdItem._id,
            updates: {
                notes: 'Diubah Operasional B',
            },
        },
    }, { refererPath: '/inventory/items' });
    assert(updateResult.status === 200, `Operasional B harus bisa update barang Operasional A, got ${updateResult.status}: ${updateResult.body.error || JSON.stringify(updateResult.body)}`);

    for (const session of [owner[0], ops[0], ops[1], finance[0], finance[1]]) {
        const readResult = await apiGet<WarehouseItem>(session, `/api/data?entity=warehouse-items&id=${encodeURIComponent(createdItem._id)}`);
        assert(readResult.status === 200, `${session.role} ${session.email} harus bisa lihat barang audit, got ${readResult.status}: ${readResult.body.error || '-'}`);
        assert(readResult.body.data?._id === createdItem._id, `${session.role} membaca barang yang salah.`);
        assert(readResult.body.data?.notes === 'Diubah Operasional B', `${session.role} harus melihat update dari anggota Operasional B.`);
    }

    for (const session of armada) {
        const readResult = await apiGet<WarehouseItem>(session, `/api/data?entity=warehouse-items&id=${encodeURIComponent(createdItem._id)}`);
        expectStatus(readResult, 403, `${session.role} ${session.email} baca master barang`);
    }

    const financeUpdate = await apiPost<WarehouseItem>(finance[0], '/api/data', {
        entity: 'warehouse-items',
        action: 'update',
        data: {
            id: createdItem._id,
            updates: { notes: 'Finance tidak boleh update' },
        },
    }, { refererPath: '/inventory/items' });
    expectStatus(financeUpdate, 403, 'FINANCE update barang gudang');

    const armadaCreate = await apiPost<WarehouseItem>(armada[0], '/api/data', {
        entity: 'warehouse-items',
        data: {
            itemCode: `${itemCode}-A`,
            name: 'Armada tidak boleh buat master barang',
            unit: 'PCS',
            trackingMode: 'STANDARD',
            active: true,
        },
    }, { refererPath: '/inventory/items' });
    expectStatus(armadaCreate, 403, 'ARMADA create barang gudang');
}

async function auditMutationBoundaries(sessions: Session[]) {
    auditStep('cek mutasi API conditional per role');
    const { ops, finance, armada, owner } = sessionsByRole(sessions);

    const dataImportOps = await apiPost(ops[0], '/api/data-import', {
        action: 'preview',
        target: 'warehouse-items',
        mode: 'updateOnly',
        rows: [{ itemCode: '', name: '' }],
    }, { refererPath: '/settings/import-data' });
    expectNotForbidden(dataImportOps, 'OPERASIONAL preview import');

    for (const session of [finance[0], armada[0]]) {
        const result = await apiPost(session, '/api/data-import', {
            action: 'preview',
            target: 'warehouse-items',
            mode: 'updateOnly',
            rows: [{ itemCode: '', name: '' }],
        }, { refererPath: '/settings/import-data' });
        expectStatus(result, 403, `${session.role} preview import`);
    }

    const receiveByOps = await apiPost(ops[0], '/api/data', {
        entity: 'purchases',
        action: 'receive',
        data: { id: '', receivedDate: '2026-06-05' },
    }, { refererPath: '/inventory/purchases' });
    expectNotForbidden(receiveByOps, 'OPERASIONAL receive pembelian invalid');

    const receiveByFinance = await apiPost(finance[0], '/api/data', {
        entity: 'purchases',
        action: 'receive',
        data: { id: '', receivedDate: '2026-06-05' },
    }, { refererPath: '/inventory/purchases' });
    expectStatus(receiveByFinance, 403, 'FINANCE receive pembelian');

    const paymentByFinance = await apiPost(finance[0], '/api/data', {
        entity: 'purchase-payments',
        action: 'record-payment',
        data: { purchaseRef: '', amount: 0 },
    }, { refererPath: '/inventory/purchases' });
    expectNotForbidden(paymentByFinance, 'FINANCE record payment pembelian invalid');

    const paymentByOps = await apiPost(ops[0], '/api/data', {
        entity: 'purchase-payments',
        action: 'record-payment',
        data: { purchaseRef: '', amount: 0 },
    }, { refererPath: '/inventory/purchases' });
    expectStatus(paymentByOps, 403, 'OPERASIONAL record payment pembelian');

    const actualByArmada = await apiPost(armada[0], '/api/data', {
        entity: 'delivery-orders',
        action: 'update-surat-jalan-actual-cargo',
        data: { id: '', suratJalanRef: '', actualItems: [] },
    }, { refererPath: '/trips' });
    expectNotForbidden(actualByArmada, 'ARMADA update aktual SJ invalid');

    const actualByFinance = await apiPost(finance[0], '/api/data', {
        entity: 'delivery-orders',
        action: 'update-surat-jalan-actual-cargo',
        data: { id: '', suratJalanRef: '', actualItems: [] },
    }, { refererPath: '/trips' });
    expectStatus(actualByFinance, 403, 'FINANCE update aktual SJ');

    const driverAccountByArmada = await apiGet(armada[1], '/api/driver/accounts?countOnly=1');
    assert(driverAccountByArmada.status === 200, `ARMADA anggota kedua harus bisa lihat akun driver, got ${driverAccountByArmada.status}`);

    const driverAccountByOps = await apiGet(ops[0], '/api/driver/accounts?countOnly=1');
    expectStatus(driverAccountByOps, 403, 'OPERASIONAL baca akun driver mobile');

    const reminderNoOrigin = await apiPost(finance[0], '/api/notifications/operational-admin/due-reminders?dryRun=1', {}, {
        includeOrigin: false,
    });
    expectStatus(reminderNoOrigin, 403, 'Reminder manual tanpa Origin');

    const reminderByArmada = await apiPost(armada[0], '/api/notifications/operational-admin/due-reminders?dryRun=1', {}, {
        refererPath: '/dashboard',
    });
    expectStatus(reminderByArmada, 403, 'ARMADA manual reminder');

    const scoringNoBearer = await fetchWithTimeout(`${BASE_URL}/api/driver/scoring/acknowledge`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-client-type': 'driver-app',
            Cookie: owner[0].cookie,
        },
        body: JSON.stringify({ scoreId: 'not-needed' }),
    }, 'driver scoring no bearer');
    assert(scoringNoBearer.status === 403, `Driver scoring tanpa Bearer dan tanpa Origin harus ditolak same-origin, got ${scoringNoBearer.status}`);
}

async function deleteCreatedDocumentWithRetry(id: string, docType: string) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await deleteDocument(id, docType);
            return;
        } catch (error) {
            lastError = error;
            await sleep(attempt * 500);
        }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
    throw new Error(`Gagal cleanup ${docType} ${id}: ${message}`);
}

async function main() {
    const suffix = `${Date.now().toString().slice(-7)}${Math.random().toString(36).slice(2, 6)}`;
    const password = `RoleAudit${suffix}!`;
    const passwordHash = await hashPassword(password);
    const createdUserIds: string[] = [];
    const createdItemIds: string[] = [];
    let auditFailed = false;

    try {
        auditStep('buat user audit sementara: 1 owner, 2 operasional, 2 finance, 2 armada, 1 driver');
        const users = await createAuditUsers(passwordHash, suffix);
        createdUserIds.push(...users.map(user => user.id));

        const driverUser = users.find(user => user.role === 'DRIVER');
        assert(driverUser, 'User DRIVER audit tidak terbentuk.');
        await expectDriverAdminLoginDenied(driverUser, password);

        auditStep('login semua user internal lewat API auth asli');
        const sessions = await Promise.all(
            users
                .filter((user): user is AuditUser & { role: InternalAuditRole } => user.role !== 'DRIVER')
                .map(user => login(user, password))
        );

        await auditPageMatrix(sessions);
        await auditApiReadMatrix(sessions);
        const detailPageProxyFlow = await auditDetailPageProxyMatrix(sessions);
        const suratJalanDetailFlow = await auditArmadaSuratJalanDetailFlow(sessions);
        const roleLimitedDetailFlow = await auditRoleLimitedDetailSupportingData(sessions);
        await auditWarehouseTwoMemberFlow(sessions, suffix, createdItemIds);
        await auditMutationBoundaries(sessions);

        console.log(JSON.stringify({
            ok: true,
            users: {
                owner: 1,
                operasional: 2,
                finance: 2,
                armada: 2,
                driverAdminDenied: true,
            },
            warehouseItemFlow: {
                createdBy: 'OPERASIONAL member 1',
                updatedBy: 'OPERASIONAL member 2',
                visibleTo: ['OWNER', 'OPERASIONAL member 1', 'OPERASIONAL member 2', 'FINANCE member 1', 'FINANCE member 2'],
                blockedFor: ['ARMADA member 1', 'ARMADA member 2'],
            },
            detailPageProxyFlow,
            suratJalanDetailFlow,
            roleLimitedDetailFlow,
        }, null, 2));
    } catch (error) {
        auditFailed = true;
        throw error;
    } finally {
        const cleanupErrors: string[] = [];
        for (const itemId of createdItemIds.reverse()) {
            await deleteCreatedDocumentWithRetry(itemId, 'warehouseItem')
                .catch(error => cleanupErrors.push(error instanceof Error ? error.message : String(error)));
        }
        for (const userId of createdUserIds.reverse()) {
            await deleteCreatedDocumentWithRetry(userId, 'user')
                .catch(error => cleanupErrors.push(error instanceof Error ? error.message : String(error)));
        }
        if (cleanupErrors.length > 0) {
            const message = `Cleanup audit role gagal: ${cleanupErrors.join('; ')}`;
            if (!auditFailed) {
                throw new Error(message);
            }
            console.error(message);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
