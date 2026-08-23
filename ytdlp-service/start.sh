#!/bin/sh
# Yerel egress adaptörünü (mitmproxy) arka planda başlat, sonra Flask
# servisini ön planda çalıştır. Adaptör 0.0.0.0:8888'de dinler ama host'a
# hiç port açılmaz — yalnız Docker'ın iç ağından (mikoshi-vds_default)
# diğer konteynerler (cobalt, cobalt-web) erişebilir: http://ytdlp-service:8888.
# yt-dlp/cobalt bu adaptöre bağlanırken sertifika doğrulamasını atlar
# (app.py'de nocheckcertificate, cobalt'ta NODE_TLS_REJECT_UNAUTHORIZED=0)
# çünkü adaptör kendi CA'sıyla TLS'i yerel olarak sonlandırıyor — bağlantı
# zaten Docker'ın iç ağında kalıyor, dışarı hiç çıkmıyor.
set -e

mitmdump -s adapter.py --listen-host 0.0.0.0 --listen-port 8888 --set confdir=/app/.mitmproxy -q &

exec gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 2 --timeout 120 app:app
