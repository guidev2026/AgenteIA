/**
 * Dev runner — starts Electron pointing to Vite dev server.
 * Compiles the Electron TypeScript first, then launches Electron on the compiled JS.
 */
import { spawnSync, spawn } from 'child_process';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..');

function compileElectron(): void {
  console.log('\ud83d\udd27 Compiling Electron TypeScript...');
  const result = spawnSync('npx', ['tsc', '-p', 'tsconfig.electron.json'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error('\u274c Failed to compile Electron TypeScript');
    process.exit(1);
  }
}

async function waitForVite(url: string, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.warn('\u26a0\ufe0f  Vite dev server did not respond, launching Electron anyway...');
}

async function main(): Promise<void> {
  compileElectron();
  console.log('\ud83d\ude80 Waiting for Vite dev server...');
  await waitForVite('http://localhost:5173');
  console.log('\ud83d\udda5\ufe0f  Launching Electron...');

  const electronMain = resolve(ROOT, 'dist-electron', 'main.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron');
  const electronPath = electron as unknown as string;

  const electronProcess = spawn(electronPath, [electronMain], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  electronProcess.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error('\u274c Failed to launch Electron:', err);
  process.exit(1);
});