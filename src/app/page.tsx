import { redirect } from 'next/navigation';

import { getDriverSession, getSession } from '@/lib/auth';

export default async function HomePage() {
    const [adminSession, driverSession] = await Promise.all([
        getSession(),
        getDriverSession(),
    ]);

    if (adminSession) {
        redirect('/dashboard');
    }

    if (driverSession) {
        redirect('/driver');
    }

    redirect('/login');
}
