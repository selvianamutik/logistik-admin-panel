# Dokumentasi Modul, Workflow, dan Kondisi Sistem Logistik

Tanggal update: 2026-05-30  
Branch sumber: `main`  
Commit acuan terbaru saat audit: `dc65a69 Update driver voucher settlement labels`  
Commit besar teman yang dipelajari: `5a51563 Bug fixes`

Dokumen ini adalah pegangan operasional untuk memahami fitur, relasi data, kondisi khusus, dan titik UAT yang wajib dicek. Detail alur teknis utama tetap ada di `WORKFLOW.md`; dokumen ini merangkum seluruh modul agar tester dan user operasional tidak harus membaca kode.

## 1. Perubahan Penting dari Commit Teman

Commit `5a51563 Bug fixes` bukan perubahan kecil. Area yang berubah besar dan harus dianggap sebagai baseline workflow baru:

1. Driver mobile dan portal driver sekarang membawa struktur DO/SJ lebih kaya:
   - `shipperReferences` untuk memisahkan SJ customer di dalam 1 DO.
   - item barang menyimpan `shipperReferenceKey` dan `shipperReferenceNumber`.
   - status dan label driver memperhatikan pending approval admin.

2. Aktual drop menjadi lebih eksplisit:
   - titik drop bisa `DROP`, `HOLD`, `TRANSIT`, `EXTRA_DROP`, atau `RETURN`.
   - titik drop bisa mengarah ke SJ tertentu dan barang tertentu.
   - total aktual drop harus cocok dengan total aktual final barang.
   - bila satu SJ punya campuran drop dan hold/return, sistem meminta pilih barang spesifik supaya invoice dan status barang tidak salah.

3. Partial per qty dan hold diperketat:
   - order item dapat dikirim sebagian per qty/berat/volume.
   - hold menyimpan qty, berat, volume, alasan, dan lokasi.
   - hold dapat dilanjutkan di trip berikutnya dengan asal hold tetap terbawa.

4. Admin dan driver tidak boleh saling menimpa data saat ada approval pending:
   - perubahan actual item ditolak ketika sedang menunggu approval admin.
   - edit/hapus SJ atau barang ditolak bila sudah punya aktual drop/hold/return atau status final.
   - request driver disimpan sebagai pending request, lalu admin approve/reject.

5. Tracking dan resource trip lebih aman:
   - DO dengan tracking `ACTIVE` atau `PAUSED` mengunci driver/kendaraan.
   - perubahan resource trip yang masih punya tracking aktif harus ditolak.
   - tracking berhenti saat DO final/cancel atau driver dinonaktifkan.

6. Input angka dan satuan lebih konsisten:
   - berat bisa input kg/ton, tetapi source of truth tetap kg.
   - volume bisa input m3/liter/kl, tetapi source of truth tetap m3.
   - unit input asli tetap disimpan untuk tampilan lapangan.
   - input mobile diberi guard agar keyboard/dropdown tidak membuat form hilang.

7. Surat Jalan dan dokumen turunan ikut berubah:
   - tampilan DO/SJ perlu membaca per-SJ, bukan hanya per-DO.
   - invoice/nota harus mengambil aktual final bila tersedia.
   - PDF/print DO menampilkan shipper reference dan realisasi drop.

## 2. Prinsip Global Sistem

### 2.1 Source of truth

- `Order / Resi` adalah sumber pesanan customer.
- `Delivery Order / Trip / Surat Jalan` adalah sumber eksekusi pengiriman.
- `DeliveryOrderItem` adalah sumber muatan yang dibawa dalam DO.
- `actualCargoItems` dan `actualDropPoints` adalah sumber aktual final lapangan.
- `Freight Nota` adalah tagihan aktif ke customer.
- `DriverVoucher` adalah settlement uang jalan trip.
- `Expense`, `Payment`, `Income`, `BankTransaction`, dan `JournalEntry` adalah dampak finance.
- `WarehouseItem`, `StockMovement`, dan `TireEvent` adalah sumber stok dan aset gudang/ban.

