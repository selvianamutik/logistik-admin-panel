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
  Arsip slip upah supir untuk perjalanan yang memang tidak disettle lewat uang jalan trip.
- `Uang Jalan Trip`
  Settlement trip per DO: uang jalan awal, top up, biaya perjalanan aktual, upah trip, dan selisih akhir.
- `Payment`
  Pencatatan pembayaran dari customer.
- `Income`
  Pencatatan pendapatan hasil payment.
- `Expense`
  Pencatatan pengeluaran operasional.
- `Bank Transaction`
  Mutasi rekening bank dan kas.

Catatan istilah penting:

- `Customer` = pihak pengirim / perusahaan yang order jasa / pihak yang ditagih.
- `Penerima` = pihak yang menerima barang di tujuan.
- Jadi `customer` dan `receiver` memang dua pihak yang berbeda.

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
- Setiap customer sekarang bisa punya `master barang customer`.
- Saat customer dipilih di form order, dropdown barang akan difilter sesuai customer itu.
- Jika operator memilih barang dari master customer:
  - deskripsi
  - default koli
  - default berat
  - default volume
  akan terisi otomatis sebagai template.
- Operator tetap boleh mengubah angka/deskripsi di transaksi nyata bila muatan lapangan berbeda.
- Order item tetap menyimpan snapshot transaksi, jadi perubahan master barang customer di kemudian hari tidak mengubah order lama.
- Item order sekarang bisa diinput dengan unit operasional berbeda:
  - berat: `kg` atau `ton`
  - volume: `m3`, `liter`, atau `kl`
- Tetapi source of truth sistem tetap:
  - `weight` disimpan dalam `kg`
  - `volume` disimpan dalam `m3`
- Snapshot unit input asli tetap disimpan supaya UI bisa tetap menampilkan format lapangan seperti:
  - `0.24 ton (240 kg)`
  - `800 liter (0.8 m3)`

### 3.2 Buat surat jalan

- Dari order, user membuat `Delivery Order`.
- Sistem membuat nomor DO otomatis.
- Status awal DO: `CREATED`.
- Item DO direlasikan ke item order yang dibawa.
- 1 item order sekarang bisa dikirim **penuh** atau **parsial per qty**.
- Jadi sistem mendukung dua pola partial:
  - `partial per item`
    contoh: item A terkirim, item B masih pending.
  - `partial per qty`
    contoh: 1 item qty 100, dikirim 50 dulu, sisa 50 di-hold.

### 3.2.1 Partial per qty dalam item yang sama

- `qtyKoli` dan `weight` di item order tetap menyimpan total pesanan awal.
- Saat admin membuat DO, admin bisa menentukan `qty kirim` yang lebih kecil dari total item.
- Sistem menyimpan progres item:
  - `deliveredQtyKoli / deliveredWeight`
  - `assignedQtyKoli / assignedWeight`
  - `heldQtyKoli / heldWeight`
- Sisa qty yang belum masuk DO tetap dianggap `pending`.
- Sisa qty juga bisa langsung di-hold dengan alasan dan lokasi, misalnya:
  - gudang tujuan penuh
  - inap di gudang transit
- Seluruh aksi ini dicatat di audit log.

### 3.3 Jalankan pengiriman

- Status DO bergerak:
  - `CREATED`
  - `ON_DELIVERY`
  - `ARRIVED`
  - `DELIVERED`
- Saat DO berubah, status item order ikut disinkronkan.
- Status order dihitung dari status seluruh item, bukan cuma jumlah DO.
- Driver hanya boleh mengirim progres perjalanan seperti `ON_DELIVERY` atau `ARRIVED`.
- Status `DELIVERED` ditetapkan oleh admin/dispatcher, bukan oleh driver.
- Saat admin menyelesaikan DO ke `DELIVERED`, data POD diisi di langkah yang sama:
  - nama penerima
  - tanggal terima
  - catatan POD
- Saat menyelesaikan DO, admin juga sekarang mengisi **muatan aktual** per item:
  - `qty aktual`
  - `berat aktual`
  - `volume aktual`
- Sistem membedakan:
  - `muatan rencana` saat DO dibuat
  - `muatan aktual` saat DO selesai
