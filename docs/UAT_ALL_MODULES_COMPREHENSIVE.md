# UAT All Modules Sistem Logistik

Tanggal update: 2026-05-30  
Scope: seluruh modul web admin, portal/mobile driver, API workflow, finance, inventory, armada, import, notifikasi, role, print/detail, dan regression end-to-end.  
Workbook utama: `artifacts/uat/UAT_ALL_MODULES_COMPREHENSIVE.xlsx`

Dokumen ini dipakai untuk UAT penuh setelah perubahan terbaru di branch `main`, termasuk commit besar teman `5a51563 Bug fixes` dan perubahan settlement uang jalan terbaru. Gunakan bersama:

- `WORKFLOW.md`
- `docs/SYSTEM_MODULES_AND_WORKFLOWS.md`
- `docs/UAT_UANG_JALAN_TRIP_SETTLEMENT.md`

## 1. Prinsip UAT

- Test memakai data staging/dummy, bukan data produksi final.
- Jalankan test dari `P0` dulu, lalu `P1`, lalu `P2`.
- Setiap action harus dicek sampai downstream, bukan berhenti di toast sukses.
- Untuk uang, stok, ban, odometer, invoice, jurnal, dan laporan, catat angka sebelum action dan sesudah action.
- Jika ada mismatch data, status case harus `Ada Bug` walaupun UI terlihat sukses.
- Jangan edit data manual untuk "membetulkan" hasil test sebelum bug dicatat.
- Test mobile harus dilakukan dari sudut pandang driver, lalu diverifikasi ulang dari admin operasional.

## 2. Akun Tester

| Role | Email | Password | Fokus |
| --- | --- | --- | --- |
| OWNER | owner@company.local | owner12345 | Full access, user, settings, laporan, final approval |
| OPERASIONAL | admin@company.local | admin12345 | Order, DO, SJ, trip, uang jalan, incident operasional |
| FINANCE | finance@company.local | admin12345 | Invoice, pembayaran, pengeluaran, kas, jurnal, laporan |
| ARMADA | armada@company.local | admin12345 | Kendaraan, driver, ban, maintenance, incident |
| DRIVER | driver.agus@company.local | driver12345 | Portal/mobile driver, update SJ, tracking, incident |

Jika akun seed berubah, tester wajib menulis akun aktual yang dipakai pada sheet `01 Akun Role`.

## 3. Persiapan Teknis

1. Pull branch terbaru:
   `git pull --ff-only origin main`
2. Install dependency bila perlu:
   `npm install`
3. Jalankan validasi minimal:
   `npm run typecheck`
   `npm run lint`
   `npm run build`
4. Jalankan aplikasi lokal atau staging.
5. Pastikan Supabase/env menunjuk database staging.
6. Jika test mobile native, install APK terbaru dan set API base URL ke environment yang sama dengan admin panel.
7. Jika test WhatsApp, aktifkan dry-run dulu atau pakai nomor admin test.

## 4. Modul yang Wajib Dicakup

| Area | Modul/Menu | Fokus test |
| --- | --- | --- |
| Auth & Session | Login, logout, profil, password, role | akses benar, session bersih, driver/admin terpisah |
| Dashboard | `/dashboard` | KPI per role, link, nominal finance |
| Kerja Harian | Order/Resi, Trip/DO, Surat Jalan, Uang Jalan, Pengeluaran | status, partial, hold, actual, settlement |
| Driver/Mobile | Portal driver dan APK | SJ batch, barang, drop, hold, incident, tracking, odometer |
| SDM | Karyawan, Absensi | CRUD, role, export bila tersedia |
| Gudang & Pembelian | Supplier, Barang Gudang, Pembelian, Stok, Material Usage | stok, outstanding, receive/pay |
| Invoice & Kas | Nota, pembayaran, rekening/kas, laporan, jurnal, buku besar | net, klaim, overpayment, ledger |
| Master Data | Customer, master barang, biaya rute trip, jenis armada, kategori biaya | snapshot, nonaktif, import |
| Armada | Kendaraan, supir, skor, maintenance, ban, insiden | lock resource, odometer, tire asset |
| Pengaturan | Company, users, import, audit | owner-only, import preview/commit |
| Integrasi | WhatsApp, due reminders, print/detail | env, no spam, fallback, format |

