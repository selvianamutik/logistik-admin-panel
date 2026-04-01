import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROUTE_TYPES_PATH = path.join(process.cwd(), '.next', 'types', 'routes.d.ts');

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function waitForRouteTypes(timeoutMs = 5000, pollMs = 100) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(ROUTE_TYPES_PATH)) {
      return true;
    }

    const sleepUntil = Date.now() + pollMs;
    while (Date.now() < sleepUntil) {
      // Busy wait in this short-lived script to avoid extra async plumbing.
    }
  }

  return existsSync(ROUTE_TYPES_PATH);
}

function runTypegenWithRetry(maxAttempts = 3) {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = run('npx', ['next', 'typegen']);
    lastResult = result;
    if (result.status === 0 && waitForRouteTypes()) {
      return result;
    }

    if (attempt < maxAttempts) {
      console.warn(`next typegen belum menghasilkan route types siap pakai pada percobaan ${attempt}. Mengulang sekali lagi...`);
    }
  }

  return lastResult;
}

const typegenResult = runTypegenWithRetry();
if (!typegenResult || typegenResult.status !== 0 || !existsSync(ROUTE_TYPES_PATH)) {
  process.exit(typegenResult?.status ?? 1);
}

const tscResult = run('tsc', ['--noEmit']);
process.exit(tscResult.status ?? 1);
