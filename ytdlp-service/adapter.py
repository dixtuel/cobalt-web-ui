"""Downloader — Local egress adapter (mitmproxy addon).

yt-dlp'nin ağ katmanı standart bir HTTP/HTTPS (CONNECT) proxy bekliyor.
Deno Deploy ve AWS Lambda ise yalnız ayrık istek/yanıt (request/response)
destekliyor, ham CONNECT tünellemesi yapamıyor (2026-08-23'te canlıda
doğrulandı — bkz. proje CLAUDE.md, "YouTube Desteği").

Bu adaptör bu ikisi arasında köprü kurar: mitmproxy'yi (bu konteynerin
İÇİNDE, yalnız 127.0.0.1'de dinleyen) gerçek bir CONNECT-destekli proxy
olarak çalıştırır — TLS'i yerel olarak sonlandırır, isteği düz metin olarak
görür — sonra bu isteği relé'ye header-tabanlı (x-target-host) bir
istek/yanıt olarak iletir. yt-dlp'nin gördüğü: sıradan bir HTTP proxy.
Relé'nin gördüğü: sıradan bir POST isteği. Aradaki köprü burası.

Rota seçimi (2 direkt : 4 relé) burada, adaptörde yapılır — app.py artık
yt-dlp'yi hep bu adaptöre (`http://127.0.0.1:8888`) işaret eder, adaptör her
istek için kendi başına direkt mi relé mi gideceğine karar verir.
"""
import itertools
import os
import threading

import httpx
from mitmproxy import http

DENO_RELAY_URL = (os.environ.get("DENO_RELAY_URL") or "").rstrip("/")
DENO_RELAY_SECRET = os.environ.get("DENO_RELAY_SECRET") or ""
LAMBDA_RELAY_URL = (os.environ.get("LAMBDA_RELAY_URL") or "").rstrip("/")
LAMBDA_RELAY_SECRET = os.environ.get("LAMBDA_RELAY_SECRET") or ""

# 2 direkt : 4 relé — relé'ler arasında (yalnız ikisi de yapılandırılmışsa)
# eşit bölünür. Şu an yalnız Deno deploy edildi; Lambda env'leri boşsa tüm
# relé payı Deno'ya gider (bkz. .env.example).
if LAMBDA_RELAY_URL:
    _PATTERN = ("direct", "deno", "direct", "deno", "lambda", "lambda")
else:
    _PATTERN = ("direct", "deno", "direct", "deno", "deno", "deno")

_counter = itertools.count()
_lock = threading.Lock()


def next_route() -> str:
    if not DENO_RELAY_URL and not LAMBDA_RELAY_URL:
        return "direct"
    with _lock:
        i = next(_counter) % len(_PATTERN)
    return _PATTERN[i]


def _relay_target(route: str) -> tuple[str, str] | None:
    if route == "deno" and DENO_RELAY_URL:
        return DENO_RELAY_URL, DENO_RELAY_SECRET
    if route == "lambda" and LAMBDA_RELAY_URL:
        return LAMBDA_RELAY_URL, LAMBDA_RELAY_SECRET
    return None


class RelayAdapter:
    def request(self, flow: http.HTTPFlow) -> None:
        route = next_route()
        target = _relay_target(route)
        if target is None:
            return  # "direct" — mitmproxy normal davranışıyla gerçek hedefe gider

        relay_base, relay_secret = target
        req = flow.request
        target_host = f"{req.scheme}://{req.host}"
        if req.port not in (80, 443):
            target_host += f":{req.port}"

        headers = dict(req.headers)
        headers.pop("host", None)
        headers.pop("proxy-connection", None)
        headers["x-target-host"] = target_host
        headers["x-proxy-secret"] = relay_secret

        try:
            resp = httpx.request(
                req.method,
                f"{relay_base}{req.path}",
                headers=headers,
                content=req.content,
                timeout=30.0,
            )
            flow.response = http.Response.make(
                resp.status_code, resp.content, dict(resp.headers)
            )
        except Exception as exc:
            flow.response = http.Response.make(502, f"relay error: {exc}".encode())


addons = [RelayAdapter()]
