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

## Build Android installable lokal

Untuk menghasilkan APK debug yang bisa langsung diinstal ke Android:

```bash
npx expo prebuild --clean --platform android
npm run build:android:local
```

Output APK:

- `android/app/build/outputs/apk/debug/app-debug.apk`

## Build installable package

Project ini sudah disiapkan untuk EAS build cloud.

```bash
npx eas login
npm run build:android
npm run build:ios
```

Untuk internal testing:

```bash
npx eas login
npm run build:android:preview
npm run build:ios:preview
```

Catatan iOS:

- file `.ipa` tidak bisa dibuild lokal dari Windows
- jalur yang didukung dari environment ini adalah `EAS Build` atau `Xcode` di macOS
- sebelum build iOS, login dulu ke Expo/EAS dan siapkan Apple Developer provisioning

## Release readiness quick check

```bash
npm run doctor
npm run typecheck
```

Yang sudah tervalidasi di repo ini:

- Android debug APK berhasil dibuild lokal
- bundle Android dan iOS berhasil diexport
- config Expo/EAS valid untuk Android dan iOS

## Catatan penting

- Android tetap target operasional utama untuk tracking background paling stabil.
- iOS sudah disiapkan agar bisa dibuild dan diinstall, tetapi perilaku background location di iPhone tetap lebih ketat daripada Android.
- tracking background tetap bergantung pada izin lokasi, GPS aktif, dan data seluler.
- token driver mobile saat ini disimpan di `AsyncStorage` agar background task bisa membacanya saat aplikasi berjalan di background Android.
