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

/* ─────────── Minimal per-chat state ─────────── */
window._activeChatId = window._activeChatId || null;
window._chatGen = window._chatGen || 0; // increments on chat switch
window._chatState = window._chatState || {}; // { [chatId]: { phase, seen, lastTs, prebuffer } }

function getState(chatId) {
  return (window._chatState[chatId] ||= {
    phase: "idle", // idle -> join_sent -> injecting_history -> live
    seen: new Set(),
    lastTs: 0,
    prebuffer: [],
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

  // Mark as seen and bump lastTs
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

/* Inject the one authoritative history (plus any prebuffer that arrived before) */
function injectHistoryAndGoLive(chatId, incomingHistory) {
  const rg = window.findVisibleRG?.() ?? null;
  if (rg === null) return;
  if (chatId !== window._activeChatId) return; // navigated away

  const st = getState(chatId);
  st.phase = "injecting_history";

  const combined = dedupeById(
    [...(incomingHistory || []), ...(st.prebuffer || [])],
    st.seen
  );
  const ordered = sortAscByTs(combined);

  clearActiveChatDom();
  injectBatch(rg, chatId, ordered);

  st.prebuffer = [];
  st.phase = "live";
}

/* ─────────── Channel join/leave/send ─────────── */
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
  if (!userId || !authToken || !realtimeHash) {
    console.error(
      "joinChannel: userId, authToken, and realtimeHash are required"
    );
    return;
  }
  try {
    const channelName = `sumizy/${userId}`;
    if (!window.xano) {
      console.error("joinChannel: Xano realtime not initialized.");
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
      channel.on((data) => {
        try {
          if (typeof window.handleRefreshEvent === "function") {
            try {
              if (window.handleRefreshEvent(data)) return;
            } catch {}
          }

          const active = window._activeChatId;
          if (!active) return;

          // Normalize incoming array for both 'message' and 'event'
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

          // Filter to active conversation
          let relevant = incoming.filter(
            (m) => String(m?.conversation_id ?? "") === String(active)
          );
          if (!relevant.length) return;

          const st = getState(active);

          // While joining: only treat action: "message" as history; events are prebuffered
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

          // LIVE: treat both action types as live updates (append-only)
          if (st.phase === "live") {
            const fresh = dedupeById(relevant, st.seen);
            if (!fresh.length) return;

            // Append in timestamp order; ignore out-of-order older than lastTs
            const toAppend = sortAscByTs(fresh).filter(
              (m) => parseTime(m.created_at) >= st.lastTs
            );
            if (!toAppend.length) return;

            const rg = window.findVisibleRG?.() ?? null;
            if (rg === null) return;
            if (active !== window._activeChatId) return; // navigated away
            injectBatch(rg, active, toAppend);
            return;
          }
        } catch (err) {
          console.error("Realtime handler error:", err);
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

    console.info(`joinChannel: joined ${channelName} for user ${userId}`);

    setTimeout(() => {
      if (typeof window.bubble_fn_joinedChannel === "function") {
        try {
          window.bubble_fn_joinedChannel(true);
        } catch {}
      }
    }, 1000);

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

  const info = window.currentChannel;
  if (!info || info.userId !== userId || info.rg !== rg) {
    console.warn(
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
    console.info(
      `leaveChannel: left ${channelName} for user ${userId} in rg${rg}`
    );
  } catch (error) {
    console.error("leaveChannel: Error leaving channel", error);
    throw error;
  }
};

window.getCurrentChannel = () => window.currentChannel || null;
window.isInChannel = (rg, userId) =>
  window.currentChannel?.userId === userId && window.currentChannel?.rg === rg;

window.sendMessage = (messageData) => {
  if (!messageData || typeof messageData !== "object") {
    console.error("sendMessage: messageData is required and must be an object");
    return Promise.reject(
      new Error("Message data is required and must be an object")
    );
  }
  const info = window.currentChannel;
  if (!info) {
    console.error("sendMessage: No active channel. Join a channel first.");
    return Promise.reject(new Error("No active channel"));
  }
  try {
    const channelKey = info.channelKey;
    if (!window.xanoRealtime || !window.xanoRealtime[channelKey]) {
      console.error("sendMessage: Channel not found in xanoRealtime");
      return Promise.reject(new Error("Channel not found in xanoRealtime"));
    }
    const ch = window.xanoRealtime[channelKey].channel;
    if (!ch) {
      console.error("sendMessage: Channel object not found");
      return Promise.reject(new Error("Channel object not found"));
    }
    ch.message(messageData);
    return Promise.resolve();
  } catch (error) {
    console.error("sendMessage: Error sending message", error);
    return Promise.reject(error);
  }
};

/* ─────────── Ensure-join on visible container ─────────── */
window.ensureJoinForActiveChat = function ensureJoinForActiveChat(
  force = false
) {
  const chatId = getChatIdFromUrl();
  if (!chatId) return;

  const st = getState(chatId);

  // If already live and not forcing, do nothing
  if (st.phase === "live" && !force) return;

  // Only proceed when the container exists/visible
  const rg = window.findVisibleRG?.() ?? null;
  const container =
    rg !== null ? document.querySelector(`#rg${rg} .chat-messages`) : null;
  if (!container) {
    // Small, bounded retry loop
    const key = "__join_retry_" + (window._chatGen || 0);
    const count = (window[key] ||= 0);
    if (count < 10) {
      window[key] = count + 1;
      setTimeout(() => window.ensureJoinForActiveChat(force), 200);
    }
    return;
  }

  // Send join only once per switch (or when forced)
  if (st.phase === "idle" || force) {
    st.phase = "join_sent";
    st.prebuffer = [];
    st.seen.clear();
    st.lastTs = 0;

    clearActiveChatDom();

    window.sendMessage({
      isReaction: false,
      isDelete: false,
      isJoin: true,
      conversation_id: chatId,
      message: "",
    });
  }
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
