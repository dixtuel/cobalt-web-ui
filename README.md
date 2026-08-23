# Downloader — Cobalt Web UI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-downloader.dxtl.com.tr-green.svg?style=flat-square)](https://downloader.dxtl.com.tr)

[imputnet/cobalt](https://github.com/imputnet/cobalt) API'si için bağımsız, özgün ve tam teşekküllü bir web arayüzü — "**Downloader**" markasıyla yayınlanır. Node.js tabanlı, hafif, harici bağımlılığı yok, production-ready.

## Özellikler

- **Basit ve hızlı:** Node.js built-in modülleri, harici bağımlılık yok
- **Responsive & Modern tasarım:** Mobil ve masaüstü cihazlarda mükemmel uyum
- **Çoklu Platform Desteği:** YouTube, TikTok, Instagram, Twitter/X, Reddit, SoundCloud
- **Sessiz video indirme:** Ses kanalı olmadan (mute) video indirme seçeneği
- **Ses formatı & bit hızı seçimi:** MP3, M4A, Opus, WAV ve otomatik en iyi kalite
- **İndirme Yöneticisi Desteği (FDM, IDM):** `Range`, `If-Range` ve hızlı `HEAD` yanıtları ile kesintisiz indirme, duraklatma ve devam ettirme desteği (%99 kilitlenmeleri önlenmiştir)
- **Gelişmiş YouTube Çözümleme:** Deno JS motoru entegreli EJS meydan okuma çözücüsü (`n-sig`), opsiyonel `cookies.txt` ve PO-Token fallback'i
- **Çift Egress Röle Mimarisi:** Deno Deploy ve AWS Lambda üzerinden IP rotasyonu ve otomatik fallback (`deno` ↔ `lambda` → `direct`)
- **Türkçe arayüz:** Tamamı Türkçe, KVKK uyumlu gizlilik politikası ve şartlar
- **Proxy route'ları:** `/api`, `/tunnel`, `/tiktok-api`, `/media-stream`, `/youtube-extract`, `/youtube-remux`
- **AdSense hazır:** `.env` ile yapılandırılabilir reklam alanları
- **SEO & Sosyal Medya Hazır:** `robots.txt`, `sitemap.xml`, 1200×1200 Open Graph / Twitter Card meta etiketleri
- **Docker desteği:** Self-host için `docker-compose.yml` örneği dahil
- **MIT Lisansı:** Özgürce kullan, değiştir, dağıt

## Canlı Demo

Arayüz "Downloader" adıyla şu adreste canlı olarak çalışmaktadır:
**https://downloader.dxtl.com.tr**

## Self-Host Kurulumu

### Gereksinimler

- Node.js 18+ (doğrudan çalıştırma için)
- veya Docker + Docker Compose

### Docker ile Çalıştırma (Önerilen)

1. `docker-compose.example.yml` dosyasını `docker-compose.yml` olarak kopyala:
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   ```

2. İsteğe bağlı ortam dosyalarını hazırla:
   ```bash
   cp .env.example .env
   cp ytdlp-service/.env.example ytdlp-service/.env
   ```

3. Servisleri başlat:
   ```bash
   docker compose up -d
   ```

4. Arayüze `http://localhost:8081` adresinden erişin.

## Ortam Değişkenleri

### Web UI (`.env`)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `COBALT_API` | `http://cobalt-api:9000` | Cobalt API konteynerinin iç adresi |
| `YTDLP_API` | `http://ytdlp-service:5000` | YouTube extractor servisinin iç adresi |
| `PORT` | `80` | Web sunucusunun dinlemesi gereken port |
| `NODE_ENV` | `production` | Node.js çalışma ortamı |
| `ADSENSE_CLIENT_ID` | (boş) | Google AdSense yayıncı kimliği (`ca-pub-...`). Boşsa reklamlar yüklenmez. |
| `ADSENSE_SLOT_CONTENT` | (boş) | İçerik altındaki responsive reklam slot ID'si |
| `ADSENSE_SLOT_RAIL_LEFT` | (boş) | Masaüstünde sol kenar (160×600) reklam slot ID'si |
| `ADSENSE_SLOT_RAIL_RIGHT` | (boş) | Masaüstünde sağ kenar (160×600) reklam slot ID'si |

### YouTube Servisi (`ytdlp-service/.env`)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `YTDLP_COOKIES_FILE` | `/app/cookies/cookies.txt` | YouTube hesap çerezleri dosya yolu (isteğe bağlı) |
| `YTDLP_COOKIES_TEXT` | (boş) | Doğrudan çerez metni yapıştırma alanı (isteğe bağlı) |
| `REDDIT_CLIENT_ID` | (boş) | Reddit API Client ID (isteğe bağlı) |
| `REDDIT_CLIENT_SECRET` | (boş) | Reddit API Secret (isteğe bağlı) |
| `DENO_RELAY_URL` | (boş) | Deno Deploy egress rölesi URL'si |
| `DENO_RELAY_SECRET` | (boş) | Deno Deploy röle güvenlik anahtarı (`x-proxy-secret`) |
| `LAMBDA_RELAY_URL` | (boş) | AWS Lambda egress rölesi Function URL'si |
| `LAMBDA_RELAY_SECRET` | (boş) | AWS Lambda röle güvenlik anahtarı (`x-proxy-secret`) |

## YouTube Desteği ve Egress Mimarisi

Cobalt'ın yerleşik YouTube extractor'ı, YouTube'un PO-token (Proof-of-Origin) ve n-sig meydan okumalarını topluluk-çaplı [yt-dlp](https://github.com/yt-dlp/yt-dlp) kadar hızlı takip edemeyebilir. Bu projede:

1. **Özel Extractor:** `ytdlp-service/` (Python/Flask/yt-dlp + Deno JS motoru) video bilgilerini canlı çözer, diske yazmaz.
2. **Gerçek Zamanlı Remux:** Ayrı gelen video ve ses akışları `ffmpeg` ile sunucuda diske kaydedilmeden doğrudan HTTP yanıtına **pipe** edilir.
3. **Egress Röleleri (Deno & AWS Lambda):**
   - Datacenter IP bloklarını aşmak için `deno-relay/main.ts` (Deno Deploy) ve `lambda-relay/index.mjs` (AWS Lambda) şablonları sunulmuştur.
   - Yerel `adapter.py` (mitmproxy) yt-dlp ile röleler arasında köprü kurar; kota ve hata durumlarında `deno` ↔ `lambda` → `direct` zincirinde otomatik geçiş yapar.

## Proje Yapısı

```
.
├── server.js                   # Node.js HTTP sunucusu, route proxy'si ve MIME yönetimi
├── html/
│   ├── index.html             # Ana arayüz (Clean UI, OpenGraph 1200x1200)
│   ├── app.js                 # İstemci mantığı, format & kalite yönetimi
│   ├── style.css              # Modern responsive CSS stilleri
│   ├── terms.html             # Kullanım Şartları
│   └── privacy.html           # Gizlilik Politikası
├── ytdlp-service/
│   ├── app.py                 # YouTube extraction + remux servisi
│   ├── adapter.py             # Yerel egress adaptörü (mitmproxy köprüsü)
│   ├── start.sh               # Servis başlatıcı (Gunicorn concurrency)
│   ├── Dockerfile             # Python 3.12 + ffmpeg + Deno runtime
│   ├── deno-relay/
│   │   └── main.ts            # Deno Deploy egress rölesi
│   └── lambda-relay/
│       └── index.mjs          # AWS Lambda egress rölesi
├── docker-compose.example.yml   # Docker Compose şablonu
├── README.md                  # Bu dosya
└── LICENSE                    # MIT Lisansı
```

## Kredi ve İlişki

Bu proje **resmi Cobalt projesi (`imputnet/cobalt`) ile doğrudan ilişkili değildir**. Tamamen bağımsız, özgün bir web arayüzüdür ve Cobalt API'sini (https://github.com/imputnet/cobalt) kullanır.

## Lisans

MIT Lisansı altında yayımlanmıştır. Detaylar için [LICENSE](LICENSE) dosyasını inceleyin.
