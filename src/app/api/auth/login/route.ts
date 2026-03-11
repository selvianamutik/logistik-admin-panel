/* ============================================================
   LOGISTIK — Login API Route (Sanity CMS)
   ============================================================ */

import { NextResponse } from 'next/server';
import { getSanityClient } from '@/lib/sanity';
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth';
import type { User } from '@/lib/types';

export async function GET() {
    return NextResponse.json({ error: 'Use POST method', methods: ['POST'] }, { status: 405 });
}

export async function POST(request: Request) {
    try {
        const { email, password } = await request.json();

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
