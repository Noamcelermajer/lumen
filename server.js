// Lumen — local media lookup server (movies, series, anime).
// Zero dependencies: Node 18+ (built-in http + fetch).
//
//   node server.js             -> http://0.0.0.0:8080 (reachable on your LAN)
//   PORT=3000 node server.js   -> custom port
//
// Sources (no API keys): Cinemeta — Stremio's open metadata service, built on
// IMDb/TMDB data — for movies & series; AniList for anime. Everything is proxied
// and cached here, so devices on the LAN only ever talk to this server.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, "public");

// ---------- cache + http helpers ----------
const cache = new Map();
const TTL = 30 * 60 * 1000;
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + TTL });
  return val;
}
async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Lumen/1.0", Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}
const strip = (s) => String(s || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const uniq = (items) => { const seen = new Set(); return items.filter((i) => i && !seen.has(i.id) && seen.add(i.id)); };
const interleave = (items) => {
  const by = {}; for (const i of items) (by[i.type] ||= []).push(i);
  const lists = Object.values(by), out = [];
  for (let k = 0; lists.some((l) => l.length > k); k++) for (const l of lists) if (l[k]) out.push(l[k]);
  return out;
};

// ---------- Cinemeta (movies + series) ----------
const CINEMETA = "https://v3-cinemeta.strem.io";
const CATALOGS = "https://cinemeta-catalogs.strem.io";
const CM_SORT = { popular: "top", new: "year", rated: "imdbRating" };
const CM_GENRES = ["Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western"];
const PAGE = 50;

function catalogUrl(type, sort, { genre, skip } = {}) {
  const cat = CM_SORT[sort] || "top";
  const extra = [genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${skip}`].filter(Boolean).join("&");
  return `${CATALOGS}/${cat}/catalog/${type}/${cat}${extra ? "/" + extra : ""}.json`;
}
// Upgrade the small poster variants Cinemeta hands out in lists.
const hiResPoster = (u) => (u ? u.replace("/poster/small/", "/poster/medium/").replace(/\._V1_SX\d+\.jpg$/, "._V1_SX600.jpg") : null);
const hiResBackdrop = (u) => (u ? u.replace("/background/medium/", "/background/large/") : null);

// Common card shape used by every source:
// { id, type, title, altTitle?, year, years, poster, backdrop, logo, rating, genres, overview, meta{}, source }
function fromCinemeta(m) {
  const type = m.type === "series" ? "series" : "movie";
  const years = String(m.releaseInfo || m.year || "").replace(/-$/, "–");
  const rating = Number(m.imdbRating);
  return {
    id: `${type}:${m.id}`,
    type,
    title: m.name,
    year: years.slice(0, 4),
    years,
    poster: hiResPoster(m.poster),
    backdrop: hiResBackdrop(m.background),
    logo: m.logo || null,
    rating: rating > 0 ? rating : null,
    genres: m.genres || m.genre || [],
    overview: strip(m.description),
    meta: {
      runtime: m.runtime || null,
      status: m.status || null,
      director: (m.director || []).filter(Boolean),
      writers: (m.writer || []).filter(Boolean),
      cast: (m.cast || []).filter(Boolean).map((name) => ({ name })),
      country: m.country || null,
      awards: m.awards || null,
      released: m.released ? m.released.slice(0, 10) : null,
      imdb: m.imdb_id || m.id,
      trailer: m.trailerStreams?.[0]?.ytId || m.trailers?.[0]?.source || null,
      site: `https://www.imdb.com/title/${m.imdb_id || m.id}/`,
    },
    source: "IMDb",
  };
}

// Group a series' episode list by season (specials last).
function seasonsFrom(videos = []) {
  const by = new Map();
  for (const v of videos) {
    if (typeof v.season !== "number" || typeof v.number !== "number") continue;
    if (!by.has(v.season)) by.set(v.season, []);
    const r = Number(v.rating);
    by.get(v.season).push({
      n: v.number,
      title: v.name || v.title || `Episode ${v.number}`,
      aired: (v.firstAired || v.released || "").slice(0, 10) || null,
      overview: strip(v.overview || v.description),
      thumb: v.thumbnail || null,
      rating: r > 0 ? r : null,
    });
  }
  const seasons = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, eps]) => ({ n, label: n === 0 ? "Specials" : `Season ${n}`, episodes: eps.sort((a, b) => a.n - b.n).slice(0, 150) }))
    .slice(0, 60);
  return seasons.filter((s) => s.n !== 0).concat(seasons.filter((s) => s.n === 0));
}

async function cmCatalog(type, sort, { genre, page = 1 } = {}) {
  const d = await getJSON(catalogUrl(type, sort, { genre, skip: (page - 1) * PAGE }));
  const items = uniq((d.metas || []).map(fromCinemeta));
  return { items, hasMore: items.length >= PAGE - 10 };
}

