import { getSession } from '@/lib/auth';
import { jsonNoStore } from '@/lib/api/request-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
    const session = await getSession();
    if (!session) {
        return jsonNoStore({ user: null }, { status: 401 });
    }
    return jsonNoStore({ user: session });
}
