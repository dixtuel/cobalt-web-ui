"""Downloader — YouTube extraction service.

yt-dlp tabanlı, tek amaçlı bir mikroservis: yalnızca bir video hakkında bilgi
ve doğrudan indirilebilir CDN URL'sini döner. Gerçek video baytları burada
diske hiç yazılmaz — video+ses ayrı akış olarak gelirse (modern YouTube'da
çoğu zaman böyle) ffmpeg iki uzak URL'yi doğrudan HTTP yanıtına pipe'layarak
gerçek zamanlı birleştirir (cobalt'ın /tunnel mantığıyla aynı prensip).
Yalnızca küçük JSON'luk çözümleme isteği, IP-tabanlı bloklamayı azaltmak için
isteğe bağlı bir Deno relé üzerinden gönderilebilir.
"""
import itertools
import os
import re
import subprocess
import threading
import time
from urllib.parse import urlparse

import yt_dlp
from flask import Flask, Response, jsonify, request

app = Flask(__name__)

DENO_RELAY_URL = (os.environ.get("DENO_RELAY_URL") or "").strip()
DENO_RELAY_SECRET = (os.environ.get("DENO_RELAY_SECRET") or "").strip()
POT_PROVIDER_URL = (os.environ.get("POT_PROVIDER_URL") or "http://pot-provider:4416").strip()
COOKIES_FILE = (os.environ.get("YTDLP_COOKIES_FILE") or "").strip()

# 2 direkt : 4 relé oranı. Tek process içinde bellekte tutulan basit bir
# döngü yeterli — mikoshi'deki Redis tabanlı çoklu-worker senkronizasyonuna
# burada ihtiyaç yok (bu servis tek worker ile çalışır).
_ROUTE_PATTERN = ("direct", "relay", "direct", "relay", "relay", "relay")
_route_counter = itertools.count()
_route_lock = threading.Lock()

FORMAT_MAP = {
    "auto": "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]/bestvideo+bestaudio/best",
    "mute": "bestvideo[vcodec^=avc1]/bestvideo/best",  # tek akış, remux gerekmez
    "audio": "bestaudio[ext=m4a]/bestaudio/best[acodec!=none]",  # tek akış, remux gerekmez
}

# --- Güvenlik: SSRF ve kaynak-tüketimi koruması -----------------------------
# /extract yalnızca gerçek YouTube URL'lerini kabul eder (rastgele bir URL'yi
# yt-dlp'ye/ffmpeg'e vermek, servisimizi genel amaçlı bir SSRF/anonimleştirme
# rölesine çevirir). /remux ise yalnızca yt-dlp'nin kendi döndürdüğü URL'lerin
# gittiği bilinen Google/YouTube CDN host'larını kabul eder.
YOUTUBE_URL_RE = re.compile(r"^https?://([\w-]+\.)?(youtube\.com|youtu\.be|music\.youtube\.com)/", re.I)
GOOGLEVIDEO_URL_RE = re.compile(r"^https?://([\w-]+\.)?(googlevideo\.com|youtube\.com|ytimg\.com)/", re.I)

# Basit sabit-pencere hız sınırlama (IP başına dakikada N istek). Redis yok —
# bu servis tek process/tek worker ile çalışıyor, bellekte tutmak yeterli.
_RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "10"))
_RATE_LIMIT_WINDOW_SEC = 60
_rate_state: dict[str, tuple[int, float]] = {}
_rate_lock = threading.Lock()


def _client_ip() -> str:
    # server.js her zaman iç ağdan bağlanır; gerçek istemci IP'si varsa
    # X-Forwarded-For üzerinden gelir (Cloudflare -> cobalt-web -> burası).
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.remote_addr or "unknown")


def rate_limited() -> bool:
    ip = _client_ip()
    now = time.time()
    with _rate_lock:
        count, window_start = _rate_state.get(ip, (0, now))
        if now - window_start > _RATE_LIMIT_WINDOW_SEC:
            count, window_start = 0, now
        count += 1
        _rate_state[ip] = (count, window_start)
        return count > _RATE_LIMIT_MAX


def next_route() -> str:
    if not DENO_RELAY_URL:
        return "direct"
    with _route_lock:
        i = next(_route_counter) % len(_ROUTE_PATTERN)
    return _ROUTE_PATTERN[i]


def build_proxy_url() -> str | None:
    """yt-dlp `--proxy` formatı: http://[secret@]host:port — Deno relé
    isteği bir HTTP CONNECT proxy'si gibi işler (bkz. deno-relay/main.ts)."""
    if not DENO_RELAY_URL:
        return None
    parsed = urlparse(DENO_RELAY_URL)
    auth = f"{DENO_RELAY_SECRET}@" if DENO_RELAY_SECRET else ""
    return f"{parsed.scheme}://{auth}{parsed.netloc}"


