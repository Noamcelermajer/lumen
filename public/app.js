// Lumen frontend — hash-routed single page app, no framework.
const app = document.getElementById("app");
const nav = document.getElementById("nav");
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const img = (u) => (u ? `/img?u=${encodeURIComponent(u)}` : "");
const api = async (p) => {
  const r = await fetch(`/api/${p}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const TYPE = { movie: "Movie", series: "Series", anime: "Anime" };
const PLURAL = { movie: "Movies", series: "Series", anime: "Anime" };
const SORTS = [["popular", "Popular"], ["new", "New"], ["rated", "Top rated"]];
const I = {
  star: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.7l-6.1 3.4 1.4-6.8L2.2 9.6l6.9-.8z"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
  ext: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`,
  chevL: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevR: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
};

let homeData = null;
let heroTimer = null;
const scrollPos = new Map();
history.scrollRestoration = "manual";
addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 8), { passive: true });

// ---------- formatting helpers ----------
const fmtRuntime = (s) => {
  const m = parseInt(s, 10);
  if (!m) return null;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ""}`.trim() : `${m}m`;
};
const fmtDate = (d) => { try { return new Date(d + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return d; } };
const initials = (n) => (n || "?").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const imgTag = (src, cls = "", attrs = "") => (src ? `<img ${attrs} src="${img(src)}" alt="" class="${cls}" onload="this.classList.add('ok')" onerror="this.remove()">` : "");
const sep = `<span class="sep">·</span>`;
const star = (r) => (r ? `<span class="star">${I.star}${r.toFixed(1)}</span>` : "");

function metaLine(it) {
  const m = it.meta || {};
  const parts = [`<span class="type">${TYPE[it.type]}</span>`];
  if (it.years || it.year) parts.push(esc(it.years || it.year));
  if (fmtRuntime(m.runtime)) parts.push(fmtRuntime(m.runtime) + (it.type === "anime" ? " / ep" : ""));
  if (m.episodes) parts.push(`${m.episodes} episodes`);
  if (it.genres?.length) parts.push(esc(it.genres.slice(0, 3).join(", ")));
  if (it.rating) parts.push(star(it.rating));
  return `<div class="meta-row">${parts.join(sep)}</div>`;
}

// ---------- building blocks ----------
const card = (it) => `<a class="card" href="#/item/${encodeURIComponent(it.id)}" title="${esc(it.title)}">
  <div class="poster"><div class="ph">${esc(it.title)}</div>${imgTag(it.poster, "", 'loading="lazy"')}</div>
  <div class="card-title">${esc(it.title)}</div>
  <div class="card-meta">${esc(it.year || "")}${it.rating ? `${it.year ? sep : ""}${star(it.rating)}` : ""}</div>
</a>`;
const skelCards = (n) => Array.from({ length: n }, () => `<div class="card"><div class="poster skel"></div><div class="card-title skel" style="height:13px;width:72%"></div></div>`).join("");
const rail = (items) => `<div class="rail-wrap">
  <button class="rail-btn prev" aria-label="Scroll back"><span>${I.chevL}</span></button>
  <div class="rail">${items.map(card).join("")}</div>
  <button class="rail-btn next" aria-label="Scroll forward"><span>${I.chevR}</span></button>
</div>`;
const shelf = (r) => `<section class="shelf">
  <div class="wrap shelf-head"><h2>${esc(r.title)}<small>${esc(r.subtitle || "")}</small></h2><a class="more" href="#/${r.type}?sort=${r.sort === "alltime" ? "popular" : r.sort}">See all ${I.chevR}</a></div>
  ${rail(r.items)}
</section>`;
const footer = () => `<p class="footer">Metadata from <a href="https://www.imdb.com" target="_blank" rel="noopener">IMDb</a> via Cinemeta and <a href="https://anilist.co" target="_blank" rel="noopener">AniList</a> · Served locally on your network</p>`;
const fail = (e) => (app.innerHTML = `<div class="empty" style="padding-top:34vh"><strong>Couldn't load this.</strong><br>${esc(e.message)}</div>`);

