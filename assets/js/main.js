const body = document.body;
const root = document.documentElement;
const menuToggle = document.querySelector("[data-menu-toggle]");
const siteNav = document.querySelector("[data-site-nav]");
const THEME_KEY = "hissez-theme";
const TRACK_KEY = "hissez-audio-track";
const MUTE_KEY = "hissez-audio-muted";
const PWA_RECOVERY_VERSION = "42";
const PWA_RECOVERY_KEY = "hissez-pwa-recovery-version";
const PWA_RECOVERY_PARAM = "hissez-pwa-reset";

function recoverLocalCleanPostRoute() {
  if (!/^(?:localhost|127\.0\.0\.1)$/.test(location.hostname) || body.dataset.page !== "home") return false;
  const match = location.pathname.match(/^\/(siir|gun-notu)\/([^/?#]+)\/?$/);
  if (!match) return false;
  const type = match[1] === "siir" ? "poem" : "daily";
  location.replace(`/yazi.html?slug=${encodeURIComponent(decodeURIComponent(match[2]))}&type=${type}`);
  return true;
}

const tracks = [
  { title: "Sessiz Ambiyans", subtitle: "Yumuşak ve düz fon", src: "/assets/audio/hissez-sessiz-ambiyans.ogg?v=2" },
  { title: "Gece Defteri", subtitle: "Daha koyu, hafif ritimli", src: "/assets/audio/hissez-gece-defteri.ogg?v=2" },
  { title: "Şiir Odası", subtitle: "Parlak ve çan dokulu", src: "/assets/audio/hissez-siir-odasi.ogg?v=2" },
  { title: "Gün Notu", subtitle: "Daha hareketli, sıcak fon", src: "/assets/audio/hissez-gun-notu.ogg?v=2" }
];

function setTheme(theme) {
  root.dataset.theme = theme;
  body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(saved || (prefersDark ? "dark" : "light"));

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    setTheme(root.dataset.theme === "dark" ? "light" : "dark");
  });
}

function initCommon() {
  document.querySelectorAll("[data-year]").forEach((item) => {
    item.textContent = new Date().getFullYear();
  });

  if (menuToggle && siteNav) {
    siteNav.id ||= "primaryNavigation";
    menuToggle.setAttribute("aria-controls", siteNav.id);
    menuToggle.setAttribute("aria-expanded", "false");
    const setMenu = (open) => {
      body.classList.toggle("menu-open", open);
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
      if (open) siteNav.querySelector("a")?.focus();
    };
    menuToggle.addEventListener("click", () => setMenu(!body.classList.contains("menu-open")));
    siteNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setMenu(false));
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && body.classList.contains("menu-open")) {
        setMenu(false);
        menuToggle.focus();
      }
    });
    addEventListener("resize", () => { if (innerWidth > 920) setMenu(false); }, { passive: true });
  }

  const currentPath = location.pathname.replace(/\/+$/, "") || "/";
  document.querySelectorAll(".site-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    const linkPath = new URL(href, location.origin).pathname.replace(/\/+$/, "") || "/";
    if (linkPath === currentPath) link.classList.add("active");
  });

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }
}

