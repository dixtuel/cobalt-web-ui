// Downloader — Egress Relay (Deno Deploy)
//
// ÖNEMLİ (2026-08-23'te canlıda doğrulandı): Deno Deploy'un edge/routing
// katmanı ("deployd") çok-kiracılı bir router — istekleri yalnız uygulamanın
// kendi kayıtlı domain'ine (Host header eşleşmesine) göre yönlendirir. Ham
// CONNECT tünelleme (rastgele bir hedefe, örn. CONNECT www.google.com:443)
// bu router seviyesinde INVALID_HOST_HEADER ile reddedilir — Deno.connect()
// scriptin İÇİNDE çalışsa bile istek scripte hiç ulaşmaz. Bu yüzden yt-dlp
// gibi bir istemcinin --proxy bayrağına doğrudan verilebilecek şeffaf bir
// forward-proxy burada MÜMKÜN DEĞİL (bkz. proje CLAUDE.md, "YouTube Desteği"
// bölümü — bu, yt-dlp trafiğinin doğrudan VDS IP'sinden gitmesinin nedeni).
//
// Bunun yerine mikoshi-ai'nin egress sisteminde de kullanılan, gerçekten
// çalışan desen: normal bir istek/yanıt (Request/Response) reverse-proxy'si.
// Hedef host bir header'da (x-target-host) taşınır, gövde/yol/method aynen
// iletilir. Bu, KENDİ yazdığımız kodun (örn. Downloader'daki bir API çağrısı)
// bu relé üzerinden gitmesini istediğimizde kullanılabilir — yt-dlp'nin iç
// ağına şeffaf giremez, ama kendi fetch()/requests çağrılarımız için işe yarar.
//
// Kullanım:
//   fetch("https://downloader-egress-relay.dixtuel.deno.net/<path>", {
//     headers: {
//       "x-target-host": "https://example.com",
//       "x-proxy-secret": "<RELAY_SECRET>",
//     },
//   })

const RELAY_SECRET = Deno.env.get("RELAY_SECRET") ?? "";

Deno.serve(async (req) => {
  const targetHost = req.headers.get("x-target-host");
  const secret = req.headers.get("x-proxy-secret");

  if (RELAY_SECRET && secret !== RELAY_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!targetHost) {
    return new Response(
      JSON.stringify({ status: "ok", service: "downloader-egress-relay" }),
      { headers: { "content-type": "application/json" } },
    );
  }

  const incoming = new URL(req.url);
  const targetUrl = targetHost.replace(/\/$/, "") + incoming.pathname + incoming.search;

  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.delete("x-target-host");
  forwardHeaders.delete("x-proxy-secret");
  forwardHeaders.delete("host");

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    });
    return upstream;
  } catch (err) {
    return new Response(`Bad Gateway: ${err}`, { status: 502 });
  }
});
