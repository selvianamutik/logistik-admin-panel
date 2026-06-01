# UAT Uang Jalan Trip - Total Biaya dan Bon Ketiga Penutupan

Tanggal dibuat: 2026-05-29
Scope build: perubahan label dan perhitungan tampilan Uang Jalan Trip setelah commit `dc65a69`.

Dokumen ini dipakai untuk mengetes perubahan tampilan dan alur penyelesaian Uang Jalan Trip. Fokusnya adalah memastikan istilah `Sisa Bon Operasional` sudah tidak dipakai, `Total Biaya` tampil konsisten, dan `Bon Ketiga Penutupan` mengikuti rumus yang diminta client tanpa mengubah workflow data, jurnal, bank, DO, SJ, atau invoice.

## Tujuan UAT

- Memastikan halaman Uang Jalan Trip memakai istilah dan angka yang mudah dipahami client.
- Memastikan `Total Biaya` dihitung dari `Upah Borongan + Biaya Lain-lain`.
- Memastikan penutupan tidak menampilkan `Bon Ke-4` walaupun sudah ada bon tambahan sebelumnya.
- Memastikan modal penyelesaian tetap mencatat sisa uang yang benar untuk dibayar/dikembalikan.
- Memastikan perubahan tampil konsisten di halaman detail, list, print, trip detail, driver portal, laporan, dan profil driver.

## Akun Tester

| Aplikasi | Role | Email | Password | Dipakai untuk |
| --- | --- | --- | --- | --- |
| Web Admin | OWNER | owner@company.local | owner12345 | Cek semua menu, edit uang jalan, print, laporan |
| Web Admin | OPERASIONAL | admin@company.local | admin12345 | Cek workflow operasional DO/SJ/trip |
| Web Admin | FINANCE | finance@company.local | admin12345 | Cek jurnal, rekening/kas, laporan |
| Portal Driver | DRIVER | driver.agus@company.local | driver12345 | Cek tampilan uang jalan dari sisi driver bila voucher terkait driver ini |

## Definisi Perhitungan yang Harus Sama

| Istilah UI | Rumus / Sumber Data | Catatan Validasi |
| --- | --- | --- |
| Bon Pertama | Nominal awal saat voucher diterbitkan | Tidak berubah dari workflow lama. |
| Bon Kedua | Bon tambahan pertama setelah Bon Pertama | Bila ada lebih dari satu tambahan, history tetap tampil, tetapi label penutupan tidak boleh menjadi Bon Ke-4. |
| Total Bon Tambahan | Total semua bon tambahan yang sudah diberikan | Termasuk bon tambahan yang sebelumnya sudah dicairkan. |
| Total Uang Diberikan | Bon Pertama + Total Bon Tambahan | Ini adalah uang yang sudah keluar ke driver. |
| Biaya Lain-lain | Total item biaya lain-lain pada voucher/trip | Contoh: konsumsi, parkir, biaya insiden yang memang masuk voucher. |
| Upah Borongan | Upah final DO/trip | Mengikuti workflow existing: dasar DO + overtonase bila final aktual sudah ada. |
| Total Biaya | Upah Borongan + Biaya Lain-lain | Ini pengganti istilah `Sisa Bon Operasional` di konteks ringkasan. |
| Bon Ketiga Penutupan | Total Biaya - Bon Pertama - Bon Kedua | Dipakai sebagai label client untuk penutupan. Tidak boleh tampil sebagai Bon Ke-4/Ke-5. |
| Sisa dicairkan saat penutupan | Total Biaya - Total Uang Diberikan | Bila sebagian Bon Ketiga sudah pernah dicairkan, angka ini bisa lebih kecil dari `Bon Ketiga Penutupan`. |
| Pengembalian Sisa Bon | Total Uang Diberikan - Total Biaya | Dipakai bila uang yang sudah diberikan lebih besar dari total biaya. |

## Data Uji Utama

Gunakan data staging/local. Bila data contoh belum ada, buat data baru dengan pola di bawah.

