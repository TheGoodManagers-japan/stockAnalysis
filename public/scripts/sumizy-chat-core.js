// sumizy-chat-core.js

/* ─────────── INJECTOR FACTORY (FIXED: keep deleted messages) ─────────── */
function makeChatInjector(chatEl, cuid) {
  const bottom = () =>
    requestAnimationFrame(() => (chatEl.scrollTop = chatEl.scrollHeight));
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3"; // Sumizy AI's ID

  return (payload, isOlderMessages = false) => {
    if (!Array.isArray(payload) || !payload.length) return;

    /* ---- single update ---- */
    if (payload.length === 1 && !isOlderMessages) {
      const m = payload[0];

      // Build fresh element (even if deleted)
      const frag = document
        .createRange()
        .createContextualFragment(renderMsg(m, cuid));
      const el = frag.firstElementChild;
      const pane = chatEl.closest('[id^="rg"]')?.dataset?.pane;
      if (
        pane === "ai" &&
        String(m.user_id) === "5c82f501-a3da-4083-894c-4367dc2e01f3"
      ) {
        el.classList.add("ai-message");
      }

      // Mark deleted so CSS can style it
      if (m.isDeleted) {
        el.classList.add("is-deleted");
        el.dataset.deleted = "true";
      } else {
        el.classList.remove("is-deleted");
        el.dataset.deleted = "false";
      }

      const old = chatEl.querySelector(`[data-id="${m.id}"]`);
      if (old) {
        old.replaceWith(el);
        // PATCH: re-attach receipts after replace
        if (typeof window.updateReadReceiptsInPlace === "function") {
          try {
            window.updateReadReceiptsInPlace(el, m);
          } catch {}
        }

        // don't auto-scroll when updating existing messages
      } else {
        // Date divider logic for a single message
        const msgDate = fmtDate(m.created_at);
        const existingDivider = chatEl.querySelector(
          `[data-date="${msgDate}"]`
        );
        const allDividers = chatEl.querySelectorAll(".date-divider");
        const lastDivider = allDividers[allDividers.length - 1];
        const lastDate = lastDivider ? lastDivider.dataset.date : "";

        if (msgDate !== lastDate && !existingDivider) {
          const dividerEl = document
            .createRange()
            .createContextualFragment(renderDivider(msgDate));
          chatEl.appendChild(dividerEl);
        }

        chatEl.appendChild(el);

        // PATCH: attach receipts on first append
        if (typeof window.updateReadReceiptsInPlace === "function") {
          try {
            window.updateReadReceiptsInPlace(el, m);
          } catch {}
        }

        // Scroll only for messages from current user OR AI
        if (m.user_id === cuid || m.user_id === AI_USER_ID) {
          bottom();
        }
      }
      return;
    }

    /* ---- bulk insert ---- */
    const outFrag = document.createDocumentFragment();
    let shouldScroll = false;

    const sortedMessages = [...payload].sort(
      (a, b) => parseTime(a.created_at) - parseTime(b.created_at)
    );

    const existingDates = new Set(
      Array.from(chatEl.querySelectorAll(".date-divider")).map(
        (div) => div.dataset.date
      )
    );

    let batchLastDate = "";

    for (const m of sortedMessages) {
      const lbl = fmtDate(m.created_at);

      if (lbl !== batchLastDate && !existingDates.has(lbl)) {
        outFrag.appendChild(
          document.createRange().createContextualFragment(renderDivider(lbl))
        );
        existingDates.add(lbl);
        batchLastDate = lbl;
      }

      // Build message node (even if deleted)
      const msgFrag = document
        .createRange()
        .createContextualFragment(renderMsg(m, cuid));
      const msgEl = msgFrag.firstElementChild;
      const pane = chatEl.closest('[id^="rg"]')?.dataset?.pane;
      if (
        pane === "ai" &&
        String(m.user_id) === "5c82f501-a3da-4083-894c-4367dc2e01f3"
      ) {
        msgEl.classList.add("ai-message");
      }

      if (m.isDeleted) {
        msgEl.classList.add("is-deleted");
        msgEl.dataset.deleted = "true";
      } else {
        msgEl.classList.remove("is-deleted");
        msgEl.dataset.deleted = "false";
      }

      // PATCH: add receipts before appending bulk fragment
      if (typeof window.updateReadReceiptsInPlace === "function") {
        try {
          window.updateReadReceiptsInPlace(msgEl, m);
        } catch {}
      }

      outFrag.appendChild(msgFrag);

      // Any message in bulk from current user or AI triggers scroll
      if (m.user_id === cuid || m.user_id === AI_USER_ID) {
        shouldScroll = true;
      }
    }

    if (isOlderMessages) {
      chatEl.insertBefore(outFrag, chatEl.firstChild);
    } else {
      chatEl.appendChild(outFrag);
      if (shouldScroll) bottom();
    }
  };
}

