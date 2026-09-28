import {
  getDatabase,
  ref,
  get,
  onValue,
  query,
  orderByChild,
  equalTo,
  startAt,
  endAt
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { app } from "./firebase-config.js";
import {
  typeLabel,
  meaningfulCategory,
  normalizeComparable,
  normalizePosts,
  isPublicPost,
  getSortTime,
  readingMinutes,
  uniqueCategories,
  filterPosts,
  buildArchive,
  adjacentPosts,
  seriesContext,
  firstMeaningfulStanza
} from "./post-utils.js";

const db = getDatabase(app);
const page = document.body.dataset.page;
const pageType = document.body.dataset.type;
const SITE_URL = "https://hissez.com";
const SITE_IMAGE = `${SITE_URL}/assets/icons/android-chrome-512x512.png`;
const FAVORITES_KEY = "hissezFavorites";
const RECENTS_KEY = "hissezRecentPosts";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

let publishedValue = {};
let scheduledValue = {};
let currentPosts = [];
let serverOffset = 0;
let listToolsReady = false;
let listSignature = "";
let canvasPost = null;
let canvasDrawTimer = 0;
let scheduledWarningShown = false;

const listFilters = (() => {
  const params = new URLSearchParams(location.search);
  return {
    query: params.get("q") || "",
    category: params.get("category") || "",
    year: params.get("year") || "",
    month: params.get("month") || "",
    favorites: params.get("favorites") === "1"
  };
})();

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHTML(value).replaceAll("`", "&#096;");
}

function stripText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(value = "", max = 145) {
  const text = stripText(value);
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function safeISOString(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDate(value) {
  if (!value) return "Tarihsiz";
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (Number.isNaN(date.getTime())) return escapeHTML(value);
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return { day: "--", month: "Tarihsiz" };
  return {
    day: match[3],
    month: `${MONTHS[Number(match[2]) - 1].slice(0, 3)} ${match[1]}`
  };
}

function readIdList(key, max = 100) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id) => typeof id === "string" && id.length <= 100))].slice(0, max);
  } catch {
    return [];
  }
}

function writeIdList(key, ids, max = 100) {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(ids)].slice(0, max)));
    return true;
  } catch {
    showToast("Tarayıcı bu tercihi kaydedemedi.");
    return false;
  }
}

function showToast(message) {
  let toast = document.getElementById("siteToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "siteToast";
    toast.className = "site-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");
    document.body.appendChild(toast);
  }
  clearTimeout(Number(toast.dataset.timer));
  toast.textContent = message;
  toast.classList.add("is-visible");
  const timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  toast.dataset.timer = String(timer);
}

function categoryChip(post) {
  const category = meaningfulCategory(post);
  return category ? `<span>${escapeHTML(category)}</span>` : "";
}

function postExcerpt(post, max = 145) {
  return escapeHTML(truncate(post.excerpt || post.content || "", max));
}

function renderCard(post) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const date = dateParts(post.date);
  return `
    <article class="post-card">
      <div class="post-card-date"><strong>${date.day}</strong><span>${date.month}</span></div>
      <div>
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span><span>${formatDate(post.date)}</span>${categoryChip(post)}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Yazı")}</h3>
        <p>${postExcerpt(post)}</p>
      </div>
      <a class="read-more" href="${href}">Devamını Oku</a>
    </article>`;
}

function renderPoemBook(post, pageNumber = 1) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const category = meaningfulCategory(post);
  return `
    <article class="poem-book-entry">
      <div class="poem-book-left">
        <span class="poem-book-label">Şiir Defteri</span>
        <strong>${String(pageNumber).padStart(2, "0")}</strong>
        <small>${formatDate(post.date)}</small>
      </div>
      <div class="poem-book-right">
        ${category ? `<div class="post-meta"><span>${escapeHTML(category)}</span></div>` : ""}
        <h3>${escapeHTML(post.title || "Başlıksız Şiir")}</h3>
        <p>${postExcerpt(post, 230)}</p>
        <a class="read-more poem-book-read" href="${href}">Şiiri Oku</a>
      </div>
    </article>`;
}

