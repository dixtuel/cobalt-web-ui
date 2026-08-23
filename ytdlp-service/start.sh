#!/bin/sh
# Yerel egress adaptörünü (mitmproxy) arka planda başlat, sonra Flask
# servisini ön planda çalıştır. Adaptör yalnız 127.0.0.1'de dinler, dışarıya
# hiç açılmaz. yt-dlp bu adaptöre bağlanırken sertifika doğrulamasını
# atlar (app.py'de nocheckcertificate) çünkü adaptör kendi CA'sıyla TLS'i
# yerel olarak sonlandırıyor — bağlantı zaten konteyner içinde kalıyor.
set -e

mitmdump -s adapter.py --listen-host 127.0.0.1 --listen-port 8888 --set confdir=/app/.mitmproxy -q &

exec gunicorn --bind 0.0.0.0:5000 --workers 1 --timeout 120 app:app