/* ─────────── paneKey helpers ─────────── */
function getPaneRoleFromRG(rg) {
  const el = document.getElementById(`rg${rg}`);
  const role = (el?.getAttribute?.("data-pane") || "main").trim().toLowerCase();
  return role === "ai" ? "ai" : "main";
}
function makePaneKey(rg, role) {
  const r = (role || getPaneRoleFromRG(rg)).toLowerCase();
  return `${r}:rg${rg}`;
}

/* ─────────── GLOBAL DISPATCHER WITH RETRY (paneKey-aware) ─────────── */
const cacheByPane = new Map();
window.__sumizyInjectorCache = cacheByPane; // expose for cross-file reset
const pendingByPane = new Map(); // Store messages that couldn't be injected yet

window.injectMessages = async (
  rg,
  payload,
  cuid,
  isOlderMessages = false,
  paneRole = null
) => {
  if (typeof rg !== "number") {
    console.error("injectMessages: first arg must be number");
    return;
  }
  window.currentUserId = cuid;

  const paneKey = makePaneKey(rg, paneRole); // e.g., "main:rg1" or "ai:rg2"

  // Try to get or create injector with retry mechanism
  let inj = cacheByPane.get(paneKey);
  if (!inj) {
    // Wait for the RG element to exist
    const g = await waitForElement(`#rg${rg}`);
    if (!g) {
      console.error(
        `#rg${rg} not found after retries. Storing messages for later.`,
        { paneKey }
      );

      // Store messages to inject later
      if (!pendingByPane.has(paneKey)) {
        pendingByPane.set(paneKey, []);
      }
      pendingByPane.get(paneKey).push({ payload, cuid, isOlderMessages });

      // Set up observer to watch for the element
      setupRGObserver(rg, cuid, paneKey);
      return;
    }

    // Wait for the chat messages element within the RG
    const chatSelector = `#rg${rg} .chat-messages`;
    const chat = await waitForElement(chatSelector);
    if (!chat) {
      console.error(
        `${chatSelector} not found after retries. Storing messages for later.`,
        { paneKey }
      );

      // Store messages to inject later
      if (!pendingByPane.has(paneKey)) {
        pendingByPane.set(paneKey, []);
      }
      pendingByPane.get(paneKey).push({ payload, cuid, isOlderMessages });

      // Set up observer to watch for the element
      setupRGObserver(rg, cuid, paneKey);
      return;
    }

    inj = makeChatInjector(chat, cuid);
    cacheByPane.set(paneKey, inj);
    console.log(`Created injector for #rg${rg} (${paneKey})`);
  }

  // Inject the current messages
  inj(payload, isOlderMessages);

  // Check if there are pending messages for this pane
  if (pendingByPane.has(paneKey)) {
    const pending = pendingByPane.get(paneKey);
    console.log(
      `Injecting ${pending.length} pending message batches for ${paneKey}`
    );

    // Inject all pending messages
    for (const {
      payload: pendingPayload,
      isOlderMessages: pendingIsOlder,
    } of pending) {
      inj(pendingPayload, pendingIsOlder);
    }

    // Clear pending messages
    pendingByPane.delete(paneKey);
  }
};

