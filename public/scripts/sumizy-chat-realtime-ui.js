// sumizy-chat-realtime-ui.js
// Dual-pane realtime UI: main(chatid) + ai(ai-chat). Join -> history -> live per pane.
// History comes via {action:"message"} (while joining).
// Live comes via {action:"event", payload.data:"[]"} or {action:"message"} after live.

/* ─────────── Debug Logger ─────────── */
(function initSumizyDebug() {
  // Set this to true in console to enable logs: window.SUMIZY_DEBUG = true
  if (typeof window.SUMIZY_DEBUG !== "boolean") window.SUMIZY_DEBUG = true;

  const NS = "sumizy-rt";
  const palette = {
    debug: "#8899aa",
    info: "#2d7ef7",
    warn: "#e5a50a",
    error: "#d11a2a",
  };
  const fmt = (lvl, msg) => [
    `%c[${NS}]%c ${lvl.toUpperCase()} %c${msg}`,
    "color:#666;font-weight:bold",
    `color:${palette[lvl] || "#999"};font-weight:bold`,
    "color:inherit",
  ];

  function emit(lvl, msg, ...rest) {
    if (!window.SUMIZY_DEBUG) return;
    const parts = fmt(lvl, msg);
    const fn =
      lvl === "error"
        ? console.error
        : lvl === "warn"
        ? console.warn
        : lvl === "info"
        ? console.info
        : console.debug;
    try {
      fn.apply(console, [...parts, ...rest]);
    } catch {}
  }

  window.__sumizyLog = {
    debug: (m, ...r) => emit("debug", m, ...r),
    info: (m, ...r) => emit("info", m, ...r),
    warn: (m, ...r) => emit("warn", m, ...r),
    error: (m, ...r) => emit("error", m, ...r),
  };
})();

const log = window.__sumizyLog;

/* ─────────── Timeline tracer ─────────── */
(function initSumizyTrace(){
  if (window.__sumizyTrace) return;
  let __seq = 0;
  const now = () => (performance?.now?.() || Date.now()) / 1000;
  const stamp = (label) => `[t+${now().toFixed(3)}s #${++__seq}] ${label}`;
  window.__sumizyTrace = function trace(label, data) {
    if (!window.SUMIZY_DEBUG) return;
    const head = stamp(label);
    try {
      if (data !== undefined) console.log(head, data);
      else console.log(head);
    } catch { console.log(head); }
  };
})();
const trace = window.__sumizyTrace;

/* ─────────── Entity→RG map + URL entity resolver ─────────── */
const ENTITY_TO_RG = {
  messaging: 1,
  discussions: 2,
  "main-chat": 3,
  tasks: 4,
  tickets: 5,
};

// Parse current URL to figure out the active entity for the MAIN pane.
// We don't need the id here—only the entity keyword to pick the RG.
function getCurrentEntityFromUrl() {
  try {
    const u = new URL(location.href);
    const path = (u.pathname || "").toLowerCase();
    // look for any of our entities as path segments
    const hit = Object.keys(ENTITY_TO_RG).find((k) =>
      path.split("/").includes(k)
    );
    if (hit) return hit;

    // fallback: query keys like ?messaging=... or ?discussions=... etc.
    const q = u.searchParams;
    for (const k of Object.keys(ENTITY_TO_RG)) {
      if (q.has(k)) return k;
    }
  } catch {}
  return null;
}

// Prefer entity→RG (deterministic). If unknown, fall back to heuristic getRGForPane.
function getRGForEntityOrPane(paneRole) {
  if (paneRole === "main") {
    const ent = getCurrentEntityFromUrl();
    const mapped = ent ? ENTITY_TO_RG[ent] : null;
    if (mapped != null && document.getElementById(`rg${mapped}`)) {
      return mapped;
    }
  }
  return getRGForPane(paneRole); // fallback to live DOM
}


/* ─────────── Helpers ─────────── */
function parseTime(t) {
  return typeof t === "number" ? t : Date.parse(t) || 0;
}

// Delegate to the canonical resolver defined in shared router
function getPaneIdsFromUrl() {
  try {
    const ids = window.getPaneIdsFromUrl?.() || { main: null, ai: null };
    log.debug("URL pane ids parsed", ids);
    return ids;
  } catch (err) {
    log.error("Failed to parse pane ids from URL", err);
    return { main: null, ai: null };
  }
}


// Logged history barrier
window.__historyBarrier = window.__historyBarrier || { main: null, ai: null };
function ensureHistoryBarrier(paneRole) {
  const cur = window.__historyBarrier[paneRole];
  if (cur) return cur;
  let resolve;
  const p = new Promise((r) => (resolve = r));
  p._resolve = () => {
    trace(`HISTORY_BARRIER_RESOLVE:${paneRole}`);
    resolve();
  };
  window.__historyBarrier[paneRole] = p;
  trace(`HISTORY_BARRIER_CREATE:${paneRole}`);
  return p;
}

/* ─────────── Optional HTTP fallback hook ───────────
   Implement window.fetchHistoryForConversation = async (chatId, paneRole) => {
     const list = await fetch(...); // get messages newest->oldest or oldest->newest
     injectHistoryAndGoLiveForPane(paneRole, chatId, list);
   };
   If not implemented, this is a no-op.
*/
if (typeof window.fetchHistoryForConversation !== "function") {
  window.fetchHistoryForConversation = null; // explicit no-op
}

// --- Smart auto-scroll to latest message (with retries & image-load awareness)
function scheduleAutoScrollToLatestForRG(rg, reason = "history") {
  if (rg == null) return;
  const container = document.querySelector(`#rg${rg} .chat-messages`);
  if (!container) return;

  // only force-scroll once per chat load (unless explicitly called with reason="history")
  const already = container.dataset.scrolledOnce === "true";
  const nearBottom = () => {
    const diff = container.scrollHeight - (container.scrollTop + container.clientHeight);
    return diff < 40; // px
  };

  const shouldForce =
    reason === "history" || !already || container.scrollTop < 20 || nearBottom();

  if (!shouldForce) return;

  const doScroll = () => {
    try {
      container.scrollTop = container.scrollHeight;
      // also try parent if it’s a scroll port
      container.parentElement?.scrollTo?.(0, container.parentElement.scrollHeight || container.scrollHeight);
    } catch {}
  };

  // a few passes to survive late layout / fonts / images
  requestAnimationFrame(doScroll);
  setTimeout(doScroll, 0);
  setTimeout(doScroll, 120);
  setTimeout(doScroll, 500);

  // one-shot image listeners: when images resolve, re-scroll
  try {
    const imgs = Array.from(container.querySelectorAll("img"));
    let pending = 0;
    const onImg = () => {
      if (--pending <= 0) setTimeout(doScroll, 16);
    };
    imgs.forEach((img) => {
      if (!img.complete) {
        pending++;
        img.addEventListener("load", onImg, { once: true });
        img.addEventListener("error", onImg, { once: true });
      }
    });
  } catch {}

  container.dataset.scrolledOnce = "true";
}





// helper: run Bubble fn when a real AI message is rendered
function maybeHideLoadingOnAIMsg(m) {
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3";
  if (!m || !m.id || m.id === "typing-indicator") return; // ignore the animated placeholder
  if (String(m.user_id) !== AI_USER_ID) return;
  if (typeof window.bubble_fn_hideLoading100 === "function") {
    try { window.bubble_fn_hideLoading100(); } catch {}
  }
}


// warn only once per session for multiple mains
let __warnedMultipleMain = false;


// Find the RG number for a given pane role by [data-pane="<role>"]
function getRGForPane(paneRole) {
  const nodes = Array.from(
    document.querySelectorAll(`[id^="rg"][data-pane="${paneRole}"]`)
  );
  if (!nodes.length) return null;

  nodes.sort((a, b) => {
    const na = parseInt((a.id.match(/\d+/) || [0])[0], 10);
    const nb = parseInt((b.id.match(/\d+/) || [0])[0], 10);
    return nb - na; // newest first
  });

  const pick =
    nodes.find(el => el.offsetParent && el.querySelector('.chat-messages')) ||
    nodes.find(el => el.offsetParent) ||
    nodes.find(el => el.querySelector('.chat-messages')) ||
    nodes[0];

  // ❌ do NOT remove the others
  const m = String(pick.id).match(/\d+/);
  const rgNum = m ? parseInt(m[0], 10) : null;
  return Number.isFinite(rgNum) ? rgNum : null;
}




