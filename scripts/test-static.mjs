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
    if (/^\/(?:siirler|gun-notlari|arsiv|hakkimda|sezin-panel)(?:[?#]|$)/.test(url)) continue;
    const localPath = url.split(/[?#]/)[0].replace(/^\//, "");
    assert.ok(existsSync(resolve(root, localPath)), `${file}: eksik yerel kaynak ${localPath}`);
    if (!url.startsWith("/") && (localPath.startsWith("assets/") || localPath.endsWith(".webmanifest"))) {
      assert.fail(`${file}: asset yolu root-relative değil: ${url}`);
    }
  }

  assert.doesNotMatch(html, /(?:href|src)="(?:assets\/|site\.webmanifest|panel\.webmanifest)/, `${file}: nested route için relative asset yolu kaldı`);
  assert.doesNotMatch(html, /href="(?:index|siirler|gun-notlari|arsiv|hakkimda|sezin-panel)\.html/, `${file}: kullanıcı-facing .html navigasyonu kaldı`);

  for (const match of html.matchAll(/<a\b([^>]*target="_blank"[^>]*)>/g)) {
    assert.match(match[1], /rel="[^"]*noopener[^"]*noreferrer[^"]*"/, `${file}: target=_blank rel güvenliği eksik`);
  }

  for (const match of html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const content = match[1];
    const hash = createHash("sha256").update(content).digest("base64");
    assert.ok(csp.includes(`sha256-${hash}`), `${file}: inline script CSP hash listesinde değil`);
  }
}

for (const file of ["index.html", "siirler.html", "gun-notlari.html", "arsiv.html", "hakkimda.html"]) {
  const html = readFileSync(resolve(root, file), "utf8");
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${file}: public sayfada tam bir H1 olmalı`);
}
assert.ok(readFileSync(resolve(root, "yazi.html"), "utf8").includes('id="postDetail"'), "Detay sayfası dinamik H1 kapsayıcısını içermiyor");

const panel = readFileSync(resolve(root, "sezin-panel.html"), "utf8");
for (const requiredId of ["postPublishAt", "postSeries", "postAuthorNote", "statScheduled"]) {
  assert.ok(panel.includes(`id="${requiredId}"`), `Panel alanı eksik: ${requiredId}`);
}

const sw = readFileSync(resolve(root, "sw.js"), "utf8");
const backingRoutes = { "/": "index.html", "/siirler": "siirler.html", "/gun-notlari": "gun-notlari.html", "/arsiv": "arsiv.html", "/hakkimda": "hakkimda.html", "/sezin-panel": "sezin-panel.html" };
const cachedAssets = [...sw.matchAll(/^\s*"(\/[^"]+)"[,]?$/gm)].map((match) => match[1]);
for (const asset of cachedAssets) {
  const localPath = backingRoutes[asset] || asset.slice(1).split(/[?#]/)[0];
  assert.ok(existsSync(resolve(root, localPath)), `Service Worker kaynağı eksik: ${asset}`);
}
assert.ok(cachedAssets.includes("/assets/js/post-utils.js"), "post-utils.js Service Worker cache listesinde değil");
assert.ok(sw.includes('  "/",'), "Ana sayfa Service Worker cache listesinde değil");
for (const adminOnlyPath of ["/sezin-panel", "/sezin-panel.html", "/assets/js/admin.js", "/assets/css/admin.css", "/panel.webmanifest"]) {
  assert.ok(sw.includes(`"${adminOnlyPath}"`), `Admin kaynağı Service Worker network-only listesinde değil: ${adminOnlyPath}`);
}
for (const route of ["/siirler", "/gun-notlari", "/arsiv", "/hakkimda", "/yazi.html"]) {
  assert.ok(cachedAssets.includes(route), `${route} Service Worker cache listesinde değil`);
}
for (const resilienceToken of ["NETWORK_TIMEOUT_MS", "AbortController", "ignoreSearch", "OPTIONAL_ASSETS"]) {
  assert.ok(sw.includes(resilienceToken), `PWA dayanıklılık özelliği eksik: ${resilienceToken}`);
}
for (const safariRecoveryToken of [
  'hissez-public-v42-poem-lines-social-icons',
  'key.startsWith("hissez-")',
  "await self.skipWaiting()",
  "await self.clients.claim()"
]) {
  assert.ok(sw.includes(safariRecoveryToken), `Safari PWA yenileme özelliği eksik: ${safariRecoveryToken}`);
}

const main = readFileSync(resolve(root, "assets/js/main.js"), "utf8");
for (const editorialUiToken of [
  'menuToggle.setAttribute("aria-controls", siteNav.id)',
  'menuToggle.setAttribute("aria-expanded", "false")'
]) {
  assert.ok(main.includes(editorialUiToken), `Editorial ortak UI davranışı eksik: ${editorialUiToken}`);
}
for (const recoveryToken of [
  'const PWA_RECOVERY_VERSION = "42"',
  'name.startsWith("hissez-")',
  "registration.unregister()",
  "caches.delete(name)",
  'updateViaCache: "none"'
]) {
  assert.ok(main.includes(recoveryToken), `Safari istemci kurtarma özelliği eksik: ${recoveryToken}`);
}
for (const file of htmlFiles.filter((file) => file !== "sezin-panel.html")) {
  const html = readFileSync(resolve(root, file), "utf8");
  assert.ok(html.includes('assets/css/style.css?v=42'), `${file}: sürümlü style.css bağlantısı eksik`);
  assert.ok(html.includes('assets/js/main.js?v=42'), `${file}: sürümlü main.js bağlantısı eksik`);
  assert.ok(html.includes('assets/js/posts.js?v=42'), `${file}: sürümlü posts.js bağlantısı eksik`);
}
assert.ok(panel.includes('assets/js/admin.js?v=42'), "Panel sürümlü admin.js bağlantısı eksik");

assert.doesNotMatch(csp, /\*/, "CSP wildcard içeriyor");
assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, "CSP unsafe-inline/unsafe-eval içeriyor");
for (const cspToken of [
  "https://www.gstatic.com",
  "https://www.google.com/recaptcha/",
  "https://firestore.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://content-firebaseappcheck.googleapis.com",
  "https://hissez.firebaseapp.com"
]) {
  assert.ok(csp.includes(cspToken), `CSP App Check/Firebase kaynağı eksik: ${cspToken}`);
}

const posts = readFileSync(resolve(root, "assets/js/posts.js"), "utf8");
const postUtils = readFileSync(resolve(root, "assets/js/post-utils.js"), "utf8");
for (const loadingUiToken of ["function renderSkeleton(", "function renderLoadingSkeletons(", 'class="empty-state-mark"', 'id="activeFilters"']) {
  assert.ok(posts.includes(loadingUiToken), `Skeleton/empty/filter regresyon koruması eksik: ${loadingUiToken}`);
}
assert.ok(postUtils.includes("filters.type"), "Arşiv tür filtresi ortak filtre katmanında değil");
assert.ok(posts.includes('const PUBLIC_POSTS_CACHE_KEY = "hissezPublicPostsV3"'), "Public yazı offline cache'i sürümlenmedi");
assert.ok(posts.includes("firebase-firestore.js"), "Public yazılar Firestore SDK kullanmıyor");
assert.ok(posts.includes('where("status", "==", "published")'), "Published Firestore sorgusu eksik");
for (const exactDetailToken of [
  'where("slug", "==", request.slug)',
  'where("legacySlugs", "array-contains", request.slug)',
  'where("type", "==", request.type)',
  'where("status", "==", "published")',
  "limit(1)",
  "await getDocs(exactQuery)",
  "await getDocs(legacyQuery)",
  'detailLookupStatus = "not-found"',
  'detailLookupStatus = request.id && error?.code === "permission-denied" ? "not-found" : "error"',
  '"Yazı şu anda yüklenemedi. Lütfen tekrar dene."',
  '"Bu yazı yayında değil ya da kaldırılmış."'
]) {
  assert.ok(posts.includes(exactDetailToken), `Detay exact slug yükleme davranışı eksik: ${exactDetailToken}`);
}
assert.ok(posts.includes('collection(firestore, "postSchedule")'), "Scheduled metadata collection eksik");
assert.ok(posts.includes("getDoc(doc(postsCollection, id))"), "Due scheduled tekil okuması eksik");
assert.doesNotMatch(posts, /database|server.*offset|clock.*db/i, "Public runtime Firestore dışında bir database bağımlılığı içeriyor");

const admin = readFileSync(resolve(root, "assets/js/admin.js"), "utf8");
assert.ok(admin.includes("firebase-firestore.js"), "Admin panel Firestore SDK kullanmıyor");
for (const firestoreAdminToken of ["onSnapshot(postsCollection", "doc(postsCollection)", "batch.update(doc(postsCollection", "batch.delete(doc(postsCollection", "writeBatch(firestore)", 'collection(firestore, "postSchedule")']) {
  assert.ok(admin.includes(firestoreAdminToken), `Admin Firestore özelliği eksik: ${firestoreAdminToken}`);
}
assert.doesNotMatch(admin, /database/i, "Admin runtime Firestore dışında bir database bağımlılığı içeriyor");
assert.ok(admin.includes("uniqueTitleSlug"), "Admin ortak title slug yardımcısını kullanmıyor");
assert.ok(admin.includes("legacyPostSlugs"), "Admin legacy slug geçmişini kullanmıyor");
assert.ok(admin.includes('href="${publicPath}"'), "Admin görüntüleme linki stored slug yolunu kullanmıyor");
assert.ok(admin.includes("const slug = uniqueSlug(title, current?.id)"), "Admin edit sırasında title slug üretmiyor");
assert.ok(admin.includes("legacySlugs.push(currentSlug)"), "Admin eski slug'ı legacySlugs içine taşımıyor");
assert.ok(admin.includes("return tokenResult.claims.admin === true"), "Admin paneli yalnızca custom claim ile yetkilendirmiyor");
assert.doesNotMatch(admin, /localStorage\.(?:getItem|setItem)\([^)]*(?:auth|token|session)/i, "Admin session/token localStorage'a yazılıyor");
assert.ok(admin.includes('"auth/invalid-credential", "auth/user-not-found", "auth/invalid-email", "auth/wrong-password"'), "Auth hata mesajları hesap enumeration riskini azaltmıyor");
assert.doesNotMatch(admin, /Bu e-posta için kullanıcı bulunamadı|Şifre hatalı\./, "Auth hata mesajı hesap var/yok bilgisini açığa çıkarıyor");

for (const cleanNavigation of ['href="/"', 'href="/siirler"', 'href="/gun-notlari"', 'href="/arsiv"', 'href="/hakkimda"', 'src: "/assets/audio/']) {
  assert.ok(main.includes(cleanNavigation), `Main temiz navigasyon/asset eksik: ${cleanNavigation}`);
}
assert.ok(main.includes("function recoverLocalCleanPostRoute()"), "Yerel clean post route fallback'i eksik");
assert.ok(main.includes('location.replace(`/yazi.html?slug='), "Yerel clean post route detay sayfasına yönlenmiyor");
for (const source of [posts, admin, main]) {
  assert.doesNotMatch(source, /(?:href|src)\s*[:=]\s*["'`]?(?:index|siirler|gun-notlari|arsiv|hakkimda|sezin-panel)\.html/, "JS içinde kullanıcı-facing .html yolu kaldı");
}

for (const requiredFile of [
  "config/firestore.rules",
  "config/firestore.indexes.json",
  "scripts/test-firestore-rules.mjs",
  "scripts/migrate-title-slugs.mjs"
]) {
  assert.ok(existsSync(resolve(root, requiredFile)), `Firestore dosyası eksik: ${requiredFile}`);
}

const firebaseConfig = readFileSync(resolve(root, "assets/js/firebase-config.js"), "utf8");
assert.doesNotMatch(firebaseConfig, /database/i, "Firebase config içinde eski database bağlantısı kaldı");
for (const appCheckToken of [
  "initializeAppCheck",
  "ReCaptchaEnterpriseProvider",
  "appCheckSiteKey",
  "isTokenAutoRefreshEnabled: true",
  "isLocalDevelopment"
]) {
  assert.ok(firebaseConfig.includes(appCheckToken), `Firebase App Check yapılandırması eksik: ${appCheckToken}`);
}
for (const source of [firebaseConfig, posts, admin]) {
  assert.ok(source.includes("www.gstatic.com/firebasejs/12.19.0/"), "Browser Firebase SDK sürümleri tek pinned sürüm değil");
}
const firebaseDefinition = readFileSync(resolve(root, "firebase.json"), "utf8");
assert.doesNotMatch(firebaseDefinition, /"database"\s*:/i, "Firebase CLI config içinde eski database bölümü kaldı");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
assert.equal(packageJson.scripts["test:rules"], "npm run test:rules:firestore", "Rules testi Firestore-only değil");
assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
  "test",
  "test:browser",
  "test:rules",
  "test:rules:firestore",
  "test:static",
  "test:utils"
].sort(), "Package içinde eski database/migration komutu kaldı");

const firestoreRules = readFileSync(resolve(root, "config/firestore.rules"), "utf8");
const firestoreIndexes = JSON.parse(readFileSync(resolve(root, "config/firestore.indexes.json"), "utf8"));
assert.ok(firestoreIndexes.indexes.some((index) => index.fields.some((field) => field.fieldPath === "legacySlugs" && field.arrayConfig === "CONTAINS")), "legacySlugs array-contains composite index'i eksik");
for (const rulesToken of [
  "rules_version = '2'",
  "allow get, list: if isAdmin() || isPublicPost(resource.data)",
  "function preservesLegacyRoutes()",
  "hasValidLegacySlugs(data)",
  "match /postSchedule/{postId}",
  "allow read, write: if false"
]) {
  assert.ok(firestoreRules.includes(rulesToken), `Firestore güvenlik kuralı eksik: ${rulesToken}`);
}
assert.ok(firestoreRules.includes("request.auth.token.admin == true"), "Firestore admin claim kuralı eksik");
assert.doesNotMatch(firestoreRules, /request\.auth\.token\.email|@icloud\.com|@gmail\.com/, "Firestore rules içinde hardcoded admin e-posta fallback'i kaldı");
const claimScript = readFileSync(resolve(root, "scripts/set-admin-claim.mjs"), "utf8");
for (const claimToken of ["applicationDefault()", "getUserByEmail", "setCustomUserClaims", "revokeRefreshTokens"]) {
  assert.ok(claimScript.includes(claimToken), `Admin claim script güvenlik kontrolü eksik: ${claimToken}`);
}
assert.doesNotMatch(claimScript, /service-account\.json|private_key|localStorage/i, "Admin claim script içinde secret/token saklama kalıbı var");
assert.ok(existsSync(resolve(root, "docs/security.md")), "Güvenlik dokümantasyonu eksik");
const migrationScript = readFileSync(resolve(root, "scripts/migrate-title-slugs.mjs"), "utf8");
for (const migrationToken of ["DRY RUN (yazma yok)", 'args.includes("--apply")', "legacySlugs", "uniqueTitleSlug", "batch.update"]) {
  assert.ok(migrationScript.includes(migrationToken), `Title slug migration güvenliği eksik: ${migrationToken}`);
}

const runtimeSources = [main, posts, admin];
for (const dangerousToken of [["insert", "AdjacentHTML"].join(""), ["document", ".write"].join(""), ["new", " Function"].join(""), ["eval", "("].join("")]) {
  assert.ok(runtimeSources.every((source) => !source.includes(dangerousToken)), `Tehlikeli DOM/JS API kullanımı kaldı: ${dangerousToken}`);
}
assert.ok(posts.includes("escapeHTML(post.content || \"\")"), "Post içeriği escape edilmeden DOM'a yazılıyor");
assert.ok(admin.includes("escapeHTML(post.title"), "Admin post başlığı escape edilmeden DOM'a yazılıyor");

for (const requiredWatermarkToken of [
  'const CANVAS_WATERMARK = Object.freeze({ opacity: .075, fontSize: 150 })',
  'ctx.fillText("hissez.com", 0, 0)',
  "drawCanvasWatermark(ctx, canvas)"
]) {
  assert.ok(posts.includes(requiredWatermarkToken), `Canvas filigran özelliği eksik: ${requiredWatermarkToken}`);
}
assert.ok(!posts.includes('id="canvasWatermark"'), "Filigran mod seçimi kaldırılmadı");
assert.ok(!posts.includes("CANVAS_WATERMARK_MODES"), "Eski çoklu filigran modları kaldırılmadı");

for (const requiredShareToken of [
  'data-detail-action="canvas-share">Paylaş',
  'id="canvasFormat"',
  'story: { width: 1080, height: 1920, maxLines: 18 }',
  "canvasToFile(canvas, filename)",
  "createPoemShareFiles(post, options",
  "sharePoemImage(post, readCanvasShareOptions())",
  'left.name.localeCompare(right.name, "tr", { numeric: true })',
  "await downloadFiles(orderedFiles)",
  "cleanPostUrl(post)",
  'text: `${post.title || "Hissez şiiri"} — Hissez\\n${shareUrl}`'
]) {
  assert.ok(posts.includes(requiredShareToken), `Şiir görseli paylaşım özelliği eksik: ${requiredShareToken}`);
}
assert.ok(!posts.includes('data-detail-action="canvas-share-target"'), "Eski uygulama bazlı paylaşım düğmeleri hâlâ mevcut");
assert.ok(!posts.includes('data-detail-action="canvas-download"'), "Ayrı görsel indirme düğmesi hâlâ mevcut");

assert.ok(postUtils.includes("export function storedPostSlug(post)"), "Stored slug doğrulayıcısı eksik");
assert.ok(postUtils.includes("export function slugifyTitle(value"), "Title slug üreticisi eksik");
assert.ok(postUtils.includes("export function uniqueTitleSlug(title"), "Deterministic duplicate slug üreticisi eksik");
assert.ok(postUtils.includes("export function postMatchesSlug(post"), "Legacy slug eşleştiricisi eksik");
assert.ok(postUtils.includes("export function cleanPostPath(post)"), "Ortak canonical yol yardımcısı eksik");
assert.ok(postUtils.includes('return slug && section ? `/${section}/${encodeURIComponent(slug)}` : ""'), "Canonical yol stored slug dışına düşüyor");
for (const titleRouteToken of ["function publicSlugSource(post)", "function publicTitleSlugMap(posts", "function publicPostPath(post", 'replace(/^her\\s+şey\\b/iu, "Hersey")']) {
  assert.ok(posts.includes(titleRouteToken), `Başlık/ilk dize tabanlı public URL eksik: ${titleRouteToken}`);
}
for (const cleanUrlToken of [
  'location.pathname.match(/^\\/(siir|gun-notu)',
  "const canonicalPath = publicPostPath(post);",
  "currentPath !== canonicalPath",
  'history.replaceState(null, "", canonicalPath);',
  'const canonical = cleanPostUrl(post)'
]) {
  assert.ok(posts.includes(cleanUrlToken), `Temiz yazı adresi özelliği eksik: ${cleanUrlToken}`);
}
for (const rewrite of ["/siir/:slug", "/gun-notu/:slug"]) {
  assert.ok((vercel.rewrites || []).some((item) => item.source === rewrite && item.destination.includes("/yazi.html?slug=")), `Vercel temiz URL rewrite eksik: ${rewrite}`);
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
  "function renderCompactCard(post)",
  "function postFirstLine(post, max = 130)",
  "function featuredContentPreview(post, max = 520)",
  'class="featured-poem-text"',
  "related.map(renderCompactCard)",
  'href="/arsiv?category=',
  "posts.slice(0, 6)"
]) {
  assert.ok(posts.includes(requiredBlogToken), `Edebiyat blogu özelliği eksik: ${requiredBlogToken}`);
}

const index = readFileSync(resolve(root, "index.html"), "utf8");
assert.ok(index.includes('id="latestPosts"'), "Ana sayfa kronolojik yazı akışı eksik");
assert.ok(index.includes('id="categoryDiscovery"'), "Ana sayfa kategori keşfi eksik");
assert.ok(!index.includes("Yarım kalan sayfalar"), "Kaldırılan yarım kalan sayfalar alanı hâlâ mevcut");
assert.ok(!index.includes("author-mini-section"), "Kaldırılan ana sayfa yazar tanıtım alanı hâlâ mevcut");
assert.ok(index.includes('class="section personal-discovery" aria-label="Kişisel keşif alanı" hidden'), "Boş kişisel keşif alanı başlangıçta gizlenmiyor");
assert.ok(index.includes("https://www.instagram.com/hissezz"), "Ana sayfa Instagram bağlantısı eksik");
assert.ok(main.includes('class="footer-social-icon"') && main.includes('class="footer-social-icon pinterest-footer-icon"'), "Footer sosyal medya ikonları eksik");

const about = readFileSync(resolve(root, "hakkimda.html"), "utf8");
assert.ok(about.includes('class="instagram-fixed-icon"'), "Hakkımda Instagram logosu eksik");

const sitemap = readFileSync(resolve(root, "sitemap.xml"), "utf8");
for (const route of ["/", "/siirler", "/gun-notlari", "/arsiv", "/hakkimda"]) {
  assert.ok(sitemap.includes(`https://hissez.com${route}`), `Sitemap temiz URL eksik: ${route}`);
}
assert.doesNotMatch(sitemap, /https:\/\/hissez\.com\/[^<]*\.html/, "Sitemap kullanıcı-facing .html içeriyor");

const siteManifest = JSON.parse(readFileSync(resolve(root, "site.webmanifest"), "utf8"));
const panelManifest = JSON.parse(readFileSync(resolve(root, "panel.webmanifest"), "utf8"));
assert.equal(siteManifest.start_url, "/", "Site manifest start_url clean değil");
assert.equal(panelManifest.start_url, "/sezin-panel", "Panel manifest start_url clean değil");
assert.ok(vercel.redirects?.some((item) => item.source === "/index.html" && item.destination === "/" && item.permanent), "index.html legacy redirect eksik");
for (const route of ["/siirler", "/gun-notlari", "/arsiv", "/hakkimda", "/sezin-panel"]) {
  assert.ok(vercel.rewrites?.some((item) => item.source === route), `Clean route rewrite eksik: ${route}`);
}
for (const legacy of ["/siirler.html", "/gun-notlari.html", "/arsiv.html", "/hakkimda.html", "/sezin-panel.html"]) {
  assert.ok(vercel.redirects?.some((item) => item.source === legacy && item.permanent), `Legacy redirect eksik: ${legacy}`);
}
assert.ok(vercel.headers.some((item) => item.source === "/sezin-panel"), "Clean panel noindex header eksik");
assert.ok(vercel.headers.some((item) => item.source === "/sezin-panel.html"), "Legacy panel noindex header eksik");
const robots = readFileSync(resolve(root, "robots.txt"), "utf8");
assert.match(robots, /Disallow: \/sezin-panel(?:\.html)?/g, "Admin robots kuralları eksik");

const archivePage = readFileSync(resolve(root, "arsiv.html"), "utf8");
assert.ok(archivePage.includes('id="archiveOverview"'), "Arşiv yıl/ay ve kategori özeti eksik");
assert.ok(posts.includes("· ${minutes} dk okuma"), "Ortak blog kartlarında okuma süresi eksik");

console.log("Statik kontroller geçti: HTML/CSP, arşiv, keşif, arama, ilişkili yazılar, Canvas filigranı, çok sayfalı paylaşım ve PWA cache listesi.");
