import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browserPath = process.env.HISSEZ_BROWSER || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.HISSEZ_TEST_URL || "http://127.0.0.1:4173";
const profileDir = await mkdtemp(join(tmpdir(), "hissez-browser-smoke-"));
const browser = spawn(browserPath, [
  "--headless=new", "--remote-debugging-port=0", "--remote-allow-origins=*",
  "--no-first-run", "--disable-default-apps", `--user-data-dir=${profileDir}`, "about:blank"
], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

function devtoolsUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome DevTools bağlantısı zaman aşımına uğradı.")), 10000);
    browser.stderr.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match[1]);
    });
    browser.once("exit", (code) => reject(new Error(`Chrome beklenmedik biçimde kapandı (${code}).`)));
  });
}

const socket = new WebSocket(await devtoolsUrl());
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let messageId = 0;
const pending = new Map();
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const handler = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});

function command(method, params = {}, sessionId) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(sessionId, expression) {
  const output = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (output.exceptionDetails) throw new Error(output.exceptionDetails.text || "Tarayıcı değerlendirme hatası");
  return output.result.value;
}

const pages = [
  ["ana sayfa", "/"],
  ["şiirler", "/siirler.html"],
  ["gün notları", "/gun-notlari.html"],
  ["arşiv", "/arsiv.html"],
  ["yazı", "/yazi.html?id=-OrVzB5mkert98jfT3Ix"],
  ["hakkımda", "/hakkimda.html"]
];