// Pane-aware AI detection helpers
function isNodeInAIPane(node) {
  if (!node || !node.closest) return false;
  return !!node.closest('[id^="rg"][data-pane="ai"]');
}

window.isAIChat = function (node) {
  if (node) return isNodeInAIPane(node);
  try {
    const q = new URLSearchParams(location.search);
    return !!(
      q.get("ai-chat") || document.querySelector('[id^="rg"][data-pane="ai"]')
    );
  } catch {
    return false;
  }
};

// PaneKey helpers
const paneKeyOf = (paneRole, chatId) => `${paneRole}:${chatId}`;
const keyParts = (paneKey) => {
  const i = String(paneKey).indexOf(":");
  return i >= 0
    ? { paneRole: paneKey.slice(0, i), chatId: paneKey.slice(i + 1) }
    : { paneRole: "main", chatId: String(paneKey) };
};

function clearPaneDom(paneRole) {
  if (paneRole === "ai") return; // keep your current preserve behavior
  const rg = getRGForEntityOrPane(paneRole);
  const container = rg && document.querySelector(`#rg${rg} .chat-messages`);
  if (!container) {
    log.warn("clearPaneDom skipped (no container)");
    return;
  }
  container.innerHTML = "";
  const wrap = container.closest(`[id^="rg"]`);
  if (wrap)
    (wrap.querySelector(".chat-messages") || {}).dataset.scrolledOnce = "false";
  if (typeof window.hideAITypingIndicator === "function")
    try {
      window.hideAITypingIndicator();
    } catch {}
  log.info("Cleared pane DOM", { paneRole, rg });
}



function safeSelId(id) {
  const s = String(id ?? "");
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}
function _esc(s) {
  if (typeof window.esc === "function") return window.esc(s);
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// sumizy-chat-realtime-ui.js (near other helpers)
function waitForPaneContainer(paneRole, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const rg = getRGForEntityOrPane(paneRole);
      const el =
        rg != null ? document.querySelector(`#rg${rg} .chat-messages`) : null;

      // Fallback: any visible pane with chat-messages
      const any =
        el ||
        document.querySelector(
          `[id^="rg"][data-pane="${paneRole}"] .chat-messages`
        );

      if (any) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      requestAnimationFrame(tick);
    };
    tick();
  });
}



// >>> PATCH: wait for realtime channel to be callable
function waitForChannelReady(timeoutMs = 20000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (typeof isChannelReady === "function" && isChannelReady()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

// --- History nudge: resend a JOIN in the original format ---
window.requestHistoryNudge = function requestHistoryNudge(conversation_id, paneRole = "main") {
  try {
    const info = window.currentChannel;
    if (!info || !isChannelReady()) {
      trace("NUDGE:SKIP (channel not ready)", { conversation_id, paneRole });
      return;
    }
    const payload = {
      isReaction: false,
      isDelete: false,
      isJoin: true,       // <- EXACT same schema as your normal JOIN
      conversation_id,
      message: ""
    };
    trace("NUDGE:RESEND_JOIN", { conversation_id, paneRole });
    const ch = window.xanoRealtime?.[info.channelKey]?.channel;
    if (ch && typeof ch.message === "function") ch.message(payload);
  } catch (e) {
    trace("NUDGE:ERROR", { err: String(e) });
  }
};




/* ─────────── Reactions aggregation (fallback when no window.agg) ─────────── */
function aggregateReactionsFallback(raw, currentUserId) {
  const map = new Map();
  for (const r of raw || []) {
    const emoji = r?.emoji || r?.e || r?.key || r?.symbol;
    if (!emoji) continue;
    let entry = map.get(emoji);
    if (!entry) {
      entry = { emoji, count: 0, users: [], userIds: [], mine: false };
      map.set(emoji, entry);
    }
    entry.count++;
    const uid = r?.user_id;
    if (uid) {
      entry.userIds.push(uid);
      if (currentUserId && String(uid) === String(currentUserId)) {
        entry.mine = true;
      }
    }
    if (r?._user) entry.users.push(r._user);
  }
  return Array.from(map.values());
}

// File message node sanitization (images)
function sanitizeInjectedFileMessageNode(el, msg) {
  if (!el || !msg?.isFile) return;
  const type = String(msg.file_type || "").toLowerCase();
  const urlStr = String(msg.message || "");
  const isImg =
    type.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(urlStr);
  if (!isImg) return;

  el.querySelectorAll(
    ":scope > .message-content-wrapper > .message-text"
  ).forEach((n) => n.remove());
  const wrap = el.querySelector(".message-content-wrapper") || el;
  let fa = wrap.querySelector(":scope > .file-attachment");
  const safeUrl = urlStr || "#";
  if (!fa) {
    wrap.insertAdjacentHTML(
      "beforeend",
      `<div class="file-attachment image-attachment" data-url="${_esc(
        safeUrl
      )}" data-name="${_esc(msg.file_name || "")}" data-type="${_esc(type)}">
         <a href="#" class="file-open-trigger" tabindex="0">
           <img src="${_esc(safeUrl)}" alt="" class="file-image-preview">
         </a>
       </div>`
    );
  } else {
    fa.classList.add("image-attachment");
    fa.classList.remove("generic-attachment");
    const nm = fa.querySelector(".file-name");
    if (nm) nm.remove();
  }
  el.dataset.message = "";
}

/* PATCH: Read receipts (normalizer + renderer + updater) */
// Accepts various shapes; all entries mean "has read".
window.getReaders = function getReaders(msg) {
  const raw = msg._read_by ?? msg.read_by ?? msg.readBy ?? msg.readers ?? msg.seen_by ?? [];
  if (Array.isArray(raw) && (raw.length === 0 || typeof raw[0] === "string")) {
    return raw.map((id) => ({ user_id: String(id), _user: null }));
  }
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      const uid = r?.user_id ?? r?.userId ?? r?.id ?? r?.user?.id ?? null;
      const userObj = r?._user ?? r?.user ?? null;
      return uid ? { user_id: String(uid), _user: userObj } : null;
    }).filter(Boolean);
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([uid, v]) => {
      const userObj = v && typeof v === "object" ? (v._user ?? v.user ?? null) : null;
      return { user_id: String(uid), _user: userObj };
    });
  }
  return [];
};

window.renderReadReceipts = function renderReadReceipts(readers, currentUserId) {
  if (!Array.isArray(readers) || readers.length === 0) return "";
  const uniq = new Map();
  readers.forEach((r) => { if (r?.user_id) uniq.set(String(r.user_id), r); });
  const list = Array.from(uniq.values());

  const labelNames =
    list.map((r) => (r?._user?.name || "Unknown")).slice(0, 3).join(", ")
    + (list.length > 3 ? ` +${list.length - 3}` : "");

  const avatar = (r) => {
    const name = r?._user?.name || "";
    const pic = r?._user?.profilePicture || "";
    const initial = name ? name.charAt(0).toUpperCase() : "•";
    if (pic) {
      return `<span class="read-avatar" title="${_esc(name)}"><img src="${_esc(pic)}" alt="${_esc(name)}" onerror="this.replaceWith(document.createTextNode('${initial}'))"></span>`;
    }
    return `<span class="read-avatar initials" title="${_esc(name)}">${_esc(initial)}</span>`;
  };

  const avatars = list.slice(0, 5).map(avatar).join("");
  return `<div class="read-receipts" aria-label="Seen by ${_esc(labelNames)}">${avatars}<span class="read-count">${list.length}</span></div>`;
};

window.updateReadReceiptsInPlace = function updateReadReceiptsInPlace(msgEl, msg) {
  if (!msgEl || !msg) return;
  const parent = msgEl.querySelector(".message-content-wrapper") || msgEl;
  parent.querySelectorAll(":scope > .read-receipts").forEach((n) => n.remove());
  const readers = window.getReaders(msg);
  const html = window.renderReadReceipts(readers, window.currentUserId);
  if (html) parent.insertAdjacentHTML("beforeend", html);
};



