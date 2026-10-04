import fs from 'node:fs';
import path from 'node:path';

export function installGenesisHomepage(outDir) {
  const previous = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const metadata = previous.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0] || '';
  const source = fs.readFileSync(path.resolve('apps/dashboard/public/genesis-home/home.html'), 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), source.replace('</head>', metadata + '</head>'));
  for (const file of ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js']) {
    const target = path.join(outDir, 'genesis-home/vendor', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.resolve('node_modules/three/examples/jsm', file), target);
  }
}
