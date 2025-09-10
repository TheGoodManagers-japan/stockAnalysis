// sumizy-chat-realtime-ui.js (DEBUG BUILD)
// Minimal, duplicate-safe realtime UI: join -> history -> live.
// Adds detailed logs to trace any duplicate isJoin sends.

// ==== DEBUG UTIL ====
(function () {
  if (!window.__SUMIZY_DEBUG) {
    window.__SUMIZY_DEBUG = true; // flip to false to silence
  }
  const ns = "[sumizy][realtime-ui]";
  const toJSON = (v) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const short = (o) => {
    if (!o || typeof o !== "object") return o;
    return {
      ...o,
      seenSize: o.seen instanceof Set ? o.seen.size : undefined,
      prebufferLen: Array.isArray(o.prebuffer) ? o.prebuffer.length : undefined,
    };
  };
  window.__log = function (...args) {
    if (!window.__SUMIZY_DEBUG) return;
    console.debug(ns, ...args);
  };
  window.__trace = function (...args) {
    if (!window.__SUMIZY_DEBUG) return;
    console.debug(ns, ...args);
    console.trace(ns + " trace");
  };
  window.__warn = function (...args) {
    console.warn(ns, ...args);
  };
  window.__err = function (...args) {
    console.error(ns, ...args);
  };
})();

// ==== Helpers ====
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
  __log("clearActiveChatDom done for rg", rg);
}
function safeSelId(id) {
  const s = String(id ?? "");
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/"/g, '\\"');
}
function ensureEl(parent, selector, make) {
  let el = parent.querySelector(selector);
  if (!el && typeof make === "function") {
    el = make();
    if (el) parent.appendChild(el);
  }
  return el;
}
function _esc(s) {
  if (typeof window.esc === "function") return window.esc(s);
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ==== Reactions aggregation (fallback) ====
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

// ==== In-place updaters ====
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

  if (original)
    original.textContent = forDelete ? deleteText : msg.message ?? "";

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

// Update reply previews
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
}

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

// ==== Per-chat state ====
window._activeChatId = window._activeChatId || null;
window._chatGen = window._chatGen || 0;
window._chatState = window._chatState || {}; // { [chatId]: { ... } }

