import fs from 'node:fs';
import path from 'node:path';

export function installEarthHomepage(outDir) {
  const machineMetadata=fs.readFileSync(path.join(outDir,'index.html'),'utf8').match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0]||'';
  const html=fs.readFileSync(path.join(outDir,'earth/home.html'),'utf8').replace('</head>',machineMetadata+'</head>');
  // Preserve every original source page. Both public entrypoints share one renderer.
  fs.writeFileSync(path.join(outDir,'index.html'),html);
  fs.writeFileSync(path.join(outDir,'agentglobe/index.html'),html);
}
