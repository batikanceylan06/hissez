import assert from "node:assert/strict";
import {
  meaningfulCategory,
  normalizeComparable,
  isPublicPost,
  readingMinutes,
  uniqueCategories,
  filterPosts,
  buildArchive,
  adjacentPosts,
  seriesContext,
  firstMeaningfulStanza
} from "../assets/js/post-utils.js";

const posts = [
  { id: "p1", type: "poem", title: "İçimde Bahar", content: "Bir şiir", category: " ŞİİR ", date: "2024-03-10", createdAt: 100, status: "published", series: "Mevsimler" },
  { id: "p2", type: "poem", title: "Kış Mektubu", content: "Sessiz geceler", category: "Mektuplar", date: "2025-12-02", createdAt: 200, status: "published", series: "mevsimler" },
  { id: "p3", type: "daily", title: "Bugün", content: "Çiçekler açtı", category: "Gün Notu", date: "2025-03-10", createdAt: 300, status: "published" }
];

assert.equal(normalizeComparable("  İÇ Döküş  "), "ic dokus");
assert.equal(meaningfulCategory(posts[0]), "");
assert.equal(meaningfulCategory(posts[2]), "");
assert.equal(meaningfulCategory(posts[1]), "Mektuplar");
assert.deepEqual(uniqueCategories(posts), [{ key: "mektuplar", label: "Mektuplar" }]);

assert.equal(filterPosts(posts, { query: "çiçek" }).map((post) => post.id).join(), "p3");
assert.equal(filterPosts(posts, { category: "mektuplar" }).map((post) => post.id).join(), "p2");
assert.equal(filterPosts(posts, { year: "2025", month: "12" }).map((post) => post.id).join(), "p2");
assert.equal(filterPosts(posts, { query: "sessiz", category: "MEKTUPLAR", year: "2025", month: "12" }).map((post) => post.id).join(), "p2");
assert.equal(filterPosts(posts, { favorites: true }, ["p1", "missing"]).map((post) => post.id).join(), "p1");

assert.deepEqual(buildArchive(posts), [
  { year: "2025", months: [{ month: "12", count: 1 }, { month: "03", count: 1 }] },
  { year: "2024", months: [{ month: "03", count: 1 }] }
]);

assert.equal(adjacentPosts(posts.filter((post) => post.type === "poem"), "p2").previous.id, "p1");
assert.equal(adjacentPosts(posts.filter((post) => post.type === "poem"), "p1").next.id, "p2");
const series = seriesContext(posts, posts[1]);
assert.equal(series.name, "mevsimler");
assert.equal(series.index, 2);
assert.equal(series.total, 2);

const now = 1_000;
assert.equal(isPublicPost({ status: "published" }, now), true);
assert.equal(isPublicPost({ status: "scheduled", publishAt: 999 }, now), true);
assert.equal(isPublicPost({ status: "scheduled", publishAt: 1001 }, now), false);
assert.equal(isPublicPost({ status: "draft" }, now), false);

assert.equal(readingMinutes("tek iki üç"), 1);
assert.equal(readingMinutes(Array(201).fill("kelime").join(" ")), 2);
assert.equal(firstMeaningfulStanza("\n\nİlk kıta\niki satır\n\nİkinci kıta"), "İlk kıta\niki satır");

console.log("Gönderi yardımcıları testleri geçti: kategori, arama, arşiv, favori, komşuluk, seri, zamanlama ve okuma süresi.");
