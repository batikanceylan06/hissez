import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const htmlFiles = ["index.html", "siirler.html", "gun-notlari.html", "arsiv.html", "yazi.html", "hakkimda.html", "sezin-panel.html"];
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
const csp = vercel.headers[0].headers.find((header) => header.key === "Content-Security-Policy")?.value || "";

for (const file of htmlFiles) {
  const html = readFileSync(resolve(root, file), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, `${file}: yinelenen id var`);

  for (const match of html.matchAll(/<(?:a|link|script|img)[^>]+(?:href|src)="([^"]+)"[^>]*>/g)) {
    const url = match[1];
    if (/^(?:https?:|data:|#|mailto:|tel:)/.test(url)) continue;
    const localPath = url.split(/[?#]/)[0];
    assert.ok(existsSync(resolve(root, localPath)), `${file}: eksik yerel kaynak ${localPath}`);
  }

  for (const match of html.matchAll(/<a\b([^>]*target="_blank"[^>]*)>/g)) {
    assert.match(match[1], /rel="[^"]*noopener[^"]*noreferrer[^"]*"/, `${file}: target=_blank rel güvenliği eksik`);
  }

  for (const match of html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const content = match[1];
    const hash = createHash("sha256").update(content).digest("base64");
    assert.ok(csp.includes(`sha256-${hash}`), `${file}: inline script CSP hash listesinde değil`);
  }
}

const panel = readFileSync(resolve(root, "sezin-panel.html"), "utf8");
for (const requiredId of ["postPublishAt", "postSeries", "postAuthorNote", "statScheduled"]) {
  assert.ok(panel.includes(`id="${requiredId}"`), `Panel alanı eksik: ${requiredId}`);
}

const sw = readFileSync(resolve(root, "sw.js"), "utf8");
const cachedAssets = [...sw.matchAll(/^\s*"(\/[^"]+)"[,]?$/gm)].map((match) => match[1]);
for (const asset of cachedAssets) {
  const localPath = asset === "/" ? "index.html" : asset.slice(1).split(/[?#]/)[0];
  assert.ok(existsSync(resolve(root, localPath)), `Service Worker kaynağı eksik: ${asset}`);
}
assert.ok(cachedAssets.includes("/assets/js/post-utils.js"), "post-utils.js Service Worker cache listesinde değil");
assert.ok(cachedAssets.includes("/arsiv.html"), "arsiv.html Service Worker cache listesinde değil");
for (const resilienceToken of ["NETWORK_TIMEOUT_MS", "AbortController", "ignoreSearch", "OPTIONAL_ASSETS"]) {
  assert.ok(sw.includes(resilienceToken), `PWA dayanıklılık özelliği eksik: ${resilienceToken}`);
}
for (const safariRecoveryToken of [
  'hissez-public-v30-share-images',
  'key.startsWith("hissez-")',
  "await self.skipWaiting()",
  "await self.clients.claim()"
]) {
  assert.ok(sw.includes(safariRecoveryToken), `Safari PWA yenileme özelliği eksik: ${safariRecoveryToken}`);
}

const main = readFileSync(resolve(root, "assets/js/main.js"), "utf8");
for (const recoveryToken of [
  'const PWA_RECOVERY_VERSION = "30"',
  'name.startsWith("hissez-")',
  "registration.unregister()",
  "caches.delete(name)",
  'updateViaCache: "none"'
]) {
  assert.ok(main.includes(recoveryToken), `Safari istemci kurtarma özelliği eksik: ${recoveryToken}`);
}
for (const file of htmlFiles.filter((file) => file !== "sezin-panel.html")) {
  const html = readFileSync(resolve(root, file), "utf8");
  assert.ok(html.includes('assets/js/main.js?v=30'), `${file}: sürümlü main.js bağlantısı eksik`);
  assert.ok(html.includes('assets/js/posts.js?v=30'), `${file}: sürümlü posts.js bağlantısı eksik`);
}

const posts = readFileSync(resolve(root, "assets/js/posts.js"), "utf8");
assert.ok(posts.includes('const PUBLIC_POSTS_CACHE_KEY = "hissezPublicPostsV1"'), "Public yazı offline cache'i eksik");
assert.ok(posts.indexOf("onValue(publishedQuery") < posts.indexOf('get(ref(db, ".info/serverTimeOffset"))'), "Public listener sunucu saatini bekliyor");
for (const requiredWatermarkToken of [
  'id="canvasWatermark"',
  'value="elegant"',
  'value="strong"',
  'ctx.fillText("hissez.com", x + offset, y)',
  "drawCanvasWatermark(ctx, canvas, watermarkMode)"
]) {
  assert.ok(posts.includes(requiredWatermarkToken), `Canvas filigran özelliği eksik: ${requiredWatermarkToken}`);
}

for (const requiredShareToken of [
  'data-share-target="whatsapp"',
  'data-share-target="story"',
  'data-share-target="instagram"',
  'story: { width: 1080, height: 1920, maxLines: 18 }',
  "canvasToFile(canvas, filename)",
  "createPoemShareFiles(post, targetName",
  "sharePoemImage(post, targetName",
  'left.name.localeCompare(right.name, "tr", { numeric: true })',
  "await downloadFiles(orderedFiles)",
  'text: `${post.title || "Hissez şiiri"} — Hissez\\n${shareUrl}`'
]) {
  assert.ok(posts.includes(requiredShareToken), `Şiir görseli paylaşım özelliği eksik: ${requiredShareToken}`);
}

for (const requiredPaginationToken of [
  'id="canvasPageNav"',
  'data-detail-action="canvas-page-prev"',
  'data-detail-action="canvas-page-next"',
  "paginateCanvasLines",
  'padStart(pageDigits, "0")',
  "-sayfa-${pageNumber}-of-${pageTotal}"
]) {
  assert.ok(posts.includes(requiredPaginationToken), `Şiir görseli sayfalama özelliği eksik: ${requiredPaginationToken}`);
}

for (const requiredBlogToken of [
  "function renderArchive(posts)",
  "function renderArchiveOverview(posts)",
  "function initGlobalSearch()",
  "function renderRelated(posts, post)",
  "function initReadingProgress(enabled)",
  'href="arsiv.html?category=',
  "posts.slice(0, 6)"
]) {
  assert.ok(posts.includes(requiredBlogToken), `Edebiyat blogu özelliği eksik: ${requiredBlogToken}`);
}

const index = readFileSync(resolve(root, "index.html"), "utf8");
assert.ok(index.includes('id="latestPosts"'), "Ana sayfa kronolojik yazı akışı eksik");
assert.ok(index.includes('id="categoryDiscovery"'), "Ana sayfa kategori keşfi eksik");
assert.ok(!index.includes("Yarım kalan sayfalar"), "Kaldırılan yarım kalan sayfalar alanı hâlâ mevcut");
assert.ok(index.includes("https://www.instagram.com/hissezz"), "Ana sayfa Instagram bağlantısı eksik");

const about = readFileSync(resolve(root, "hakkimda.html"), "utf8");
assert.ok(about.includes('class="instagram-fixed-icon"'), "Hakkımda Instagram logosu eksik");

const sitemap = readFileSync(resolve(root, "sitemap.xml"), "utf8");
assert.ok(sitemap.includes("https://hissez.com/arsiv.html"), "Arşiv sitemap içinde değil");

const archivePage = readFileSync(resolve(root, "arsiv.html"), "utf8");
assert.ok(archivePage.includes('id="archiveOverview"'), "Arşiv yıl/ay ve kategori özeti eksik");
assert.ok(posts.includes("· ${minutes} dk okuma"), "Ortak blog kartlarında okuma süresi eksik");

console.log("Statik kontroller geçti: HTML/CSP, arşiv, keşif, arama, ilişkili yazılar, Canvas filigranı, çok sayfalı paylaşım ve PWA cache listesi.");
