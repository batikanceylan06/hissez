import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { app } from "./firebase-config.js";
import {
  typeLabel,
  meaningfulCategory,
  normalizeComparable,
  normalizePosts,
  isPublicPost,
  storedPostSlug,
  postMatchesSlug,
  cleanPostPath,
  slugifyTitle,
  uniqueTitleSlug,
  getSortTime,
  readingMinutes,
  uniqueCategories,
  categoryCounts,
  filterPosts,
  buildArchive,
  adjacentPosts,
  seriesContext,
  relatedPosts,
  firstMeaningfulStanza
} from "./post-utils.js";

const firestore = getFirestore(app);
const postsCollection = collection(firestore, "posts");
const postScheduleCollection = collection(firestore, "postSchedule");
const page = document.body.dataset.page;
const pageType = document.body.dataset.type;
const SITE_URL = "https://hissez.com";
const SITE_IMAGE = `${SITE_URL}/assets/icons/android-chrome-512x512.png`;
const FAVORITES_KEY = "hissezFavorites";
const RECENTS_KEY = "hissezRecentPosts";
const PUBLIC_POSTS_CACHE_KEY = "hissezPublicPostsV3";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const CANVAS_FORMATS = Object.freeze({
  post: { width: 1080, height: 1350, maxLines: 11 },
  story: { width: 1080, height: 1920, maxLines: 18 }
});
const CANVAS_WATERMARK = Object.freeze({ opacity: .075, fontSize: 150 });

let publishedValue = {};
let scheduledValue = {};
let currentPosts = [];
let listToolsReady = false;
let listSignature = "";
let canvasPost = null;
let canvasDrawTimer = 0;
let canvasPreviewPage = 0;
let scheduledWarningShown = false;
let globalSearchReady = false;
let readingProgressCleanup = null;
let scheduledIndex = [];
let scheduledRefreshVersion = 0;
let detailLookupStatus = page === "detail" ? "loading" : "idle";
let listSearchTimer = 0;

