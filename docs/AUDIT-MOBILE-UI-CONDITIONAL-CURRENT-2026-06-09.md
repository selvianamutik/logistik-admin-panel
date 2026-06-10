# Audit Mobile UI dan Conditional - Kondisi Terbaru

Tanggal audit: 2026-06-09 11:27 WIB
Scope: `apps/driver_app` Flutter driver app, fokus tampilan, kondisi tombol, wizard, tracking, session, dan risiko operasional dari kondisi kode saat ini.

Catatan bukti:
- Screenshot lama tidak dipakai untuk audit ini.
- `adb devices -l` terbaru tidak menemukan emulator/device aktif, jadi bukti layar live baru belum bisa diambil.
- `flutter analyze --no-pub` terbaru: lulus, no issues found.
- `flutter test --reporter=compact` terbaru: gagal, hasil akhir `+26 -24`.

## Temuan

### P1 - Tracking otomatis bisa memilih trip pertama yang eligible, bukan pilihan driver

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:391`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:411`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:1215`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:1228`

Saat daftar trip dimuat, app memilih `nextActiveTrip` lalu langsung memanggil `_syncAutoTracking`. Jika belum ada trip yang terkunci dari server, `_selectAutoTrackingTrip` memilih trip pertama yang statusnya `assigned`, `onDelivery`, `arrived`, atau `partialHold`.

Dampak gampangnya: kalau driver punya lebih dari satu trip eligible, aplikasi bisa mulai tracking ke trip yang bukan sedang dikerjakan, hanya karena urutan data dari server. Ini berisiko mengunci DO salah dan mengirim lokasi ke trip salah.

Rekomendasi: jangan auto-start untuk trip `assigned` tanpa aksi driver, atau tampilkan konfirmasi jelas saat ada lebih dari satu trip eligible. Prioritaskan trip yang memang sudah `ACTIVE/PAUSED` dari server.

