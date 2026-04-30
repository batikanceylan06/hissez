const body = document.body;
const root = document.documentElement;
const menuToggle = document.querySelector("[data-menu-toggle]");
const siteNav = document.querySelector("[data-site-nav]");
const THEME_KEY = "hissez-theme";
const TRACK_KEY = "hissez-audio-track";
const MUTE_KEY = "hissez-audio-muted";

const tracks = [
  { title: "Sessiz Ambiyans", subtitle: "Yumuşak blog fonu", src: "assets/audio/hissez-ambient-1.ogg" },
  { title: "Gece Defteri", subtitle: "Sakin ve derin", src: "assets/audio/hissez-ambient-2.ogg" },
  { title: "Şiir Odası", subtitle: "Hafif romantik", src: "assets/audio/hissez-ambient-3.ogg" },
  { title: "Gün Notu", subtitle: "Minimal arka plan", src: "assets/audio/hissez-ambient-4.ogg" }
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
    menuToggle.addEventListener("click", () => body.classList.toggle("menu-open"));
    siteNav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => body.classList.remove("menu-open"));
    });
  }

  const currentPage = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".site-nav a").forEach((link) => {
    const href = link.getAttribute("href");
    if (href === currentPage || (currentPage === "" && href === "index.html")) link.classList.add("active");
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

initTheme();
initCommon();
initAudioPlayer();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.error("Service worker kaydı başarısız:", error));
  });
}