function renderDailyTimeline(post, index = 0) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const date = dateParts(post.date);
  return `
    <article class="daily-timeline-entry ${index % 2 === 0 ? "left" : "right"}">
      <div class="daily-timeline-dot"><strong>${date.day}</strong><span>${date.month}</span></div>
      <div class="daily-timeline-card">
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span><span>${formatDate(post.date)}</span>${categoryChip(post)}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Gün Notu")}</h3>
        <p>${postExcerpt(post, 190)}</p>
        <a class="read-more daily-read" href="${href}">Gün Notunu Oku</a>
      </div>
    </article>`;
}

function renderEmpty(target, text) {
  if (target) target.innerHTML = `<div class="empty-state">${escapeHTML(text)}</div>`;
}

function buildSequenceMap(posts) {
  const map = new Map();
  posts.slice().sort((a, b) => getSortTime(a) - getSortTime(b) || String(a.id).localeCompare(String(b.id), "tr"))
    .forEach((post, index) => map.set(post.id, index + 1));
  return map;
}

function renderHome(posts) {
  const featured = document.getElementById("featuredPost");
  const latestPoems = document.getElementById("latestPoems");
  const latestDaily = document.getElementById("latestDaily");
  const featuredPost = posts.find((post) => post.featured) || posts[0];

  if (featuredPost) {
    featured.innerHTML = `
      <article class="featured-post">
        <div>
          <div class="post-meta"><span>${typeLabel(featuredPost.type)}</span><span>${formatDate(featuredPost.date)}</span>${categoryChip(featuredPost)}</div>
          <h3>${escapeHTML(featuredPost.title || "Başlıksız Yazı")}</h3>
          <p>${postExcerpt(featuredPost, 220)}</p>
        </div>
        <a class="btn btn-primary" href="yazi.html?id=${encodeURIComponent(featuredPost.id)}">Yazıyı Oku</a>
      </article>`;
  } else {
    renderEmpty(featured, "Henüz yayında yazı yok.");
  }

  const poems = posts.filter((post) => post.type === "poem").slice(0, 1);
  const daily = posts.filter((post) => post.type === "daily").slice(0, 1);
  latestPoems.innerHTML = poems.length ? poems.map(renderCard).join("") : '<div class="empty-state">Henüz yayında şiir yok.</div>';
  latestDaily.innerHTML = daily.length ? daily.map(renderCard).join("") : '<div class="empty-state">Henüz yayında gün notu yok.</div>';

  const recentSection = document.getElementById("recentPostsSection");
  const recentTarget = document.getElementById("recentPosts");
  if (recentSection && recentTarget) {
    const byId = new Map(posts.map((post) => [post.id, post]));
    const recent = readIdList(RECENTS_KEY, 5).map((id) => byId.get(id)).filter(Boolean).slice(0, 3);
    recentSection.hidden = recent.length === 0;
    recentTarget.innerHTML = recent.map(renderCard).join("");
  }

  const historySection = document.getElementById("onThisDaySection");
  const historyTarget = document.getElementById("onThisDayPost");
  if (historySection && historyTarget) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const todaySuffix = `-${parts.month}-${parts.day}`;
    const historyPosts = posts.filter((post) => String(post.date || "").endsWith(todaySuffix) && String(post.date).slice(0, 4) < parts.year).slice(0, 1);
    historySection.hidden = historyPosts.length === 0;
    historyTarget.innerHTML = historyPosts.map(renderCard).join("");
  }
}

