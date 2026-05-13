# UAT Tire Installation and Maintenance Cost

Tanggal dibuat: 2026-05-13

Dokumen ini mencakup UAT fitur ban terbaru: catat ban gudang, pasang/ganti ban dari gudang atau unit lain, pencatatan biaya ban sebagai tampilan maintenance, dan biaya teknisi sebagai biaya finance.

## Akun Tester

Gunakan akun web admin role OWNER atau ARMADA dari dokumen `docs/UAT_LOGISTIK_END_TO_END.md`.

## Checklist

| ID | Prioritas | Skenario | Cara Test | Output yang Diharapkan |
| --- | --- | --- | --- | --- |
| TIR-01 | P0 | Catat ban baru ke gudang | Buka `Fleet > Ban`, klik `Catat Ban Gudang`, isi kode/merk/ukuran/harga, pilih `Master Barang Gudang`, simpan. | Ban tersimpan dengan lokasi `Gudang Ban`, stok master barang gudang bertambah 1, dan ban muncul sebagai kandidat pasang dari gudang. |
| TIR-02 | P0 | Pasang ban gudang ke slot kosong | Buka detail kendaraan tab `Ban`, klik `Pasang Ban` pada slot kosong, pilih sumber `Gudang Ban`, pilih ban, isi biaya teknisi `0`, simpan. | Ban pindah ke slot kendaraan, stok gudang berkurang 1, riwayat ban tercatat, maintenance list menampilkan baris `Pasang Ban` dengan line ban pengganti, biaya internal/finance tetap Rp0. |
| TIR-03 | P0 | Ganti ban gudang ke slot terisi | Pada slot berisi ban, klik `Ganti Ban`, pilih sumber `Gudang Ban`, pilih ban pengganti, isi pemakaian ban lama, pilih tujuan ban lama `Gudang Ban`, isi biaya teknisi, simpan. | Ban lama keluar ke gudang, ban baru masuk slot, maintenance list menampilkan ban pengganti, biaya ban lama, dan teknisi. Hanya biaya teknisi yang mem-posting finance/bank. |
| TIR-04 | P0 | Ganti ban dari unit lain | Pilih sumber `Unit Lain`, pilih unit sumber, pilih ban, isi pemakaian ban di unit sumber dan pemakaian ban lama di unit tujuan, simpan. | Slot unit sumber menjadi kosong, unit sumber mendapat biaya pemakaian ban, unit tujuan mendapat ban pengganti, maintenance display menampilkan line ban dan teknisi. |
| TIR-05 | P0 | Cegah pilih ban dari unit yang sama | Di detail kendaraan, coba cari ban yang sudah terpasang pada kendaraan yang sama sebagai sumber pengganti. | Ban pada kendaraan tujuan tidak muncul di pilihan sumber. Jika dipaksa via API, request ditolak. |
| TIR-06 | P1 | Biaya teknisi 0 | Pasang/ganti ban dengan biaya teknisi `0`. | Maintenance display tetap dibuat untuk konteks ban, tetapi `Biaya Internal` Rp0 dan tidak ada expense/bank transaction. |
| TIR-07 | P1 | Biaya teknisi dengan vendor | Pasang/ganti ban dengan biaya teknisi dan nama teknisi/bengkel. | Maintenance display menunjukkan vendor dan biaya teknisi; finance hanya mencatat biaya teknisi. |
| TIR-08 | P1 | Maintenance terjadwal ban | Buat jadwal maintenance tipe ban, selesaikan dari halaman Maintenance, pilih sumber ban dan isi biaya teknisi. | Maintenance terjadwal berubah menjadi `DONE`, tidak membuat duplikasi maintenance baru, dan line ban + teknisi tampil. |

## Acceptance Criteria

- Tire cost display di maintenance boleh menampilkan nilai ban baru dan pemakaian ban lama.
- Finance/cash/bank hanya terpengaruh oleh biaya teknisi.
- Vehicle cost page tetap menampilkan dampak biaya ban dan teknisi untuk unit terkait.
- Tidak ada ban scrapped atau ban pada unit tujuan yang dapat dipilih sebagai sumber.
- Semua operasi tetap mencatat tire history dan sinkronisasi stok gudang ban.
