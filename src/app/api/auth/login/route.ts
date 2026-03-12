/* ============================================================
   LOGISTIK — Login API Route (Sanity CMS)
   ============================================================ */

import { NextResponse } from 'next/server';
import { getSanityClient, sanityGetById, sanityUpdate } from '@/lib/sanity';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';
import type { Driver, User } from '@/lib/types';

export async function GET() {
    return NextResponse.json({ error: 'Use POST method', methods: ['POST'] }, { status: 405 });
}

export async function POST(request: Request) {
    try {
        const { email, password, scope } = await request.json();
        const loginScope = scope === 'DRIVER' ? 'DRIVER' : 'ADMIN';

        if (!email || !password) {
            return NextResponse.json(
                { error: 'Email dan password wajib diisi' },
                { status: 400 }
            );
        }

        // Find user from Sanity
        const user = await getSanityClient().fetch<User | null>(
            `*[_type == "user" && email == $email && active == true][0]`,
            { email }
        );

        if (!user) {
            return NextResponse.json(
                { error: 'Email atau password salah' },
                { status: 401 }
            );
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            return NextResponse.json(
                { error: 'Email atau password salah' },
                { status: 401 }
            );
        }

        if (loginScope === 'DRIVER' && user.role !== 'DRIVER') {
            return NextResponse.json(
                { error: 'Akun ini bukan akun mobile driver' },
                { status: 403 }
            );
        }

        if (loginScope === 'ADMIN' && user.role === 'DRIVER') {
            return NextResponse.json(
                { error: 'Akun driver harus login dari aplikasi driver' },
                { status: 403 }
            );
        }

        if (user.role === 'DRIVER') {
            if (!user.driverRef) {
                return NextResponse.json(
                    { error: 'Akun driver belum terhubung ke data supir' },
                    { status: 409 }
                );
            }

            const driver = await sanityGetById<Driver>(user.driverRef);
            if (!driver || driver.active === false) {
                return NextResponse.json(
                    { error: 'Akun driver tidak aktif atau data supir tidak tersedia' },
                    { status: 409 }
                );
            }
        }

        const lastLoginAt = new Date().toISOString();
        await sanityUpdate(user._id, { lastLoginAt });
        user.lastLoginAt = lastLoginAt;

        // Create session
        const token = await createSession(user);
        await setSessionCookie(token);

        return NextResponse.json({
            success: true,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                driverRef: user.driverRef,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        return NextResponse.json(
            { error: 'Terjadi kesalahan server' },
            { status: 500 }
        );
    }
}