function syncListUrl() {
  const params = new URLSearchParams();
  if (listFilters.query) params.set("q", listFilters.query);
  if (listFilters.category) params.set("category", listFilters.category);
  if (listFilters.year) params.set("year", listFilters.year);
  if (listFilters.month) params.set("month", listFilters.month);
  if (listFilters.favorites) params.set("favorites", "1");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

function initListTools(typePosts) {
  const target = document.getElementById("postTools");
  if (!target) return;

  if (!listToolsReady) {
    target.innerHTML = `
      <div class="post-tools-main">
        <label class="post-search"><span class="visually-hidden">Yazılarda ara</span><input id="postSearch" type="search" maxlength="80" autocomplete="off" placeholder="Başlık veya metinde ara…" value="${escapeAttribute(listFilters.query)}"></label>
        <label><span class="visually-hidden">Kategori seç</span><select id="categoryFilter"><option value="">Tüm kategoriler</option></select></label>
        <button class="btn btn-ghost compact-btn" type="button" data-list-action="random">${pageType === "poem" ? "Rastgele Şiir" : "Rastgele Gün Notu"}</button>
        <button class="btn btn-ghost compact-btn" type="button" data-list-action="favorites" aria-pressed="${listFilters.favorites}">♡ Favoriler</button>
      </div>
      <div class="post-tools-secondary">
        <details class="archive-menu"><summary>Yıl / Ay Arşivi</summary><div id="archiveOptions" class="archive-options"></div></details>
        <p id="filterSummary" class="filter-summary" aria-live="polite"></p>
        <button class="text-button" type="button" data-list-action="clear">Filtreleri temizle</button>
      </div>`;

    target.addEventListener("input", (event) => {
      if (event.target.id !== "postSearch") return;
      listFilters.query = event.target.value.trim();
      syncListUrl();
      renderList(currentPosts);
    });
    target.addEventListener("change", (event) => {
      if (event.target.id !== "categoryFilter") return;
      listFilters.category = event.target.value;
      syncListUrl();
      renderList(currentPosts);
    });
    target.addEventListener("click", (event) => {
      const control = event.target.closest("[data-list-action]");
      if (!control) return;
      const action = control.dataset.listAction;
      if (action === "favorites") {
        listFilters.favorites = !listFilters.favorites;
        syncListUrl();
        renderList(currentPosts);
      }
      if (action === "clear") {
        Object.assign(listFilters, { query: "", category: "", year: "", month: "", favorites: false });
        syncListUrl();
        const search = document.getElementById("postSearch");
        if (search) search.value = "";
        renderList(currentPosts);
      }
      if (action === "archive") {
        listFilters.year = control.dataset.year || "";
        listFilters.month = control.dataset.month || "";
        syncListUrl();
        renderList(currentPosts);
      }
      if (action === "random") {
        const available = filterPosts(currentPosts.filter((post) => post.type === pageType), listFilters, readIdList(FAVORITES_KEY));
        if (!available.length) return showToast("Bu filtrelerde okunacak yazı bulunamadı.");
        const selected = available[Math.floor(Math.random() * available.length)];
        location.href = `yazi.html?id=${encodeURIComponent(selected.id)}`;
      }
    });
    listToolsReady = true;
  }

  const categories = uniqueCategories(typePosts);
  const archive = buildArchive(typePosts);
  const signature = JSON.stringify({ categories, archive });
  if (signature !== listSignature) {
    const select = document.getElementById("categoryFilter");
    select.innerHTML = '<option value="">Tüm kategoriler</option>' + categories.map(({ key, label }) =>
      `<option value="${escapeAttribute(key)}">${escapeHTML(label)}</option>`).join("");
    const archiveTarget = document.getElementById("archiveOptions");
    archiveTarget.innerHTML = '<button class="archive-all" type="button" data-list-action="archive">Tümünü Göster</button>' + (archive.length ? archive.map(({ year, months }) => `
      <div class="archive-year"><strong>${year}</strong><div>${months.map(({ month, count }) =>
        `<button type="button" data-list-action="archive" data-year="${year}" data-month="${month}">${MONTHS[Number(month) - 1]} <span>${count}</span></button>`).join("")}</div></div>`).join("") : "<p>Arşiv henüz boş.</p>");
    listSignature = signature;
  }
  document.getElementById("categoryFilter").value = listFilters.category;
}

function renderList(posts) {
  const grid = document.getElementById("postsGrid");
  const typePosts = posts.filter((post) => post.type === pageType);
  initListTools(typePosts);
  const filtered = filterPosts(typePosts, listFilters, readIdList(FAVORITES_KEY));
  const favoritesButton = document.querySelector('[data-list-action="favorites"]');
  if (favoritesButton) {
    favoritesButton.setAttribute("aria-pressed", String(listFilters.favorites));
    favoritesButton.textContent = listFilters.favorites ? "♥ Favoriler" : "♡ Favoriler";
  }
  const summary = document.getElementById("filterSummary");
  if (summary) summary.textContent = `${filtered.length} yazı gösteriliyor${listFilters.year ? ` · ${listFilters.month ? MONTHS[Number(listFilters.month) - 1] + " " : ""}${listFilters.year}` : ""}`;

  if (!filtered.length) {
    grid.className = "post-grid reveal is-visible";
    grid.innerHTML = `<div class="empty-state">${listFilters.favorites ? "Henüz bu türde favorin yok." : "Bu filtrelere uygun yazı bulunamadı."}</div>`;
    return;
  }
  if (pageType === "poem") {
    const sequenceMap = buildSequenceMap(typePosts);
    grid.className = "poem-book-list reveal is-visible";
    grid.innerHTML = filtered.map((post) => renderPoemBook(post, sequenceMap.get(post.id))).join("");
    return;
  }
  grid.className = "daily-timeline-list reveal is-visible";
  grid.innerHTML = filtered.map((post, index) => renderDailyTimeline(post, index)).join("");
}

function updateDetailSEO(post) {
  const title = `${post.title || "Yazı"} | Hissez`;
  const description = truncate(post.excerpt || post.content || "Hissez yazı detay sayfası.", 155);
  const canonical = `${SITE_URL}/yazi.html?id=${encodeURIComponent(post.id)}`;
  const datePublished = /^\d{4}-\d{2}-\d{2}$/.test(post.date || "") ? post.date : undefined;
  const dateModified = safeISOString(post.updatedAt) || datePublished;
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  let canonicalLink = document.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    canonicalLink = document.createElement("link");
    canonicalLink.rel = "canonical";
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.href = canonical;

  const setMeta = (selector, attribute, value) => {
    let item = document.querySelector(selector);
    if (!item) {
      item = document.createElement("meta");
      const match = selector.match(/(name|property)="([^"]+)"/);
      if (match) item.setAttribute(match[1], match[2]);
      document.head.appendChild(item);
    }
    item.setAttribute(attribute, value);
  };
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[property="og:url"]', "content", canonical);
  setMeta('meta[property="article:published_time"]', "content", datePublished || "");
  setMeta('meta[property="article:modified_time"]', "content", dateModified || "");
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", description);

  const articleSchema = {
    "@type": "BlogPosting", "@id": `${canonical}#article`, headline: post.title || "Hissez Yazısı",
    description, datePublished, dateModified, inLanguage: "tr-TR", image: SITE_IMAGE,
    author: { "@type": "Person", "@id": `${SITE_URL}/#person`, name: "Sezin", url: `${SITE_URL}/hakkimda.html` },
    publisher: { "@type": "Person", "@id": `${SITE_URL}/#person`, name: "Sezin" },
    isPartOf: { "@id": `${SITE_URL}/#blog` }, url: canonical,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical }
  };
  const schemaElement = document.querySelector('script[type="application/ld+json"]');
  if (schemaElement) {
    try {
      const schema = JSON.parse(schemaElement.textContent);
      const graph = Array.isArray(schema["@graph"]) ? schema["@graph"].filter((item) => item?.["@type"] !== "BlogPosting") : [];
      schemaElement.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": [...graph, articleSchema] });
    } catch (error) {
      console.error("Yapısal SEO verisi güncellenemedi:", error);
    }
  }
}