def run_extract(url: str, fmt: str, proxy: str | None) -> dict:
    ydl_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 20,
        "extractor_args": {
            "youtubepot-bgutilhttp": {"base_url": [POT_PROVIDER_URL]},
        },
    }
    if proxy:
        ydl_opts["proxy"] = proxy
    if COOKIES_FILE:
        ydl_opts["cookiefile"] = COOKIES_FILE

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)


@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "ytdlp-service"})


@app.route("/extract", methods=["POST"])
def extract():
    if rate_limited():
        return jsonify({"status": "error", "error": {"code": "rate_limited", "message": "Çok fazla istek, biraz bekleyin."}}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url or not YOUTUBE_URL_RE.match(url):
        return jsonify({"status": "error", "error": {"code": "invalid_url", "message": "Geçerli bir YouTube URL'si gerekli"}}), 400

    download_mode = data.get("downloadMode", "auto")
    fmt = FORMAT_MAP.get(download_mode, FORMAT_MAP["auto"])

    route = next_route()
    proxy = build_proxy_url() if route == "relay" else None

    try:
        info = run_extract(url, fmt, proxy)
    except Exception as exc:
        if proxy:
            # Relé başarısız oldu — bu istek için doğrudan VDS IP'sine düş.
            try:
                info = run_extract(url, fmt, None)
                route = "direct-fallback"
            except Exception as exc2:
                return jsonify({"status": "error", "error": {"code": "extract_failed", "message": str(exc2)}}), 502
        else:
            return jsonify({"status": "error", "error": {"code": "extract_failed", "message": str(exc)}}), 502

    title = (info.get("title") or "video").strip()
    requested = info.get("requested_formats")

    if requested and len(requested) >= 2:
        # Video ve ses ayrı akış olarak geldi — /remux üzerinden gerçek
        # zamanlı birleştirme gerekir (bkz. dosya başındaki not).
        video_fmt, audio_fmt = requested[0], requested[1]
        video_url = video_fmt.get("url")
        audio_url = audio_fmt.get("url")
        if not video_url or not audio_url:
            return jsonify({"status": "error", "error": {"code": "no_stream", "message": "İndirme linki bulunamadı"}}), 502
        out_ext = "mp4" if (video_fmt.get("ext") == "mp4") else "webm"
        from urllib.parse import quote
        remux_path = (
            f"/youtube-remux?video={quote(video_url, safe='')}"
            f"&audio={quote(audio_url, safe='')}&ext={out_ext}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "route": route,
        })

    direct_url = info.get("url")
    if not direct_url and info.get("requested_downloads"):
        direct_url = info["requested_downloads"][0].get("url")
    if not direct_url:
        return jsonify({"status": "error", "error": {"code": "no_stream", "message": "İndirme linki bulunamadı"}}), 502

    ext = info.get("ext", "mp4")
    return jsonify({
        "status": "redirect",
        "url": direct_url,
        "filename": f"{title}.{ext}",
        "route": route,
    })


@app.route("/remux", methods=["GET"])
def remux():
    if rate_limited():
        return "Çok fazla istek, biraz bekleyin.", 429

    video_url = (request.args.get("video") or "").strip()
    audio_url = (request.args.get("audio") or "").strip()
    ext = (request.args.get("ext") or "mp4").strip()
    if ext not in ("mp4", "webm"):
        ext = "mp4"

    if not GOOGLEVIDEO_URL_RE.match(video_url) or not GOOGLEVIDEO_URL_RE.match(audio_url):
        return "Geçersiz kaynak URL", 400

    args = [
        "ffmpeg", "-loglevel", "error",
        "-i", video_url,
        "-i", audio_url,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy",
        "-f", ext if ext == "webm" else "mp4",
    ]
    if ext == "mp4":
        args += ["-movflags", "frag_keyframe+empty_moov+faststart"]
    args += ["pipe:1"]

    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=1024 * 64)

    def generate():
        try:
            while True:
                chunk = proc.stdout.read(1024 * 64)
                if not chunk:
                    break
                yield chunk
        finally:
            proc.stdout.close()
            proc.terminate()

    mimetype = "video/webm" if ext == "webm" else "video/mp4"
    headers = {
        "Content-Disposition": f'attachment; filename="video.{ext}"',
        "Cache-Control": "no-cache, no-store",
    }
    return Response(generate(), mimetype=mimetype, headers=headers)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
