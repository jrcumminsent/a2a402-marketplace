import fs from 'node:fs';
import path from 'node:path';
import { feature } from 'topojson-client';

// Local, pinned assets: the browser never needs a third-party CDN.
export function buildEarthAssets(outDir) {
  const dest = path.join(outDir, 'earth', 'vendor');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['three.module.min.js', 'three.core.min.js']) {
    fs.copyFileSync(path.resolve('node_modules/three/build', name), path.join(dest, name));
  }
  fs.copyFileSync(path.resolve('node_modules/three/LICENSE'), path.join(dest, 'THREE-LICENSE.txt'));
  const topo = JSON.parse(fs.readFileSync('node_modules/world-atlas/land-110m.json', 'utf8'));
  const land = feature(topo, topo.objects.land);
  fs.writeFileSync(path.join(dest, 'land.json'), JSON.stringify(land));
}
