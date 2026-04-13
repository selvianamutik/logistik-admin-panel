import { loadScriptEnv } from './_env';
import { getBusinessDateValue } from '../src/lib/business-date';
import { getSanityClient } from '../src/lib/sanity';
import { getCurrentDriverScore } from '../src/lib/api/driver-score-workflows';
import { getDriverPortalAccessNotice } from '../src/lib/api/driver-portal';
import type { User } from '../src/lib/types';

loadScriptEnv();

async function main() {
    const emailArg = process.argv[2]?.trim().toLowerCase();
    const driverRefArg = process.argv[3]?.trim();

    if (!emailArg && !driverRefArg) {
        console.error('Usage: npx tsx scripts/check-driver-score.ts <driver-email> [driver-ref]');
        process.exitCode = 1;
        return;
    }

    const today = getBusinessDateValue();
    const client = getSanityClient();

    let user: User | null = null;
    if (emailArg) {
        user = await client.fetch<User | null>(
            `*[_type == "user" && lower(email) == $email][0]`,
            { email: emailArg }
        );
    }

    const driverRef = driverRefArg || user?.driverRef || '';
    if (!driverRef) {
        console.error('Driver ref not found from the provided input.');
        process.exitCode = 1;
        return;
    }

    const [rawScores, matchedScore, notice] = await Promise.all([
        client.fetch(
            `*[_type == "driverScore" && (driverRef == $driverRef || driverRef._ref == $driverRef)] | order(effectiveDate desc, _createdAt desc){
                _id,
                scoreType,
                effectiveDate,
                durationDays,
                dueDate,
                notes,
                warningAcknowledgedAt,
                driverRef,
                driverName,
                createdAt,
                _createdAt
            }`,
            { driverRef }
        ),
        getCurrentDriverScore(driverRef, today),
        getDriverPortalAccessNotice(driverRef),
    ]);

    console.log(JSON.stringify({
        sanityProjectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
        sanityDataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
        today,
        input: {
            email: emailArg || null,
            driverRef,
        },
        user: user ? {
            _id: user._id,
            email: user.email,
            role: user.role,
            driverRef: user.driverRef ?? null,
            driverName: user.driverName ?? null,
        } : null,
        rawScores,
        matchedScore,
        driverAccessNotice: notice,
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
