//sumizy-chat-realtime-ui.js

/* ─────────── AI TYPING INDICATOR ─────────── */
let typingIndicatorElement = null;
let typingIndicatorTimeout = null;
window.aiTypingActive = false;

window.showAITypingIndicator = function (rgNum) {
  if (!window.isAIChat()) return;
  const chatContainer = document.querySelector(`#rg${rgNum} .chat-messages`);
  if (!chatContainer) return;

  window.hideAITypingIndicator();
  if (typingIndicatorTimeout) clearTimeout(typingIndicatorTimeout);

  const typingMessage = {
    id: "typing-indicator",
    created_at: Date.now(),
    user_id: "5c82f501-a3da-4083-894c-4367dc2e01f3",
    message: `<div style="display:flex;gap:4px;">
      <span style="width:8px;height:8px;border-radius:50%;background:#667eea;opacity:.4;animation:typingBounce 1.4s infinite ease-in-out;animation-delay:-.32s;"></span>
      <span style="width:8px;height:8px;border-radius:50%;background:#667eea;opacity:.4;animation:typingBounce 1.4s infinite ease-in-out;animation-delay:-.16s;"></span>
      <span style="width:8px;height:8px;border-radius:50%;background:#667eea;opacity:.4;animation:typingBounce 1.4s infinite ease-in-out;"></span>
    </div>`,
    _user: { name: "Sumizy AI", profilePicture: null },
    isFile: false,
    _reactions: [],
    _translations: [],
  };

  const typingHTML = renderMsg(typingMessage, null);
  typingIndicatorElement = document.createElement("div");
  typingIndicatorElement.innerHTML = typingHTML;
  typingIndicatorElement = typingIndicatorElement.firstChild;
  typingIndicatorElement.classList.add("typing-indicator");

  chatContainer.appendChild(typingIndicatorElement);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  typingIndicatorTimeout = setTimeout(
    () => window.hideAITypingIndicator(),
    30000
  );
  window.aiTypingActive = true;
};

window.hideAITypingIndicator = function () {
  if (typingIndicatorTimeout) {
    clearTimeout(typingIndicatorTimeout);
    typingIndicatorTimeout = null;
  }
  if (typingIndicatorElement) {
    typingIndicatorElement.remove();
    typingIndicatorElement = null;
  }
  window.aiTypingActive = false;
};

/* ─────────── ADD STYLES (typing + file viewer) ─────────── */
if (!document.querySelector("#ai-chat-styles")) {
  const style = document.createElement("style");
  style.id = "ai-chat-styles";
  style.innerHTML = `
    @keyframes typingBounce { 0%,80%,100%{transform:scale(.8);opacity:.4;} 40%{transform:scale(1);opacity:1;} }
    .typing-indicator { animation: fadeInUp .3s ease-out; }
    @keyframes fadeInUp { from{opacity:0;transform:translateY(20px);} to{opacity:1;transform:translateY(0);} }
    body.ai-chat-mode .message:hover { background-color: transparent !important; }
    body.ai-chat-mode .chat-messages { background: linear-gradient(180deg,#fff 0%,#f9fafb 100%); }

    .file-viewer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:9999;animation:fadeIn .2s ease;}
    .file-viewer-modal{background:#fff;border-radius:12px;max-width:min(92vw,960px);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.2);animation:scaleIn .2s ease;}
    .file-viewer-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eee;font-weight:600;}
    .file-viewer-body{padding:16px;overflow:auto}
    .file-viewer-footer{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid #eee;}
    .file-viewer-img{max-width:80vw;max-height:70vh;border-radius:8px}
    .file-viewer-loading{display:flex;gap:10px;align-items:center;justify-content:center;color:#666}
    .file-viewer-spinner{width:14px;height:14px;border-radius:50%;border:2px solid #d1d5db;border-top-color:#6b7280;animation:spin 1s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .file-viewer-close{background:none;border:0;font-size:22px;cursor:pointer;line-height:1}
    .file-viewer-download{display:inline-flex;gap:6px;align-items:center;border:1px solid #e5e7eb;border-radius:8px;padding:8px 12px;background:#fff;cursor:pointer}
    .file-viewer-download.download-success{border-color:#10b981}
    .file-viewer-download.download-error{border-color:#ef4444}
    @keyframes fadeIn{from{opacity:0} to{opacity:1}}
    @keyframes scaleIn{from{transform:translateY(8px) scale(.98);opacity:0} to{transform:none;opacity:1}}
    @keyframes fadeOut{from{opacity:1} to{opacity:0}}
    @keyframes scaleOut{from{transform:none;opacity:1} to{transform:translateY(8px) scale(.98);opacity:0}}
    .reply-quote{display:inline-block;padding:6px 8px;background:#f3f4f6;border-left:3px solid #9ca3af;border-radius:4px}
  `;
  document.head.appendChild(style);
}