### 2.2 Role dan batasan

- `OWNER`: akses penuh, user, setting perusahaan, audit, dan data sensitif.
- `OPERASIONAL`: order, DO/SJ, trip, uang jalan, pengeluaran operasional tertentu, customer, import master.
- `FINANCE`: invoice, pembayaran, kas/bank, laporan, jurnal, pembelian bayar, uang jalan view/print/export.
- `ARMADA`: kendaraan, supir, maintenance, ban, insiden, assignment armada tertentu.
- `DRIVER`: hanya jalur driver/mobile, tidak masuk admin panel.

Role `ADMIN` legacy dinormalisasi menjadi `OPERASIONAL`.

### 2.3 Hard delete vs nonaktif/void/tolak

Data yang sudah berdampak ke modul lain tidak boleh dihapus bebas. Gunakan:

- `nonaktif` untuk master data yang masih punya histori.
- `void` atau `ditolak` untuk dokumen finance/settlement yang perlu ditutup tanpa menghapus jejak.
- blok edit/hapus untuk SJ/barang yang sudah aktual/final/pending approval.

### 2.4 Audit log

Action penting harus meninggalkan audit log:

- create/update/delete master data.
- perubahan order, DO, SJ, status, POD, aktual, hold.
- import master data.
- posting uang jalan, expense, bank transaction, invoice payment.
- incident settlement dan catat aset ban dari insiden.

## 3. Modul Auth, Role, dan Session

Fungsi:

- login web admin di `/login`.
- login driver di `/driver/login` atau APK.
- logout web dan driver.
- akun driver dipisah dari akun internal.

Kondisi penting:

- akun driver tidak boleh masuk panel admin.
- akun admin/owner tidak boleh masuk jalur driver.
- driver logout ditolak jika masih ada DO yang mengunci tracking aktif.
- user nonaktif tidak boleh login.
- driver nonaktif menghentikan tracking aktif dan menonaktifkan akun mobile terkait.

UAT wajib:

- login/logout per role.
- akses URL langsung yang bukan hak role.
- session setelah logout.
- akun driver aktif/nonaktif.
- ganti password dan profil.

## 4. Dashboard

Fungsi:

- ringkasan KPI sesuai role.
- owner/finance melihat nominal finance.
- role lain hanya melihat konteks operasional yang diizinkan.

Kondisi penting:

- finance total disembunyikan dari role tanpa hak.
- kartu dashboard harus link ke modul yang boleh dibuka role.
- data tagihan aktif memakai `Freight Nota`, bukan invoice legacy.

UAT wajib:

- cek dashboard OWNER, OPERASIONAL, FINANCE, ARMADA.
- cek angka setelah membuat order, DO, invoice, uang jalan, expense, dan incident.

## 5. Master Data

### 5.1 Customer

Fungsi:

- data customer, PIC, kontak, termin, format SJ, limit piutang.
- master barang customer dan penerima/pickup customer.

Kondisi penting:

- order lama menyimpan snapshot, tidak berubah saat master customer diedit.
- customer nonaktif tidak boleh dipakai untuk transaksi baru.
- master barang customer dipakai sebagai template item order, bukan stok gudang.

UAT wajib:

- tambah/edit/nonaktif customer.
- tambah master barang customer.
- cek dropdown barang order terfilter sesuai customer.
- cek duplikat nama/kode.

### 5.2 Biaya Rute Trip

Fungsi:

- master tarif operasional trip untuk rute, jenis armada, dan upah/overtonase driver.
- bukan billing customer.

Kondisi penting:

- uang jalan dan DO memakai nilai ini sebagai referensi trip.
- overtonase driver memakai rate yang tersimpan di rute/jenis armada.
- perubahan master tidak boleh merusak DO lama yang sudah snapshot.

UAT wajib:

- tambah/edit/nonaktif rute.
- cek DO baru mengambil tarif sesuai rute dan armada.
- cek overtonase setelah aktual final lebih berat dari kapasitas/estimasi.

