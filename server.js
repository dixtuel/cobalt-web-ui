import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'html');
const COBALT_API = process.env.COBALT_API || 'http://cobalt:9000';
const PORT = process.env.PORT || 80;

const ADSENSE_CLIENT_ID = (process.env.ADSENSE_CLIENT_ID || '').trim();
const ADSENSE_SLOTS = {
  content: (process.env.ADSENSE_SLOT_CONTENT || '').trim(),
  railLeft: (process.env.ADSENSE_SLOT_RAIL_LEFT || '').trim(),
  railRight: (process.env.ADSENSE_SLOT_RAIL_RIGHT || '').trim()
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 0. AdSense config — istemci ADSENSE_CLIENT_ID / ADSENSE_SLOT_* env'lerine göre
  // reklamları dinamik doldurur; boş bırakılan slot'lar placeholder olarak kalır.
  if (pathname === '/ad-config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({
      clientId: ADSENSE_CLIENT_ID || null,
      slots: {
        content: ADSENSE_SLOTS.content || null,
        railLeft: ADSENSE_SLOTS.railLeft || null,
        railRight: ADSENSE_SLOTS.railRight || null
      }
    }));
  }

  // 1. Health check / status
  if (pathname === '/api/' || pathname === '/api') {
    try {
      const apiRes = await fetch(`${COBALT_API}/`);
      const data = await apiRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cobalt backend offline' }));
    }
  }

  // 2. TikTok API direct resolver proxy
  if (pathname === '/tiktok-api/' || pathname === '/tiktok-api') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const tikRes = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            body: body
          });
          const data = await tikRes.json();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          return res.end(JSON.stringify(data));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ code: -1, msg: err.message }));
        }
      });
      return;
    }
  }

  // 3. Media Stream Proxy (Direct attachment for iOS Safari & browsers)
  if (pathname === '/download' || pathname === '/media-stream') {
    const targetUrl = parsedUrl.searchParams.get('url');
    let targetFilename = parsedUrl.searchParams.get('filename') || 'media_download.mp4';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing url parameter');
    }

    try {
      const mediaRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      });

      if (!mediaRes.ok) {
        res.writeHead(mediaRes.status, { 'Content-Type': 'text/plain' });
        return res.end(`Failed to fetch media: ${mediaRes.statusText}`);
      }

      const contentType = mediaRes.headers.get('content-type') || 'video/mp4';
      const cleanAscii = targetFilename.replace(/[^\w\s\u00C0-\u017F.-]/gi, '_');

      const headers = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(targetFilename)}`,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'close'
      };

      res.writeHead(200, headers);

      if (mediaRes.body) {
        Readable.fromWeb(mediaRes.body).pipe(res);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      return res.end(`Stream error: ${err.message}`);
    }
  }

  // 4. Cobalt Tunnel Proxy
  // Not: istemciyi kimliklendiren başlıklar (IP, cookie, auth vb.) kasıtlı olarak
  // iletilmez — yalnızca stream'in çalışması için gereken başlıklar geçirilir.
  if (pathname === '/tunnel' || pathname.startsWith('/tunnel/')) {
    try {
      const targetTunnelUrl = `${COBALT_API}${pathname}${parsedUrl.search}`;
      const safeHeaders = {};
      for (const key of ['range', 'if-range', 'accept', 'accept-encoding']) {
        if (req.headers[key]) safeHeaders[key] = req.headers[key];
      }
      const tunnelRes = await fetch(targetTunnelUrl, {
        headers: safeHeaders
      });

      const forwardHeaders = {};
      for (const [key, val] of tunnelRes.headers.entries()) {
        if (key.toLowerCase() !== 'transfer-encoding') {
          forwardHeaders[key] = val;
        }
      }
      forwardHeaders['Access-Control-Allow-Origin'] = '*';
      forwardHeaders['Connection'] = 'close';

      res.writeHead(tunnelRes.status, forwardHeaders);

      if (tunnelRes.body) {
        Readable.fromWeb(tunnelRes.body).pipe(res);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end(`Tunnel error: ${err.message}`);
    }
  }

  // 5. Cobalt API POST proxy (for downloading YouTube, Twitter, Instagram, etc.)
  if (req.method === 'POST' && pathname === '/') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const cobaltRes = await fetch(`${COBALT_API}/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: body
        });
        const data = await cobaltRes.json();
        res.writeHead(cobaltRes.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', error: { code: 'backend.error', message: err.message } }));
      }
    });
    return;
  }

  // 6. Static File Serving
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      return fs.createReadStream(filePath).pipe(res);
    }
  } catch {}

  // Fallback to index.html
  filePath = path.join(PUBLIC_DIR, 'index.html');
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cobalt Web & Stream proxy running on port ${PORT}`);
});