/* ─────────── AI CHAT MODE DETECTOR (SPA-SAFE) ─────────── */
(function () {
  const isAIChatUrl = (href = location.href) => {
    const u = new URL(href, location.origin);
    const q = u.searchParams;
    const path = u.pathname.toLowerCase();
    const hash = (u.hash || "").toLowerCase();
    return (
      path.includes("ai-chat") ||
      q.has("ai-chat") ||
      q.get("mode") === "ai" ||
      q.get("chat") === "ai" ||
      hash.includes("ai-chat")
    );
  };

  const applyAIChatMode = () => {
    const on = isAIChatUrl();
    document.body.classList.toggle("ai-chat-mode", on);
    if (document.body.dataset.aiChat !== String(on)) {
      document.body.dataset.aiChat = String(on);
      console.log(
        `AI Chat mode ${on ? "activated" : "deactivated"} → ${location.href}`
      );
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAIChatMode, {
      once: true,
    });
  } else {
    applyAIChatMode();
  }

  const patchHistory = (method) => {
    const orig = history[method];
    history[method] = function () {
      const ret = orig.apply(this, arguments);
      window.dispatchEvent(new Event("locationchange"));
      return ret;
    };
  };
  patchHistory("pushState");
  patchHistory("replaceState");

  window.addEventListener("popstate", applyAIChatMode);
  window.addEventListener("hashchange", applyAIChatMode);
  window.addEventListener("locationchange", applyAIChatMode);

  window.isAIChat = () => isAIChatUrl();
  window.applyAIChatMode = applyAIChatMode;
})();

/* ─────────── DYNAMIC REFRESH HANDLERS ─────────── */
window.handleRefreshEvent = (data) => {
  try {
    if (data.action !== "event" || !data.payload || !data.payload.data)
      return false;
    let eventData;
    if (typeof data.payload.data === "string") {
      try {
        eventData = JSON.parse(data.payload.data);
      } catch {
        return false;
      }
    } else {
      eventData = data.payload.data;
    }
    if (!eventData.refresh) return false;

    const refreshType = eventData.refresh;
    const functionName = `bubble_fn_refresh${
      refreshType.charAt(0).toUpperCase() + refreshType.slice(1)
    }`;
    console.log(
      `Refresh event received: ${refreshType} -> calling ${functionName}`
    );
    if (typeof window[functionName] === "function") {
      window[functionName]();
      console.log(`Successfully called ${functionName}`);
      return true;
    } else {
      console.warn(
        `Function ${functionName} not found. Make sure it's defined in Bubble.`
      );
      return false;
    }
  } catch (e) {
    console.error("Error handling refresh event:", e);
    return false;
  }
};

window.handleRefreshEventWithRG = (data, rgOverride = null) => {
  try {
    if (data.action !== "event" || !data.payload || !data.payload.data)
      return false;
    let eventData;
    try {
      eventData = JSON.parse(data.payload.data);
    } catch {
      return false;
    }
    if (!eventData.refresh) return false;

    const refreshType = eventData.refresh;
    const capitalizedType =
      refreshType.charAt(0).toUpperCase() + refreshType.slice(1);
    const rg =
      rgOverride || (window.findVisibleRG ? window.findVisibleRG() : null);
    const tryFns = [];
    if (rg !== null) tryFns.push(`bubble_fn_refresh${capitalizedType}${rg}`);
    tryFns.push(`bubble_fn_refresh${capitalizedType}`);

    for (const fn of tryFns) {
      if (typeof window[fn] === "function") {
        console.log(`Refresh event: ${refreshType} -> calling ${fn}`);
        window[fn]({
          refreshType,
          dbo_id: data.payload.dbo_id,
          row_id: data.payload.row_id,
          originalData: eventData,
        });
        return true;
      }
    }
    console.warn(
      `No refresh function found for type: ${refreshType}. Tried: ${tryFns.join(
        ", "
      )}`
    );
    return false;
  } catch (e) {
    console.error("Error handling refresh event:", e);
    return false;
  }
};

