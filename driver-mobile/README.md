# Driver Mobile

App driver native untuk Android dan iOS untuk login, melihat DO aktif, dan mengirim tracking ke web admin.

## Scope v1

- login driver dengan bearer token
- restore sesi lokal
- daftar DO driver
- start / pause / stop tracking
- heartbeat lokasi background via native background location

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

## Build lokal

Butuh toolchain native sesuai platform:

- Android SDK untuk Android
- Xcode untuk iOS

```bash
npm run android
npm run ios
```

## Build installable package

Project ini sudah disiapkan untuk EAS build cloud.

```bash
npm run build:android
npm run build:ios
```

Untuk internal testing:

```bash
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
```

## Catatan penting

- Android tetap target operasional utama untuk tracking background paling stabil.
- iOS sudah disiapkan agar bisa dibuild dan diinstall, tetapi perilaku background location di iPhone tetap lebih ketat daripada Android.
- tracking background tetap bergantung pada izin lokasi, GPS aktif, dan data seluler.
- token driver mobile saat ini disimpan di `AsyncStorage` agar background task bisa membacanya saat aplikasi berjalan di background Android.
