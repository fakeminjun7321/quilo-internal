"use strict";

(function initEditorialPlatform() {
  const API_ROOT = "/api/editorial";
  const page = document.body?.dataset.editorialPage || "";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const POSTS_PER_PAGE = 8;
  const BOOKMARK_KEY = "quilo.editorial.bookmarks.v1";

  function svg(name) {
    const icons = {
      bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z"></path></svg>',
      share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"></path></svg>',
      image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><circle cx="8.5" cy="9" r="1.5"></circle><path d="m4 18 5-5 4 4 2-2 5 5"></path></svg>',
      file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6V2Z"></path><path d="M14 2v5h5"></path></svg>',
      download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"></path></svg>',
      empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h5"></path></svg>',
    };
    return icons[name] || "";
  }

  function showToast(message, error = false) {
    const toast = $("#editorialToast");
    if (!toast) return;
    toast.textContent = String(message || "");
    toast.classList.toggle("is-error", error);
    toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { toast.hidden = true; }, 3600);
  }

  class EditorialApiError extends Error {
    constructor(message, status, code) {
      super(message);
      this.name = "EditorialApiError";
      this.status = status;
      this.code = code;
    }
  }

  async function api(path, options = {}) {
    const init = { credentials: "same-origin", cache: "no-store", ...options };
    if (init.body && !(init.body instanceof FormData) && typeof init.body !== "string") {
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
      init.body = JSON.stringify(init.body);
    }
    const response = await fetch(`${API_ROOT}${path}`, init);
    const contentType = response.headers.get("content-type") || "";
    let body = null;
    if (contentType.includes("application/json")) body = await response.json().catch(() => null);
    else body = await response.text().catch(() => "");
    if (!response.ok) {
      const message = body && typeof body === "object" && (body.error || body.message)
        ? body.error || body.message
        : `요청을 처리하지 못했습니다. (${response.status})`;
      throw new EditorialApiError(message, response.status, body && body.code);
    }
    return body;
  }

  function arrayFrom(payload, keys) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
      if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    }
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  }

  function oneFrom(payload, keys) {
    if (!payload || typeof payload !== "object") return null;
    for (const key of keys) if (payload[key] && typeof payload[key] === "object") return payload[key];
    if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
    return payload.id || payload.slug ? payload : null;
  }

  function cleanText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function normalizeTags(value) {
    if (Array.isArray(value)) return value.map((tag) => cleanText(tag).replace(/^#+/, "")).filter(Boolean);
    return cleanText(value).split(",").map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean);
  }

  function normalizeAttachment(raw) {
    const id = cleanText(raw?.id || raw?.attachment_id);
    const filename = cleanText(raw?.filename || raw?.file_name || raw?.name, "첨부 파일");
    const mime = cleanText(raw?.mime_type || raw?.mime || raw?.content_type);
    return {
      raw,
      id,
      postId: cleanText(raw?.post_id || raw?.postId),
      filename,
      mime,
      size: Number(raw?.size_bytes ?? raw?.size ?? 0) || 0,
      downloadUrl: cleanText(raw?.downloadUrl || raw?.download_url) || (id ? `${API_ROOT}/attachments/${encodeURIComponent(id)}/download` : ""),
      inlineUrl: cleanText(raw?.inlineUrl || raw?.inline_url) || (id && mime.startsWith("image/") ? `${API_ROOT}/attachments/${encodeURIComponent(id)}/download?inline=1` : ""),
    };
  }

  function normalizePost(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    const author = raw.author && typeof raw.author === "object" ? raw.author : {};
    const richHtml = cleanText(raw.rich_html ?? raw.richHtml ?? raw.content_html ?? raw.html ?? raw.content);
    const authorName = cleanText(author.name || author.display_name || author.username || raw.author_name, "Quilo");
    const kind = cleanText(raw.kind || raw.type) === "developer_note" ? "developer" : cleanText(raw.kind || raw.type);
    return {
      raw,
      id: cleanText(raw.id || raw.post_id),
      slug: cleanText(raw.slug || raw.id),
      kind,
      title: cleanText(raw.title, "제목 없음"),
      summary: cleanText(raw.excerpt ?? raw.summary ?? raw.description),
      richHtml,
      coverUrl: cleanText(raw.cover_image ?? raw.coverImage ?? raw.cover_image_url ?? raw.cover_url ?? raw.cover?.url),
      category: cleanText(raw.category, kind === "resource" ? "자료" : "개발"),
      tags: normalizeTags(raw.tags),
      status: cleanText(raw.status, "published"),
      authorId: cleanText(raw.author_id || author.id || author.user_id),
      authorName,
      avatarUrl: cleanText(author.avatar_url || author.avatarUrl || raw.author_avatar_url),
      roleLabel: cleanText(author.role_title || author.title || raw.author_role) || (author.is_developer || author.isDeveloper || kind === "developer" ? "Quilo 개발자" : author.is_staff || author.isStaff ? "Quilo 스탭" : ""),
      publishedAt: raw.published_at || raw.publishedAt || raw.created_at || raw.createdAt || null,
      updatedAt: raw.updated_at || raw.updatedAt || null,
      readingMinutes: Number(raw.reading_minutes || raw.readingMinutes) || estimateReadingMinutes(richHtml, raw.summary),
      featured: Boolean(raw.featured || raw.is_featured),
      downloadCount: Number(raw.download_count || raw.downloads) || 0,
      attachments: arrayFrom(raw.attachments, ["attachments", "files"]).map(normalizeAttachment),
      canEdit: Boolean(raw.can_edit || raw.canEdit),
    };
  }

  function estimateReadingMinutes(html, summary) {
    const holder = document.createElement("div");
    holder.textContent = cleanText(summary);
    if (html) {
      const parsed = new DOMParser().parseFromString(String(html), "text/html");
      holder.textContent += ` ${parsed.body.textContent || ""}`;
    }
    const count = holder.textContent.replace(/\s/g, "").length;
    return Math.max(1, Math.ceil(count / 550));
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return cleanText(value);
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replace(/\.\s?/g, ".").replace(/\.$/, "");
  }

  function formatBytes(bytes) {
    const number = Number(bytes) || 0;
    if (number < 1024) return number ? `${number} B` : "";
    if (number < 1024 ** 2) return `${(number / 1024).toFixed(number < 10240 ? 1 : 0)} KB`;
    return `${(number / 1024 ** 2).toFixed(1)} MB`;
  }

  function getExtension(filename, mime = "") {
    const match = cleanText(filename).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
    if (match) return match[1];
    if (mime.includes("pdf")) return "pdf";
    if (mime.includes("word")) return "docx";
    if (mime.includes("sheet") || mime.includes("excel")) return "xlsx";
    if (mime.startsWith("image/")) return mime.split("/")[1];
    return "file";
  }

  function safeUrl(value, { image = false } = {}) {
    const raw = cleanText(value);
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return "";
    if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
    if (!image && raw.startsWith("#")) return raw;
    try {
      const parsed = new URL(raw, location.origin);
      if (parsed.protocol === "https:" || (parsed.origin === location.origin && parsed.protocol === location.protocol) || (!image && parsed.protocol === "mailto:")) return parsed.href;
    } catch (_) { return ""; }
    return "";
  }

  const ALLOWED_TAGS = new Set(["P","BR","HR","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","PRE","CODE","STRONG","B","EM","I","U","S","MARK","SMALL","SUB","SUP","SPAN","DIV","UL","OL","LI","TABLE","THEAD","TBODY","TFOOT","TR","TH","TD","FIGURE","FIGCAPTION","A","IMG"]);
  const DROP_TAGS = new Set(["SCRIPT","STYLE","IFRAME","OBJECT","EMBED","SVG","MATH","FORM","BUTTON","INPUT","TEXTAREA","SELECT","OPTION","TEMPLATE","NOSCRIPT","META","LINK","BASE","AUDIO","VIDEO"]);
  const STYLE_PROPERTIES = new Set(["text-align","font-weight","font-style","text-decoration","font-size","color","background-color","font-family","width"]);

  function copySafeStyles(from, to) {
    if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) return;
    const style = from.getAttribute("style");
    if (!style) return;
    for (const declaration of style.split(";")) {
      const index = declaration.indexOf(":");
      if (index < 1) continue;
      const key = declaration.slice(0, index).trim().toLowerCase();
      const value = declaration.slice(index + 1).trim();
      if (!STYLE_PROPERTIES.has(key) || !value || /url\s*\(|expression|@import|[<>\\]/i.test(value)) continue;
      if (key === "text-align" && !/^(left|center|right|justify)$/.test(value)) continue;
      if (key === "font-size" && !/^(?:1[0-9]|2[0-8])px$/.test(value)) continue;
      if ((key === "color" || key === "background-color") && !/^(?:#[0-9a-f]{3,8}|rgb\([^)]{1,40}\))$/i.test(value)) continue;
      if (key === "width" && !/^(?:100|[1-9]?\d)%$/.test(value)) continue;
      to.style.setProperty(key, value.slice(0, 80));
    }
  }

  function sanitizeNode(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(document.createTextNode(node.nodeValue || ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (DROP_TAGS.has(node.tagName)) return;
    if (!ALLOWED_TAGS.has(node.tagName)) {
      for (const child of Array.from(node.childNodes)) sanitizeNode(child, target);
      return;
    }
    const element = document.createElement(node.tagName.toLowerCase());
    copySafeStyles(node, element);
    if (node.hasAttribute("title")) element.title = cleanText(node.getAttribute("title")).slice(0, 300);
    if (node.tagName === "A") {
      const href = safeUrl(node.getAttribute("href"));
      if (href) element.href = href;
      if (node.getAttribute("target") === "_blank") element.target = "_blank";
      element.rel = "noopener noreferrer nofollow";
    }
    if (node.tagName === "IMG") {
      const src = safeUrl(node.getAttribute("src"), { image: true });
      if (!src) return;
      element.src = src;
      element.alt = cleanText(node.getAttribute("alt")).slice(0, 300);
      element.loading = "lazy";
      const width = Number.parseInt(node.getAttribute("width"), 10);
      const height = Number.parseInt(node.getAttribute("height"), 10);
      if (width > 0 && width <= 2400) element.width = width;
      if (height > 0 && height <= 2400) element.height = height;
    }
    if (["TH","TD"].includes(node.tagName)) {
      for (const attribute of ["colspan", "rowspan"]) {
        const count = Number.parseInt(node.getAttribute(attribute), 10);
        if (count > 0 && count <= 100) element.setAttribute(attribute, String(count));
      }
    }
    if (node.tagName === "OL") {
      const start = Number.parseInt(node.getAttribute("start"), 10);
      if (start > 0 && start <= 100) element.start = start;
    }
    for (const child of Array.from(node.childNodes)) sanitizeNode(child, element);
    target.append(element);
  }

  function sanitizeToFragment(html) {
    const parsed = new DOMParser().parseFromString(String(html || "").slice(0, 300000), "text/html");
    const fragment = document.createDocumentFragment();
    for (const node of Array.from(parsed.body.childNodes)) sanitizeNode(node, fragment);
    return fragment;
  }

  function sanitizeHtml(html) {
    const holder = document.createElement("div");
    holder.append(sanitizeToFragment(html));
    return holder.innerHTML;
  }

  function getBookmarks() {
    try { return new Set(JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]").map(String)); }
    catch (_) { return new Set(); }
  }

  function toggleBookmark(id) {
    const items = getBookmarks();
    const key = String(id || "");
    if (items.has(key)) items.delete(key); else items.add(key);
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(Array.from(items).slice(-200)));
    return items.has(key);
  }

  function articleHref(post) {
    return `/article.html?slug=${encodeURIComponent(post.slug)}`;
  }

  function makeAuthorMeta(post, { compact = false } = {}) {
    const wrap = document.createElement("div");
    wrap.className = "ed-post-meta";
    if (post.avatarUrl) {
      const image = document.createElement("img");
      image.src = safeUrl(post.avatarUrl, { image: true });
      image.alt = "";
      image.loading = "lazy";
      image.addEventListener("error", () => image.remove());
      wrap.append(image);
    } else {
      const fallback = document.createElement("span");
      fallback.className = "ed-author-fallback";
      fallback.textContent = Array.from(post.authorName)[0] || "Q";
      wrap.append(fallback);
    }
    const name = document.createElement("strong");
    name.textContent = post.authorName;
    wrap.append(name);
    if (post.roleLabel && !compact) {
      const role = document.createElement("span");
      role.className = "ed-author-role";
      role.textContent = post.roleLabel;
      wrap.append(role);
    }
    const reading = document.createElement("span");
    reading.className = "ed-meta-dot";
    reading.textContent = `${post.readingMinutes}분 읽기`;
    wrap.append(reading);
    const date = document.createElement("time");
    date.className = "ed-meta-dot";
    date.dateTime = post.publishedAt ? new Date(post.publishedAt).toISOString() : "";
    date.textContent = formatDate(post.publishedAt);
    wrap.append(date);
    return wrap;
  }

  function setupSharedChrome(session) {
    const account = $("[data-account-link]");
    if (account && session?.profile) {
      account.textContent = session.profile.name || "내 계정";
      account.href = "/#settings";
    }
    const canDeveloper = Boolean(session?.capabilities?.writeDeveloperNotes);
    const canResource = Boolean(session?.capabilities?.writeResources);
    $$('[data-write-action]').forEach((node) => { node.hidden = !canDeveloper; });
    $$('[data-resource-write]').forEach((node) => { node.hidden = !canResource; });
    const toggle = $("[data-mobile-toggle]");
    const panel = $("[data-mobile-nav]");
    toggle?.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
      if (panel) panel.hidden = !open;
    });
    $$('[data-focus-search]').forEach((button) => button.addEventListener("click", () => {
      const field = $('input[type="search"]');
      field?.focus();
      field?.scrollIntoView({ block: "center", behavior: "smooth" });
    }));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      const field = $('input[type="search"]');
      if (!field) return;
      event.preventDefault();
      field.focus();
    });
  }

  async function loadSession() {
    try {
      const result = await api("/me/capabilities");
      return {
        capabilities: result?.capabilities || {},
        profile: result?.profile || result?.user || null,
      };
    } catch (error) {
      if (error.status === 401) return null;
      return null;
    }
  }

  async function hydrateAttachments(post) {
    if (!post?.id || post.attachments.length) return post;
    try {
      const payload = await api(`/posts/${encodeURIComponent(post.id)}/attachments`);
      post.attachments = arrayFrom(payload, ["attachments", "files"]).map(normalizeAttachment);
    } catch (_) { /* 목록은 첨부 조회 실패와 무관하게 보여 준다. */ }
    return post;
  }

  function emptyState(title, description) {
    const wrap = document.createElement("div");
    wrap.className = "ed-empty";
    wrap.innerHTML = svg("empty");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const text = document.createElement("p");
    text.textContent = description;
    wrap.append(heading, text);
    return wrap;
  }

  async function initNotes(session) {
    const state = { posts: [], category: "", query: "", sort: "latest", shown: POSTS_PER_PAGE, bookmarksOnly: false };
    const status = $("#notesStatus");
    const list = $("#postList");
    const featured = $("#featuredPost");
    const loadMore = $("#loadMore");

    function filteredPosts() {
      let items = state.posts.filter((post) => {
        if (state.category && post.category !== state.category) return false;
        const haystack = `${post.title} ${post.summary} ${post.category} ${post.tags.join(" ")}`.toLocaleLowerCase("ko-KR");
        if (state.query && !haystack.includes(state.query.toLocaleLowerCase("ko-KR"))) return false;
        if (state.bookmarksOnly && !getBookmarks().has(post.id || post.slug)) return false;
        return true;
      });
      if (state.sort === "oldest") items = items.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
      else if (state.sort === "title") items = items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
      else items = items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      return items;
    }

    function renderFeatured(post) {
      featured.replaceChildren();
      if (!post) { featured.hidden = true; return; }
      featured.hidden = false;
      const media = document.createElement("a");
      media.className = "ed-featured__media";
      media.href = articleHref(post);
      if (post.coverUrl) {
        const image = document.createElement("img");
        image.src = safeUrl(post.coverUrl, { image: true });
        image.alt = "";
        image.loading = "eager";
        image.addEventListener("error", () => { media.classList.add("ed-featured__media--empty"); media.replaceChildren(); media.innerHTML = svg("image"); });
        media.append(image);
      } else {
        media.classList.add("ed-featured__media--empty");
        media.innerHTML = svg("image");
      }
      const copy = document.createElement("div");
      copy.className = "ed-featured__copy";
      const kicker = document.createElement("span");
      kicker.className = "ed-kicker";
      kicker.textContent = post.category;
      const title = document.createElement("h2");
      const anchor = document.createElement("a");
      anchor.href = articleHref(post);
      anchor.textContent = post.title;
      title.append(anchor);
      const summary = document.createElement("p");
      summary.className = "ed-featured__summary";
      summary.textContent = post.summary;
      copy.append(kicker, title, summary, makeAuthorMeta(post));
      featured.append(media, copy);
    }

    function postRow(post) {
      const row = document.createElement("article");
      row.className = "ed-post-item";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      const anchor = document.createElement("a");
      anchor.href = articleHref(post);
      anchor.textContent = post.title;
      title.append(anchor);
      const summary = document.createElement("p");
      summary.textContent = post.summary;
      copy.append(title, summary, makeAuthorMeta(post, { compact: true }));
      const actions = document.createElement("div");
      actions.className = "ed-item-actions";
      const bookmark = document.createElement("button");
      const key = post.id || post.slug;
      bookmark.type = "button";
      bookmark.title = "북마크";
      bookmark.setAttribute("aria-label", `${post.title} 북마크`);
      bookmark.classList.toggle("is-saved", getBookmarks().has(key));
      bookmark.innerHTML = svg("bookmark");
      bookmark.addEventListener("click", () => {
        const saved = toggleBookmark(key);
        bookmark.classList.toggle("is-saved", saved);
        showToast(saved ? "북마크에 저장했습니다." : "북마크에서 삭제했습니다.");
        if (state.bookmarksOnly && !saved) render();
      });
      const share = document.createElement("button");
      share.type = "button";
      share.title = "공유";
      share.setAttribute("aria-label", `${post.title} 공유`);
      share.innerHTML = svg("share");
      share.addEventListener("click", () => sharePost(post));
      actions.append(bookmark, share);
      row.append(copy, actions);
      return row;
    }

    function renderTopics() {
      const topics = $("[data-topic-list]");
      if (!topics) return;
      topics.replaceChildren();
      const categories = ["", "Quilo 활용", "개발", "보고서 작성", "새 소식"];
      for (const category of categories) {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("is-active", !state.bookmarksOnly && state.category === category);
        const label = document.createElement("span");
        label.textContent = category || "전체";
        const count = document.createElement("b");
        count.textContent = String(category ? state.posts.filter((post) => post.category === category).length : state.posts.length);
        button.append(label, count);
        button.addEventListener("click", () => selectCategory(category));
        topics.append(button);
      }
    }

    function selectCategory(category) {
      state.category = category;
      state.bookmarksOnly = false;
      state.shown = POSTS_PER_PAGE;
      $$('[data-category-tabs] button').forEach((button) => button.classList.toggle("is-active", button.dataset.category === category));
      $("[data-bookmark-filter]")?.classList.remove("is-active");
      render();
    }

    function render() {
      const items = filteredPosts();
      const canFeature = !state.query && !state.category && !state.bookmarksOnly && state.sort === "latest";
      const lead = canFeature ? (items.find((post) => post.featured) || items[0]) : null;
      renderFeatured(lead);
      const stream = lead ? items.filter((post) => post !== lead) : items;
      list.replaceChildren();
      stream.slice(0, state.shown).forEach((post) => list.append(postRow(post)));
      if (!stream.length) list.append(emptyState(state.bookmarksOnly ? "저장한 글이 없습니다" : "조건에 맞는 글이 없습니다", state.bookmarksOnly ? "읽고 싶은 글의 북마크 버튼을 눌러 보세요." : "검색어나 분류를 바꿔 다시 확인해 보세요."));
      loadMore.hidden = stream.length <= state.shown;
      status.textContent = state.posts.length ? `${items.length}개의 글` : "";
      renderTopics();
    }

    $$('[data-category-tabs] button').forEach((button) => button.addEventListener("click", () => selectCategory(button.dataset.category || "")));
    $("#postSearch")?.addEventListener("input", (event) => { state.query = event.target.value.trim(); state.shown = POSTS_PER_PAGE; render(); });
    $("#postSort")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
    loadMore?.addEventListener("click", () => { state.shown += POSTS_PER_PAGE; render(); });
    $("[data-bookmark-filter]")?.addEventListener("click", (event) => {
      state.bookmarksOnly = !state.bookmarksOnly;
      state.category = "";
      event.currentTarget.classList.toggle("is-active", state.bookmarksOnly);
      $$('[data-category-tabs] button').forEach((button) => button.classList.toggle("is-active", !state.bookmarksOnly && button.dataset.category === ""));
      render();
    });

    try {
      const payload = await api("/posts?kind=developer&limit=100");
      state.posts = arrayFrom(payload, ["posts", "items"]).map(normalizePost);
      render();
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("is-error");
      list.replaceChildren(emptyState("개발 노트를 불러오지 못했습니다", "잠시 후 다시 시도해 주세요."));
    }
  }

  async function sharePost(post) {
    const url = new URL(articleHref(post), location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title: post.title, text: post.summary, url });
      else { await navigator.clipboard.writeText(url); showToast("글 주소를 복사했습니다."); }
    } catch (error) {
      if (error.name !== "AbortError") showToast("공유 주소를 복사하지 못했습니다.", true);
    }
  }

  async function initArticle(session) {
    const params = new URLSearchParams(location.search);
    const slug = params.get("slug") || params.get("id") || "";
    const loading = $("#articleLoading");
    const article = $("#article");
    const errorState = $("#articleError");
    if (!slug) {
      loading.hidden = true;
      errorState.hidden = false;
      return;
    }
    try {
      const payload = await api(`/posts/${encodeURIComponent(slug)}`);
      const post = normalizePost(oneFrom(payload, ["post", "item"]));
      await hydrateAttachments(post);
      document.title = `${post.title} — Quilo`;
      const isResource = post.kind === "resource";
      $("#articleBack").href = isResource ? "/resources.html" : "/developer-notes.html";
      $("#articleBack span").textContent = isResource ? "자료실로" : "개발 노트로";
      $("#articleListLink").href = isResource ? "/resources.html" : "/developer-notes.html";
      $("#articleListLink").firstChild.textContent = isResource ? "자료실의 다른 글 보기" : "목록의 다른 글 보기";
      $("#articleCategory").textContent = post.category;
      $("#articleTitle").textContent = post.title;
      $("#articleSummary").textContent = post.summary;
      $("#articleAuthor").textContent = post.authorName;
      $("#articleRole").textContent = post.roleLabel;
      $("#articleDate").textContent = formatDate(post.publishedAt);
      $("#articleDate").dateTime = post.publishedAt ? new Date(post.publishedAt).toISOString() : "";
      $("#articleReadingTime").textContent = `${post.readingMinutes}분 읽기`;
      const avatar = $("#articleAvatar");
      if (post.avatarUrl) { avatar.src = safeUrl(post.avatarUrl, { image: true }); avatar.hidden = false; }
      const cover = $("#articleCover");
      if (post.coverUrl) { $("img", cover).src = safeUrl(post.coverUrl, { image: true }); $("img", cover).alt = `${post.title} 커버`; cover.hidden = false; }
      const body = $("#articleBody");
      body.replaceChildren(sanitizeToFragment(post.richHtml));
      if (!body.textContent.trim() && !$('img', body)) body.append(emptyState("본문이 없습니다", "작성자가 내용을 준비하고 있습니다."));
      const attachments = $("#articleAttachments");
      const attachmentList = $("div", attachments);
      const bodyImages = new Set($$("img", body).map((image) => image.src));
      const visibleAttachments = post.attachments.filter((file) => {
        if (!file.inlineUrl) return true;
        const absoluteInlineUrl = new URL(file.inlineUrl, location.origin).href;
        const isCover = post.coverUrl && new URL(post.coverUrl, location.origin).href === absoluteInlineUrl;
        return !isCover && !bodyImages.has(absoluteInlineUrl);
      });
      for (const file of visibleAttachments) {
        const anchor = document.createElement("a");
        anchor.className = "ed-attachment-link";
        anchor.href = file.downloadUrl;
        anchor.innerHTML = svg("file");
        const name = document.createElement("span");
        name.textContent = file.filename;
        const size = document.createElement("small");
        size.textContent = formatBytes(file.size) || getExtension(file.filename).toUpperCase();
        anchor.append(name, size);
        attachmentList.append(anchor);
      }
      attachments.hidden = !visibleAttachments.length;
      const tags = $("#articleTags");
      for (const tag of post.tags) { const node = document.createElement("span"); node.textContent = `#${tag}`; tags.append(node); }
      const key = post.id || post.slug;
      const bookmark = $("[data-bookmark-article]");
      bookmark.setAttribute("aria-pressed", String(getBookmarks().has(key)));
      bookmark.addEventListener("click", () => {
        const saved = toggleBookmark(key);
        bookmark.setAttribute("aria-pressed", String(saved));
        showToast(saved ? "북마크에 저장했습니다." : "북마크에서 삭제했습니다.");
      });
      $("[data-share-article]")?.addEventListener("click", () => sharePost(post));
      const isAdmin = Boolean(session?.profile?.isAdmin || session?.profile?.is_admin);
      const isOwner = Boolean(session?.profile?.id && session.profile.id === post.authorId);
      const canKind = post.kind === "resource" ? session?.capabilities?.writeResources : session?.capabilities?.writeDeveloperNotes;
      if (post.canEdit || isAdmin || (isOwner && canKind)) {
        const owner = $("[data-owner-actions]");
        owner.hidden = false;
        $("[data-edit-post]").href = `/editorial-write.html?id=${encodeURIComponent(post.id)}`;
        $("[data-delete-post]").addEventListener("click", async () => {
          if (!confirm("이 글과 첨부 파일을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
          try { await api(`/posts/${encodeURIComponent(post.id)}`, { method: "DELETE" }); location.href = isResource ? "/resources.html" : "/developer-notes.html"; }
          catch (error) { showToast(error.message, true); }
        });
      }
      loading.hidden = true;
      article.hidden = false;
    } catch (error) {
      loading.hidden = true;
      errorState.hidden = false;
      const description = $("p", errorState);
      if (error.status !== 404) description.textContent = error.message;
    }
  }

  function normalizeRequest(raw) {
    return {
      id: cleanText(raw?.id),
      title: cleanText(raw?.title, "자료 요청"),
      details: cleanText(raw?.details ?? raw?.description),
      category: cleanText(raw?.category, "기타"),
      status: cleanText(raw?.status, "open"),
      authorName: cleanText(raw?.author_name || raw?.authorName, "Quilo 사용자"),
      createdAt: raw?.created_at || raw?.createdAt || null,
      linkedPostId: cleanText(raw?.linked_post_id || raw?.linkedPostId),
    };
  }

  async function initResources(session) {
    const state = { posts: [], query: "", category: "", formats: new Set(), sort: "latest", requests: [] };
    const list = $("#resourceList");
    const status = $("#resourceStatus");
    const count = $("#resourceCount");
    const canManage = Boolean(session?.capabilities?.manageResourceRequests);

    function filtered() {
      let items = state.posts.filter((post) => {
        if (state.category && post.category !== state.category) return false;
        const search = `${post.title} ${post.summary} ${post.category} ${post.tags.join(" ")}`.toLocaleLowerCase("ko-KR");
        if (state.query && !search.includes(state.query.toLocaleLowerCase("ko-KR"))) return false;
        if (state.formats.size) {
          const formats = new Set(post.attachments.map((file) => getExtension(file.filename, file.mime)));
          if (![...state.formats].some((format) => formats.has(format))) return false;
        }
        return true;
      });
      if (state.sort === "title") items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
      else if (state.sort === "popular") items.sort((a, b) => b.downloadCount - a.downloadCount);
      else items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      return items;
    }

    function resourceRow(post) {
      const file = post.attachments.find((attachment) => !attachment.mime.startsWith("image/")) || post.attachments[0] || null;
      const extension = getExtension(file?.filename, file?.mime);
      const row = document.createElement("article");
      row.className = "ed-resource-item";
      const icon = document.createElement("div");
      icon.className = "ed-file-icon";
      icon.innerHTML = svg("file");
      icon.append(document.createTextNode(extension));
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      const anchor = document.createElement("a");
      anchor.href = articleHref(post);
      anchor.textContent = post.title;
      title.append(anchor);
      const summary = document.createElement("p");
      summary.textContent = post.summary;
      const meta = document.createElement("div");
      meta.className = "ed-resource-meta";
      for (const value of [post.category, formatDate(post.publishedAt), file ? formatBytes(file.size) : "설명 자료", post.downloadCount ? `${post.downloadCount.toLocaleString("ko-KR")}회 다운로드` : ""]) {
        if (!value) continue;
        const node = document.createElement("span"); node.textContent = value; meta.append(node);
      }
      copy.append(title, summary, meta);
      row.append(icon, copy);
      if (file) {
        const download = document.createElement("a");
        download.className = "ed-download-action";
        download.href = file.downloadUrl;
        download.innerHTML = `${svg("download")}<span>다운로드</span>`;
        download.setAttribute("aria-label", `${post.title} 다운로드`);
        row.append(download);
      }
      return row;
    }

    function render() {
      const items = filtered();
      list.replaceChildren();
      items.forEach((post) => list.append(resourceRow(post)));
      if (!items.length) list.append(emptyState("조건에 맞는 자료가 없습니다", "필터를 바꾸거나 아래에서 필요한 자료를 요청해 주세요."));
      count.textContent = `총 ${items.length}개 자료`;
      $("#resourceListTitle").textContent = state.category || "전체 자료";
      $("[data-count-all]").textContent = String(state.posts.length);
      $$('[data-count-category]').forEach((node) => { node.textContent = String(state.posts.filter((post) => post.category === node.dataset.countCategory).length); });
    }

    $("#resourceSearch")?.addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
    $$('input[name="resourceCategory"]').forEach((radio) => radio.addEventListener("change", () => { if (radio.checked) { state.category = radio.value; render(); } }));
    $$('[data-resource-format]').forEach((checkbox) => checkbox.addEventListener("change", () => { if (checkbox.checked) state.formats.add(checkbox.value); else state.formats.delete(checkbox.value); render(); }));
    $("#resourceSort")?.addEventListener("change", (event) => { state.sort = event.target.value; render(); });
    $$('[data-open-request]').forEach((button) => button.addEventListener("click", () => $("#requestSection")?.scrollIntoView({ behavior: "smooth" })));

    async function loadRequests() {
      try {
        const path = canManage ? "/resource-requests/manage?limit=100" : "/resource-requests?limit=100";
        const payload = await api(path);
        state.requests = arrayFrom(payload, ["requests", "items"]).map(normalizeRequest);
        renderRequests();
      } catch (error) {
        if (error.status !== 401 && canManage) showToast(error.message, true);
      }
    }

    function renderRequests() {
      const section = $("#requestHistory");
      const requestList = $("[data-request-list]");
      if (!section || !requestList) return;
      section.hidden = !state.requests.length && !canManage;
      $("[data-request-history-title]").textContent = canManage ? "자료 요청 관리" : "최근 자료 요청";
      requestList.replaceChildren();
      if (!state.requests.length) { requestList.append(emptyState("접수된 요청이 없습니다", "새 요청이 들어오면 이곳에서 확인할 수 있습니다.")); return; }
      for (const request of state.requests) {
        const row = document.createElement("article");
        row.className = "ed-request-row";
        const copy = document.createElement("div");
        const title = document.createElement("h3"); title.textContent = request.title;
        const detail = document.createElement("p"); detail.textContent = `${request.category} · ${request.authorName} · ${formatDate(request.createdAt)}${request.details ? ` — ${request.details}` : ""}`;
        copy.append(title, detail);
        const side = document.createElement("div"); side.className = "ed-request-row__side";
        const badge = document.createElement("span"); badge.className = "ed-request-status"; badge.dataset.status = request.status; badge.textContent = requestStatusLabel(request.status); side.append(badge);
        if (canManage) {
          const select = document.createElement("select");
          select.setAttribute("aria-label", `${request.title} 상태 변경`);
          for (const [value, label] of [["open","접수"],["reviewing","검토 중"],["planned","제작 예정"],["fulfilled","완료"],["declined","반려"]]) {
            const option = document.createElement("option"); option.value = value; option.textContent = label; option.selected = request.status === value; select.append(option);
          }
          select.addEventListener("change", async () => {
            select.disabled = true;
            try {
              const payload = await api(`/resource-requests/${encodeURIComponent(request.id)}/status`, { method: "PATCH", body: { status: select.value } });
              const updated = normalizeRequest(oneFrom(payload, ["request", "item"]));
              Object.assign(request, updated);
              renderRequests();
              showToast("요청 상태를 변경했습니다.");
            } catch (error) { select.value = request.status; showToast(error.message, true); }
            finally { select.disabled = false; }
          });
          side.append(select);
        }
        row.append(copy, side); requestList.append(row);
      }
    }

    $("#requestForm")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formStatus = $("#requestFormStatus");
      if (!session) {
        formStatus.textContent = "자료 요청을 보내려면 로그인이 필요합니다.";
        showToast("로그인 후 자료를 요청할 수 있습니다.", true);
        return;
      }
      const button = $('button[type="submit"]', form);
      button.disabled = true;
      formStatus.textContent = "요청을 보내는 중입니다.";
      try {
        await api("/resource-requests", { method: "POST", body: { title: $("#requestTitleInput").value, category: $("#requestCategory").value, details: $("#requestDescription").value } });
        form.reset();
        formStatus.textContent = "요청이 접수되었습니다. 진행 상태는 아래에서 확인할 수 있습니다.";
        showToast("자료 요청을 접수했습니다.");
        await loadRequests();
      } catch (error) { formStatus.textContent = error.message; showToast(error.message, true); }
      finally { button.disabled = false; }
    });
    $("[data-refresh-requests]")?.addEventListener("click", loadRequests);

    try {
      const payload = await api("/posts?kind=resource&limit=100");
      state.posts = arrayFrom(payload, ["posts", "items"]).map(normalizePost);
      await Promise.all(state.posts.map(hydrateAttachments));
      status.textContent = "";
      render();
    } catch (error) {
      status.textContent = error.message;
      list.replaceChildren(emptyState("자료를 불러오지 못했습니다", "잠시 후 다시 시도해 주세요."));
      count.textContent = "자료 목록을 확인할 수 없습니다.";
    }
    await loadRequests();
  }

  function requestStatusLabel(status) {
    return ({ open: "접수", reviewing: "검토 중", planned: "제작 예정", fulfilled: "완료", completed: "완료", declined: "반려", in_progress: "검토 중" })[status] || "접수";
  }

  const sessionPromise = loadSession();
  window.QuiloEditorial = {
    API_ROOT,
    api,
    cleanText,
    formatBytes,
    normalizeAttachment,
    normalizePost,
    safeUrl,
    sanitizeHtml,
    sanitizeToFragment,
    session: sessionPromise,
    showToast,
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const session = await sessionPromise;
    setupSharedChrome(session);
    if (page === "notes") await initNotes(session);
    else if (page === "article") await initArticle(session);
    else if (page === "resources") await initResources(session);
  });
})();
