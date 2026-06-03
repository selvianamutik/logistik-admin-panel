import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth';

export default async function HomePage() {
    const adminSession = await getSession();

    if (adminSession) {
        redirect('/dashboard');
    }

    redirect('/login');
}