// ---------- AniList (anime) ----------
const ANI_FIELDS = `id title { romaji english native } description(asHtml:false) averageScore genres format status episodes duration season seasonYear
  startDate { year } endDate { year } coverImage { extraLarge large } bannerImage siteUrl popularity studios(isMain:true) { nodes { name } } trailer { id site }`;
const ANI_SORT = { popular: "TRENDING_DESC", new: "POPULARITY_DESC", rated: "SCORE_DESC", alltime: "POPULARITY_DESC" };
const ANI_GENRES = ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mecha", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];

async function anilist(query, variables = {}) {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Lumen/1.0" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`${res.status} from AniList`);
  const j = await res.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}
const title = (s) => (s ? s[0] + s.slice(1).toLowerCase() : s);

function fromAniList(a) {
  const t = a.title || {};
  const start = a.seasonYear || a.startDate?.year, end = a.endDate?.year;
  return {
    id: `anime:${a.id}`,
    type: "anime",
    title: t.english || t.romaji,
    altTitle: t.english && t.romaji !== t.english ? t.romaji : t.native,
    year: start ? String(start) : "",
    years: start ? (end && end !== start ? `${start}–${end}` : a.status === "RELEASING" ? `${start}–` : String(start)) : "",
    poster: a.coverImage?.extraLarge || a.coverImage?.large || null,
    backdrop: a.bannerImage || null,
    logo: null,
    rating: a.averageScore ? Number((a.averageScore / 10).toFixed(1)) : null,
    genres: a.genres || [],
    overview: strip(a.description),
    meta: {
      status: a.status ? title(a.status.replace(/_/g, " ")) : null,
      episodes: a.episodes,
      format: a.format ? a.format.replace("_", " ") : null,
      runtime: a.duration ? `${a.duration} min` : null,
      season: a.season ? `${title(a.season)} ${a.seasonYear || ""}`.trim() : null,
      studios: (a.studios?.nodes || []).map((s) => s.name),
      popularity: a.popularity,
      trailer: a.trailer?.site === "youtube" ? a.trailer.id : null,
      site: a.siteUrl,
    },
    source: "AniList",
  };
}

async function aniCatalog(sort, { genre, page = 1, perPage = 30 } = {}) {
  const d = await anilist(
    `query($page:Int,$per:Int,$genre:String,$status:MediaStatus){ Page(page:$page, perPage:$per){ pageInfo { hasNextPage }
      media(type:ANIME, sort:${ANI_SORT[sort] || "TRENDING_DESC"}, genre:$genre, status:$status, isAdult:false){ ${ANI_FIELDS} } } }`,
    { page, per: perPage, genre: genre || undefined, status: sort === "new" ? "RELEASING" : undefined }
  );
  return { items: uniq(d.Page.media.map(fromAniList)), hasMore: d.Page.pageInfo.hasNextPage };
}

const fetchCatalog = (type, sort, opts) => (type === "anime" ? aniCatalog(sort, opts) : cmCatalog(type, sort, opts));

// ---------- API ----------
const HOME_ROWS = [
  { title: "Popular Movies", subtitle: "What people are watching", type: "movie", sort: "popular" },
  { title: "Popular Series", subtitle: "Binge-worthy right now", type: "series", sort: "popular" },
  { title: "Trending Anime", subtitle: "Hot on AniList this week", type: "anime", sort: "popular" },
  { title: "New Movies", subtitle: "Recent releases", type: "movie", sort: "new" },
  { title: "Top Rated Movies", subtitle: "Highest IMDb ratings", type: "movie", sort: "rated" },
  { title: "New Series", subtitle: "Fresh premieres and seasons", type: "series", sort: "new" },
  { title: "All-Time Anime", subtitle: "Most popular on AniList", type: "anime", sort: "alltime" },
];