function wireRails(root = app) {
  $$(".rail-wrap", root).forEach((w) => {
    const r = $(".rail", w), prev = $(".prev", w), next = $(".next", w);
    const update = () => { prev.disabled = r.scrollLeft < 8; next.disabled = r.scrollLeft + r.clientWidth >= r.scrollWidth - 8; };
    prev.onclick = () => r.scrollBy({ left: -r.clientWidth * 0.8, behavior: "smooth" });
    next.onclick = () => r.scrollBy({ left: r.clientWidth * 0.8, behavior: "smooth" });
    r.addEventListener("scroll", update, { passive: true });
    update();
  });
}
function setSegment(type) { $$("#segments a").forEach((a) => a.classList.toggle("on", a.dataset.type === type)); }

// ---------- home ----------
async function renderHome() {
  setSegment("all");
  app.innerHTML = `<div class="page"><div class="hero"><div class="skel" style="position:absolute;inset:0;border-radius:0"></div></div>
    ${[1, 2, 3].map(() => `<section class="shelf"><div class="wrap shelf-head"><h2 class="skel" style="width:220px;height:22px"></h2></div><div class="rail">${skelCards(9)}</div></section>`).join("")}</div>`;
  try { homeData ||= await api("home"); } catch (e) { return fail(e); }
  app.innerHTML = `<div class="page">${hero(homeData.hero)}${homeData.rows.map(shelf).join("")}${footer()}</div>`;
  wireRails();
  startHero(homeData.hero);
  scrollTo(0, scrollPos.get("#/") || 0);
}