function postLink(post, label) {
  if (!post) return '<span class="article-nav-empty" aria-hidden="true"></span>';
  return `<a href="yazi.html?id=${encodeURIComponent(post.id)}"><small>${label}</small><strong>${escapeHTML(post.title || "Başlıksız Yazı")}</strong></a>`;
}

function renderSeries(posts, post) {
  const context = seriesContext(posts, post);
  if (!context) return "";
  return `
    <aside class="series-card" aria-label="Yazı serisi">
      <p class="eyebrow">Yazı dizisi · ${context.index}/${context.total}</p>
      <h2>${escapeHTML(context.name)}</h2>
      <div class="series-links">${postLink(context.previous, "Önceki bölüm")}${postLink(context.next, "Sonraki bölüm")}</div>
    </aside>`;
}

function saveRecent(id) {
  const recents = readIdList(RECENTS_KEY, 5).filter((item) => item !== id);
  writeIdList(RECENTS_KEY, [id, ...recents], 5);
}

function renderDetail(posts) {
  const detail = document.getElementById("postDetail");
  detail?.classList.remove("is-poem-detail");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) return renderEmpty(detail, "Yazı bulunamadı.");
  const post = posts.find((item) => item.id === id);
  if (!post) return renderEmpty(detail, "Bu yazı yayında değil ya da kaldırılmış.");

  detail.classList.toggle("is-poem-detail", post.type === "poem");
  updateDetailSEO(post);
  saveRecent(post.id);
  const typePosts = posts.filter((item) => item.type === post.type);
  const adjacent = adjacentPosts(typePosts, post.id);
  const backUrl = post.type === "daily" ? "gun-notlari.html" : "siirler.html";
  const backText = post.type === "daily" ? "Gün Notlarına Dön" : "Şiirlere Dön";
  const favorite = readIdList(FAVORITES_KEY).includes(post.id);
  const minutes = readingMinutes(post.content);
  const showReadingTime = post.type === "daily" || minutes > 1;
  const shareUrl = `${SITE_URL}/yazi.html?id=${encodeURIComponent(post.id)}`;
  const shareText = `${post.title || "Hissez yazısı"} — Hissez`;

  detail.innerHTML = `
    <div class="post-meta"><span>${typeLabel(post.type)}</span><span>${formatDate(post.date)}</span>${categoryChip(post)}${showReadingTime ? `<span>${minutes} dk okuma</span>` : ""}</div>
    <h1>${escapeHTML(post.title || "Başlıksız Yazı")}</h1>
    ${post.excerpt ? `<p class="hero-text">${escapeHTML(post.excerpt)}</p>` : ""}
    <div class="article-utility-actions">
      <button class="btn btn-ghost compact-btn" type="button" data-detail-action="favorite" aria-pressed="${favorite}">${favorite ? "♥ Favorilerde" : "♡ Favorilere Ekle"}</button>
      <div class="share-control">
        <button class="btn btn-ghost compact-btn" type="button" data-detail-action="share">Paylaş</button>
        <div class="share-fallback" id="shareFallback" hidden>
          <a href="https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener noreferrer">X</a>
          <button type="button" data-detail-action="copy">Bağlantıyı Kopyala</button>
        </div>
      </div>
      ${post.type === "poem" ? '<button class="btn btn-ghost compact-btn" type="button" data-detail-action="canvas">Görsel Oluştur</button>' : ""}
    </div>
    <div class="article-body${post.type === "poem" ? " poem-watermarked" : ""}">
      ${post.type === "poem" ? '<span class="poem-watermark" aria-hidden="true"><span>hissez.com</span><span>hissez.com</span><span>hissez.com</span></span>' : ""}
      <span class="article-body-text">${escapeHTML(post.content || "").replaceAll("\n", "<br>")}</span>
    </div>
    ${post.authorNote ? `<aside class="author-note"><p class="eyebrow">Yazarın notu</p><p>${escapeHTML(post.authorNote).replaceAll("\n", "<br>")}</p></aside>` : ""}
    ${renderSeries(posts, post)}
    <nav class="article-neighbors" aria-label="Aynı türde önceki ve sonraki yazılar">${postLink(adjacent.previous, `← Önceki ${typeLabel(post.type)}`)}${postLink(adjacent.next, `Sonraki ${typeLabel(post.type)} →`)}</nav>
    <div class="article-actions"><a class="btn btn-primary" href="${backUrl}">${backText}</a><a class="btn btn-ghost" href="index.html">Ana Sayfa</a></div>
    ${post.type === "poem" ? renderCanvasDialog(post) : ""}`;

  canvasPost = post.type === "poem" ? post : null;
  detail.onclick = (event) => handleDetailClick(event, post);
  const dialog = document.getElementById("poemCanvasDialog");
  if (dialog) {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("input", scheduleCanvasDraw);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.className = "visually-hidden";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

async function handleDetailClick(event, post) {
  const button = event.target.closest("[data-detail-action]");
  if (!button) return;
  const action = button.dataset.detailAction;
  const canonical = `${SITE_URL}/yazi.html?id=${encodeURIComponent(post.id)}`;
  if (action === "favorite") {
    const favorites = readIdList(FAVORITES_KEY);
    const exists = favorites.includes(post.id);
    const next = exists ? favorites.filter((id) => id !== post.id) : [post.id, ...favorites];
    if (writeIdList(FAVORITES_KEY, next)) {
      button.setAttribute("aria-pressed", String(!exists));
      button.textContent = exists ? "♡ Favorilere Ekle" : "♥ Favorilerde";
      showToast(exists ? "Favorilerden çıkarıldı." : "Favorilere eklendi.");
    }
  }
  if (action === "share") {
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title || "Hissez", text: `${post.title || "Hissez yazısı"} — Hissez`, url: canonical });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    const fallback = document.getElementById("shareFallback");
    fallback.hidden = !fallback.hidden;
    if (!fallback.hidden) fallback.querySelector("a, button")?.focus();
  }
  if (action === "copy") {
    await copyText(canonical);
    document.getElementById("shareFallback").hidden = true;
    showToast("Bağlantı kopyalandı.");
  }
  if (action === "canvas") openCanvasDialog();
  if (action === "canvas-close") document.getElementById("poemCanvasDialog")?.close();
  if (action === "canvas-download") await downloadCanvas(false);
  if (action === "canvas-share") await downloadCanvas(true);
}

