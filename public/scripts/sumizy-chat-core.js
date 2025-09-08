//sumizy-chat-core.js

/* ─────────── INJECTOR FACTORY (FIXED) ─────────── */
function makeChatInjector(chatEl, cuid) {
  const bottom = () =>
    requestAnimationFrame(() => (chatEl.scrollTop = chatEl.scrollHeight));
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3"; // Sumizy AI's ID

  return (payload, isOlderMessages = false) => {
    if (!Array.isArray(payload) || !payload.length) return;

    /* ---- single update ---- */
    if (payload.length === 1 && !isOlderMessages) {
      const m = payload[0];

      /* delete handling */
      if (m.isDeleted) {
        chatEl.querySelector(`[data-id="${m.id}"]`)?.remove();
        return;
      }

      const old = chatEl.querySelector(`[data-id="${m.id}"]`);
      const el = document
        .createRange()
        .createContextualFragment(renderMsg(m, cuid)).firstElementChild;

      if (old) {
        old.replaceWith(el);
        // Don't scroll when updating existing messages
      } else {
        // Check if we need a date divider for this single message
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
        // Scroll for messages from current user OR AI
        if (m.user_id === cuid || m.user_id === AI_USER_ID) {
          bottom();
        }
      }
      return;
    }

    /* ---- bulk insert ---- */
    const frag = document.createDocumentFragment();
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
      if (m.isDeleted) {
        chatEl.querySelector(`[data-id="${m.id}"]`)?.remove();
        continue;
      }

      const lbl = fmtDate(m.created_at);

      if (lbl !== batchLastDate && !existingDates.has(lbl)) {
        frag.appendChild(
          document.createRange().createContextualFragment(renderDivider(lbl))
        );
        existingDates.add(lbl);
        batchLastDate = lbl;
      }

      frag.appendChild(
        document.createRange().createContextualFragment(renderMsg(m, cuid))
      );

      // Check if any message in bulk is from current user OR AI
      if (m.user_id === cuid || m.user_id === AI_USER_ID) {
        shouldScroll = true;
      }
    }

    if (isOlderMessages) {
      chatEl.insertBefore(frag, chatEl.firstChild);
    } else {
      chatEl.appendChild(frag);

      // Scroll if there's at least one message from current user or AI
      if (shouldScroll) {
        bottom();
      }
    }
  };
}


/* ─────────── GLOBAL DISPATCHER WITH RETRY ─────────── */
const cache = new Map();
window.__sumizyInjectorCache = cache;  // expose for cross-file reset
const pendingMessages = new Map(); // Store messages that couldn't be injected yet

window.injectMessages = async (rg, payload, cuid, isOlderMessages = false) => {
  if (typeof rg !== 'number') { 
    console.error('injectMessages: first arg must be number'); 
    return; 
  }
  window.currentUserId = cuid;

  // Try to get or create injector with retry mechanism
  let inj = cache.get(rg);
  if (!inj) {
    // Wait for the RG element to exist
    const g = await waitForElement(`#rg${rg}`);
    if (!g) { 
      console.error(`#rg${rg} not found after retries. Storing messages for later.`);
      
      // Store messages to inject later
      if (!pendingMessages.has(rg)) {
        pendingMessages.set(rg, []);
      }
      pendingMessages.get(rg).push({ payload, cuid, isOlderMessages });
      
      // Set up observer to watch for the element
      setupRGObserver(rg, cuid);
      return; 
    }
    
    // Wait for the chat messages element within the RG
    const chatSelector = `#rg${rg} .chat-messages`;
    const chat = await waitForElement(chatSelector);
    if (!chat) { 
      console.error(`${chatSelector} not found after retries. Storing messages for later.`);
      
      // Store messages to inject later
      if (!pendingMessages.has(rg)) {
        pendingMessages.set(rg, []);
      }
      pendingMessages.get(rg).push({ payload, cuid, isOlderMessages });
      
      // Set up observer to watch for the element
      setupRGObserver(rg, cuid);
      return; 
    }
    
    inj = makeChatInjector(chat, cuid); 
    cache.set(rg, inj);
    console.log(`Created injector for #rg${rg}`);
  }
  
  // Inject the current messages
  inj(payload, isOlderMessages);
  
  // Check if there are pending messages for this RG
  if (pendingMessages.has(rg)) {
    const pending = pendingMessages.get(rg);
    console.log(`Injecting ${pending.length} pending message batches for #rg${rg}`);
    
    // Inject all pending messages
    for (const { payload: pendingPayload, isOlderMessages: pendingIsOlder } of pending) {
      inj(pendingPayload, pendingIsOlder);
    }
    
    // Clear pending messages
    pendingMessages.delete(rg);
  }
};

