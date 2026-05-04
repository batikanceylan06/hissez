import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, onValue, off, push, set, update, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { app, adminEmails } from "./firebase-config.js";

const auth = getAuth(app);
const db = getDatabase(app);
const body = document.body;
const root = document.documentElement;
const THEME_KEY = "hissez-theme";

const loginScreen = document.getElementById("loginScreen");
const panelScreen = document.getElementById("panelScreen");
const loginForm = document.getElementById("loginForm");
const loginNotice = document.getElementById("loginNotice");
const forgotPasswordButton = document.getElementById("forgotPasswordButton");
const adminNotice = document.getElementById("adminNotice");
const userEmail = document.getElementById("userEmail");

const postForm = document.getElementById("postForm");
const editingId = document.getElementById("editingId");
const postTitle = document.getElementById("postTitle");
const postDate = document.getElementById("postDate");
const postType = document.getElementById("postType");
const postCategory = document.getElementById("postCategory");
const postStatus = document.getElementById("postStatus");
const postFeatured = document.getElementById("postFeatured");
const postExcerpt = document.getElementById("postExcerpt");
const postContent = document.getElementById("postContent");
const editorTitle = document.getElementById("editorTitle");
const adminPostsList = document.getElementById("adminPostsList");
const statusFilter = document.getElementById("statusFilter");
const typeFilter = document.getElementById("typeFilter");

let allPosts = [];
let postsRef = null;
let postsListenerStarted = false;

initAdminTheme();
cleanupPanelServiceWorker();
forceLoginOnly();


function setAdminTheme(theme) {
  root.dataset.theme = theme;
  body.dataset.theme = theme;
  body.classList.toggle("dark-mode", theme === "dark");
  body.classList.toggle("light-mode", theme !== "dark");
  localStorage.setItem(THEME_KEY, theme);

  document.querySelectorAll("[data-admin-theme-toggle]").forEach((button) => {
    button.textContent = theme === "dark" ? "☀️ Aydınlık Mod" : "🌙 Karanlık Mod";
    button.setAttribute("aria-pressed", String(theme === "dark"));
  });
}

function initAdminTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setAdminTheme(saved || (prefersDark ? "dark" : "light"));

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-admin-theme-toggle]")) return;
    setAdminTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });
}

async function cleanupPanelServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => {
      if (registration.active?.scriptURL.includes("panel-sw.js") || registration.installing?.scriptURL.includes("panel-sw.js") || registration.waiting?.scriptURL.includes("panel-sw.js")) {
        return registration.unregister();
      }
      return Promise.resolve();
    }));

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.includes("hissez-panel")).map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("Panel cache temizlenemedi:", error);
  }
}

function forceLoginOnly() {
  body.classList.remove("authenticated");
  body.classList.add("auth-ready");
  panelScreen.hidden = true;
  loginScreen.hidden = false;
}