- Sistem juga membedakan:
  - `route tagihan` = asal/tujuan kontrak yang dipakai di surat jalan dan nota
  - `realisasi drop` = titik bongkar aktual di lapangan
- Jadi satu DO bisa tetap ditagihkan `Surabaya -> Ponorogo`, tetapi realisasi drop-nya:
  - sebagian di `Malang`
  - sisanya di `Ponorogo`
  - atau bahkan ada `extra drop` ke `Jember`
- Tipe titik drop yang didukung:
  - `DROP`
  - `HOLD / INAP`
  - `TRANSIT`
  - `EXTRA_DROP`
  - `RETURN`
- Kalau admin tidak mengisi titik drop terpisah saat menyelesaikan DO, sistem otomatis membuat satu titik default ke tujuan tagihan utama.
- Total qty / berat / volume semua titik drop harus sama dengan muatan aktual final DO, supaya realisasi lapangan, progress order, dan dokumen turunan tetap konsisten.
- Kalau muatan aktual lebih kecil dari rencana, selisih qty kembali menjadi `pending` di item order.
- Kalau berat aktual lebih besar dari estimasi awal, sistem menaikkan total berat item order secukupnya agar progres dan nota tidak terpotong palsu.
- Freight Nota sekarang mengambil berat/koli dari **muatan aktual final DO**, bukan angka rencana, bila data aktual sudah tersedia.
- Jadi status selesai dan POD sekarang menjadi satu aksi operasional, bukan dua langkah terpisah.

Hasil akhirnya:

- semua item selesai -> `COMPLETE`
- sebagian sudah jalan / selesai -> `PARTIAL`
- ada hold tanpa progress kirim -> `PARTIAL`
- belum ada progress -> `OPEN`

### 3.4 Hold pada item order

- Hold sekarang tidak lagi sekadar ubah badge status.
- Hold dicatat sebagai qty yang ditahan.
- Admin bisa:
  - menahan sebagian atau seluruh sisa qty yang masih pending,
  - mengisi alasan hold,
  - mengisi lokasi hold.
- Hold bisa dipakai untuk kasus seperti:
  - gudang tujuan penuh,
  - barang inap di gudang transit,
  - dokumen belum siap,
  - menunggu slot bongkar.
- Saat hold dilepas, qty tersebut kembali menjadi `pending` dan bisa dibuatkan DO berikutnya.

## 4. Alur Nota Ongkos

### 4.1 Buat nota

- User membuat `Freight Nota`.
- Sistem membuat nomor nota otomatis.
- Status awal nota: `UNPAID`.
- Detail baris perjalanan disimpan sebagai `freightNotaItem`.
- Setiap nota sekarang menyimpan tiga angka utama:
  - `totalAmount` = tagihan bruto
  - `totalAdjustmentAmount` = total klaim / potongan yang disetujui
  - `netAmount` = tagihan netto setelah potongan

Nota ini yang sekarang dipakai sebagai tagihan ongkos angkut utama.

### 4.2 Klaim / potongan invoice

- Jika ada barang rusak, barang kurang, penalty, diskon, atau potongan lain:
  1. admin membuka detail nota,
  2. admin pilih `Klaim / Potongan`,
  3. admin isi nominal, jenis, tanggal, dan catatan,
  4. sistem membuat `invoiceAdjustment`,
  5. nilai netto nota langsung berkurang.

Jenis adjustment yang sekarang didukung:

- `DAMAGE_CLAIM`
- `SHORTAGE_CLAIM`
- `PENALTY`
- `DISCOUNT`
- `OTHER_DEDUCTION`

Rule penting:

- adjustment tidak mengubah `totalAmount` bruto,
- adjustment yang aktif mengurangi `netAmount`,
- adjustment bisa di-void oleh admin,
- kalau pembayaran yang sudah masuk melebihi netto baru, sistem menandai kondisi itu sebagai `kelebihan bayar customer`, bukan error data.

### 4.3 Terima pembayaran untuk satu nota

Saat user menambah pembayaran dari detail nota:

