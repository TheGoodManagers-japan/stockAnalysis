// sumizy-chat-realtime-ui.js
// Minimal, duplicate-safe realtime UI: join -> history -> live.
// Handles server history via {action:"message"} (ONLY while joining)
// and live updates via either {action:"event", payload.data:"[]"} or {action:"message"} after live.

/* ─────────── Helpers ─────────── */
function parseTime(t) {
  return typeof t === "number" ? t : Date.parse(t) || 0;
}
function getChatIdFromUrl() {
  try {
    const v = new URLSearchParams(location.search).get("chatid");
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}
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
function clearActiveChatDom() {
  const rg = window.findVisibleRG?.() ?? null;
  if (rg === null) return;
  const container = document.querySelector(`#rg${rg} .chat-messages`);
  if (container) container.innerHTML = "";
  if (typeof window.hideAITypingIndicator === "function") {
    try {
      window.hideAITypingIndicator();
    } catch {}
  }
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

/* ─────────── In-place updaters (no node swaps) ─────────── */
function updateMessageTextsInPlace(msgEl, msg, { forDelete = false } = {}) {
  const translations = Array.isArray(msg._translations)
    ? msg._translations
    : [];
  const enTr = translations.find(
    (t) => t && (t.language === "en" || t.language === "en_us")
  );
  const deleteText =
    (enTr && enTr.translated_text) || msg.message || "Message Unsent";

  const contentWrap = msgEl.querySelector(".message-content-wrapper") || msgEl;

  const original =
    contentWrap.querySelector(":scope > .message-text.lang-original") ||
    contentWrap.querySelector(":scope > .message-text:not([class*='lang-'])") ||
    (() => {
      const d = document.createElement("div");
      d.className = "message-text lang-original";
      contentWrap.appendChild(d);
      return d;
    })();

  if (original) {
    original.textContent = forDelete ? deleteText : msg.message ?? "";
  }

  const trNodes = Array.from(
    contentWrap.querySelectorAll(":scope > .message-text[class*='lang-']")
  );

  if (trNodes.length) {
    const trMap = new Map();
    for (const t of translations) {
      if (t && t.language)
        trMap.set(String(t.language).toLowerCase(), t.translated_text || "");
    }
    trNodes.forEach((node) => {
      const m = node.className.match(/lang-([a-zA-Z_]+)/);
      const lang = m ? m[1].toLowerCase() : "original";
      if (lang === "original") return;
      const txt = forDelete ? deleteText : trMap.get(lang);
      if (typeof txt === "string") node.textContent = txt;
    });
  }

  if (typeof msg.message === "string") {
    msgEl.dataset.message = msg.message;
  }
}

function updateReactionsInPlace(msgEl, msg, currentUserId) {
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
    const emoji = r.e;
    const count = Number(r.c) || 0;
    const userIds = Array.isArray(r.userIds) ? r.userIds : [];
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
}

/* ─────────── Update any reply previews that reference a message ─────────── */
function updateReplyPreviewsForMessage(msg) {
  const id = String(msg?.id || "");
  if (!id) return;

  const selId =
    window.CSS && CSS.escape ? CSS.escape(id) : id.replace(/"/g, '\\"');
  const nodes = document.querySelectorAll(
    `.reply-preview[data-target-id="${selId}"]`
  );
  if (!nodes.length) return;

  const name = msg?._users?.name || msg?._user?.name || "Unknown";
  const isDeleted = !!msg?.isDeleted;
  const deleteText = "Message Unsent";

  let bodyHTML = "";
  if (msg?.isFile && !isDeleted) {
    const url = _esc(msg.message || "#");
    const fname = _esc(msg.file_name || url.split("/").pop() || "download");
    const type = (msg.file_type || "").toLowerCase();
    const isImg = type.startsWith("image");
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
    const originalText = isDeleted ? deleteText : msg.message || "";
    bodyHTML =
      `<div class="message-text lang-original">${_esc(originalText)}</div>` +
      (!isDeleted && Array.isArray(msg._translations)
        ? msg._translations
            .map(
              (tr) => `
        <div class="message-text lang-${_esc(
          tr.language
        )}" style="display:none;">
          ${_esc(tr.translated_text)}
        </div>`
            )
            .join("")
        : "");
  }

  nodes.forEach((node) => {
    const header = node.querySelector(".reply-preview-header .reply-to-name");
    if (header) header.textContent = name;
    const children = Array.from(node.children);
    children.forEach((c, i) => {
      if (i > 0) c.remove();
    });
    node.insertAdjacentHTML("beforeend", bodyHTML);
  });

  nodes.forEach((node) => {
    if (isDeleted) {
      node.dataset.deleted = "true";
      node.classList.add("is-deleted");
    } else {
      node.dataset.deleted = "false";
      node.classList.remove("is-deleted");
    }
  });
  
}

/** In-place message patcher (no node removal). */
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

  if (msg.created_at != null) {
    const ts = parseTime(msg.created_at);
    if (!Number.isNaN(ts)) el.dataset.ts = String(ts);
  }

  updateMessageTextsInPlace(el, msg, { forDelete: !!msg.isDeleted });
  updateReactionsInPlace(el, msg, window.currentUserId);
  updateReplyPreviewsForMessage(msg);

  return true;
}

/* ─────────── Minimal per-chat state ─────────── */
window._activeChatId = window._activeChatId || null;
window._chatGen = window._chatGen || 0; // increments on chat switch
window._chatState = window._chatState || {};

function getState(chatId) {
  return (window._chatState[chatId] ||= {
    phase: "idle", // idle -> join_sent -> injecting_history -> live
    seen: new Set(),
    lastTs: 0,
    prebuffer: [],
    // Join guards (single-flight)
    joinGen: -1,
    joinDispatched: false,
    joinPending: false,
    joinRetryTid: 0,
    joinRetryCount: 0,
  });
}
function resetState(chatId) {
  window._chatState[chatId] = {
    phase: "idle",
    seen: new Set(),
    lastTs: 0,
    prebuffer: [],
  };
  return window._chatState[chatId];
}

/* ─────────── History + live injection ─────────── */
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
}
function injectBatch(rg, chatId, batch) {
  if (!batch.length) return;
  if (typeof window.injectMessages !== "function") return;
  window.injectMessages(rg, batch, window.currentUserId);

  const st = getState(chatId);
  for (const m of batch) {
    if (m?.id) st.seen.add(String(m.id));
    if (m?.created_at != null) {
      const ts = parseTime(m.created_at);
      if (ts > st.lastTs) st.lastTs = ts;
    }
  }
  afterInjectUiRefresh(rg);
}
function injectHistoryAndGoLive(chatId, incomingHistory) {
  const rg = window.findVisibleRG?.() ?? null;
  if (rg === null) return;
  if (chatId !== window._activeChatId) return;

  const st = getState(chatId);
  st.phase = "injecting_history";

  const combined = dedupeById(
    [...(incomingHistory || []), ...(st.prebuffer || [])],
    st.seen
  );
  const ordered = sortAscByTs(combined);

  if (ordered.length) {
    clearActiveChatDom();
    injectBatch(rg, chatId, ordered);
  }

  st.prebuffer = [];
  st.phase = "live";
}

/* ─────────── Channel join/leave/send ─────────── */
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
  if (!userId || !authToken || !realtimeHash) return;
  try {
    const channelName = `sumizy/${userId}`;
    if (!window.xano) return;

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
      channel.on((data) => {
        try {
          const active = window._activeChatId;
          if (!active) return;

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

          let relevant = incoming.filter(
            (m) => String(m?.conversation_id ?? "") === String(active)
          );
          if (!relevant.length) return;

          const st = getState(active);

          const rg = window.findVisibleRG?.() ?? null;
          const updatedIds = new Set();
          if (rg !== null) {
            for (const m of relevant) {
              if (!m || !m.id) continue;
              const exists = document.querySelector(
                `#rg${rg} .chat-messages .message[data-id="${safeSelId(m.id)}"]`
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
            if (updatedIds.size > 0) afterInjectUiRefresh(rg);
          }
          relevant = relevant.filter((m) => !updatedIds.has(String(m?.id)));

          if (
            st.phase === "join_sent" ||
            st.phase === "injecting_history" ||
            st.phase === "idle"
          ) {
            if (data.action === "message") {
              injectHistoryAndGoLive(active, relevant);
            } else {
              const fresh = dedupeById(relevant, st.seen);
              if (fresh.length) {
                st.prebuffer.push(...fresh);
                for (const m of fresh) {
                  const ts = parseTime(m.created_at);
                  if (ts > st.lastTs) st.lastTs = ts;
                }
              }
            }
            return;
          }

          if (st.phase === "live") {
            const fresh = dedupeById(relevant, st.seen);
            if (!fresh.length) return;

            const toAppend = sortAscByTs(fresh).filter(
              (m) => parseTime(m.created_at) >= st.lastTs
            );
            if (!toAppend.length) return;

            const rg2 = window.findVisibleRG?.() ?? null;
            if (rg2 === null) return;
            if (active !== window._activeChatId) return;
            injectBatch(rg2, active, toAppend);
            return;
          }
        } catch (err) {}
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

    setTimeout(() => {
      if (typeof window.bubble_fn_joinedChannel === "function") {
        try {
          window.bubble_fn_joinedChannel(true);
        } catch {}
      }
      // Nudge ensureJoin in case initial attempt happened before channel became ready
      if (typeof window.ensureJoinForActiveChat === "function") {
        try {
          window.ensureJoinForActiveChat(true);
        } catch {}
      }
    }, 1000);

    return channel;
  } catch (error) {
    window.currentChannel = null;
    window.currentUserId = null;
    throw error;
  }
};

window.leaveChannel = (rg, userId) => {
  if (typeof rg !== "number") return;
  if (!userId) return;

  const info = window.currentChannel;
  if (!info || info.userId !== userId || info.rg !== rg) {
    return;
  }

  try {
    const channelKey = info.channelKey;
    if (window.xanoRealtime && window.xanoRealtime[channelKey]) {
      const channel = window.xanoRealtime[channelKey].channel;
      if (channel && typeof channel.disconnect === "function")
        channel.disconnect();
      else if (channel && typeof channel.leave === "function") channel.leave();
      delete window.xanoRealtime[channelKey];
    }

    window.currentChannel = null;
    window.currentUserId = null;
  } catch (error) {
    throw error;
  }
};

window.getCurrentChannel = () => window.currentChannel || null;
window.isInChannel = (rg, userId) =>
  window.currentChannel?.userId === userId && window.currentChannel?.rg === rg;

window.sendMessage = (messageData) => {
  if (!messageData || typeof messageData !== "object") {
    return Promise.reject(
      new Error("Message data is required and must be an object")
    );
  }
  const info = window.currentChannel;
  if (!info) {
    return Promise.reject(new Error("No active channel"));
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
    ch.message(messageData);
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
};

/* ─────────── Ensure-join on visible container (single-flight + channel-ready) ─────────── */
function isChannelReady() {
  const info = window.currentChannel;
  if (!info) return false;
  const ch = window.xanoRealtime?.[info.channelKey]?.channel;
  return !!(ch && typeof ch.message === "function");
}

window.ensureJoinForActiveChat = function ensureJoinForActiveChat(
  force = false
) {
  const chatId = getChatIdFromUrl();
  if (!chatId) return;

  const st = getState(chatId);
  const currentGen = window._chatGen || 0;

  // Re-init on new navigation gen
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
    clearActiveChatDom();
  }

  // Guard: if we've already dispatched or are pending, don't start another
  if (st.joinDispatched || st.joinPending) return;

  const rg = window.findVisibleRG?.() ?? null;
  const container =
    rg !== null ? document.querySelector(`#rg${rg} .chat-messages`) : null;

  const trySend = () => {
    const s = getState(chatId);
    if (s.joinGen !== currentGen) return; // stale timer
    if (s.joinDispatched) return;

    const rgNow = window.findVisibleRG?.() ?? null;
    const cNow =
      rgNow !== null
        ? document.querySelector(`#rg${rgNow} .chat-messages`)
        : null;

    // Wait for BOTH container and channel
    if (!cNow || !isChannelReady()) {
      if (s.joinRetryCount < 40) {
        // ~8s at 200ms steps
        s.joinRetryCount++;
        s.joinRetryTid = setTimeout(trySend, 200);
      } else {
        s.joinPending = false;
        s.joinRetryTid = 0;
        s.joinRetryCount = 0;
      }
      return;
    }

    const shouldJoin = s.phase === "idle" || (force && s.phase === "live");
    if (!shouldJoin) {
      s.joinPending = false;
      return;
    }

    s.joinDispatched = true;
    s.joinPending = false;
    s.joinRetryTid = 0;
    s.joinRetryCount = 0;
    s.phase = "join_sent";

    window.sendMessage({
      isReaction: false,
      isDelete: false,
      isJoin: true,
      conversation_id: chatId,
      message: "",
    });
  };

  // If container or channel is not ready yet, schedule the (single-flight) retry chain
  if (!container || !isChannelReady()) {
    st.joinPending = true;
    if (!st.joinRetryTid) {
      st.joinRetryCount = 0;
      st.joinRetryTid = setTimeout(trySend, 0);
    }
    return;
  }

  // Immediate path (everything ready)
  st.joinDispatched = true;
  st.phase = "join_sent";

  window.sendMessage({
    isReaction: false,
    isDelete: false,
    isJoin: true,
    conversation_id: chatId,
    message: "",
  });
};

/* ─────────── Route watcher: clear & (re)join on chat change ─────────── */
function handleChatRouteChange() {
  const next = getChatIdFromUrl();
  const prev = window._activeChatId || null;

  if (!next) {
    if (prev !== null) clearActiveChatDom();
    window._activeChatId = null;
    return;
  }

  if (next !== prev) {
    window._activeChatId = next;
    window._chatGen = (window._chatGen || 0) + 1;
    resetState(next);
    clearActiveChatDom();
    window.ensureJoinForActiveChat(true);
    return;
  }

  window.ensureJoinForActiveChat(false);
}

/* ─────────── Wire up basic SPA navigation hooks ─────────── */
(function wireNavigationWatch() {
  if (window.__sumizyRouteWatchWired) return;
  window.__sumizyRouteWatchWired = true;

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

  window.addEventListener("popstate", handleChatRouteChange);
  window.addEventListener("hashchange", handleChatRouteChange);
  window.addEventListener("locationchange", handleChatRouteChange);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleChatRouteChange, {
      once: true,
    });
  } else {
    handleChatRouteChange();
  }
})();

/* ─────────── Optional: Older messages API (no-op unless you wire data) ─────────── */
window.loadOlderMessages = () => false;
window.getOlderMessagesCount = () => 0;

// (Optional) expose helpers if other modules need them
Object.assign(window, {
  patchMessageInPlace,
  updateReplyPreviewsForMessage,
  updateMessageTextsInPlace,
  updateReactionsInPlace,
});