### 5.3 Jenis Armada

Fungsi:

- kategori kendaraan, kapasitas, layout ban, dan rate overtonase.

Kondisi penting:

- kendaraan bergantung pada kategori armada.
- slot ban mengikuti layout kategori.
- kapasitas dipakai untuk warning overtonase.

### 5.4 Kategori Biaya

Fungsi:

- kategori pengeluaran umum, trip, maintenance, incident, driver fee.

Kondisi penting:

- kategori yang dipakai transaksi tidak boleh dihapus sembarangan.
- beberapa kategori finance hanya owner/finance yang boleh kelola.

## 6. Order / Resi

Fungsi:

- menerima order customer.
- input pickup, penerima, armada, item barang, berat/volume.
- membuat DO dari order.

Status order:

- `OPEN`: belum jalan.
- `PARTIAL`: sebagian sudah assigned/dikirim/hold.
- `COMPLETE`: semua selesai.
- `ON_HOLD`: sebagian tertahan.
- `CANCELLED`: dibatalkan.

Kondisi penting:

- sebelum ada DO, field utama order masih boleh diedit.
- setelah ada DO, customer, armada, penerima, dan pickup terkunci; catatan masih boleh diubah.
- item order bisa partial per item dan partial per qty.
- qty/berat/volume rencana boleh berbeda dari aktual final.
- master barang customer hanya template; transaksi tetap menyimpan snapshot.

UAT wajib:

- buat order satu item.
- buat order multi item.
- buat order multi pickup/penerima bila ada.
- create DO sebagian item.
- create DO sebagian qty.
- hold sisa qty, release hold, lanjut DO baru.
- edit order sebelum/sesudah ada DO.
- cancel order dengan/tanpa relasi.

## 7. Trip / Delivery Order / Surat Jalan

Fungsi:

- membuat dan mengelola trip/DO.
- assign driver, kendaraan, rute, tarif, SJ customer, dan barang.
- tracking dan status pengiriman.
- finalisasi aktual/POD.

Status DO:

- `CREATED`: DO dibuat.
- `ON_DELIVERY`: dalam pengiriman.
- `ARRIVED`: tiba.
- `PARTIAL_HOLD`: sebagian terkirim, sebagian hold/transit.
- `DELIVERED`: selesai/final.
- `CANCELLED`: batal.
- `DRIVER_REQUESTED_DELIVERED`: driver mengajukan finalisasi.
- `DRIVER_REQUEST_REJECTED`: permintaan driver ditolak.

Kondisi penting:

- driver tidak boleh set `DELIVERED` langsung.
- admin menyelesaikan DO sekaligus POD dan aktual final.
- status trip utama mengikuti progres SJ/barang, bukan dipaksa satu status untuk semua SJ.
- bila ada SJ A sudah arrived/delivered lalu SJ B ditambah, status SJ A tidak boleh turun.
- hapus/edit SJ atau barang ditolak bila sudah punya aktual drop/hold/return atau final.
- actual drop total harus sama dengan actual cargo final.
- bila tidak ada actual drop manual, sistem membuat drop default ke tujuan utama.
- tracking aktif mengunci driver/kendaraan.
- DO yang punya uang jalan atau invoice harus dicek dampaknya sebelum edit.

UAT wajib:

- assign driver/kendaraan tersedia.
- driver/kendaraan dengan trip belum selesai tidak muncul untuk assignment baru.
- driver/kendaraan setelah trip selesai muncul lagi.
- status SJ berbeda-beda dalam satu DO.
- update batch status sebagian SJ.
- tambah SJ baru setelah SJ lama sudah arrived.
- multi drop per lokasi dan per barang.
- hold/transit/return/extra drop.
- final POD dan aktual.
- print/PDF DO dan SJ.

## 8. Driver Mobile / Portal Driver

Fungsi:

- driver login.
- melihat DO miliknya.
- mulai/pulihkan tracking.
- kelola SJ dan barang sesuai hak driver.
- update status SJ batch dengan pilihan SJ.
- input aktual drop, hold, lanjut hold, odometer, dan incident.

