// Downloader — Egress Relay (Deno Deploy)
//
// Gerçek bir HTTP CONNECT proxy: yt-dlp'nin --proxy bayrağı doğrudan buna
// işaret edebilir (standart forward-proxy protokolü). Deno Deploy'un ham
// TCP soket desteği (Deno.connect) sayesinde bu mümkün — AWS Lambda gibi
// request/response-only platformlarda yapılamaz (bkz. proje CLAUDE.md'si).
//
// Kullanım: yt-dlp --proxy "http://<RELAY_SECRET>@<bu-projenin-deno-domaini>"
//
// Paylaşılan sır, standart HTTP Basic/Proxy-Authorization ile kontrol edilir
// (yt-dlp proxy URL'sindeki user:pass kısmını otomatik olarak
// Proxy-Authorization header'ına çevirir).

const RELAY_SECRET = Deno.env.get("RELAY_SECRET") ?? "";

function unauthorized(): Response {
  return new Response("Proxy Authentication Required", {
    status: 407,
    headers: { "Proxy-Authenticate": "Basic realm=\"relay\"" },
  });
}

function checkAuth(req: Request): boolean {
  if (!RELAY_SECRET) return true; // secret ayarlanmadıysa (yalnız test için) serbest bırak
  const header = req.headers.get("proxy-authorization") || req.headers.get("authorization");
  if (!header) return false;
  const b64 = header.replace(/^Basic\s+/i, "");
  try {
    const decoded = atob(b64); // "<secret>:" formatında gelir (yt-dlp user:pass'i böyle kodlar)
    const secret = decoded.split(":")[0];
    return secret === RELAY_SECRET;
  } catch {
    return false;
  }
}

async function handleConnect(req: Request, connInfo: Deno.ServeHandlerInfo): Promise<Response> {
  // CONNECT host:port — HTTPS trafiği için ham TCP tünel.
  const target = new URL(`http://${req.url.replace(/^.*?:\/\//, "") || req.headers.get("host")}`);
  const [host, portStr] = (req.headers.get("host") || target.host).split(":");
  const port = Number(portStr) || 443;

  let targetConn: Deno.TcpConn;
  try {
    targetConn = await Deno.connect({ hostname: host, port });
  } catch (err) {
    return new Response(`Bad Gateway: ${err}`, { status: 502 });
  }

  // Deno.serve üzerinden gelen isteği ham bir duplex soket olarak ele almak
  // için Deno'nun HTTP upgrade mekanizması kullanılır.
  const { socket, response } = Deno.upgradeHttpRaw(req, connInfo as unknown as Deno.Conn);
  (async () => {
    try {
      await Promise.all([
        socket.readable.pipeTo(targetConn.writable),
        targetConn.readable.pipeTo(socket.writable),
      ]);
    } catch {
      // bağlantı kapandı — normal
    } finally {
      try { targetConn.close(); } catch { /* already closed */ }
    }
  })();
  return response;
}

async function handlePlainForward(req: Request): Promise<Response> {
  // Düz HTTP istekleri (nadiren kullanılır, çoğu trafik HTTPS/CONNECT) için
  // basit bir fetch passthrough.
  const upstream = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  return upstream;
}

Deno.serve({ port: 8080 }, async (req, connInfo) => {
  if (!checkAuth(req)) return unauthorized();

  if (req.method === "CONNECT") {
    return handleConnect(req, connInfo);
  }
  return handlePlainForward(req);
});