const api = {
  // GET /api/home -> { hero: [...], rows: [{ title, subtitle, type, sort, items }] }
  async home() {
    return cached("home", async () => {
      const settled = await Promise.allSettled(HOME_ROWS.map((r) => fetchCatalog(r.type, r.sort).then((x) => x.items)));
      settled.forEach((s, i) => s.status === "rejected" && console.warn(`home row "${HOME_ROWS[i].title}" failed:`, s.reason.message));
      const rows = HOME_ROWS.map((r, i) => ({ ...r, items: settled[i].status === "fulfilled" ? settled[i].value.slice(0, 24) : [] })).filter((r) => r.items.length);
      if (!rows.length) throw new Error("all data sources unreachable");
      const hero = uniq(rows.slice(0, 3).flatMap((r) => {
        const ok = r.items.filter((i) => i.backdrop && i.overview);
        const withLogo = ok.filter((i) => i.logo);
        return (withLogo.length >= 2 ? withLogo : ok).slice(0, 2);
      }));
      return { hero, rows };
    });
  },

  // GET /api/catalog?type=movie|series|anime&sort=popular|new|rated&genre=&page=
  async catalog({ type = "movie", sort = "popular", genre = "", page = "1" }) {
    if (!["movie", "series", "anime"].includes(type)) throw new Error("bad type");
    const p = Math.max(1, Number(page) || 1);
    return cached(`catalog:${type}:${sort}:${genre}:${p}`, async () => {
      const r = await fetchCatalog(type, sort, { genre, page: p });
      return { ...r, genres: type === "anime" ? ANI_GENRES : CM_GENRES };
    });
  },

  // GET /api/search?q=&type=all|movie|series|anime
  async search({ q = "", type = "all" }) {
    q = q.trim();
    if (!q) return { results: [] };
    return cached(`search:${type}:${q.toLowerCase()}`, async () => {
      const want = (t) => type === "all" || type === t;
      const jobs = [];
      if (want("movie")) jobs.push(getJSON(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}.json`).then((d) => (d.metas || []).map(fromCinemeta)));
      if (want("series")) jobs.push(getJSON(`${CINEMETA}/catalog/series/top/search=${encodeURIComponent(q)}.json`).then((d) => (d.metas || []).map(fromCinemeta)));
      if (want("anime")) jobs.push(anilist(`query($q:String){ Page(perPage:12){ media(type:ANIME, search:$q, isAdult:false){ ${ANI_FIELDS} } } }`, { q }).then((d) => d.Page.media.map(fromAniList)));
      const settled = await Promise.allSettled(jobs);
      const results = settled.flatMap((s) => (s.status === "fulfilled" ? uniq(s.value).slice(0, 12) : []));
      return { results: interleave(results) };
    });
  },

  // GET /api/item?id=movie:tt123 | series:tt123 | anime:123
  async item({ id = "" }) {
    const [type, raw] = id.split(":");
    if (!["movie", "series", "anime"].includes(type) || !raw) throw new Error("bad id");
    return cached(`item:${id}`, async () => {
      if (type === "anime") {
        const d = await anilist(
          `query($id:Int){ Media(id:$id, type:ANIME){ ${ANI_FIELDS}
            characters(sort:ROLE, perPage:14){ edges { role node { name { full } image { medium } } voiceActors(language:JAPANESE, sort:RELEVANCE){ name { full } } } }
            recommendations(sort:RATING_DESC, perPage:16){ nodes { mediaRecommendation { ${ANI_FIELDS} } } } } }`,
          { id: Number(raw) }
        );
        const it = fromAniList(d.Media);
        it.meta.cast = (d.Media.characters?.edges || []).map((e) => ({ name: e.node.name.full, role: e.voiceActors?.[0]?.name?.full || title(e.role), photo: e.node.image?.medium || null }));
        it.related = uniq((d.Media.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean).map(fromAniList));
        return it;
      }
      const d = await getJSON(`${CINEMETA}/meta/${type}/${encodeURIComponent(raw)}.json`);
      if (!d.meta) throw new Error("not found");
      const it = fromCinemeta(d.meta);
      if (type === "series") it.seasons = seasonsFrom(d.meta.videos);
      // Cinemeta has no recommendations: use the popular catalog of the title's first genre.
      const g = it.genres[0];
      it.related = g
        ? await cmCatalog(type, "popular", { genre: g }).then((r) => r.items.filter((x) => x.id !== it.id).slice(0, 16)).catch(() => [])
        : [];
      return it;
    });
  },
};

// ---------- image proxy (same-origin for every device, hotlink-safe) ----------
const ALLOWED_IMG = /^https:\/\/(images\.metahub\.space|episodes\.metahub\.space|m\.media-amazon\.com|s4\.anilist\.co|img\.anili\.st)\//;
async function proxyImage(url, res) {
  if (!ALLOWED_IMG.test(url)) { res.writeHead(400); return res.end(); }
  const get = (u) => fetch(u, { headers: { "User-Agent": "Lumen/1.0" } });
  try {
    let up = await get(url);
    // Fall back from the upgraded variants if the larger one doesn't exist.
    if (!up.ok && url.includes("/background/large/")) up = await get(url.replace("/background/large/", "/background/medium/"));
    if (!up.ok && url.includes("/poster/medium/")) up = await get(url.replace("/poster/medium/", "/poster/small/"));
    if (!up.ok && /_SX600\.jpg$/.test(url)) up = await get(url.replace("_SX600.jpg", "_SX250.jpg"));
    if (!up.ok) { res.writeHead(up.status); return res.end(); }
    res.writeHead(200, { "Content-Type": up.headers.get("content-type") || "image/jpeg", "Cache-Control": "public, max-age=604800, immutable" });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch { res.writeHead(502); res.end(); }
}

// ---------- static files + routing ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const params = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === "/img") return proxyImage(params.u || "", res);
    if (u.pathname.startsWith("/api/")) {
      const fn = api[u.pathname.slice(5)];
      if (!fn) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"error":"not found"}'); }
      const data = await fn(params);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(data));
    }
    let file = path.normalize(path.join(PUBLIC, u.pathname === "/" ? "index.html" : u.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, "index.html");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log("\n  Lumen is running\n");
  console.log(`  Local:    http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Network:  http://${ip}:${PORT}`);
  console.log();
});