try {
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Page.enable", {}, sessionId);
  await command("Runtime.enable", {}, sessionId);

  for (const width of [320, 375, 390, 430]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
    for (const [name, path] of pages) {
      await command("Page.navigate", { url: `${baseUrl}${path}` }, sessionId);
      const metrics = await evaluate(sessionId, `new Promise((resolve) => setTimeout(() => resolve((() => {
        const root = document.documentElement;
        const clipped = [...document.querySelectorAll("body *")].filter((node) => {
          const style = getComputedStyle(node);
          if (node.closest('[aria-hidden="true"]')) return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
        }).slice(0, 8).map((node) => { const rect = node.getBoundingClientRect(), style = getComputedStyle(node); return { tag: node.tagName, className: String(node.className), box: [Math.round(rect.left), Math.round(rect.right)], display: style.display, visibility: style.visibility, position: style.position }; });
        return {
          width: innerWidth,
          scrollWidth: root.scrollWidth,
          clipped,
          h1: [...document.querySelectorAll("h1")].filter((node) => node.getClientRects().length).length,
          controls: document.querySelector("[data-menu-toggle]")?.getAttribute("aria-controls") || "",
          expanded: document.querySelector("[data-menu-toggle]")?.getAttribute("aria-expanded") || ""
        };
      })()), 1200))`);
      assert.equal(metrics.width, width, `${name}: viewport ${width}px uygulanmadı`);
      assert.ok(metrics.scrollWidth <= width, `${name}: ${width}px genişlikte yatay overflow (${metrics.scrollWidth}px), kırpılanlar: ${JSON.stringify(metrics.clipped)}`);
      assert.deepEqual(metrics.clipped, [], `${name}: ${width}px görünümde içerik kırpılıyor: ${JSON.stringify(metrics.clipped)}`);
      assert.equal(metrics.h1, 1, `${name}: görünür H1 sayısı yanlış`);
      assert.ok(metrics.controls, `${name}: mobil menü aria-controls eksik`);
      assert.equal(metrics.expanded, "false", `${name}: mobil menü başlangıç durumu yanlış`);
    }
  }

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, sessionId);
  await command("Page.navigate", { url: `${baseUrl}/` }, sessionId);
  const common = await evaluate(sessionId, `new Promise((resolve) => setTimeout(() => {
    const menu = document.querySelector("[data-menu-toggle]");
    menu.click();
    const menuOpened = document.body.classList.contains("menu-open") && menu.getAttribute("aria-expanded") === "true";
    menu.click();
    const themeBefore = document.documentElement.dataset.theme;
    document.getElementById("themeToggle").click();
    const themeChanged = document.documentElement.dataset.theme !== themeBefore;
    if (document.documentElement.dataset.theme !== "dark") document.getElementById("themeToggle").click();
    const cards = [...document.querySelectorAll("#latestPosts .compact-blog-card")];
    const featured = document.querySelector(".featured-post");
    const featuredPreview = featured?.querySelector(".featured-poem-text");
    resolve({
      menuOpened,
      themeChanged,
      darkBrandColor: getComputedStyle(document.querySelector(".brand-sez")).color,
      footerIcons: document.querySelectorAll(".footer-social .footer-social-icon").length,
      featuredPreview: Boolean(featuredPreview?.textContent.trim()),
      featuredKeepsLines: getComputedStyle(featuredPreview).whiteSpace === "pre-line",
      featuredHeight: Math.round(featured?.getBoundingClientRect().height || 0),
      compactCards: cards.length > 0 && cards.every((card) => card.querySelector(":scope > h3") && card.querySelector(":scope > p") && card.querySelector(":scope > .read-more") && !card.querySelector(".post-card-footer, .post-meta")),
      maxCardHeight: Math.max(0, ...cards.map((card) => Math.round(card.getBoundingClientRect().height))),
      emptyDiscoveryHidden: Boolean(document.querySelector(".personal-discovery[hidden]"))
    });
  }, 900))`);
  assert.ok(common.menuOpened && common.themeChanged, "Ortak menü/tema etkileşimi başarısız");
  assert.equal(common.darkBrandColor, "rgb(223, 90, 139)", "Koyu mod Hissez logosu pembe değil");
  assert.equal(common.footerIcons, 2, "Footer Instagram/Pinterest ikonları eksik");
  assert.ok(common.featuredPreview && common.featuredKeepsLines && common.featuredHeight < 620, `Öne çıkan şiir önizlemesi kartı gereksiz büyütüyor: ${JSON.stringify(common)}`);
  assert.ok(common.compactCards && common.maxCardHeight < 280, `Ana sayfa kartları kompakt değil: ${JSON.stringify(common)}`);
  assert.ok(common.emptyDiscoveryHidden, "İçeriği olmayan kişisel keşif alanı gereksiz boşluk bırakıyor");

  await command("Page.navigate", { url: `${baseUrl}/arsiv.html` }, sessionId);
  const archive = await evaluate(sessionId, `new Promise((resolve) => setTimeout(() => {
    const search = document.getElementById("postSearch");
    search.value = "his";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => {
      const statBoxes = [...document.querySelectorAll(".archive-stats > div")];
      resolve({
        sort: Boolean(document.getElementById("sortFilter")),
        type: Boolean(document.getElementById("typeListFilter")),
        active: document.querySelectorAll("#activeFilters button").length,
        stats: statBoxes.length,
        statsStyled: statBoxes.every((box) => getComputedStyle(box).display === "grid" && parseFloat(getComputedStyle(box).borderTopWidth) > 0),
        redundantClear: Boolean(document.querySelector('[data-list-action="clear-search"]'))
      });
    }, 260);
  }, 1100))`);
  assert.ok(archive.sort && archive.type && archive.active > 0 && archive.stats === 4 && archive.statsStyled && !archive.redundantClear, `Arşiv araçları başarısız: ${JSON.stringify(archive)}`);

  await command("Page.navigate", { url: `${baseUrl}/yazi.html?id=-OrVzB5mkert98jfT3Ix` }, sessionId);
  const detail = await evaluate(sessionId, `new Promise((resolve) => setTimeout(async () => {
    document.querySelector('[data-detail-action="share"]')?.click();
    const fallback = document.getElementById("shareFallback");
    const shareChoices = [...fallback?.querySelectorAll(":scope > button") || []];
    document.querySelector('[data-detail-action="canvas-open"]')?.click();
    await new Promise((done) => setTimeout(done, 180));
    const relatedCards = [...document.querySelectorAll(".related-post-grid .compact-blog-card")];
    const formats = [...document.querySelectorAll('[data-detail-action="canvas-share-format"]')].map((button) => button.dataset.format).sort();
    resolve({ progress: Boolean(document.querySelector(".reading-progress")), shareChoices: shareChoices.map((button) => button.textContent.trim()), duplicateInstagram: fallback?.textContent.includes("Instagram"), editablePoem: Boolean(document.getElementById("canvasExcerpt")), canvas: Boolean(document.getElementById("poemCanvasDialog")?.open), canvasWidth: document.getElementById("poemCanvas")?.width || 0, formats, relatedCompact: relatedCards.length > 0 && relatedCards.every((card) => card.getBoundingClientRect().height < 280) });
  }, 1200))`);
  assert.ok(detail.progress && detail.shareChoices.length === 2 && detail.shareChoices.some((value) => value.includes("Görsel")) && detail.shareChoices.some((value) => value.includes("Link")) && !detail.duplicateInstagram && !detail.editablePoem && detail.canvas && detail.canvasWidth === 1080 && JSON.stringify(detail.formats) === JSON.stringify(["post", "story"]) && detail.relatedCompact, `Detay/paylaşım/Canvas etkileşimi başarısız: ${JSON.stringify(detail)}`);

  await command("Page.navigate", { url: `${baseUrl}/siir/his-hersey-sende-gizli` }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const cleanRoute = await evaluate(sessionId, `({ path: location.pathname, page: document.body.dataset.page, title: document.querySelector("h1")?.textContent || "" })`);
  assert.deepEqual(cleanRoute, { path: "/siir/his-hersey-sende-gizli", page: "detail", title: "HİS" }, "Başlık tabanlı şiir URL'si açılmıyor");

  await command("Page.navigate", { url: `${baseUrl}/siir/his-mom6uqvr` }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const legacyPath = await evaluate(sessionId, "location.pathname");
  assert.equal(legacyPath, "/siir/his-hersey-sende-gizli", "Legacy şiir URL'si yeni canonical adrese çözülmüyor");

  const pwa = await evaluate(sessionId, `new Promise((resolve) => setTimeout(async () => resolve(Boolean(await navigator.serviceWorker.getRegistration())), 900))`);
  assert.ok(pwa, "Public PWA Service Worker kaydı bulunamadı");
  console.log("Browser smoke geçti: 6 public sayfa × 320/375/390/430 px, menü, tema, filtreler, paylaşım, Canvas ve PWA.");
} finally {
  socket.close();
  if (browser.exitCode === null) {
    const closed = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}