/* ─────────── IMPROVED FILE VIEWER ─────────── */
function showFileViewer(url, name, isImage) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const fileSize = "";

  const ov = document.createElement("div");
  ov.className = "file-viewer-overlay";
  let bodyContent;

  if (isImage) {
    bodyContent = `
      <div class="file-viewer-loading"><div class="file-viewer-spinner"></div><div>Loading image...</div></div>
      <img src="${url}" alt="${esc(
      name
    )}" class="file-viewer-img" style="display:none;">`;
  } else {
    const iconMap = {
      pdf: "📄",
      doc: "📝",
      docx: "📝",
      xls: "📊",
      xlsx: "📊",
      ppt: "📊",
      pptx: "📊",
      zip: "🗂️",
      rar: "🗂️",
      mp3: "🎵",
      wav: "🎵",
      mp4: "🎬",
      avi: "🎬",
      mov: "🎬",
      txt: "📃",
      code: "💻",
    };
    const icon = iconMap[ext] || "📎";
    bodyContent = `
      <div class="file-viewer-icon-container" style="display:grid;gap:8px;place-items:center;padding:24px;color:#374151">
        <div class="file-viewer-icon" style="font-size:44px">${icon}</div>
        <div class="file-viewer-filename" style="font-weight:600">${esc(
          name
        )}</div>
        <div class="file-viewer-filetype" style="font-size:12px;color:#6b7280">${ext.toUpperCase()} File</div>
      </div>`;
  }

  ov.innerHTML = `
    <div class="file-viewer-modal" role="dialog" aria-label="${esc(
      name
    )}" tabindex="-1">
      <div class="file-viewer-header">
        <span class="file-viewer-name">${esc(name)}</span>
        <button class="file-viewer-close" aria-label="Close" title="Close (Esc)">×</button>
      </div>
      <div class="file-viewer-body">${bodyContent}</div>
      <div class="file-viewer-footer">
        <div class="file-viewer-info">${
          fileSize ? `Size: ${fileSize}` : ""
        }</div>
        <div class="file-viewer-actions">
          <button class="file-viewer-download" data-url="${url}" data-filename="${esc(
    name
  )}">
            <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg><span>Download</span>
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const modal = ov.querySelector(".file-viewer-modal");
  modal.focus();

  if (isImage) {
    const img = ov.querySelector(".file-viewer-img");
    const loading = ov.querySelector(".file-viewer-loading");
    img.onload = () => {
      loading.style.display = "none";
      img.style.display = "block";
    };
    img.onerror = () => {
      loading.innerHTML = `<div class="file-viewer-icon">🚫</div><div>Failed to load image</div>`;
    };
  }

  const close = () => {
    ov.style.animation = "fadeOut .2s ease-out";
    modal.style.animation = "scaleOut .2s ease-out";
    setTimeout(() => {
      ov.remove();
      document.removeEventListener("keydown", handleEscape);
    }, 200);
  };
  const handleEscape = (e) => {
    if (e.key === "Escape") close();
  };

  ov.addEventListener("click", (e) => {
    if (e.target === ov) close();
  });
  ov.querySelector(".file-viewer-close").addEventListener("click", close);
  ov.querySelector(".file-viewer-download").addEventListener(
    "click",
    async function () {
      const url = this.dataset.url,
        filename = this.dataset.filename;
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        this.classList.add("download-success");
        this.innerHTML = `<svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Downloaded</span>`;
        setTimeout(() => {
          this.classList.remove("download-success");
          this.innerHTML = `<svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg><span>Download</span>`;
        }, 2000);
      } catch (err) {
        console.error("Download failed:", err);
        this.classList.add("download-error");
        this.innerHTML = `<svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg><span>Failed</span>`;
      }
    }
  );
  document.addEventListener("keydown", handleEscape);
}

document.addEventListener("click", (e) => {
  const fa = e.target.closest(".file-attachment");
  if (!fa) return;
  e.preventDefault();
  e.stopPropagation();
  showFileViewer(
    fa.dataset.url,
    fa.dataset.name,
    (fa.dataset.type || "").startsWith("image")
  );
});

/* ─────────── ACTION MENU (emoji | reply | delete) ─────────── */
let currentActionMenu = null;
function hideActionMenu() {
  currentActionMenu?.remove();
  currentActionMenu = null;
}

document.addEventListener("click", (e) => {
  if (!e.target.classList.contains("message-actions-trigger")) return;
  e.stopPropagation();
  const msgEl = e.target.closest(".message");
  const msgId = msgEl.dataset.id;
  const rgNum = msgEl.closest('[id^="rg"]').id.replace("rg", "");
  const uid = msgEl.dataset.uid;
  const ts = +msgEl.dataset.ts;
  const canDelete = window.currentUserId === uid && Date.now() - ts < 3600_000;
  const emojis = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👏"];

  hideActionMenu();
  const menu = document.createElement("div");
  menu.className = "message-actions-menu group-focus";
  menu.innerHTML = `
    <div class="actions-row" style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e5e7eb;padding:8px 10px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.08)">
      <div class="reactions-list" style="display:flex;gap:6px;">
        ${emojis
          .map(
            (e) =>
              `<span class="emoji-option" data-id="${esc(
                msgId
              )}" data-emoji="${e}" style="cursor:pointer">${e}</span>`
          )
          .join("")}
      </div>
      <div class="action-divider" style="width:1px;height:18px;background:#e5e7eb;margin:0 4px;"></div>
      <div class="reply-action action-icon-button" data-id="${esc(
        msgId
      )}" title="Reply" style="cursor:pointer"><span class="action-icon">↩️</span></div>
      ${
        canDelete
          ? `<div class="delete-action action-icon-button" data-id="${esc(
              msgId
            )}" title="Delete" style="cursor:pointer"><span class="action-icon">🗑️</span></div>`
          : ""
      }
    </div>`;

  const r = e.target.getBoundingClientRect();
  Object.assign(menu.style, {
    position: "absolute",
    right: `${innerWidth - r.right + 5}px`,
    top: `${r.bottom + 5}px`,
    zIndex: 9999,
  });
  document.body.appendChild(menu);
  currentActionMenu = menu;

  menu.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const emo = ev.target.closest(".emoji-option");
    if (emo) {
      const fn = `bubble_fn_reaction${rgNum}`;
      if (typeof window[fn] === "function")
        window[fn]({ output1: emo.dataset.id, output2: emo.dataset.emoji });
      hideActionMenu();
      return;
    }
    if (ev.target.closest(".reply-action")) {
      const fn = `bubble_fn_replyChat${rgNum}`;
      if (typeof window[fn] === "function")
        window[fn]({ output1: buildReplyHtml(msgEl), output2: msgId });
      hideActionMenu();
      return;
    }
    if (ev.target.closest(".delete-action")) {
      const fn = `bubble_fn_deleteMessage${rgNum}`;
      if (typeof window[fn] === "function") window[fn]({ output1: msgId });
      msgEl.remove();
      hideActionMenu();
      return;
    }
  });
});

document.addEventListener("click", (e) => {
  if (
    !e.target.closest(".message-actions-menu") &&
    !e.target.classList.contains("message-actions-trigger")
  )
    hideActionMenu();
});

/* toggle reaction bubble click */
document.addEventListener("click", (e) => {
  const r = e.target.closest(".reaction");
  if (!r) return;
  const msg = r.closest(".message");
  const rg = msg.closest('[id^="rg"]').id.replace("rg", "");
  const fn = `bubble_fn_reaction${rg}`;
  if (typeof window[fn] === "function")
    window[fn]({ output1: msg.dataset.id, output2: r.dataset.emoji });
});

/* ─────────── VISIBILITY QUEUE + OBSERVERS ─────────── */
/** Fallback finder if you don’t already define one elsewhere */
window.findVisibleRG ??= function () {
  const containers = Array.from(
    document.querySelectorAll('[id^="rg"] .chat-messages')
  );
  for (const el of containers) {
    const rg = el.closest('[id^="rg"]');
    if (!rg) continue;
    const style = getComputedStyle(rg);
    const visible =
      rg.offsetParent !== null &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      el.offsetHeight > 0 &&
      el.offsetWidth > 0;
    if (visible) return Number(rg.id.replace("rg", ""));
  }
  return null;
};

window._pendingChatInjections = window._pendingChatInjections || {}; // { [chatId]: Array<message> }
window._activeChatId = window._activeChatId || null;
window._seenByChat = window._seenByChat || {};   // { chatId: Set(ids) }
window._chatGen = window._chatGen || 0;          // bumps on chat switch

window._chatVis = window._chatVis || { observersReady: false };

/* ---------- PATCH: robust visible-flush pipeline ---------- */
window._lastRenderedByChat = window._lastRenderedByChat || {}; // { chatId: Map<id, msg> }

/** Manually hint from your toggle UI still works */
window.signalChatMaybeVisible = function () {
  // Give the DOM a couple of frames to settle before we attempt injection
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(_flushPendingIfVisible, 30);
    });
  });
};

/** Try to inject and VERIFY that messages are in the DOM before we pop the queue */
function _tryInject(rg, msgs) {
  return new Promise((resolve) => {
    try {
      if (typeof window.injectMessages !== "function") return resolve(false);

      window.injectMessages(rg, msgs, window.currentUserId);

      // Verify after 2 RAFs that at least one message id is present
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const container = document.querySelector(`#rg${rg} .chat-messages`);
          if (!container) return resolve(false);

          const ok = msgs.some((m) => {
            const id = String(m?.id ?? "");
            if (!id) return false;
            const safeId =
              window.CSS && CSS.escape
                ? CSS.escape(id)
                : id.replace(/"/g, '\\"');
            const sel = `.message[data-id="${safeId}"]`;
            return !!container.querySelector(sel);
          });

          resolve(ok);
        })
      );
    } catch {
      resolve(false);
    }
  });
}