1. Sistem membuat `payment`.
2. Sistem membuat `income`.
3. Sistem menghitung ulang total pembayaran terhadap `netAmount`, bukan bruto.
4. Status nota disinkronkan:
   - belum ada bayar dan belum ada adjustment -> `UNPAID`
   - netto belum lunas -> `PARTIAL`
   - total bayar >= netto -> `PAID`

### 4.4 Terima satu pembayaran untuk beberapa nota

Kalau customer mentransfer satu nominal untuk beberapa nota sekaligus:

1. admin membuka daftar nota,
2. admin pilih `Terima Pembayaran`,
3. admin memilih customer,
4. admin mengisi tanggal, metode, rekening/kas masuk, nominal total receipt, dan catatan,
5. admin mengalokasikan nominal itu ke beberapa nota customer yang masih terbuka,
6. sistem membuat:
   - satu `customerReceipt`,
   - satu `income`,
   - satu `bankTransaction`,
   - beberapa `payment` allocation ke tiap nota,
7. status tiap nota dihitung ulang berdasarkan alokasi receipt itu.

Rule penting:

- satu receipt hanya untuk satu customer,
- total alokasi harus sama dengan total receipt,
- alokasi tidak boleh melebihi sisa netto tiap nota,
- receipt dipakai untuk kasus `1 transfer customer = bayar beberapa nota`.

### 4.5 Kalau metode pembayaran `TRANSFER`

- `bankAccountRef` wajib dipilih.
- Sistem membuat `bankTransaction` tipe `CREDIT`.
- Saldo rekening bertambah.

Efeknya:

- sisa tagihan berkurang,
- pendapatan tercatat,
- arus kas bank juga bertambah.

### 4.6 Kalau metode pembayaran `CASH`

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

### 4.7 Rumus status nota

Sistem sekarang memakai logika:

- `Gross` = total tagihan awal
- `Net` = gross - total adjustment approved
- `Remaining` = net - total payment allocated

Interpretasi:

- `UNPAID`
  belum ada pembayaran yang menutup netto
- `PARTIAL`
  sudah ada pembayaran, tetapi netto belum lunas
- `PAID`
  total pembayaran sudah sama atau lebih besar dari netto

## 5. Alur Borongan Supir

### 5.1 Buat slip borongan

- User membuat `Driver Borongan`.
- Sistem membuat nomor borongan otomatis.
- Status awal: `UNPAID`.
- Detail perjalanan disimpan sebagai `driverBoronganItem`.
- Dasar hitung default sekarang adalah `per DO / per perjalanan`.
- `taripBorongan` pada DO diperlakukan sebagai nilai upah tetap untuk DO itu.
- `berat` dan `collie` tetap disimpan sebagai informasi operasional, tetapi tidak menjadi pengali utama upah.

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

## 6. Alur Uang Jalan Trip

Uang jalan trip sekarang diperlakukan sebagai settlement utama per trip / per DO.

Artinya:

- `1 uang jalan = 1 DO / 1 trip`
- uang jalan wajib tertaut ke DO
- supir, kendaraan, rute, dan upah trip diturunkan dari DO
- trip yang sudah memakai uang jalan tidak boleh dobel masuk slip borongan

### 6.1 Terbitkan uang jalan

Saat uang jalan dibuat:

1. user wajib memilih `DO / trip`,
2. user wajib memilih rekening sumber,
3. sistem mengambil supir, kendaraan, rute, dan `taripBorongan` dari DO,
4. sistem membuat `driverVoucher`,
5. sistem langsung membuat `bankTransaction` tipe `DEBIT`,
6. saldo rekening sumber langsung berkurang.

Jadi uang jalan trip selalu punya konsekuensi kas/bank sejak awal.

### 6.2 Tambah biaya perjalanan

- User menambah item biaya perjalanan per trip, misalnya BBM, tol, parkir, makan, atau menginap.
- Sistem menyimpan item lalu menghitung ulang:
  - `totalSpent`
  - `totalClaimAmount`
  - `balance`

### 6.3 Settlement uang jalan

Saat bon diselesaikan:

1. setiap item biaya perjalanan diposting menjadi `expense`,
2. sistem membuat expense `Borongan Supir` untuk upah trip DO,
3. sistem menghitung selisih antara uang jalan awal vs total biaya perjalanan + upah trip,
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
- terbit uang jalan trip,
- settlement uang jalan trip,
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

