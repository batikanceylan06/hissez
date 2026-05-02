import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { app } from "./firebase-config.js";

const db = getDatabase(app);
const page = document.body.dataset.page;
const pageType = document.body.dataset.type;

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(value = "", max = 145) {
  const text = stripText(value);
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function formatDate(value) {
  if (!value) return "Tarihsiz";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return escapeHTML(value);
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function dateParts(value) {
  if (!value) return { day: "--", month: "Tarihsiz" };
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { day: "--", month: escapeHTML(value) };
  return {
    day: new Intl.DateTimeFormat("tr-TR", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("tr-TR", { month: "short", year: "numeric" }).format(date)
  };
}

function typeLabel(type) {
  return type === "daily" ? "Gün Notu" : "Şiir";
}

function getTime(post) {
  const dateTime = post.date ? new Date(`${post.date}T12:00:00`).getTime() : 0;
  return dateTime || post.createdAt || 0;
}

function normalizePosts(value) {
  return Object.entries(value || {})
    .map(([id, post]) => ({ id, ...post }))
    .filter((post) => post.status === "published")
    .sort((a, b) => getTime(b) - getTime(a));
}

function postExcerpt(post, max = 145) {
  return escapeHTML(truncate(post.excerpt || post.content || "", max));
}

function renderCard(post) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const date = dateParts(post.date);

  return `
    <article class="post-card">
      <div class="post-card-date">
        <strong>${date.day}</strong>
        <span>${date.month}</span>
      </div>
      <div>
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span>
          <span>${formatDate(post.date)}</span>
          ${post.category ? `<span>${escapeHTML(post.category)}</span>` : ""}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Yazı")}</h3>
        <p>${postExcerpt(post)}</p>
      </div>
      <a class="read-more" href="${href}">Devamını Oku</a>
    </article>
  `;
}



function renderPoemBook(post, pageNumber = 1) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const pageNo = String(pageNumber).padStart(2, "0");
  return `
    <article class="poem-book-entry">
      <div class="poem-book-left">
        <span class="poem-book-label">Şiir Defteri</span>
        <strong>${pageNo}</strong>
        <small>${formatDate(post.date)}</small>
      </div>
      <div class="poem-book-right">
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span>
          ${post.category ? `<span>${escapeHTML(post.category)}</span>` : ""}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Şiir")}</h3>
        <p>${postExcerpt(post, 230)}</p>
        <a class="read-more poem-book-read" href="${href}">Şiiri Oku</a>
      </div>
    </article>
  `;
}

function renderDailyTimeline(post, index = 0) {
  const href = `yazi.html?id=${encodeURIComponent(post.id)}`;
  const date = dateParts(post.date);
  const side = index % 2 === 0 ? "left" : "right";
  return `
    <article class="daily-timeline-entry ${side}">
      <div class="daily-timeline-dot">
        <strong>${date.day}</strong>
        <span>${date.month}</span>
      </div>
      <div class="daily-timeline-card">
        <div class="post-meta">
          <span>${typeLabel(post.type)}</span>
          <span>${formatDate(post.date)}</span>
          ${post.category ? `<span>${escapeHTML(post.category)}</span>` : ""}
        </div>
        <h3>${escapeHTML(post.title || "Başlıksız Gün Notu")}</h3>
        <p>${postExcerpt(post, 190)}</p>
        <a class="read-more daily-read" href="${href}">Gün Notunu Oku</a>
      </div>
    </article>
  `;
}

function renderEmpty(target, text) {
  if (!target) return;
  target.innerHTML = `<div class="empty-state">${escapeHTML(text)}</div>`;
}

function buildSequenceMap(posts) {
  const sequenceMap = new Map();

  posts
    .slice()
    .sort((a, b) => {
      const timeDiff = getTime(a) - getTime(b);
      if (timeDiff !== 0) return timeDiff;
      return (a.createdAt || 0) - (b.createdAt || 0);
    })
    .forEach((post, index) => {
      sequenceMap.set(post.id, index + 1);
    });

  return sequenceMap;
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
          <div class="post-meta">
            <span>${typeLabel(featuredPost.type)}</span>
            <span>${formatDate(featuredPost.date)}</span>
          </div>
          <h3>${escapeHTML(featuredPost.title || "Başlıksız Yazı")}</h3>
          <p>${postExcerpt(featuredPost, 220)}</p>
        </div>
        <a class="btn btn-primary" href="yazi.html?id=${encodeURIComponent(featuredPost.id)}">Yazıyı Oku</a>
      </article>
    `;
  } else {
    renderEmpty(featured, "Henüz yayında yazı yok.");
  }

  const poems = posts.filter((post) => post.type === "poem").slice(0, 1);
  const daily = posts.filter((post) => post.type === "daily").slice(0, 1);

  latestPoems.innerHTML = poems.length
    ? poems.map(renderCard).join("")
    : `<div class="empty-state">Henüz yayında şiir yok.</div>`;

  latestDaily.innerHTML = daily.length
    ? daily.map(renderCard).join("")
    : `<div class="empty-state">Henüz yayında gün notu yok.</div>`;
}

function renderList(posts) {
  const grid = document.getElementById("postsGrid");
  const filtered = posts.filter((post) => post.type === pageType);
  const emptyText = pageType === "daily"
    ? "Henüz yayında gün notu yok."
    : "Henüz yayında şiir yok.";

  if (!filtered.length) {
    grid.className = "post-grid";
    grid.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }

  if (pageType === "poem") {
    const sequenceMap = buildSequenceMap(filtered);

    grid.className = "poem-book-list reveal is-visible";
    grid.innerHTML = filtered.map((post) => renderPoemBook(post, sequenceMap.get(post.id))).join("");
    return;
  }

  if (pageType === "daily") {
    grid.className = "daily-timeline-list reveal is-visible";
    grid.innerHTML = filtered.map((post, index) => renderDailyTimeline(post, index)).join("");
    return;
  }

  grid.className = "post-grid reveal is-visible";
  grid.innerHTML = filtered.map(renderCard).join("");
}


function updateDetailSEO(post) {
  const title = `${post.title || "Yazı"} | Hissez`;
  const description = truncate(post.excerpt || post.content || "Hissez yazı detay sayfası.", 155);
  const canonical = `${location.origin}${location.pathname}?id=${encodeURIComponent(post.id)}`;

  document.title = title;

  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", description);

  let canonicalLink = document.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    canonicalLink = document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.setAttribute("href", canonical);

  const setMeta = (selector, key, value) => {
    let item = document.querySelector(selector);
    if (!item) {
      item = document.createElement("meta");
      const nameMatch = selector.match(/name="([^"]+)"/);
      const propertyMatch = selector.match(/property="([^"]+)"/);
      if (nameMatch) item.setAttribute("name", nameMatch[1]);
      if (propertyMatch) item.setAttribute("property", propertyMatch[1]);
      document.head.appendChild(item);
    }
    item.setAttribute(key, value);
  };

  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[property="og:url"]', "content", canonical);
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", description);

  document.querySelectorAll('script[data-dynamic-schema="article"]').forEach((item) => item.remove());
  const articleSchema = document.createElement("script");
  articleSchema.type = "application/ld+json";
  articleSchema.dataset.dynamicSchema = "article";
  articleSchema.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": post.title || "Hissez Yazısı",
    "description": description,
    "datePublished": post.date || undefined,
    "dateModified": post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
    "author": { "@type": "Person", "name": "Sezin" },
    "publisher": { "@type": "Person", "name": "Sezin" },
    "mainEntityOfPage": canonical
  });
  document.head.appendChild(articleSchema);
}

function renderDetail(posts) {
  const detail = document.getElementById("postDetail");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");

  if (!id) {
    renderEmpty(detail, "Yazı bulunamadı.");
    return;
  }

  const post = posts.find((item) => item.id === id);

  if (!post) {
    renderEmpty(detail, "Bu yazı yayında değil ya da kaldırılmış.");
    return;
  }

  updateDetailSEO(post);
  const backUrl = post.type === "daily" ? "gun-notlari.html" : "siirler.html";
  const backText = post.type === "daily" ? "Gün Notlarına Dön" : "Şiirlere Dön";

  detail.innerHTML = `
    <div class="post-meta">
      <span>${typeLabel(post.type)}</span>
      <span>${formatDate(post.date)}</span>
      ${post.category ? `<span>${escapeHTML(post.category)}</span>` : ""}
    </div>
    <h1>${escapeHTML(post.title || "Başlıksız Yazı")}</h1>
    ${post.excerpt ? `<p class="hero-text">${escapeHTML(post.excerpt)}</p>` : ""}
    <div class="article-body">${escapeHTML(post.content || "").replaceAll("\n", "<br>")}</div>
    <div class="article-actions">
      <a class="btn btn-primary" href="${backUrl}">${backText}</a>
      <a class="btn btn-ghost" href="index.html">Ana Sayfa</a>
    </div>
  `;
}

function init() {
  onValue(ref(db, "posts"), (snapshot) => {
    const posts = normalizePosts(snapshot.val());

    if (page === "home") renderHome(posts);
    if (page === "list") renderList(posts);
    if (page === "detail") renderDetail(posts);
  }, (error) => {
    const message = "Yazılar alınırken bir sorun oluştu. Firebase ayarlarını kontrol et.";
    if (page === "home") {
      renderEmpty(document.getElementById("featuredPost"), message);
      renderEmpty(document.getElementById("latestPoems"), message);
      renderEmpty(document.getElementById("latestDaily"), message);
    }
    if (page === "list") renderEmpty(document.getElementById("postsGrid"), message);
    if (page === "detail") renderEmpty(document.getElementById("postDetail"), message);
    console.error(error);
  });
}

init();
