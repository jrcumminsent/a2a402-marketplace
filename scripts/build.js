import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('apps/dashboard/public/index.html');
const outDir = path.resolve('public');
const target = path.join(outDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Built A2A402 dashboard -> ${target}`);
