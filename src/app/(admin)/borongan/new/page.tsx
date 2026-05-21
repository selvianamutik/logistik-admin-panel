'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewBoronganPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/driver-vouchers/new');
    }, [router]);

    return (
        <div className="card">
            <div className="card-body" style={{ padding: '1.5rem' }}>
                <h1 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Mengalihkan ke Uang Jalan Trip</h1>
                <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                    Workflow aktif penyelesaian supir sekarang dipusatkan di Uang Jalan Trip per DO/trip.
                </p>
            </div>
        </div>
    );
}
