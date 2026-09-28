const TYPE_LABELS = {
  poem: "Şiir",
  daily: "Gün Notu"
};

export function typeLabel(type) {
  return TYPE_LABELS[type] || "Yazı";
}

export function normalizeComparable(value = "") {
  return String(value)
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ı", "i");
}

export function meaningfulCategory(post) {
  const category = String(post?.category || "").trim();
  if (!category) return "";
  return normalizeComparable(category) === normalizeComparable(typeLabel(post?.type)) ? "" : category;
}

export function parsePostDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return 0;
  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), 9);
}

export function getSortTime(post) {
  return Number(post?.createdAt) || Number(post?.updatedAt) || parsePostDate(post?.date) || 0;
}

export function isPublicPost(post, now = Date.now()) {
  if (post?.status === "published") return true;
  return post?.status === "scheduled" && Number(post.publishAt) > 0 && Number(post.publishAt) <= now;
}

export function normalizePosts(...values) {
  const posts = new Map();
  values.forEach((value) => {
    Object.entries(value || {}).forEach(([id, post]) => posts.set(id, { id, ...post }));
  });
  return [...posts.values()].sort((a, b) => {
    const time = getSortTime(b) - getSortTime(a);
    return time || String(a.id).localeCompare(String(b.id), "tr");
  });
}

export function readingMinutes(content = "", wordsPerMinute = 200) {
  const words = String(content).trim().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  return Math.max(1, Math.ceil(words.length / wordsPerMinute));
}

export function uniqueCategories(posts) {
  const categories = new Map();
  posts.forEach((post) => {
    const category = meaningfulCategory(post);
    const key = normalizeComparable(category);
    if (key && !categories.has(key)) categories.set(key, category);
  });
  return [...categories.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr-TR"));
}

export function filterPosts(posts, filters = {}, favoriteIds = []) {
  const query = normalizeComparable(filters.query);
  const category = normalizeComparable(filters.category);
  const favorites = new Set(favoriteIds);

  return posts.filter((post) => {
    const date = String(post.date || "");
    const haystack = normalizeComparable([
      post.title,
      post.excerpt,
      post.content,
      post.category,
      post.series
    ].filter(Boolean).join(" "));

    if (query && !haystack.includes(query)) return false;
    if (category && normalizeComparable(meaningfulCategory(post)) !== category) return false;
    if (filters.year && date.slice(0, 4) !== String(filters.year)) return false;
    if (filters.month && date.slice(5, 7) !== String(filters.month).padStart(2, "0")) return false;
    if (filters.favorites && !favorites.has(post.id)) return false;
    return true;
  });
}

export function buildArchive(posts) {
  const grouped = new Map();
  posts.forEach((post) => {
    const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(post.date || ""));
    if (!match) return;
    const [, year, month] = match;
    if (!grouped.has(year)) grouped.set(year, new Map());
    const months = grouped.get(year);
    months.set(month, (months.get(month) || 0) + 1);
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort(([a], [b]) => Number(b) - Number(a))
        .map(([month, count]) => ({ month, count }))
    }));
}

export function adjacentPosts(posts, currentId) {
  const ordered = posts.slice().sort((a, b) => {
    const time = getSortTime(a) - getSortTime(b);
    return time || String(a.id).localeCompare(String(b.id), "tr");
  });
  const index = ordered.findIndex((post) => post.id === currentId);
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null
  };
}

export function seriesContext(posts, current) {
  const seriesKey = normalizeComparable(current?.series);
  if (!seriesKey) return null;
  const entries = posts
    .filter((post) => normalizeComparable(post.series) === seriesKey)
    .sort((a, b) => getSortTime(a) - getSortTime(b));
  const index = entries.findIndex((post) => post.id === current.id);
  if (index < 0) return null;
  return {
    name: String(current.series).trim(),
    index: index + 1,
    total: entries.length,
    previous: index > 0 ? entries[index - 1] : null,
    next: index < entries.length - 1 ? entries[index + 1] : null
  };
}

export function firstMeaningfulStanza(content = "", max = 420) {
  const stanza = String(content)
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find(Boolean) || "";
  return stanza.length > max ? `${stanza.slice(0, max).trim()}…` : stanza;
}
