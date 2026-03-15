import { NextResponse } from 'next/server';

import { requireDriverSessionContext } from '@/lib/api/driver-portal';
import { extractRefId } from '@/lib/api/data-helpers';
import { handleDeliveryOrderStatusUpdate } from '@/lib/api/order-workflows';
import { ensureSameOriginRequest } from '@/lib/api/request-security';
import { sanityCreate, sanityGetById } from '@/lib/sanity';
import type { DeliveryOrder } from '@/lib/types';

async function addAuditLog(actor: { _id: string; name: string }, action: string, entityRef: string, summary: string) {
    try {
        await sanityCreate({
            _type: 'auditLog',
            actorUserRef: actor._id,
            actorUserName: actor.name,
            action,
            entityType: 'delivery-orders',
            entityRef,
            changesSummary: summary,
            timestamp: new Date().toISOString(),
        });
    } catch {
        console.warn('Audit log write failed for driver delivery status');
    }
}

export async function POST(request: Request) {
    const hasBearerAuth = Boolean(request.headers.get('authorization')?.toLowerCase().startsWith('bearer '));
    if (!hasBearerAuth) {
        const originError = ensureSameOriginRequest(request);
        if (originError) {
            return originError;
        }
    }

    const auth = await requireDriverSessionContext(request);
    if ('error' in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const body = await request.json() as {
            id?: string;
            status?: string;
            note?: string;
        };

        const id = typeof body.id === 'string' ? body.id : '';
        const status = typeof body.status === 'string' ? body.status : '';
        const note = typeof body.note === 'string' ? body.note : '';

        if (!id || !status) {
            return NextResponse.json({ error: 'Status DO tidak valid' }, { status: 400 });
        }

        const deliveryOrder = await sanityGetById<DeliveryOrder>(id);
        if (!deliveryOrder) {
            return NextResponse.json({ error: 'Surat jalan tidak ditemukan' }, { status: 404 });
        }

        if (extractRefId(deliveryOrder.driverRef) !== auth.driver._id) {
            return NextResponse.json({ error: 'Surat jalan ini bukan milik supir yang login' }, { status: 403 });
        }

        return handleDeliveryOrderStatusUpdate(
            auth.session,
            { id, status, note },
            addAuditLog
        );
    } catch (error) {
        console.error('Driver delivery status update error:', error);
        return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
}