/* ─────────── MUTATION OBSERVER FOR DELAYED RG ELEMENTS (paneKey-aware) ─────────── */
const rgObservers = new Map(); // key: paneKey

function setupRGObserver(rg, cuid, paneKey = makePaneKey(rg, null)) {
  // Don't set up multiple observers for the same paneKey
  if (rgObservers.has(paneKey)) {
    return;
  }

  console.log(`Setting up observer for ${paneKey}`);

  const observer = new MutationObserver(() => {
    // Check if the RG element now exists
    const rgElement = document.getElementById(`rg${rg}`);
    const chatElement = rgElement?.querySelector(".chat-messages");

    if (rgElement && chatElement) {
      console.log(
        `#rg${rg} and .chat-messages found via observer for ${paneKey}`
      );

      // Stop observing
      observer.disconnect();
      rgObservers.delete(paneKey);

      // Process any pending messages
      if (pendingByPane.has(paneKey)) {
        const pending = pendingByPane.get(paneKey);
        console.log(
          `Processing ${pending.length} pending message batches for ${paneKey}`
        );

        // Re-inject all pending messages
        for (const { payload, cuid: pendingCuid, isOlderMessages } of pending) {
          window.injectMessages(
            rg,
            payload,
            pendingCuid || cuid,
            isOlderMessages
          );
        }
      }
    }
  });

  // Observe the entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  rgObservers.set(paneKey, observer);
}

/* ─────────── CLEANUP OBSERVERS ON PAGE UNLOAD ─────────── */
window.addEventListener("beforeunload", () => {
  // Disconnect all observers
  rgObservers.forEach((observer) => observer.disconnect());
  rgObservers.clear();
});