const listFilters = (() => {
  const params = new URLSearchParams(location.search);
  return {
    query: params.get("q") || "",
    category: params.get("category") || "",
    year: params.get("year") || "",
    month: params.get("month") || "",
    type: params.get("type") || "",
    sort: params.get("sort") || "newest",
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

function poemCanvasExcerpt(post, max = 5000) {
  const content = String(post?.content || "").replaceAll("\r", "").trim();
  if (!content) return firstMeaningfulStanza(post?.content);
  if (content.length <= max) return content;
  return content.slice(0, max).replace(/\s+\S*$/, "").trim();
}

function truncate(value = "", max = 145) {
  const text = stripText(value);
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function cleanPostUrl(post) {
  const cleanPath = publicPostPath(post);
  return cleanPath
    ? `${SITE_URL}${cleanPath}`
    : `${SITE_URL}/yazi.html?id=${encodeURIComponent(post?.id || "")}`;
}

function postHref(post) {
  return publicPostPath(post) || `/yazi.html?id=${encodeURIComponent(post?.id || "")}`;
}

function publicSlugSource(post) {
  const title = String(post?.title || "").trim();
  if (post?.type !== "poem" || slugifyTitle(title) !== "his") return title;
  const firstLine = String(post?.content || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const slugLine = firstLine.replace(/^her\s+şey\b/iu, "Hersey");
  return slugLine && slugifyTitle(slugLine) !== "his" ? `${title} ${slugLine}` : title;
}

function publicTitleSlugMap(posts = currentPosts) {
  const used = [];
  const output = new Map();
  posts.slice().sort((left, right) => {
    const time = getSortTime(left) - getSortTime(right);
    return time || String(left.id).localeCompare(String(right.id), "tr");
  }).forEach((post) => {
    const slugSource = publicSlugSource(post);
    const base = slugifyTitle(slugSource) || "yazi";
    const stored = storedPostSlug(post);
    const alreadyTitleBased = stored === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-[2-9][0-9]*$`).test(stored);
    const slug = alreadyTitleBased && !used.includes(stored) ? stored : uniqueTitleSlug(slugSource, used);
    used.push(slug);
    output.set(post.id, slug);
  });
  return output;
}

function publicPostPath(post, posts = currentPosts) {
  const section = post?.type === "poem" ? "siir" : post?.type === "daily" ? "gun-notu" : "";
  const slug = publicTitleSlugMap(posts).get(post?.id) || slugifyTitle(publicSlugSource(post));
  return section && slug ? `/${section}/${encodeURIComponent(slug)}` : cleanPostPath(post);
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

function readPublicPostsCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(PUBLIC_POSTS_CACHE_KEY) || "null");
    if (!cached || typeof cached.posts !== "object" || Array.isArray(cached.posts)) return {};
    return cached.posts;
  } catch {
    return {};
  }
}

function writePublicPostsCache(posts) {
  try {
    localStorage.setItem(PUBLIC_POSTS_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), posts }));
  } catch {
    // Public içerik cache'i isteğe bağlıdır; depolama kapalıysa canlı veri kullanılmaya devam eder.
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

function postFirstLine(post, max = 130) {
  const source = String(post.content || post.excerpt || "");
  const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return escapeHTML(truncate(firstLine, max));
}

function featuredContentPreview(post, max = 520) {
  const content = String(post.content || post.excerpt || "").replaceAll("\r", "").trim();
  if (content.length <= max) return escapeHTML(content);
  const clipped = content.slice(0, max).replace(/[^\s]*$/, "").trimEnd();
  return escapeHTML(`${clipped || content.slice(0, max).trimEnd()}…`);
}

function renderCard(post) {
  const href = postHref(post);
  const minutes = readingMinutes(post.content);
  return `
    <article class="post-card blog-card">
      <div>
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span>${categoryChip(post)}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Yazı")}</h3>
        <p>${postExcerpt(post)}</p>
      </div>
      <div class="post-card-footer"><span>${formatDate(post.date)} · ${minutes} dk okuma</span><a class="read-more" href="${href}">Oku →</a></div>
    </article>`;
}

function renderCompactCard(post) {
  return `
    <article class="post-card blog-card compact-blog-card">
      <h3>${escapeHTML(post.title || "Başlıksız Yazı")}</h3>
      <p>${postFirstLine(post)}</p>
      <a class="read-more" href="${postHref(post)}">Oku →</a>
    </article>`;
}

function renderPoemBook(post, pageNumber = 1) {
  const href = postHref(post);
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
  const href = postHref(post);
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
  if (target) target.innerHTML = `<div class="empty-state"><span class="empty-state-mark" aria-hidden="true">✦</span><strong>Burada henüz bir satır yok.</strong><p>${escapeHTML(text)}</p></div>`;
}

function renderSkeleton(target, count = 3) {
  if (!target) return;
  target.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`).join("");
  target.setAttribute("aria-busy", "true");
}

function renderLoadingSkeletons() {
  if (page === "home") {
    renderSkeleton(document.getElementById("featuredPost"), 1);
    renderSkeleton(document.getElementById("latestPosts"), 3);
    renderSkeleton(document.getElementById("categoryDiscovery"), 4);
  }
  if (page === "list" || page === "archive") renderSkeleton(document.getElementById("postsGrid"), 4);
  if (page === "detail") renderSkeleton(document.getElementById("postDetail"), 1);
}

function buildSequenceMap(posts) {
  const map = new Map();
  posts.slice().sort((a, b) => getSortTime(a) - getSortTime(b) || String(a.id).localeCompare(String(b.id), "tr"))
    .forEach((post, index) => map.set(post.id, index + 1));
  return map;
}

function renderHome(posts) {
  const featured = document.getElementById("featuredPost");
  const latestPosts = document.getElementById("latestPosts");
  const categoryTarget = document.getElementById("categoryDiscovery");
  const featuredPost = posts.find((post) => post.featured);

  if (featured && featuredPost) {
    featured.closest("section")?.removeAttribute("hidden");
    featured.innerHTML = `
      <article class="featured-post">
        <div class="featured-post-copy">
          <p class="eyebrow">Editörün seçimi</p>
          <div class="post-meta"><span>${typeLabel(featuredPost.type)}</span>${categoryChip(featuredPost)}</div>
          <h3>${escapeHTML(featuredPost.title || "Başlıksız Yazı")}</h3>
          <p class="featured-reading-meta">${formatDate(featuredPost.date)} · ${readingMinutes(featuredPost.content)} dk okuma</p>
        </div>
        <div class="featured-post-reading">
          <p class="featured-poem-text">${featuredContentPreview(featuredPost)}</p>
          <a class="btn btn-primary" href="${postHref(featuredPost)}">Okumaya Devam Et</a>
        </div>
      </article>`;
  } else if (featured) {
    featured.closest("section")?.setAttribute("hidden", "");
  }

  if (latestPosts) {
    latestPosts.innerHTML = posts.length
      ? posts.slice(0, 6).map(renderCompactCard).join("")
      : '<div class="empty-state">Henüz yayında yazı yok.</div>';
  }

  if (categoryTarget) {
    const categories = categoryCounts(posts, 8);
    categoryTarget.innerHTML = categories.length ? categories.map(({ key, label, count }) => `
      <a class="category-discovery-card" href="/arsiv?category=${encodeURIComponent(key)}">
        <span>${escapeHTML(label)}</span><small>${count} yazı</small>
      </a>`).join("") : '<p class="empty-state">Kategoriler yazılarla birlikte burada görünecek.</p>';
  }

  const historySection = document.getElementById("onThisDaySection");
  const historyTarget = document.getElementById("onThisDayPost");
  if (historySection && historyTarget) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const todaySuffix = `-${parts.month}-${parts.day}`;
    const historyPosts = posts.filter((post) => String(post.date || "").endsWith(todaySuffix) && String(post.date).slice(0, 4) < parts.year).slice(0, 1);
    const historyWrapper = historySection.closest(".personal-discovery");
    historySection.hidden = historyPosts.length === 0;
    if (historyWrapper) historyWrapper.hidden = historyPosts.length === 0;
    historyTarget.innerHTML = historyPosts.map(renderCard).join("");
  }
}

function syncListUrl() {
  const params = new URLSearchParams();
  if (listFilters.query) params.set("q", listFilters.query);
  if (listFilters.category) params.set("category", listFilters.category);
  if (listFilters.year) params.set("year", listFilters.year);
  if (listFilters.month) params.set("month", listFilters.month);
  if (listFilters.type) params.set("type", listFilters.type);
  if (listFilters.sort && listFilters.sort !== "newest") params.set("sort", listFilters.sort);
  if (listFilters.favorites) params.set("favorites", "1");
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

function rerenderListing() {
  if (page === "archive") renderArchive(currentPosts);
  else renderList(currentPosts);
}

function sortListing(posts) {
  const sorted = posts.slice();
  if (listFilters.sort === "oldest") return sorted.sort((a, b) => getSortTime(a) - getSortTime(b));
  if (listFilters.sort === "title") return sorted.sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "tr"));
  return sorted.sort((a, b) => getSortTime(b) - getSortTime(a));
}

function renderActiveFilters() {
  const target = document.getElementById("activeFilters");
  if (!target) return;
  const filters = [
    ["query", listFilters.query, `Arama: ${listFilters.query}`],
    ["category", listFilters.category, `Kategori: ${listFilters.category}`],
    ["type", listFilters.type, listFilters.type === "poem" ? "Tür: Şiir" : "Tür: Gün Notu"],
    ["date", listFilters.year, `Tarih: ${listFilters.month ? `${MONTHS[Number(listFilters.month) - 1]} ` : ""}${listFilters.year}`],
    ["favorites", listFilters.favorites, "Favoriler"]
  ].filter(([, value]) => Boolean(value));
  target.innerHTML = filters.map(([key, , label]) => `<button type="button" data-list-action="remove-filter" data-filter-key="${key}">${escapeHTML(label)} <span aria-hidden="true">×</span></button>`).join("");
  target.hidden = filters.length === 0;
}

function initListTools(typePosts) {
  const target = document.getElementById("postTools");
  if (!target) return;

  if (!listToolsReady) {
    target.innerHTML = `
      <div class="post-tools-main">
        <label class="post-search"><span class="visually-hidden">Yazılarda ara</span><input id="postSearch" type="search" maxlength="80" autocomplete="off" placeholder="Başlık veya metinde ara…" value="${escapeAttribute(listFilters.query)}"></label>
        <label><span class="visually-hidden">Kategori seç</span><select id="categoryFilter"><option value="">Tüm kategoriler</option></select></label>
        ${page === "archive" ? '<label><span class="visually-hidden">Tür seç</span><select id="typeListFilter"><option value="">Tüm türler</option><option value="poem">Şiir</option><option value="daily">Gün Notu</option></select></label>' : ""}
        <label><span class="visually-hidden">Sıralama</span><select id="sortFilter"><option value="newest">En yeni</option><option value="oldest">En eski</option><option value="title">Başlığa göre</option></select></label>
        <button class="btn btn-ghost compact-btn" type="button" data-list-action="random">${page === "archive" ? "Rastgele Yazı" : pageType === "poem" ? "Rastgele Şiir" : "Rastgele Gün Notu"}</button>
        <button class="btn btn-ghost compact-btn" type="button" data-list-action="favorites" aria-pressed="${listFilters.favorites}">♡ Favoriler</button>
      </div>
      <div class="post-tools-secondary">
        <details class="archive-menu"><summary>Yıl / Ay Arşivi</summary><div id="archiveOptions" class="archive-options"></div></details>
        <p id="filterSummary" class="filter-summary" aria-live="polite"></p>
        <button class="text-button" type="button" data-list-action="clear">Filtreleri temizle</button>
      </div>
      <div class="active-filters" id="activeFilters" aria-label="Aktif filtreler" hidden></div>`;

    target.addEventListener("input", (event) => {
      if (event.target.id !== "postSearch") return;
      window.clearTimeout(listSearchTimer);
      listSearchTimer = window.setTimeout(() => {
        listFilters.query = event.target.value.trim();
        syncListUrl();
        rerenderListing();
      }, 180);
    });
    target.addEventListener("change", (event) => {
      if (event.target.id === "categoryFilter") listFilters.category = event.target.value;
      else if (event.target.id === "typeListFilter") listFilters.type = event.target.value;
      else if (event.target.id === "sortFilter") listFilters.sort = event.target.value;
      else return;
      syncListUrl();
      rerenderListing();
    });
    target.addEventListener("click", (event) => {
      const control = event.target.closest("[data-list-action]");
      if (!control) return;
      const action = control.dataset.listAction;
      if (action === "favorites") {
        listFilters.favorites = !listFilters.favorites;
        syncListUrl();
        rerenderListing();
      }
      if (action === "clear") {
        Object.assign(listFilters, { query: "", category: "", year: "", month: "", type: "", sort: "newest", favorites: false });
        syncListUrl();
        const search = document.getElementById("postSearch");
        if (search) search.value = "";
        rerenderListing();
      }
      if (action === "remove-filter") {
        const key = control.dataset.filterKey;
        if (key === "date") Object.assign(listFilters, { year: "", month: "" });
        else if (key === "favorites") listFilters.favorites = false;
        else if (key in listFilters) listFilters[key] = "";
        if (key === "query") document.getElementById("postSearch").value = "";
        syncListUrl();
        rerenderListing();
      }
      if (action === "archive") {
        listFilters.year = control.dataset.year || "";
        listFilters.month = control.dataset.month || "";
        syncListUrl();
        rerenderListing();
      }
      if (action === "random") {
        const scope = page === "archive" ? currentPosts : currentPosts.filter((post) => post.type === pageType);
        const available = filterPosts(scope, listFilters, readIdList(FAVORITES_KEY));
        if (!available.length) return showToast("Bu filtrelerde okunacak yazı bulunamadı.");
        const selected = available[Math.floor(Math.random() * available.length)];
        location.href = postHref(selected);
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
  const typeFilter = document.getElementById("typeListFilter");
  if (typeFilter) typeFilter.value = listFilters.type;
  document.getElementById("sortFilter").value = listFilters.sort;
  renderActiveFilters();
}

function renderList(posts) {
  const grid = document.getElementById("postsGrid");
  const typePosts = posts.filter((post) => post.type === pageType);
  initListTools(typePosts);
  const filtered = sortListing(filterPosts(typePosts, listFilters, readIdList(FAVORITES_KEY)));
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

function renderArchive(posts) {
  const grid = document.getElementById("postsGrid");
  if (!grid) return;
  initListTools(posts);
  renderArchiveOverview(posts);
  const filtered = sortListing(filterPosts(posts, listFilters, readIdList(FAVORITES_KEY)));
  const favoritesButton = document.querySelector('[data-list-action="favorites"]');
  if (favoritesButton) {
    favoritesButton.setAttribute("aria-pressed", String(listFilters.favorites));
    favoritesButton.textContent = listFilters.favorites ? "♥ Favoriler" : "♡ Favoriler";
  }
  const summary = document.getElementById("filterSummary");
  if (summary) summary.textContent = `${filtered.length} yazı gösteriliyor${listFilters.year ? ` · ${listFilters.month ? MONTHS[Number(listFilters.month) - 1] + " " : ""}${listFilters.year}` : ""}`;
  grid.className = "post-grid archive-post-grid reveal is-visible";
  grid.innerHTML = filtered.length
    ? filtered.map(renderCard).join("")
    : `<div class="empty-state">${listFilters.favorites ? "Henüz favorin yok." : "Bu filtrelere uygun yazı bulunamadı."}</div>`;
}

function renderArchiveOverview(posts) {
  const target = document.getElementById("archiveOverview");
  if (!target) return;
  const archive = buildArchive(posts);
  const categories = categoryCounts(posts);
  const monthGroups = archive.map(({ year, months }) => `
    <section class="archive-overview-year">
      <h3>${year}</h3>
      <div>${months.map(({ month, count }) => {
        const active = listFilters.year === year && String(listFilters.month).padStart(2, "0") === month;
        return `<a href="/arsiv?year=${year}&month=${Number(month)}"${active ? ' aria-current="true"' : ""}>${MONTHS[Number(month) - 1]} <span>${count} yazı</span></a>`;
      }).join("")}</div>
    </section>`).join("");
  const categoryLinks = categories.map(({ key, label, count }) => `
    <a href="/arsiv?category=${encodeURIComponent(key)}"${listFilters.category === key ? ' aria-current="true"' : ""}>${escapeHTML(label)} <span>${count}</span></a>`).join("");
  target.innerHTML = `
    <div class="archive-stats"><div><strong>${posts.length}</strong><span>Toplam yazı</span></div><div><strong>${posts.filter((post) => post.type === "poem").length}</strong><span>Şiir</span></div><div><strong>${posts.filter((post) => post.type === "daily").length}</strong><span>Gün notu</span></div><div><strong>${categories.length}</strong><span>Kategori</span></div></div>
    <div class="archive-overview-block"><p class="eyebrow">Yıllara göre</p><div class="archive-overview-years">${monthGroups || "<p>Arşiv henüz boş.</p>"}</div></div>
    <div class="archive-overview-block"><p class="eyebrow">Kategoriler</p><div class="archive-overview-categories">${categoryLinks || "<p>Henüz kategori yok.</p>"}</div></div>`;
}

function globalSearchMatches(queryValue) {
  const queryText = normalizeComparable(queryValue);
  if (!queryText) return [];
  return filterPosts(currentPosts, { query: queryText }).slice(0, 10);
}

function renderGlobalSearch(queryValue = "") {
  const results = document.getElementById("globalSearchResults");
  const allLink = document.getElementById("globalSearchAll");
  if (!results || !allLink) return;
  const matches = globalSearchMatches(queryValue);
  results.innerHTML = queryValue.trim()
    ? matches.length ? matches.map((post) => `
      <a class="global-search-result" href="${postHref(post)}">
        <span><small>${typeLabel(post.type)} · ${formatDate(post.date)}</small><strong>${escapeHTML(post.title || "Başlıksız Yazı")}</strong></span>
        <span aria-hidden="true">→</span>
      </a>`).join("") : '<p class="global-search-empty">Eşleşen yazı bulunamadı.</p>'
    : '<p class="global-search-empty">Şiirlerde ve gün notlarında aramak için yazmaya başla.</p>';
  allLink.href = `/arsiv${queryValue.trim() ? `?q=${encodeURIComponent(queryValue.trim())}` : ""}`;
  allLink.hidden = !queryValue.trim();
}

function initGlobalSearch() {
  if (globalSearchReady) return;
  const tools = document.querySelector(".header-tools");
  if (!tools) return;
  const button = document.createElement("button");
  button.className = "header-tool-btn global-search-toggle";
  button.type = "button";
  button.setAttribute("aria-label", "Sitede ara");
  button.setAttribute("aria-haspopup", "dialog");
  button.innerHTML = '<span aria-hidden="true">⌕</span>';
  tools.prepend(button);

  const dialog = document.createElement("dialog");
  dialog.id = "globalSearchDialog";
  dialog.className = "global-search-dialog";
  dialog.setAttribute("aria-labelledby", "globalSearchTitle");
  dialog.innerHTML = `
    <div class="global-search-panel">
      <div class="global-search-head"><div><p class="eyebrow">Hissez arşivi</p><h2 id="globalSearchTitle">Yazılarda ara</h2></div><button type="button" class="dialog-close" data-search-close aria-label="Aramayı kapat">×</button></div>
      <label class="global-search-field"><span class="visually-hidden">Arama sözcüğü</span><input id="globalSearchInput" type="search" maxlength="80" autocomplete="off" placeholder="Bir başlık, dize veya kelime…"></label>
      <div id="globalSearchResults" class="global-search-results" aria-live="polite"></div>
      <a id="globalSearchAll" class="section-link global-search-all" href="/arsiv" hidden>Tüm sonuçları arşivde gör →</a>
    </div>`;
  document.body.appendChild(dialog);
  const input = dialog.querySelector("#globalSearchInput");
  const close = () => dialog.open && dialog.close();
  button.addEventListener("click", () => {
    renderGlobalSearch(input.value);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    window.setTimeout(() => input.focus(), 0);
  });
  dialog.querySelector("[data-search-close]").addEventListener("click", close);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });
  input.addEventListener("input", () => renderGlobalSearch(input.value));
  globalSearchReady = true;
}

function updateDetailSEO(post) {
  const title = `${post.title || "Yazı"} | Hissez`;
  const description = truncate(post.excerpt || post.content || "Hissez yazı detay sayfası.", 155);
  const canonical = cleanPostUrl(post);
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
    author: { "@type": "Person", "@id": `${SITE_URL}/#person`, name: "Sezin", url: `${SITE_URL}/hakkimda` },
    publisher: { "@type": "Person", "@id": `${SITE_URL}/#person`, name: "Sezin" },
    isPartOf: { "@id": `${SITE_URL}/#blog` }, url: canonical,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical }
  };
  const breadcrumbSchema = {
    "@type": "BreadcrumbList",
    "@id": `${canonical}#breadcrumb`,
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: typeLabel(post.type), item: `${SITE_URL}/${post.type === "daily" ? "gun-notlari" : "siirler"}` },
      { "@type": "ListItem", position: 3, name: post.title || "Hissez Yazısı", item: canonical }
    ]
  };
  const schemaElement = document.querySelector('script[type="application/ld+json"]');
  if (schemaElement) {
    try {
      const schema = JSON.parse(schemaElement.textContent);
      const graph = Array.isArray(schema["@graph"]) ? schema["@graph"].filter((item) => !["BlogPosting", "BreadcrumbList"].includes(item?.["@type"])) : [];
      schemaElement.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": [...graph, articleSchema, breadcrumbSchema] });
    } catch (error) {
      console.error("Yapısal SEO verisi güncellenemedi:", error);
    }
  }
}

function postLink(post, label) {
  if (!post) return '<span class="article-nav-empty" aria-hidden="true"></span>';
  return `<a href="${postHref(post)}"><small>${label}</small><strong>${escapeHTML(post.title || "Başlıksız Yazı")}</strong></a>`;
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

function renderRelated(posts, post) {
  const related = relatedPosts(posts, post, 3);
  if (!related.length) return "";
  return `
    <section class="related-posts" aria-labelledby="relatedPostsTitle">
      <div class="section-heading split"><div><p class="eyebrow">Okumaya devam et</p><h2 id="relatedPostsTitle">Aynı histen kalanlar</h2></div><a class="section-link" href="/arsiv">Arşive git</a></div>
      <div class="post-grid related-post-grid">${related.map(renderCompactCard).join("")}</div>
    </section>`;
}

function initReadingProgress(enabled) {
  readingProgressCleanup?.();
  readingProgressCleanup = null;
  document.querySelector(".reading-progress")?.remove();
  if (!enabled) return;
  const progress = document.createElement("div");
  progress.className = "reading-progress";
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = "<span></span>";
  document.body.prepend(progress);
  const bar = progress.firstElementChild;
  let frame = 0;
  const update = () => {
    frame = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    bar.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / max))})`;
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  update();
  readingProgressCleanup = () => {
    removeEventListener("scroll", onScroll);
    removeEventListener("resize", onScroll);
    if (frame) cancelAnimationFrame(frame);
  };
}

function saveRecent(id) {
  const recents = readIdList(RECENTS_KEY, 5).filter((item) => item !== id);
  writeIdList(RECENTS_KEY, [id, ...recents], 5);
}

function requestedDetailRoute() {
  const params = new URLSearchParams(location.search);
  const id = String(params.get("id") || "").trim();
  if (id) return { id, slug: "", type: "" };

  const pathMatch = location.pathname.match(/^\/(siir|gun-notu)\/([^/]+)\/?$/);
  let slug = pathMatch?.[2] || params.get("slug") || "";
  try { slug = decodeURIComponent(slug); } catch { /* Kodlanmış değer olduğu gibi sınanır. */ }
  const type = pathMatch?.[1] === "siir" ? "poem" : pathMatch?.[1] === "gun-notu" ? "daily" : "";
  return { id: "", slug, type };
}

function requestedPost(posts, request = requestedDetailRoute()) {
  if (request.id) return posts.find((item) => item.id === request.id);
  if (!request.slug) return undefined;
  const typePosts = request.type ? posts.filter((item) => item.type === request.type) : posts;
  const titleSlugs = publicTitleSlugMap(posts);
  return typePosts.find((item) => titleSlugs.get(item.id) === request.slug)
    || typePosts.find((item) => storedPostSlug(item) === request.slug)
    || typePosts.find((item) => postMatchesSlug(item, request.slug))
    || typePosts.slice().sort((left, right) => getSortTime(left) - getSortTime(right))
      .find((item) => slugifyTitle(item.title) === request.slug);
}

function syncCanonicalDetailUrl(post) {
  const request = requestedDetailRoute();
  const canonicalPath = publicPostPath(post);
  if (!canonicalPath) return;
  const currentPath = location.pathname.replace(/\/+$/, "") || "/";
  if (request.id) {
    history.replaceState(null, "", canonicalPath);
    return;
  }
  if (request.slug && currentPath !== canonicalPath) {
    history.replaceState(null, "", canonicalPath);
  }
}

async function resolveRequestedDetail() {
  if (page !== "detail") return;
  const request = requestedDetailRoute();
  const cachedPost = requestedPost(currentPosts, request);
  if (cachedPost) {
    detailLookupStatus = "found";
    syncCanonicalDetailUrl(cachedPost);
    renderCurrent();
    return;
  }

  if ((!request.id && storedPostSlug({ slug: request.slug }) !== request.slug)
    || (request.id && (request.id.length > 1500 || request.id.includes("/")))) {
    detailLookupStatus = "not-found";
    renderCurrent();
    return;
  }

  try {
    let postDocument;
    if (request.id) {
      const snapshot = await getDoc(doc(postsCollection, request.id));
      if (snapshot.exists()) postDocument = { id: snapshot.id, ...snapshot.data() };
    } else {
      const exactQuery = request.type
        ? query(
          postsCollection,
          where("slug", "==", request.slug),
          where("type", "==", request.type),
          where("status", "==", "published"),
          limit(1)
        )
        : query(
          postsCollection,
          where("slug", "==", request.slug),
          where("status", "==", "published"),
          limit(1)
        );
      const exactSnapshot = await getDocs(exactQuery);
      let match = exactSnapshot.docs[0];
      if (!match) {
        const legacyQuery = request.type
          ? query(
            postsCollection,
            where("legacySlugs", "array-contains", request.slug),
            where("type", "==", request.type),
            where("status", "==", "published"),
            limit(1)
          )
          : query(
            postsCollection,
            where("legacySlugs", "array-contains", request.slug),
            where("status", "==", "published"),
            limit(1)
          );
        const legacySnapshot = await getDocs(legacyQuery);
        match = legacySnapshot.docs[0];
      }
      if (match) postDocument = { id: match.id, ...match.data() };
    }

    if (!postDocument || !isPublicPost(postDocument, Date.now())) {
      detailLookupStatus = "not-found";
      renderCurrent();
      return;
    }

    if (postDocument.status === "published") publishedValue[postDocument.id] = postDocument;
    else scheduledValue[postDocument.id] = postDocument;
    detailLookupStatus = "found";
    renderCurrent();
  } catch (error) {
    detailLookupStatus = request.id && error?.code === "permission-denied" ? "not-found" : "error";
    renderCurrent();
    if (detailLookupStatus === "error") console.error("Detay yazısı exact slug sorgusuyla yüklenemedi:", error);
  }
}

function renderDetail(posts) {
  const detail = document.getElementById("postDetail");
  detail?.classList.remove("is-poem-detail", "is-daily-detail");
  const post = requestedPost(posts);
  if (!post) {
    const message = detailLookupStatus === "error"
      ? "Yazı şu anda yüklenemedi. Lütfen tekrar dene."
      : detailLookupStatus === "not-found"
        ? "Bu yazı yayında değil ya da kaldırılmış."
        : "Yazı yükleniyor…";
    return renderEmpty(detail, message);
  }

  detailLookupStatus = "found";
  syncCanonicalDetailUrl(post);
  detail.classList.toggle("is-poem-detail", post.type === "poem");
  detail.classList.toggle("is-daily-detail", post.type === "daily");
  updateDetailSEO(post);
  saveRecent(post.id);
  const typePosts = posts.filter((item) => item.type === post.type);
  const adjacent = adjacentPosts(typePosts, post.id);
  const backUrl = post.type === "daily" ? "/gun-notlari" : "/siirler";
  const backText = post.type === "daily" ? "Gün Notlarına Dön" : "Şiirlere Dön";
  const favorite = readIdList(FAVORITES_KEY).includes(post.id);
  const minutes = readingMinutes(post.content);
  const showReadingTime = post.type === "daily" || minutes > 1;
  const showReadingProgress = showReadingTime || String(post.content || "").split(/\r?\n/).filter((line) => line.trim()).length > 18;
  const shareUrl = cleanPostUrl(post);
  const shareText = `${post.title || "Hissez yazısı"} — Hissez`;

  detail.innerHTML = `
    ${post.type === "daily" ? `<nav class="detail-breadcrumb" aria-label="İçerik yolu"><a href="/">Ana Sayfa</a><span aria-hidden="true">/</span><a href="/gun-notlari">Gün Notları</a><span aria-hidden="true">/</span><span aria-current="page">${escapeHTML(post.title || "Yazı")}</span></nav>` : ""}
    <div class="post-meta"><span>${typeLabel(post.type)}</span><span>${formatDate(post.date)}</span>${categoryChip(post)}${showReadingTime ? `<span>${minutes} dk okuma</span>` : ""}</div>
    <h1>${escapeHTML(post.title || "Başlıksız Yazı")}</h1>
    ${post.excerpt ? `<p class="hero-text">${escapeHTML(post.excerpt)}</p>` : ""}
    <div class="article-utility-actions">
      <button class="btn btn-ghost compact-btn" type="button" data-detail-action="favorite" aria-pressed="${favorite}">${favorite ? "♥ Favorilerde" : "♡ Favorilere Ekle"}</button>
      <div class="share-control">
        <button class="btn btn-primary compact-btn" type="button" data-detail-action="share" aria-controls="shareFallback" aria-expanded="false">Paylaş</button>
        <div class="share-fallback" id="shareFallback" hidden>
          <button type="button" data-detail-action="native-share">Telefon paylaşımı</button>
          <a href="https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          ${post.type === "poem" ? '<button type="button" data-detail-action="canvas-open">Instagram görseli</button>' : ""}
          <button type="button" data-detail-action="copy">Linki Kopyala</button>
        </div>
      </div>
    </div>
    <div class="article-body${post.type === "poem" ? " poem-watermarked" : ""}">
      ${post.type === "poem" ? '<span class="poem-watermark" aria-hidden="true"><span>hissez.com</span></span>' : ""}
      <span class="article-body-text">${escapeHTML(post.content || "").replaceAll("\n", "<br>")}</span>
    </div>
    ${post.authorNote ? `<aside class="author-note"><p class="eyebrow">Yazarın notu</p><p>${escapeHTML(post.authorNote).replaceAll("\n", "<br>")}</p></aside>` : ""}
    ${renderSeries(posts, post)}
    ${renderRelated(posts, post)}
    <nav class="article-neighbors" aria-label="Aynı türde önceki ve sonraki yazılar">${postLink(adjacent.previous, `← Önceki ${typeLabel(post.type)}`)}${postLink(adjacent.next, `Sonraki ${typeLabel(post.type)} →`)}</nav>
    <div class="article-actions"><a class="btn btn-primary" href="${backUrl}">${backText}</a><a class="btn btn-ghost" href="/">Ana Sayfa</a></div>
    ${post.type === "poem" ? renderCanvasDialog(post) : ""}`;

  canvasPost = post.type === "poem" ? post : null;
  initReadingProgress(showReadingProgress);
  detail.onclick = (event) => handleDetailClick(event, post);
  const dialog = document.getElementById("poemCanvasDialog");
  if (dialog) {
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("input", () => {
      canvasPreviewPage = 0;
      scheduleCanvasDraw();
    });
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

function setShareMenuState(open, trigger = document.querySelector('[data-detail-action="share"]')) {
  const fallback = document.getElementById("shareFallback");
  if (!fallback) return;
  fallback.hidden = !open;
  trigger?.setAttribute("aria-expanded", String(open));
  if (open) fallback.querySelector("a, button")?.focus();
}

async function runBusyAction(button, task) {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await task();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

async function handleDetailClick(event, post) {
  const button = event.target.closest("[data-detail-action]");
  if (!button) return;
  const action = button.dataset.detailAction;
  const canonical = cleanPostUrl(post);
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
    const fallback = document.getElementById("shareFallback");
    setShareMenuState(fallback?.hidden !== false, button);
  }
  if (action === "native-share") {
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title || "Hissez", text: `${post.title || "Hissez yazısı"} — Hissez`, url: canonical });
        setShareMenuState(false);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyText(canonical);
    setShareMenuState(false);
    showToast("Paylaşım desteklenmiyor; bağlantı kopyalandı.");
  }
  if (action === "canvas-open") {
    setShareMenuState(false);
    await openCanvasDialog();
  }
  if (action === "copy") {
    await copyText(canonical);
    setShareMenuState(false);
    showToast("Bağlantı kopyalandı.");
  }
  if (action === "canvas-close") document.getElementById("poemCanvasDialog")?.close();
  if (action === "canvas-page-prev") {
    canvasPreviewPage = Math.max(0, canvasPreviewPage - 1);
    await drawPoemCanvas();
  }
  if (action === "canvas-page-next") {
    canvasPreviewPage += 1;
    await drawPoemCanvas();
  }
  if (action === "canvas-share") await runBusyAction(button, () => sharePoemImage(post, readCanvasShareOptions()));
}

function renderCanvasDialog(post) {
  return `
    <dialog class="poem-canvas-dialog" id="poemCanvasDialog" aria-labelledby="poemCanvasTitle">
      <div class="dialog-head"><div><p class="eyebrow">Şiir kartı</p><h2 id="poemCanvasTitle">Şiiri Paylaş</h2></div><button class="dialog-close" type="button" data-detail-action="canvas-close" aria-label="Pencereyi kapat">×</button></div>
      <div class="canvas-dialog-grid">
        <div class="canvas-controls">
          <label><span>Boyut</span><select id="canvasFormat"><option value="post">1080 × 1350 · Gönderi</option><option value="story">1080 × 1920 · Hikâye</option></select></label>
          <label><span>Görseldeki bölüm</span><textarea id="canvasExcerpt" maxlength="5000" rows="9">${escapeHTML(poemCanvasExcerpt(post))}</textarea></label>
          <p>Metni burada düzenleyebilirsin; asıl yazı değişmez.</p>
          <div class="canvas-actions poem-share-actions">
            <button class="btn btn-primary" type="button" data-detail-action="canvas-share">Paylaş</button>
          </div>
          <p class="canvas-share-note">Telefonda paylaşım ekranı açılır. Tarayıcı görsel paylaşımını desteklemiyorsa dosyalar otomatik indirilir.</p>
        </div>
        <div class="canvas-preview">
          <div class="canvas-page-nav" id="canvasPageNav" hidden>
            <button type="button" data-detail-action="canvas-page-prev" aria-label="Önceki görsel sayfası">←</button>
            <strong id="canvasPageStatus" aria-live="polite">1 / 1</strong>
            <button type="button" data-detail-action="canvas-page-next" aria-label="Sonraki görsel sayfası">→</button>
          </div>
          <canvas id="poemCanvas" width="1080" height="1350" role="img" aria-label="Oluşturulan şiir görseli önizlemesi">Tarayıcın tuval önizlemesini desteklemiyor.</canvas>
        </div>
      </div>
    </dialog>`;
}

async function openCanvasDialog() {
  const dialog = document.getElementById("poemCanvasDialog");
  if (!dialog) return;
  dialog.showModal();
  canvasPreviewPage = 0;
  dialog.querySelector("select")?.focus();
  await drawPoemCanvas();
}

function scheduleCanvasDraw() {
  clearTimeout(canvasDrawTimer);
  canvasDrawTimer = window.setTimeout(drawPoemCanvas, 120);
}

function wrapCanvasText(ctx, text, maxWidth) {
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
    }
    if (line) lines.push(line);
  }
  return lines;
}

function paginateCanvasLines(lines, maxLines) {
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) {
    const pageLines = lines.slice(index, index + maxLines);
    while (pageLines[0] === "") pageLines.shift();
    while (pageLines[pageLines.length - 1] === "") pageLines.pop();
    if (pageLines.length) pages.push(pageLines);
  }
  return pages.length ? pages : [[""]];
}

function drawCanvasWatermark(ctx, canvas) {
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(-Math.PI / 12);
  ctx.globalAlpha = CANVAS_WATERMARK.opacity;
  ctx.fillStyle = "#761033";
  ctx.font = `700 ${CANVAS_WATERMARK.fontSize}px "Playfair Display", Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("hissez.com", 0, 0);
  ctx.restore();
}

async function renderPoemCanvas(canvas, post, options = {}) {
  if (!canvas || !post || post.type !== "poem") throw new Error("Paylaşılabilir şiir bulunamadı.");
  const format = options.format === "story" ? "story" : "post";
  const formatConfig = CANVAS_FORMATS[format];
  const excerpt = String(options.excerpt || poemCanvasExcerpt(post)).trim();
  canvas.width = formatConfig.width;
  canvas.height = formatConfig.height;
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
  drawCanvasWatermark(ctx, canvas);

  ctx.fillStyle = "#8d153f";
  ctx.font = "700 35px Inter, sans-serif";
  ctx.fillText("HİSSEZ · ŞİİR DEFTERİ", 100, 120);
  ctx.fillRect(100, 155, 100, 5);

  let titleSize = 72;
  ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`;
  while (ctx.measureText(post.title || "Başlıksız Şiir").width > 880 && titleSize > 46) {
    titleSize -= 2;
    ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`;
  }
  ctx.fillStyle = "#2a111b";
  ctx.fillText(post.title || "Başlıksız Şiir", 100, 265);

  const bodySize = excerpt.length > 520 ? 38 : excerpt.length > 330 ? 43 : format === "story" ? 54 : 49;
  ctx.font = `500 ${bodySize}px "Playfair Display", Georgia, serif`;
  const pages = paginateCanvasLines(wrapCanvasText(ctx, excerpt, 850), formatConfig.maxLines);
  const requestedPage = Number.isInteger(options.pageIndex) ? options.pageIndex : 0;
  const pageIndex = Math.min(Math.max(requestedPage, 0), pages.length - 1);
  const lines = pages[pageIndex];
  const lineHeight = Math.round(bodySize * 1.55);
  const bodyTop = 385;

  if (pages.length > 1) {
    ctx.save();
    ctx.fillStyle = "#8d153f";
    ctx.textAlign = "right";
    ctx.font = "700 28px Inter, sans-serif";
    ctx.fillText(`${pageIndex + 1} / ${pages.length}`, canvas.width - 100, 120);
    ctx.restore();
  }

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
  return { pageCount: pages.length, pageIndex };
}

