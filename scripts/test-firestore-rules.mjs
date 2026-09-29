import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-hissez";
const rules = readFileSync(resolve(import.meta.dirname, "../config/firestore.rules"), "utf8");
const testEnvironment = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 8080,
    rules
  }
});

const now = Date.now();
const basePost = {
  title: "Kurallar Testi",
  slug: "kurallar-testi",
  content: "Geçerli ve herkese açık bir test içeriği.",
  type: "poem",
  category: "Şiir",
  status: "published",
  series: "",
  featured: false,
  excerpt: "Kısa açıklama",
  authorNote: "",
  date: "2026-09-29",
  createdAt: now,
  updatedAt: now
};

try {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "posts/published"), { ...basePost, legacySlugs: ["eski-kurallar-testi"] }),
      setDoc(doc(firestore, "posts/published-daily"), { ...basePost, slug: "gunluk-yazi", type: "daily" }),
      setDoc(doc(firestore, "posts/draft"), { ...basePost, slug: "taslak", status: "draft" }),
      setDoc(doc(firestore, "posts/scheduled-due"), {
        ...basePost,
        slug: "zamanlanmis-hazir",
        status: "scheduled",
        publishAt: now - 60_000
      }),
      setDoc(doc(firestore, "posts/scheduled-future"), {
        ...basePost,
        slug: "zamanlanmis-gelecek",
        status: "scheduled",
        publishAt: now + 3_600_000
      }),
      setDoc(doc(firestore, "postSchedule/scheduled-due"), { publishAt: now - 60_000, updatedAt: now }),
      setDoc(doc(firestore, "postSchedule/scheduled-future"), { publishAt: now + 3_600_000, updatedAt: now })
    ]);
  });

  const publicDb = testEnvironment.unauthenticatedContext().firestore();
  const adminDb = testEnvironment.authenticatedContext("admin-user", {
    admin: true,
    email: "admin@example.com"
  }).firestore();
  const authenticatedWithoutAdminDb = testEnvironment.authenticatedContext("user-without-admin", {
    email: "reader@example.com"
  }).firestore();

  await assertSucceeds(getDoc(doc(publicDb, "posts/published")));
  await assertFails(getDoc(doc(publicDb, "posts/draft")));
  await assertFails(getDoc(doc(publicDb, "posts/scheduled-future")));
  await assertSucceeds(getDoc(doc(publicDb, "posts/scheduled-due")));
  console.log("Firestore Rules: public tekil okumalar geçti.");

  await assertSucceeds(getDoc(doc(authenticatedWithoutAdminDb, "posts/published")));
  await assertFails(getDoc(doc(authenticatedWithoutAdminDb, "posts/draft")));
  await assertFails(getDoc(doc(authenticatedWithoutAdminDb, "posts/scheduled-future")));
  await assertFails(getDocs(collection(authenticatedWithoutAdminDb, "posts")));
  console.log("Firestore Rules: claim'siz authenticated kullanıcı kısıtlamaları geçti.");

  const publicPublishedQuery = query(collection(publicDb, "posts"), where("status", "==", "published"));
  await assertSucceeds(getDocs(publicPublishedQuery));
  const exactPoemQuery = query(
    collection(publicDb, "posts"),
    where("slug", "==", "kurallar-testi"),
    where("type", "==", "poem"),
    where("status", "==", "published"),
    limit(1)
  );
  const exactDailyQuery = query(
    collection(publicDb, "posts"),
    where("slug", "==", "gunluk-yazi"),
    where("type", "==", "daily"),
    where("status", "==", "published"),
    limit(1)
  );
  assert.equal((await assertSucceeds(getDocs(exactPoemQuery))).size, 1);
  assert.equal((await assertSucceeds(getDocs(exactDailyQuery))).size, 1);
  const legacyPoemQuery = query(
    collection(publicDb, "posts"),
    where("legacySlugs", "array-contains", "eski-kurallar-testi"),
    where("type", "==", "poem"),
    where("status", "==", "published"),
    limit(1)
  );
  assert.equal((await assertSucceeds(getDocs(legacyPoemQuery))).size, 1);
  console.log("Firestore Rules: published query geçti.");
  assert.equal((await assertSucceeds(getDocs(collection(publicDb, "postSchedule")))).size, 2);
  console.log("Firestore Rules: güvenli schedule metadata query geçti.");
  await assertFails(getDocs(collection(publicDb, "posts")));

  await assertFails(setDoc(doc(publicDb, "posts/public-create"), { ...basePost, slug: "public-create" }));
  await assertFails(updateDoc(doc(publicDb, "posts/published"), { title: "Yetkisiz güncelleme" }));
  await assertFails(deleteDoc(doc(publicDb, "posts/published")));
  await assertFails(setDoc(doc(publicDb, "postSchedule/public-write"), { publishAt: now, updatedAt: now }));

  await assertFails(setDoc(doc(authenticatedWithoutAdminDb, "posts/claimless-create"), { ...basePost, slug: "claimless-create" }));
  await assertFails(updateDoc(doc(authenticatedWithoutAdminDb, "posts/published"), { title: "Claim'siz güncelleme" }));
  await assertFails(deleteDoc(doc(authenticatedWithoutAdminDb, "posts/published")));
  await assertFails(setDoc(doc(authenticatedWithoutAdminDb, "postSchedule/claimless-write"), { publishAt: now, updatedAt: now }));

  assert.equal((await assertSucceeds(getDocs(collection(adminDb, "posts")))).size, 5);
  await assertSucceeds(getDoc(doc(adminDb, "posts/draft")));
  await assertSucceeds(getDoc(doc(adminDb, "posts/scheduled-future")));
  await assertSucceeds(setDoc(doc(adminDb, "posts/admin-create"), { ...basePost, slug: "admin-create" }));
  await assertSucceeds(updateDoc(doc(adminDb, "posts/admin-create"), { title: "Admin Güncelleme", updatedAt: now + 1 }));
  await assertFails(updateDoc(doc(adminDb, "posts/admin-create"), { slug: "degistirilemez", updatedAt: now + 2 }));
  await assertSucceeds(updateDoc(doc(adminDb, "posts/admin-create"), {
    title: "Başlıktan Yeni Slug",
    slug: "basliktan-yeni-slug",
    legacySlugs: ["admin-create"],
    updatedAt: now + 2
  }));
  await assertSucceeds(deleteDoc(doc(adminDb, "posts/admin-create")));
  await assertSucceeds(setDoc(doc(adminDb, "postSchedule/admin-schedule"), { publishAt: now + 60_000, updatedAt: now }));
  await assertSucceeds(deleteDoc(doc(adminDb, "postSchedule/admin-schedule")));

  await assertFails(setDoc(doc(adminDb, "posts/empty-title"), { ...basePost, slug: "empty-title", title: "" }));
  await assertFails(setDoc(doc(adminDb, "posts/long-title"), { ...basePost, slug: "long-title", title: "x".repeat(121) }));
  await assertFails(setDoc(doc(adminDb, "posts/invalid-type"), { ...basePost, slug: "invalid-type", type: "essay" }));
  await assertFails(setDoc(doc(adminDb, "posts/invalid-status"), { ...basePost, slug: "invalid-status", status: "hidden" }));
  await assertFails(setDoc(doc(adminDb, "posts/invalid-slug"), { ...basePost, slug: "Geçersiz Slug" }));
  await assertFails(setDoc(doc(adminDb, "posts/invalid-legacy-type"), { ...basePost, slug: "invalid-legacy-type", legacySlugs: "eski-slug" }));
  await assertFails(setDoc(doc(adminDb, "posts/invalid-legacy-slug"), { ...basePost, slug: "invalid-legacy-slug", legacySlugs: ["Geçersiz Slug"] }));
  await assertFails(setDoc(doc(adminDb, "posts/duplicate-legacy-slug"), { ...basePost, slug: "duplicate-legacy-slug", legacySlugs: ["eski-slug", "eski-slug"] }));
  await assertFails(setDoc(doc(adminDb, "posts/current-in-legacy"), { ...basePost, slug: "current-in-legacy", legacySlugs: ["current-in-legacy"] }));
  await assertFails(setDoc(doc(adminDb, "posts/too-many-legacy"), {
    ...basePost,
    slug: "too-many-legacy",
    legacySlugs: Array.from({ length: 11 }, (_, index) => `eski-${index + 1}`)
  }));
  await assertFails(setDoc(doc(adminDb, "posts/missing-publish-at"), { ...basePost, slug: "missing-publish-at", status: "scheduled" }));
  await assertFails(setDoc(doc(adminDb, "posts/unknown-field"), { ...basePost, slug: "unknown-field", unsafe: true }));

  console.log("Firestore Rules testleri geçti: public yayınlar, güvenli zamanlama, admin CRUD ve alan doğrulamaları.");
} finally {
  await testEnvironment.cleanup();
}