function hero(items) {
  if (!items?.length) return "";
  return `<section class="hero" id="hero">
    ${items.map((it, i) => `<div class="hero-slide${i === 0 ? " on" : ""}">
      <img class="bg" src="${img(it.backdrop)}" alt="" ${i > 0 ? 'loading="lazy"' : 'fetchpriority="high"'}>
      <div class="hero-copy"><div class="wrap">
        ${it.logo ? `<img class="hero-logo" src="${img(it.logo)}" alt="" onerror="this.remove()">` : ""}
        <h1 class="hero-title">${esc(it.title)}</h1>
        ${metaLine(it)}
        <p class="hero-overview">${esc(it.overview)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="#/item/${encodeURIComponent(it.id)}">${I.info} Details</a>
          ${it.meta?.trailer ? `<button class="btn btn-glass" data-trailer="${esc(it.meta.trailer)}">${I.play} Trailer</button>` : ""}
        </div>
      </div></div>
    </div>`).join("")}
    <div class="hero-nav" role="tablist">${items.map((_, i) => `<button class="${i === 0 ? "on" : ""}" data-i="${i}" role="tab" aria-label="Slide ${i + 1}"></button>`).join("")}</div>
  </section>`;
}

function startHero(items) {
  clearInterval(heroTimer);
  const el = $("#hero");
  if (!el || items.length < 2) return;
  let i = 0;
  const slides = $$(".hero-slide", el), dots = $$(".hero-nav button", el);
  const go = (n) => {
    i = (n + items.length) % items.length;
    slides.forEach((s, k) => s.classList.toggle("on", k === i));
    dots.forEach((d, k) => d.classList.toggle("on", k === i));
  };
  const restart = () => { clearInterval(heroTimer); heroTimer = setInterval(() => go(i + 1), 10000); };
  dots.forEach((d) => (d.onclick = () => { go(+d.dataset.i); restart(); }));
  restart();
}

// ---------- browse ----------
async function renderBrowse(type, params) {
  setSegment(type);
  const state = { type, sort: SORTS.some(([k]) => k === params.get("sort")) ? params.get("sort") : "popular", genre: params.get("genre") || "", page: 1, ids: new Set() };
  app.innerHTML = `<div class="page"><div class="wrap">
    <div class="page-head"><h1>${PLURAL[type]}</h1>
      <div class="toolbar">
        <div class="seg" id="sortSeg">${SORTS.map(([k, l]) => `<button class="${k === state.sort ? "on" : ""}" data-sort="${k}">${l}</button>`).join("")}</div>
        <div class="chips" id="genreChips"></div>
      </div>
    </div>
    <div class="grid" id="grid">${skelCards(18)}</div>
    <div class="load-more" id="loadMore" hidden><button class="btn btn-glass">Load more</button></div>
  </div>${footer()}</div>`;
  const grid = $("#grid"), chips = $("#genreChips"), more = $("#loadMore");
  let token = 0;

  const syncUrl = () => {
    const q = new URLSearchParams(); if (state.sort !== "popular") q.set("sort", state.sort); if (state.genre) q.set("genre", state.genre);
    history.replaceState(null, "", `#/${type}${q.toString() ? "?" + q : ""}`);
  };
  const load = async (append) => {
    const my = ++token;
    if (!append) { state.page = 1; state.ids.clear(); grid.innerHTML = skelCards(18); more.hidden = true; }
    else more.firstElementChild.disabled = true;
    try {
      const r = await api(`catalog?type=${type}&sort=${state.sort}&genre=${encodeURIComponent(state.genre)}&page=${state.page}`);
      if (my !== token) return;
      const fresh = r.items.filter((it) => !state.ids.has(it.id) && state.ids.add(it.id));
      if (!append) grid.innerHTML = "";
      grid.insertAdjacentHTML("beforeend", fresh.map(card).join(""));
      if (!state.ids.size) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Nothing here yet.</div>`;
      more.hidden = !(r.hasMore && fresh.length);
      more.firstElementChild.disabled = false;
      if (!chips.childElementCount) {
        chips.innerHTML = [["", "All genres"], ...r.genres.map((g) => [g, g])].map(([v, l]) => `<button class="chip${v === state.genre ? " on" : ""}" data-genre="${esc(v)}">${esc(l)}</button>`).join("");
        $(".chip.on", chips)?.scrollIntoView({ block: "nearest", inline: "center" });
      }
    } catch (e) { if (my === token) grid.innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`; }
  };
  $("#sortSeg").onclick = (e) => { const b = e.target.closest("button"); if (!b || b.dataset.sort === state.sort) return; state.sort = b.dataset.sort; $$("button", e.currentTarget).forEach((x) => x.classList.toggle("on", x === b)); syncUrl(); load(false); };
  chips.onclick = (e) => { const b = e.target.closest(".chip"); if (!b || b.dataset.genre === state.genre) return; state.genre = b.dataset.genre; $$(".chip", chips).forEach((x) => x.classList.toggle("on", x === b)); syncUrl(); load(false); };
  more.onclick = () => { state.page++; load(true); };
  scrollTo(0, 0);
  load(false);
}

// ---------- detail ----------
async function renderItem(id) {
  setSegment(null);
  clearInterval(heroTimer);
  scrollTo(0, 0);
  app.innerHTML = `<div class="page detail"><div class="detail-backdrop"><div class="skel" style="position:absolute;inset:0;border-radius:0"></div></div>
    <div class="wrap"><div class="detail-head"><div class="detail-poster skel"></div><div><div class="skel" style="height:44px;width:55%;margin-bottom:14px"></div><div class="skel" style="height:16px;width:70%"></div></div></div></div></div>`;
  let it;
  try { it = await api(`item?id=${encodeURIComponent(id)}`); } catch (e) { return fail(e); }
  const m = it.meta || {};
  const facts = [
    ["Director", m.director?.join(", ")], ["Writers", m.writers?.slice(0, 3).join(", ")], ["Studio", m.studios?.join(", ")],
    ["Status", m.status], ["Released", m.released ? fmtDate(m.released) : it.years], ["Runtime", fmtRuntime(m.runtime) ? fmtRuntime(m.runtime) + (it.type === "anime" ? " per episode" : "") : null],
    ["Episodes", m.episodes], ["Season", m.season], ["Format", m.format], ["Country", m.country], ["Awards", m.awards],
    ["Popularity", m.popularity ? `${m.popularity.toLocaleString()} AniList users` : null],
  ].filter(([, v]) => v);
  const seasons = it.seasons?.filter((s) => s.episodes.length) || [];

  app.innerHTML = `<div class="page detail">
    <a class="back" href="#/" id="back">${I.chevL} Back</a>
    <div class="detail-backdrop">${imgTag(it.backdrop || it.poster, it.backdrop ? "" : "blur", 'fetchpriority="high"')}</div>
    <div class="wrap">
      <div class="detail-head">
        <div class="detail-poster">${imgTag(it.poster)}</div>
        <div>
          ${it.logo ? `<img class="detail-logo" src="${img(it.logo)}" alt="" onerror="this.remove()">` : ""}
          <h1 class="detail-title">${esc(it.title)}</h1>
          ${it.altTitle ? `<div class="detail-alt">${esc(it.altTitle)}</div>` : ""}
          ${metaLine(it)}
          <div class="detail-actions">
            ${m.trailer ? `<button class="btn btn-primary" data-trailer="${esc(m.trailer)}">${I.play} Play trailer</button>` : ""}
            ${m.site ? `<a class="btn btn-glass" href="${esc(m.site)}" target="_blank" rel="noopener">${esc(it.source)} ${I.ext}</a>` : ""}
          </div>
        </div>
      </div>
      <div class="detail-body">
        <div>
          <p class="overview clamp" id="ov">${esc(it.overview || "No synopsis available.")}</p>
          <button class="more-btn" id="ovMore" hidden>Read more</button>
          ${it.genres?.length ? `<div class="tags">${it.genres.map((g) => `<a class="tag" href="#/${it.type}?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join("")}</div>` : ""}
        </div>
        <aside class="facts">${facts.map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join("")}</aside>
      </div>
      ${seasons.length ? `<section class="section"><div class="section-head"><h2>Episodes</h2>
        <div class="chips" id="seasonChips">${seasons.map((s, i) => `<button class="chip chip-sm${i === 0 ? " on" : ""}" data-s="${i}">${esc(s.label)}</button>`).join("")}</div></div>
        <div class="episodes" id="epList"></div></section>` : ""}
      ${m.cast?.length ? `<section class="section"><h2>${it.type === "anime" ? "Characters" : "Cast"}</h2><div class="people">${m.cast.map((c) => `<div class="person">
        <div class="avatar">${esc(initials(c.name))}${c.photo ? imgTag(c.photo, "", 'loading="lazy"') : ""}</div>
        <div class="n">${esc(c.name)}</div>${c.role ? `<div class="r">${esc(c.role)}</div>` : ""}</div>`).join("")}</div></section>` : ""}
    </div>
    ${it.related?.length ? `<section class="shelf"><div class="wrap shelf-head"><h2>More like this</h2></div>${rail(it.related)}</section>` : ""}
    ${footer()}
  </div>`;
  wireRails();

  // Back: real history when we have it, otherwise home.
  $("#back").onclick = (e) => { if (history.length > 1 && navCount > 0) { e.preventDefault(); history.back(); } };
  // Overview clamp toggle, only when it actually overflows.
  const ov = $("#ov"), more = $("#ovMore");
  if (ov.scrollHeight > ov.clientHeight + 2) { more.hidden = false; more.onclick = () => { ov.classList.toggle("clamp"); more.textContent = ov.classList.contains("clamp") ? "Read more" : "Show less"; }; }
  // Episodes by season.
  if (seasons.length) {
    const list = $("#epList"), chips = $("#seasonChips");
    const draw = (i) => (list.innerHTML = seasons[i].episodes.map((ep) => `<div class="ep">
      <div class="ep-thumb">${imgTag(ep.thumb, "", 'loading="lazy"')}</div>
      <div><div class="ep-title"><span class="num">${ep.n}</span><span>${esc(ep.title)}</span></div>
        <div class="ep-meta">${[ep.aired && fmtDate(ep.aired), ep.rating && `★ ${ep.rating.toFixed(1)}`].filter(Boolean).join("  ·  ")}</div>
        ${ep.overview ? `<div class="ep-ov">${esc(ep.overview)}</div>` : ""}</div></div>`).join(""));
    chips.onclick = (e) => { const b = e.target.closest(".chip"); if (!b) return; $$(".chip", chips).forEach((c) => c.classList.toggle("on", c === b)); draw(+b.dataset.s); };
    draw(0);
  }
}

// ---------- trailer modal ----------
const modal = $("#modal"), modalBody = $("#modalBody");
function openTrailer(ytId) {
  modalBody.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ytId)}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="Trailer"></iframe>`;
  modal.hidden = false; document.body.style.overflow = "hidden";
}
function closeModal() { modal.hidden = true; modalBody.innerHTML = ""; document.body.style.overflow = ""; }
modal.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-trailer]"); if (b) { e.preventDefault(); openTrailer(b.dataset.trailer); } });

// ---------- search ----------
const search = $("#search"), input = $("#searchInput"), results = $("#searchResults"), filters = $("#searchFilters");
let sType = "all", sel = -1, lastQ = "", debounce, searchToken = 0;
function openSearch() { search.hidden = false; document.body.style.overflow = "hidden"; input.focus(); input.select(); if (!results.innerHTML) runSearch(true); }
function closeSearch() { search.hidden = true; document.body.style.overflow = ""; }
$("#searchBtn").onclick = openSearch;
search.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSearch(); });
filters.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; sType = b.dataset.type; $$("button", filters).forEach((x) => x.classList.toggle("on", x === b)); runSearch(true); };
input.oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => runSearch(), 250); };
input.onkeydown = (e) => {
  const items = $$(".result", results);
  if (e.key === "ArrowDown") { sel = Math.min(sel + 1, items.length - 1); mark(items); e.preventDefault(); }
  else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); mark(items); e.preventDefault(); }
  else if (e.key === "Enter" && items.length) { items[Math.max(sel, 0)].click(); }
};
function mark(items) { items.forEach((x, k) => x.classList.toggle("sel", k === sel)); items[sel]?.scrollIntoView({ block: "nearest" }); }
async function runSearch(force) {
  const q = input.value.trim();
  if (!q) { lastQ = ""; results.innerHTML = `<div class="empty">Search across movies, series and anime.<br>Try <strong>Dune</strong>, <strong>Severance</strong> or <strong>Frieren</strong>.</div>`; return; }
  if (q === lastQ && !force) return;
  lastQ = q; sel = -1;
  const my = ++searchToken;
  results.innerHTML = `<div class="empty">Searching…</div>`;
  try {
    const { results: r } = await api(`search?q=${encodeURIComponent(q)}&type=${sType}`);
    if (my !== searchToken) return;
    results.innerHTML = r.length
      ? r.map((it) => `<a class="result" href="#/item/${encodeURIComponent(it.id)}">
          <div class="r-poster">${imgTag(it.poster, "", 'loading="lazy"')}</div>
          <div><div class="r-title">${esc(it.title)}</div><div class="r-meta">${[TYPE[it.type], esc(it.years || it.year), it.genres?.slice(0, 2).map(esc).join(", "), it.rating ? star(it.rating) : null].filter(Boolean).join(sep)}</div></div>
          ${I.chevR}</a>`).join("")
      : `<div class="empty">No results for <strong>${esc(q)}</strong>.</div>`;
  } catch (e) { if (my === searchToken) results.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
results.addEventListener("click", (e) => { if (e.target.closest(".result")) closeSearch(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (!modal.hidden) closeModal(); else if (!search.hidden) closeSearch(); return; }
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
  if ((e.key === "/" || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) && search.hidden && !typing) { e.preventDefault(); openSearch(); }
});

// ---------- router ----------
let navCount = 0, currentHash = location.hash || "#/";
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [pathPart, query = ""] = h.split("?");
  const params = new URLSearchParams(query);
  if (pathPart.startsWith("item/")) return renderItem(decodeURIComponent(pathPart.slice(5)));
  if (pathPart in PLURAL) return renderBrowse(pathPart, params);
  renderHome();
}
addEventListener("hashchange", () => {
  scrollPos.set(currentHash, scrollY);
  currentHash = location.hash || "#/";
  navCount++;
  if (!search.hidden) closeSearch();
  if (!modal.hidden) closeModal();
  route();
});
route();