function getState(chatId) {
  return (window._chatState[chatId] ||= {
    phase: "idle", // idle -> join_sent -> injecting_history -> live
    seen: new Set(),
    lastTs: 0,
    prebuffer: [],
    joinGen: -1, // which navigation this join belongs to
    joinDispatched: false, // has an isJoin been sent this gen?
    joinPending: false, // one in-flight attempt while container not ready
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
  __log("resetState", { chatId });
  return window._chatState[chatId];
}

// ==== History + live injection ====
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
  __log("injectBatch", { rg, chatId, count: batch.length });
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

  __log("injectHistoryAndGoLive", {
    chatId,
    incoming: (incomingHistory || []).length,
    prebuffer: (st.prebuffer || []).length,
    ordered: ordered.length,
  });

  if (ordered.length) {
    clearActiveChatDom();
    injectBatch(rg, chatId, ordered);
  }

  st.prebuffer = [];
  st.phase = "live";
  __log("phase -> live", { chatId });
}

// ==== Channel join/leave/send ====
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
  if (!userId || !authToken || !realtimeHash) {
    __err("joinChannel: userId, authToken, and realtimeHash are required");
  }
  try {
    const channelName = `sumizy/${userId}`;
    if (!window.xano) {
      __err("joinChannel: Xano realtime not initialized.");
      return;
    }

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
      __log("joinChannel: binding channel.on for", channelName);
      channel.on((data) => {
        try {
          __log("realtime inbound", {
            action: data?.action,
            payloadType: typeof data?.payload,
            hasData: !!data?.payload,
          });

          if (typeof window.handleRefreshEvent === "function") {
            try {
              if (window.handleRefreshEvent(data)) {
                __log("realtime inbound handled by handleRefreshEvent");
                return;
              }
            } catch {}
          }

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
          __log("inbound relevant", {
            count: relevant.length,
            phase: st.phase,
            chatId: active,
          });

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
              __log("treat as HISTORY during join");
              injectHistoryAndGoLive(active, relevant);
            } else {
              const fresh = dedupeById(relevant, st.seen);
              if (fresh.length) {
                st.prebuffer.push(...fresh);
                for (const m of fresh) {
                  const ts = parseTime(m.created_at);
                  if (ts > st.lastTs) st.lastTs = ts;
                }
                __log("prebuffer appended", {
                  prebufferLen: st.prebuffer.length,
                });
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
            __log("append live", { count: toAppend.length });
            injectBatch(rg2, active, toAppend);
            return;
          }
        } catch (err) {
          __err("Realtime handler error:", err);
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

    __log("joinChannel: joined", { channelName, userId });

    setTimeout(() => {
      if (typeof window.bubble_fn_joinedChannel === "function") {
        try {
          window.bubble_fn_joinedChannel(true);
        } catch {}
      }
    }, 1000);

    return channel;
  } catch (error) {
    __err("joinChannel: Error joining channel", error);
    window.currentChannel = null;
    window.currentUserId = null;
    throw error;
  }
};

window.leaveChannel = (rg, userId) => {
  if (typeof rg !== "number") {
    __err("leaveChannel: rg must be a number");
    return;
  }
  if (!userId) {
    __err("leaveChannel: userId is required");
    return;
  }

  const info = window.currentChannel;
  if (!info || info.userId !== userId || info.rg !== rg) {
    __warn(
      `leaveChannel: Not in channel for user ${userId} in rg${rg} or no active channel`
    );
    return;
  }

  try {
    const channelKey = info.channelKey;
    const channelName = info.channelName;

    if (window.xanoRealtime && window.xanoRealtime[channelKey]) {
      const channel = window.xanoRealtime[channelKey].channel;
      if (channel && typeof channel.disconnect === "function")
        channel.disconnect();
      else if (channel && typeof channel.leave === "function") channel.leave();
      delete window.xanoRealtime[channelKey];
    }

    window.currentChannel = null;
    window.currentUserId = null;
    __log("leaveChannel: left", { channelName, userId, rg });
  } catch (error) {
    __err("leaveChannel: Error leaving channel", error);
    throw error;
  }
};

window.getCurrentChannel = () => window.currentChannel || null;
window.isInChannel = (rg, userId) =>
  window.currentChannel?.userId === userId && window.currentChannel?.rg === rg;

// Wrap sendMessage to show outbound JOINs
window.sendMessage = (function (orig) {
  return function (messageData) {
    if (!messageData || typeof messageData !== "object") {
      __err("sendMessage: messageData is required and must be an object");
      return Promise.reject(
        new Error("Message data is required and must be an object")
      );
    }
    const info = window.currentChannel;
    if (!info) {
      __err("sendMessage: No active channel. Join a channel first.");
      return Promise.reject(new Error("No active channel"));
    }
    try {
      const channelKey = info.channelKey;
      if (!window.xanoRealtime || !window.xanoRealtime[channelKey]) {
        __err("sendMessage: Channel not found in xanoRealtime");
        return Promise.reject(new Error("Channel not found in xanoRealtime"));
      }
      const ch = window.xanoRealtime[channelKey].channel;
      if (!ch) {
        __err("sendMessage: Channel object not found");
        return Promise.reject(new Error("Channel object not found"));
      }

      // DEBUG
      if (messageData.isJoin) {
        __trace("SEND isJoin:true", {
          conversation_id: messageData.conversation_id,
          url: location.href,
          _chatGen: window._chatGen,
          _activeChatId: window._activeChatId,
        });
      } else {
        __log("SEND", messageData);
      }

      ch.message(messageData);
      return Promise.resolve();
    } catch (error) {
      __err("sendMessage: Error sending message", error);
      return Promise.reject(error);
    }
  };
})(
  window.sendMessage ||
    function (msg) {
      __warn(
        "sendMessage wrapper: base sendMessage missing, using best-effort ch.message path"
      );
      const info = window.currentChannel;
      const ch = info && window.xanoRealtime?.[info.channelKey]?.channel;
      ch?.message?.(msg);
      return Promise.resolve();
    }
);

// ==== Ensure-join (idempotent per navigation) ====
window.ensureJoinForActiveChat = function ensureJoinForActiveChat(
  force = false
) {
  const chatId = getChatIdFromUrl();
  if (!chatId) {
    __log("ensureJoin: no chatId in URL");
    return;
  }

  const st = getState(chatId);
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
    clearActiveChatDom();
    __log("ensureJoin: init for gen", currentGen, { chatId });
  }

  __log("ensureJoin: entry", {
    chatId,
    force,
    gen: currentGen,
    st: {
      phase: st.phase,
      joinDispatched: st.joinDispatched,
      joinPending: st.joinPending,
      joinRetryCount: st.joinRetryCount,
    },
  });

  if (st.joinDispatched || st.joinPending) {
    __log("ensureJoin: already dispatched or pending — skip");
    return;
  }

  const rg = window.findVisibleRG?.() ?? null;
  const container =
    rg !== null ? document.querySelector(`#rg${rg} .chat-messages`) : null;

  const trySend = () => {
    const s = getState(chatId);
    if (s.joinGen !== currentGen) {
      __log("ensureJoin: stale timer — abort");
      return;
    }
    if (s.joinDispatched) {
      __log("ensureJoin: timer sees already dispatched — abort");
      return;
    }

    const rgNow = window.findVisibleRG?.() ?? null;
    const cNow =
      rgNow !== null
        ? document.querySelector(`#rg${rgNow} .chat-messages`)
        : null;

    if (!cNow) {
      if (s.joinRetryCount < 10) {
        s.joinRetryCount++;
        __log("ensureJoin: container missing, retry#", s.joinRetryCount);
        s.joinRetryTid = setTimeout(trySend, 200);
      } else {
        __warn("ensureJoin: retries exhausted");
        s.joinPending = false;
        s.joinRetryTid = 0;
        s.joinRetryCount = 0;
      }
      return;
    }

    const shouldJoin = s.phase === "idle" || (force && s.phase === "live");
    __log("ensureJoin: timer trySend", { shouldJoin, phase: s.phase, force });

    if (!shouldJoin) {
      s.joinPending = false;
      return;
    }

    s.joinDispatched = true;
    s.joinPending = false;
    s.joinRetryTid = 0;
    s.joinRetryCount = 0;
    s.phase = "join_sent";

    __trace("ensureJoin: SENDING isJoin (timer path)", {
      chatId,
      gen: currentGen,
    });
    window.sendMessage({
      isReaction: false,
      isDelete: false,
      isJoin: true,
      conversation_id: chatId,
      message: "",
    });
  };

  if (!container) {
    st.joinPending = true;
    if (!st.joinRetryTid) {
      st.joinRetryCount = 0;
      __log("ensureJoin: schedule first retry (no container yet)");
      st.joinRetryTid = setTimeout(trySend, 0);
    }
    return;
  }

  st.joinDispatched = true;
  st.phase = "join_sent";

  __trace("ensureJoin: SENDING isJoin (immediate path)", {
    chatId,
    gen: currentGen,
  });
  window.sendMessage({
    isReaction: false,
    isDelete: false,
    isJoin: true,
    conversation_id: chatId,
    message: "",
  });
};

// ==== Route watcher ====
function handleChatRouteChange(trigger) {
  const next = getChatIdFromUrl();
  const prev = window._activeChatId || null;

  __log("route change", {
    trigger,
    url: location.href,
    prev,
    next,
    gen: window._chatGen,
  });

  if (!next) {
    if (prev !== null) clearActiveChatDom();
    window._activeChatId = null;
    return;
  }

  if (next !== prev) {
    window._activeChatId = next;
    window._chatGen = (window._chatGen || 0) + 1;
    __log("chat switch", { next, newGen: window._chatGen });
    resetState(next);
    clearActiveChatDom();
    window.ensureJoinForActiveChat(true);
    return;
  }

  window.ensureJoinForActiveChat(false);
}

// Wire with guards and per-event wrappers so we can see the trigger
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

  const onPop = (e) => handleChatRouteChange("popstate");
  const onHash = (e) => handleChatRouteChange("hashchange");
  const onLoc = (e) => handleChatRouteChange("locationchange");

  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", onHash);
  window.addEventListener("locationchange", onLoc);

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        handleChatRouteChange("DOMContentLoaded");
      },
      { once: true }
    );
  } else {
    handleChatRouteChange("immediate");
  }

  __log("route watchers wired");
})();

// ==== Older messages API (no-op stubs) ====
window.loadOlderMessages = () => false;
window.getOlderMessagesCount = () => 0;

// ==== Expose helpers (optional) ====
Object.assign(window, {
  patchMessageInPlace,
  updateReplyPreviewsForMessage,
  updateMessageTextsInPlace,
  updateReactionsInPlace,
});
