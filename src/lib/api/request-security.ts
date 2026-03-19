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

function getDefaultPort(protocol: string) {
    if (protocol === 'http:') return '80';
    if (protocol === 'https:') return '443';
    return '';
}

function normalizeOriginForComparison(origin: string | null) {
    if (!origin) return null;
    try {
        const url = new URL(origin);
        const hostname = url.hostname.toLowerCase();
        const port = url.port || getDefaultPort(url.protocol);
        const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';

        if (isLoopback) {
            return `${url.protocol}//loopback:${port}`;
        }

        return `${url.protocol}//${hostname}:${port}`;
    } catch {
        return origin;
    }
}

function isEquivalentOrigin(left: string | null, right: string | null) {
    return normalizeOriginForComparison(left) === normalizeOriginForComparison(right);
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
        if (!isEquivalentOrigin(originHeader, requestOrigin)) {
            return NextResponse.json({ error: 'Origin request ditolak' }, { status: 403 });
        }
        return null;
    }

    const refererOrigin = getOriginFromHeader(request.headers.get('referer'));
    if (refererOrigin) {
        if (!isEquivalentOrigin(refererOrigin, requestOrigin)) {
            return NextResponse.json({ error: 'Referer request ditolak' }, { status: 403 });
        }
        return null;
    }

    return NextResponse.json({ error: 'Origin request wajib dikirim' }, { status: 403 });
}