| Kode Data | Kondisi | Nilai Uji | Expected Ringkas |
| --- | --- | --- | --- |
| DATA-A | Total biaya lebih besar dari uang diberikan, sudah ada Bon Ketiga tercatat | Bon 1 Rp1.000.000, Bon 2 Rp3.000.000, Bon 3 tercatat Rp100.000, Biaya Lain-lain Rp100.000, Upah Borongan Rp4.100.000 | Total Biaya Rp4.200.000, Bon Ketiga Penutupan Rp200.000, Sisa dicairkan saat penutupan Rp100.000 |
| DATA-B | Total biaya lebih besar dari uang diberikan, belum ada Bon Ketiga tercatat | Bon 1 Rp1.000.000, Bon 2 Rp3.000.000, Biaya Lain-lain Rp100.000, Upah Borongan Rp4.100.000 | Total Biaya Rp4.200.000, Bon Ketiga Penutupan Rp200.000, sisa dicairkan Rp200.000 atau tidak ada baris sisa terpisah bila nominal sama |
| DATA-C | Uang diberikan lebih besar dari total biaya | Bon total Rp5.000.000, Biaya Lain-lain Rp100.000, Upah Borongan Rp4.100.000 | Total Biaya Rp4.200.000, Pengembalian Sisa Bon Rp800.000 |
| DATA-D | Uang diberikan sama dengan total biaya | Bon total Rp4.200.000, Biaya Lain-lain Rp100.000, Upah Borongan Rp4.100.000 | Total Biaya Rp4.200.000, tidak ada selisih yang perlu dibayar/dikembalikan |
| DATA-E | DO belum punya final aktual/overtonase final | Uang jalan sudah terbit, final aktual belum selesai | Upah borongan mengikuti status existing dan UI tidak crash; bila menunggu final, teks menunggu tetap konsisten |

## Cara Menjalankan UAT

1. Pull build terbaru dari `main`.
2. Jalankan web admin lokal atau staging yang akan dites.
3. Login sebagai OWNER.
4. Buka menu `Uang Jalan Trip`.
5. Pilih voucher sesuai data uji.
6. Untuk test visual non-mutasi, jangan klik tombol final `Selesaikan & Catat ...`.
7. Untuk test penyelesaian end-to-end, gunakan data dummy/staging, pilih rekening/kas, lalu klik tombol final.
8. Setelah test mutasi, cek ulang data di `Rekening & Kas`, `Jurnal Umum`, `Laporan Keuangan`, `Trip Detail`, dan `Driver`.

## Checklist UAT

