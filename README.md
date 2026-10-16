# Lumen

A local website for looking up **movies, series and anime**, served from this PC to every device on your network. No build step, no dependencies, no API keys — just Node.js.

## Run

Double-click `start.bat`, or:

```bash
node server.js
```

Then open:

- On this PC: http://localhost:8080
- On any phone / tablet / laptop on the same Wi-Fi: **http://\<this PC's IP\>:8080** — the exact address is printed when the server starts

If other devices can't reach it, allow the port through Windows Firewall once (administrator prompt):

```bash
netsh advfirewall firewall add rule name="Lumen" dir=in action=allow protocol=TCP localport=8080
```

## What it does

- **Home** — a hero carousel with title logos and backdrops, then rows: popular movies, popular series, trending anime, new releases, top rated, all-time anime. Each row has a "See all".
- **Browse** (Movies / Series / Anime) — sort by Popular, New or Top rated, filter by genre, load more.
- **Search** — the search button, `/` or `Ctrl/Cmd+K`. Queries all three sources at once; filter chips narrow by type; arrow keys and Enter navigate.
- **Detail pages** — backdrop and logo, synopsis, IMDb / AniList rating, director, writers, cast, awards, runtime, country; trailer in a lightbox; genre tags that jump to a filtered browse page; "More like this".
- **Series** show every season with episode thumbnails, titles, air dates and summaries.
- **Anime** show characters with their Japanese voice actors, studio, season and format.
- Dark, imagery-first design; works on phones; can be added to an iPhone home screen as a full-screen app.

## Data sources

| Type            | Source |
|-----------------|--------|
| Movies & series | [Cinemeta](https://v3-cinemeta.strem.io) — Stremio's open metadata service, built on IMDb / TMDB data (posters, backdrops, logos, ratings, cast, episodes, trailers) |
| Anime           | [AniList](https://anilist.co) (GraphQL) |

All requests go through the local server (responses cached for 30 minutes, images proxied), so devices on the network never talk to the internet directly.

## Options

- `PORT=3000 node server.js` — change the port.
- Design tokens live at the top of `public/app.css` (colours, radii, column width, card size).

## Files

```
server.js                  HTTP server, API, cache, image proxy
public/index.html          Shell (nav, search overlay, trailer modal)
public/app.js              Router and the home / browse / detail / search views
public/app.css             Design system and styling
public/manifest.webmanifest  Home-screen install metadata
public/icon.svg            App icon
start.bat                  Double-click launcher
```