function renderCanvasDialog(post) {
  return `
    <dialog class="poem-canvas-dialog" id="poemCanvasDialog" aria-labelledby="poemCanvasTitle">
      <div class="dialog-head"><div><p class="eyebrow">Şiir kartı</p><h2 id="poemCanvasTitle">Görsel Oluştur</h2></div><button class="dialog-close" type="button" data-detail-action="canvas-close" aria-label="Pencereyi kapat">×</button></div>
      <div class="canvas-dialog-grid">
        <div class="canvas-controls">
          <label><span>Boyut</span><select id="canvasFormat"><option value="post">1080 × 1350 · Gönderi</option><option value="story">1080 × 1920 · Hikâye</option></select></label>
          <label><span>Görseldeki bölüm</span><textarea id="canvasExcerpt" maxlength="700" rows="9">${escapeHTML(firstMeaningfulStanza(post.content))}</textarea></label>
          <p>Metni burada düzenleyebilirsin; asıl yazı değişmez.</p>
          <div class="canvas-actions"><button class="btn btn-primary" type="button" data-detail-action="canvas-download">PNG İndir</button><button class="btn btn-ghost" type="button" data-detail-action="canvas-share">Paylaş</button></div>
        </div>
        <div class="canvas-preview"><canvas id="poemCanvas" width="1080" height="1350" role="img" aria-label="Oluşturulan şiir görseli önizlemesi">Tarayıcın tuval önizlemesini desteklemiyor.</canvas></div>
      </div>
    </dialog>`;
}

