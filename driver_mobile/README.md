# Driver Mobile Flutter

App driver native resmi untuk Android dan iOS. App ini dipakai driver untuk:

- login dengan akun mobile driver
- melihat DO aktif miliknya
- memulai / memulihkan tracking live
- mengirim heartbeat lokasi ke dashboard admin

Project ini menggantikan implementasi React/Expo lama. Jalur React lama sudah
dikeluarkan dari repo agar tim hanya punya satu sumber kebenaran untuk build
mobile.

## Scope v1

- login driver dengan bearer token
- restore sesi lokal
- daftar DO driver
- start / resume tracking
- heartbeat lokasi lewat runtime native Flutter + geolocator
- guard agar driver tidak bisa menghentikan tracking sebelum admin menutup DO

## Environment

Default API base URL:

- `https://app-ten-gamma-49.vercel.app`

Override saat build:

```bash
flutter run --dart-define=API_BASE_URL=https://domain-kamu
flutter build apk --dart-define=API_BASE_URL=https://domain-kamu
```

## Jalankan lokal

```bash
C:\flutter\bin\flutter.bat pub get
C:\flutter\bin\flutter.bat run
```

## Verifikasi cepat

```bash
C:\flutter\bin\flutter.bat analyze
C:\flutter\bin\flutter.bat test
```

## Build Android installable

Build debug APK lokal:

```bash
C:\flutter\bin\flutter.bat build apk --debug
```

Output APK:

- `build/app/outputs/flutter-apk/app-debug.apk`

Build release APK universal:

```bash
C:\flutter\bin\flutter.bat build apk --release
```

Output release APK:

- `build/app/outputs/flutter-apk/app-release.apk`

Untuk distribusi manual yang lebih masuk akal, pakai split per ABI:

```bash
C:\flutter\bin\flutter.bat build apk --release --split-per-abi
```

Output split APK:

- `build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`
- `build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk`
- `build/app/outputs/flutter-apk/app-x86_64-release.apk`

Build Android App Bundle:

```bash
C:\flutter\bin\flutter.bat build appbundle --release
```

Output AAB:

- `build/app/outputs/bundle/release/app-release.aab`

## Signing release Android

Secara default, kalau `android/key.properties` belum ada, build release lokal akan
fallback ke debug signing supaya build tidak buntu. Untuk release yang benar
benar siap dibagikan, isi dulu:

- `android/key.properties`
- file keystore `.jks`

Template ada di:

- `android/key.properties.example`

Setelah itu jalankan lagi:

```bash
C:\flutter\bin\flutter.bat build apk --release
C:\flutter\bin\flutter.bat build appbundle --release
```

## Build iOS

Project iOS sudah siap dibuild, tetapi file `.ipa` final tetap butuh:

- macOS + Xcode, atau
- Apple Developer provisioning pada jalur CI/cloud build

Build command:

```bash
C:\flutter\bin\flutter.bat build ios --no-codesign
```

Catatan:

- command di atas tidak menghasilkan `.ipa` signed dari Windows
- bundle identifier sekarang disiapkan sebagai `com.logistik.driver`

## Catatan penting

- Android tetap platform operasional utama untuk tracking background paling stabil.
- iOS bisa diinstall, tetapi background location di iPhone tetap lebih ketat.
- tracking tetap bergantung pada izin lokasi, GPS aktif, dan internet aktif.
- token driver disimpan lokal agar runtime tracking bisa melanjutkan heartbeat.
- pada toolchain Windows lokal ini, `build appbundle` masih bisa mengeluarkan warning strip symbol dari Android toolchain, tetapi file `.aab` tetap berhasil dibuat
- untuk distribusi langsung ke device, lebih aman pakai APK split-per-ABI daripada APK universal release