Kondisi penting:

- mobile hanya menampilkan DO milik driver login.
- driver hanya input/edit/request; approval final tetap admin.
- request finalisasi menunggu admin.
- saat pending approval, input aktual terkait tidak boleh ditimpa.
- active incident memblokir tombol lapor insiden baru sampai incident selesai/closed sesuai kondisi.
- keyboard/dropdown tidak boleh membuat form hilang.
- input angka harus menerima format lokal yang sama dengan admin.
- hold continuation harus membawa asal hold dan qty/berat/volume sisa.

UAT wajib:

- login APK/portal.
- DO kosong, DO aktif, DO selesai.
- mulai tracking, heartbeat, logout ditolak saat tracking aktif.
- update batch status sebagian SJ.
- tambah/edit SJ dan barang dari mobile.
- actual drop satu titik.
- actual drop multi titik.
- hold lalu lanjutkan dari barang hold.
- incident 1 kali, selesai, lalu incident baru.
- odometer tutup trip.
- sync ke admin setelah refresh.

## 9. Uang Jalan Trip

Fungsi:

- settlement uang jalan per DO/trip.
- mencatat bon awal, top up, biaya lain-lain, upah borongan driver, dan penutupan.

Rumus aktif:

- `Total Uang Diberikan` = total bon aktif yang sudah dicairkan ke driver.
- `Biaya Lain-lain` = total item biaya aktual trip.
- `Upah Borongan` = upah trip final dari DO, termasuk overtonase bila sudah dihitung.
- `Total Biaya` = biaya lain-lain + upah borongan.
- `Sisa Bon Operasional` = total uang diberikan - biaya lain-lain.
- `Balance / Selisih` = total uang diberikan - total biaya.
- jika selisih positif: driver mengembalikan sisa bon.
- jika selisih negatif: perusahaan membayar kekurangan melalui bon penutupan.

Label penutupan:

- bon pertama adalah uang jalan awal.
- bon kedua dan berikutnya adalah top up.
- penutupan maksimal ditampilkan sebagai `Bon Ketiga Penutupan` sesuai permintaan client.
- bila total biaya lebih besar dari bon pertama dan bon kedua, nominal bon penutupan = total biaya - total bon pertama/kedua, dengan fallback minimal sebesar selisih aktual.

Kondisi penting:

- 1 uang jalan = 1 DO.
- DO yang sudah punya uang jalan tidak boleh masuk slip borongan lain.
- uang jalan diterbitkan langsung membuat mutasi bank/kas debit.
- top up membuat disbursement dan mutasi bank/kas debit.
- edit/hapus top up membuat koreksi mutasi.
- settlement membuat expense untuk biaya lain-lain dan upah driver.
- settlement membuat mutasi kredit bila ada uang kembali, debit bila ada kekurangan.
- voucher settled tidak boleh diedit bebas.

UAT wajib:

- terbitkan uang jalan.
- top up bon kedua dan bon ketiga.
- edit top up urutan tanggal berbeda.
- hapus top up.
- tambah/edit/hapus biaya.
- settlement sisa uang kembali.
- settlement kekurangan bayar.
- DO sudah settled lalu cek assignment driver/kendaraan baru.
- cek jurnal, kas/bank, expense, laporan.

## 10. Insiden

Fungsi:

- mencatat incident kendaraan/trip.
- driver bisa lapor insiden dari mobile.
- admin review, tambah settlement, approve/posting, resolve/close.

Jenis:

- `BLOWOUT_TIRE`
- `ENGINE_TROUBLE`
- `ACCIDENT_MINOR`
- `ACCIDENT_MAJOR`
- `OTHER`

Status:

- `OPEN`
- `IN_PROGRESS`
- `RESOLVED`
- `CLOSED`

Settlement line:

- `COST`: biaya.
- `COMPENSATION`: santunan.
- `RECOVERY`: penggantian/recovery.

Rute biaya:

