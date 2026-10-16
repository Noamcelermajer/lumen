# Lumen

Local, keyless website for looking up movies, series and anime — a zero-dependency Node server plus a vanilla single-page UI, served from this PC to the LAN. Published at https://github.com/Noamcelermajer/lumen (branch `main`).

## Run
`node server.js` → http://localhost:8080 (LAN address printed on start). No build step, no npm install, Node ≥ 18. `start.bat` does the same.

## Layout
- `server.js` — HTTP server; `/api/home`, `/api/catalog?type&sort&genre&page`, `/api/search?q&type`, `/api/item?id`; in-memory cache (30 min); `/img?u=` image proxy with a host allowlist.
- `public/app.js` — hash router (`#/`, `#/movie|series|anime?sort=&genre=`, `#/item/<type:id>`), home / browse / detail views, search overlay, trailer modal.
- `public/app.css` — design tokens at the top of `:root`; dark theme only.
- `public/index.html` — shell (nav, search, modal).

## Data sources
- Movies & series: **Cinemeta** (Stremio's open IMDb/TMDB metadata). Meta/search: `v3-cinemeta.strem.io`; catalogs: `cinemeta-catalogs.strem.io/{top|year|imdbRating}/catalog/{movie|series}/...` with `genre=` and `skip=` (pages of ~50). IDs are IMDb `tt…`. Series meta includes the full episode list (`videos`).
- Anime: **AniList** GraphQL (numeric IDs).
- Item ids: `movie:tt123`, `series:tt123`, `anime:123`.
- Don't use Jikan/MyAnimeList — unreachable from this network. iTunes and TVmaze were dropped (posters only / no movies).

## Conventions
- Keep it dependency-free: vanilla JS/CSS, no bundler.
- Design: dark, imagery-first; no colored type badges; single accent (star gold `--star`). Change tokens, not one-offs.
- Every source call goes through the server (cache + proxy); the browser never calls the internet directly.
- Verify UI changes in the browser: home, browse, a movie, a series (episodes), an anime, search, phone width.
- Commit and push only when asked.