async function drawPoemCanvas() {
  if (!canvasPost) return;
  const canvas = document.getElementById("poemCanvas");
  if (!canvas) return;
  const result = await renderPoemCanvas(canvas, canvasPost, {
    ...readCanvasShareOptions(),
    pageIndex: canvasPreviewPage
  });
  canvasPreviewPage = result.pageIndex;
  const navigation = document.getElementById("canvasPageNav");
  const status = document.getElementById("canvasPageStatus");
  if (navigation && status) {
    navigation.hidden = result.pageCount <= 1;
    status.textContent = `${result.pageIndex + 1} / ${result.pageCount}`;
    navigation.querySelector('[data-detail-action="canvas-page-prev"]').disabled = result.pageIndex === 0;
    navigation.querySelector('[data-detail-action="canvas-page-next"]').disabled = result.pageIndex >= result.pageCount - 1;
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Görsel oluşturulamadı.")), "image/png"));
}

function safeFileName(value) {
  return normalizeComparable(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "hissez-siir";
}

function readCanvasShareOptions() {
  return {
    format: document.getElementById("canvasFormat")?.value || "post",
    excerpt: document.getElementById("canvasExcerpt")?.value.trim() || ""
  };
}

async function canvasToFile(canvas, filename) {
  const blob = await canvasBlob(canvas);
  return new File([blob], filename, { type: "image/png" });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadFiles(files) {
  for (const file of files) {
    downloadFile(file);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }
}

async function createPoemImageFiles(post, options, suffix) {
  const canvas = document.createElement("canvas");
  const renderOptions = {
    format: options.format,
    excerpt: options.excerpt || poemCanvasExcerpt(post)
  };
  const firstPage = await renderPoemCanvas(canvas, post, { ...renderOptions, pageIndex: 0 });
  const files = [];
  const baseName = `hissez-${safeFileName(post.slug || post.title)}-${suffix}`;
  const pageDigits = Math.max(2, String(firstPage.pageCount).length);

  for (let pageIndex = 0; pageIndex < firstPage.pageCount; pageIndex += 1) {
    if (pageIndex > 0) await renderPoemCanvas(canvas, post, { ...renderOptions, pageIndex });
    const pageNumber = String(pageIndex + 1).padStart(pageDigits, "0");
    const pageTotal = String(firstPage.pageCount).padStart(pageDigits, "0");
    const pageSuffix = firstPage.pageCount > 1 ? `-sayfa-${pageNumber}-of-${pageTotal}` : "";
    files.push(await canvasToFile(canvas, `${baseName}${pageSuffix}.png`));
  }

  return files;
}

async function createPoemShareFiles(post, options = {}) {
  const format = options.format === "story" ? "story" : "post";
  return createPoemImageFiles(post, {
    format,
    excerpt: options.excerpt || poemCanvasExcerpt(post)
  }, format);
}

function canShareFiles(files) {
  try {
    if (typeof navigator.share !== "function") return false;
    return typeof navigator.canShare !== "function" || navigator.canShare({ files });
  } catch {
    return false;
  }
}

async function sharePoemImage(post, options = {}) {
  let files = [];
  try {
    files = await createPoemShareFiles(post, options);
    const orderedFiles = [...files].sort((left, right) => left.name.localeCompare(right.name, "tr", { numeric: true }));
    const shareUrl = cleanPostUrl(post);
    if (canShareFiles(orderedFiles)) {
      const shareData = {
        files: orderedFiles,
        title: post.title || "Hissez şiiri",
        text: `${post.title || "Hissez şiiri"} — Hissez\n${shareUrl}`
      };
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        await downloadFiles(orderedFiles);
        showToast("Görsel paylaşılamadı. Görsel cihazına indirildi.");
        return;
      }
    }

    await downloadFiles(orderedFiles);
    showToast(orderedFiles.length > 1 ? `${orderedFiles.length} görsel indirildi.` : "Görsel indirildi.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (files.length) {
      await downloadFiles(files);
      showToast("Görsel paylaşılamadı. Görsel cihazına indirildi.");
      return;
    }
    showToast("Görsel oluşturulamadı. Lütfen tekrar dene.");
  }
}

function renderCurrent() {
  const now = Date.now();
  currentPosts = normalizePosts(publishedValue, scheduledValue).filter((post) => isPublicPost(post, now));
  if (page === "home") renderHome(currentPosts);
  if (page === "list") renderList(currentPosts);
  if (page === "archive") renderArchive(currentPosts);
  if (page === "detail") renderDetail(currentPosts);
  document.querySelectorAll('[aria-busy="true"]').forEach((target) => target.removeAttribute("aria-busy"));
  const globalInput = document.getElementById("globalSearchInput");
  if (globalInput) renderGlobalSearch(globalInput.value);
}

function renderLoadError(error) {
  const message = "Yazılar alınırken bir sorun oluştu. Lütfen daha sonra tekrar dene.";
  if (page === "home") {
    renderEmpty(document.getElementById("featuredPost"), message);
    renderEmpty(document.getElementById("latestPosts"), message);
    renderEmpty(document.getElementById("categoryDiscovery"), message);
  }
  if (page === "list" || page === "archive") {
    renderEmpty(document.getElementById("postsGrid"), message);
    if (page === "archive") renderEmpty(document.getElementById("archiveOverview"), message);
  }
  if (page !== "detail") console.error(error);
  else console.warn("Genel yazı akışı yüklenemedi; detay exact slug sorgusu bekleniyor.", error);
}

function snapshotToPostValue(snapshot) {
  return Object.fromEntries(snapshot.docs.map((postDocument) => [postDocument.id, postDocument.data()]));
}

async function refreshScheduledPosts() {
  const serverNow = Date.now();
  const currentMinute = serverNow - (serverNow % 60000);
  const refreshVersion = ++scheduledRefreshVersion;
  const dueEntries = scheduledIndex.filter(({ publishAt }) => Number(publishAt) > 0 && Number(publishAt) <= currentMinute);
  const results = await Promise.allSettled(
    dueEntries.map(({ id }) => getDoc(doc(postsCollection, id)))
  );
  if (refreshVersion !== scheduledRefreshVersion) return;

  scheduledValue = {};
  results.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value.exists()) return;
    scheduledValue[result.value.id] = result.value.data();
  });
  scheduledWarningShown = false;
  renderCurrent();
  const rejected = results.find((result) => result.status === "rejected");
  if (rejected && !scheduledWarningShown) {
    scheduledWarningShown = true;
    console.warn("Zamanlanmış yazılar şu anda kontrol edilemedi:", rejected.reason);
  }
}