/* ─────────── MUTATION OBSERVER FOR DELAYED RG ELEMENTS ─────────── */
const rgObservers = new Map();

function setupRGObserver(rg, cuid) {
  // Don't set up multiple observers for the same RG
  if (rgObservers.has(rg)) {
    return;
  }
  
  console.log(`Setting up observer for #rg${rg}`);
  
  const observer = new MutationObserver((mutations) => {
    // Check if the RG element now exists
    const rgElement = document.getElementById(`rg${rg}`);
    const chatElement = rgElement?.querySelector('.chat-messages');
    
    if (rgElement && chatElement) {
      console.log(`#rg${rg} and .chat-messages found via observer`);
      
      // Stop observing
      observer.disconnect();
      rgObservers.delete(rg);
      
      // Process any pending messages
      if (pendingMessages.has(rg)) {
        const pending = pendingMessages.get(rg);
        console.log(`Processing ${pending.length} pending message batches for #rg${rg}`);
        
        // Re-inject all pending messages
        for (const { payload, cuid: pendingCuid, isOlderMessages } of pending) {
          window.injectMessages(rg, payload, pendingCuid || cuid, isOlderMessages);
        }
      }
    }
  });
  
  // Observe the entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  rgObservers.set(rg, observer);
}



/* ─────────── CLEANUP OBSERVERS ON PAGE UNLOAD ─────────── */
window.addEventListener('beforeunload', () => {
    // Disconnect all observers
    rgObservers.forEach(observer => observer.disconnect());
    rgObservers.clear();
  });
  
  
  
      
  


