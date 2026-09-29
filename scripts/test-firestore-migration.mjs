import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "demo-hissez";
const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
const app = initializeApp({ projectId, databaseURL }, "migration-test");
const rtdb = getDatabase(app);
const firestore = getFirestore(app);
const now = Date.now();
const sourcePosts = {
  "-migration-published": {
    title: "Migration Published",
    slug: "migration-published",
    content: "Published migration test content.",
    type: "poem",
    category: "Şiir",
    status: "published",
    series: "",
    featured: true,
    excerpt: "Test",
    authorNote: "",
    date: "2026-09-29",
    createdAt: now - 2_000,
    updatedAt: now - 1_000
  },
  "-migration-scheduled": {
    title: "Migration Scheduled",
    slug: "migration-scheduled",
    content: "Scheduled migration test content.",
    type: "daily",
    category: "Gün Notu",
    status: "scheduled",
    publishAt: now + 3_600_000,
    series: "Test Dizisi",
    featured: false,
    excerpt: "Test",
    authorNote: "Not",
    date: "2026-09-30",
    createdAt: now - 2_000,
    updatedAt: now - 1_000
  }
};

function runScript(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, script), ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: projectId,
      FIREBASE_DATABASE_URL: databaseURL
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${script} başarısız:\n${result.stdout}\n${result.stderr}`);
  return `${result.stdout}\n${result.stderr}`;
}

function runScriptExpectFailure(script, args = []) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, script), ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: projectId,
      FIREBASE_DATABASE_URL: databaseURL
    },
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0, `${script} beklenmedik biçimde başarılı oldu`);
  return `${result.stdout}\n${result.stderr}`;
}

try {
  await rtdb.ref("posts").set(sourcePosts);

  const dryRunOutput = runScript("migrate-rtdb-to-firestore.mjs");
  assert.match(dryRunOutput, /MODE: DRY RUN/);
  assert.match(dryRunOutput, /TO MIGRATE: 2/);
  assert.equal((await firestore.collection("posts").get()).size, 0, "Dry run Firestore'a yazdı");

  const applyOutput = runScript("migrate-rtdb-to-firestore.mjs", ["--apply"]);
  assert.match(applyOutput, /MIGRATED: 2/);
  const migrated = await firestore.collection("posts").get();
  assert.deepEqual(migrated.docs.map((snapshot) => snapshot.id).sort(), Object.keys(sourcePosts).sort());
  assert.equal(typeof migrated.docs[0].data().createdAt, "number");
  assert.equal((await firestore.collection("postSchedule").get()).size, 1);

  const repeatOutput = runScript("migrate-rtdb-to-firestore.mjs", ["--apply"]);
  assert.match(repeatOutput, /TO MIGRATE: 0/);
  assert.match(repeatOutput, /SCHEDULE INDEX CHANGES: 0/);

  const verifyOutput = runScript("verify-firestore-migration.mjs");
  assert.match(verifyOutput, /MATCHED: 2/);
  assert.match(verifyOutput, /MISMATCHED: 0/);
  assert.match(verifyOutput, /MISSING: 0/);
  assert.match(verifyOutput, /SCHEDULE INDEX MISMATCHED: 0/);

  await rtdb.ref("posts/-migration-invalid").set({ title: "Eksik alanlı kayıt" });
  const beforeBlockedApply = await firestore.collection("posts").get();
  const blockedApplyOutput = runScriptExpectFailure("migrate-rtdb-to-firestore.mjs", ["--apply"]);
  assert.match(blockedApplyOutput, /Güvenli kısmi migration engellendi/);
  assert.equal((await firestore.collection("posts").get()).size, beforeBlockedApply.size, "Geçersiz kayıt varken apply yazım yaptı");

  console.log("Firestore migration testi geçti: dry run, apply, ID koruma, idempotence, verification ve geçersiz kayıtta atomik duruş.");
} finally {
  await deleteApp(app);
}
