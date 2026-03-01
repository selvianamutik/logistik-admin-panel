# Ringkasan Perbaikan Fail Test Case

Tanggal: 2026-03-02
Project: `d:\lain_lain\Coding\project\logistik`

## Perbaikan yang dilakukan

1. Middleware API auth behavior
- File: `src/middleware.ts`
- Perubahan: route `/api/*` tidak lagi dipaksa redirect ke `/login` oleh middleware.
- Dampak: endpoint API sekarang mengembalikan status asli dari handler (`401/403`) sesuai testcase.
- Fail yang tertutup: `AUTH-006`, `AUTH-007`, `API-001`, `API-002`.

2. Error lint pada script Sanity
- File: `scripts/test-sanity.ts`
- Perubahan: ganti `catch (err: any)` menjadi `catch (err: unknown)` dengan parsing aman.
- Dampak: error `@typescript-eslint/no-explicit-any` hilang.
- Fail yang tertutup: bagian error lint `ENV-005`.

3. Error lint React hooks memoization
- File: `src/app/(admin)/reports/page.tsx`
- Perubahan: `inPeriod` dijadikan `useCallback`, dependency `useMemo` disesuaikan.
- Dampak: error `react-hooks/preserve-manual-memoization` hilang.
- Fail yang tertutup: bagian error lint `ENV-005`.

4. Mismatch log project ID seed
- File: `scripts/seed-sanity.ts`
- Perubahan: `projectId`, `dataset`, `apiVersion` dijadikan konstanta dan log memakai konstanta yang sama.
- Dampak: log seed konsisten dengan konfigurasi client.
- Fail yang tertutup: `SCR-003`.

5. Automasi rerun testcase
- File baru: `scripts/run-testcase.ps1`
- Fungsi: menjalankan smoke testcase HTTP (Auth/RBAC/API) dan menulis hasil ke `automated_test_results_latest.json`.

## Hasil rerun testcase

- Total case otomatis dieksekusi: 25
- PASS: 24
- FAIL: 1

Detail utama:
- PASS: `ENV-001`, `ENV-002`, `ENV-004`, `ENV-005`
- PASS: `AUTH-001..009`
- PASS: `RBAC-001`, `RBAC-002`, `RBAC-006`
- PASS: `API-001..005`
- PASS: `SCR-002`, `SCR-003`, `SCR-004`
- FAIL: `SCR-001`

## Catatan fail tersisa

- `SCR-001` masih fail karena precondition testcase meminta seed pertama membuat dokumen baru.
- Pada environment saat ini dataset sudah berisi data seed, sehingga hasil valid adalah `0 created, 40 skipped`.
- Ini bukan error fungsi seed, melainkan kondisi data awal yang tidak kosong.

## File bukti

- `hasiltest.md`
- `automated_test_results_latest.json`
- `automated_dev_server.out.log`
- `automated_dev_server.err.log`