## 5. Fokus Khusus Perubahan Terbaru

Case berikut wajib masuk UAT karena menyentuh perubahan teman:

1. Multi SJ dalam 1 DO tampil per SJ, bukan campur semua item.
2. Tambah SJ baru tidak menurunkan status SJ lama yang sudah jalan.
3. Update batch status hanya mengubah SJ yang dipilih.
4. Driver request finalisasi membuat pending approval, bukan langsung delivered.
5. Admin approve/reject pending driver request dan data mobile berubah setelah refresh.
6. Edit actual item ditolak saat pending approval.
7. Hapus/edit SJ ditolak jika sudah punya actual drop/hold/return atau final.
8. Hapus/edit barang ditolak jika barang sudah punya actual drop/hold/return.
9. Actual drop total harus sama dengan actual cargo final.
10. Campuran drop dan hold/return dalam satu SJ harus dipilih per barang.
11. Hold dari trip pertama bisa dilanjutkan di trip berikutnya dengan origin hold.
12. Input berat/volume menyimpan unit input asli dan konversi kg/m3 benar.
13. Keyboard/dropdown mobile tidak membuat form tambah SJ/barang/drop hilang.
14. Tracking active/paused mengunci driver dan kendaraan.
15. Insiden aktif memblokir tombol lapor insiden baru sampai selesai/closed.
16. Incident cost route ke uang jalan vs company expense harus sesuai pilihan admin.
17. Catat aset ban dari incident masuk Ban dan bisa dipasang ke unit.
18. Bon/uang jalan memakai urutan bon yang benar dan penutupan sesuai label client.
19. Import `.xlsx` memakai template, bukan CSV satu kolom.
20. Notifikasi WhatsApp gagal tidak menggagalkan workflow utama.

## 6. Cara Mengisi Workbook

Kolom penting pada sheet `04 Checklist All Modules`:

- `ID`: nomor case unik.
- `Prioritas`: P0/P1/P2.
- `Role`: role yang menjalankan test.
- `Modul`: modul/menu.
- `Scenario`: kondisi yang diuji.
- `Precondition/Data`: data awal yang harus ada.
- `Steps`: langkah test ringkas.
- `Expected Result`: output yang harus terjadi.
- `Downstream Check`: modul/data lanjutan yang harus dicek.
- `Actual Result`: hasil nyata saat tester menjalankan test.
- `Status`: `Belum Dites`, `Sesuai`, `Ada Bug`, `Blocked`, atau `N/A`.
- `Evidence/Notes`: URL, ID dokumen, screenshot, log, atau catatan bug.

Gunakan status:

- `Sesuai`: output sama dengan expected dan downstream cocok.
- `Ada Bug`: ada error, mismatch, status salah, angka salah, UI hilang, atau role bocor.
- `Blocked`: tidak bisa dites karena data/env/akses.
- `N/A`: tidak berlaku untuk build/scope ini.

## 7. Scenario End-to-End Wajib

### E2E-01 Order sampai invoice lunas

1. OWNER/OPERASIONAL buat customer dan master barang customer.
2. Buat order multi item.
3. Buat DO sebagian item.
4. Assign driver/kendaraan.
5. Driver update status sampai arrived.
6. Admin finalisasi dengan actual cargo dan actual drop.
7. Buat invoice/nota.
8. Catat pembayaran partial lalu lunas.
9. Cek invoice status, bank/kas, income, jurnal, laba rugi.

Expected:

- order menjadi partial/complete sesuai sisa item.
- DO delivered.
- nota memakai aktual final.
- pembayaran mengurangi sisa tagihan.
- jurnal dan laporan sinkron.

### E2E-02 Partial qty, hold, lanjut hold

1. Buat order qty besar.
2. Buat DO hanya sebagian qty.
3. Di finalisasi, sebagian drop dan sebagian hold.
4. Buat DO baru dari barang hold.
5. Driver/admin lanjutkan drop dari hold.
6. Buat invoice setelah final.

Expected:

- qty pending/held/delivered benar.
- hold origin terbawa ke trip lanjutan.
- invoice hanya menagih aktual final yang billable.
- tidak ada barang hilang atau double count.

