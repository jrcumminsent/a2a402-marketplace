import fs from 'node:fs';
import path from 'node:path';

export function installEarthHomepage(outDir) {
  const machineMetadata=fs.readFileSync(path.join(outDir,'index.html'),'utf8').match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0]||'';
  const earthHtml=fs.readFileSync(path.join(outDir,'earth/home.html'),'utf8').replace('</head>',machineMetadata+'</head>');
  const genesisPath=path.join(outDir,'genesis/index.html');
  const genesisHtml=fs.existsSync(genesisPath)
    ? fs.readFileSync(genesisPath,'utf8').replace('</head>',machineMetadata+'</head>')
    : earthHtml;

  // Genesis Vault is the human-facing root experience.
  // Keep the original Earth/network visualizer available at /agentglobe/.
  fs.writeFileSync(path.join(outDir,'index.html'),genesisHtml);
  fs.writeFileSync(path.join(outDir,'agentglobe/index.html'),earthHtml);
}
