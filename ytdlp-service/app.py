"""Downloader — YouTube extraction service.

yt-dlp tabanlı, tek amaçlı bir mikroservis: yalnızca bir video hakkında bilgi
ve doğrudan indirilebilir CDN URL'sini döner. Gerçek video baytları burada
diske hiç yazılmaz — video+ses ayrı akış olarak gelirse (modern YouTube'da
çoğu zaman böyle) ffmpeg iki uzak URL'yi doğrudan HTTP yanıtına pipe'layarak
gerçek zamanlı birleştirir (cobalt'ın /tunnel mantığıyla aynı prensip).

Not (2026-08-23): Deno Deploy (ve AWS Lambda) ham CONNECT tünellemesini
platform seviyesinde desteklemiyor — yt-dlp'nin --proxy'sine doğrudan
verilemiyor. Bunun yerine `adapter.py` (mitmproxy, yalnız 127.0.0.1:8888'de,
start.sh ile arka planda başlatılır) yerel bir CONNECT-destekli proxy gibi
davranıp isteği relé'ye header-tabanlı iletir — yt-dlp'nin gördüğü sıradan
bir proxy, relé'nin gördüğü sıradan bir istek/yanıt. Bkz. proje CLAUDE.md,
"YouTube Desteği".
"""
import os
import re
import subprocess
import threading
import time

import yt_dlp
from flask import Flask, Response, jsonify, request

app = Flask(__name__)

POT_PROVIDER_URL = (os.environ.get("POT_PROVIDER_URL") or "http://pot-provider:4416").strip()
COOKIES_FILE = (os.environ.get("YTDLP_COOKIES_FILE") or "").strip()
YTDLP_COOKIES_TEXT = (os.environ.get("YTDLP_COOKIES_TEXT") or "").strip()
REDDIT_CLIENT_ID = (os.environ.get("REDDIT_CLIENT_ID") or "").strip()
REDDIT_CLIENT_SECRET = (os.environ.get("REDDIT_CLIENT_SECRET") or "").strip()
DENO_RELAY_URL = (os.environ.get("DENO_RELAY_URL") or "").strip()

FORMAT_MAP = {
    "auto": "bestvideo*+bestaudio/best",
    "mute": "bestvideo*/best",
    "audio": "bestaudio/best",
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
_RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "30"))
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


# Egress rotasyonu (2 direkt : 4 relé) artık burada değil — adapter.py'de
# (mitmproxy addon'u) yapılıyor. yt-dlp burada yalnız yerel adaptöre işaret
# eder; adaptör her isteği kendi başına direkt mi Deno/Lambda relé'sine mi
# göndereceğine karar verir. Adaptör en az bir relé için yapılandırıldıysa
# (DENO_RELAY_URL veya LAMBDA_RELAY_URL) etkindir.
ADAPTER_ACTIVE = bool(DENO_RELAY_URL or os.environ.get("LAMBDA_RELAY_URL"))
LOCAL_ADAPTER_PROXY = "http://127.0.0.1:8888"


def run_extract(url: str, fmt: str) -> dict:
    ydl_opts = {
        "format": fmt,
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 25,
        "remote_components": ["ejs:github"],
        "extractor_args": {
            "youtube": {"player_client": ["android", "ios", "web"]},
        },
    }
    if ADAPTER_ACTIVE:
        ydl_opts["proxy"] = LOCAL_ADAPTER_PROXY
        # Adaptör (mitmproxy) TLS'i kendi CA'sıyla yerel olarak sonlandırır —
        # bağlantı konteyner dışına hiç çıkmadığından cert doğrulaması burada
        # anlamsız; sistem güven zincirini değiştirmek yerine bilinçli olarak
        # atlanır (bkz. start.sh notu).
        ydl_opts["nocheckcertificate"] = True

    # Cookie bağlama: Doğrudan metin (.env) veya dosya yolu; yoksa normal/varsayılan mod
    cookie_path = None
    if YTDLP_COOKIES_TEXT and len(YTDLP_COOKIES_TEXT.strip()) > 30:
        try:
            cookie_tmp = "/tmp/cookies_env.txt"
            with open(cookie_tmp, "w", encoding="utf-8") as f:
                f.write(YTDLP_COOKIES_TEXT)
            cookie_path = cookie_tmp
        except Exception:
            pass
    elif COOKIES_FILE and os.path.isfile(COOKIES_FILE) and os.path.getsize(COOKIES_FILE) > 30:
        try:
            import shutil
            cookie_tmp = "/tmp/cookies_mounted.txt"
            shutil.copyfile(COOKIES_FILE, cookie_tmp)
            cookie_path = cookie_tmp
        except Exception:
            pass

    if cookie_path:
        ydl_opts["cookiefile"] = cookie_path
    else:
        # Cookie yoksa bgutil pot-provider ile anonim PO-Token üretimi dene
        ydl_opts.setdefault("extractor_args", {})["youtubepot-bgutilhttp"] = {"base_url": [POT_PROVIDER_URL]}

    # Reddit API: .env'de tanımlıysa eklenir; yoksa varsayılan anonim mod devam eder
    if REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET:
        ydl_opts.setdefault("extractor_args", {})["reddit"] = {
            "client_id": [REDDIT_CLIENT_ID],
            "client_secret": [REDDIT_CLIENT_SECRET],
        }

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

    try:
        info = run_extract(url, fmt)
    except Exception as exc:
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
            f"&audio={quote(audio_url, safe='')}&ext={out_ext}&filename={quote(f'{title}.{out_ext}', safe='')}"
        )
        return jsonify({
            "status": "redirect",
            "url": remux_path,
            "filename": f"{title}.{out_ext}",
            "adapter": ADAPTER_ACTIVE,
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
        "adapter": ADAPTER_ACTIVE,
    })


@app.route("/remux", methods=["GET"])
def remux():
    if rate_limited():
        return "Çok fazla istek, biraz bekleyin.", 429

    video_url = (request.args.get("video") or "").strip()
    audio_url = (request.args.get("audio") or "").strip()
    ext = (request.args.get("ext") or "mp4").strip()
    filename = (request.args.get("filename") or f"video.{ext}").strip()
    if ext not in ("mp4", "webm"):
        ext = "mp4"

    if not GOOGLEVIDEO_URL_RE.match(video_url) or not GOOGLEVIDEO_URL_RE.match(audio_url):
        return "Geçersiz kaynak URL", 400

    args = [
        "ffmpeg", "-loglevel", "error",
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-i", video_url,
        "-reconnect", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "5",
        "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-i", audio_url,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c", "copy",
        "-f", ext if ext == "webm" else "mp4",
    ]
    if ext == "mp4":
        args += ["-movflags", "frag_keyframe+empty_moov+default_base_moof"]
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
    clean_ascii = re.sub(r'[^\w\s\u00C0-\u017F.-]', '_', filename)
    from urllib.parse import quote
    headers = {
        "Content-Disposition": f'attachment; filename="{clean_ascii}"; filename*=UTF-8\'\'{quote(filename)}',
        "Content-Type": mimetype,
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*",
        "Accept-Ranges": "bytes",
    }
    return Response(generate(), mimetype=mimetype, headers=headers)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
