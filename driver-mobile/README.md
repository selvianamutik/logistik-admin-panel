# Driver Mobile

APK driver Android untuk login, melihat DO aktif, dan mengirim tracking background native ke web admin.

## Scope v1

- login driver dengan bearer token
- restore sesi lokal
- daftar DO driver
- start / pause / stop tracking
- heartbeat lokasi background via Android foreground service

## Environment

Default API base URL:

- `https://app-ten-gamma-49.vercel.app`

Override saat development/build:

- `EXPO_PUBLIC_API_BASE_URL=https://domain-kamu`

## Jalankan

```bash
npm install
npm run start
```

## Build Android lokal

Butuh Android SDK dan emulator/perangkat Android.

```bash
npm run android
```

## Catatan penting

- v1 ini fokus Android. iOS belum jadi target operasional utama.
- tracking background tetap bergantung pada izin lokasi, GPS aktif, dan data seluler.
- token driver mobile saat ini disimpan di `AsyncStorage` agar background task bisa membacanya saat aplikasi berjalan di background Android.