- `DRIVER_VOUCHER`: masuk biaya lain-lain uang jalan trip terkait.
- `COMPANY_EXPENSE`: masuk pengeluaran perusahaan dan rekening/kas yang dipilih.

Kondisi penting:

- tidak semua biaya incident masuk uang jalan.
- ban/sparepart yang dibeli di tengah perjalanan bisa diposting sebagai expense perusahaan atau biaya trip, sesuai keputusan admin.
- jika kategori `TIRE` dan perlu dicatat sebagai aset, admin memakai `Catat Aset Ban`.
- aset ban dari incident masuk modul Ban sebagai ban tertracking dan dapat dipasang ke unit.
- incident yang belum selesai dapat memblokir laporan incident baru di mobile.
- insiden closed tidak boleh ditambah settlement baru.
- line yang sudah posted tidak boleh dihapus tanpa status penutup yang benar.

UAT wajib:

- driver lapor insiden.
- admin approve/reject request selesai incident.
- incident biaya ke driver voucher.
- incident biaya ke company expense.
- incident ban -> catat aset ban -> pasang ke unit -> cek ban dan kendaraan.
- incident sebelum uang jalan terbit, lalu uang jalan diterbitkan.
- incident setelah uang jalan settled.
- incident 2 kali dalam 1 trip.
- incident di 2 trip berbeda driver sama.

## 11. Armada, Kendaraan, Driver, Maintenance, Ban

### 11.1 Kendaraan

Fungsi:

- master unit, kategori armada, status, odometer, dokumen, dan ban terpasang.

Kondisi penting:

- nomor rangka/mesin hanya boleh diubah owner.
- kendaraan dengan tracking/trip aktif tidak boleh dianggap tersedia.
- detail kendaraan menampilkan ban berdasarkan slot aktual.

### 11.2 Driver

Fungsi:

- master supir, akun mobile, status aktif, histori trip, skor/skors.

Kondisi penting:

- satu driver hanya punya satu akun mobile aktif.
- driver nonaktif menghentikan tracking aktif.
- driver yang sedang trip tidak boleh diassign ke trip baru.

### 11.3 Maintenance

Fungsi:

- jadwal servis by tanggal atau odometer.
- material usage ke stok bila memakai barang gudang.
- posting expense bila ada biaya.

Kondisi penting:

- reminder WA melihat maintenance due by date dan odometer.
- material usage harus mengurangi stok.
- maintenance selesai memperbarui status dan histori.

### 11.4 Ban

Fungsi:

- aset ban tertracking.
- lokasi: unit internal, serep unit, gudang, dipinjam keluar, afkir.
- event: pasang, rotasi, pindah gudang, pinjam, afkir.

Jenis ban:

- `ORI benang / nilon`
- `ORI kawat / radial`
- `kanisir`

Sumber ban:

- `PURCHASE`: dari pembelian/stok.
- `INCIDENT_DO_PURCHASE`: ban dibeli dalam perjalanan/DO karena incident.
- `MANUAL`: histori lama bila masih ada data migrasi; untuk seed aktif sebaiknya tidak dipakai kecuali kebutuhan khusus.

Kondisi penting:

- ban `IN_USE` tidak boleh slot `SP`.
- ban `SPARE` wajib slot `SP`.
- satu slot kendaraan hanya boleh satu ban aktif.
- ban incident yang sudah dicatat sebagai aset harus bisa dipasang dan masuk histori.
- odometer pemasangan/penggantian harus mengikuti odometer unit/trip saat event.

## 12. Supplier, Barang Gudang, Pembelian, dan Stok

### 12.1 Supplier

Fungsi:

- master vendor, termin, outstanding, histori pembelian.

Kondisi penting:

- supplier nonaktif tidak boleh dipakai pembelian baru.
- outstanding dihitung dari pembelian belum lunas.

### 12.2 Barang Gudang

Fungsi:

- master barang gudang dan mode tracking.
- `STANDARD` untuk barang umum.
- `TIRE_ASSET` untuk master ban tertracking.