### P1 - Warning non-blocking diperlakukan seperti layar blokir penuh

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2241`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2291`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2300`

`hasBlockingNotice` menjadi true bukan hanya saat `blocking`, tapi juga saat `WARNING` belum di-acknowledge. Saat true, refresh dibuat kosong dan scroll dimatikan.

Dampak gampangnya: warning yang harusnya peringatan bisa menutup seluruh akses trip sampai driver menekan tutup warning. Kalau acknowledge gagal karena jaringan, driver tertahan di layar overlay.

Rekomendasi: pisahkan "blocking suspension" dan "warning". Warning cukup banner/panel yang bisa ditutup lokal sementara, sedangkan blocking benar-benar menahan akses.

### P1 - Tombol Update Status SJ bisa disabled, tapi teks bantuannya tetap bilang SJ siap dipindah

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:721`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:809`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2403`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:4638`

`_canUpdateSuratJalanStatus` mematikan tombol kalau trip sudah ditutup admin atau ada blocking admin approval. Tapi `_suratJalanStatusHelperText` tidak mengecek dua kondisi itu lebih dulu.

Dampak gampangnya: driver bisa melihat tombol mati, tapi teks di bawah tombol masih bisa mengatakan ada SJ siap dipindah. Ini membingungkan dan terlihat seperti error UI.

Rekomendasi: helper text harus mengikuti alasan disabled paling atas: trip ditutup admin, menunggu approval admin, tracking belum aktif, baru setelah itu cek status SJ.

### P1 - Form penting ditutup dulu sebelum request berhasil, dan beberapa request memakai token lama

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:839`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:897`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:873`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:943`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:1549`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:1766`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:1944`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2144`

Beberapa flow mengambil `sessionToken` sebelum form/dialog dibuka, lalu form ditutup, baru request dikirim. Ini terjadi pada buat/kelola SJ barang, tutup trip, lapor insiden, penyelesaian insiden, dan tambah biaya insiden. Tidak semuanya memakai `_withFreshSession`.

Dampak gampangnya: driver bisa lama mengisi form, token kedaluwarsa, lalu saat submit gagal 401 form sudah tertutup dan input driver hilang.

Rekomendasi: semua aksi submit setelah form/dialog harus lewat `_withFreshSession`, dan untuk form panjang sebaiknya jangan tutup form permanen sebelum request sukses atau simpan draft lokal.

### P1 - Banyak request utama tidak punya timeout

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\auth\data\driver_auth_service.dart:19`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_access_service.dart:30`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_access_service.dart:76`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\delivery_order_service.dart:19`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\delivery_order_service.dart:82`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\delivery_order_service.dart:123`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\delivery_order_service.dart:160`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\delivery_order_service.dart:198`

Tracking ping punya timeout 10 detik, tetapi login, refresh, muat trip, update status, submit selesai, tutup trip, insiden, dan manifest tidak konsisten punya timeout.

Dampak gampangnya: di jaringan lapangan yang jelek, tombol bisa terus loading dan driver tidak tahu harus menunggu, ulang, atau keluar.

Rekomendasi: pasang timeout seragam untuk semua request mobile dan tampilkan pesan retry yang jelas.

### P1 - Test UI terbaru gagal 24 skenario, mayoritas di flow Ajukan Selesai

Bukti:
- Command terbaru: `flutter test --reporter=compact`
- Hasil: `+26 -24`
- Contoh gagal:
  - `DeliveryCompletionPage warns before removing an actual drop point`
  - `DeliveryCompletionPage keeps actual numeric input stable while keyboard is open`
  - `DeliveryCompletionPage matches admin numeric and lock rules on completion form`
  - `DeliveryCompletionPage keeps added drop point reachable while keyboard is open`
  - `DeliveryCompletionPage selects customer recipient for added drop point without hiding the form`
  - `DeliveryCompletionPage renders legacy units and duplicate SJ references safely`

Dampak gampangnya: flow inti realisasi barang/drop sedang tidak terlindungi test. Bisa jadi test perlu disesuaikan, bisa juga UI benar-benar berubah/pecah. Sampai ini dibereskan, risiko regresi di mobile tinggi.

Rekomendasi: putuskan dulu perilaku wizard terbaru yang benar, lalu perbaiki test dan UI bersamaan. Jangan anggap aman hanya karena analyzer lulus.

### P2 - Halaman home bisa menampilkan trip siap input SJ, tapi section DO aktif tetap bilang "Tidak ada DO aktif"

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2306`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2329`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2346`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:2635`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\tracking_home_page.dart:5637`

Count tab menggabungkan trip aktif dan planned trip. Tetapi setelah kartu "Trip siap input SJ", section "Trip" tetap muncul dengan count 0 dan empty state default "Tidak ada DO aktif".

Dampak gampangnya: driver melihat ada 1 trip di tab, ada trip siap input SJ, tapi juga diberi pesan tidak ada DO aktif. Ini bisa bikin ragu apakah trip sudah benar atau belum.

Rekomendasi: kalau `pendingTripPlans` ada dan `_trips` kosong, ubah empty state menjadi "Belum ada DO aktif. Buat SJ dulu dari trip siap input di atas." atau sembunyikan section trip aktif.

### P2 - Footer wizard Ajukan Selesai memakai label generik "Lanjut"

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\presentation\delivery_completion_page.dart:1354`
- `C:\LOGISTIK\app\apps\driver_app\test\delivery_completion_page_test.dart:958`
- `C:\LOGISTIK\app\apps\driver_app\test\delivery_completion_page_test.dart:1052`
- `C:\LOGISTIK\app\apps\driver_app\test\delivery_completion_page_test.dart:1274`

Footer untuk setup, drop, dan cargo semuanya hanya "Lanjut". Test masih mengharapkan label yang lebih kontekstual seperti "Lanjut Titik Drop", "Lanjut Kirim", atau "Lanjut Aktual Barang".

Dampak gampangnya: di layar kecil, driver harus membaca header dulu untuk tahu lanjut ke mana. Ini bukan fatal, tapi di flow panjang seperti POD/drop/barang, label generik menambah beban pikir.

Rekomendasi: gunakan label sesuai langkah berikutnya, misalnya "Lanjut Titik Drop", "Lanjut Aktual Barang", "Lanjut Review".

### P2 - UI mengandalkan live tracking, tapi permission background belum siap

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\android\app\src\main\AndroidManifest.xml:2`
- `C:\LOGISTIK\app\apps\driver_app\android\app\src\main\AndroidManifest.xml:3`
- `C:\LOGISTIK\app\apps\driver_app\ios\Runner\Info.plist:32`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:69`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:98`

