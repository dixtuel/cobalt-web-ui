FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    flask \
    gunicorn \
    yt-dlp \
    bgutil-ytdlp-pot-provider \
    mitmproxy \
    httpx

COPY app.py adapter.py start.sh .
RUN chmod +x start.sh

EXPOSE 5000
CMD ["./start.sh"]