Kondisi penting:

- import master barang gudang tidak mengubah stok awal.
- stok hanya berubah lewat stock movement, pembelian diterima, material usage, masuk/keluar manual.
- barang mode ban harus tersambung ke modul Ban saat menjadi aset.

### 12.3 Pembelian

Fungsi:

- dokumen purchase, item, receive, payment, outstanding.

Kondisi penting:

- receive menambah stok.
- bayar mengurangi bank/kas dan outstanding.
- hutang jatuh tempo masuk reminder WA.
- pembelian ban dapat menjadi stok ban/inventory, tetapi aset ban fisik tetap dicatat di modul Ban saat diperlukan.

### 12.4 Laporan Stok

Fungsi:

- rekap stok, movement, stok menipis/habis.

Kondisi penting:

- stok harus cocok dengan stock movement.
- filter periode dan pagination harus dipakai agar data besar tidak berat.

## 13. Invoice / Nota Ongkos, Pembayaran, dan Klaim

Fungsi:

- membuat freight nota dari DO selesai.
- mencatat klaim/potongan.
- menerima pembayaran satu nota atau multi nota.
- mendeteksi kelebihan bayar.

Kondisi penting:

- nota mengambil aktual final DO jika ada.
- gross tidak berubah oleh klaim; net = gross - adjustment approved - PPh 23 bila aktif.
- payment tidak boleh melebihi sisa net tanpa masuk mekanisme overpayment.
- satu receipt hanya untuk satu customer.
- pembayaran cash tanpa rekening otomatis masuk Kas Tunai.
- invoice legacy bukan tagihan aktif utama.

UAT wajib:

- create nota dari DO actual final.
- klaim/potongan approved/void.
- PPh 23 before/after claim bila aktif.
- bayar partial, lunas, multi nota.
- overpayment dan refund.
- cek income, bank transaction, jurnal, laporan.

## 14. Rekening & Kas, Jurnal, Buku Besar, Laporan Keuangan

Fungsi:

- bank/kas sebagai ledger kas.
- transaksi masuk/keluar/transfer.
- jurnal otomatis dan manual.
- laporan laba rugi, neraca, buku besar.

Kondisi penting:

- transaksi yang tidak diposting ke rekening tidak muncul di arus kas.
- cash tanpa rekening pada payment/expense memakai Kas Tunai.
- jurnal umum punya filter status dan rentang tanggal.
- buku besar harus cocok dengan jurnal posted.
- laporan keuangan harus bisa filter periode dan print rapi.

UAT wajib:

- transaksi bank manual.
- transfer antar rekening.
- payment invoice.
- expense.
- uang jalan issue/top up/settle.
- pembelian bayar.
- jurnal manual posted/void.
- laporan laba rugi/neraca periode.

## 15. Pengeluaran

Fungsi:

- mencatat biaya umum dan biaya operasional.
- link ke kendaraan, incident, maintenance, voucher, borongan bila relevan.

Kondisi penting:

- privacy `ownerOnly` hanya terlihat owner.
- role non-owner tidak boleh melihat expense ownerOnly.
- expense dengan rekening membuat mutasi bank/kas.
- expense tanpa rekening hanya masuk laba rugi.
- expense terkait incident/voucher harus punya link balik.

## 16. SDM

Fungsi:

- karyawan dan absensi.

Kondisi penting:

- absensi hanya untuk karyawan aktif.
- finance bisa view/export absensi sesuai permission.
- perubahan karyawan harus tidak mengganggu user login internal kecuali memang terkait.

## 17. Import Data

Target import aktif:

- Customer.
- Master Barang Customer.
- Supplier.
- Barang Gudang.
- Biaya Rute Trip.

Mode:

- `createOnly`: data existing dilewati.
- `updateOnly`: hanya update data existing.
- `upsert`: create jika belum ada, update jika sudah ada.

Kondisi penting:

- file harus `.xlsx`.
- pakai template dari sistem agar kolom rapi.
- stok barang gudang tidak diubah dari import master.
- master barang customer wajib cocok customer aktif.
- biaya rute trip bukan billing customer.
- preview wajib dicek sebelum commit.
- import row saat ini diproses row-by-row, jadi UAT harus mengecek partial failure dan audit batch.

UAT wajib:

- download template semua target.
- upload valid.
- upload kolom salah.
- upload duplicate key.
- createOnly existing.
- updateOnly missing.
- upsert mix.
- permission role owner/operasional/finance.
- audit log batch.

## 18. Notifikasi WhatsApp Operasional

Provider aktif yang didukung:

- Green API lewat `WHATSAPP_PROVIDER=green_api`.
- CallMeBot masih fallback kompatibilitas jika env lama dipakai.

Notifikasi event langsung:

- driver lapor incident.
- driver request selesai incident.
- driver update status SJ/trip.
- driver request tutup trip/finalisasi.

Reminder terjadwal:

- invoice jatuh tempo.
- hutang supplier/pembelian jatuh tempo.
- maintenance waktunya by tanggal atau odometer.

Kondisi penting:

- notifikasi gagal tidak boleh menggagalkan workflow utama.
- dry run harus bisa dipakai untuk test.
- reminder harian membuat audit log agar tidak spam dua kali di hari yang sama.
- token provider harus di environment server, tidak boleh masuk repo.

## 19. Pengaturan

Fungsi:

- akun saya.
- profil perusahaan dan dokumen.
- user internal.
- import data.
- audit aktivitas.

Kondisi penting:

- hanya owner yang kelola user internal dan company settings.
- audit aktivitas hanya owner.
- import data owner/operasional.
- perubahan company profile berdampak ke print/PDF.

## 20. Risiko Regression yang Paling Wajib Dijaga

1. Status SJ tidak boleh turun saat SJ baru ditambahkan ke DO yang sudah berjalan.
2. Update batch status SJ harus hanya mengubah SJ yang dipilih.
3. Actual drop per lokasi/barang harus sama dengan actual cargo final.
4. Hold harus bisa dilanjutkan tanpa kehilangan asal, qty, berat, volume.
5. Pending approval driver tidak boleh tertimpa edit admin/driver lain.
6. Driver/kendaraan yang masih trip aktif tidak boleh muncul untuk assignment baru.
7. Driver/kendaraan yang tripnya sudah selesai harus tersedia lagi.
8. Incident cost harus masuk route yang benar: uang jalan atau company expense.
9. Ban dari incident harus menjadi aset ban tertracking bila dicatat.
10. Uang jalan harus sinkron dengan expense, bank transaction, journal, dan laporan.
11. Invoice harus memakai aktual final DO, bukan rencana, bila aktual tersedia.
12. Cash harus masuk Kas Tunai bila tidak ada rekening eksplisit.
13. Import data harus preview dulu dan tidak mengubah stok.
14. Role tidak boleh bocor ke modul atau nominal yang bukan haknya.
15. Print/detail boleh ada, tetapi tombol export/print list utama yang sudah dirapikan tidak boleh muncul lagi.

## 21. Dokumen dan Artifact UAT

Rujukan UAT penuh:

- `docs/UAT_ALL_MODULES_COMPREHENSIVE.md`
- `artifacts/uat/UAT_ALL_MODULES_COMPREHENSIVE.xlsx`

Lampiran khusus:

- `docs/UAT_UANG_JALAN_TRIP_SETTLEMENT.md`
- `artifacts/uat/UAT_UANG_JALAN_TRIP_SETTLEMENT.xlsx`
- `docs/UAT_TIRE_MAINTENANCE.md`
- `docs/UAT_LOGISTIK_END_TO_END.md`

Setiap bug harus dicatat dengan:

- role.
- URL/menu.
- ID dokumen.
- langkah reproduce.
- output aktual.
- output harapan.
- screenshot/log bila ada.
- dampak downstream: DO, SJ, invoice, uang jalan, expense, stock, bank, journal, laporan.