function _rememberSnapshot(chatId, msgs) {
  const map = (window._lastRenderedByChat[chatId] ||= new Map());
  for (const m of msgs) {
    if (!m || !m.id) continue;
    map.set(String(m.id), m);
    if (map.size > 200) {
      const drop = map.size - 200;
      let i = 0;
      for (const key of map.keys()) {
        map.delete(key);
        if (++i >= drop) break;
      }
    }
  }
}

function _maybeRestoreChat(chatId, rg) {
  const container = document.querySelector(`#rg${rg} .chat-messages`);
  if (!container) return;
  const hasAny = container.querySelector(".message");
  if (hasAny) return;

  const snap = window._lastRenderedByChat[chatId];
  if (!snap || snap.size === 0) return;

  const msgs = Array.from(snap.values());
  try {
    if (typeof window.injectMessages === "function") {
      window.injectMessages(rg, msgs, window.currentUserId);
    }
  } catch (e) {
    console.warn("Snapshot restore failed:", e);
  }
}

async function _flushPendingIfVisible() {
  if (window._chatVis?.flushing) return;
  window._chatVis = window._chatVis || {};
  window._chatVis.flushing = true;

  const myGen = window._chatGen;

  try {
    const rg = window.findVisibleRG?.() ?? null;
    if (rg === null) return;

    const chatId =
      window._activeChatId ||
      new URLSearchParams(location.search).get("chatid");
    if (!chatId) return;

    const bucket = window._pendingChatInjections?.[chatId];
    if (!bucket || bucket.length === 0) {
      _maybeRestoreChat(chatId, rg);
      return;
    }

    // TWO-PHASE COMMIT: copy first, don't clear yet
    const msgs = bucket.slice(0);

    // Try to inject and verify it "took"
    const ok = await _tryInject(rg, msgs);

    if (ok && myGen === window._chatGen) {
      // Commit: remove exactly the messages we injected
      bucket.splice(0, msgs.length);
      _rememberSnapshot(chatId, msgs);

      const refreshFn = `bubble_fn_refreshConversations${rg}`;
      if (typeof window[refreshFn] === "function") {
        try {
          window[refreshFn]();
        } catch {}
      }
      if (window.aiTypingActive && !typingIndicatorElement) {
        window.showAITypingIndicator(rg);
      }
    } else if (ok && myGen !== window._chatGen) {
      // late write from previous chat -> ignore
      // (no-op)
    } else {
      // DOM likely not ready yet; retry shortly
      setTimeout(_flushPendingIfVisible, 120);
    }
  } finally {
    window._chatVis.flushing = false;
  }
}