function openCanvasDialog() {
  const dialog = document.getElementById("poemCanvasDialog");
  if (!dialog) return;
  dialog.showModal();
  dialog.querySelector("select")?.focus();
  drawPoemCanvas();
}

function scheduleCanvasDraw() {
  clearTimeout(canvasDrawTimer);
  canvasDrawTimer = window.setTimeout(drawPoemCanvas, 120);
}

function wrapCanvasText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  const paragraphs = String(text || "").split(/\n/);
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
      else {
        if (line) lines.push(line);
        line = word;
      }
      if (lines.length >= maxLines) break;
    }
    if (lines.length < maxLines && line) lines.push(line);
    if (lines.length >= maxLines) break;
  }
  if (lines.length === maxLines && paragraphs.join(" ").length > lines.join(" ").length) {
    const suffix = "… devamı Hissez’de";
    while (ctx.measureText(`${lines[maxLines - 1]}${suffix}`).width > maxWidth && lines[maxLines - 1].length > 1) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1).trim();
    }
    lines[maxLines - 1] += suffix;
  }
  return lines;
}

async function drawPoemCanvas() {
  if (!canvasPost) return;
  const canvas = document.getElementById("poemCanvas");
  const format = document.getElementById("canvasFormat")?.value || "post";
  const excerpt = document.getElementById("canvasExcerpt")?.value.trim() || firstMeaningfulStanza(canvasPost.content);
  if (!canvas) return;
  canvas.width = 1080;
  canvas.height = format === "story" ? 1920 : 1350;
  try { await document.fonts?.ready; } catch { /* Sistem fontlarıyla devam et. */ }
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#fff9f4");
  gradient.addColorStop(0.55, "#fbe9ec");
  gradient.addColorStop(1, "#f4ced8");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(141, 21, 63, .08)";
  ctx.beginPath(); ctx.arc(1020, 130, 270, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(80, canvas.height - 70, 230, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#8d153f";
  ctx.font = "700 35px Inter, sans-serif";
  ctx.fillText("HİSSEZ · ŞİİR DEFTERİ", 100, 120);
  ctx.fillRect(100, 155, 100, 5);

  let titleSize = 72;
  ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`;
  while (ctx.measureText(canvasPost.title || "Başlıksız Şiir").width > 880 && titleSize > 46) {
    titleSize -= 2;
    ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`;
  }
  ctx.fillStyle = "#2a111b";
  ctx.fillText(canvasPost.title || "Başlıksız Şiir", 100, 265);

  const maxLines = format === "story" ? 18 : 11;
  const bodySize = excerpt.length > 520 ? 38 : excerpt.length > 330 ? 43 : format === "story" ? 54 : 49;
  ctx.font = `500 ${bodySize}px "Playfair Display", Georgia, serif`;
  const lines = wrapCanvasText(ctx, excerpt, 850, maxLines);
  const lineHeight = Math.round(bodySize * 1.55);
  const bodyTop = 385;
  const textHeight = Math.max(lineHeight * Math.max(lines.length - 1, 1), 360);
  const watermarkCount = Math.max(2, Math.ceil(textHeight / 250));

  ctx.save();
  ctx.globalAlpha = .145;
  ctx.fillStyle = "#8d153f";
  ctx.textAlign = "center";
  ctx.font = '700 118px "Playfair Display", Georgia, serif';
  for (let index = 0; index < watermarkCount; index += 1) {
    const progress = (index + .5) / watermarkCount;
    const x = canvas.width / 2 + (index % 2 === 0 ? -55 : 55);
    const y = bodyTop + textHeight * progress;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-.12);
    ctx.fillText("hissez.com", 0, 0);
    ctx.restore();
  }
  ctx.restore();

  lines.forEach((line, index) => {
    ctx.fillStyle = "#3b1925";
    ctx.fillText(line, 115, bodyTop + index * lineHeight);
  });

  ctx.fillStyle = "#8d153f";
  ctx.font = "700 42px \"Playfair Display\", Georgia, serif";
  ctx.fillText("Sezin", 100, canvas.height - 125);
  ctx.textAlign = "right";
  ctx.font = "600 28px Inter, sans-serif";
  ctx.fillText("hissez.com", canvas.width - 100, canvas.height - 125);
  ctx.textAlign = "left";
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Görsel oluşturulamadı.")), "image/png"));
}

