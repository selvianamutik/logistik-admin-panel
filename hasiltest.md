# Hasil Eksekusi Ulang Test Case (`testcase.md`)

Tanggal eksekusi ulang: 2026-03-02  
Lokasi: `d:\lain_lain\Coding\project\logistik`

## Catatan Cakupan
- Test case di `testcase.md` mayoritas manual/UI.
- Eksekusi ini fokus pada case yang bisa diotomasi via CLI/API (Environment, Script, Auth, RBAC, API).

## Ringkasan
- Total case otomatis dieksekusi: 25
- PASS: 24
- FAIL: 1
- FAIL tersisa: `SCR-001` (precondition dataset tidak fresh; data seed sudah ada)

## Detail Hasil

### Environment & Script
| ID | Status | Detail |
|---|---|---|
| ENV-001 | PASS | Dev server berjalan (`/login` dapat diakses). |
| ENV-002 | PASS | `npm run build` berhasil. |
| ENV-004 | PASS | `npx tsx scripts/test-sanity.ts` valid: project ID benar sukses, typo gagal 401. |
| ENV-005 | PASS | `npm run lint` berhasil tanpa error (masih ada warning non-blocking). |
| SCR-001 | FAIL | Seed run pertama tidak membuat dokumen baru (`0 created, 40 skipped`) karena data seed sudah ada sebelumnya. |
| SCR-002 | PASS | Seed run berikutnya idempotent (`0 created, 40 skipped`). |
| SCR-003 | PASS | Log project ID seed sudah konsisten dengan konfigurasi client (`p6do50hl`). |
| SCR-004 | PASS | Verifikasi typo project ID (`l` vs `1`) sesuai ekspektasi. |

### Auth / RBAC / API (otomatis via HTTP)
Sumber detail mentah: `automated_test_results_latest.json`

| ID | Status | Detail |
|---|---|---|
| AUTH-001 | PASS | Login tanpa kredensial -> 400 |
| AUTH-002 | PASS | Login email salah -> 401 |
| AUTH-003 | PASS | Login owner -> 200 |
| AUTH-004 | PASS | Login admin -> 200 |
| AUTH-005 | PASS | Session owner -> 200 + user valid |
| AUTH-006 | PASS | Session tanpa cookie -> 401 |
| AUTH-007 | PASS | Logout -> 200, cek session setelah logout -> 401 |
| AUTH-008 | PASS | Akses dashboard tanpa login -> redirect `/login` (307) |
| AUTH-009 | PASS | Akses root saat login -> redirect `/dashboard` (307) |
| RBAC-001 | PASS | Admin akses `/settings/users` -> redirect `/dashboard` |
| RBAC-002 | PASS | Admin akses `/reports` -> redirect `/dashboard` |
| RBAC-006 | PASS | Admin akses `audit-logs` API -> 403 |
| API-001 | PASS | GET `/api/data` tanpa session -> 401 |
| API-002 | PASS | POST `/api/data` tanpa session -> 401 |
| API-003 | PASS | GET entity invalid -> 400 |
| API-004 | PASS | POST entity invalid -> 400 |
| API-005 | PASS | GET id tidak ada -> 404 |

## Output File Terkait
- `automated_test_results_latest.json`
- `automated_dev_server.out.log`
- `automated_dev_server.err.log`