Kalau supir dinonaktifkan dari admin panel:

- akun mobile driver yang terhubung ikut dinonaktifkan otomatis
- tracking aktif milik supir itu ikut dihentikan otomatis
- lock tracking pada data supir ikut dibersihkan

Kalau supir diaktifkan lagi, akun mobile tidak otomatis aktif kembali.
Owner/admin perlu membuka `Akses Mobile` lalu mengaktifkannya lagi bila memang ingin dipakai.

Kalau owner/admin menonaktifkan akun mobile driver langsung dari modal `Akses Mobile`:

- akun driver langsung nonaktif
- semua tracking `ACTIVE/PAUSED` milik supir itu ikut ditandai `STOPPED`
- lock tracking pada data supir ikut dibersihkan

Ini sengaja supaya akun yang dimatikan tidak meninggalkan tracking aktif palsu di dashboard admin.

### 14.2 Driver login dari mana

Sekarang ada 2 jalur driver:

- `Portal web driver`
  Dipakai untuk fallback / akses cepat dari browser di `/driver/login`
- `App native driver Flutter`
  Dipakai untuk operasional tracking background native di Android, dan bisa dibuild/install ke iOS juga

Rule auth-nya:

- akun driver tidak bisa dipakai di `/login`
- akun admin/owner tidak bisa dipakai di jalur driver
- APK driver login lewat endpoint mobile khusus dan menerima bearer token driver

Jadi auth driver sekarang memang dipisah dari panel internal.

### 14.3 DO mana yang muncul di HP driver

Driver hanya melihat DO yang:

- memang direlasikan ke `driverRef` driver tersebut
- statusnya masih operasional:
  - `CREATED`
  - `ON_DELIVERY`
  - `DELIVERED`

### 14.4 Cara tracking live berjalan

Di APK Android driver:

1. driver buka daftar DO
2. tekan `Mulai Tracking`
3. aplikasi meminta izin lokasi foreground dan background
4. aplikasi mengambil posisi awal
5. backend memvalidasi DO dan lock tracking supir
6. aplikasi menyalakan foreground service Android
7. background task mengirim heartbeat lokasi berkala
8. owner/admin melihat posisi terakhir di detail DO

Action yang tersedia:

- `Mulai Tracking`
- `Lanjut`

Catatan penting:

- driver tidak boleh menjeda atau menghentikan tracking sendiri selama DO masih `CREATED` atau `ON_DELIVERY`
- tracking hanya berhenti otomatis saat admin/owner menutup DO menjadi `DELIVERED` atau `CANCELLED`
- ada satu pengecualian internal: bila app gagal menyalakan service lokasi tepat setelah `Mulai Tracking`, sistem boleh melakukan rollback otomatis agar DO tidak terlihat aktif palsu

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

Kalau supir dinonaktifkan saat masih ada tracking aktif:

- tracking DO aktif/paused miliknya otomatis ditandai `STOPPED`
- sistem menambah log bahwa tracking dihentikan otomatis karena supir dinonaktifkan
- akun mobile driver ikut dinonaktifkan agar tidak ada sesi lapangan yang menggantung

Kalau driver mencoba keluar dari portal / APK saat masih ada DO yang mengunci tracking:

- sistem menolak logout
- driver harus menunggu admin benar-benar menutup DO
- ini sengaja agar posisi DO tidak hilang di tengah perjalanan

### 14.6 Apa yang tampil di admin web

Di list dan detail DO sekarang owner/admin bisa melihat:

- status tracking
- waktu `last seen`
- koordinat terakhir
- akurasi GPS
- kecepatan terakhir
- link Google Maps

### 14.7 Keterbatasan v1 yang harus dipahami

Tracking sekarang sudah punya jalur native mobile, jadi lebih kuat daripada browser HP biasa.

Tetap ada batasannya:

- Android tetap platform operasional utama
- APK debug Android sudah tervalidasi bisa dibuild lokal dari project `apps/driver_app`
- iOS juga bisa dibuild/install, tetapi background policy iPhone lebih ketat
- build `.ipa` iOS tetap butuh EAS Build / Xcode di macOS dan Apple provisioning
- izin lokasi foreground/background harus aktif
- GPS dan internet harus aktif
- kalau user force stop aplikasi atau mencabut izin lokasi, tracking background berhenti
- token driver mobile saat ini disimpan di secure storage perangkat, dengan fallback terbatas untuk environment test

Jadi v1 APK ini sudah cocok untuk background tracking Android operasional, tetapi belum berarti semua edge-case device policy sudah sempurna.

## 15. Guard penting pada Surat Jalan

### 15.1 POD

POD hanya boleh disimpan untuk DO yang statusnya sudah `DELIVERED`.

Setelah POD tersimpan:

- POD dianggap final
- tidak boleh diubah lagi lewat update umum

Kalau ada salah input, perbaikannya harus lewat workflow/admin patch yang disengaja, bukan edit bebas dari form biasa.

### 15.2 Tarip Borongan DO

Tarip borongan pada DO sekarang menjadi source of truth untuk upah trip.

Maknanya saat ini:

- itu adalah `tarif upah per DO / per perjalanan`
- bukan tarif per kg
- saat uang jalan trip dibuat, nilai ini otomatis menjadi `upah trip`
- kalau trip memang tidak disettle lewat uang jalan dan memakai slip borongan, nilai ini juga menjadi `upah` baris tersebut

Tetapi:

- DO yang `CANCELLED` tidak boleh diubah taripnya
- kalau DO sudah masuk ke slip borongan, tarip dan keterangannya tidak boleh diubah lagi
- kalau DO sudah punya uang jalan trip, DO itu tidak boleh dimasukkan lagi ke slip borongan

Ini supaya data DO tidak drift dengan workflow settlement trip yang sudah terbentuk.

## 16. Guard penting pada Order

Kalau order belum punya surat jalan:

- field utama order masih boleh diedit
- misalnya customer, kategori armada, penerima, dan catatan

Kalau order sudah punya minimal satu surat jalan:

- field utama order dikunci
- yang masih boleh diubah hanya `catatan`

Field yang dikunci setelah ada surat jalan:

- customer
- kategori armada
- nama penerima
- telepon penerima
- alamat penerima
- perusahaan penerima
- pickup address

Tujuannya supaya order tidak drift dengan DO, nota, dan dokumen turunan yang sudah terbentuk.

## 17. Workflow Manajemen Ban

- Setiap ban dicatat sebagai aset fisik dengan `kode ban` unik, bukan sekadar teks posisi.
- Lokasi ban saat ini wajib jelas:
  - `Kendaraan internal`
  - `Serep unit`
  - `Gudang / stok`
  - `Dipinjam keluar`
  - `Afkir`
- Untuk kendaraan internal, posisi ban tidak lagi bebas. Gunakan `slot code` standar:
  - `1L`, `1R`
  - `2L`, `2R`
  - `2LI`, `2LO`, `2RI`, `2RO`
  - `3L`, `3R`
  - `SP1`, `SP2`, `SP3`
- Arti kode:
  - angka = urutan as dari depan ke belakang
  - `L` / `R` = kiri / kanan
  - `I` / `O` = dalam / luar untuk ban ganda
  - `SP` = slot serep pada unit
- Ban `IN_USE` tidak boleh memakai slot `SP`.
- Ban `SPARE` wajib memakai slot `SP`.
- Satu slot aktif pada kendaraan internal hanya boleh ditempati satu ban.
- Ban yang dipinjam ke kendaraan / pihak luar disimpan dengan status `LOANED_OUT` dan identitas pihak luar atau plat luar.
- Ban gudang disimpan dengan status `IN_WAREHOUSE`.
- Ban rusak berat / tidak layak pakai disimpan dengan status `SCRAPPED`.
- Halaman `Manajemen Ban` menampilkan posisi aktual ban saat ini, bukan asumsi dari teks manual lama.
- Detail kendaraan menampilkan ban terpasang dan serep unit berdasarkan status/slot, bukan lagi berdasarkan `replaceDate`.
- Create / update / delete catatan ban tetap keluar di audit log per user.
