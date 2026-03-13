import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, "android");
const isWindows = process.platform === "win32";
const gradleWrapper = path.join(androidDir, isWindows ? "gradlew.bat" : "gradlew");
const apkPath = path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

if (!existsSync(androidDir) || !existsSync(gradleWrapper)) {
  console.error("Android native project belum ada. Jalankan `npm run prebuild` atau `npx expo prebuild --clean --platform android` terlebih dahulu.");
  process.exit(1);
}

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "production",
};

const command = isWindows ? "cmd.exe" : gradleWrapper;
const args = isWindows
  ? ["/c", "gradlew.bat", "assembleDebug", "--console=plain"]
  : ["assembleDebug", "--console=plain"];

const child = spawn(command, args, {
  cwd: androidDir,
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log("");
    console.log(`APK debug siap di: ${apkPath}`);
    return;
  }

  process.exit(code ?? 1);
});
