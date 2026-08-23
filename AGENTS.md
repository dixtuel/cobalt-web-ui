# Downloader (cobalt-web-ui) — AI Assistant Guide

This file is part of the `CLAUDE.md`/`AGENTS.md`/`GEMINI.md` trio — all three are kept identical. It's the public, open-source guide for this repo (`dixtuel/cobalt-web-ui`, MIT licensed). An independent deployment of this template also runs at `downloader.dxtl.com.tr`, maintained privately — that deployment's own CLAUDE.md/AGENTS.md/GEMINI.md carries deployment-specific details (identity/structured-data linking, hosting, DNS) that intentionally do **not** live here, since they're specific to one deployer and not relevant to other people self-hosting this template.

This is an independent, self-hosted web UI for [imputnet/cobalt](https://github.com/imputnet/cobalt) — not affiliated with the official project.

## Layout

| Path | Purpose |
| :--- | :--- |
| `server.js` | Plain Node.js (built-in modules only, no dependencies) static server + proxy: `/api`, `/tunnel`, `/tiktok-api`, `/media-stream`, `/ad-config.json` (serves AdSense env vars to the client) |
| `html/index.html` | Main downloader UI |
| `html/privacy.html`, `terms.html` | Sample legal pages (written with Turkish KVKK in mind — adapt for your own jurisdiction before using as-is) |
| `html/style.css`, `app.js` | Design + client-side logic (mode selection, AdSense injection, mute-video/audio-bitrate options) |
| `html/favicon.svg` + `favicon-{48,96,144,192}.png` | Bundled logo/favicon |
| `html/robots.txt`, `sitemap.xml` | SEO defaults — update the domain before deploying |
| `.env.example` | AdSense config template — copy to `.env`, never commit the real `.env` |
| `docker-compose.example.yml` | Self-host example (cobalt API + this web UI) |

## Self-hosting

See `README.md` for full setup. Requires a running cobalt API instance (`ghcr.io/imputnet/cobalt`) reachable via `COBALT_API`. If you self-host publicly, also set `API_URL` on the cobalt container to your own public URL, or download/tunnel links won't resolve for visitors.

## Notes for AI assistants working in this repo

- No build step — plain Node.js + static HTML/CSS/JS, no framework, no bundler.
- `.env` and any `google*.html` (site-verification) files are gitignored — never commit real AdSense IDs, API keys, or a deployer's site-verification tokens here.
- If asked to add structured data (JSON-LD) linking the site to a specific person, brand, or `sameAs` profile set, that's deployment-specific identity information — don't hardcode one deployer's identity into this shared template. Keep any such block generic/omitted, or gate it behind a config value the deployer fills in themselves.
- Design direction: clean flat panels on a dark cobalt-blue/copper palette — avoid defaulting to a generic "glassmorphism + neon purple" AI-generated look.
