# UAT End-to-End Sistem Logistik

Tanggal dibuat: 2026-05-13
Update terakhir: 2026-05-19

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
4. Untuk flow mobile/admin, lanjutkan ke sheet `03 Mobile Admin Detail`.
5. Ikuti kolom `Masuk Dari / Menu`, `Data Uji`, dan `Cara Test Detail`.
6. Cocokkan hasil dengan kolom `Output yang Diharapkan`.
7. Isi kolom `Hasil`:
   - `Sesuai`: output sama dengan harapan.
   - `Ada Bug`: ada error, data mismatch, UI rusak, atau workflow tidak sesuai.
   - `Blocked`: tidak bisa dites karena data/env/akses belum siap.
   - `N/A`: tidak berlaku untuk build/scope yang dites.
8. Jika `Ada Bug`, isi `Bug / Ketidaksesuaian`, `Evidence`, nama tester, dan tanggal.

## Isi Workbook

- `00 Akun Tester`: semua akun login web admin dan mobile/portal driver.
- `01 Checklist UAT`: 131 checklist UAT end-to-end dengan cara test dan output yang diharapkan.
- `02 Ringkasan`: rekap otomatis jumlah Sesuai, Ada Bug, Blocked, N/A, dan Belum Dites dari checklist utama dan detail mobile/admin.
- `03 Mobile Admin Detail`: 38 checklist detail untuk mobile driver dan web admin operasional. Sheet ini menjelaskan akun yang dipakai, menu yang harus dibuka, data uji, langkah test, dan output yang harus muncul.

Catatan: file lengkap `artifacts/uat/UAT_LOGISTIK_END_TO_END.xlsx` punya struktur lama yang lebih panjang; detail mobile/admin ada di sheet `06 Mobile Admin Detail` dan ringkasan lengkapnya menampilkan tambahan checklist tersebut.

## Fokus Sheet `03 Mobile Admin Detail`

- Akses dan isolasi data driver: APK Mobile -> Login Driver -> Beranda, lalu cocokkan dengan Web Admin `/delivery-orders`.
- Assign driver/truk: Web Admin `/delivery-orders/{id}` -> Lengkapi Armada Trip.
- Kelola SJ & Barang: APK Mobile -> Trip -> Kelola SJ & Barang, lalu cek Web Admin `/surat-jalan` dan `/delivery-orders/{id}`.
- Update Status SJ per batch: APK Mobile -> Trip -> Update Status SJ, lalu cek status tiap SJ di Web Admin.
- Aktual barang dan drop: APK Mobile -> Ajukan Selesai -> Aktual Barang/Titik Drop, lalu cek tab aktual di Web Admin `/delivery-orders/{id}` dan detail `/surat-jalan/{id}`.
- Hold dan lanjutan: cek barang drop vs hold, lalu pastikan barang hold bisa dilanjutkan tanpa double invoice.
- Insiden: APK Mobile -> Lapor Insiden/Ajukan Selesai Insiden, lalu review di Web Admin `/fleet/incidents/{id}`.
- Biaya insiden: Web Admin `/fleet/incidents/{id}` dan `/driver-vouchers/{id}`, termasuk kasus uang jalan sudah terbit dan belum terbit.
- Tracking GPS dan odometer: APK Mobile -> Tracking/Tutup Trip, lalu cek trip dan kendaraan di admin.
- Invoice/nota: Web Admin `/invoices` dan `/reports`, pastikan angka mengambil aktual final yang disetujui admin.

File workbook: `artifacts/uat/UAT_LOGISTIK_END_TO_END_TESTER.xlsx`

## Exit Criteria

- Semua P0 harus `Sesuai`.
- Tidak ada bug Critical/High yang masih open.
- Flow Order -> DO/SJ -> Driver -> Approval -> Nota -> Payment -> Laporan tidak boleh mismatch.
- Bug yang ditemukan wajib punya langkah reproduce dan evidence.
