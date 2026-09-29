import { isDeepStrictEqual } from "node:util";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://hissez-default-rtdb.firebaseio.com";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "hissez";
const COMPARED_FIELDS = [
  "title",
  "slug",
  "content",
  "type",
  "category",
  "status",
  "publishAt",
  "series",
  "featured",
  "excerpt",
  "authorNote",
  "date",
  "createdAt",
  "updatedAt"
];
let adminApp = null;

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

async function main() {
  const usingEmulators = Boolean(process.env.FIREBASE_DATABASE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !usingEmulators) {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS ayarlı değil. Verification için service account anahtarını environment variable ile belirt.");
  }

  const appOptions = {
    databaseURL: DATABASE_URL,
    projectId: PROJECT_ID
  };
  if (!usingEmulators) appOptions.credential = applicationDefault();
  adminApp = initializeApp(appOptions);
  const [rtdbSnapshot, firestoreSnapshot, scheduleSnapshot] = await Promise.all([
    getDatabase(adminApp).ref("posts").get(),
    getFirestore(adminApp).collection("posts").get(),
    getFirestore(adminApp).collection("postSchedule").get()
  ]);
  const rtdbPosts = rtdbSnapshot.val() || {};
  const firestorePosts = Object.fromEntries(firestoreSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  const firestoreSchedule = Object.fromEntries(scheduleSnapshot.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  let matched = 0;
  let mismatched = 0;
  let missing = 0;

  for (const [id, source] of Object.entries(rtdbPosts)) {
    const target = firestorePosts[id];
    if (!target) {
      missing += 1;
      console.error(`MISSING ${id}`);
      continue;
    }

    const differentFields = COMPARED_FIELDS.filter((field) => {
      if (has(source, field) !== has(target, field)) return true;
      return has(source, field) && !isDeepStrictEqual(source[field], target[field]);
    });
    if (differentFields.length) {
      mismatched += 1;
      console.error(`MISMATCHED ${id}: ${differentFields.join(", ")}`);
    } else {
      matched += 1;
    }
  }

  const extraIds = Object.keys(firestorePosts).filter((id) => !has(rtdbPosts, id));
  const expectedSchedule = Object.fromEntries(
    Object.entries(rtdbPosts)
      .filter(([, post]) => post.status === "scheduled")
      .map(([id, post]) => [id, { publishAt: post.publishAt, updatedAt: post.updatedAt }])
  );
  const scheduleMismatches = [...new Set([...Object.keys(expectedSchedule), ...Object.keys(firestoreSchedule)])]
    .filter((id) => !isDeepStrictEqual(expectedSchedule[id], firestoreSchedule[id]));
  extraIds.forEach((id) => console.error(`EXTRA FIRESTORE DOCUMENT ${id}`));
  scheduleMismatches.forEach((id) => console.error(`SCHEDULE INDEX MISMATCHED ${id}`));
  console.log(`RTDB POSTS: ${Object.keys(rtdbPosts).length}`);
  console.log(`FIRESTORE POSTS: ${Object.keys(firestorePosts).length}`);
  console.log(`MATCHED: ${matched}`);
  console.log(`MISMATCHED: ${mismatched}`);
  console.log(`MISSING: ${missing}`);
  console.log(`EXTRA: ${extraIds.length}`);
  console.log(`SCHEDULE INDEX MISMATCHED: ${scheduleMismatches.length}`);
  if (mismatched || missing || extraIds.length || scheduleMismatches.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`Verification başarısız: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (adminApp) await deleteApp(adminApp);
  });
