import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const NEXT_TYPES_DIR = path.join(process.cwd(), '.next', 'types');
const REQUIRED_TYPE_PATHS = [
  path.join(NEXT_TYPES_DIR, 'routes.d.ts'),
  path.join(NEXT_TYPES_DIR, 'cache-life.d.ts'),
  path.join(NEXT_TYPES_DIR, 'validator.ts'),
];
const TSCONFIG_BUILD_INFO_PATH = path.join(process.cwd(), 'tsconfig.tsbuildinfo');

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function waitForTypeArtifacts(timeoutMs = 5000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (REQUIRED_TYPE_PATHS.every(filePath => existsSync(filePath))) {
      return true;
    }

    const sleepUntil = Date.now() + pollMs;
    while (Date.now() < sleepUntil) {
      // Busy wait in this short-lived script to avoid extra async plumbing.
    }
  }

  return REQUIRED_TYPE_PATHS.every(filePath => existsSync(filePath));
}

function runTypegenWithRetry(maxAttempts = 3) {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    rmSync(NEXT_TYPES_DIR, { recursive: true, force: true });
    const result = run('npx', ['next', 'typegen']);
    lastResult = result;
    if (result.status === 0 && waitForTypeArtifacts()) {
      return result;
    }

    if (attempt < maxAttempts) {
      console.warn(`next typegen belum menghasilkan route types siap pakai pada percobaan ${attempt}. Mengulang sekali lagi...`);
    }
  }

  return lastResult;
}

const typegenResult = runTypegenWithRetry();
if (!typegenResult || typegenResult.status !== 0 || !REQUIRED_TYPE_PATHS.every(filePath => existsSync(filePath))) {
  process.exit(typegenResult?.status ?? 1);
}

rmSync(TSCONFIG_BUILD_INFO_PATH, { force: true });

const tscResult = run('tsc', ['--noEmit', '--incremental', 'false']);
process.exit(tscResult.status ?? 1);
