const DISMISSED_KEY = "quiloDismissedAnnouncement";

function safeUrl(link) {
  const raw = String(link == null ? "" : link).trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (_) {
    return "";
  }
}

function announcementKey(item) {
  return String(item?.id || `${item?.category || ""}:${item?.title || ""}`);
}

function wasDismissed(key) {
  try { return sessionStorage.getItem(DISMISSED_KEY) === key; }
  catch (_) { return false; }
}

function rememberDismissed(key) {
  try { sessionStorage.setItem(DISMISSED_KEY, key); }
  catch (_) {}
}

function createAnnouncement(item, total) {
  const href = safeUrl(item.link);
  const node = document.createElement(href ? "a" : "div");
  node.className = "ann-item";
  if (href) {
    node.href = href;
    const target = new URL(href, window.location.origin);
    if (target.origin !== window.location.origin) {
      node.target = "_blank";
      node.rel = "noopener";
    }
  }

  const title = document.createElement("span");
  title.className = "ann-item-title";
  title.textContent = String(item.title || "Quilo 새 소식");
  node.appendChild(title);

  const meta = document.createElement("span");
  meta.className = "ann-item-meta";
  meta.textContent = total > 1 ? `외 ${total - 1}건` : "";
  if (meta.textContent) node.appendChild(meta);

  if (href) {
    const more = document.createElement("span");
    more.className = "ann-item-more";
    more.textContent = "자세히 보기 →";
    node.appendChild(more);
  }
  return node;
}

export async function loadAnnouncements() {
  const ticker = document.getElementById("annTicker");
  const track = document.getElementById("annTrack");
  const dismiss = document.getElementById("annDismiss");
  if (!ticker || !track) return;

  try {
    const response = await fetch("/api/announcements");
    if (!response.ok) throw new Error("announcement request failed");
    const data = await response.json();
    const list = Array.isArray(data.announcements)
      ? data.announcements.filter((item) => String(item?.title || "").trim())
      : [];
    if (!list.length) {
      ticker.hidden = true;
      return;
    }

    const primary = list[0];
    const key = announcementKey(primary);
    if (wasDismissed(key)) {
      ticker.hidden = true;
      return;
    }

    track.replaceChildren(createAnnouncement(primary, list.length));
    dismiss?.addEventListener("click", () => {
      rememberDismissed(key);
      ticker.hidden = true;
    }, { once: true });
    ticker.hidden = false;
  } catch (_) {
    ticker.hidden = true;
  }
}