/* ─────────── SEARCH + NEXT/PREV WITH PAGINATION SUPPORT ─────────── */
(function () {
    const HIT = 'search-hit', CUR = 'search-current';
    const st = { hits: [], idx: -1, rg: '', query: '', searchedInOlderMessages: false, totalOlderMatches: 0 };
    const rgOf = el => el.closest('[id^="rg"]')?.id.replace('rg', '') || '';
  
    const send = () => {
      const fn = `bubble_fn_searchCount${st.rg || ''}`;
      const totalHits = st.hits.length + st.totalOlderMatches;
      const currentIdx = st.idx >= 0 ? st.idx + 1 : 0;
      const txt = totalHits ? `${currentIdx}/${totalHits}${st.totalOlderMatches > 0 ? ' (+' + st.totalOlderMatches + ' in history)' : ''}` : '0/0';
      if (typeof window[fn] === 'function') window[fn]({ output1: txt });
    };
  
    const focus = () => {
      if (st.idx < 0) { send(); return; }
      st.hits.forEach((el, i) => el.classList.toggle(CUR, i === st.idx));
      st.hits[st.idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      send();
    };
  
    const searchInCurrentDOM = (query) => {
      const hits = [];
      document.querySelectorAll('.message').forEach(m => {
        m.classList.remove(HIT, CUR);
        if (!query) return;
        let hay = '';
        m.querySelectorAll('.message-text').forEach(el => hay += ' ' + el.textContent.toLowerCase());
        hay += ' ' + (m.dataset.username || '').toLowerCase();
        if (m.dataset.message) hay += ' ' + m.dataset.message.toLowerCase();
        if (hay.includes(query)) { 
          m.classList.add(HIT); 
          hits.push(m); 
        }
      });
      return hits;
    };
  
    const searchInOlderMessages = (query) => {
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatid');
      
      if (!chatId || !window.olderMessages || !window.olderMessages[chatId]) {
        return [];
      }
  
      return window.olderMessages[chatId].filter(message => {
        const userName = (message._user && message._user.name) ? message._user.name : '';
        const searchText = (
          (message.message || '') + ' ' + 
          userName + ' ' +
          (message.file_name || '')
        ).toLowerCase();
        return searchText.includes(query);
      });
    };
  
    const loadOlderMessagesForSearch = async (messagesToLoad) => {
      const rg = window.findVisibleRG();
      if (rg === null) return false;
  
      // Store scroll position
      const chatEl = document.querySelector(`#rg${rg} .chat-messages`);
      const prevScrollHeight = chatEl.scrollHeight;
      const prevScrollTop = chatEl.scrollTop;
  
      // Inject older messages at the top
      window.injectMessages(rg, messagesToLoad, window.currentUserId, true);
      
      // Maintain scroll position
      await new Promise(resolve => setTimeout(resolve, 100));
      const newScrollHeight = chatEl.scrollHeight;
      const scrollDiff = newScrollHeight - prevScrollHeight;
      chatEl.scrollTop = prevScrollTop + scrollDiff;
      
      // Remove these from older messages store since they're now loaded
      const urlParams = new URLSearchParams(window.location.search);
      const chatId = urlParams.get('chatid');
      if (window.olderMessages && window.olderMessages[chatId]) {
        // Remove the loaded messages from the older messages array
        const loadedIds = new Set(messagesToLoad.map(m => m.id));
        window.olderMessages[chatId] = window.olderMessages[chatId].filter(m => !loadedIds.has(m.id));
      }
  
      return true;
    };
  
    const loadAllOlderMessagesWithQuery = async (query) => {
      const olderMatches = searchInOlderMessages(query);
      if (olderMatches.length === 0) return false;
      
      console.log(`Loading ${olderMatches.length} older messages that match the search...`);
      
      // Show loading indicator
      const rg = window.findVisibleRG();
      const chatEl = document.querySelector(`#rg${rg} .chat-messages`);
      const loadingDiv = document.createElement('div');
      loadingDiv.className = 'search-loading-indicator';
      loadingDiv.innerHTML = '<div class="loading-spinner"></div> Loading search results from history...';
      loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000;';
      document.body.appendChild(loadingDiv);
      
      // Load all matching older messages
      await loadOlderMessagesForSearch(olderMatches);
      
      // Remove loading indicator
      loadingDiv.remove();
      
      return true;
    };
  
    window.searchMessages = (q) => {
      q = (q || '').trim().toLowerCase();
      st.query = q;
      st.searchedInOlderMessages = false;
      st.totalOlderMatches = 0;
      
      if (!q) {
        st.hits = []; st.idx = -1; st.rg = '';
        document.querySelectorAll('.message').forEach(m => m.classList.remove(HIT, CUR));
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
        // No matches in current view, but found in older messages
        st.rg = window.findVisibleRG() || '';
        console.log(`No matches in loaded messages, but found ${st.totalOlderMatches} in history`);
        
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
        st.rg = window.findVisibleRG() || '';
        send();
      }
  
      console.log(`Found ${st.hits.length} matches in loaded messages, ${st.totalOlderMatches} in older messages`);
    };
  
    window.searchNext = () => {
      if (!st.hits.length && st.totalOlderMatches === 0) return;
      
      // If we're at the last result and there are older messages with matches
      if (st.idx === st.hits.length - 1 && st.totalOlderMatches > 0 && !st.searchedInOlderMessages) {
        console.log(`Reached last result, loading ${st.totalOlderMatches} older messages with matches...`);
        
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
      if (st.idx === 0 && st.totalOlderMatches > 0 && !st.searchedInOlderMessages) {
        console.log(`Reached first result, loading ${st.totalOlderMatches} older messages with matches...`);
        
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
  

  /* ─────────── CLEAR CHAT (single repeating group) ─────────── */
/**
 * Clear all rendered messages (and date dividers) for a given repeating-group
 * and reset the injector cache so new inserts start "fresh".
 *
 * @param {number} rg  The repeating-group number, e.g. `1` for #rg1
 */
window.clearChat = rg => {
    if (typeof rg !== 'number') {                       // dev guard
      console.error('clearChat: first arg must be number'); return;
    }
  
    /* locate the chat pane */
    const g    = document.getElementById(`rg${rg}`);
    if (!g)    { console.warn(`#rg${rg} not found`); return; }
    const chat = g.querySelector('.chat-messages');
    if (!chat) { console.warn(`#rg${rg} missing .chat-messages`); return; }
  
    /* remove every child node (faster than innerHTML = '' for large lists) */
    while (chat.firstChild) chat.firstChild.remove();
  
    /* drop the cached injector so next injectMessages() call
       rebuilds it with a clean "lastDate" state */
    cache.delete(rg);
  
    /* optional: if you keep search state, purge hits that lived in this chat */
    document.querySelectorAll(`#rg${rg} .search-hit, #rg${rg} .search-current`)
            .forEach(el => { el.classList.remove('search-hit', 'search-current'); });
  
    console.info(`clearChat: #rg${rg} cleared`);
  };


  /* ─────────── SCROLL TO TOP LISTENER FOR PAGINATION ─────────── */
/**
 * Set up scroll listener for automatic message loading
 */
window.setupScrollPagination = () => {
    const scrollThreshold = 100; // pixels from top to trigger load
    let isLoading = false;
    
    // Find all chat message containers
    const chatContainers = document.querySelectorAll('.chat-messages');
    
    chatContainers.forEach(chatEl => {
      // Remove any existing listeners first
      chatEl.removeEventListener('scroll', chatEl._scrollHandler);
      
      // Create scroll handler
      chatEl._scrollHandler = function() {
        // Check if we're near the top and not already loading
        if (this.scrollTop < scrollThreshold && !isLoading) {
          const olderCount = window.getOlderMessagesCount();
          
          if (olderCount > 0) {
            isLoading = true;
            
            // Store current scroll height to maintain position after load
            const prevScrollHeight = this.scrollHeight;
            const prevScrollTop = this.scrollTop;
            
            console.log(`Loading more messages... (${olderCount} available)`);
            
            // Show loading indicator (optional)
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'loading-older-messages';
            loadingDiv.innerHTML = '<div class="loading-spinner"></div> Loading older messages...';
            loadingDiv.style.cssText = 'text-align: center; padding: 10px; color: #666;';
            this.insertBefore(loadingDiv, this.firstChild);
            
            // Load older messages
            const loaded = window.loadOlderMessages(30); // Load 30 at a time
            
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
      chatEl.addEventListener('scroll', chatEl._scrollHandler);
    });
    
    console.log('Scroll pagination set up for chat containers');
  };
  
  // Auto-setup scroll pagination when messages are first injected
  const originalInjectMessages = window.injectMessages;
  window.injectMessages = function(rg, payload, cuid, isOlderMessages = false) {
    originalInjectMessages.call(this, rg, payload, cuid, isOlderMessages);
    
    // Set up scroll pagination after a short delay to ensure DOM is ready
    setTimeout(() => {
      window.setupScrollPagination();
    }, 100);
  };
  
  // Also call it initially in case messages are already loaded
  setTimeout(() => {
    window.setupScrollPagination();
  }, 1000);

  function handleChatSwitchIfNeeded() {
    const next = getChatIdFromURL();
    if (!next) return;
    if (window._activeChatId === next) return;

    // switch
    window._activeChatId = next;
    window._chatGen++;

    // reset dedupe for this chat
    window._seenByChat[next] = new Set();

    // clear visible chat DOM and rebuild on demand
    clearVisibleChatDOMOnce();

    // ensure there is a pending bucket for the new chat
    window._pendingChatInjections[next] ||= [];

    // kick the flush
    setTimeout(() => {
      try {
        _flushPendingIfVisible();
      } catch {}
    }, 0);
  }
  


  // make it global so other scripts can call it
window.handleChatSwitchIfNeeded = function handleChatSwitchIfNeeded() {
  const next = getChatIdFromURL();
  if (!next) return;
  if (window._activeChatId === next) return;

  // switch
  window._activeChatId = next;
  window._chatGen++;

  // reset per-chat dedupe and typing state
  window._seenByChat[next] = new Set();
  window.hideAITypingIndicator?.();

  // clear DOM and reset injector cache
  clearVisibleChatDOMOnce();

  // ensure bucket + watchers; then flush
  window._pendingChatInjections[next] ||= [];
  _setupChatVisibilityWatchers?.();
  setTimeout(() => { try { _flushPendingIfVisible(); } catch {} }, 0);
};

// wire listeners once (guard against double-wiring)
(function wireChatSwitchListenersOnce() {
  if (window._chatSwitchListenersWired) return;
  window._chatSwitchListenersWired = true;

  const h = () => window.handleChatSwitchIfNeeded?.();
  window.addEventListener("locationchange", h);
  window.addEventListener("popstate", h);
  window.addEventListener("hashchange", h);
  document.addEventListener("DOMContentLoaded", h, { once: true });

  // run once now in case we loaded with a chatid already
  h();
})();