function forcePanelOnly(user) {
  body.classList.add("auth-ready", "authenticated");
  loginScreen.hidden = true;
  panelScreen.hidden = false;
  userEmail.textContent = user.email;
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showNotice(target, type, message) {
  target.hidden = false;
  target.className = `notice ${type}`;
  target.textContent = message;
}

function clearNotice(target) {
  target.hidden = true;
  target.className = "notice";
  target.textContent = "";
}

function normalizeEmail(email = "") {
  return String(email).toLowerCase().trim();
}

function isAdminEmail(email = "") {
  const targetEmail = normalizeEmail(email);
  return adminEmails.map((item) => normalizeEmail(item)).includes(targetEmail);
}

function isAllowedUser(user) {
  if (!user || !user.email) return false;
  return isAdminEmail(user.email);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function slugify(value = "") {
  return value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-") || "yazi";
}

function getDateTime(post) {
  if (!post?.date) return 0;
  const date = new Date(`${post.date}T12:00:00`).getTime();
  return Number.isNaN(date) ? 0 : date;
}

function getSortTime(post) {
  // Panelde de public siteyle aynı mantık: son eklenen en üstte.
  return post.createdAt || post.updatedAt || getDateTime(post) || 0;
}

function formatDate(value) {
  if (!value) return "Tarihsiz";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(date);
}

function typeLabel(type) {
  return type === "daily" ? "Gün Notu" : "Şiir";
}

function statusLabel(status) {
  return status === "published" ? "Yayında" : "Taslak";
}

function resetForm() {
  editingId.value = "";
  postTitle.value = "";
  postDate.value = today();
  postType.value = "poem";
  postCategory.value = "";
  postStatus.value = "draft";
  postFeatured.checked = false;
  postExcerpt.value = "";
  postContent.value = "";
  editorTitle.textContent = "Yeni yazı";
}


async function ensureSingleFeatured(currentId = null) {
  const updates = {};
  allPosts.forEach((post) => {
    if (post.featured && post.id !== currentId) {
      updates[`posts/${post.id}/featured`] = false;
      post.featured = false;
    }
  });
  if (Object.keys(updates).length) {
    await update(ref(db), updates);
  }
}

function getFormPayload(statusOverride = null) {
  const title = postTitle.value.trim();
  const content = postContent.value.trim();
  const type = postType.value;
  const status = statusOverride || postStatus.value;

  if (!title) throw new Error("Başlık boş olamaz.");
  if (!content) throw new Error("İçerik boş olamaz.");
  if (!["poem", "daily"].includes(type)) throw new Error("Yazı türü geçersiz.");
  if (!["draft", "published"].includes(status)) throw new Error("Yayın durumu geçersiz.");

  const current = editingId.value ? allPosts.find((post) => post.id === editingId.value) : null;

  return {
    title,
    slug: current?.slug || `${slugify(title)}-${Date.now().toString(36)}`,
    content,
    type,
    category: postCategory.value.trim() || typeLabel(type),
    status,
    featured: postFeatured.checked,
    excerpt: postExcerpt.value.trim(),
    date: postDate.value || today(),
    updatedAt: Date.now()
  };
}


async function persistPost(payload, id = null) {
  const updates = {};
  const targetId = id || push(ref(db, "posts")).key;

  if (payload.featured) {
    allPosts.forEach((post) => {
      if (post.featured && post.id !== targetId) {
        updates[`posts/${post.id}/featured`] = false;
      }
    });
  }

  const current = id ? allPosts.find((post) => post.id === id) : null;
  const finalPayload = {
    ...payload,
    createdAt: current?.createdAt || Date.now()
  };

  updates[`posts/${targetId}`] = finalPayload;
  await update(ref(db), updates);
}

async function savePost(statusOverride = null) {
  clearNotice(adminNotice);

  if (!auth.currentUser || !isAllowedUser(auth.currentUser)) {
    showNotice(adminNotice, "error", "Oturum doğrulanamadı. Lütfen tekrar giriş yap.");
    await signOut(auth);
    return;
  }

  try {
    const payload = getFormPayload(statusOverride);
    const id = editingId.value;

    if (payload.featured) {
      await ensureSingleFeatured(id || null);
    }

    if (id) {
      const current = allPosts.find((post) => post.id === id);
      await update(ref(db, `posts/${id}`), {
        ...payload,
        createdAt: current?.createdAt || Date.now()
      });
      showNotice(adminNotice, "success", "Yazı başarıyla güncellendi.");
    } else {
      const newRef = push(ref(db, "posts"));
      await set(newRef, {
        ...payload,
        createdAt: Date.now()
      });
      showNotice(adminNotice, "success", payload.status === "published" ? "Yazı yayına alındı." : "Yazı taslak olarak kaydedildi.");
    }

    resetForm();
    document.getElementById("posts").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showNotice(adminNotice, "error", firebaseMessage(error, "Yazı kaydedilirken hata oluştu."));
    console.error(error);
  }
}

function fillForm(post) {
  editingId.value = post.id;
  postTitle.value = post.title || "";
  postDate.value = post.date || today();
  postType.value = post.type || "poem";
  postCategory.value = post.category || "";
  postStatus.value = post.status || "draft";
  postFeatured.checked = Boolean(post.featured);
  postExcerpt.value = post.excerpt || "";
  postContent.value = post.content || "";
  editorTitle.textContent = "Yazıyı düzenle";
  document.getElementById("editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function togglePublish(id) {
  const post = allPosts.find((item) => item.id === id);
  if (!post) return;

  const nextStatus = post.status === "published" ? "draft" : "published";

  try {
    await update(ref(db, `posts/${id}`), {
      status: nextStatus,
      updatedAt: Date.now()
    });
    showNotice(adminNotice, "success", nextStatus === "published" ? "Yazı yayına alındı." : "Yazı yayından kaldırıldı.");
  } catch (error) {
    showNotice(adminNotice, "error", firebaseMessage(error, "Durum güncellenirken hata oluştu."));
  }
}

async function deletePost(id) {
  const post = allPosts.find((item) => item.id === id);
  if (!post) return;

  const confirmed = confirm(`"${post.title || "Başlıksız yazı"}" silinsin mi? Bu işlem geri alınamaz.`);
  if (!confirmed) return;

  try {
    await remove(ref(db, `posts/${id}`));
    if (editingId.value === id) resetForm();
    showNotice(adminNotice, "success", "Yazı silindi.");
  } catch (error) {
    showNotice(adminNotice, "error", firebaseMessage(error, "Yazı silinirken hata oluştu."));
  }
}

function renderPosts() {
  const selectedStatus = statusFilter.value;
  const selectedType = typeFilter.value;

  const filtered = allPosts
    .filter((post) => selectedStatus === "all" || post.status === selectedStatus)
    .filter((post) => selectedType === "all" || post.type === selectedType);

  if (!filtered.length) {
    adminPostsList.innerHTML = `<div class="empty-state">Bu filtreye uygun yazı yok.</div>`;
    return;
  }

  adminPostsList.innerHTML = filtered.map((post) => {
    const publishText = post.status === "published" ? "Yayından Kaldır" : "Yayına Al";
    const publicLink = post.status === "published"
      ? `<a class="small-btn" href="yazi.html?id=${encodeURIComponent(post.id)}" target="_blank" rel="noopener">Görüntüle</a>`
      : "";

    return `
      <article class="admin-post-item">
        <div>
          <h3>${escapeHTML(post.title || "Başlıksız Yazı")}</h3>
          <div class="admin-post-meta">
            <span>${typeLabel(post.type)}</span>
            <span>${statusLabel(post.status)}</span>
            <span>${formatDate(post.date)}</span>
            ${post.featured ? "<span>Öne Çıkan</span>" : ""}
          </div>
        </div>
        <div class="admin-post-actions">
          ${publicLink}
          <button class="small-btn" type="button" data-action="edit" data-id="${post.id}">Düzenle</button>
          <button class="small-btn" type="button" data-action="publish" data-id="${post.id}">${publishText}</button>
          <button class="small-btn danger" type="button" data-action="delete" data-id="${post.id}">Sil</button>
        </div>
      </article>
    `;
  }).join("");
}

function stopWatchingPosts() {
  if (postsRef) {
    off(postsRef);
  }
  postsRef = null;
  postsListenerStarted = false;
  allPosts = [];
}

function watchPosts() {
  if (postsListenerStarted) return;

  postsRef = ref(db, "posts");
  postsListenerStarted = true;

  onValue(postsRef, (snapshot) => {
    allPosts = Object.entries(snapshot.val() || {})
      .map(([id, post]) => ({ id, ...post }))
      .sort((a, b) => getSortTime(b) - getSortTime(a));

    renderPosts();
  }, (error) => {
    showNotice(adminNotice, "error", firebaseMessage(error, "Yazılar yüklenemedi. Firebase kurallarını ve bağlantı ayarlarını kontrol et."));
    console.error(error);
  });
}

function firebaseMessage(error, fallback) {
  const code = error?.code || "";

  if (code === "auth/invalid-credential") return "E-posta veya şifre hatalı.";
  if (code === "auth/user-not-found") return "Bu e-posta için kullanıcı bulunamadı.";
  if (code === "auth/invalid-email") return "E-posta adresi geçerli görünmüyor.";
  if (code === "auth/missing-email") return "Şifre sıfırlama için e-posta adresini yazmalısın.";
  if (code === "auth/wrong-password") return "Şifre hatalı.";
  if (code === "auth/too-many-requests") return "Çok fazla deneme yapıldı. Bir süre sonra tekrar dene.";
  if (code === "auth/network-request-failed") return "Ağ bağlantısı kurulamadı. İnterneti ve Firebase erişimini kontrol et.";
  if (code === "auth/unauthorized-domain") return "Bu domain Firebase Authentication içinde yetkili değil. Authentication > Settings > Authorized domains kısmına domaini ekle.";
  if (code === "PERMISSION_DENIED") return "Firebase izin vermedi. Realtime Database Rules içindeki admin mailini kontrol et.";

  return error?.message || fallback;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice(loginNotice);

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const button = loginForm.querySelector("button[type='submit']");

  button.disabled = true;
  button.textContent = "Kontrol ediliyor...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    showNotice(loginNotice, "error", firebaseMessage(error, "Giriş yapılamadı. E-posta veya şifreyi kontrol et."));
    console.error(error);
  } finally {
    button.disabled = false;
    button.textContent = "Giriş Yap";
  }
});

forgotPasswordButton.addEventListener("click", async () => {
  clearNotice(loginNotice);

  const emailInput = document.getElementById("loginEmail");
  const email = emailInput.value.trim();

  if (!email) {
    showNotice(loginNotice, "error", "Şifre sıfırlama linki için önce e-posta adresini yaz.");
    emailInput.focus();
    return;
  }

  if (!isAdminEmail(email)) {
    showNotice(loginNotice, "error", "Bu e-posta panel yetkilisi olarak tanımlı değil. firebase-config.js içindeki admin mailiyle dene.");
    emailInput.focus();
    return;
  }

  forgotPasswordButton.disabled = true;
  forgotPasswordButton.textContent = "Link gönderiliyor...";

  try {
    await sendPasswordResetEmail(auth, email, {
      url: `${window.location.origin}${window.location.pathname}`,
      handleCodeInApp: false
    });

    showNotice(loginNotice, "success", "Şifre sıfırlama linki e-posta adresine gönderildi. Gelen kutunu ve spam klasörünü kontrol et.");
  } catch (error) {
    showNotice(loginNotice, "error", firebaseMessage(error, "Şifre sıfırlama linki gönderilemedi. Firebase Authentication ayarlarını kontrol et."));
    console.error(error);
  } finally {
    forgotPasswordButton.disabled = false;
    forgotPasswordButton.textContent = "Şifremi unuttum";
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  stopWatchingPosts();
  await signOut(auth);
});

postForm.addEventListener("submit", (event) => {
  event.preventDefault();
  savePost();
});

document.getElementById("saveDraftButton").addEventListener("click", () => {
  postStatus.value = "draft";
  savePost("draft");
});

document.getElementById("publishButton").addEventListener("click", () => {
  postStatus.value = "published";
  savePost("published");
});

document.getElementById("resetFormButton").addEventListener("click", () => {
  resetForm();
  clearNotice(adminNotice);
});

adminPostsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === "edit") {
    const post = allPosts.find((item) => item.id === id);
    if (post) fillForm(post);
  }

  if (action === "publish") togglePublish(id);
  if (action === "delete") deletePost(id);
});

statusFilter.addEventListener("change", renderPosts);
typeFilter.addEventListener("change", renderPosts);

onAuthStateChanged(auth, async (user) => {
  clearNotice(loginNotice);

  if (!user) {
    stopWatchingPosts();
    resetForm();
    forceLoginOnly();
    return;
  }

  if (!isAllowedUser(user)) {
    stopWatchingPosts();
    await signOut(auth);
    forceLoginOnly();
    showNotice(loginNotice, "error", "Bu panele erişim yetkin yok. firebase-config.js içindeki admin mailiyle giriş yapmalısın.");
    return;
  }

  resetForm();
  forcePanelOnly(user);
  watchPosts();
});

