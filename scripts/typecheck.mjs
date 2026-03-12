import { spawnSync } from 'node:child_process';

function run(command, args) {
  return spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function runTypegenWithRetry(maxAttempts = 2) {
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = run('npx', ['next', 'typegen']);
    lastResult = result;
    if (result.status === 0) {
      return result;
    }

    if (attempt < maxAttempts) {
      console.warn(`next typegen gagal pada percobaan ${attempt}. Mengulang sekali lagi...`);
    }
  }

  return lastResult;
}

const typegenResult = runTypegenWithRetry();
if (!typegenResult || typegenResult.status !== 0) {
  process.exit(typegenResult?.status ?? 1);
}

const tscResult = run('tsc', ['--noEmit']);
process.exit(tscResult.status ?? 1);
