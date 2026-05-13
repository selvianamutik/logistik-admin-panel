# UAT End-to-End Sistem Logistik

Tanggal dibuat: 2026-05-13

Paket ini disederhanakan untuk divisi tester. Tester cukup membuka workbook, memilih hasil `Sesuai`, `Ada Bug`, `Blocked`, atau `N/A`, lalu mengisi detail bug bila ada.

## Akun Tester

| Aplikasi | Role / Divisi | Email | Password | Login dari |
| --- | --- | --- | --- | --- |
| Web Admin | OWNER | owner@company.local | owner12345 | /login |
| Web Admin | OPERASIONAL | admin@company.local | admin12345 | /login |
| Web Admin | FINANCE | finance@company.local | admin12345 | /login |
| Web Admin | ARMADA | armada@company.local | admin12345 | /login |
| Portal Driver / Mobile | DRIVER - Agus | driver.agus@company.local | driver12345 | /driver/login atau app mobile |
| Portal Driver / Mobile | DRIVER - Budi | driver.budi@company.local | driver12345 | /driver/login atau app mobile |
| Portal Driver / Mobile | DRIVER - Catur | driver.catur@company.local | driver12345 | /driver/login atau app mobile |
| Portal Driver / Mobile | DRIVER - Eko | driver.eko@company.local | driver12345 | /driver/login atau app mobile |
| Portal Driver / Mobile | DRIVER - Imam | imam@driver | driver12345 | /driver/login atau app mobile |

## Cara Pakai Workbook

1. Buka sheet `00 Akun Tester` untuk melihat akun login web dan mobile.
2. Buka sheet `01 Checklist UAT`.
3. Jalankan test dari prioritas `P0` dulu.
4. Ikuti kolom `Cara Test Detail`.
5. Cocokkan hasil dengan kolom `Output yang Diharapkan`.
6. Isi kolom `Hasil`:
   - `Sesuai`: output sama dengan harapan.
   - `Ada Bug`: ada error, data mismatch, UI rusak, atau workflow tidak sesuai.
   - `Blocked`: tidak bisa dites karena data/env/akses belum siap.
   - `N/A`: tidak berlaku untuk build/scope yang dites.
7. Jika `Ada Bug`, isi `Bug / Ketidaksesuaian`, `Evidence`, nama tester, dan tanggal.

## Isi Workbook

- `00 Akun Tester`: semua akun login web admin dan mobile/portal driver.
- `01 Checklist UAT`: 131 checklist UAT end-to-end dengan cara test dan output yang diharapkan.
- `02 Ringkasan`: rekap otomatis jumlah Sesuai, Ada Bug, Blocked, N/A, dan Belum Dites.

File workbook: `artifacts/uat/UAT_LOGISTIK_END_TO_END_TESTER.xlsx`

## Exit Criteria

- Semua P0 harus `Sesuai`.
- Tidak ada bug Critical/High yang masih open.
- Flow Order -> DO/SJ -> Driver -> Approval -> Nota -> Payment -> Laporan tidak boleh mismatch.
- Bug yang ditemukan wajib punya langkah reproduce dan evidence.
