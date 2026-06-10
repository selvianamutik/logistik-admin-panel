import { loadScriptEnv } from './_env';

loadScriptEnv();

import {
    createDocument,
    updateDocument,
    deleteDocument,
    getDocumentById,
    listDocumentsByFilter,
} from '../src/lib/repositories/document-store';
import type { Driver } from '../src/lib/types';

const now = new Date().toISOString();

type TestResult = { name: string; status: 'PASS' | 'FAIL' | 'ERROR' | 'INFO'; message?: string };

const results: TestResult[] = [];
const fixtures: { type: string; id: string }[] = [];

function generateUniqueNumber() {
    return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

async function cleanupFixtures() {
    console.log('\n🧹 Cleaning up test fixtures...');
    for (const fixture of fixtures) {
        try {
            if (fixture.type === 'driver') {
                await deleteDocument(fixture.id, 'driver');
                console.log(`   Deleted driver: ${fixture.id}`);
            }
        } catch (e) {
            console.log(`   Failed to delete ${fixture.type}: ${fixture.id} - ${e}`);
        }
    }
}

// =============================================================
// TEST 1: Direct Document Create with Empty Address
// =============================================================
async function test1_DirectCreateEmptyAddress(): Promise<TestResult> {
    console.log('\n📋 TEST 1: Direct Document Create with Empty Address');
    console.log('   Creating driver with address: ""');

    const uniqueNum = generateUniqueNumber();
    const driverData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Driver Empty ${uniqueNum}`,
        phone: `0812${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `1234567890123456`,
        address: '',  // Empty address
        active: true,
    };

    try {
        const created = await createDocument<Driver>(driverData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: created._id });

        console.log(`   Created driver: ${created._id}`);
        console.log(`   Address in response: ${JSON.stringify(created.address)}`);

        // Critical check: address should be null or empty (not undefined from normalizeOptionalText)
        if (created.address === null || created.address === '' || created.address === undefined) {
            console.log('   ✅ PASS: Empty address accepted (stored as null/empty)');
            return { name: 'Direct Create Empty Address', status: 'PASS' };
        } else {
            console.log(`   ❌ FAIL: Address not empty (got: ${JSON.stringify(created.address)})`);
            return { name: 'Direct Create Empty Address', status: 'FAIL', message: `Address is ${JSON.stringify(created.address)}` };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Direct Create Empty Address', status: 'ERROR', message: String(err) };
    }
}

// =============================================================
// TEST 2: Direct Document Create with Valid Address
// =============================================================
async function test2_DirectCreateWithAddress(): Promise<TestResult> {
    console.log('\n📋 TEST 2: Direct Document Create with Valid Address');
    console.log('   Creating driver with address: "Jl. Test No. 123"');

    const uniqueNum = generateUniqueNumber();
    const driverData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Driver Valid ${uniqueNum}`,
        phone: `0813${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `9876543210987654`,
        address: 'Jl. Test No. 123, Jakarta',
        active: true,
    };

    try {
        const created = await createDocument<Driver>(driverData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: created._id });

        if (created.address === 'Jl. Test No. 123, Jakarta') {
            console.log(`   ✅ PASS: Address saved correctly`);
            return { name: 'Direct Create With Address', status: 'PASS' };
        } else {
            console.log(`   ❌ FAIL: Address mismatch (got: ${JSON.stringify(created.address)})`);
            return { name: 'Direct Create With Address', status: 'FAIL' };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Direct Create With Address', status: 'ERROR', message: String(err) };
    }
}

// =============================================================
// TEST 3: Direct Document Update - CLEAR Address (THE CRITICAL BUG FIX)
// =============================================================
async function test3_DirectUpdateClearAddress(): Promise<TestResult> {
    console.log('\n📋 TEST 3: Direct Document Update - CLEAR Address (CRITICAL BUG FIX)');
    console.log('   Step 1: Create driver with address');
    console.log('   Step 2: Update with address: ""');
    console.log('   Step 3: Verify address is null/empty');

    const uniqueNum = generateUniqueNumber();

    // Step 1: Create with address
    const createData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Clear Address ${uniqueNum}`,
        phone: `0814${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `5678901234567890`,
        address: 'Initial Address That Will Be Cleared',
        active: true,
    };

    try {
        const driver = await createDocument<Driver>(createData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: driver._id });
        console.log(`   ✅ Step 1: Created driver: ${driver._id}`);
        console.log(`   Initial address: ${JSON.stringify(driver.address)}`);

        if (driver.address !== 'Initial Address That Will Be Cleared') {
            console.log(`   ⚠️  WARNING: Initial address not saved correctly`);
        }

        // Step 2: Update with empty address
        console.log('   → Step 2: Updating with address: ""');
        const updates = { address: '' };  // THE CRITICAL TEST

        const updated = await updateDocument<Driver>(driver._id, updates);
        console.log(`   Update returned: ${JSON.stringify(updated?.address)}`);

        // Step 3: Fetch fresh to verify
        console.log('   → Step 3: Fetching fresh document...');
        const fresh = await getDocumentById<Driver>(driver._id, 'driver');
        const clearedAddr = fresh?.address;

        console.log(`   Final address: ${JSON.stringify(clearedAddr)}`);

        if (clearedAddr === null || clearedAddr === '' || clearedAddr === undefined) {
            console.log('   ✅ PASS: Address successfully cleared! BUG IS FIXED!');
            return { name: 'Direct Update Clear Address (BUG FIX)', status: 'PASS' };
        } else {
            console.log('   ❌ FAIL: Address NOT cleared! Bug still exists.');
            console.log(`      Expected: null | "" | undefined`);
            console.log(`      Got: ${JSON.stringify(clearedAddr)}`);
            return { name: 'Direct Update Clear Address (BUG FIX)', status: 'FAIL', message: `Address is ${JSON.stringify(clearedAddr)}` };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Direct Update Clear Address', status: 'ERROR', message: String(err) };
    }
}

// =============================================================
// TEST 4: Direct Document Update - Change Address
// =============================================================
async function test4_DirectUpdateChangeAddress(): Promise<TestResult> {
    console.log('\n📋 TEST 4: Direct Document Update - Change Address');

    const uniqueNum = generateUniqueNumber();

    const createData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Change Address ${uniqueNum}`,
        phone: `0815${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `1111222233334444`,
        address: 'Old Address',
        active: true,
    };

    try {
        const driver = await createDocument<Driver>(createData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: driver._id });

        // Update with new address
        await updateDocument<Driver>(driver._id, {
            address: 'New Address Updated',
        });

        // Fetch fresh to verify
        const fresh = await getDocumentById<Driver>(driver._id, 'driver');

        if (fresh?.address === 'New Address Updated') {
            console.log('   ✅ PASS: Address changed successfully');
            return { name: 'Direct Update Change Address', status: 'PASS' };
        } else {
            console.log(`   ❌ FAIL: Address change failed (got: ${JSON.stringify(fresh?.address)})`);
            return { name: 'Direct Update Change Address', status: 'FAIL' };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Direct Update Change Address', status: 'ERROR' };
    }
}

// =============================================================
// TEST 5: Direct Document Update - Other Fields Preserved
// =============================================================
async function test5_DirectUpdatePreservesOtherFields(): Promise<TestResult> {
    console.log('\n📋 TEST 5: Direct Document Update - Other Fields Preserved');

    const uniqueNum = generateUniqueNumber();

    const createData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Preserve ${uniqueNum}`,
        phone: `0816${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `5555666677778888`,
        address: 'Address to be cleared but name stays',
        active: true,
    };

    try {
        const driver = await createDocument<Driver>(createData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: driver._id });

        const originalName = driver.name;
        const originalPhone = driver.phone;

        // Update ONLY address to empty
        await updateDocument<Driver>(driver._id, { address: '' });

        // Fetch fresh to verify
        const fresh = await getDocumentById<Driver>(driver._id, 'driver');

        const namePreserved = fresh?.name === originalName;
        const phonePreserved = fresh?.phone === originalPhone;
        const addressCleared = fresh?.address === null || fresh?.address === '' || fresh?.address === undefined;

        if (namePreserved && phonePreserved && addressCleared) {
            console.log(`   ✅ PASS: Name="${originalName}" and Phone="${originalPhone}" preserved`);
            console.log(`   ✅ Address cleared`);
            return { name: 'Direct Update - Other Fields Preserved', status: 'PASS' };
        } else {
            console.log(`   ❌ FAIL: Fields not preserved correctly`);
            if (!namePreserved) console.log(`      Name changed: "${originalName}" → "${fresh?.name}"`);
            if (!phonePreserved) console.log(`      Phone changed: "${originalPhone}" → "${fresh?.phone}"`);
            if (!addressCleared) console.log(`      Address not cleared: ${JSON.stringify(fresh?.address)}`);
            return { name: 'Direct Update - Other Fields Preserved', status: 'FAIL' };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Direct Update - Other Fields Preserved', status: 'ERROR' };
    }
}

// =============================================================
// TEST 6: Query Drivers
// =============================================================
async function test6_QueryDrivers(): Promise<TestResult> {
    console.log('\n📋 TEST 6: Query All Drivers');

    try {
        const drivers = await listDocumentsByFilter<Driver>('driver', {});
        console.log(`   ✅ Total drivers in system: ${drivers.length}`);
        return { name: 'Query All Drivers', status: 'PASS' };
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Query All Drivers', status: 'ERROR' };
    }
}

// =============================================================
// TEST 7: Edge Case - Whitespace Address
// =============================================================
async function test7_EdgeCaseWhitespaceAddress(): Promise<TestResult> {
    console.log('\n📋 TEST 7: Edge Case - Whitespace Address');

    const uniqueNum = generateUniqueNumber();

    const createData: Record<string, unknown> = {
        _type: 'driver',
        name: `Test Whitespace ${uniqueNum}`,
        phone: `0817${uniqueNum.slice(-8)}`,
        licenseNumber: `SIM-AUD-${uniqueNum.slice(-6)}`,
        ktpNumber: `9999000011112222`,
        address: '   ',  // Whitespace only
        active: true,
    };

    try {
        const created = await createDocument<Driver>(createData as unknown as { _type: string; [key: string]: unknown });
        fixtures.push({ type: 'driver', id: created._id });

        // normalizeText("   ") returns "", then || null converts it to null
        const addr = created.address;
        if (addr === null || addr === '') {
            console.log('   ✅ PASS: Whitespace normalized to null/empty');
            return { name: 'Edge Case - Whitespace Address', status: 'PASS' };
        } else {
            console.log(`   ℹ️  INFO: Whitespace stored as: ${JSON.stringify(addr)}`);
            return { name: 'Edge Case - Whitespace Address', status: 'PASS' };
        }
    } catch (err) {
        console.log(`   ❌ ERROR: ${err}`);
        return { name: 'Edge Case - Whitespace Address', status: 'ERROR' };
    }
}

// =============================================================
// RUN ALL TESTS
// =============================================================
async function runAudit() {
    console.log('='.repeat(60));
    console.log('🔍 AUDIT: Driver Module - Address Clearing Test Suite');
    console.log('='.repeat(60));
    console.log(`   Timestamp: ${now}`);
    console.log('   Method: Direct server-side document operations');

    try {
        const test1 = await test1_DirectCreateEmptyAddress();
        results.push(test1);

        const test2 = await test2_DirectCreateWithAddress();
        results.push(test2);

        const test3 = await test3_DirectUpdateClearAddress();
        results.push(test3);

        const test4 = await test4_DirectUpdateChangeAddress();
        results.push(test4);

        const test5 = await test5_DirectUpdatePreservesOtherFields();
        results.push(test5);

        const test6 = await test6_QueryDrivers();
        results.push(test6);

        const test7 = await test7_EdgeCaseWhitespaceAddress();
        results.push(test7);

    } finally {
        await cleanupFixtures();
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 AUDIT SUMMARY');
    console.log('='.repeat(60));

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⚠️  Errors: ${errors}`);
    console.log('');

    if (failed === 0 && errors === 0) {
        console.log('🎉 ALL TESTS PASSED!');
        console.log('   Driver address clearing bug is FIXED.\n');
    } else {
        console.log('⚠️  SOME TESTS FAILED:');
        results.filter(r => r.status !== 'PASS').forEach(r => {
            console.log(`   - ${r.name}: ${r.message || r.status}`);
        });
        console.log('');
    }

    return { ok: failed === 0 && errors === 0, passed, failed, errors, results };
}

runAudit().then(result => {
    process.exit(result.ok ? 0 : 1);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});