import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pathToFileURL } from "node:url";
import {
  MAX_LEGACY_SLUGS,
  isValidPostSlug,
  legacyPostSlugs,
  storedPostSlug,
  uniqueTitleSlug
} from "../assets/js/post-utils.js";

function routeSlugs(post) {
  return [storedPostSlug(post), ...legacyPostSlugs(post)].filter(Boolean);
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function buildTitleSlugMigrationPlan(documents) {
  const posts = documents
    .map(({ id, data }) => ({ id, data: data || {} }))
    .sort((left, right) => {
      const time = Number(left.data.createdAt || left.data.updatedAt) - Number(right.data.createdAt || right.data.updatedAt);
      return time || left.id.localeCompare(right.id, "tr");
    });

  const owners = new Map();
  posts.forEach((post) => {
    routeSlugs(post.data).forEach((slug) => {
      if (!owners.has(slug)) owners.set(slug, new Set());
      owners.get(slug).add(post.id);
    });
  });

  const conflicts = [...owners.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([slug, ids]) => `"${slug}" birden fazla post tarafından kullanılıyor: ${[...ids].join(", ")}`);
  const assignedSlugs = new Map();
  const plan = posts.map((post) => {
    const reserved = [];
    owners.forEach((ids, slug) => {
      if ([...ids].some((id) => id !== post.id)) reserved.push(slug);
    });
    assignedSlugs.forEach((slug, id) => {
      if (id !== post.id) reserved.push(slug);
    });

    const oldSlug = storedPostSlug(post.data);
    const newSlug = uniqueTitleSlug(post.data.title, reserved);
    const legacySlugs = legacyPostSlugs(post.data).filter((slug) => slug !== newSlug);
    if (oldSlug && oldSlug !== newSlug && !legacySlugs.includes(oldSlug)) legacySlugs.push(oldSlug);
    if (legacySlugs.length > MAX_LEGACY_SLUGS) {
      conflicts.push(`${post.id} için legacySlugs sayısı ${MAX_LEGACY_SLUGS} sınırını aşıyor.`);
    }
    assignedSlugs.set(post.id, newSlug);

    const rawLegacySlugs = Array.isArray(post.data.legacySlugs) ? post.data.legacySlugs : [];
    const changed = oldSlug !== newSlug
      || (Array.isArray(post.data.legacySlugs) && !sameStringArray(rawLegacySlugs, legacySlugs));
    return {
      id: post.id,
      title: String(post.data.title || ""),
      oldSlug: oldSlug || "(geçersiz/yok)",
      newSlug,
      legacySlugs,
      changed
    };
  });

  const finalOwners = new Map();
  plan.forEach((entry) => {
    [entry.newSlug, ...entry.legacySlugs].filter(isValidPostSlug).forEach((slug) => {
      if (!finalOwners.has(slug)) finalOwners.set(slug, new Set());
      finalOwners.get(slug).add(entry.id);
    });
  });
  finalOwners.forEach((ids, slug) => {
    if (ids.size > 1) conflicts.push(`Plan sonrası "${slug}" çakışıyor: ${[...ids].join(", ")}`);
  });

  return { plan, conflicts: [...new Set(conflicts)] };
}

async function applyPlan(firestore, plan) {
  const changes = plan.filter((entry) => entry.changed);
  for (let offset = 0; offset < changes.length; offset += 400) {
    const batch = firestore.batch();
    changes.slice(offset, offset + 400).forEach((entry) => {
      batch.update(firestore.collection("posts").doc(entry.id), {
        slug: entry.newSlug,
        legacySlugs: entry.legacySlugs
      });
    });
    await batch.commit();
  }
  return changes.length;
}

async function main() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== "--apply");
  if (unknownArgs.length) throw new Error(`Bilinmeyen argüman: ${unknownArgs.join(", ")}`);

  const apply = args.includes("--apply");
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "hissez";
  const adminApp = initializeApp({ credential: applicationDefault(), projectId }, `title-slug-migration-${Date.now()}`);

  try {
    const firestore = getFirestore(adminApp);
    const snapshot = await firestore.collection("posts").get();
    const documents = snapshot.docs.map((document) => ({ id: document.id, data: document.data() }));
    const { plan, conflicts } = buildTitleSlugMigrationPlan(documents);

    console.log(`Proje: ${projectId}`);
    console.log(`Mod: ${apply ? "APPLY" : "DRY RUN (yazma yok)"}`);
    plan.forEach((entry) => {
      console.log(`\nPOST ID: ${entry.id}`);
      console.log(`TITLE: ${entry.title}`);
      console.log(`OLD SLUG: ${entry.oldSlug}`);
      console.log(`NEW SLUG: ${entry.newSlug}${entry.changed ? "" : " (değişmeyecek)"}`);
      if (entry.legacySlugs.length) console.log(`LEGACY SLUGS: ${entry.legacySlugs.join(", ")}`);
    });

    if (conflicts.length) {
      console.error("\nMigration uygulanamaz; çakışmalar:");
      conflicts.forEach((conflict) => console.error(`- ${conflict}`));
      process.exitCode = 1;
      return;
    }

    const changedCount = plan.filter((entry) => entry.changed).length;
    if (!apply) {
      console.log(`\nDRY RUN tamamlandı. ${changedCount} belge değişecekti; production'a hiçbir yazma yapılmadı.`);
      return;
    }

    const appliedCount = await applyPlan(firestore, plan);
    console.log(`\nMigration tamamlandı. ${appliedCount} belgenin yalnızca slug ve legacySlugs alanları güncellendi.`);
  } finally {
    await deleteApp(adminApp);
  }
}

const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Slug migration çalıştırılamadı:", error?.message || error);
    process.exitCode = 1;
  });
}
