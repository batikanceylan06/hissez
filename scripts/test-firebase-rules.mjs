import assert from "node:assert/strict";

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT || "demo-hissez";
const databaseNamespace = `${projectId}-default-rtdb`;

if (!host || !authHost) throw new Error("Bu test Firebase Database ve Auth Emulator ile çalıştırılmalıdır.");

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function signInWithCustomClaims(uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const customToken = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({
    iss: "firebase-rules-test@example.com",
    sub: "firebase-rules-test@example.com",
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
    claims
  })}.`;
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Auth Emulator custom token hatası: ${JSON.stringify(result)}`);
  return result.idToken;
}

async function signUp(email) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Test-password-123", returnSecureToken: true })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Auth Emulator kullanıcı oluşturma hatası: ${JSON.stringify(result)}`);
  return result.idToken;
}

async function request(path, { method = "GET", token, body } = {}) {
  const queryParts = [`ns=${databaseNamespace}`];
  if (token) queryParts.push(`auth=${encodeURIComponent(token)}`);
  const response = await fetch(`http://${host}${path}${path.includes("?") ? "&" : "?"}${queryParts.join("&")}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}

const basePost = {
  title: "Kural Testi",
  slug: "kural-testi",
  content: "Güvenli test içeriği",
  type: "poem",
  category: "Şiir",
  featured: false,
  excerpt: "Test",
  series: "Kural Dizisi",
  authorNote: "Yazar notu",
  date: "2026-09-25",
  createdAt: Date.now(),
  updatedAt: Date.now()
};

const adminToken = await signInWithCustomClaims("admin-user", { admin: true });
const regularToken = await signUp("reader@example.com");
const legacyAdminToken = await signUp("batikanceylan06@gmail.com");

assert.equal((await request("/posts/published.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, status: "published" }
})).status, 200);

assert.equal((await request("/posts/draft.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "taslak", status: "draft" }
})).status, 200);

const testNow = Date.now();
const duePublishAt = testNow - 60_000;
const futurePublishAt = testNow + 60 * 60 * 1000;

assert.equal((await request("/posts/scheduled-due.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "zamanli-vadesi-geldi", status: "scheduled", publishAt: duePublishAt }
})).status, 200);

assert.equal((await request("/posts/scheduled-future.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "zamanli-gelecek", status: "scheduled", publishAt: futurePublishAt }
})).status, 200);

assert.equal((await request("/posts.json")).status, 401);
assert.equal((await request("/posts/draft.json")).status, 401);
assert.equal((await request("/posts/published.json")).status, 200);
assert.equal((await request("/posts/scheduled-due.json")).status, 200);
assert.equal((await request("/posts/scheduled-future.json")).status, 401);
assert.equal((await request("/posts.json", { token: regularToken })).status, 401);
assert.equal((await request("/posts.json", { token: adminToken })).status, 200);
assert.equal((await request("/posts.json", { token: legacyAdminToken })).status, 200);

const publicResult = await request('/posts.json?orderBy=%22status%22&equalTo=%22published%22');
assert.equal(publicResult.status, 200);
assert.deepEqual(Object.keys(publicResult.data || {}), ["published"]);

const currentMinute = Date.now() - (Date.now() % 60_000);
const scheduledResult = await request(`/posts.json?orderBy=%22publishAt%22&startAt=1&endAt=${currentMinute}`);
assert.equal(scheduledResult.status, 200);
assert.deepEqual(Object.keys(scheduledResult.data || {}), ["scheduled-due"]);

const missingLowerBound = await request(`/posts.json?orderBy=%22publishAt%22&endAt=${currentMinute}`);
assert.equal(missingLowerBound.status, 401);

const futureWindow = await request(`/posts.json?orderBy=%22publishAt%22&startAt=1&endAt=${Date.now() + 60_000}`);
assert.equal(futureWindow.status, 401);

const publicWrite = await request("/posts/public-write.json", {
  method: "PUT",
  body: { ...basePost, slug: "public-write", status: "published" }
});
assert.equal(publicWrite.status, 401);

assert.equal((await request("/posts/draft.json", {
  method: "PATCH",
  token: adminToken,
  body: { status: "published", updatedAt: Date.now() }
})).status, 200);
assert.equal((await request("/posts/scheduled-due.json", {
  method: "PATCH",
  token: adminToken,
  body: { status: "published", publishAt: null, updatedAt: Date.now() }
})).status, 200);
assert.equal((await request("/posts/draft.json", {
  method: "PATCH",
  token: adminToken,
  body: { status: "draft", updatedAt: Date.now() }
})).status, 200);
assert.equal((await request("/posts/published.json", {
  method: "PATCH",
  token: legacyAdminToken,
  body: { title: "Geçiş Hesabı Testi", updatedAt: Date.now() }
})).status, 200);

const invalidStatus = await request("/posts/invalid-status.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "gecersiz-durum", status: "hidden" }
});
assert.equal(invalidStatus.status, 401);

const scheduledWithoutDate = await request("/posts/invalid-scheduled.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "zamanlama-yok", status: "scheduled" }
});
assert.equal(scheduledWithoutDate.status, 401);

const publishedWithSchedule = await request("/posts/invalid-published.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "yayinda-zamanlama", status: "published", publishAt: futurePublishAt }
});
assert.equal(publishedWithSchedule.status, 401);

const longSeries = await request("/posts/invalid-series.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "uzun-dizi", status: "draft", series: "x".repeat(81) }
});
assert.equal(longSeries.status, 401);

const unexpectedField = await request("/posts/unexpected-field.json", {
  method: "PUT",
  token: adminToken,
  body: { ...basePost, slug: "fazla-alan", status: "draft", unsafe: true }
});
assert.equal(unexpectedField.status, 401);

console.log("Firebase Rules testleri geçti: public filtre, güvenli zamanlama, taslak gizliliği, admin claim, geçiş hesabı ve validation.");