function enhanceFooter() {
  const footer = document.querySelector(".site-footer .footer-inner");
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer-brand"><strong>Hissez</strong><span>Sezin’in kaleminden şiirler ve gün notları.</span></div>
    <nav class="footer-nav" aria-label="Alt menü"><a href="/">Ana Sayfa</a><a href="/siirler">Şiirler</a><a href="/gun-notlari">Gün Notları</a><a href="/arsiv">Arşiv</a><a href="/hakkimda">Hakkımda</a></nav>
    <div class="footer-meta"><div class="footer-social">
      <a class="social-link" href="https://www.instagram.com/hissezz" target="_blank" rel="noopener noreferrer" aria-label="Hissez Instagram hesabı"><svg class="footer-social-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.7" r="1.15" fill="currentColor"/></svg><span>Instagram</span></a>
      <a class="social-link" href="https://pin.it/55jp4Ze6V" target="_blank" rel="noopener noreferrer" aria-label="Hissez Pinterest hesabı"><svg class="footer-social-icon pinterest-footer-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.04 2C6.58 2 3 5.62 3 10.47c0 2.15 1.2 4.83 3.12 5.68.29.13.44.07.51-.21.05-.21.31-1.27.43-1.76.04-.16.02-.31-.11-.46-.63-.75-1.13-2.13-1.13-3.42 0-3.24 2.46-6.38 6.66-6.38 3.63 0 6.17 2.47 6.17 6.01 0 3.99-2.01 6.76-4.63 6.76-1.45 0-2.54-1.2-2.19-2.67.42-1.75 1.23-3.64 1.23-4.9 0-1.13-.61-2.08-1.86-2.08-1.47 0-2.66 1.52-2.66 3.56 0 1.3.44 2.18.44 2.18s-1.46 6.16-1.73 7.31c-.3 1.27-.18 3.05-.05 4.21.04.32.46.39.63.12.59-.98 1.56-2.65 1.9-3.87.18-.66.94-3.37.94-3.37.5.95 1.95 1.75 3.49 1.75 4.59 0 7.9-4.22 7.9-9.45C21 5.94 17.16 2 12.04 2z"/></svg><span>Pinterest</span></a>
    </div><span>© <span data-year>${new Date().getFullYear()}</span> Hissez</span></div>`;
}

function removeLegacyAudio() {
  document.querySelectorAll(".music-widget, .floating-audio, .hissez-music-widget, .hissez-audio-root").forEach((el) => el.remove());
  document.getElementById("musicToggleHeader")?.remove();
}

function initAudioPlayer() {
  removeLegacyAudio();

  let currentTrack = Number(localStorage.getItem(TRACK_KEY) || 0);
  if (!Number.isFinite(currentTrack) || currentTrack < 0 || currentTrack >= tracks.length) currentTrack = 0;

  const audio = new Audio(tracks[currentTrack].src);
  audio.loop = true;
  audio.volume = 0.16;
  audio.preload = "auto";
  audio.muted = localStorage.getItem(MUTE_KEY) === "true";

  const player = document.createElement("div");
  player.className = "hissez-player";
  player.innerHTML = `
    <button class="hissez-player-toggle" type="button" aria-label="Müzik panelini aç / kapat">
      <span class="hissez-player-note">♫</span>
      <span>Müzik</span>
    </button>
    <div class="hissez-player-panel">
      <div class="hissez-player-head">
        <div>
          <strong data-audio-title></strong>
          <small data-audio-subtitle></small>
        </div>
        <button class="hissez-player-close" type="button" aria-label="Müzik panelini kapat">×</button>
      </div>
      <select class="hissez-player-select" aria-label="Müzik seç">
        ${tracks.map((track, index) => `<option value="${index}">${track.title}</option>`).join("")}
      </select>
      <div class="hissez-player-actions">
        <button class="hissez-player-btn primary" type="button" data-audio-play>▶ Başlat</button>
        <button class="hissez-player-btn secondary" type="button" data-audio-mute>🔊 Ses</button>
      </div>
    </div>
  `;
  document.body.appendChild(player);

  const toggle = player.querySelector(".hissez-player-toggle");
  const close = player.querySelector(".hissez-player-close");
  const select = player.querySelector(".hissez-player-select");
  const title = player.querySelector("[data-audio-title]");
  const subtitle = player.querySelector("[data-audio-subtitle]");
  const play = player.querySelector("[data-audio-play]");
  const mute = player.querySelector("[data-audio-mute]");

  function syncTrack() {
    title.textContent = tracks[currentTrack].title;
    subtitle.textContent = tracks[currentTrack].subtitle;
    select.value = String(currentTrack);
  }

  function syncState() {
    const playing = !audio.paused;
    toggle.classList.toggle("is-playing", playing);
    play.textContent = playing ? "❚❚ Duraklat" : "▶ Başlat";
    mute.textContent = audio.muted ? "🔇 Sessiz" : "🔊 Ses";
  }

  async function togglePlay() {
    try {
      if (audio.paused) await audio.play();
      else audio.pause();
    } catch (error) {
      console.error("Müzik başlatılamadı:", error);
    }
    syncState();
  }

  async function changeTrack(index) {
    const wasPlaying = !audio.paused;
    currentTrack = index;
    localStorage.setItem(TRACK_KEY, String(index));
    audio.src = tracks[index].src;
    syncTrack();
    if (wasPlaying) {
      try { await audio.play(); } catch (error) { console.error("Müzik değiştirilemedi:", error); }
    }
    syncState();
  }

  toggle.addEventListener("click", () => player.classList.toggle("is-open"));
  close.addEventListener("click", () => player.classList.remove("is-open"));
  select.addEventListener("change", () => changeTrack(Number(select.value)));
  play.addEventListener("click", togglePlay);
  mute.addEventListener("click", () => {
    audio.muted = !audio.muted;
    localStorage.setItem(MUTE_KEY, String(audio.muted));
    syncState();
  });
  document.addEventListener("click", (event) => {
    if (!player.contains(event.target)) player.classList.remove("is-open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") player.classList.remove("is-open");
  });
  audio.addEventListener("play", syncState);
  audio.addEventListener("pause", syncState);

  syncTrack();
  syncState();
}

const localPostRouteRecovered = recoverLocalCleanPostRoute();

if (!localPostRouteRecovered) {
  initTheme();
  enhanceFooter();
  initCommon();
  initAudioPlayer();
}

if (!localPostRouteRecovered && "serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", async () => {
    const recoveryUrl = new URL(location.href);
    const isRecoveryReload = recoveryUrl.searchParams.get(PWA_RECOVERY_PARAM) === PWA_RECOVERY_VERSION;

    try {
      const registrations = navigator.serviceWorker.getRegistrations
        ? await navigator.serviceWorker.getRegistrations()
        : [await navigator.serviceWorker.getRegistration()].filter(Boolean);
      const cacheNames = "caches" in window ? await caches.keys() : [];
      const hissezCacheNames = cacheNames.filter((name) => name.startsWith("hissez-"));
      let recoveredVersion = "";

      try {
        recoveredVersion = localStorage.getItem(PWA_RECOVERY_KEY) || "";
      } catch {
        // Safari gizli modunda depolama kısıtlıysa URL işareti tek seferlik döngüyü önler.
      }

      const hasExistingPwaState = registrations.length > 0 || hissezCacheNames.length > 0;
      if (recoveredVersion !== PWA_RECOVERY_VERSION && !isRecoveryReload && hasExistingPwaState) {
        await Promise.allSettled(registrations.map((registration) => registration.unregister()));
        await Promise.allSettled(hissezCacheNames.map((name) => caches.delete(name)));

        try {
          localStorage.setItem(PWA_RECOVERY_KEY, PWA_RECOVERY_VERSION);
        } catch {
          // URL işareti depolama kapalıyken de yeniden yükleme döngüsünü engeller.
        }

        recoveryUrl.searchParams.set(PWA_RECOVERY_PARAM, PWA_RECOVERY_VERSION);
        location.replace(recoveryUrl.href);
        return;
      }

      if (isRecoveryReload) {
        recoveryUrl.searchParams.delete(PWA_RECOVERY_PARAM);
        history.replaceState(history.state, "", `${recoveryUrl.pathname}${recoveryUrl.search}${recoveryUrl.hash}`);
      }

      try {
        localStorage.setItem(PWA_RECOVERY_KEY, PWA_RECOVERY_VERSION);
      } catch {
        // PWA kaydı localStorage olmadan da çalışır.
      }

      const hadController = Boolean(navigator.serviceWorker.controller);
      if (hadController) {
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          location.reload();
        }, { once: true });
      }

      const registration = await navigator.serviceWorker.register(`/sw.js?v=${PWA_RECOVERY_VERSION}`, {
        updateViaCache: "none"
      });
      await registration.update();
    } catch (error) {
      console.error("Service worker kaydı başarısız:", error);
    }
  });
}
