import { getSession } from '@/lib/auth';
import { runOperationalDueReminder } from '@/lib/api/operational-admin-reminders';
import { ensureSameOriginRequest, jsonNoStore } from '@/lib/api/request-security';
import { normalizeUserRole } from '@/lib/rbac';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_MANUAL_ROLES = new Set(['OWNER', 'OPERASIONAL', 'FINANCE']);

function readReminderSecret() {
    return (process.env.WHATSAPP_REMINDER_SECRET || process.env.CRON_SECRET || '').trim();
}

function readBearerToken(request: Request) {
    const header = request.headers.get('authorization') || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1]?.trim() || '';
}

function parseBooleanParam(value: string | null) {
    if (!value) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseIntegerParam(value: string | null) {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

async function authorizeReminderRequest(request: Request) {
    const configuredSecret = readReminderSecret();
    if (configuredSecret) {
        const token = readBearerToken(request);
        if (token === configuredSecret) {
            return null;
        }
        return jsonNoStore({ error: 'Unauthorized reminder request' }, { status: 401 });
    }

    if (request.method.toUpperCase() === 'GET') {
        return jsonNoStore(
            { error: 'Scheduled GET reminders require CRON_SECRET or WHATSAPP_REMINDER_SECRET.' },
            { status: 401 }
        );
    }

    const originError = ensureSameOriginRequest(request);
    if (originError) {
        return originError;
    }

    const session = await getSession();
    if (!session) {
        return jsonNoStore(
            { error: 'Unauthorized. Set CRON_SECRET or WHATSAPP_REMINDER_SECRET for scheduled reminders.' },
            { status: 401 }
        );
    }

    if (!ALLOWED_MANUAL_ROLES.has(normalizeUserRole(session.role))) {
        return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    return null;
}

async function handleReminderRequest(request: Request) {
    const authError = await authorizeReminderRequest(request);
    if (authError) return authError;

    const url = new URL(request.url);
    const result = await runOperationalDueReminder({
        dryRun: parseBooleanParam(url.searchParams.get('dryRun')),
        force: parseBooleanParam(url.searchParams.get('force')),
        today: url.searchParams.get('today') || undefined,
        lookaheadDays: parseIntegerParam(url.searchParams.get('lookaheadDays')),
        odometerLookaheadKm: parseIntegerParam(url.searchParams.get('odometerLookaheadKm')),
    });

    return jsonNoStore({
        ok: result.ok,
        skipped: result.skipped,
        reason: result.reason,
        eventKey: result.eventKey,
        counts: {
            invoices: result.digest.invoices.length,
            purchases: result.digest.purchases.length,
            maintenances: result.digest.maintenances.length,
        },
        notification: result.notification
            ? {
                ok: result.notification.ok,
                skipped: result.notification.skipped,
                provider: result.notification.provider,
                reason: result.notification.reason,
                statusCode: result.notification.statusCode,
            }
            : undefined,
        message: result.message,
    }, { status: result.ok ? 200 : 502 });
}

export async function GET(request: Request) {
    return handleReminderRequest(request);
}

export async function POST(request: Request) {
    return handleReminderRequest(request);
}