function safeFileName(value) {
  return normalizeComparable(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "hissez-siir";
}

async function downloadCanvas(share) {
  const canvas = document.getElementById("poemCanvas");
  if (!canvas || !canvasPost) return;
  await drawPoemCanvas();
  try {
    const blob = await canvasBlob(canvas);
    const format = document.getElementById("canvasFormat")?.value || "post";
    const fileName = `hissez-${safeFileName(canvasPost.slug || canvasPost.title)}-${format}.png`;
    const file = new File([blob], fileName, { type: "image/png" });
    if (share && navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: canvasPost.title || "Hissez şiiri", text: "Hissez · Sezin’in kaleminden" });
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(share ? "Bu tarayıcı dosya paylaşımını desteklemedi; PNG indirildi." : "PNG indirildi.");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Görsel oluşturulamadı. Lütfen tekrar dene.");
  }
}

function renderCurrent() {
  const now = Date.now() + serverOffset;
  currentPosts = normalizePosts(publishedValue, scheduledValue).filter((post) => isPublicPost(post, now));
  if (page === "home") renderHome(currentPosts);
  if (page === "list") renderList(currentPosts);
  if (page === "detail") renderDetail(currentPosts);
}

function renderLoadError(error) {
  const message = "Yazılar alınırken bir sorun oluştu. Lütfen daha sonra tekrar dene.";
  if (page === "home") {
    renderEmpty(document.getElementById("featuredPost"), message);
    renderEmpty(document.getElementById("latestPoems"), message);
    renderEmpty(document.getElementById("latestDaily"), message);
  }
  if (page === "list") renderEmpty(document.getElementById("postsGrid"), message);
  if (page === "detail") renderEmpty(document.getElementById("postDetail"), message);
  console.error(error);
}