/* ─────────── SEARCH + NEXT/PREV WITH PAGINATION SUPPORT ─────────── */
(function () {
  const HIT = "search-hit",
    CUR = "search-current";
  const st = {
    hits: [],
    idx: -1,
    rg: "",
    query: "",
    searchedInOlderMessages: false,
    totalOlderMatches: 0,
  };
  const rgOf = (el) => el.closest('[id^="rg"]')?.id.replace("rg", "") || "";

  const send = () => {
    const fn = `bubble_fn_searchCount${st.rg || ""}`;
    const totalHits = st.hits.length + st.totalOlderMatches;
    const currentIdx = st.idx >= 0 ? st.idx + 1 : 0;
    const txt = totalHits
      ? `${currentIdx}/${totalHits}${
          st.totalOlderMatches > 0
            ? " (+" + st.totalOlderMatches + " in history)"
            : ""
        }`
      : "0/0";
    if (typeof window[fn] === "function") window[fn]({ output1: txt });
  };

  const focus = () => {
    if (st.idx < 0) {
      send();
      return;
    }
    st.hits.forEach((el, i) => el.classList.toggle(CUR, i === st.idx));
    st.hits[st.idx].scrollIntoView({ behavior: "smooth", block: "center" });
    send();
  };

  const searchInCurrentDOM = (query) => {
    const hits = [];
    document.querySelectorAll(".message").forEach((m) => {
      m.classList.remove(HIT, CUR);
      if (!query) return;
      let hay = "";
      m.querySelectorAll(".message-text").forEach(
        (el) => (hay += " " + el.textContent.toLowerCase())
      );
      hay += " " + (m.dataset.username || "").toLowerCase();
      if (m.dataset.message) hay += " " + m.dataset.message.toLowerCase();
      if (hay.includes(query)) {
        m.classList.add(HIT);
        hits.push(m);
      }
    });
    return hits;
  };

  const searchInOlderMessages = (query) => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get("chatid");

    if (!chatId || !window.olderMessages || !window.olderMessages[chatId]) {
      return [];
    }

    return window.olderMessages[chatId].filter((message) => {
      const userName =
        message._user && message._user.name ? message._user.name : "";
      const searchText = (
        (message.message || "") +
        " " +
        userName +
        " " +
        (message.file_name || "")
      ).toLowerCase();
      return searchText.includes(query);
    });
  };

  const loadOlderMessagesForSearch = async (messagesToLoad) => {
    const rg = window.findVisibleRG?.();
    if (rg == null) return false;

    // Store scroll position
    const chatEl = document.querySelector(`#rg${rg} .chat-messages`);
    const prevScrollHeight = chatEl.scrollHeight;
    const prevScrollTop = chatEl.scrollTop;

    // Inject older messages at the top
    window.injectMessages(rg, messagesToLoad, window.currentUserId, true);

    // Maintain scroll position
    await new Promise((resolve) => setTimeout(resolve, 100));
    const newScrollHeight = chatEl.scrollHeight;
    const scrollDiff = newScrollHeight - prevScrollHeight;
    chatEl.scrollTop = prevScrollTop + scrollDiff;

    // Remove these from older messages store since they're now loaded
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get("chatid");
    if (window.olderMessages && window.olderMessages[chatId]) {
      const loadedIds = new Set(messagesToLoad.map((m) => m.id));
      window.olderMessages[chatId] = window.olderMessages[chatId].filter(
        (m) => !loadedIds.has(m.id)
      );
    }

    return true;
  };

  const loadAllOlderMessagesWithQuery = async (query) => {
    const olderMatches = searchInOlderMessages(query);
    if (olderMatches.length === 0) return false;

    console.log(
      `Loading ${olderMatches.length} older messages that match the search...`
    );

    // Show loading indicator
    const rg = window.findVisibleRG?.();
    const chatEl =
      rg != null ? document.querySelector(`#rg${rg} .chat-messages`) : null;
    const loadingDiv = document.createElement("div");
    loadingDiv.className = "search-loading-indicator";
    loadingDiv.innerHTML =
      '<div class="loading-spinner"></div> Loading search results from history...';
    loadingDiv.style.cssText =
      "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000;";
    document.body.appendChild(loadingDiv);

    // Load all matching older messages
    await loadOlderMessagesForSearch(olderMatches);

    // Remove loading indicator
    loadingDiv.remove();

    return true;
  };

  window.searchMessages = (q) => {
    q = (q || "").trim().toLowerCase();
    st.query = q;
    st.searchedInOlderMessages = false;
    st.totalOlderMatches = 0;

    if (!q) {
      st.hits = [];
      st.idx = -1;
      st.rg = "";
      document
        .querySelectorAll(".message")
        .forEach((m) => m.classList.remove(HIT, CUR));
      send();
      return;
    }

    // Search in currently loaded messages
    st.hits = searchInCurrentDOM(q);

    // Count matches in older messages
    const olderMatches = searchInOlderMessages(q);
    st.totalOlderMatches = olderMatches.length;

    if (st.hits.length > 0) {
      st.hits.reverse();
      st.idx = 0;
      st.rg = rgOf(st.hits[0]);
      focus();
    } else if (st.totalOlderMatches > 0) {
      st.rg = window.findVisibleRG?.() || "";
      console.log(
        `No matches in loaded messages, but found ${st.totalOlderMatches} in history`
      );

      // Automatically load older messages with matches
      loadAllOlderMessagesWithQuery(q).then(() => {
        // Re-search after loading
        st.hits = searchInCurrentDOM(q);
        st.totalOlderMatches = 0; // Reset since we loaded them
        if (st.hits.length > 0) {
          st.hits.reverse();
          st.idx = 0;
          focus();
        }
      });
    } else {
      st.rg = window.findVisibleRG?.() || "";
      send();
    }

    console.log(
      `Found ${st.hits.length} matches in loaded messages, ${st.totalOlderMatches} in older messages`
    );
  };

  window.searchNext = () => {
    if (!st.hits.length && st.totalOlderMatches === 0) return;

    // If we're at the last result and there are older messages with matches
    if (
      st.idx === st.hits.length - 1 &&
      st.totalOlderMatches > 0 &&
      !st.searchedInOlderMessages
    ) {
      console.log(
        `Reached last result, loading ${st.totalOlderMatches} older messages with matches...`
      );

      loadAllOlderMessagesWithQuery(st.query).then(() => {
        st.searchedInOlderMessages = true;
        st.totalOlderMatches = 0;

        // Re-search in all loaded messages
        const newHits = searchInCurrentDOM(st.query);
        st.hits = newHits;
        st.hits.reverse();

        // Continue to the next match
        if (st.hits.length > st.idx + 1) {
          st.idx++;
          focus();
        } else {
          // Wrap around to first
          st.idx = 0;
          focus();
        }
      });
      return;
    }

    // Normal next navigation
    st.idx = (st.idx + 1) % st.hits.length;
    focus();
  };

  window.searchPrev = () => {
    if (!st.hits.length && st.totalOlderMatches === 0) return;

    // If we're at the first result and there are older messages with matches
    if (
      st.idx === 0 &&
      st.totalOlderMatches > 0 &&
      !st.searchedInOlderMessages
    ) {
      console.log(
        `Reached first result, loading ${st.totalOlderMatches} older messages with matches...`
      );

      loadAllOlderMessagesWithQuery(st.query).then(() => {
        st.searchedInOlderMessages = true;
        st.totalOlderMatches = 0;

        // Re-search in all loaded messages
        const newHits = searchInCurrentDOM(st.query);
        st.hits = newHits;
        st.hits.reverse();

        // Go to the last match
        if (st.hits.length > 0) {
          st.idx = st.hits.length - 1;
          focus();
        }
      });
      return;
    }

    // Normal previous navigation
    st.idx = (st.idx - 1 + st.hits.length) % st.hits.length;
    focus();
  };
})();

