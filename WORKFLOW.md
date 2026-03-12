# WORKFLOW LOGISTIK

Dokumen ini menjelaskan alur kerja sistem berdasarkan kode aktif di repo ini.
Fokusnya bukan teori bisnis umum, tetapi perilaku aplikasi yang sekarang benar-benar berjalan.

## 1. Dokumen inti dalam sistem

- `Order / Resi`
  Dipakai untuk menerima order dari customer.
- `Delivery Order / Surat Jalan`
  Dipakai untuk menjalankan pengiriman per batch / per kendaraan / per supir.
- `Freight Nota / Nota Ongkos`
  Tagihan ongkos angkut ke customer.
- `Driver Borongan`
  Slip upah supir berdasarkan hasil pengiriman.
- `Driver Voucher / Bon Supir`
  Uang jalan yang diberikan ke supir sebelum/selama perjalanan.
- `Payment`
  Pencatatan pembayaran dari customer.
- `Income`
  Pencatatan pendapatan hasil payment.
- `Expense`
  Pencatatan pengeluaran operasional.
- `Bank Transaction`
  Mutasi rekening bank dan kas.

## 2. Prinsip akuntansi yang dipakai aplikasi

Sistem saat ini memisahkan dua hal:

- `Laba Rugi`
  Sumber data: `payment` dan `expense`.
- `Arus Kas`
  Sumber data: `bankTransaction`.

Artinya:

- transaksi bisa tercatat di laba rugi tetapi tidak muncul di arus kas,
- itu terjadi kalau transaksi tersebut tidak diposting ke akun keuangan.
- untuk metode `CASH`, sistem sekarang otomatis memakai akun `Kas Tunai` bila user tidak memilih rekening.

## 3. Alur Order -> DO

### 3.1 Buat order

- User membuat `Order`.
- Sistem membuat nomor resi otomatis.
- Status awal order: `OPEN`.
- Item barang disimpan sebagai `orderItem`.

### 3.2 Buat surat jalan

- Dari order, user membuat `Delivery Order`.
- Sistem membuat nomor DO otomatis.
- Status awal DO: `CREATED`.
- Item DO direlasikan ke item order yang dibawa.

### 3.3 Jalankan pengiriman

- Status DO bergerak:
  - `CREATED`
  - `ON_DELIVERY`
  - `DELIVERED`
- Saat DO berubah, status item order ikut disinkronkan.
- Status order dihitung dari status seluruh item, bukan cuma jumlah DO.

Hasil akhirnya:

- semua item selesai -> `COMPLETE`
- sebagian sudah jalan / selesai -> `PARTIAL`
- ada hold tanpa progress kirim -> `ON_HOLD`
- belum ada progress -> `OPEN`

## 4. Alur Nota Ongkos

### 4.1 Buat nota

- User membuat `Freight Nota`.
- Sistem membuat nomor nota otomatis.
- Status awal nota: `UNPAID`.
- Detail baris perjalanan disimpan sebagai `freightNotaItem`.

Nota ini yang sekarang dipakai sebagai tagihan ongkos angkut utama.

### 4.2 Terima pembayaran customer

Saat user menambah pembayaran di detail nota:

1. Sistem membuat `payment`.
2. Sistem membuat `income`.
3. Sistem menghitung ulang total pembayaran untuk tagihan itu.
4. Status nota disinkronkan:
   - belum ada bayar -> `UNPAID`
   - bayar sebagian -> `PARTIAL`
   - total bayar >= total tagihan -> `PAID`

### 4.3 Kalau metode pembayaran `TRANSFER`

- `bankAccountRef` wajib dipilih.
- Sistem membuat `bankTransaction` tipe `CREDIT`.
- Saldo rekening bertambah.

Efeknya:

- sisa tagihan berkurang,
- pendapatan tercatat,
- arus kas bank juga bertambah.

### 4.4 Kalau metode pembayaran `CASH`

- pembayaran tetap membuat `payment`,
- pembayaran tetap membuat `income`,
- sisa tagihan tetap berkurang,
- status nota tetap disinkronkan.

Jika user tidak memilih rekening:

- sistem otomatis mem-posting ke akun `Kas Tunai`,
- sistem membuat `bankTransaction`,
- saldo kas tunai bertambah,
- transaksi muncul di tab `Arus Kas`.

Jadi perilaku saat ini adalah:

- `Tunai` = tercatat sebagai pendapatan / pelunasan,
- `Tunai tanpa rekening pilihan` = dianggap masuk ke `Kas Tunai`.

## 5. Alur Borongan Supir

### 5.1 Buat slip borongan

- User membuat `Driver Borongan`.
- Sistem membuat nomor borongan otomatis.
- Status awal: `UNPAID`.
- Detail perjalanan disimpan sebagai `driverBoronganItem`.

### 5.2 Bayar borongan

