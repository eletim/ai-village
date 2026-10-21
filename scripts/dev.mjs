import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { WorkshopBridge } from '../server/bridge.mjs';
const args = process.argv.slice(2);
const value = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const port = Number(value('--port', 5173)), host = value('--host', '127.0.0.1'), root = resolve('.');
const bridge = new WorkshopBridge();
await bridge.init();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Origin rejected' });
      if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, bridge.snapshot());
      const jobRoute = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/(approve|artifact|artifacts)$/);
      if (jobRoute && req.method === 'GET' && jobRoute[2] === 'artifacts') {
        const job=bridge.jobById(jobRoute[1]);
        await bridge.update({ artifacts: await bridge.listArtifacts(job), artifactError: null }, job);
        return json(res, 200, bridge.snapshot());
      }
      if (jobRoute && req.method === 'POST' && jobRoute[2] === 'approve') return json(res, 200, await bridge.approve(jobRoute[1]));
      if (jobRoute && req.method === 'GET' && jobRoute[2] === 'artifact') {
        const path = new URL(req.url, 'http://localhost').searchParams.get('path');
        const content = await bridge.artifact(jobRoute[1], path);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1))}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
        res.end(content); return;
      }

      if (req.method === 'POST' && pathname === '/api/jobs') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'JSON required' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 12000) return json(res, 413, { error: 'Request too large' }); }
        let parsed;
        try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
        const request = parsed?.request;
        if (typeof request !== 'string' || !request.trim() || request.length > 2000) return json(res, 400, { error: '依頼を1〜2000文字で入力してください。' });
        return json(res, 202, await bridge.submit(request.trim()));
      }
      return json(res, 404, { error: 'Not found' });
    }
    // Never serve credentials, source of the bridge, or persisted job output.
    if (req.method !== 'GET' || !(pathname === '/' || pathname === '/index.html' || pathname === '/office' || pathname === '/office/' || /^\/src\/[a-z-]+\.(js|css)$/.test(pathname))) { res.writeHead(404); res.end('Not found'); return; }
    const file = resolve(root, ['/', '/office', '/office/'].includes(pathname) ? 'index.html' : '.' + pathname);
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') { res.writeHead(404); res.end('Not found'); }
    else json(res, error.status || 500, { error: error.message });
  }
});
server.on('error', error => { console.error(error.message); process.exit(1); });
server.listen(port, host, () => console.log(`AI村 → http://${host}:${port}`));
