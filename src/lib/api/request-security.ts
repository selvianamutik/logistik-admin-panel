import { NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function getRequestOrigin(request: Request) {
    try {
        return new URL(request.url).origin;
    } catch {
        return null;
    }
}

function getOriginFromHeader(value: string | null) {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

export function ensureSameOriginRequest(request: Request) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
        return null;
    }

    const requestOrigin = getRequestOrigin(request);
    if (!requestOrigin) {
        return NextResponse.json({ error: 'Origin request tidak valid' }, { status: 403 });
    }

    const originHeader = getOriginFromHeader(request.headers.get('origin'));
    if (originHeader) {
        if (originHeader !== requestOrigin) {
            return NextResponse.json({ error: 'Origin request ditolak' }, { status: 403 });
        }
        return null;
    }

    const refererOrigin = getOriginFromHeader(request.headers.get('referer'));
    if (refererOrigin) {
        if (refererOrigin !== requestOrigin) {
            return NextResponse.json({ error: 'Referer request ditolak' }, { status: 403 });
        }
        return null;
    }

    return NextResponse.json({ error: 'Origin request wajib dikirim' }, { status: 403 });
}
