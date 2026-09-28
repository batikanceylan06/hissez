import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const htmlFiles = ["index.html", "siirler.html", "gun-notlari.html", "yazi.html", "hakkimda.html", "sezin-panel.html"];
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

console.log("Statik kontroller geçti: HTML kimlikleri/yolları, target güvenliği, CSP hashleri, panel alanları ve PWA cache listesi.");