/* ─────────── In-place updaters (no node swaps) ─────────── */
function updateMessageTextsInPlace(msgEl, msg, { forDelete = false } = {}) {
  // Notification flag styling/data
  if (typeof msg.is_notification === "boolean") {
    msgEl.classList.toggle("is-notification", !!msg.is_notification);
    msgEl.dataset.notification = String(!!msg.is_notification);
  }
  const contentWrap = msgEl.querySelector(".message-content-wrapper") || msgEl;

  // File messages: keep attachment, no URL text
  if (msg?.isFile) {
    const contentWrap2 =
      msgEl.querySelector(".message-content-wrapper") || msgEl;

    contentWrap2
      .querySelectorAll(":scope > .message-text")
      .forEach((n) => n.remove());

    const url = msg.message || "#";
    const name = msg.file_name || url.split("/").pop() || "download";
    const type = String(msg.file_type || "").toLowerCase();
    const isImg =
      type.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);

    let fa = contentWrap2.querySelector(":scope > .file-attachment");
    if (!fa) {
      const html = isImg
        ? `<div class="file-attachment image-attachment" data-url="${_esc(
            url
          )}" data-name="${_esc(name)}" data-type="${_esc(type)}">
             <a href="#" class="file-open-trigger" tabindex="0">
               <img src="${_esc(url)}" alt="" class="file-image-preview">
             </a>
           </div>`
        : typeof window.renderFileAttachment === "function"
        ? window.renderFileAttachment(msg)
        : `<div class="file-attachment generic-attachment" data-url="${_esc(
            url
          )}" data-name="${_esc(name)}" data-type="${_esc(type)}">
               <a href="#" class="file-open-trigger" tabindex="0">
                 <span class="file-icon">📎</span><span class="file-name">${_esc(
                   name
                 )}</span>
               </a>
             </div>`;
      contentWrap2.insertAdjacentHTML("beforeend", html);
      fa = contentWrap2.querySelector(":scope > .file-attachment");
    } else {
      fa.dataset.url = url;
      fa.dataset.name = name;
      fa.dataset.type = type;
      fa.classList.toggle("image-attachment", isImg);
      fa.classList.toggle("generic-attachment", !isImg);
      const img = fa.querySelector(".file-image-preview");
      if (isImg && img) {
        if (img.src !== url) img.src = url;
        img.alt = "";
      }
      if (isImg) {
        const nm = fa.querySelector(".file-name");
        if (nm) nm.remove();
      }
    }

    msgEl.dataset.message = isImg ? "" : name;
    updateReplyPreviewsForMessage(msg);
    log.debug("updateMessageTextsInPlace:file", { id: msg.id, isImg, name });
    return;
  }

  // A "real" translation = non-"original" lang with non-empty text
  const translations = Array.isArray(msg._translations)
    ? msg._translations
    : [];

  // A "real" translation = non-"original" lang with non-empty text
  const hasRealTranslations = translations.some((t) => {
    const lang = String(t?.language || "").toLowerCase();
    const txt = t?.translated_text;
    return (
      lang && lang !== "original" && txt != null && String(txt).trim() !== ""
    );
  });

  // Common fallback texts per language
  const FALLBACK_TEXT = {
    en: "Translation not available yet",
    ja: "翻訳はまだありません",
    zh: "翻译尚未提供",
    fr: "Traduction pas encore disponible",
    es: "Traducción aún no disponible",
    vi: "Bản dịch hiện chưa có",
  };

  // We only ever expect short codes like "en", "es", "ja"
  const enTr = translations.find(
    (t) => String(t?.language || "").toLowerCase() === "en"
  );

  const deleteText =
    (enTr && enTr.translated_text) ||
    msg.message ||
    "メッセージが削除されました / Message Unsent";

  const original =
    contentWrap.querySelector(":scope > .message-text.lang-original") ||
    contentWrap.querySelector(":scope > .message-text:not([class*='lang-'])") ||
    (() => {
      const d = document.createElement("div");
      d.className = "message-text lang-original";
      contentWrap.appendChild(d);
      return d;
    })();

  // Pane-aware AI markdown for ORIGINAL text (fix)
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3";
  const isAIMessage = String(msg.user_id) === AI_USER_ID;
  const inAIPane =
    isNodeInAIPane(msgEl) ||
    (typeof window.isAIChat === "function" && window.isAIChat(msgEl));

  if (original) {
    const txt = forDelete ? deleteText : msg.message ?? "";
    if (inAIPane && isAIMessage && typeof window.parseMarkdown === "function") {
      original.innerHTML = window.parseMarkdown(txt);
      log.debug("Rendered ORIGINAL with Markdown (AI pane)", {
        id: msg.id,
        len: txt.length,
      });
    } else {
      original.textContent = txt;
    }
  }

  // For translations we already render with Markdown in AI pane
  const renderTr = (txt) => {
    const s = String(txt || "");
    if (inAIPane && isAIMessage && typeof window.parseMarkdown === "function") {
      return window.parseMarkdown(s);
    }
    return _esc(s);
  };

  for (const t of translations) {
    const lang = String(t?.language || "").toLowerCase();
    if (!lang || lang === "original") continue;
    let node = contentWrap.querySelector(`:scope > .message-text.lang-${lang}`);
    if (!node) {
      node = document.createElement("div");
      node.className = `message-text lang-${lang}`;
      node.style.display = "none";
      contentWrap.appendChild(node);
    }

    const rawTxt = t?.translated_text;
    const hasText = rawTxt != null && String(rawTxt).trim() !== "";
    const fallback =
      FALLBACK_TEXT[lang] ||
      FALLBACK_TEXT.en ||
      "Translation not available yet";
    const finalText = hasText ? rawTxt : fallback;

    node.innerHTML = renderTr(finalText);
  }

  // If there are no *real* translations yet, inject EN/JA/... placeholders
if (!msg?.isFile && !hasRealTranslations) {
  const placeholders = [
    { language: "en", text: FALLBACK_TEXT.en },
    { language: "ja", text: FALLBACK_TEXT.ja },
    { language: "zh", text: FALLBACK_TEXT.zh },
    { language: "fr", text: FALLBACK_TEXT.fr },
    { language: "es", text: FALLBACK_TEXT.es },
    { language: "vi", text: FALLBACK_TEXT.vi },
  ];
  for (const p of placeholders) {
    let node = contentWrap.querySelector(
      `:scope > .message-text.lang-${p.language}`
    );
    if (!node) {
      node = document.createElement("div");
      node.className = `message-text lang-${p.language}`;
      node.style.display = "none";
      contentWrap.appendChild(node);
    }
    node.innerHTML = renderTr(p.text);
  }
}


  if (typeof msg.message === "string") {
    msgEl.dataset.message = msg.message;
  }

  log.debug("updateMessageTextsInPlace:text", {
    id: msg.id,
    forDelete,
    hasTranslations: !!translations.length,
    inAIPane,
    isAIMessage,
    isNotification: !!msg.is_notification,
  });
}

function updateReactionsInPlace(msgEl, msg, currentUserId) {
    // Notifications have no reactions
  if (msg?.is_notification) {
    const rBox = msgEl.querySelector(".reactions");
    if (rBox) rBox.remove();
    return;
  }
  const containerParent =
    msgEl.querySelector(".message-content-wrapper") || msgEl;

  const raw = Array.isArray(msg._reactions) ? msg._reactions : [];
  let aggregated = null;
  if (typeof window.agg === "function") {
    try {
      aggregated = window.agg(raw);
    } catch {
      aggregated = null;
    }
  }
  if (!aggregated) aggregated = aggregateReactionsFallback(raw, currentUserId);

  let rBox = msgEl.querySelector(".reactions");
  if (!aggregated.length) {
    if (rBox) rBox.remove();
    return;
  }

  if (!rBox) {
    rBox = document.createElement("div");
    rBox.className = "reactions";
    containerParent.appendChild(rBox);
  }

  const existing = new Map();
  Array.from(rBox.querySelectorAll(".reaction")).forEach((chip) => {
    const e = chip.getAttribute("data-emoji");
    if (e) existing.set(e, chip);
  });

  const seen = new Set();
  for (const r of aggregated) {
    // Accept both shapes: {e,c,userIds,users} or {emoji,count,userIds,users}
    const emoji = r.e ?? r.emoji ?? r.key ?? r.symbol;
    if (!emoji) continue;

    const count = Number(r.c ?? r.count ?? 0);

    // Prefer explicit userIds; otherwise derive from users if available
    let userIds = Array.isArray(r.userIds) ? r.userIds : [];
    if (!userIds.length && Array.isArray(r.users)) {
      userIds = r.users
        .map((u) => u?.user_id ?? u?.id ?? u?.userId ?? null)
        .filter(Boolean);
    }

    const mine = currentUserId
      ? userIds.map(String).includes(String(currentUserId))
      : false;

    seen.add(emoji);

    let chip = existing.get(emoji);
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "reaction";
      chip.setAttribute("data-emoji", emoji);
      chip.innerHTML = `<span class="reaction-emoji"></span><span class="reaction-count"></span>`;
      rBox.appendChild(chip);
    }

    chip.classList.toggle("user-reacted", !!mine);
    chip.querySelector(".reaction-emoji").textContent = emoji;
    chip.querySelector(".reaction-count").textContent = String(count);
    chip.dataset.users = JSON.stringify(r.users || []);
    chip.dataset.userIds = JSON.stringify(userIds);
  }
  

  for (const [emoji, chip] of existing) {
    if (!seen.has(emoji)) chip.remove();
  }

  if (!rBox.querySelector(".reaction")) rBox.remove();

  log.debug("updateReactionsInPlace", {
    id: msg.id,
    aggregatedCount: aggregated.length,
  });

  // PATCH: ensure receipts persist after reaction updates
  if (typeof window.updateReadReceiptsInPlace === "function") {
    try {
      window.updateReadReceiptsInPlace(msgEl, msg);
    } catch {}
  }
}