Saat user menekan bayar:

1. Sistem validasi total pembayaran harus sama dengan total borongan.
2. Sistem membuat `expense` kategori `Borongan Supir`.
3. Sistem mengubah status borongan menjadi `PAID`.

### 5.3 Kalau metode `TRANSFER`

- rekening wajib dipilih,
- sistem membuat `bankTransaction` tipe `DEBIT`,
- saldo rekening berkurang.

### 5.4 Kalau metode `CASH`

- expense tetap tercatat,
- status borongan tetap jadi `PAID`,
- jika rekening kosong, sistem otomatis memakai akun `Kas Tunai`.

Efeknya:

- muncul di `Laba Rugi` sebagai pengeluaran,
- muncul juga di `Arus Kas` sebagai mutasi kas tunai.

## 6. Alur Bon Supir

Bon supir berbeda dari borongan.
Bon adalah uang jalan di depan, bukan upah akhir.

### 6.1 Terbitkan bon

Saat bon dibuat:

1. user wajib memilih rekening sumber,
2. sistem membuat `driverVoucher`,
3. sistem langsung membuat `bankTransaction` tipe `DEBIT`,
4. saldo rekening sumber langsung berkurang.

Jadi bon supir selalu punya konsekuensi kas/bank sejak awal.

### 6.2 Tambah item bon

- User menambah item pengeluaran per bon.
- Sistem menyimpan item lalu menghitung ulang:
  - `totalSpent`
  - `balance`

### 6.3 Settlement bon

Saat bon diselesaikan:

1. setiap item bon diposting menjadi `expense`,
2. sistem menghitung selisih antara uang yang diberikan vs pengeluaran,
3. jika ada sisa:
   - sistem membuat `bankTransaction` `CREDIT`,
   - artinya uang kembali ke rekening,
4. jika ada kekurangan:
   - sistem membuat `bankTransaction` `DEBIT`,
   - artinya perusahaan menambah uang,
5. status bon menjadi `SETTLED`.

## 7. Alur Expense umum

Saat user membuat pengeluaran biasa:

- sistem membuat `expense`,
- jika user memilih rekening bank:
  - sistem membuat `bankTransaction` `DEBIT`,
  - saldo rekening berkurang.

Kalau user ingin pengeluaran tunai ikut mengurangi saldo kas:

- pilih akun `Kas Tunai` pada field rekening / kas.

Kalau tidak memilih akun apa pun:

- pengeluaran tetap masuk laba rugi,
- tetapi tidak masuk arus kas.

## 8. Alur Rekening dan Kas

### 8.1 Fungsi modul rekening

Modul ini sekarang merepresentasikan:

- rekening bank,
- akun `Kas Tunai`.

### 8.2 Apa saja yang mengubah saldo rekening / kas

- payment customer yang diarahkan ke rekening,
- payment tunai yang otomatis masuk ke `Kas Tunai`,
- pembayaran borongan yang diarahkan ke rekening,
- pembayaran borongan tunai yang otomatis masuk ke `Kas Tunai`,
- expense yang diarahkan ke rekening,
- terbit bon supir,
- settlement bon supir,
- transfer antar rekening.

### 8.3 Apa yang tidak mengubah saldo rekening / kas

- transaksi yang memang tidak diposting ke akun apa pun.

## 9. Alur Laporan

### 9.1 Tab `Laba Rugi`

Sumber:

- semua `payment`
- semua `expense`

Artinya:

- pembayaran customer masuk sebagai pendapatan,
- pengeluaran operasional masuk sebagai biaya,
- transaksi tunai tetap masuk ke tab ini.

### 9.2 Tab `Arus Kas`

Sumber:

- semua `bankTransaction`

Sekarang tab ini mencakup:

- rekening bank,
- akun sistem `Kas Tunai`.

Jadi arus kas saat ini bukan hanya mutasi bank, tetapi mutasi bank + kas yang memang diposting ke ledger.

### 9.3 Ringkasan tagihan yang aktif

Untuk owner, ringkasan tagihan aktif sekarang dihitung dari:

- `Freight Nota / Nota Ongkos`

Bukan dari `invoice` legacy.

Kalau masih ada data `invoice` lama di dataset:

- itu hanya referensi historis,
- tidak lagi dihitung sebagai tagihan operasional aktif di dashboard dan laporan owner.

## 10. Jawaban atas kebingungan "kalau tunai kenapa tidak berkurang / tidak berubah?"

Jawabannya tergantung dokumen apa yang sedang dilihat.

### 10.1 Kalau yang dimaksud `sisa tagihan nota`

Harusnya berkurang.

Karena pembayaran tunai tetap:

- membuat `payment`,
- membuat `income`,
- menyinkronkan status nota.

### 10.2 Kalau yang dimaksud `saldo kas / arus kas`

Sekarang juga harus berubah.

