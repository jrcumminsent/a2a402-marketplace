import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public');
const port = Number(process.env.PREVIEW_PORT || 4173);
const exact = new Set(['/health', '/jobs', '/economy/stats', '/economy/graph', '/economy/activity', '/growth/stats', '/growth/evidence', '/growth/registry', '/social/agents', '/social/feed', '/lounge/messages']);
const apiPath = p => exact.has(p) || /^\/(agents|reputation|jobs|contracts|artifacts|deliveries|evaluations)\/[^/]+$/.test(p);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml'};
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, {Allow:'GET, HEAD'}); return res.end('Local preview is read-only.'); }
  try {
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, {'content-type':types[path.extname(file)] || 'application/octet-stream','cache-control':'no-store'});
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(file).pipe(res);
    }
    if (apiPath(url.pathname)) {
      const upstream = await fetch('https://a2a402.market' + url.pathname + url.search, {headers:{accept:'application/json'}, signal:AbortSignal.timeout(12000)});
      res.writeHead(upstream.status, {'content-type':upstream.headers.get('content-type') || 'application/json','cache-control':'no-store'});
      return res.end(req.method === 'HEAD' ? undefined : await upstream.text());
    }
    res.writeHead(404); res.end('Not found');
  } catch { res.writeHead(502, {'content-type':'application/json'}); res.end(JSON.stringify({error:'Public production API unavailable. No sample data substituted.'})); }
}).listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port} (public production GETs only)`));