/* ─────────── CLEAR CHAT (paneKey-aware) ─────────── */
/**
 * Clear all rendered messages (and date dividers) for a given repeating-group
 * and reset the injector cache so new inserts start "fresh".
 *
 * @param {number} rg  The repeating-group number, e.g. `1` for #rg1
 * @param {('main'|'ai')?} paneRole Optional explicit role; if omitted, read from DOM
 */

window.clearChat = (rg, paneRole = null) => {
  if (typeof rg !== "number") {
    console.error("clearChat: first arg must be number");
    return;
  }

  // Guard: skip generic clears for the AI pane
  const role = paneRole || getPaneRoleFromRG(rg);
  if (role === "ai") {
    console.info(`clearChat skipped for AI pane (#rg${rg})`);
    return;
  }

  const paneKey = makePaneKey(rg, paneRole);

  const g = document.getElementById(`rg${rg}`);
  if (!g) {
    console.warn(`#rg${rg} not found for ${paneKey}`);
    return;
  }

  const chat = g.querySelector(".chat-messages");
  if (!chat) {
    console.warn(`#rg${rg} missing .chat-messages for ${paneKey}`);
    return;
  }

  while (chat.firstChild) chat.firstChild.remove();
  cacheByPane.delete(paneKey);

  g.querySelectorAll(".search-hit, .search-current").forEach((el) => {
    el.classList.remove("search-hit", "search-current");
  });

  console.info(`clearChat: ${paneKey} cleared`);
};



/* ─────────── SCROLL TO TOP LISTENER FOR PAGINATION ─────────── */
/**
 * Set up scroll listener for automatic message loading
 */
