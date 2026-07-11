function safeUrl(link) {
  const raw = String(link == null ? "" : link).trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_) { return ""; }
}

export async function loadAnnouncements() {
  const ticker = document.getElementById("annTicker");
  const track = document.getElementById("annTrack");
  if (!ticker || !track) return;
  try {
    const response = await fetch("/api/announcements");
    const data = await response.json();
    const list = Array.isArray(data.announcements) ? data.announcements : [];
    if (!list.length) { ticker.hidden = true; return; }
    const createNodes = (announcement) => {
      const href = safeUrl(announcement.link);
      const item = document.createElement(href ? "a" : "span");
      item.className = "ann-item";
      if (href) {
        item.href = href;
        item.target = "_blank";
        item.rel = "noopener";
      }
      if (announcement.category) {
        const category = document.createElement("span");
        category.className = "ann-cat";
        category.textContent = String(announcement.category);
        item.appendChild(category);
      }
      const title = document.createElement("span");
      title.textContent = String(announcement.title || "");
      item.appendChild(title);
      const separator = document.createElement("span");
      separator.className = "ann-dot";
      separator.textContent = "•";
      return [item, separator];
    };
    const textLength = list.reduce((total, item) => total + String(item.category || "").length + String(item.title || "").length + 8, 0);
    let repetitions = 1;
    while (textLength * repetitions < 180 && repetitions < 4) repetitions += 1;
    const group = document.createElement("span");
    group.className = "ann-group";
    for (let i = 0; i < repetitions; i += 1) {
      list.forEach((announcement) => createNodes(announcement).forEach((node) => group.appendChild(node)));
    }
    track.replaceChildren(group.cloneNode(true), group.cloneNode(true));
    const duration = Math.max(20, Math.min(90, list.length * repetitions * 5));
    track.style.setProperty("--ann-dur", `${duration}s`);
    ticker.hidden = false;
  } catch (_) { ticker.hidden = true; }
}
