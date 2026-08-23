# Downloader — Cobalt Web UI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-downloader.dxtl.com.tr-green.svg?style=flat-square)](https://downloader.dxtl.com.tr)

[imputnet/cobalt](https://github.com/imputnet/cobalt) API'si için bağımsız, özgün bir web arayüzü — "**Downloader**" markasıyla yayınlanır. Node.js tabanlı, hafif, harici bağımlılığı yok, production-ready.

## Özellikler

- **Basit ve hızlı:** Node.js built-in modülleri, harici bağımlılık yok
- **Responsive tasarım:** Mobil ve masaüstü cihazlarda sorunsuz çalışır
- **Sessiz video indirme:** Ses kanalı olmadan (mute) video indirme seçeneği
- **Ses bit hızı seçimi:** 320'den 8 kbps'e kadar (Cobalt API `audioBitrate`)
- **Türkçe arayüz:** Tamamı Türkçe, KVKK uyumlu gizlilik politikası
- **Proxy route'ları:** `/api`, `/tunnel`, `/tiktok-api`, `/media-stream` aracılığıyla Cobalt API'sine erişim
- **YouTube desteği:** Cobalt'ın YouTube extractor'ı yerine ayrı bir yt-dlp servisi (bkz. "YouTube Desteği" bölümü)
- **AdSense hazır:** `.env` ile yapılandırılabilir reklam alanları (bkz. aşağıda)
- **SEO hazır:** `robots.txt`, `sitemap.xml`, Open Graph / Twitter Card meta etiketleri
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

2. Dosyayı ihtiyacına göre düzenle:
   - `COBALT_API`: Kendi cobalt API konteynerinizin adresi
   - `API_URL`: Cobalt API'sinin public adresi (indirme linkleri için gerekli)
   - Port numarası (varsayılan: `8081`)

3. Servisleri başlat:
   ```bash
   docker compose up -d
   ```

4. Arayüze `http://localhost:8081` adresinden erişin.

### Doğrudan Node.js ile Çalıştırma

1. Bağımlılıkları yükle (zaten yok ama gerekirse):
   ```bash
   npm install
   ```

2. Ortam değişkenlerini ayarla:
   ```bash
   export COBALT_API=http://localhost:9000
   export PORT=80
   ```

3. Sunucuyu başlat:
   ```bash
   node server.js
   ```

## Ortam Değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `COBALT_API` | `http://cobalt:9000` | Cobalt API konteynerinin iç adresi |
| `PORT` | `80` | Web sunucusunun dinlemesi gereken port |
| `NODE_ENV` | (değişken yok) | Node.js ortam (isteğe bağlı, `production` önerilir) |
| `ADSENSE_CLIENT_ID` | (boş) | Google AdSense yayıncı kimliği (`ca-pub-...`). Boşsa hiç reklam yüklenmez. |
| `ADSENSE_SLOT_CONTENT` | (boş) | İçerik altındaki duyarlı (responsive) reklam alanının slot ID'si |
| `ADSENSE_SLOT_RAIL_LEFT` | (boş) | Masaüstünde sol kenar (160×600) reklam alanının slot ID'si |
| `ADSENSE_SLOT_RAIL_RIGHT` | (boş) | Masaüstünde sağ kenar (160×600) reklam alanının slot ID'si |

`ADSENSE_CLIENT_ID` tanımlı ama bir slot ID'si boşsa, o alan yalnızca placeholder
göstermeye devam eder — hiçbir alan zorunlu değildir. `.env.example` dosyasını
`.env` olarak kopyalayıp kendi değerlerinizi girin; `.env` `.gitignore` ile
sürüm kontrolünün dışında tutulur.

## YouTube Desteği

Cobalt'ın kendi YouTube extractor'ı, YouTube'un PO-token (Proof-of-Origin) zorunluluğunu ve sık değişen obfuscation'ını topluluk-çaplı [yt-dlp](https://github.com/yt-dlp/yt-dlp) kadar hızlı takip edemiyor; datacenter/VPS IP'lerinden gelen istekler genelde `LOGINREQUIRED` ile bloke ediliyor. Bu yüzden **YouTube linkleri cobalt yerine `ytdlp-service`'e gider**, diğer tüm platformlar (TikTok/Instagram/Twitter/Reddit/SoundCloud) cobalt üzerinde kalır.

- `ytdlp-service/` — yt-dlp tabanlı Flask servisi. Video bilgisini çözümler, diske hiçbir şey yazmaz.
- `pot-provider` — [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) sidecar'ı, PO-token üretir.
- **Gerçek zamanlı remux:** Modern YouTube videolarının çoğunda video ve ses ayrı akış olarak gelir. Sunucu bunları indirip birleştirmek yerine `ffmpeg`'i iki uzak URL'yi `-c copy` ile doğrudan HTTP yanıtına **pipe** edecek şekilde çalıştırır — disk kullanılmaz, cobalt'ın `/tunnel` mantığıyla aynı prensip.
- **Egress relé (isteğe bağlı):** `DENO_RELAY_URL`/`DENO_RELAY_SECRET` boş bırakılırsa tüm istekler doğrudan sunucunuzun IP'sinden gider. IP-tabanlı bloklamayı azaltmak isterseniz `ytdlp-service/deno-relay/main.ts`'i kendi [Deno Deploy](https://deno.com/deploy) hesabınıza deploy edip (`deployctl deploy`) bu env'leri doldurabilirsiniz — relé gerçek bir HTTP CONNECT proxy'si olarak çalışır (Deno Deploy'un ham TCP soket desteği sayesinde), yt-dlp'nin `--proxy` bayrağına doğrudan verilir.
- **Güvenlik:** `/extract` yalnız `youtube.com`/`youtu.be`, `/remux` yalnız `googlevideo.com` host'larını kabul eder (SSRF koruması); IP başına dakikada `RATE_LIMIT_MAX` (varsayılan 10) istekle sınırlıdır.
- Kurulum için `.env.example`'ı `ytdlp-service/.env` olarak kopyalayın; hiçbir alan zorunlu değildir.

## Yapı

```
.
├── server.js              # Node.js HTTP sunucusu, route proxy'si
├── html/
│   ├── index.html        # Ana arayüz
│   ├── app.js            # Client-side lojik
│   ├── style.css         # CSS stilleri
│   ├── terms.html        # Kullanım Şartları
│   └── privacy.html      # Gizlilik Politikası
├── ytdlp-service/
│   ├── app.py             # YouTube extraction + remux servisi
│   ├── Dockerfile
│   └── deno-relay/
│       └── main.ts        # İsteğe bağlı egress relé (Deno Deploy)
├── docker-compose.example.yml  # Self-host örneği
├── README.md             # Bu dosya
└── LICENSE               # MIT Lisansı
```

## Kredi ve İlişki

Bu proje **resmi Cobalt projesi (`imputnet/cobalt`) ile hiç ilişkili değildir**. Tamamen bağımsız, özgün bir web arayüzüdür ve Cobalt API'sini (https://github.com/imputnet/cobalt) kullanır. Tasarım, kaynak kod ve tüm özellikler sıfırdan yazılmıştır.

## Lisans

MIT Lisansı altında yayımlanmıştır. Detaylar için [LICENSE](LICENSE) dosyasını okuyun.

## İletişim

Hata bildir veya öneride bulun: [GitHub Issues](https://github.com/dixtuel/cobalt-web-ui/issues)