function _enqueueForLater(chatId, msgs) {
  if (!chatId || !Array.isArray(msgs) || !msgs.length) return;
  const bucket = (window._pendingChatInjections[chatId] ||= []);
  for (const m of msgs) {
    if (!m || !m.id) continue;
    const seen = (window._seenByChat[chatId] ||= new Set());
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    bucket.push(m);
  }
}

function _setupChatVisibilityWatchers() {
  if (window._chatVis.observersReady) return;
  window._chatVis.observersReady = true;

  const mo = new MutationObserver(() => _flushPendingIfVisible());
  mo.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style"],
    subtree: true,
    childList: true,
  });
  window._chatVis.mo = mo;

  const attachIO = () => {
    const target = document.querySelector(".chat-messages");
    if (!target) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) _flushPendingIfVisible();
      },
      { root: null, threshold: 0.01 }
    );
    io.observe(target);
    window._chatVis.io = io;
  };
  attachIO();
  document.addEventListener("DOMContentLoaded", attachIO, { once: true });

  window.addEventListener("sumizy:chat:visible", _flushPendingIfVisible);
  window.addEventListener("resize", _flushPendingIfVisible);
}

// expose cross-module helpers for core (because scripts are loaded as modules)
window._setupChatVisibilityWatchers = window._setupChatVisibilityWatchers || _setupChatVisibilityWatchers;
window._flushPendingIfVisible      = window._flushPendingIfVisible      || _flushPendingIfVisible;