/* ─────────── Reply preview updater ─────────── */
function updateReplyPreviewsForMessage(msg) {
  const id = String(msg?.id || "");
  if (!id) return;

  const selId =
    window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const nodes = document.querySelectorAll(
    `.reply-preview[data-target-id="${selId}"]`
  );
  if (!nodes.length) return;

  const name =
    (msg?._user && msg._user.name) ||
    (msg?._users && msg._users.name) ||
    "Unknown";
  const isDeleted = !!msg?.isDeleted;

  const pickDisplayText = (m) => {
    const raw = (m?.message || "").trim();
    if (raw) return raw;
const trs = Array.isArray(m?._translations) ? m._translations : [];
// Only match exact "en" since backend sends short codes
const en = trs.find((t) => String(t?.language || "").toLowerCase() === "en");

    if (en?.translated_text) return en.translated_text;
    if (trs[0]?.translated_text) return trs[0].translated_text;
    return "メッセージが削除されました / Message Unsent";
  };

  const displayText = pickDisplayText(msg);

  let bodyHTML = "";
  if (msg?.isFile && !isDeleted) {
    const url = _esc(msg.message || "#");
    const fname = _esc(msg.file_name || url.split("/").pop() || "download");
    const type = (msg.file_type || "").toLowerCase();
    const isImg =
      type.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
    const cls = isImg ? "image-attachment" : "generic-attachment";
    const thumb = isImg
      ? `<img src="${url}" alt="${fname}" class="file-image-preview">`
      : `<span class="file-icon">📎</span>`;
    bodyHTML = `
      <div class="file-attachment ${cls}" data-url="${url}" data-name="${fname}" data-type="${_esc(
      type
    )}">
        <a href="#" class="file-open-trigger" tabindex="0">
          ${thumb}<span class="file-name">${fname}</span>
        </a>
      </div>`;
  } else {
    bodyHTML = `<div class="message-text lang-original">${_esc(
      displayText
    )}</div>`;
  }

  nodes.forEach((node) => {
    const header = node.querySelector(".reply-preview-header .reply-to-name");
    if (header) header.textContent = name;

    const children = Array.from(node.children);
    children.forEach((c, i) => {
      if (i > 0) c.remove();
    });

    node.insertAdjacentHTML("beforeend", bodyHTML);
    if (isDeleted) {
      node.dataset.deleted = "true";
      node.classList.add("is-deleted");
    } else {
      node.dataset.deleted = "false";
      node.classList.remove("is-deleted");
    }
  });

  log.debug("updateReplyPreviewsForMessage", { id, nodes: nodes.length });
}

/* ─────────── In-place patcher ─────────── */
function patchMessageInPlace(rg, msg) {
  if (!rg || !msg || !msg.id) return false;
  const container = document.querySelector(`#rg${rg} .chat-messages`);
  if (!container) return false;

  const el = container.querySelector(
    `.message[data-id="${safeSelId(msg.id)}"]`
  );
  if (!el) return false;

  if (typeof msg.isDeleted === "boolean") {
    el.dataset.deleted = String(!!msg.isDeleted);
    el.classList.toggle("is-deleted", !!msg.isDeleted);
  }

  if (typeof msg.is_notification === "boolean") {
    el.dataset.notification = String(!!msg.is_notification);
    el.classList.toggle("is-notification", !!msg.is_notification);
  }

  if (msg.created_at != null) {
    const ts = parseTime(msg.created_at);
    if (!Number.isNaN(ts)) el.dataset.ts = String(ts);
  }

  updateMessageTextsInPlace(el, msg, { forDelete: !!msg.isDeleted });
  updateReactionsInPlace(el, msg, window.currentUserId);
  updateReplyPreviewsForMessage(msg);
  if (typeof window.updateReadReceiptsInPlace === "function") {
    window.updateReadReceiptsInPlace(el, msg);
  }

  maybeHideLoadingOnAIMsg(msg);

  log.info("Patched message in place", { rg, id: msg.id });
  // record UI activity for the pane that owns this rg
  try {
    const rgEl = document.getElementById(`rg${rg}`);
    const paneRole = rgEl?.dataset?.pane || "main";
    const chatId = window._paneActive?.[paneRole] || null;
    const st = getStateForPane(paneRole, chatId);
    if (st) st.lastActivityAt = Date.now();
  } catch {}

  return true;
}

/* ─────────── Per-pane chat state ─────────── */
window._paneActive = window._paneActive || { main: null, ai: null }; // chatId per pane
window._chatGen = window._chatGen || 0; // increments on route change
window._paneState = window._paneState || {}; // keyed by paneKey: "main:<chatId>"

function getStateForPane(paneRole, chatId) {
  if (!chatId) return null;
  const key = paneKeyOf(paneRole, chatId);
  return (window._paneState[key] ||= {
    phase: "idle", // idle -> join_sent -> injecting_history -> live
    seen: new Set(),
    lastTs: 0, // last message ts seen
    lastActivityAt: 0, // last time we updated DOM
    lastJoinSentAt: 0, // last time we sent a join
    lastNudgeAt: 0, // last time watchdog nudged
    watchdogMuteUntil: 0, // mute watchdog until this time
    prebuffer: [],
    joinGen: -1,
    joinDispatched: false,
    joinPending: false,
    joinRetryTid: 0,
    joinRetryCount: 0,
    historyNudgeTid: 0,
    httpFallbackTid: 0,
  });
}


function resetStateForPane(paneRole, chatId) {
  if (!chatId) return;
  const key = paneKeyOf(paneRole, chatId);
  window._paneState[key] = {
    phase: "idle",
    seen: new Set(),
    lastTs: 0,
    lastActivityAt: 0,
    lastJoinSentAt: 0,
    lastNudgeAt: 0,
    watchdogMuteUntil: 0,
    prebuffer: [],
    joinGen: -1,
    joinDispatched: false,
    joinPending: false,
    joinRetryTid: 0,
    joinRetryCount: 0,
    historyNudgeTid: 0, // <-- add
    httpFallbackTid: 0, // <-- add
  };
  
  
  log.info("Pane state reset", { paneRole, chatId });
  return window._paneState[key];
}

/* ─────────── History + live injection (pane) ─────────── */
function dedupeById(list, seenSet) {
  const out = [];
  const local = new Set();
  for (const m of list || []) {
    const id = String(m?.id ?? "");
    if (!id || local.has(id) || seenSet.has(id)) continue;
    local.add(id);
    out.push(m);
  }
  return out;
}
function sortAscByTs(list) {
  return (list || [])
    .slice()
    .sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at));
}
function afterInjectUiRefresh(rg) {
  const refreshFn = `bubble_fn_refreshConversations${rg}`;
  if (typeof window[refreshFn] === "function") {
    try {
      window[refreshFn]();
    } catch {}
  }
  if (typeof window.hideAITypingIndicator === "function") {
    try {
      window.hideAITypingIndicator();
    } catch {}
  }
  log.debug("afterInjectUiRefresh", { rg });
}

