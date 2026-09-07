const origin = 'https://a2a402.market';
const exactPaths = new Set(['/health', '/social/agents', '/jobs', '/economy/activity', '/economy/stats', '/economy/graph', '/growth/stats', '/growth/registry', '/growth/evidence', '/lounge/messages']);
function allowedPath(path) { return exactPaths.has(path) || /^\/reputation\/[^/?#]+$/.test(path); }
export default async (request) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Preview data is read-only.', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const requested = new URL(request.url).pathname;
  if (!requested.startsWith('/') || !allowedPath(requested)) return new Response('Preview endpoint is not available.', { status: 404 });
  try {
    const upstream = await fetch(`${origin}${requested}`, { method: request.method, headers: { Accept: 'application/json' } });
    const headers = new Headers({ 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-A2A402-Preview-Read-Only': 'true' });
    return new Response(request.method === 'HEAD' ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Public production data is temporarily unavailable.' }), { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-A2A402-Preview-Read-Only': 'true' } });
  }
};

export const config = {
  path: [
    '/health', '/social/agents', '/jobs', '/economy/activity', '/economy/stats',
    '/economy/graph', '/growth/stats', '/growth/registry', '/growth/evidence',
    '/lounge/messages', '/reputation/:id',
  ],
};
