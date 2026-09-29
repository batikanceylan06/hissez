import { isDeepStrictEqual } from "node:util";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 400;
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://hissez-default-rtdb.firebaseio.com";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "hissez";
const REQUIRED_FIELDS = ["title", "slug", "content", "type", "status", "date", "createdAt", "updatedAt"];
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "category",
  "publishAt",
  "series",
  "featured",
  "excerpt",
  "authorNote"
]);
let adminApp = null;

function cleanUndefined(value) {
  if (Array.isArray(value)) return value.map(cleanUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, cleanUndefined(child)])
  );
}

function validatePost(id, post) {
  const errors = [];
  if (!post || typeof post !== "object" || Array.isArray(post)) return ["post object değil"];
  const has = (field) => Object.prototype.hasOwnProperty.call(post, field);
  const validString = (field, max, required = false) => {
    if (!has(field)) {
      if (required) errors.push(`${field} eksik`);
      return;
    }
    if (typeof post[field] !== "string" || (required && !post[field].length) || post[field].length > max) {
      errors.push(`${field} geçersiz`);
    }
  };

  if (!id || id.includes("/")) errors.push("document ID geçersiz");
  for (const field of REQUIRED_FIELDS) {
    if (!has(field)) errors.push(`${field} eksik`);
  }
  for (const field of Object.keys(post)) {
    if (!ALLOWED_FIELDS.has(field)) errors.push(`beklenmeyen alan: ${field}`);
  }

  validString("title", 120, true);
  validString("slug", 180, true);
  validString("content", 100000, true);
  validString("category", 50);
  validString("series", 80);
  validString("authorNote", 1000);
  validString("excerpt", 220);

  if (typeof post.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(post.slug)) errors.push("slug formatı geçersiz");
  if (!['poem', 'daily'].includes(post.type)) errors.push("type geçersiz");
  if (!['published', 'draft', 'scheduled'].includes(post.status)) errors.push("status geçersiz");
  if (has("featured") && typeof post.featured !== "boolean") errors.push("featured geçersiz");
  if (typeof post.date !== "string" || !/^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(post.date)) errors.push("date geçersiz");
  for (const field of ["createdAt", "updatedAt"]) {
    if (!Number.isFinite(post[field]) || post[field] <= 0) errors.push(`${field} geçersiz`);
  }
  if (post.status === "scheduled") {
    if (!Number.isFinite(post.publishAt) || post.publishAt <= 0) errors.push("scheduled publishAt geçersiz");
  } else if (has("publishAt") && post.publishAt !== null) {
    errors.push("published/draft publishAt null veya eksik olmalı");
  }

  return [...new Set(errors)];
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function main() {
  const usingEmulators = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !usingEmulators) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS ayarlı değil. Service account anahtarını environment variable ile belirt.");
  }

  const appOptions = {
    databaseURL: DATABASE_URL,
    projectId: PROJECT_ID
  };
  if (!usingEmulators) appOptions.credential = applicationDefault();
  adminApp = initializeApp(appOptions);
  const rtdb = getDatabase(adminApp);
  const firestore = getFirestore(adminApp);
  const sourceSnapshot = await rtdb.ref("posts").get();
  const sourcePosts = sourceSnapshot.val() || {};
  const entries = Object.entries(sourcePosts).map(([id, post]) => [id, cleanUndefined(post)]);
  const validEntries = [];
  const invalidEntries = [];

  for (const [id, post] of entries) {
    const errors = validatePost(id, post);
    if (errors.length) invalidEntries.push({ id, errors });
    else validEntries.push([id, post]);
  }

  const existing = new Map();
  const existingSchedules = new Map();
  for (const group of chunks(validEntries, BATCH_SIZE)) {
    const snapshots = await firestore.getAll(...group.map(([id]) => firestore.collection("posts").doc(id)));
    snapshots.forEach((snapshot) => {
      if (snapshot.exists) existing.set(snapshot.id, snapshot.data());
    });
    const scheduleSnapshots = await firestore.getAll(...group.map(([id]) => firestore.collection("postSchedule").doc(id)));
    scheduleSnapshots.forEach((snapshot) => {
      if (snapshot.exists) existingSchedules.set(snapshot.id, snapshot.data());
    });
  }

  const pending = validEntries.filter(([id, post]) => !isDeepStrictEqual(existing.get(id), post));
  const scheduleChanges = validEntries.flatMap(([id, post]) => {
    const desired = post.status === "scheduled" ? { publishAt: post.publishAt, updatedAt: post.updatedAt } : null;
    const current = existingSchedules.get(id);
    if (desired && !isDeepStrictEqual(current, desired)) return [{ action: "set", id, data: desired }];
    if (!desired && current) return [{ action: "delete", id }];
    return [];
  });
  const unchanged = validEntries.length - pending.length;

  console.log(`MODE: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`RTDB POSTS FOUND: ${entries.length}`);
  console.log(`VALID: ${validEntries.length}`);
  console.log(`INVALID: ${invalidEntries.length}`);
  console.log(`UNCHANGED: ${unchanged}`);
  console.log(`TO MIGRATE: ${pending.length}`);
  console.log(`SCHEDULE INDEX CHANGES: ${scheduleChanges.length}`);
  invalidEntries.forEach(({ id, errors }) => console.error(`INVALID ${id}: ${errors.join(", ")}`));

  if (APPLY && invalidEntries.length) {
    throw new Error(`Geçersiz ${invalidEntries.length} kayıt bulundu. Güvenli kısmi migration engellendi; Firestore'a hiçbir veri yazılmadı.`);
  }

  if (!APPLY) {
    console.log("DRY RUN tamamlandı. Firestore'a hiçbir veri yazılmadı.");
    return;
  }

  let applied = 0;
  for (const group of chunks(pending, BATCH_SIZE)) {
    const batch = firestore.batch();
    group.forEach(([id, post]) => batch.set(firestore.collection("posts").doc(id), post));
    try {
      await batch.commit();
      applied += group.length;
    } catch (error) {
      console.error(`BATCH FAILED IDS: ${group.map(([id]) => id).join(", ")}`);
      throw error;
    }
  }

  let scheduleApplied = 0;
  for (const group of chunks(scheduleChanges, BATCH_SIZE)) {
    const batch = firestore.batch();
    group.forEach((change) => {
      const scheduleRef = firestore.collection("postSchedule").doc(change.id);
      if (change.action === "set") batch.set(scheduleRef, change.data);
      else batch.delete(scheduleRef);
    });
    try {
      await batch.commit();
      scheduleApplied += group.length;
    } catch (error) {
      console.error(`SCHEDULE BATCH FAILED IDS: ${group.map(({ id }) => id).join(", ")}`);
      throw error;
    }
  }

  console.log(`MIGRATED: ${applied}`);
  console.log(`SCHEDULE INDEX APPLIED: ${scheduleApplied}`);
  console.log("RTDB kayıtları korunmuştur; kaynak veriden hiçbir şey silinmedi.");
}

main()
  .catch((error) => {
    console.error(`Migration başarısız: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (adminApp) await deleteApp(adminApp);
  });