function injectBatchForPane(paneRole, chatId, batch) {
  if (!batch?.length) return;
  const rg = getRGForEntityOrPane(paneRole);
  if (rg == null) return;
  if (typeof window.injectMessages !== "function") return;

  log.info("Inject batch", { paneRole, chatId, rg, count: batch.length });
  window.injectMessages(rg, batch, window.currentUserId);

  for (const m of batch) {
    if (!m?.id) continue;
    const el = document.querySelector(
      `#rg${rg} .chat-messages .message[data-id="${safeSelId(m.id)}"]`
    );
    sanitizeInjectedFileMessageNode(el, m);
        // PATCH: attach receipts during injection
        if (typeof window.updateReadReceiptsInPlace === "function") {
          try { window.updateReadReceiptsInPlace(el, m); } catch {}
        }
  }

  // Ensure AI styling + markdown render immediately for AI pane
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3";
  if (paneRole === "ai") {
    for (const m of batch) {
      if (!m?.id) continue;
      const el = document.querySelector(
        `#rg${rg} .chat-messages .message[data-id="${safeSelId(m.id)}"]`
      );
      if (!el) continue;

      if (String(m.user_id) === AI_USER_ID) {
        el.classList.add("ai-message");
      }

      try {
        updateMessageTextsInPlace(el, m, { forDelete: !!m.isDeleted });
        if (typeof window.updateReadReceiptsInPlace === "function") {
          try {
            window.updateReadReceiptsInPlace(el, m);
          } catch {}
        }
        maybeHideLoadingOnAIMsg(m);

      } catch (e) {
        log.warn("AI markdown re-render failed", { id: m.id, e });
      }
    }
  }

  const st = getStateForPane(paneRole, chatId);
  if (!st) return;
  for (const m of batch) {
    if (m?.id) st.seen.add(String(m.id));
    if (m?.created_at != null) {
      const ts = parseTime(m.created_at);
      if (ts > st.lastTs) st.lastTs = ts;
    }
  }
  st.lastActivityAt = Date.now();
  afterInjectUiRefresh(rg);
}

function injectHistoryAndGoLiveForPane(paneRole, chatId, incomingHistory) {
  const activeId = window._paneActive[paneRole];
  if (!activeId || activeId !== chatId) return;

  const st = getStateForPane(paneRole, chatId);
  if (!st) return;

  st.phase = "injecting_history";
  trace("HISTORY:START", {
    paneRole,
    chatId,
    incoming: (incomingHistory || []).length,
    prebuffer: st.prebuffer.length,
  });

  const combined = dedupeById(
    [...(incomingHistory || []), ...(st.prebuffer || [])],
    st.seen
  );
  const ordered = sortAscByTs(combined);

  log.info("Inject history & go live", {
    paneRole,
    chatId,
    incomingCount: (incomingHistory || []).length,
    prebufferCount: st.prebuffer.length,
    orderedCount: ordered.length,
  });

  if (ordered.length) {
    // Only clear if we haven't rendered anything yet
    const rg = getRGForEntityOrPane(paneRole);
    const container =
      rg != null ? document.querySelector(`#rg${rg} .chat-messages`) : null;
    const hasExistingNodes = !!(
      container && container.querySelector(".message")
    );
    if (!hasExistingNodes) {
      clearPaneDom(paneRole);
    }
    injectBatchForPane(paneRole, chatId, ordered);
  }
  try {
    const rg = getRGForEntityOrPane(paneRole);
    if (rg != null) scheduleAutoScrollToLatestForRG(rg, "history");
  } catch {}

  st.prebuffer = [];
  trace("HISTORY:GO_LIVE", { paneRole, chatId, orderedCount: ordered.length });

  // D: seed seen + lastTs from injected history
  if (!st.seen) st.seen = new Set();
  let maxTs = st.lastTs || 0;
  for (const m of ordered) {
    const id = String(m?.id || "");
    if (id) st.seen.add(id);
    const c = parseTime(m?.created_at);
    const u = m?.updated_at ? parseTime(m.updated_at) : 0;
    const t = Math.max(c || 0, u || 0);
    if (t > maxTs) maxTs = t;
  }
  st.lastTs = maxTs || Date.now();

  st.phase = "live";
  st.lastActivityAt = Date.now();
  // keep the longer of the two windows (25s vs 6s)
  const baseMuteMs = 25000,
    extraMuteMs = 6000;
  st.watchdogMuteUntil = Date.now() + Math.max(baseMuteMs, extraMuteMs);
  
  try {
    ensureHistoryBarrier(paneRole)._resolve?.();
  } catch {}
}

window.currentChatId ??= function currentChatId() {
  return window._paneActive?.main || window._paneActive?.ai || null;
};


