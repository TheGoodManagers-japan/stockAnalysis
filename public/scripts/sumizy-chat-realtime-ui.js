//sumizy-chat-realtime-ui.js

/* ─────────── VISIBILITY QUEUE + OBSERVERS ─────────── */
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
window._seenByChat = window._seenByChat || {}; // { chatId: Set(ids) }
window._chatGen = window._chatGen || 0; // bumps on chat switch

window._chatVis = window._chatVis || { observersReady: false };

/* ---------- PATCH: robust visible-flush pipeline ---------- */
window._lastRenderedByChat = window._lastRenderedByChat || {}; // { chatId: Map<id, msg> }

/** Manually hint from your toggle UI still works */
window.signalChatMaybeVisible = function () {
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

      // NEW: mark restored messages as seen and mark history as loaded
      const seen = (window._seenByChat[chatId] ||= new Set());
      for (const m of msgs) {
        if (m && m.id) seen.add(String(m.id));
      }
      window._historySeenByChat = window._historySeenByChat || {};
      window._historySeenByChat[chatId] = true;
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

      // NEW: mark injected messages as seen
      const seen = (window._seenByChat[chatId] ||= new Set());
      for (const m of msgs) {
        if (m && m.id) seen.add(String(m.id));
      }

      const refreshFn = `bubble_fn_refreshConversations${rg}`;
      if (typeof window[refreshFn] === "function") {
        try {
          window[refreshFn]();
        } catch {}
      }
      // Avoid referencing local variables from other files
      if (
        window.aiTypingActive &&
        typeof window.showAITypingIndicator === "function" &&
        !document.querySelector(`#rg${rg} .typing-indicator`)
      ) {
        window.showAITypingIndicator(rg);
      }

      // mark that we've received history for this chat
      try {
        if (chatId) {
          window._historySeenByChat = window._historySeenByChat || {};
          window._historySeenByChat[chatId] = true;
        }
      } catch {}
    } else if (ok && myGen !== window._chatGen) {
      // late write from previous chat -> ignore
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
    if (seen.has(String(m.id))) continue;
    seen.add(String(m.id));
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
window._setupChatVisibilityWatchers =
  window._setupChatVisibilityWatchers || _setupChatVisibilityWatchers;
window._flushPendingIfVisible =
  window._flushPendingIfVisible || _flushPendingIfVisible;

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
    if (seen.has(String(m.id))) continue;
    seen.add(String(m.id));
    toInject.push(m);
  }
  if (!toInject.length) return;

  (async () => {
    const ok = await _tryInject(rg, toInject);
    if (ok && myGen === window._chatGen) {
      _rememberSnapshot(chatId, toInject);

      // NEW: (belt & suspenders) ensure all injected are marked seen
      const seen = (window._seenByChat[chatId] ||= new Set());
      for (const m of toInject) {
        if (m && m.id) seen.add(String(m.id));
      }

      const refreshFn = `bubble_fn_refreshConversations${rg}`;
      if (typeof window[refreshFn] === "function") {
        try {
          window[refreshFn]();
        } catch {}
      }
      // mark that we've received history for this chat
      try {
        if (chatId) {
          window._historySeenByChat = window._historySeenByChat || {};
          window._historySeenByChat[chatId] = true;
        }
      } catch {}
    } else if (ok && myGen !== window._chatGen) {
      // late write from previous chat -> ignore
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
    const already = !!(window.xanoRealtime && window.xanoRealtime[channelKey]);

    // Reuse existing channel if present, otherwise create
    const channel = already
      ? window.xanoRealtime[channelKey].channel
      : window.xano.channel(channelName, { ...channelOptions });

    if (!already) {
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

                if (data.action === "message" && Array.isArray(data.payload)) {
                  messagesToProcess = data.payload;
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

                // Mark history-seen for conversations present in the payload (works for both 'message' and 'event')
                if (
                  Array.isArray(messagesToProcess) &&
                  messagesToProcess.length
                ) {
                  window._historySeenByChat = window._historySeenByChat || {};
                  const cids = new Set(
                    messagesToProcess
                      .map((m) => String(m?.conversation_id ?? ""))
                      .filter(Boolean)
                  );
                  for (const cid of cids) {
                    window._historySeenByChat[cid] = true;
                  }
                }

                if (!Array.isArray(messagesToProcess)) {
                  console.warn(
                    "messagesToProcess is not an array:",
                    messagesToProcess
                  );
                  continue;
                }

                // Only messages for this chat
                let relevant = messagesToProcess.filter(
                  (message) =>
                    String(message.conversation_id) === String(chatId)
                );

                // NEW: drop anything we've already rendered/queued
                const seen = (window._seenByChat[chatId] ||= new Set());
                relevant = relevant.filter(
                  (m) => m && m.id && !seen.has(String(m.id))
                );

                if (relevant.length === 0) continue;

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

  // NEW: add loaded older messages to seen
  const seen = (window._seenByChat[chatId] ||= new Set());
  for (const m of messagesToLoad) {
    if (m && m.id) seen.add(String(m.id));
  }

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

/* ─────────── ENSURE-JOIN HANDSHAKE (idempotent + retry) ─────────── */
window._historySeenByChat = window._historySeenByChat || {}; // { chatId: true }
window._joinState = window._joinState || {}; // { chatId: {inFlight, retries, lastSentAt, gen} }

function _chatIdFromUrl() {
  try {
    return new URLSearchParams(location.search).get("chatid") || null;
  } catch {
    return null;
  }
}

window.ensureJoinForActiveChat = function ensureJoinForActiveChat(
  force = false
) {
  const chatId = _chatIdFromUrl();
  if (!chatId) return;

  // STOP if we've already seen history (unless force)
  if (window._historySeenByChat[chatId] && !force) return;

  // If DOM already has any .message for this chat, consider history loaded
  const rg = window.findVisibleRG?.() ?? null;
  if (!force && rg !== null) {
    const container = document.querySelector(`#rg${rg} .chat-messages`);
    if (container && container.querySelector(".message")) {
      window._historySeenByChat[chatId] = true;
      return;
    }
  }

  // Channel must be ready
  if (!window.currentChannel || !window.xanoRealtime) {
    setTimeout(() => window.ensureJoinForActiveChat(force), 300);
    return;
  }

  const MAX_RETRIES = 3; // capped
  const gen = window._chatGen || 0;
  const st = (window._joinState[chatId] ||= {
    inFlight: false,
    retries: 0,
    lastSentAt: 0,
    gen,
  });

  // Reset retries if chat switched
  if (st.gen !== gen) {
    st.gen = gen;
    st.retries = 0;
  }

  // Debounce repeated sends
  const justSent = Date.now() - st.lastSentAt < 2000;
  if (st.inFlight || justSent) return;

  // Don’t spam past cap
  if (st.retries >= MAX_RETRIES) return;

  const msg = {
    isReaction: false,
    isDelete: false,
    isJoin: true,
    conversation_id: chatId,
    message: "",
  };

  try {
    st.inFlight = true;
    st.lastSentAt = Date.now();
    console.log(
      `[ensureJoin] sending join for chat ${chatId} (try #${st.retries + 1})`
    );
    window.sendMessage(msg);
  } catch (e) {
    console.warn("[ensureJoin] send failed", e);
  } finally {
    const backoff = Math.min(800 * 2 ** st.retries, 6000); // exp backoff, capped at 6s
    setTimeout(() => {
      st.inFlight = false;
      if (!window._historySeenByChat[chatId] && st.retries < MAX_RETRIES) {
        st.retries++;
        window.ensureJoinForActiveChat();
      }
    }, backoff);
  }
};