function watchScheduledIndex() {
  onSnapshot(postScheduleCollection, (snapshot) => {
    scheduledIndex = snapshot.docs.map((scheduleDocument) => ({ id: scheduleDocument.id, ...scheduleDocument.data() }));
    refreshScheduledPosts();
  }, (error) => {
    if (!scheduledWarningShown) {
      scheduledWarningShown = true;
      console.warn("Zamanlanmış yazı indeksi yüklenemedi:", error);
    }
  });
}

function watchPublishedPosts(onSettled) {
  const publishedQuery = query(postsCollection, where("status", "==", "published"));
  onSnapshot(publishedQuery, (snapshot) => {
    onSettled();
    publishedValue = snapshotToPostValue(snapshot);
    writePublicPostsCache(publishedValue);
    scheduledWarningShown = false;
    renderCurrent();
  }, (error) => {
    onSettled(error);
  });
}

function init() {
  initGlobalSearch();

  const cachedPosts = readPublicPostsCache();
  const hasCachedPosts = Object.keys(cachedPosts).length > 0;
  if (hasCachedPosts) {
    publishedValue = cachedPosts;
    renderCurrent();
  }

  if (page === "detail") resolveRequestedDetail();

  const skeletonTimer = window.setTimeout(() => {
    if (!publishedRequestSettled && !hasCachedPosts) renderLoadingSkeletons();
  }, 180);

  let publishedRequestSettled = false;
  const loadingTimer = window.setTimeout(() => {
    if (!publishedRequestSettled && !hasCachedPosts) {
      renderLoadError(new Error("Public yazılar zamanında yüklenemedi."));
    }
  }, 6000);

  watchPublishedPosts((error = null) => {
    publishedRequestSettled = true;
    window.clearTimeout(skeletonTimer);
    window.clearTimeout(loadingTimer);
    if (!error) return;
    if (!hasCachedPosts) renderLoadError(error);
    else console.warn("Canlı yazılar yenilenemedi; son kaydedilen public içerikler gösteriliyor.", error);
  });
  watchScheduledIndex();

  refreshScheduledPosts();

  window.setInterval(refreshScheduledPosts, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshScheduledPosts();
  });
}

init();