/* ─────────── Channel join/leave/send (unchanged) ─────────── */
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
  if (!userId || !authToken || !realtimeHash) return;
  try {
    const channelName = `sumizy/${userId}`;
    if (!window.xano) return;

    log.info("joinChannel: starting", { userId, channelName });

    window.xano.setAuthToken(authToken);
    window.xano.setRealtimeAuthToken(authToken);
    if (typeof window.xano.realtimeReconnect === "function") {
      window.xano.realtimeReconnect();
    }

    const channelKey = channelName.split("/").join("_");
    window.xanoRealtime = window.xanoRealtime || {};
    const already = !!(window.xanoRealtime && window.xanoRealtime[channelKey]);
    const channel = already
      ? window.xanoRealtime[channelKey].channel
      : window.xano.channel(channelName, { ...channelOptions });

    if (!already) {
      log.debug("joinChannel: wiring channel.on handler", { channelKey });
      channel.on((data) => {
        const stMain = getStateForPane("main", currentChatId());
        if (stMain) stMain.lastActivityAt = Date.now();
        const stAI = getStateForPane("ai", currentChatId());
        if (stAI) stAI.lastActivityAt = Date.now();

        try {
          log.debug("RT inbound", data);
          trace("RT:INBOUND", {
            action: data?.action,
            hasPayload: !!data?.payload,
            payloadType: typeof data?.payload,
          });

          // --- FAST PATH: handle refresh events (e.g., {"refresh":"thing"}) ---
          try {
            if (data?.action === "event") {
              // Prefer RG-scoped Bubble function; fall back to global.
              const handled =
                (typeof window.handleRefreshEventWithRG === "function" &&
                  window.handleRefreshEventWithRG(data)) ||
                (typeof window.handleRefreshEvent === "function" &&
                  window.handleRefreshEvent(data));

              // If a refresh handler ran (e.g., bubble_fn_refreshThing()), stop here.
              if (handled) return;
            }
          } catch {}
          // --- end refresh fast path ---

          let incoming = [];
          if (data?.action === "message") {
            incoming = Array.isArray(data.payload) ? data.payload : [];
          } else if (data?.action === "event") {
            const raw = data?.payload?.data;
            let parsed = null;
            if (typeof raw === "string") {
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = null;
              }
            } else {
              parsed = raw;
            }
            if (Array.isArray(parsed)) incoming = parsed;
            else return;
          } else {
            return;
          }
          if (!incoming.length) return;

          const activeMain = window._paneActive.main;
          const activeAI = window._paneActive.ai;

          const byPane = {
            main: activeMain
              ? incoming.filter(
                  (m) => String(m?.conversation_id ?? "") === String(activeMain)
                )
              : [],
            ai: activeAI
              ? incoming.filter(
                  (m) => String(m?.conversation_id ?? "") === String(activeAI)
                )
              : [],
          };

          trace("RT:BY_PANE", {
            main: byPane.main.length,
            ai: byPane.ai.length,
          });

          log.debug("RT relevant per pane", {
            main: byPane.main.length,
            ai: byPane.ai.length,
          });

          for (const paneRole of ["main", "ai"]) {
            const chatId = window._paneActive[paneRole];
            if (!chatId) continue;

            let relevant = byPane[paneRole];
            if (!relevant?.length) continue;

            const rg = getRGForEntityOrPane(paneRole);
            const st = getStateForPane(paneRole, chatId);
            if (!st) continue;
            // E1: any message traffic counts as activity
            st.lastActivityAt = Date.now();
            



            // In-place patch
            const updatedIds = new Set();
            if (rg != null) {
              for (const m of relevant) {
                if (!m || !m.id) continue;
                const exists = document.querySelector(
                  `#rg${rg} .chat-messages .message[data-id="${safeSelId(
                    m.id
                  )}"]`
                );
                if (exists) {
                  if (patchMessageInPlace(rg, m)) {
                    st.seen.add(String(m.id));
                    const ts = parseTime(m.created_at);
                    if (ts > st.lastTs) st.lastTs = ts;
                    updatedIds.add(String(m.id));
                  }
                }
              }
              if (updatedIds.size > 0) {
                log.info("Patched existing messages", {
                  paneRole,
                  count: updatedIds.size,
                });
                trace("RT:PATCHED_EXISTING", {
                  paneRole,
                  count: updatedIds.size,
                });

                afterInjectUiRefresh(rg);
              }
            }
            // Only now consider items that weren't already patched
let pending = relevant.filter((m) => !updatedIds.has(String(m?.id)));

// For LIVE, drop old history among *non-existing* nodes only
if (st.phase === "live") {
  const hasUpdatedAt = (m) =>
    m && m.updated_at != null && !Number.isNaN(parseTime(m.updated_at));
  const newerThan = (m, t) => {
    const c = parseTime(m.created_at);
    const u = hasUpdatedAt(m) ? parseTime(m.updated_at) : 0;
    return (u || c) > t;
  };
  pending = pending.filter((m) => {
    const id = String(m?.id || "");
    if (!id) return false;
    // unseen OR clearly newer/edited
    return !st.seen.has(id) || newerThan(m, st.lastTs);
  });
}


            if (
              st.phase === "join_sent" ||
              st.phase === "injecting_history" ||
              st.phase === "idle"
            ) {
              if (data.action === "message") {
                trace("RT:INJECT_HISTORY", {
                  paneRole,
                  count: relevant.length,
                  phase: st.phase,
                });

                injectHistoryAndGoLiveForPane(paneRole, chatId, pending);

              } else {
                const fresh = dedupeById(pending, st.seen);

                if (fresh.length) {
                  st.prebuffer.push(...fresh);
                  for (const m of fresh) {
                    const ts = parseTime(m.created_at);
                    if (ts > st.lastTs) st.lastTs = ts;
                  }
                  log.debug("Buffered live pre-join", {
                    paneRole,
                    added: fresh.length,
                    prebufferSize: st.prebuffer.length,
                  });
                }
              }
              continue;
            }

            if (st.phase === "live") {
              const fresh = dedupeById(pending, st.seen);
              if (!fresh.length) continue;
              
              const toAppend = sortAscByTs(fresh).filter(
                (m) => parseTime(m.created_at) >= st.lastTs
              );
              
trace("RT:APPEND_LIVE", { paneRole, add: toAppend.length, phase: st.phase });

              if (!toAppend.length) continue;

              log.info("Appending live", {
                paneRole,
                add: toAppend.length,
              });
              // Ensure any pending barrier is released if we got live first
try { ensureHistoryBarrier(paneRole)._resolve?.(); } catch {}

              injectBatchForPane(paneRole, chatId, toAppend);
            }
          }
        } catch (err) {
          log.error("channel.on handler error", err);
        }
      });
    }

    window.currentChannel = {
      userId,
      channelName,
      channelKey,
      channel,
      authToken,
      realtimeHash,
      joinedAt: Date.now(),
    };
    window.currentUserId = userId;
    window.xanoRealtime[channelKey] = { channel };
    // Channel is callable now — flush anything queued before readiness.
    try {
      flushOutboundQueue();
    } catch {}
    

    trace("JOIN_CHANNEL:READY", { channelKey, userId });

    // Optional diagnostic waits that don’t block your flow
    (async () => {
      try {
        if (window._paneActive?.main) {
          trace("WAIT:JOIN->MAIN_HISTORY_BARRIER:BEGIN");
          await ensureHistoryBarrier("main");
          trace("WAIT:JOIN->MAIN_HISTORY_BARRIER:END");
        }
        if (window._paneActive?.ai) {
          trace("WAIT:JOIN->AI_HISTORY_BARRIER:BEGIN");
          await ensureHistoryBarrier("ai");
          trace("WAIT:JOIN->AI_HISTORY_BARRIER:END");
        }
      } catch {}
    })();

    // Immediate nudges so we don't wait only on the 1s timer.
    try {
      if (window._paneActive?.main) window.ensureJoinForPane("main", true);
      if (window._paneActive?.ai) window.ensureJoinForPane("ai", true);
    } catch {}

    setTimeout(() => {
      if (typeof window.bubble_fn_joinedChannel === "function") {
        try {
          window.bubble_fn_joinedChannel(true);
        } catch {}
      }
      try {
        window.ensureJoinForPane("main", true);
        window.ensureJoinForPane("ai", true);
        // Nudge any panes that were pending
        if (window._paneActive?.main) window.ensureJoinForPane("main", true);
        if (window._paneActive?.ai) window.ensureJoinForPane("ai", true);
      } catch {}
    }, 1000);

    log.info("joinChannel: ready", { channelKey });
    return channel;
  } catch (error) {
    window.currentChannel = null;
    window.currentUserId = null;
    log.error("joinChannel failed", error);
    throw error;
  }
};

// >>> PATCH: join watchdog to recover from silent misses / delays
(function wireJoinWatchdog() {
  if (window.__sumizyJoinWatchdogWired) return;
  window.__sumizyJoinWatchdogWired = true;

  const JOIN_STALE_MS = 5000; // join_sent for >5s → resend join
  const LIVE_STALE_MS = 20000; // live but no newer ts for >20s → nudge

  setInterval(() => {
    const act = window._paneActive || {};
    for (const paneRole of ["main", "ai"]) {
      const chatId = act[paneRole];
      if (!chatId) continue;
      const st = getStateForPane(paneRole, chatId);
      if (!st) continue;

      const now = Date.now();

      // Stuck in join_sent? Re-send (idempotent on backend).
      if (
        st.phase === "join_sent" &&
        st.lastJoinSentAt &&
        now - st.lastJoinSentAt > JOIN_STALE_MS
      ) {
        log.warn("Watchdog: re-sending join (stale join_sent)", {
          paneRole,
          chatId,
        });
        trace("WATCHDOG:RESEND_JOIN", { paneRole, chatId });
        try {
          window.requestHistoryNudge(chatId, paneRole);
        } catch {}

        st.joinDispatched = false;
        st.joinPending = false;
        st.lastJoinSentAt = now;
        window.ensureJoinForPane(paneRole, true);
        continue;
      }

      const rg = getRGForEntityOrPane(paneRole);
      const el =
        rg != null ? document.querySelector(`#rg${rg} .chat-messages`) : null;
      const hasVisibleContainer = !!(el && el.offsetParent !== null);
      const channelOk =
        typeof isChannelReady === "function" && isChannelReady();

      const lastFresh = Math.max(
        st.lastActivityAt || 0,
        st.lastTs || 0,
        st.lastJoinSentAt || 0
      );

      const staleLive = st.phase === "live" && now - lastFresh > LIVE_STALE_MS;
      const cooldownOk = now - (st.lastNudgeAt || 0) > 10000;
      const muteActive = now < (st.watchdogMuteUntil || 0);

      // Only nudge if stale, no mute, within cooldown, and it actually makes sense
      if (
        !muteActive &&
        staleLive &&
        cooldownOk &&
        (!channelOk || hasVisibleContainer)
      ) {
        log.warn("Watchdog: live is stale, nudging join", { paneRole, chatId });
        st.lastNudgeAt = now;
        st.joinDispatched = false;
        st.joinPending = false;
        st.lastJoinSentAt = now;
        window.ensureJoinForPane(paneRole, true);
      }
    }
  }, 1500);
})();


window.getCurrentChannel = () => window.currentChannel || null;