Karena untuk metode `CASH`:

- jika user tidak memilih rekening,
- sistem otomatis memakai akun `Kas Tunai`,
- sistem membuat `bankTransaction`,
- saldo `Kas Tunai` ikut bergerak.

### 10.3 Jadi tunai tercatat di mana?

Saat ini tunai tercatat sebagai:

- `payment` + `income` untuk pembayaran customer,
- `expense` untuk pengeluaran,
- `bankTransaction` pada akun `Kas Tunai` bila tidak diarahkan ke rekening bank tertentu.

## 11. Keterbatasan desain saat ini

Yang belum ada sekarang bukan ledger kas, tetapi rincian kas yang lebih detail.

Contohnya belum ada:

- lebih dari satu kas fisik,
- petty cash per cabang,
- approval atau closing kas harian,
- rekonsiliasi setoran kas ke bank secara formal.

Saat ini sistem baru punya satu akun sistem:

- `Kas Tunai`

Itu sudah cukup untuk operasional dasar, tapi belum cocok kalau nanti perusahaan butuh kontrol kas multi-lokasi.

## 12. Rekomendasi operasional sekarang

- Jika uang masuk atau keluar lewat rekening, pilih rekening yang sesuai.
- Jika transaksi terjadi tunai, gunakan metode `CASH`.
- Bila field rekening dibiarkan kosong pada transaksi tunai, sistem otomatis memakai `Kas Tunai`.
- Gunakan tab `Laba Rugi` untuk melihat performa usaha.
- Gunakan tab `Arus Kas` untuk melihat mutasi rekening bank dan kas tunai yang benar-benar tercatat.

## 13. Istilah yang perlu dibedakan

- `Invoice` lama
  Dokumen legacy yang masih disimpan untuk kompatibilitas histori.
- `Freight Nota / Nota Ongkos`
  Dokumen tagihan ongkos aktif yang sekarang dipakai di modul `/invoices`.

Kalau ada data lama dengan prefix `INV-...`, itu adalah histori domain lama, bukan tagihan aktif baru.

## 14. Workflow Tracking Driver Live

Fitur ini sekarang dipisah dari admin panel biasa.
Owner atau admin membuat akun mobile driver dari menu `Supir`, bukan dari `User Management`.

### 14.1 Siapa yang membuat akun driver

- owner/admin membuka modul `Supir`
- pilih satu supir
- klik `Akses Mobile`
- isi:
  - nama akun
  - email login
  - password awal
  - status aktif

Satu supir hanya boleh punya satu akun mobile driver aktif.

### 14.2 Driver login dari mana

- driver login dari halaman `/driver/login`
- akun driver tidak bisa dipakai di `/login`
- akun admin/owner juga tidak bisa dipakai di `/driver/login`

Ini sengaja dipisah supaya tidak campur dengan panel internal.

### 14.3 DO mana yang muncul di HP driver

Driver hanya melihat DO yang:

- memang direlasikan ke `driverRef` driver tersebut
- statusnya masih operasional:
  - `CREATED`
  - `ON_DELIVERY`
  - `DELIVERED`

### 14.4 Cara tracking live berjalan

Di HP driver:

1. driver buka DO
2. tekan `Mulai Tracking`
3. browser meminta izin lokasi GPS
4. sistem mengirim lokasi awal lalu heartbeat berkala
5. owner/admin bisa melihat posisi terakhir di detail DO

Action yang tersedia:

- `Mulai Tracking`
- `Jeda`
- `Lanjut`
- `Stop`

### 14.5 Dampaknya ke status DO

Kalau tracking dimulai saat status DO masih `CREATED`:

- sistem otomatis menaikkan status DO ke `ON_DELIVERY`
- sistem menambah log tracking

Kalau tracking dijalankan saat DO sudah `ON_DELIVERY`:

- sistem hanya menambah log tracking dan update posisi

Kalau admin atau owner menutup DO menjadi `DELIVERED` atau `CANCELLED`:

- tracking DO otomatis ditandai `STOPPED`
- lock tracking aktif pada data supir ikut dilepas
- jadi supir tidak nyangkut di sesi tracking lama saat menerima DO berikutnya

### 14.6 Apa yang tampil di admin web

Di list dan detail DO sekarang owner/admin bisa melihat:

- status tracking
- waktu `last seen`
- koordinat terakhir
- akurasi GPS
- kecepatan terakhir
- link Google Maps

### 14.7 Keterbatasan v1 yang harus dipahami

Ini tracking live berbasis browser HP, bukan native app.

Artinya:

- tracking hanya akurat selama halaman driver tetap terbuka
- izin GPS harus tetap aktif
- internet harus tetap aktif
- kalau browser/app ditutup penuh, tracking tidak jalan di background

Jadi v1 ini cocok untuk operasional internal sederhana, tapi belum setara aplikasi native background tracking.
