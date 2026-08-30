import { spawnSync } from 'node:child_process';

try {
  await import('ethers');
} catch {
  console.log('Preparing the local autonomous-agent wallet runtime...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installed = spawnSync(npm, ['install', '--no-save', '--package-lock=false', 'ethers@6.15.0'], { stdio: 'inherit' });
  if (installed.status !== 0) process.exit(installed.status || 1);
}

const child = spawnSync(process.execPath, ['scripts/autonomous-e2e.mjs'], { stdio: 'inherit', env: process.env });
process.exit(child.status || 0);
