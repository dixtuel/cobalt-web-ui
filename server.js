import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'html');
const COBALT_API = process.env.COBALT_API || 'http://cobalt:9000';
const YTDLP_API = process.env.YTDLP_API || 'http://ytdlp-service:5000';
const PORT = process.env.PORT || 80;

// Paylaşımlı egress adaptörü (ytdlp-service/adapter.py, mitmproxy) — yalnız
// dışa (tikwm.com, TikTok CDN) giden istekler için kullanılır. COBALT_API/
// YTDLP_API gibi iç ağ çağrıları asla buradan geçmez (gereksiz, adaptör
// yalnız gerçekten dış dünyaya çıkan trafik için var). Adaptörün TLS'i kendi
// CA'sıyla yerel sonlandırması (bağlantı Docker iç ağından hiç çıkmaz)
// NODE_EXTRA_CA_CERTS ile güvenilir kılınır (docker-compose.yml), toptan
// doğrulama kapatılmaz.
const EGRESS_ADAPTER = (process.env.EGRESS_ADAPTER || '').trim();
const egressAgent = EGRESS_ADAPTER ? new ProxyAgent(EGRESS_ADAPTER) : null;
function egressFetch(url, opts = {}) {
  return egressAgent ? undiciFetch(url, { ...opts, dispatcher: egressAgent }) : fetch(url, opts);
}

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
          const tikRes = await egressFetch('https://www.tikwm.com/api/', {
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
    let targetFilename = (parsedUrl.searchParams.get('filename') || '').trim();

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Missing url parameter');
    }

    try {
      const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': targetUrl.includes('tiktok') ? 'https://www.tiktok.com/' : (targetUrl.includes('instagram') ? 'https://www.instagram.com/' : 'https://google.com/')
      };

      // FDM/IDM ve tarayıcı duraklatma/devam ettirme (resuming) için Range başlıklarını ilet
      if (req.headers['range']) fetchHeaders['Range'] = req.headers['range'];
      if (req.headers['if-range']) fetchHeaders['If-Range'] = req.headers['if-range'];

      const mediaRes = await egressFetch(targetUrl, {
        method: req.method,
        headers: fetchHeaders
      });

      if (!mediaRes.ok && mediaRes.status !== 206) {
        res.writeHead(mediaRes.status, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(`Failed to fetch media: ${mediaRes.statusText || mediaRes.status}`);
      }

      // Kapsamlı Cobalt & medya uzantı/MIME tablosu
      const MEDIA_TYPES = {
        // Video
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.flv': 'video/x-flv',
        '.wmv': 'video/x-ms-wmv',
        '.m4v': 'video/x-m4v',
        '.3gp': 'video/3gpp',
        '.ts': 'video/mp2t',
        // Ses
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.oga': 'audio/ogg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.opus': 'audio/opus',
        '.aac': 'audio/aac',
        '.wma': 'audio/x-ms-wma',
        '.mka': 'audio/x-matroska',
        // Fotoğraf / Görsel
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.heic': 'image/heic',
        '.heif': 'image/heif',
        '.avif': 'image/avif',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        // Altyazı / Metin
        '.vtt': 'text/vtt',
        '.srt': 'application/x-subrip',
        '.ttml': 'application/ttml+xml',
        '.lrc': 'text/plain; charset=utf-8',
        // Arşiv
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip'
      };

      // Uzantıyı belirle
      let ext = path.extname(targetFilename).toLowerCase();
      if (!ext) {
        try {
          const uPath = new URL(targetUrl).pathname;
          ext = path.extname(uPath).toLowerCase();
        } catch {}
      }

      // MIME türünden uzantı çıkar (upstream content-type varsa)
      const upstreamContentType = (mediaRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ext && upstreamContentType) {
        for (const [e, m] of Object.entries(MEDIA_TYPES)) {
          if (m.split(';')[0].trim() === upstreamContentType) {
            ext = e;
            break;
          }
        }
      }

      if (!ext) {
        ext = '.mp4'; // Güvenli varsayılan
      }

      if (!targetFilename) {
        targetFilename = `media_download${ext}`;
      } else if (!targetFilename.toLowerCase().endsWith(ext)) {
        targetFilename = `${targetFilename}${ext}`;
      }

      const contentType = MEDIA_TYPES[ext] || upstreamContentType || 'application/octet-stream';
      const cleanAscii = targetFilename.replace(/[^\w\s\u00C0-\u017F.-]/gi, '_');

      const headers = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(targetFilename)}`,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Accept-Ranges': 'bytes'
      };

      // Content-Length & Content-Range: indirme yöneticileri (FDM vb.) için kritik
      const contentLength = mediaRes.headers.get('content-length');
      if (contentLength) headers['Content-Length'] = contentLength;
      const contentRange = mediaRes.headers.get('content-range');
      if (contentRange) headers['Content-Range'] = contentRange;

      res.writeHead(mediaRes.status, headers);

      if (req.method !== 'HEAD' && mediaRes.body) {
        Readable.fromWeb(mediaRes.body).pipe(res);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
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
        method: req.method,
        headers: safeHeaders
      });

      const forwardHeaders = {};
      for (const [key, val] of tunnelRes.headers.entries()) {
        if (key.toLowerCase() !== 'transfer-encoding') {
          forwardHeaders[key] = val;
        }
      }
      forwardHeaders['Access-Control-Allow-Origin'] = '*';
      forwardHeaders['Accept-Ranges'] = 'bytes';

      res.writeHead(tunnelRes.status, forwardHeaders);

      if (req.method !== 'HEAD' && tunnelRes.body) {
        Readable.fromWeb(tunnelRes.body).pipe(res);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(`Tunnel error: ${err.message}`);
    }
  }

  // 5b. YouTube extraction proxy (yt-dlp servisi — cobalt'ın YouTube desteği
  // yetersiz kaldığı için ayrı bir servise yönlendirilir, bkz. CLAUDE.md).
  // Gerçek istemci IP'si ytdlp-service'in kendi hız sınırlaması için iletilir
  // (Cloudflare -> cf-connecting-ip; onun da olmadığı yerel testte soket IP'si).
  if (req.method === 'POST' && pathname === '/youtube-extract') {
    const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const ytRes = await fetch(`${YTDLP_API}/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Forwarded-For': clientIp
          },
          body: body,
          signal: AbortSignal.timeout(60000)
        });
        const data = await ytRes.json();
        res.writeHead(ytRes.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify(data));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'error', error: { code: 'ytdlp.backend.error', message: err.message } }));
      }
    });
    return;
  }

  // 5c. YouTube remux stream proxy — ffmpeg'in gerçek zamanlı birleştirdiği
  // video+ses akışını istemciye stream eder (diskte hiçbir aşamada dosya yok).
  if (pathname === '/youtube-remux') {
    const customFilename = (parsedUrl.searchParams.get('filename') || 'video.mp4').trim();
    const ext = (parsedUrl.searchParams.get('ext') || 'mp4').toLowerCase();
    const cleanAscii = customFilename.replace(/[^\w\s\u00C0-\u017F.-]/gi, '_');
    const contentType = ext === 'webm' ? 'video/webm' : 'video/mp4';

    // FDM / İndirme Yöneticileri dosya boyutu/tipi sorguladığında (HEAD) anında yanıt ver
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(customFilename)}`,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store'
      });
      return res.end();
    }

    if (req.method === 'GET') {
      try {
        const clientIp = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
        const targetUrl = `${YTDLP_API}/remux${parsedUrl.search}`;
        const remuxRes = await fetch(targetUrl, {
          method: 'GET',
          headers: { 'X-Forwarded-For': clientIp }
        });

        if (!remuxRes.ok) {
          res.writeHead(remuxRes.status, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(await remuxRes.text());
        }

        const forwardHeaders = {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${cleanAscii}"; filename*=UTF-8''${encodeURIComponent(customFilename)}`,
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache, no-store'
        };

        res.writeHead(200, forwardHeaders);
        if (remuxRes.body) {
          Readable.fromWeb(remuxRes.body).pipe(res);
        } else {
          res.end();
        }
        return;
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        return res.end(`Remux error: ${err.message}`);
      }
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