// Simple outbound queue for messages attempted before channel.message exists
window.__outboundQueue = window.__outboundQueue || [];
function flushOutboundQueue() {
  try {
    if (!isChannelReady()) return;
    const info = window.currentChannel;
    if (!info) return;
    const ch = window.xanoRealtime?.[info.channelKey]?.channel;
    if (!ch || typeof ch.message !== "function") return;
    if (!window.__outboundQueue.length) return;
    trace("QUEUE:FLUSH_START", { count: window.__outboundQueue.length }); // <-- ADD
    log.info("Flushing outbound queue", {
      count: window.__outboundQueue.length,
    });
    while (window.__outboundQueue.length) {
      const msg = window.__outboundQueue.shift();
      try {
        trace("QUEUE:FLUSH_SEND", { msg }); // <-- ADD
        ch.message(msg);
      } catch (e) {
        log.error("Flush failed", e, msg);
        trace("QUEUE:FLUSH_ERROR", { error: String(e), msg }); // <-- ADD
      }
    }
    trace("QUEUE:FLUSH_DONE"); // <-- ADD
  } catch (e) {
    log.error("flushOutboundQueue error", e);
    trace("QUEUE:FLUSH_FATAL", { error: String(e) }); // <-- ADD
  }
}

/* ─────────── Sending (unchanged) ─────────── */
window.sendMessage = (messageData) => {
  if (!messageData || typeof messageData !== "object") {
    return Promise.reject(new Error("Message data is required and must be an object"));
  }
  const info = window.currentChannel;

  // VISUAL TRACE for first JOINs being queued vs sent
  if (!info || !isChannelReady()) {
    window.__outboundQueue.push(messageData);
    trace("SEND:QUEUED (channel not ready)", { messageData, qlen: window.__outboundQueue.length });
    log.debug("sendMessage queued (channel not ready)", messageData);
    return Promise.resolve();
  }

  try {
    const channelKey = info.channelKey;
    if (!window.xanoRealtime || !window.xanoRealtime[channelKey]) {
      return Promise.reject(new Error("Channel not found in xanoRealtime"));
    }
    const ch = window.xanoRealtime[channelKey].channel;
    if (!ch) {
      return Promise.reject(new Error("Channel object not found"));
    }
    trace("SEND:DISPATCH", { messageData });
    ch.message(messageData);
    log.debug("sendMessage", messageData);
    return Promise.resolve();
  } catch (error) {
    log.error("sendMessage failed", error);
    trace("SEND:ERROR", { error: String(error) });
    return Promise.reject(error);
  }
};


/* ─────────── Ensure-join per pane (single-flight + channel-ready) ─────────── */
function isChannelReady() {
  const info = window.currentChannel;
  if (!info) return false;
  const ch = window.xanoRealtime?.[info.channelKey]?.channel;
  return !!(ch && typeof ch.message === "function");
}

/* Probe channel readiness transitions */
(function probeChannelReady(){
  if (window.__sumizyProbeReady) return;
  window.__sumizyProbeReady = true;
  let last = null;
  setInterval(() => {
    let cur = false;
    try { cur = isChannelReady(); } catch {}
    if (cur !== last) {
      trace(`CHANNEL_READY:${cur ? "TRUE" : "FALSE"}`);
      last = cur;
    }
  }, 200);
})();


window.ensureJoinForPane = function ensureJoinForPane(paneRole, force = false) {
  trace("ENSURE_JOIN:CALL", {
    paneRole,
    force,
    chatId: window._paneActive[paneRole],
  });

  let chatId = window._paneActive[paneRole];

  // If we have a composite like "tickets:123", try to map to a real conversation id.
  if (
    chatId &&
    chatId.includes(":") &&
    typeof window.mapEntityToConversationId === "function"
  ) {
    try {
      const [type, id] = chatId.split(":");
      const conv = window.mapEntityToConversationId(type, id);
      if (conv) chatId = String(conv);
    } catch {}
  }

  if (!chatId) return;

  // F: throttle ensureJoin calls when live & healthy
  const st = getStateForPane(paneRole, chatId);
  if (!st) return;

  // Throttle when already live & channel callable
  const now = Date.now();
  const THROTTLE_MS = 10000; // 10s
  if (st.phase === "live" && isChannelReady() && !force) {
    if (!st._nextEnsureAt) st._nextEnsureAt = 0;
    if (now < st._nextEnsureAt) {
      trace("ENSURE_JOIN:THROTTLED", {
        paneRole,
        until: st._nextEnsureAt - now,
      });
      return;
    }
    st._nextEnsureAt = now + THROTTLE_MS;
  }

  const currentGen = window._chatGen || 0;

  if (st.joinGen !== currentGen) {
    st.joinGen = currentGen;
    st.prebuffer = [];
    st.seen.clear();
    st.lastTs = 0;
    st.joinDispatched = false;
    st.joinPending = false;
    st.joinRetryTid = 0;
    st.joinRetryCount = 0;
    st.phase = "idle";
    clearPaneDom(paneRole);
    log.info("ensureJoinForPane: new gen reset", {
      paneRole,
      chatId,
      currentGen,
    });
    trace("ENSURE_JOIN:NEW_GEN_RESET", { paneRole, chatId, currentGen });
  }

  if (force && st.joinPending) {
    if (st.joinRetryTid) clearTimeout(st.joinRetryTid);
    st.joinRetryTid = 0;
    st.joinRetryCount = 0;
    st.joinPending = false;
    log.debug("ensureJoinForPane: force breaks pending", { paneRole, chatId });
  }
  if (!force && (st.joinDispatched || st.joinPending)) {
    log.debug("ensureJoinForPane: noop (already dispatched/pending)", {
      paneRole,
      chatId,
      joinDispatched: st.joinDispatched,
      joinPending: st.joinPending,
    });
    return;
  }

  function scheduleImmediateRetry() {
    const s = getStateForPane(paneRole, chatId);
    if (!s) return;
    if (s.joinRetryTid) clearTimeout(s.joinRetryTid);
    s.joinRetryTid = setTimeout(trySend, 0);
  }

  const trySend = () => {
    const s = getStateForPane(paneRole, chatId);
    if (!s) return;
    if (s.joinGen !== currentGen) return;
    if (s.joinDispatched) return;

    const rgNow = getRGForPane(paneRole);
    const cNow =
      rgNow != null
        ? document.querySelector(`#rg${rgNow} .chat-messages`)
        : null;

    if (!cNow || !isChannelReady()) {
      if (s.joinRetryCount < 80) {
        trace("ENSURE_JOIN:RETRY_SCHEDULE", {
          paneRole,
          chatId,
          retry: s.joinRetryCount + 1,
          channelReady: isChannelReady(),
          hasContainer: !!cNow,
        });
        s.joinRetryCount++;
        s.joinRetryTid = setTimeout(trySend, 200);
        log.debug("ensureJoin retry", {
          paneRole,
          chatId,
          retry: s.joinRetryCount,
          hasContainer: !!cNow,
          channelReady: isChannelReady(),
        });
      } else {
        // Instead of truly abandoning, keep it pending and re-arm when ready.
        s.joinPending = true;
        s.joinRetryTid = 0;
        s.joinRetryCount = 0;
        s.lastJoinSentAt = Date.now();
        s.lastActivityAt = Date.now();
        log.warn("ensureJoin abandoned after retries", { paneRole, chatId });
        trace("ENSURE_JOIN:ABANDON_TO_PENDING", { paneRole, chatId });

        // Re-arm on container OR channel readiness (whichever becomes ready first)
        Promise.race([
          waitForPaneContainer(paneRole, 20000),
          waitForChannelReady(20000),
        ]).then(() => {
          const still = getStateForPane(paneRole, chatId);
          if (!still || still.joinGen !== currentGen) return;
          scheduleImmediateRetry();
        });
      }

      return;
    }

    const channelReadyNow = isChannelReady();
    const containerReadyNow = !!cNow;
    const canJoin =
      s.phase === "idle" ||
      s.phase === "injecting_history" ||
      // only allow a forced re-join when something is actually missing
      (force &&
        s.phase !== "join_sent" &&
        (!channelReadyNow || !containerReadyNow));

    if (!canJoin) {
      s.joinPending = false;
      log.debug("ensureJoin: blocked by phase", {
        paneRole: paneRole,
        phase: s.phase,
      });
      return;
    }

    s.joinDispatched = true;
    s.joinPending = false;
    s.joinRetryTid = 0;
    s.joinRetryCount = 0;
    s.phase = "join_sent";
    s.lastJoinSentAt = Date.now();

    const payload = {
      isReaction: false,
      isDelete: false,
      isJoin: true,
      conversation_id: chatId,
      message: "",
    };
    log.info("ensureJoin: sending join", { paneRole, chatId, payload });
    trace("ENSURE_JOIN:SEND_JOIN", { paneRole, chatId, phase: s.phase });
    window.sendMessage(payload);
    // Arm a soft nudge if we're still waiting shortly after JOIN
    try {
      if (s.historyNudgeTid) clearTimeout(s.historyNudgeTid);
      s.historyNudgeTid = setTimeout(() => {
        const still = getStateForPane(paneRole, chatId);
        if (!still) return;
        if (still.phase === "join_sent") {
          trace("NUDGE:SEND_AFTER_JOIN", { paneRole, chatId });
          window.requestHistoryNudge(chatId, paneRole);
        }
      }, 1200);
    } catch {}
    // Arm hard fallback later (HTTP) — implemented in section C
    try {
      if (s.httpFallbackTid) clearTimeout(s.httpFallbackTid);
      s.httpFallbackTid = setTimeout(() => {
        const still = getStateForPane(paneRole, chatId);
        if (!still) return;
        if (still.phase === "join_sent") {
          trace("FALLBACK:HTTP_AFTER_JOIN", { paneRole, chatId });
          window.fetchHistoryForConversation?.(chatId, paneRole);
        }
      }, 4000);
    } catch {}
  };

  const rg = getRGForEntityOrPane(paneRole);
  const container =
    rg != null ? document.querySelector(`#rg${rg} .chat-messages`) : null;

  // Only gate on channel readiness; DOM can catch up later (we buffer).
  if (!isChannelReady()) {
    st.joinPending = true;
    if (!st.joinRetryTid) {
      st.joinRetryCount = 0;
      st.joinRetryTid = setTimeout(trySend, 0);
      log.debug("ensureJoin: container not visible yet, retrying", {
        paneRole,
        chatId,
        hasContainer: !!container,
        visible: !!(container && container.offsetParent !== null),
        channelReady: isChannelReady(),
      });
    }
    return;
  }

  // Immediate path (channel is ready here; mirror trySend() rules, minus the undefined var)
  const canJoin =
    st.phase === "idle" ||
    st.phase === "injecting_history" ||
    (force && st.phase !== "join_sent");

  if (!canJoin) {
    st.joinPending = false;
    log.debug("ensureJoin: blocked by phase (immediate path)", {
      paneRole,
      chatId,
      phase: st.phase,
    });
    return;
  }

  st.joinDispatched = true;
  st.phase = "join_sent";
  st.lastJoinSentAt = Date.now();
  const payload = {
    isReaction: false,
    isDelete: false,
    isJoin: true,
    conversation_id: chatId,
    message: "",
  };
  log.info("ensureJoin: immediate join", { paneRole, chatId, payload });
  trace("ENSURE_JOIN:SEND_JOIN", { paneRole, chatId, phase: st.phase });
  window.sendMessage(payload);
  try {
    if (st.historyNudgeTid) clearTimeout(st.historyNudgeTid);
    st.historyNudgeTid = setTimeout(() => {
      const still = getStateForPane(paneRole, chatId);
      if (!still) return;
      if (still.phase === "join_sent") {
        trace("NUDGE:SEND_AFTER_JOIN", { paneRole, chatId });
        window.requestHistoryNudge(chatId, paneRole);
      }
    }, 1200);
  } catch {}
  try {
    if (st.httpFallbackTid) clearTimeout(st.httpFallbackTid);
    st.httpFallbackTid = setTimeout(() => {
      const still = getStateForPane(paneRole, chatId);
      if (!still) return;
      if (still.phase === "join_sent") {
        trace("FALLBACK:HTTP_AFTER_JOIN", { paneRole, chatId });
        window.fetchHistoryForConversation?.(chatId, paneRole);
      }
    }, 4000);
  } catch {}
};