### E2E-03 Multi SJ beda status

1. Buat DO dengan SJ A.
2. Driver update SJ A sampai `ARRIVED`.
3. Tambah SJ B.
4. Update hanya SJ B ke status berikutnya.
5. Cek list SJ, trip detail, mobile, dan surat jalan.

Expected:

- SJ A tetap `ARRIVED`.
- SJ B sesuai status yang dipilih.
- status utama trip mengikuti agregasi, bukan reset ke pickup/created.

### E2E-04 Uang jalan, incident, dan biaya

1. Terbitkan uang jalan dari DO.
2. Driver lapor incident ban.
3. Admin tambah detail biaya incident.
4. Pilih route `DRIVER_VOUCHER` untuk satu biaya.
5. Pilih route `COMPANY_EXPENSE` untuk biaya lain.
6. Catat aset ban dari biaya ban.
7. Pasang ban ke unit.
8. Selesaikan uang jalan.
9. Cek expense, bank/kas, jurnal, ban, kendaraan.

Expected:

- biaya route voucher masuk biaya lain-lain uang jalan.
- biaya route company expense masuk pengeluaran perusahaan.
- aset ban tercatat dan punya histori.
- settlement uang jalan menghitung total biaya dan upah dengan benar.

### E2E-05 Resource lock driver/kendaraan

1. Buat DO aktif dengan driver/kendaraan A.
2. Mulai tracking dari mobile.
3. Coba assign DO baru dengan driver/kendaraan A.
4. Selesaikan trip lama.
5. Coba assign lagi.

Expected:

- saat trip belum selesai, driver/kendaraan A tidak tersedia atau ditolak.
- setelah trip selesai dan tracking stopped, driver/kendaraan A tersedia lagi.

### E2E-06 Import master data

1. Download template Customer, Master Barang Customer, Supplier, Barang Gudang, Biaya Rute Trip.
2. Isi data valid.
3. Preview.
4. Commit.
5. Cek data masuk ke modul tujuan.
6. Ulangi dengan duplicate dan mode berbeda.

Expected:

- kolom terbaca rapi.
- preview menunjukkan create/update/skip/error.
- commit membuat audit log batch.
- stok gudang tidak berubah dari import master.

## 8. Exit Criteria

UAT bisa dianggap lulus jika:

- Semua `P0` berstatus `Sesuai`.
- Tidak ada bug Critical/High open.
- Tidak ada mismatch pada flow Order -> DO/SJ -> Driver/Mobile -> Approval -> Uang Jalan -> Incident/Expense -> Invoice -> Payment -> Journal -> Report.
- Stok inventory, stok ban, kas/bank, jurnal, invoice, odometer, dan status trip sinkron setelah action.
- Role non-owner tidak melihat atau mengubah data di luar haknya.
- Login/logout/session aman dan tidak meninggalkan akses setelah logout.
- Print/detail yang masih tersedia rapi dan tidak memotong data penting.

## 9. Severity

| Severity | Kriteria |
| --- | --- |
| Critical | Uang/stok/jurnal/invoice salah, data hilang, role bocor, workflow utama tidak bisa jalan |
| High | Status trip/SJ/incident salah, approval tidak jalan, driver/admin mismatch, downstream tidak tersambung |
| Medium | Validasi kurang, UI membingungkan, filter/pagination/search salah, print/export salah |
| Low | Typo, spacing, minor copy, minor layout yang tidak mengganggu workflow |

## 10. Evidence Minimal Saat Ada Bug

Saat memilih `Ada Bug`, tulis:

- role login.
- URL/menu.
- ID order/DO/SJ/bon/invoice/incident/ban.
- langkah reproduce.
- expected result.
- actual result.
- screenshot atau log bila ada.
- data downstream yang mismatch.

## 11. Lampiran UAT Khusus

Gunakan lampiran berikut untuk test lebih dalam:

- `docs/UAT_UANG_JALAN_TRIP_SETTLEMENT.md`
- `artifacts/uat/UAT_UANG_JALAN_TRIP_SETTLEMENT.xlsx`
- `docs/UAT_TIRE_MAINTENANCE.md`
- `docs/UAT_LOGISTIK_END_TO_END.md`
