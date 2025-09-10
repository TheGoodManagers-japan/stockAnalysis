// sumizy-chat-ux-extras.js

/* ─────────── SAFE FALLBACKS ─────────── */
window.esc =
  window.esc ||
  function (s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

window.buildReplyHtml =
  window.buildReplyHtml ||
  function (msgEl) {
    const user = msgEl?.dataset?.username || "User";
    const txt = msgEl?.dataset?.message || "";
    return `<div class="reply-quote"><strong>${esc(user)}:</strong> ${esc(
      txt
    )}</div>`;
  };

/* ─────────── AI TYPING INDICATOR ─────────── */
let typingIndicatorElement = null;
let typingIndicatorTimeout = null;
window.aiTypingActive = false;

window.showAITypingIndicator = function (rgNum) {
  if (!window.isAIChat || !window.isAIChat()) return;
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

  // renderMsg should exist from render file; if not, just inject the HTML wrapper
  let typingHTML = "";
  try {
    typingHTML =
      typeof renderMsg === "function"
        ? renderMsg(typingMessage, null)
        : `<div class="message typing-indicator">${typingMessage.message}</div>`;
  } catch {
    typingHTML = `<div class="message typing-indicator">${typingMessage.message}</div>`;
  }

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

/* ─────────── ADD STYLES (typing + file viewer + reaction pointer) ─────────── */
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

    /* Make reaction pills obviously clickable */
    .reaction, .reaction-pill, .reaction-count { cursor: pointer; }
  `;
  document.head.appendChild(style);
}

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
              (emo) =>
                `<span class="emoji-option" data-id="${esc(
                  msgId
                )}" data-emoji="${emo}" style="cursor:pointer">${emo}</span>`
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
      if (typeof window[fn] === "function") {
        msgEl.classList.add("is-deleting"); // (optional) visual feedback
        Promise.resolve(window[fn]({ output1: msgId }))
          .catch(() => {
            // you can surface an error toast here if you want
          })
          .finally(() => {
            msgEl.classList.remove("is-deleting"); // revert pending style
          });
      }
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

/* ─────────── REACTION PILL CLICK (robust) ─────────── */
document.addEventListener("click", (e) => {
  const pill = e.target.closest(".reaction, .reaction-pill, .reaction-count");
  if (!pill) return;

  const msg = pill.closest(".message");
  const rgEl = msg?.closest('[id^="rg"]');
  const msgId = msg?.dataset?.id || "";
  if (!rgEl || !msgId) return;

  // Try multiple ways to get the emoji value
  let emoji =
    pill.dataset?.emoji ||
    pill.getAttribute?.("data-emoji") ||
    pill.querySelector?.(".emoji")?.textContent ||
    pill.textContent ||
    "";

  emoji = (emoji || "").trim().split(/\s+/)[0]; // if "👍 3", grab "👍"
  if (!emoji) return;

  e.preventDefault();
  e.stopPropagation();

  const rg = rgEl.id.replace("rg", "");
  const fn = `bubble_fn_reaction${rg}`;
  if (typeof window[fn] === "function") {
    window[fn]({ output1: msgId, output2: emoji });
  }
});

/* ─────────── AI CHAT MODE DETECTOR (robust + SPA-safe) ─────────── */
(() => {
  function isAIChatUrl(href = location.href) {
    try {
      const u = new URL(href, location.origin);
      const q = u.searchParams;
      const path = (u.pathname || "").toLowerCase();
      const hash = (u.hash || "").toLowerCase();
      return (
        path.includes("ai-chat") ||
        q.has("ai-chat") ||
        q.get("mode") === "ai" ||
        q.get("chat") === "ai" ||
        hash.includes("ai-chat")
      );
    } catch {
      return false;
    }
  }

  // Expose a stable global early so other modules can call it at any time
  window.isAIChat = window.isAIChat || (() => isAIChatUrl());

  function applyAIChatMode() {
    const on = isAIChatUrl();
    const b = document.body || document.documentElement; // tolerate early runs
    if (b && b.classList) {
      b.classList.toggle("ai-chat-mode", on);
      b.dataset.aiChat = String(on);
    }
    if (typeof console !== "undefined") {
      console.debug("[sumizy] applyAIChatMode:", { on, href: location.href });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAIChatMode, {
      once: true,
    });
  } else {
    if (document.body) applyAIChatMode();
    else window.addEventListener("load", applyAIChatMode, { once: true });
  }

  const reapply = () => applyAIChatMode();
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

  window.addEventListener("popstate", reapply);
  window.addEventListener("hashchange", reapply);
  window.addEventListener("locationchange", reapply);

  window.applyAIChatMode = window.applyAIChatMode || applyAIChatMode;
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