Android hanya punya coarse/fine location dan internet. iOS hanya `NSLocationWhenInUseUsageDescription`. Tidak ada foreground service/background location setup. Sementara service memakai stream lokasi dan timer periodic.

Dampak gampangnya: driver mengira tracking live terus jalan, tetapi saat app background/layar mati, OS bisa menghentikan update.

Rekomendasi: kalau tracking harus hidup di perjalanan, implement foreground service Android, background modes iOS, dan indikator jelas kapan tracking aktif/tidak aktif.

### P2 - Tracking ping memakai token tetap dan tidak refresh sendiri saat 401

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:36`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:155`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:169`
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\tracking\data\driver_tracking_service.dart:176`

`DriverTrackingService` menyimpan `sessionToken` final. Saat ping gagal HTTP, service hanya memanggil `onError`; tidak ada retry dengan refresh token.

Dampak gampangnya: tracking bisa terlihat aktif di UI, tetapi ping gagal terus setelah token habis sampai ada aksi lain yang memicu refresh session.

Rekomendasi: beri callback refresh session ke tracking service, atau saat 401 hentikan tracking dengan pesan yang sangat jelas dan tombol "refresh sesi".

### P2 - Default API URL masih preview environment

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\shared\config.dart:2`

Kalau build tidak diberi `--dart-define=API_BASE_URL=...`, aplikasi akan mengarah ke `https://app-ten-gamma-49.vercel.app`.

Dampak gampangnya: build internal/release bisa tanpa sengaja mengarah ke environment preview.

Rekomendasi: fail build kalau `API_BASE_URL` kosong untuk release, atau pisahkan flavor dev/staging/prod.

### P3 - Status bar/system overlay style tidak dikunci eksplisit

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\shared\theme.dart:26`
- Pencarian terbaru tidak menemukan `SystemUiOverlayStyle` atau `systemOverlayStyle` di `lib/src`.

AppBar dibuat transparan, tetapi warna ikon status bar tidak dikunci eksplisit.

Dampak gampangnya: pada device/OS tertentu ikon jam/sinyal/baterai bisa kurang kontras dengan background.

Rekomendasi: set `systemOverlayStyle` eksplisit untuk light theme.

### P3 - Toggle lihat password kurang ramah aksesibilitas

Bukti:
- `C:\LOGISTIK\app\apps\driver_app\lib\src\features\auth\presentation\login_page.dart:176`

Suffix icon password memakai `GestureDetector`, bukan `IconButton` dengan tooltip/semantic label.

Dampak gampangnya: target tap dan pembaca layar kurang jelas.

Rekomendasi: ganti ke `IconButton` dengan tooltip seperti "Tampilkan password" / "Sembunyikan password".

## Kesimpulan Singkat

Kondisi terbaru tidak ada error analyzer, tetapi belum aman secara UX operasional. Risiko terbesar ada di auto tracking, mismatch status disabled dengan helper text, form yang kehilangan input saat request gagal/session basi, request tanpa timeout, dan 24 test UI yang gagal di flow realisasi selesai.

Prioritas perbaikan:
1. Amankan auto tracking dan pemilihan trip.
2. Benahi helper text/button disabled supaya alasan blokir jelas.
3. Buat semua submit form memakai fresh session dan timeout.
4. Bereskan flow Ajukan Selesai sampai test UI kembali hijau.
5. Ambil screenshot/device QA baru setelah emulator tersedia.
