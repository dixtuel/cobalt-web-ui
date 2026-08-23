# Cobalt Web UI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Live Demo](https://img.shields.io/badge/Live-cobalt.dxtl.com.tr-green.svg?style=flat-square)](https://cobalt.dxtl.com.tr)

[imputnet/cobalt](https://github.com/imputnet/cobalt) API'si için bağımsız, özgün bir web arayüzü. Node.js tabanlı, hafif, kodu yok basit ve production-ready.

## Özellikler

- **Basit ve hızlı:** Node.js built-in modülleri, harici bağımlılık yok
- **Responsive tasarım:** Mobil ve masaüstü cihazlarda sorunsuz çalışır
- **Türkçe arayüz:** Tamamı Türkçe, "Kobalt" element temalı
- **Proxy route'ları:** `/api`, `/tunnel`, `/tiktok-api`, `/media-stream` aracılığıyla Cobalt API'sine erişim
- **Docker desteği:** Self-host için `docker-compose.yml` örneği dahil
- **MIT Lisansı:** Özgürce kullan, değiştir, dağıt

## Canlı Demo

Arayüz şu adreste canlı olarak çalışmaktadır:
**https://cobalt.dxtl.com.tr**

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