/* ─────────── Route watcher: clear & (re)join per pane ─────────── */
function handleChatRouteChangeDual() {
  const { main, ai } = getPaneIdsFromUrl();
  const prevMain = window._paneActive.main;
  const prevAI = window._paneActive.ai;


  const changed =
    String(prevMain || "") !== String(main || "") ||
    String(prevAI || "") !== String(ai || "");
  if (changed) window._chatGen = (window._chatGen || 0) + 1;

  log.info("Route change", {
    prevMain,
    prevAI,
    main,
    ai,
    chatGen: window._chatGen,
    changed,
  });
  trace("ROUTE:CHANGE", {
    prevMain,
    prevAI,
    main,
    ai,
    chatGen: window._chatGen,
    changed,
  });


  const __entity = getCurrentEntityFromUrl();
  if (__entity) {
    const __rg = ENTITY_TO_RG[__entity];
    log.info("Route entity→rg", { entity: __entity, rg: __rg });
  } else {
    log.info("Route entity→rg", {
      entity: null,
      rg: getRGForEntityOrPane("main"),
    });
  }


  // MAIN
  if (!main) {
    if (prevMain) clearPaneDom("main");
    window._paneActive.main = null;
  } else {
    if (main !== prevMain) {
      window._paneActive.main = main;
      const st = resetStateForPane("main", main);
      // Mute the watchdog while the route stabilizes
      st.watchdogMuteUntil = Date.now() + 25000; // was 6000
      clearPaneDom("main");
      window.ensureJoinForPane("main", true);
    } else {
      window.ensureJoinForPane("main", false);
    }    
  }

  // AI
  // AI
if (!ai) {
  // NEW: Preserve existing AI pane & state when ai-chat is absent from URL
  if (prevAI) {
    log.info("AI id missing in URL; preserving existing AI pane", { prevAI });
  }
  // do NOT clearPaneDom("ai") and do NOT null _paneActive.ai
} else {
  if (ai !== prevAI) {
    window._paneActive.ai = ai;
    const st = resetStateForPane("ai", ai);
    if (st) st.watchdogMuteUntil = Date.now() + 6000;
    clearPaneDom("ai");
    window.ensureJoinForPane("ai", true);
  } else {
    window.ensureJoinForPane("ai", false);
  }
  
}
// >>> PATCH: extra robustness — nudge after DOM settles & after channel wakes
setTimeout(() => {
  const mId = window._paneActive.main;
  if (mId) {
    const st = getStateForPane("main", mId);
    if (!st || st.phase !== "live") window.ensureJoinForPane("main", true);
  }
  const aId = window._paneActive.ai;
  if (aId) {
    const st = getStateForPane("ai", aId);
    if (!st || st.phase !== "live") window.ensureJoinForPane("ai", true);
  }
}, 400);

setTimeout(() => {
  const mId = window._paneActive.main;
  if (mId) {
    const st = getStateForPane("main", mId);
    if (!st || st.phase !== "live") window.ensureJoinForPane("main", true);
  }
  const aId = window._paneActive.ai;
  if (aId) {
    const st = getStateForPane("ai", aId);
    if (!st || st.phase !== "live") window.ensureJoinForPane("ai", true);
  }
}, 1800);


}

/* ─────────── Wire up basic SPA navigation hooks ─────────── */
(function wireNavigationWatch() {
  if (window.__sumizyRouteWatchWiredDual) return;
  window.__sumizyRouteWatchWiredDual = true;

  const patchHistory = (method) => {
    const orig = history[method];
    if (!orig._sumizy_patched) {
      history[method] = function () {
        const ret = orig.apply(this, arguments);
        window.dispatchEvent(new Event("locationchange"));
        return ret;
      };
      history[method]._sumizy_patched = true;
    }
  };
  patchHistory("pushState");
  patchHistory("replaceState");

  window.addEventListener("popstate", handleChatRouteChangeDual);
  window.addEventListener("hashchange", handleChatRouteChangeDual);
  window.addEventListener("locationchange", handleChatRouteChangeDual);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleChatRouteChangeDual, {
      once: true,
    });
  } else {
    handleChatRouteChangeDual();
  }

  log.info("Navigation watch wired");
})();

/* ─────────── Optional: Older messages API (no-op unless you wire data) ─────────── */
window.loadOlderMessages = () => false;
window.getOlderMessagesCount = () => 0;

// Expose a few helpers (optional)
Object.assign(window, {
  patchMessageInPlace,
  updateReplyPreviewsForMessage,
  updateMessageTextsInPlace,
  updateReactionsInPlace,
  getRGForPane,
  ensureJoinForPane: window.ensureJoinForPane,
});