/** One API surface for your realtime pipeline */
window.enqueueOrInjectMessages = function (messages) {
  const chatId =
    window._activeChatId || new URLSearchParams(location.search).get("chatid");
  if (!chatId) return;

  const rg = window.findVisibleRG?.() ?? null;
  if (rg === null) {
    _enqueueForLater(chatId, messages);
    _setupChatVisibilityWatchers();
    return;
  }

  const myGen = window._chatGen;

  const toInject = [];
  for (const m of messages) {
    if (!m || !m.id) continue;
    const seen = (window._seenByChat[chatId] ||= new Set());
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    toInject.push(m);
  }
  if (!toInject.length) return;

  (async () => {
    const ok = await _tryInject(rg, toInject);
    if (ok && myGen === window._chatGen) {
      _rememberSnapshot(chatId, toInject);
      const refreshFn = `bubble_fn_refreshConversations${rg}`;
      if (typeof window[refreshFn] === "function") {
        try {
          window[refreshFn]();
        } catch {}
      }
    } else if (ok && myGen !== window._chatGen) {
      // late write from previous chat -> ignore
      // (no-op)
    } else {
      _enqueueForLater(chatId, toInject);
      setTimeout(_flushPendingIfVisible, 120);
    }
  })();
};

/* ─────────── CHANNEL JOIN/LEAVE + REALTIME ─────────── */
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
  if (!userId || !authToken || !realtimeHash) {
    console.error(
      "joinChannel: userId, authToken, and realtimeHash are required"
    );
    return;
  }

  let hasReceivedInitialHistory = false;

  try {
    const channelName = `sumizy/${userId}`;
    if (!window.xano) {
      console.error(
        "joinChannel: Xano realtime not initialized. Make sure Xano is loaded."
      );
      return;
    }

    window.xano.setAuthToken(authToken);
    window.xano.setRealtimeAuthToken(authToken);
    if (typeof window.xano.realtimeReconnect === "function")
      window.xano.realtimeReconnect();

    window.currentAuthToken = authToken;
    window.currentRealtimeHash = realtimeHash;

    const channelKey = channelName.split("/").join("_");

    window.xanoRealtime = window.xanoRealtime || {};
    let exists = !window.xanoRealtime[channelKey] == false;

    const channel = window.xano.channel(channelName, { ...channelOptions });

    if (exists == false) {
      let isProcessing = false;
      const messageQueue = [];

      const processMessageQueue = async () => {
        if (isProcessing || messageQueue.length === 0) return;
        isProcessing = true;

        try {
          while (messageQueue.length > 0) {
            const data = messageQueue.shift();

            try {
              if (window.handleRefreshEvent && window.handleRefreshEvent(data))
                continue;

              if (data.action === "message" || data.action === "event") {
                const urlParams = new URLSearchParams(window.location.search);
                const chatId = urlParams.get("chatid");
                if (!chatId) {
                  console.warn("No chatId found in URL parameters");
                  continue;
                }

                let messagesToProcess = [];

                if (
                  data.action === "message" &&
                  data.payload &&
                  Array.isArray(data.payload)
                ) {
                  messagesToProcess = data.payload;
                  if (!hasReceivedInitialHistory) {
                    hasReceivedInitialHistory = true;
                    console.log(
                      "Initial history received, processing all messages"
                    );
                  }
                } else if (
                  data.action === "event" &&
                  data.payload &&
                  data.payload.data
                ) {
                  if (typeof data.payload.data === "string") {
                    try {
                      messagesToProcess = JSON.parse(data.payload.data);
                    } catch (e) {
                      console.error("Failed to parse event payload data:", e);
                      continue;
                    }
                  } else if (Array.isArray(data.payload.data)) {
                    messagesToProcess = data.payload.data;
                  }
                }

                if (!Array.isArray(messagesToProcess)) {
                  console.warn(
                    "messagesToProcess is not an array:",
                    messagesToProcess
                  );
                  continue;
                }

                const relevant = messagesToProcess.filter(
                  (message) =>
                    String(message.conversation_id) === String(chatId)
                );

                if (relevant.length > 0) {
                  const INITIAL_MESSAGE_LIMIT = 50;
                  let messagesToInject;

                  if (
                    data.action === "message" &&
                    relevant.length > INITIAL_MESSAGE_LIMIT
                  ) {
                    messagesToInject = relevant
                      .sort(
                        (a, b) =>
                          parseTime(a.created_at) - parseTime(b.created_at)
                      )
                      .slice(-INITIAL_MESSAGE_LIMIT);

                    const olderMessages = relevant.slice(
                      0,
                      -INITIAL_MESSAGE_LIMIT
                    );
                    if (olderMessages.length > 0) {
                      window.olderMessages = window.olderMessages || {};
                      window.olderMessages[chatId] = olderMessages;
                      console.log(
                        `Stored ${olderMessages.length} older messages for conversation ${chatId}`
                      );
                    }
                  } else {
                    messagesToInject = relevant;
                  }

                  try {
                    window.enqueueOrInjectMessages(messagesToInject);

                    await new Promise((r) => setTimeout(r, 100));

                    const rg = window.findVisibleRG?.() ?? null;
                    if (rg !== null) {
                      const refreshFn = `bubble_fn_refreshConversations${rg}`;
                      if (typeof window[refreshFn] === "function") {
                        try {
                          window[refreshFn]();
                        } catch (error) {
                          console.error(`Error calling ${refreshFn}:`, error);
                        }
                      }
                    }
                  } catch (injectionError) {
                    console.error("Error injecting messages:", injectionError);
                  }
                }
              }
            } catch (error) {
              console.error("Error processing individual message:", error);
            }
          }
        } catch (error) {
          console.error("Error in message queue processing:", error);
        } finally {
          isProcessing = false;
        }
      };

      window.processMessageQueue = processMessageQueue;

      channel.on((data) => {
        messageQueue.push(data);
        processMessageQueue();

        if (window.xanoRealtimeListeners) {
          window.xanoRealtimeListeners.map((x) => {
            if (x.data.channel == channelName || x.data.channel == null)
              x.data.message_received(data);
          });
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

    console.info(
      `joinChannel: Successfully joined channel ${channelName} for user ${userId}`
    );

    setTimeout(() => {
      if (typeof window.bubble_fn_joinedChannel === "function") {
        window.bubble_fn_joinedChannel(true);
        console.log("Called bubble_fn_joinedChannel after 2 second delay");
      }
    }, 2000);

    return channel;
  } catch (error) {
    console.error("joinChannel: Error joining channel", error);
    window.currentChannel = null;
    window.currentUserId = null;
    throw error;
  }
};

window.leaveChannel = (rg, userId) => {
  if (typeof rg !== "number") {
    console.error("leaveChannel: rg must be a number");
    return;
  }
  if (!userId) {
    console.error("leaveChannel: userId is required");
    return;
  }

  const channelInfo = window.currentChannel;
  if (!channelInfo || channelInfo.userId !== userId || channelInfo.rg !== rg) {
    console.warn(
      `leaveChannel: Not in channel for user ${userId} in rg${rg} or no active channel`
    );
    return;
  }

  try {
    const channelKey = channelInfo.channelKey;
    const channelName = channelInfo.channelName;

    if (window.xanoRealtime && window.xanoRealtime[channelKey]) {
      const channel = window.xanoRealtime[channelKey].channel;
      if (channel && typeof channel.disconnect === "function")
        channel.disconnect();
      else if (channel && typeof channel.leave === "function") channel.leave();
      delete window.xanoRealtime[channelKey];
    }

    window.currentChannel = null;
    window.currentUserId = null;
    console.info(
      `leaveChannel: Successfully left channel ${channelName} for user ${userId} in rg${rg}`
    );
  } catch (error) {
    console.error("leaveChannel: Error leaving channel", error);
    throw error;
  }
};

window.getCurrentChannel = () => window.currentChannel || null;
window.isInChannel = (rg, userId) =>
  window.currentChannel?.userId === userId && window.currentChannel?.rg === rg;

/* ─────────── LOAD OLDER MESSAGES ─────────── */
window.loadOlderMessages = (batchSize = 50) => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get("chatid");
  if (!chatId) {
    console.error("loadOlderMessages: No chatid in URL");
    return false;
  }
  if (!window.olderMessages || !window.olderMessages[chatId]) {
    console.log("loadOlderMessages: No older messages available");
    return false;
  }

  const rg = window.findVisibleRG();
  if (rg === null) {
    console.error("loadOlderMessages: No visible RG found");
    return false;
  }

  const olderMessages = window.olderMessages[chatId];
  if (!olderMessages.length) {
    console.log("loadOlderMessages: All older messages already loaded");
    return false;
  }

  const messagesToLoad = olderMessages.splice(-batchSize, batchSize);
  if (!messagesToLoad.length) {
    console.log("loadOlderMessages: No more messages to load");
    return false;
  }

  console.log(
    `loadOlderMessages: Loading ${messagesToLoad.length} older messages`
  );
  window.injectMessages(rg, messagesToLoad, window.currentUserId, true);
  console.log(
    `loadOlderMessages: ${olderMessages.length} older messages remaining`
  );
  return true;
};

window.getOlderMessagesCount = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const chatId = urlParams.get("chatid");
  if (!chatId || !window.olderMessages || !window.olderMessages[chatId])
    return 0;
  return window.olderMessages[chatId].length;
};

/* ─────────── SEND MESSAGE (no optimistic path) ─────────── */
window.sendMessage = (messageData) => {
  if (!messageData || typeof messageData !== "object") {
    console.error("sendMessage: messageData is required and must be an object");
    return Promise.reject(
      new Error("Message data is required and must be an object")
    );
  }

  const channelInfo = window.currentChannel;
  if (!channelInfo) {
    console.error("sendMessage: No active channel. Join a channel first.");
    return Promise.reject(new Error("No active channel"));
  }

  try {
    const channelKey = channelInfo.channelKey;
    if (!window.xanoRealtime || !window.xanoRealtime[channelKey]) {
      console.error("sendMessage: Channel not found in xanoRealtime");
      return Promise.reject(new Error("Channel not found in xanoRealtime"));
    }
    const thisChannel = window.xanoRealtime[channelKey].channel;
    if (!thisChannel) {
      console.error("sendMessage: Channel object not found");
      return Promise.reject(new Error("Channel object not found"));
    }

    console.log("Sending message:", messageData);
    thisChannel.message(messageData);
    console.log("Message sent successfully");
    return Promise.resolve();
  } catch (error) {
    console.error("sendMessage: Error sending message", error);
    return Promise.reject(error);
  }
};

/* ─────────── EXTRACT LAST 10 MESSAGES ─────────── */
function extractLast10Messages() {
  const container = document.querySelector(".chat-messages");
  if (!container) return [];
  const messageElements = Array.from(container.querySelectorAll(".message"));
  const last10 = messageElements.slice(-10);
  return last10.map((el) => ({
    sender: el.dataset.username || "Unknown",
    message: el.dataset.message || "",
  }));
}