| ID | Prioritas | Modul | Skenario | Data Uji | Cara Test Detail | Output yang Diharapkan | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UJT-01 | P0 | Pull & build | Pastikan branch terbaru sebelum test | Repo lokal | Jalankan `git pull --ff-only origin main`, lalu `npm run typecheck`, `npm run lint`, `npm run build`. | Pull sukses/up to date. Typecheck dan build sukses. Lint 0 error; warning unused yang sudah ada boleh dicatat tetapi tidak boleh ada error baru. | Belum Dites |
| UJT-02 | P0 | Detail Uang Jalan | Ringkasan DATA-A menampilkan angka client | DATA-A | Buka `Uang Jalan Trip > Detail`. Cocokkan kartu ringkasan bagian atas. | Tampil `Total Uang Diberikan Rp4.100.000`, `Biaya Lain-lain Rp100.000`, `Total Biaya Rp4.200.000`, `Upah Borongan Rp4.100.000`, `Bon Ketiga Penutupan Rp200.000`. | Belum Dites |
| UJT-03 | P0 | Detail Uang Jalan | Label lama tidak muncul | DATA-A | Di halaman detail, cari teks tampilan secara visual atau browser find. | Tidak ada teks `Sisa Bon Operasional`. Tidak ada `Bon Ke-4` atau `Bon Ke-5`. | Belum Dites |
| UJT-04 | P0 | Detail Uang Jalan | Penjelasan Bon Ketiga jelas | DATA-A | Baca deskripsi di bawah kartu `Bon Ketiga Penutupan`. | Teks menjelaskan total biaya dikurangi Bon Pertama dan Bon Kedua. Bila sudah ada bon penutup, tampil `Sudah tercatat di bon penutup Rp100.000, sisa dicairkan saat penutupan Rp100.000`. | Belum Dites |
| UJT-05 | P0 | Modal Selesaikan Trip | Ringkasan modal tidak dobel/salah label | DATA-A | Klik `Selesaikan Trip`, jangan submit. Lihat ringkasan paling atas modal. | Modal menampilkan berurutan: `Total Uang Diberikan Rp4.100.000`, `Biaya Lain-lain Rp100.000`, `Total Biaya Rp4.200.000`, `Bon Ketiga Penutupan Rp200.000`. Tidak ada label dobel `Total Biaya`. | Belum Dites |
| UJT-06 | P0 | Modal Selesaikan Trip | Rekening/kas wajib saat ada selisih | DATA-A | Di modal, kosongkan rekening/kas lalu klik tombol final pada data dummy. | Sistem menolak dan menampilkan warning pilih rekening penyelesaian. Data voucher tidak berubah. | Belum Dites |
| UJT-07 | P0 | Modal Selesaikan Trip | Submit penutupan membayar sisa yang benar | DATA-A dummy | Pilih rekening/kas, klik `Selesaikan & Catat Bon Penutupan`. | Voucher menjadi selesai. Transaksi kas/bank yang tercatat untuk pencairan penutupan adalah sisa Rp100.000, bukan Rp200.000 dobel. Riwayat tetap menjelaskan Bon Ketiga Penutupan Rp200.000. | Belum Dites |
| UJT-08 | P0 | Modal Selesaikan Trip | Kasus belum ada Bon Ketiga tercatat | DATA-B | Buka modal penyelesaian. | `Bon Ketiga Penutupan Rp200.000`. Bila nominal display sama dengan sisa bayar, tidak wajib ada baris `Sisa dicairkan saat penutupan`; bila ada, nilainya tetap Rp200.000. | Belum Dites |
| UJT-09 | P0 | Modal Selesaikan Trip | Kasus uang driver harus dikembalikan | DATA-C | Buka detail dan modal penyelesaian. | Label berubah menjadi `Pengembalian Sisa Bon Rp800.000`. Warna mengikuti status pengembalian. Tidak tampil `Bon Ketiga Penutupan` untuk kondisi uang berlebih. | Belum Dites |
| UJT-10 | P0 | Modal Selesaikan Trip | Kasus tidak ada selisih | DATA-D | Buka detail dan modal penyelesaian. | Tampil bahwa tidak ada selisih yang perlu dibayar/dikembalikan. Rekening/kas tidak wajib bila balance 0. Submit tidak membuat transaksi kas/bank tambahan. | Belum Dites |
| UJT-11 | P0 | List Uang Jalan Trip | Kolom list memakai `Total Biaya` | DATA-A/B/C | Buka `Uang Jalan Trip`, cari voucher. | List menampilkan kolom/nilai `Total Biaya`. Tidak ada kolom `Sisa Bon Operasional`. Angka list konsisten dengan detail. | Belum Dites |
| UJT-12 | P0 | Print Uang Jalan | Print ringkasan sesuai istilah baru | DATA-A | Di detail voucher, klik `Print`, lihat preview. | Print menampilkan `Total Biaya`, `Biaya Lain-lain`, `Bon Ketiga Penutupan`, dan `Sisa dicairkan saat penutupan` bila relevan. Tidak ada `Sisa Bon Operasional`/`Bon Ke-4`. | Belum Dites |
| UJT-13 | P0 | Trip Detail | Kartu uang jalan di detail trip konsisten | DATA-A | Buka DO/trip yang terkait voucher, cek section uang jalan/linked voucher. | Angka `Total Biaya`, `Bon Ketiga Penutupan`, dan sisa dicairkan sama dengan halaman Uang Jalan Trip. | Belum Dites |
| UJT-14 | P0 | Driver Portal | Tampilan driver tidak mismatch | Voucher terkait driver test | Login portal driver, buka trip/uang jalan terkait. | Driver melihat istilah `Total Biaya` dan angka yang sama dengan admin. Tidak ada label lama. | Belum Dites |
| UJT-15 | P0 | Laporan Keuangan | Laporan tidak memakai istilah lama | Data voucher selesai/belum selesai | Buka `Laporan Keuangan` dan laporan yang memuat uang jalan. | Tampilan laporan memakai `Total Biaya` bila konteks uang jalan muncul. Angka tidak berubah dari sumber voucher. | Belum Dites |
| UJT-16 | P0 | Profil Driver | Riwayat uang jalan driver konsisten | Driver pemilik DATA-A | Buka `Fleet > Supir > Detail`, cek riwayat uang jalan. | Total biaya dan penyelesaian yang tampil sama dengan detail voucher. Tidak ada `Sisa Bon Operasional`. | Belum Dites |
| UJT-17 | P1 | Tambah Uang Jalan | Top-up sebelum penyelesaian tidak mengubah rumus salah | DATA-B | Tambahkan Bon Ketiga Rp100.000 pada voucher dummy, lalu buka detail dan modal. | `Total Uang Diberikan` naik sesuai top-up. `Bon Ketiga Penutupan` tetap dihitung dari Total Biaya - Bon 1 - Bon 2. `Sisa dicairkan saat penutupan` turun sesuai top-up yang sudah tercatat. | Belum Dites |
| UJT-18 | P1 | Edit Biaya Lain-lain | Perubahan biaya lain-lain langsung mengubah total biaya | Voucher dummy | Tambah/edit/hapus biaya lain-lain, refresh detail. | `Biaya Lain-lain` berubah sesuai item. `Total Biaya` berubah sebesar selisih biaya. Nilai penutupan ikut berubah tanpa perlu edit manual. | Belum Dites |
| UJT-19 | P1 | Aktual DO/Overtonase | Upah borongan berubah karena final aktual | Voucher terkait DO dengan overtonase | Ubah/approve final aktual DO sesuai workflow, lalu buka voucher. | `Upah Borongan` dan `Total Biaya` mengikuti final DO. Tidak ada mismatch dengan detail DO. | Belum Dites |
| UJT-20 | P1 | Hak akses | Role non-finance/non-owner tidak bisa memaksa penyelesaian bila tidak punya hak | Login role terbatas | Login role yang tidak punya hak settle, buka detail voucher. | Tombol/action yang tidak sesuai role tidak tersedia atau request ditolak. Tampilan angka tetap bisa dibaca sesuai permission existing. | Belum Dites |
| UJT-21 | P1 | API/Data integrity | Data lama tetap terbaca | Voucher lama yang sudah selesai | Buka voucher yang sudah selesai sebelum perubahan. | Halaman tidak error. Label baru tampil berdasarkan data lama. Tidak ada perubahan otomatis pada jurnal/transaksi lama. | Belum Dites |
| UJT-22 | P1 | Regression teks | Tidak ada teks lama di build | Source/build lokal | Jalankan `rg -n "Sisa Bon Operasional|Bon Ke-4|Bon Ke-5|Total Hak Trip|Total Klaim Trip" src`. | Command tidak menemukan match untuk istilah lama tersebut. | Belum Dites |

