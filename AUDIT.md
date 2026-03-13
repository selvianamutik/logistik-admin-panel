# AUDIT OWNER LEVEL

Dokumen ini adalah audit brutal-truth terhadap kondisi aplikasi saat ini.
Fokusnya bukan menambah fitur sebanyak mungkin, tetapi memastikan owner tahu:

- apa yang sudah cukup baik,
- apa yang masih lemah,
- apa yang sudah diperbaiki,
- apa yang sengaja belum dikerjakan karena belum sepadan biayanya.

## 1. Yang sudah cukup baik

- Flow inti bisnis sudah jalan:
  - order
  - surat jalan
  - nota ongkos
  - pembayaran
  - borongan supir
  - bon supir
  - pengeluaran
  - rekening dan kas
  - laporan
- Gate teknis sudah hidup:
  - lint
  - typecheck
  - build
- Workflow finansial utama sudah lebih aman:
  - pembayaran nota sinkron ke status tagihan
  - borongan dibayar lewat action backend
  - bon supir punya pencairan dan settlement yang tercatat

## 2. Brutal truth: yang masih lemah

### 2.1 Aplikasi masih membawa 2 model billing

Masih ada jejak entity lama `invoice` dan flow baru `freightNota`.
Kalau dibiarkan, ini bikin data dan UI tidak konsisten:

- dashboard bisa menampilkan angka tagihan yang salah,
- detail customer/order bisa terlihat kosong padahal nota ada,
- user bingung karena istilah `invoice` dan `nota` dipakai campur.

Kesimpulan:
masalah terbesar aplikasi sekarang bukan kekurangan fitur, tetapi sisa konsep lama yang belum dibersihkan.

### 2.2 Transaksi tunai sebelumnya punya blind spot

Sebelumnya transaksi tunai membuat user bingung karena:

- transaksi tetap tercatat di laba rugi,
- status dokumen tetap berubah,
- tetapi saldo kas tidak ikut bergerak.

Gap ini sekarang sudah ditutup dengan akun sistem `Kas Tunai`.

### 2.3 Dashboard owner sebelumnya kurang actionable

Sebelum perbaikan, dashboard lebih menampilkan angka yang "bagus dilihat" daripada yang perlu ditindak:

- tagihan aktif tidak membaca nota yang benar,
- tidak mengingatkan borongan belum bayar,
- tidak mengingatkan bon supir belum settle.

### 2.4 API pusat masih terlalu besar

`src/app/api/data/route.ts` masih menjadi pusat hampir semua rule bisnis.
Ini masih workable untuk sekarang, tapi tetap titik risiko maintenance paling besar.

### 2.5 Preview dan production masih berbahaya bila berbagi data

Kalau preview memakai env/data yang sama dengan production:

- testing bisa mengotori data live,
- bug operasional sulit dilokalisasi,
- user bisa keliru mengira preview aman untuk uji transaksi.

## 3. Yang sudah diperbaiki di putaran audit ini

- Dashboard sekarang membaca nota aktif (`freightNota`), bukan invoice legacy.
- Dashboard owner sekarang lebih actionable:
  - ada pengingat borongan belum dibayar
  - ada pengingat bon supir belum settle
- Detail customer sekarang menampilkan `Nota Ongkos`, bukan invoice legacy.
- Detail order sekarang menampilkan `Nota Ongkos` yang benar-benar terkait ke DO order itu.
- Tombol `Buat Invoice` legacy di detail order dihapus dari alur aktif.
  Sekarang user diarahkan ke flow nota yang benar.
- Laporan owner sekarang menghitung tagihan aktif dari `Nota Ongkos`, bukan lagi mencampur invoice legacy.
- Kalau invoice legacy masih ada, laporan menampilkannya sebagai catatan historis, bukan angka operasional aktif.
- Jalur write API untuk `invoice` legacy sekarang dibekukan agar tidak ada dual-billing baru.
- Akun sistem `Kas Tunai` sekarang tersedia otomatis dan bisa dipakai lintas modul.
- Pembayaran `CASH` tanpa rekening pilihan sekarang otomatis masuk ke `Kas Tunai`.
- Pembayaran borongan `CASH` tanpa rekening pilihan sekarang otomatis masuk ke `Kas Tunai`.
- Modul rekening sekarang menjadi sumber kebenaran untuk rekening bank dan kas tunai.
- Penjelasan workflow sudah ditulis di `WORKFLOW.md`.
- Helper text untuk pembayaran tunai sudah ditambahkan di UI.

## 4. Yang sengaja belum dikerjakan sekarang

### 4.1 Memecah API besar menjadi service per domain

Ini sehat secara engineering, tetapi belum prioritas bisnis harian.
Selama rule bisnis utama masih dijaga dan test manual kuat, ini bisa ditunda.

### 4.2 Menambah dashboard analytics yang terlalu canggih

Belum perlu:

- chart kompleks
- forecast
- ranking customer
- trend mingguan berlebihan

Yang dibutuhkan owner saat ini lebih sederhana:
angka yang benar, pengingat yang jelas, dan alur yang tidak menipu.

## 5. Prioritas berikutnya yang paling masuk akal

1. Pisahkan env preview dari production.
2. Putuskan apakah histori `invoice` legacy akan dimigrasikan penuh ke `freightNota` atau cukup dibiarkan read-only.
3. Tambahkan smoke test browser untuk flow owner yang paling penting.
4. Pertimbangkan pagination/report optimization kalau volume data mulai besar.

## 6. Catatan baru: tracking driver live

Tracking driver sekarang sudah naik satu level:

- backend auth mobile driver sudah dipisah dari login web biasa
- ada jalur bearer token untuk app native driver
- ada project APK Android terpisah di `driver-mobile/`
- tracking background Android sekarang memakai foreground service + background location task

Lifecycle supir juga tetap dijaga:

- supir yang punya akun mobile tidak bisa dihapus
- menonaktifkan supir akan ikut menonaktifkan akun mobile driver dan menghentikan tracking aktifnya

Brutal truth-nya:

- ini sudah jauh lebih layak untuk operasional lapangan dibanding browser HP
- tapi belum berarti semua risiko device-level hilang
- iOS belum jadi fokus utama
- token driver mobile saat ini masih disimpan lokal di aplikasi agar task background bisa membacanya

Jadi secara produk:

- untuk kebutuhan internal owner/admin memantau posisi driver per DO, ini sudah layak dipakai
- untuk kebutuhan tracking lintas platform yang sangat ketat seperti aplikasi kurir besar, masih ada fase hardening berikutnya