async function refreshScheduledPosts() {
  const serverNow = Date.now() + serverOffset;
  const currentMinute = serverNow - (serverNow % 60000);
  try {
    const dueQuery = query(ref(db, "posts"), orderByChild("publishAt"), startAt(1), endAt(currentMinute));
    const snapshot = await get(dueQuery);
    scheduledValue = snapshot.val() || {};
    renderCurrent();
  } catch (error) {
    const permissionDenied = error?.code === "PERMISSION_DENIED" || /permission denied/i.test(error?.message || "");
    if (!permissionDenied && !scheduledWarningShown) {
      scheduledWarningShown = true;
      console.warn("Zamanlanmış yazılar şu anda kontrol edilemedi:", error);
    }
  }
}

async function init() {
  try {
    const offsetSnapshot = await get(ref(db, ".info/serverTimeOffset"));
    serverOffset = Number(offsetSnapshot.val()) || 0;
  } catch {
    serverOffset = 0;
  }
  const publishedQuery = query(ref(db, "posts"), orderByChild("status"), equalTo("published"));
  onValue(publishedQuery, (snapshot) => {
    publishedValue = snapshot.val() || {};
    renderCurrent();
  }, renderLoadError);
  await refreshScheduledPosts();
  window.setInterval(refreshScheduledPosts, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshScheduledPosts();
  });
}

init();
