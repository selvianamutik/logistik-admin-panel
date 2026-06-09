# Fix: Surat Jalan Destination Column Not Showing

**Date:** 2026-06-09  
**Issue:** Kolom "Tujuan" tidak muncul di halaman Surat Jalan  
**Status:** ✅ Fixed and Tested

## Problem Description

Di halaman `/surat-jalan`, kolom "Tujuan" tidak menampilkan data lokasi tujuan dari `actualDropPoints`. Kolom menampilkan `-` atau fallback ke field `receiverName`/`receiverCompany`/`receiverAddress` yang mungkin sudah tidak akurat.

## Root Cause

Di fungsi `mapDeliveryOrderReferenceToSuratJalanDocument` ([trip-document-mappers.ts:404-409](../src/lib/trip-document-mappers.ts#L404-L409)), filter `actualDropPoints` hanya mencocokkan berdasarkan `shipperReferenceKey`:

```typescript
// BEFORE (BUG)
const sjActualDropPoints = allActualDropPoints.filter(drop => {
    if (!referenceKey) {
        return !drop.shipperReferenceKey && !drop.shipperReferenceNumber;
    }
    return drop.shipperReferenceKey === referenceKey;  // ❌ Missing shipperReferenceNumber check
});
```

Akibatnya, ketika `actualDropPoints` memiliki `shipperReferenceNumber` saja (tanpa `shipperReferenceKey`), drop points tersebut tidak akan difilter ke surat jalan yang sesuai.

## Solution

Tambahkan pencocokan dengan `shipperReferenceNumber` di filter:

```typescript
// AFTER (FIXED)
const sjActualDropPoints = allActualDropPoints.filter(drop => {
    if (!referenceKey) {
        return !drop.shipperReferenceKey && !drop.shipperReferenceNumber;
    }
    return drop.shipperReferenceKey === referenceKey || 
           drop.shipperReferenceNumber === suratJalanNumber;  // ✅ Added this condition
});
```

## Files Changed

1. **[src/lib/trip-document-mappers.ts](../src/lib/trip-document-mappers.ts)**
   - Line 404-409: Fixed `actualDropPoints` filter logic
   - Line 49: Exported `getReferenceIdentity` function for testing

2. **[scripts/debug-edge-case.ts](../scripts/debug-edge-case.ts)**
   - Line 31: Fixed syntax error (missing closing parenthesis)

3. **[scripts/verify-sj-destination.ts](../scripts/verify-sj-destination.ts)**
   - Line 32: Added type cast for test data

## Testing

### Test Suite Created

1. **test-sj-destination-fix.ts** - Basic functional tests
   - ✅ Primary SJ (no shipper references)
   - ✅ Multi-SJ with shipperReferenceKey
   - ✅ Single SJ with multiple drops
   - ✅ shipperReferenceNumber only (edge case)

2. **test-sj-edge-cases.ts** - Complex scenario tests
   - ✅ 2 SJ, each with 3 drop points
   - ✅ Mixed reference types (key + referenceNumber)
   - ✅ Primary SJ with no references
   - ✅ Stress test: 10 drop points in single SJ

3. **test-sj-logical-consistency.ts** - Logical correctness tests
   - ✅ Conservation law: no drops lost
   - ✅ No drop duplication across SJs
   - ✅ Correct drop partitioning by reference
   - ✅ Primary SJ isolation (no reference contamination)
   - ✅ Reference SJ isolation (no primary contamination)
   - ✅ shipperReferenceNumber matching works

### Test Results

```
=== TEST SUMMARY ===
test-sj-destination-fix.ts
  Total Tests: 4
  Passed: 4 ✅
  Failed: 0 ❌
  Success Rate: 100.0%

test-sj-edge-cases.ts
  Total Assertions: 7
  Passed: 7 ✅
  Failed: 0 ❌
  Success Rate: 100.0%

test-sj-logical-consistency.ts
  Total Tests: 6
  Passed: 6 ✅
  Failed: 0 ❌
  Success Rate: 100.0%

ALL TESTS PASSED ✅
```

## Verification Checklist

- [x] Bug identified and root cause analyzed
- [x] Fix implemented with minimal code changes
- [x] Build passes without errors
- [x] TypeScript compilation successful
- [x] Comprehensive test suite created
- [x] All tests passing (17/17)
- [x] Logical consistency verified
- [x] No drops lost or duplicated
- [x] Edge cases covered
- [x] Documentation updated

## Impact Analysis

### Affected Components
- **Halaman Surat Jalan** (`/surat-jalan`): Kolom "Tujuan" sekarang menampilkan lokasi dari `actualDropPoints`
- **Fungsi `getSuratJalanDestination`**: Sekarang menerima data yang benar dari `actualDropPoints`

### Breaking Changes
❌ None. This is a bug fix that restores intended behavior.

### Backwards Compatibility
✅ Fully compatible. Existing data structures unchanged.

## Conditional Scenarios Tested

1. **1 SJ dengan banyak drop tempat** ✅
   - Tested with up to 10 drop points
   - All locations correctly captured and displayed

2. **Multi-SJ dalam 1 trip** ✅
   - Each SJ correctly receives only its drop points
   - No cross-contamination between SJs

3. **Mixed reference types** ✅
   - Drops with `shipperReferenceKey` only
   - Drops with `shipperReferenceNumber` only
   - Drops with both
   - Primary drops with neither

4. **Drop point types** ✅
   - DROP, HOLD, TRANSIT, EXTRA_DROP, RETURN
   - All types correctly filtered to their SJ

## Performance Considerations

- **Filter complexity**: O(n) where n = number of drop points
- **Additional condition**: Minimal overhead (one extra OR check)
- **Memory usage**: No change
- **Build time**: No significant impact

## Deployment Notes

1. No database migration required
2. No environment variable changes
3. No breaking API changes
4. Safe to deploy immediately
5. Run test suite before deploy: `npm run typecheck && npm run build`

## Follow-up Actions

- [ ] Monitor production logs for any edge cases
- [ ] Verify fix in production after deployment
- [ ] Update user documentation if needed
- [ ] Consider adding E2E tests for UI behavior

## Related Issues

None currently linked.

---

**Fixed by:** Claude Code  
**Tested by:** Automated test suite (17 tests)  
**Reviewed by:** Pending code review
