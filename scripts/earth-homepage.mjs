import fs from 'node:fs';
import path from 'node:path';

export function installEarthHomepage(outDir) {
  const existing=fs.readFileSync(path.join(outDir,'index.html'),'utf8');
  const machineMetadata=existing.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/)?.[0]||'';
  const sourcePath=path.resolve('apps/dashboard/public/earth/home.html');
  let html=fs.readFileSync(sourcePath,'utf8');
  if(!/SETTLEMENT OPTIONS/i.test(html)||!/USDC/i.test(html))throw new Error('Earth homepage source is missing settlement positioning');
  html=html.replace('</head>',machineMetadata+'</head>');
  // Preserve both public entrypoints from one canonical source.
  fs.writeFileSync(path.join(outDir,'index.html'),html);
  fs.mkdirSync(path.join(outDir,'agentglobe'),{recursive:true});
  fs.writeFileSync(path.join(outDir,'agentglobe/index.html'),html);
}
