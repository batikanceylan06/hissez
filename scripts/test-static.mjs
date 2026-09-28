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
  const localPath = asset === "/" ? "index.html" : asset.slice(1);
  assert.ok(existsSync(resolve(root, localPath)), `Service Worker kaynağı eksik: ${asset}`);
}
assert.ok(cachedAssets.includes("/assets/js/post-utils.js"), "post-utils.js Service Worker cache listesinde değil");
assert.ok(cachedAssets.includes("/arsiv.html"), "arsiv.html Service Worker cache listesinde değil");

const posts = readFileSync(resolve(root, "assets/js/posts.js"), "utf8");
for (const requiredWatermarkToken of [
  'id="canvasWatermark"',
  'value="elegant"',
  'value="strong"',
  'ctx.fillText("HISSEZ", 0, 0)',
  "drawCanvasWatermark(ctx, canvas, watermarkMode)"
]) {
  assert.ok(posts.includes(requiredWatermarkToken), `Canvas filigran özelliği eksik: ${requiredWatermarkToken}`);
}

for (const requiredShareToken of [
  'data-share-target="whatsapp"',
  'data-share-target="story"',
  'data-share-target="instagram"',
  "canvasToFile(canvas, filename)",
  "createPoemShareFiles(post, targetName",
  "sharePoemImage(post, targetName"
]) {
  assert.ok(posts.includes(requiredShareToken), `Şiir görseli paylaşım özelliği eksik: ${requiredShareToken}`);
}

for (const requiredPaginationToken of [
  'id="canvasPageNav"',
  'data-detail-action="canvas-page-prev"',
  'data-detail-action="canvas-page-next"',
  "paginateCanvasLines",
  "-sayfa-${pageIndex + 1}"
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

const sitemap = readFileSync(resolve(root, "sitemap.xml"), "utf8");
assert.ok(sitemap.includes("https://hissez.com/arsiv.html"), "Arşiv sitemap içinde değil");

const archivePage = readFileSync(resolve(root, "arsiv.html"), "utf8");
assert.ok(archivePage.includes('id="archiveOverview"'), "Arşiv yıl/ay ve kategori özeti eksik");
assert.ok(posts.includes("· ${minutes} dk okuma"), "Ortak blog kartlarında okuma süresi eksik");

console.log("Statik kontroller geçti: HTML/CSP, arşiv, keşif, arama, ilişkili yazılar, Canvas filigranı, çok sayfalı paylaşım ve PWA cache listesi.");
