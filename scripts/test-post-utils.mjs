import assert from "node:assert/strict";
import {
  meaningfulCategory,
  normalizeComparable,
  isPublicPost,
  slugifyTitle,
  uniqueTitleSlug,
  storedPostSlug,
  legacyPostSlugs,
  postMatchesSlug,
  cleanPostPath,
  readingMinutes,
  uniqueCategories,
  categoryCounts,
  filterPosts,
  buildArchive,
  adjacentPosts,
  seriesContext,
  relatedPosts,
  firstMeaningfulStanza
} from "../assets/js/post-utils.js";
import { buildTitleSlugMigrationPlan } from "./migrate-title-slugs.mjs";

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
assert.deepEqual(categoryCounts([...posts, { id: "p4", type: "daily", category: "Mektuplar" }]), [
  { key: "mektuplar", label: "Mektuplar", count: 2 }
]);

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
assert.deepEqual(relatedPosts(posts, posts[0]).map((post) => post.id), ["p2", "p3"]);

const now = 1_000;
assert.equal(isPublicPost({ status: "published" }, now), true);
assert.equal(isPublicPost({ status: "scheduled", publishAt: 999 }, now), true);
assert.equal(isPublicPost({ status: "scheduled", publishAt: 1001 }, now), false);
assert.equal(isPublicPost({ status: "draft" }, now), false);

assert.equal(readingMinutes("tek iki üç"), 1);
assert.equal(readingMinutes(Array(201).fill("kelime").join(" ")), 2);
assert.equal(firstMeaningfulStanza("\n\nİlk kıta\niki satır\n\nİkinci kıta"), "İlk kıta\niki satır");

assert.equal(slugifyTitle("His Senfoni"), "his-senfoni");
assert.equal(slugifyTitle("  Çünkü Sen... "), "cunku-sen");
assert.equal(slugifyTitle("Bir Yaz Gecesi!"), "bir-yaz-gecesi");
assert.equal(slugifyTitle("Aşk & Hayat"), "ask-hayat");
assert.equal(uniqueTitleSlug("His Senfoni", []), "his-senfoni");
assert.equal(uniqueTitleSlug("His Senfoni", ["his-senfoni"]), "his-senfoni-2");
assert.equal(uniqueTitleSlug("His Senfoni", ["his-senfoni", "his-senfoni-2"]), "his-senfoni-3");

const canonicalPoem = { title: "His Senfoni", slug: "his-senfoni", type: "poem", legacySlugs: ["his-mr8g1zwe"] };
assert.equal(storedPostSlug(canonicalPoem), "his-senfoni");
assert.deepEqual(legacyPostSlugs(canonicalPoem), ["his-mr8g1zwe"]);
assert.equal(cleanPostPath(canonicalPoem), "/siir/his-senfoni");
assert.equal(postMatchesSlug(canonicalPoem, "his-senfoni"), true);
assert.equal(postMatchesSlug(canonicalPoem, "his-mr8g1zwe"), true);
assert.equal(postMatchesSlug(canonicalPoem, "baska-slug"), false);
assert.equal(cleanPostPath({ title: "Başlıktan slug üretme", type: "poem" }), "");
assert.equal(cleanPostPath({ slug: "gun-notu-1", type: "daily" }), "/gun-notu/gun-notu-1");
assert.equal(cleanPostPath({ slug: "Geçersiz Slug", type: "poem" }), "");

const migration = buildTitleSlugMigrationPlan([
  { id: "a", data: { title: "His Senfoni", slug: "his-mr8g1zwe", type: "poem", createdAt: 1 } },
  { id: "b", data: { title: "His Senfoni", slug: "his-legacy-two", type: "poem", createdAt: 2 } }
]);
assert.deepEqual(migration.conflicts, []);
assert.equal(migration.plan[0].newSlug, "his-senfoni");
assert.equal(migration.plan[1].newSlug, "his-senfoni-2");
assert.deepEqual(migration.plan[0].legacySlugs, ["his-mr8g1zwe"]);
assert.deepEqual(migration.plan[1].legacySlugs, ["his-legacy-two"]);

console.log("Gönderi yardımcıları testleri geçti: title slug, deterministic duplicate, legacy URL, migration planı, kategori, arama, arşiv ve zamanlama.");