window.setupScrollPagination = () => {
  const scrollThreshold = 100; // pixels from top to trigger load
  let isLoading = false;

  // Find all chat message containers
  const chatContainers = document.querySelectorAll(".chat-messages");

  chatContainers.forEach((chatEl) => {
    // Remove any existing listeners first
    chatEl.removeEventListener("scroll", chatEl._scrollHandler);

    // Create scroll handler
    chatEl._scrollHandler = function () {
      // Check if we're near the top and not already loading
      if (this.scrollTop < scrollThreshold && !isLoading) {
        const olderCount = window.getOlderMessagesCount
          ? window.getOlderMessagesCount()
          : 0;

        if (olderCount > 0) {
          isLoading = true;

          // Store current scroll height to maintain position after load
          const prevScrollHeight = this.scrollHeight;
          const prevScrollTop = this.scrollTop;

          console.log(`Loading more messages... (${olderCount} available)`);

          // Show loading indicator (optional)
          const loadingDiv = document.createElement("div");
          loadingDiv.className = "loading-older-messages";
          loadingDiv.innerHTML =
            '<div class="loading-spinner"></div> Loading older messages...';
          loadingDiv.style.cssText =
            "text-align: center; padding: 10px; color: #666;";
          this.insertBefore(loadingDiv, this.firstChild);

          // Load older messages
          const loaded = window.loadOlderMessages
            ? window.loadOlderMessages(30)
            : false; // Load 30 at a time

          if (loaded) {
            // Use setTimeout to ensure DOM updates are complete
            setTimeout(() => {
              // Remove loading indicator
              loadingDiv.remove();

              // Maintain scroll position
              const newScrollHeight = this.scrollHeight;
              const scrollDiff = newScrollHeight - prevScrollHeight;
              this.scrollTop = prevScrollTop + scrollDiff;

              // Reset loading flag after a short delay
              setTimeout(() => {
                isLoading = false;
              }, 500);
            }, 100);
          } else {
            loadingDiv.remove();
            isLoading = false;
          }
        }
      }
    };

    // Attach scroll listener
    chatEl.addEventListener("scroll", chatEl._scrollHandler);
  });

  console.log("Scroll pagination set up for chat containers");
};

/* ─────────── Auto-setup scroll pagination when messages are first injected ─────────── */
const originalInjectMessages = window.injectMessages;
window.injectMessages = function (...args) {
  originalInjectMessages.apply(this, args);

  // Set up scroll pagination after a short delay to ensure DOM is ready
  setTimeout(() => {
    window.setupScrollPagination();
  }, 100);
};

// Also call it initially in case messages are already loaded
setTimeout(() => {
  window.setupScrollPagination();
}, 1000);

// /* ─────────── CHAT SWITCH HANDLER (self-contained) ─────────── */
// window.handleChatSwitchIfNeeded = function handleChatSwitchIfNeeded() {
//   // read chatid directly (avoid cross-file helper deps)
//   const next = new URLSearchParams(location.search).get("chatid") || null;
//   if (!next) return;
//   if (window._activeChatId === next) return;

//   // switch
//   window._activeChatId = next;
//   window._chatGen = (window._chatGen || 0) + 1;

//   // reset per-chat dedupe + typing
//   window._seenByChat = window._seenByChat || {};
//   window._seenByChat[next] = new Set();
//   window.hideAITypingIndicator?.();

//   // clear visible chat DOM + reset injector cache (inline)
//   const rg = window.findVisibleRG?.() ?? null;
//   if (rg !== null) {
//     const chat = document.querySelector(`#rg${rg} .chat-messages`);
//     if (chat) {
//       while (chat.firstChild) chat.firstChild.remove();
//       window.__sumizyInjectorCache?.delete?.(rg);
//     }
//   }

//   // ensure bucket + watchers; then flush
//   window._pendingChatInjections = window._pendingChatInjections || {};
//   window._pendingChatInjections[next] ||= [];
//   window._chatVis = window._chatVis || {};
//   window._chatVis.observersReady || window._setupChatVisibilityWatchers?.();
//   setTimeout(() => {
//     try {
//       window._flushPendingIfVisible?.();
//       window.ensureJoinForActiveChat?.(true); // <-- force a join for the new chat
//     } catch {}
//   }, 0);
// };

// // wire listeners once (guard against double-wiring)
// (function wireChatSwitchListenersOnce() {
//   if (window._chatSwitchListenersWired) return;
//   window._chatSwitchListenersWired = true;

//   const h = () => window.handleChatSwitchIfNeeded?.();
//   window.addEventListener("locationchange", h);
//   window.addEventListener("popstate", h);
//   window.addEventListener("hashchange", h);
//   document.addEventListener("DOMContentLoaded", h, { once: true });

//   // run once now in case we loaded with a chatid already
//   h();
// })();
