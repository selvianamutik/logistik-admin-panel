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
  - rekening bank
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

### 2.2 Transaksi tunai masih punya blind spot

Saat pembayaran/pengeluaran tunai tidak diarahkan ke rekening:

- transaksi tetap tercatat di laba rugi,
- status dokumen tetap berubah,
- tetapi tidak masuk mutasi bank.

Ini bukan bug hitung saat ini, tetapi memang batas desain sistem:
aplikasi baru punya ledger rekening bank, belum punya ledger `Kas Tunai`.

### 2.3 Dashboard owner sebelumnya kurang actionable

Sebelum perbaikan, dashboard lebih menampilkan angka yang “bagus dilihat” daripada yang perlu ditindak:

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
- Penjelasan workflow sudah ditulis di `WORKFLOW.md`.
- Helper text untuk pembayaran tunai sudah ditambahkan di UI.

## 4. Yang sengaja belum dikerjakan sekarang

### 4.1 Ledger Kas Tunai terpisah

Ini perbaikan yang masuk akal, tetapi bukan patch kecil.
Kalau dikerjakan setengah-setengah, hasilnya malah menambah kebingungan.

Kapan layak dikerjakan:

- kalau operasional tunai memang dominan,
- kalau owner ingin saldo kas fisik tampil seperti rekening,
- kalau laporan arus kas harus mencakup bank + kas.

### 4.2 Memecah API besar menjadi service per domain

Ini sehat secara engineering, tetapi belum prioritas bisnis harian.
Selama rule bisnis utama masih dijaga dan test manual kuat, ini bisa ditunda.

### 4.3 Menambah dashboard analytics yang terlalu canggih

Belum perlu:

- chart kompleks
- forecast
- ranking customer
- trend mingguan berlebihan

Yang dibutuhkan owner saat ini lebih sederhana:
angka yang benar, pengingat yang jelas, dan alur yang tidak menipu.

## 5. Prioritas berikutnya yang paling masuk akal

1. Pisahkan env preview dari production.
2. Putuskan apakah `Kas Tunai` perlu menjadi ledger resmi.
3. Bersihkan sisa jejak legacy `invoice` yang masih tidak dipakai user-facing.
4. Tambahkan smoke test browser untuk flow owner yang paling penting.