## Exit Criteria

- Semua test P0 harus `Sesuai`.
- Tidak boleh ada mismatch antara halaman list, detail, modal, print, trip detail, driver portal, laporan, dan profil driver.
- Tidak boleh muncul `Sisa Bon Operasional`, `Bon Ke-4`, atau `Bon Ke-5` pada konteks uang jalan penutupan.
- Untuk DATA-A, sistem harus membedakan angka display client `Bon Ketiga Penutupan Rp200.000` dan uang yang benar-benar dicairkan saat penutupan `Rp100.000`.
- Submit penyelesaian tidak boleh membuat pembayaran dobel.
- Jika ada bug, tester wajib mengisi: ID test case, akun, URL, data voucher/DO, langkah reproduce, output aktual, output yang diharapkan, screenshot, dan tingkat severity.

## Template Report Bug

| Field | Isi |
| --- | --- |
| ID UAT | Contoh: UJT-07 |
| Severity | Critical / High / Medium / Low |
| Akun | Email role yang dipakai |
| URL/Menu | URL detail atau menu yang dites |
| Data | Nomor voucher, DO, driver, kendaraan |
| Langkah Reproduce | Tulis langkah 1, 2, 3 sampai bug muncul |
| Output Aktual | Apa yang muncul sekarang |
| Output yang Diharapkan | Apa yang seharusnya muncul sesuai UAT |
| Evidence | Screenshot/video/log |
| Catatan Dampak | Apakah menyebabkan mismatch uang, jurnal, kas, invoice, atau hanya label UI |
