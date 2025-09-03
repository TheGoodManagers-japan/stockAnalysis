/* ─────────── AI TYPING INDICATOR ─────────── */
let typingIndicatorElement = null;
let typingIndicatorTimeout = null;

window.showAITypingIndicator = function (rgNum) {
  const isAIChat =
    window.location.pathname.includes("ai-chat") ||
    window.location.search.includes("ai-chat");
  if (!isAIChat) return;

  const chatContainer = document.querySelector(`#rg${rgNum} .chat-messages`);
  if (!chatContainer) return;

  window.hideAITypingIndicator();

  if (typingIndicatorTimeout) {
    clearTimeout(typingIndicatorTimeout);
  }

  // Create typing indicator as a pseudo-message
  const typingMessage = {
    id: "typing-indicator",
    created_at: Date.now(),
    user_id: "5c82f501-a3da-4083-894c-4367dc2e01f3",
    message: `<div style="display: flex; gap: 4px;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out; animation-delay: -0.32s;"></span>
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out; animation-delay: -0.16s;"></span>
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out;"></span>
    </div>`,
    _user: {
      name: "Sumizy AI",
      profilePicture: null,
    },
    isFile: false,
    _reactions: [],
    _translations: [],
  };

  // Render typing indicator using the same renderMsg function
  const typingHTML = renderMsg(typingMessage, null);
  typingIndicatorElement = document.createElement("div");
  typingIndicatorElement.innerHTML = typingHTML;
  typingIndicatorElement = typingIndicatorElement.firstChild;
  typingIndicatorElement.classList.add("typing-indicator");

  chatContainer.appendChild(typingIndicatorElement);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  // Auto-hide after 30 seconds
  typingIndicatorTimeout = setTimeout(() => {
    window.hideAITypingIndicator();
  }, 30000);
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
};



/* ─────────── ADD TYPING ANIMATION STYLES ─────────── */
if (!document.querySelector('#ai-chat-styles')) {
    const style = document.createElement('style');
    style.id = 'ai-chat-styles';
    style.innerHTML = `
      @keyframes typingBounce {
        0%, 80%, 100% {
          transform: scale(0.8);
          opacity: 0.4;
        }
        40% {
          transform: scale(1);
          opacity: 1;
        }
      }
      
      .typing-indicator {
        animation: fadeInUp 0.3s ease-out;
      }
      
      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      /* Hide message hover in AI chat mode */
      body.ai-chat-mode .message:hover {
        background-color: transparent !important;
      }
      
      /* Ensure AI chat mode class is set */
      body.ai-chat-mode .chat-messages {
        background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%);
      }
    `;
    document.head.appendChild(style);
  }
  
  /* ─────────── AUTO-DETECT AI CHAT MODE ─────────── */
  (function detectAIChatMode() {
    if (window.location.pathname.includes('ai-chat') || 
        window.location.search.includes('ai-chat')) {
      document.body.classList.add('ai-chat-mode');
      console.log('AI Chat mode activated');
    }
  })();
  


  /* ─────────── DYNAMIC REFRESH EVENT HANDLER ─────────── */
/**
 * Handle refresh events from the WebSocket channel
 * Dynamically calls the appropriate bubble_fn_refresh{Type} function
 * 
 * @param {Object} data - The event data from the channel
 * @returns {boolean} True if handled, false otherwise
 */
window.handleRefreshEvent = (data) => {
    try {
      // Check if this is a refresh event
      if (data.action !== 'event' || !data.payload || !data.payload.data) {
        return false;
      }
  
      // Parse the payload data (it's a JSON string)
      let eventData;
  if (typeof data.payload.data === "string") {
    try {
      eventData = JSON.parse(data.payload.data);
    } catch {
      return false;
    }
  } else {
    eventData = data.payload.data; // already an object
  }
  
      // Check if it's a refresh event
      if (!eventData.refresh) {
        return false;
      }
  
      // Get the refresh type and capitalize first letter for function name
      const refreshType = eventData.refresh;
      const capitalizedType = refreshType.charAt(0).toUpperCase() + refreshType.slice(1);
      
      // Build the function name
      const functionName = `bubble_fn_refresh${capitalizedType}`;
      
      console.log(`Refresh event received: ${refreshType} -> calling ${functionName}`);
      
      // Check if the function exists and call it
      if (typeof window[functionName] === 'function') {
        // Call the bubble function
        window[functionName]();
        console.log(`Successfully called ${functionName}`);
        
        // Optionally pass additional data if needed
        // window[functionName]({ 
        //   dbo_id: data.payload.dbo_id,
        //   row_id: data.payload.row_id 
        // });
        
        return true;
      } else {
        console.warn(`Function ${functionName} not found. Make sure it's defined in Bubble.`);
        return false;
      }
      
    } catch (error) {
      console.error('Error handling refresh event:', error);
      return false;
    }
  };
  
  /* ─────────── ENHANCED REFRESH EVENT HANDLER WITH RG SUPPORT ─────────── */
  /**
   * Handle refresh events with optional RG (Repeating Group) targeting
   * Can handle both general refreshes and RG-specific refreshes
   * 
   * @param {Object} data - The event data from the channel
   * @param {number} rgOverride - Optional RG number to use instead of auto-detection
   * @returns {boolean} True if handled, false otherwise
   */
  window.handleRefreshEventWithRG = (data, rgOverride = null) => {
    try {
      // Check if this is a refresh event
      if (data.action !== 'event' || !data.payload || !data.payload.data) {
        return false;
      }
  
      // Parse the payload data
      let eventData;
      try {
        eventData = JSON.parse(data.payload.data);
      } catch (e) {
        return false;
      }
  
      // Check if it's a refresh event
      if (!eventData.refresh) {
        return false;
      }
  
      const refreshType = eventData.refresh;
      const capitalizedType = refreshType.charAt(0).toUpperCase() + refreshType.slice(1);
      
      // Determine if we need an RG-specific function
      const rg = rgOverride || window.findVisibleRG();
      
      // Try RG-specific function first, then fall back to general function
      const functionsToTry = [];
      
      if (rg !== null) {
        functionsToTry.push(`bubble_fn_refresh${capitalizedType}${rg}`);
      }
      functionsToTry.push(`bubble_fn_refresh${capitalizedType}`);
      
      // Try each function name
      for (const functionName of functionsToTry) {
        if (typeof window[functionName] === 'function') {
          console.log(`Refresh event: ${refreshType} -> calling ${functionName}`);
          
          // Call with additional context if needed
          window[functionName]({
            refreshType: refreshType,
            dbo_id: data.payload.dbo_id,
            row_id: data.payload.row_id,
            originalData: eventData
          });
          
          console.log(`Successfully called ${functionName}`);
          return true;
        }
      }
      
      console.warn(`No refresh function found for type: ${refreshType}. Tried: ${functionsToTry.join(', ')}`);
      return false;
      
    } catch (error) {
      console.error('Error handling refresh event:', error);
      return false;
    }
  };
  

  /* ─────────── IMPROVED FILE VIEWER ─────────── */
function showFileViewer(url, name, isImage) {
    const ext = name.split('.').pop().toLowerCase();
    const fileSize = ''; // Could be passed in if available
    
    const ov = document.createElement('div');
    ov.className = 'file-viewer-overlay';
    
    // Create modal content based on file type
    let bodyContent;
    if (isImage) {
      bodyContent = `
        <div class="file-viewer-loading">
          <div class="file-viewer-spinner"></div>
          <div>Loading image...</div>
        </div>
        <img src="${url}" alt="${esc(name)}" class="file-viewer-img" style="display:none;">`;
    } else {
      // Enhanced generic file display
      const iconMap = {
        'pdf': '📄',
        'doc': '📝', 'docx': '📝',
        'xls': '📊', 'xlsx': '📊',
        'ppt': '📊', 'pptx': '📊',
        'zip': '🗂️', 'rar': '🗂️',
        'mp3': '🎵', 'wav': '🎵',
        'mp4': '🎬', 'avi': '🎬', 'mov': '🎬',
        'txt': '📃',
        'code': '💻'
      };
      
      const icon = iconMap[ext] || '📎';
      
      bodyContent = `
        <div class="file-viewer-icon-container">
          <div class="file-viewer-icon">${icon}</div>
          <div class="file-viewer-filename">${esc(name)}</div>
          <div class="file-viewer-filetype">${ext.toUpperCase()} File</div>
        </div>`;
    }
    
    ov.innerHTML = `
      <div class="file-viewer-modal" role="dialog" aria-label="${esc(name)}" tabindex="-1">
        <div class="file-viewer-header">
          <span class="file-viewer-name">${esc(name)}</span>
          <button class="file-viewer-close" aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <div class="file-viewer-body">
          ${bodyContent}
        </div>
        <div class="file-viewer-footer">
          <div class="file-viewer-info">
            ${fileSize ? `Size: ${fileSize}` : ''}
          </div>
          <div class="file-viewer-actions">
            <button class="file-viewer-download" data-url="${url}" data-filename="${esc(name)}">
              <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>`;
    
    document.body.appendChild(ov);
    const modal = ov.querySelector('.file-viewer-modal');
    modal.focus();
    
    // Handle image loading
    if (isImage) {
      const img = ov.querySelector('.file-viewer-img');
      const loading = ov.querySelector('.file-viewer-loading');
      
      img.onload = () => {
        loading.style.display = 'none';
        img.style.display = 'block';
      };
      
      img.onerror = () => {
        loading.innerHTML = `
          <div class="file-viewer-icon">🚫</div>
          <div>Failed to load image</div>`;
      };
    }
    
    // Close handlers
    const close = () => {
      ov.style.animation = 'fadeOut 0.2s ease-out';
      modal.style.animation = 'scaleOut 0.2s ease-out';
      setTimeout(() => {
        ov.remove();
        document.removeEventListener('keydown', handleEscape);
      }, 200);
    };
    
    const handleEscape = e => {
      if (e.key === 'Escape') close();
    };
    
    // Event listeners
    ov.addEventListener('click', e => {
      if (e.target === ov) close();
    });
    
    ov.querySelector('.file-viewer-close').addEventListener('click', close);
    
    // Download button handler
    ov.querySelector('.file-viewer-download').addEventListener('click', async function() {
      const url = this.dataset.url;
      const filename = this.dataset.filename;
      
      try {
        // Fetch the file
        const response = await fetch(url);
        const blob = await response.blob();
        
        // Create a temporary URL for the blob
        const blobUrl = window.URL.createObjectURL(blob);
        
        // Create a temporary anchor element and trigger download
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        
        // Visual feedback
        this.classList.add('download-success');
        this.innerHTML = `
          <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Downloaded</span>
        `;
        
        setTimeout(() => {
          this.classList.remove('download-success');
          this.innerHTML = `
            <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download</span>
          `;
        }, 2000);
      } catch (error) {
        console.error('Download failed:', error);
        this.classList.add('download-error');
        this.innerHTML = `
          <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
          <span>Failed</span>
        `;
      }
    });
    
    document.addEventListener('keydown', handleEscape);
  }
  
  /* Update the existing file attachment click handler to use the new viewer */
  document.addEventListener('click', e => {
    const fa = e.target.closest('.file-attachment');
    if (!fa) return;
    e.preventDefault();
    e.stopPropagation();
    showFileViewer(fa.dataset.url, fa.dataset.name, (fa.dataset.type || '').startsWith('image'));
  });
  


  /* ─────────── ACTION MENU (emoji | reply | delete) ─────────── */
let currentActionMenu = null;
function hideActionMenu() { currentActionMenu?.remove(); currentActionMenu = null; }

document.addEventListener('click', e => {
  if (!e.target.classList.contains('message-actions-trigger')) return;

  e.stopPropagation();
  const msgEl = e.target.closest('.message');
  const msgId = msgEl.dataset.id;
  const rgNum = msgEl.closest('[id^="rg"]').id.replace('rg', '');
  const uid   = msgEl.dataset.uid;
  const ts    = +msgEl.dataset.ts;
  const canDelete = window.currentUserId === uid && Date.now() - ts < 3600_000;
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '👏'];

  hideActionMenu();
  const menu = document.createElement('div');
  menu.className = 'message-actions-menu group-focus';
  menu.innerHTML = `
    <div class="actions-row">
      <div class="reactions-list">
        ${emojis.map(e => `<span class="emoji-option" data-id="${msgId}" data-emoji="${e}">${e}</span>`).join('')}
      </div>
      <div class="action-divider"></div>
      <div class="reply-action action-icon-button" data-id="${msgId}" title="Reply"><span class="action-icon">↩️</span></div>
      ${canDelete ? `<div class="delete-action action-icon-button" data-id="${msgId}" title="Delete"><span class="action-icon">🗑️</span></div>` : ''}
    </div>`;

  const r = e.target.getBoundingClientRect();
  Object.assign(menu.style, { position: 'absolute', right: `${innerWidth - r.right + 5}px`, top: `${r.bottom + 5}px` });
  document.body.appendChild(menu); currentActionMenu = menu;

  /* clicks inside menu */
  menu.addEventListener('click', ev => {
    ev.stopPropagation();

    /* reaction */
    const emo = ev.target.closest('.emoji-option');
    if (emo) {
      const fn = `bubble_fn_reaction${rgNum}`;
      if (typeof window[fn] === 'function')
        window[fn]({ output1: emo.dataset.id, output2: emo.dataset.emoji });
      hideActionMenu(); return;
    }

    /* reply */
    if (ev.target.closest('.reply-action')) {
      const fn = `bubble_fn_replyChat${rgNum}`;
      if (typeof window[fn] === 'function')
        window[fn]({ output1: buildReplyHtml(msgEl), output2: msgId });
      hideActionMenu(); return;
    }

    /* delete */
    if (ev.target.closest('.delete-action')) {
      const fn = `bubble_fn_deleteMessage${rgNum}`;
      if (typeof window[fn] === 'function')
        window[fn]({ output1: msgId });

      /* remove the DOM node immediately */
      msgEl.remove();

      hideActionMenu(); return;
    }
  });
});

document.addEventListener('click', e => {
  if (!e.target.closest('.message-actions-menu') &&
      !e.target.classList.contains('message-actions-trigger'))
    hideActionMenu();
});

/* toggle reaction bubble click */
document.addEventListener('click', e => {
  const r = e.target.closest('.reaction'); if (!r) return;
  const msg = r.closest('.message');
  const rg  = msg.closest('[id^="rg"]').id.replace('rg', '');
  const fn  = `bubble_fn_reaction${rg}`;
  if (typeof window[fn] === 'function')
    window[fn]({ output1: msg.dataset.id, output2: r.dataset.emoji });
});

    
/* ─────────── CHANNEL JOIN/LEAVE FUNCTIONS ─────────── */

/**
 * Join a channel via Xano realtime WebSocket
 * 
 * @param {string} userId - The user ID
 * @param {string} authToken - The authentication token
 * @param {string} realtimeHash - The Xano realtime hash
 * @param {Object} channelOptions - Channel options (optional)
 */
window.joinChannel = (userId, authToken, realtimeHash, channelOptions = {}) => {
    if (!userId || !authToken || !realtimeHash) {
      console.error('joinChannel: userId, authToken, and realtimeHash are required');
      return;
    }
  
    // Add these tracking variables
    let hasReceivedInitialHistory = false;
    const optimisticallyRenderedMessages = new Set();
  
    console.log('joinChannel: Joining channel without specific RG - will detect dynamically');
  
    try {
      const channelName = `sumizy/${userId}`;
      
      // Check if Xano realtime is available
      if (!window.xano) {
        console.error('joinChannel: Xano realtime not initialized. Make sure Xano is loaded.');
        return;
      }
      
      // Set both auth tokens on the Xano instance (matching your plugin setup)
      window.xano.setAuthToken(authToken);
      window.xano.setRealtimeAuthToken(authToken);
      
      // Reconnect realtime with new auth
      if (typeof window.xano.realtimeReconnect === 'function') {
        window.xano.realtimeReconnect();
      }
      
      // Store auth info for this session
      window.currentAuthToken = authToken;
      window.currentRealtimeHash = realtimeHash;
  
      const channelKey = channelName.split('/').join('_');
      
      // Check if channel already exists
      window.xanoRealtime = window.xanoRealtime || {};
      let exists = !window.xanoRealtime[channelKey] == false;
      
      // Create/get the channel (assuming window.xano is already initialized)
      const channel = window.xano.channel(channelName, {
        ...channelOptions
      });
      
      if (exists == false) {
        // Create a message queue to handle async processing
        let isProcessing = false;
        const messageQueue = [];
        
        const processMessageQueue = async () => {
          if (isProcessing || messageQueue.length === 0) return;
          
          isProcessing = true;
          
          try {
            while (messageQueue.length > 0) {
              const data = messageQueue.shift();
              
              try {
                // First, check if this is a refresh event
                if (window.handleRefreshEvent && window.handleRefreshEvent(data)) {
                  continue;
                }
                
                // Check if this is a message or event action
                if (data.action === 'message' || data.action === 'event') {
                  const urlParams = new URLSearchParams(window.location.search);
                  const chatId = urlParams.get('chatid');
                  
                  if (!chatId) {
                    console.warn('No chatId found in URL parameters');
                    continue;
                  }
                  
                  let messagesToProcess = [];
                  
                  // Handle different payload structures
                  if (data.action === 'message' && data.payload && Array.isArray(data.payload)) {
                    messagesToProcess = data.payload;
                    
                    // Check if this is the initial history load
                    if (!hasReceivedInitialHistory) {
                      hasReceivedInitialHistory = true;
                      console.log('Initial history received, processing all messages');
                    } else {
                      // This is an echo of sent messages - filter out optimistically rendered ones
                      messagesToProcess = messagesToProcess.filter(msg => {
                        if (optimisticallyRenderedMessages.has(msg.id)) {
                          console.log('Skipping already rendered message:', msg.id);
                          optimisticallyRenderedMessages.delete(msg.id); // Clean up
                          return false;
                        }
                        return true;
                      });
                    }
                  } else if (data.action === 'event' && data.payload && data.payload.data) {
                    // For 'event' action: data.payload.data should be a JSON string or array
                    if (typeof data.payload.data === 'string') {
                      try {
                        messagesToProcess = JSON.parse(data.payload.data);
                        console.log('Parsed event messages:', messagesToProcess);
                      } catch (e) {
                        console.error('Failed to parse event payload data:', e);
                        continue;
                      }
                    } else if (Array.isArray(data.payload.data)) {
                      messagesToProcess = data.payload.data;
                    }
                  }
                  
                  console.log('Current chatId:', chatId);
                  console.log('Messages to process:', messagesToProcess);
                  
                  // Ensure messagesToProcess is an array
                  if (!Array.isArray(messagesToProcess)) {
                    console.warn('messagesToProcess is not an array:', messagesToProcess);
                    continue;
                  }
                  
                  // Filter messages that match the current conversation
                  const relevantMessages = messagesToProcess.filter(message => {
                    console.log('Comparing:', message.conversation_id, '===', chatId);
                    return message.conversation_id === chatId;
                  });
                  
                  console.log('Relevant messages found:', relevantMessages.length);
                  
                  // Only inject if we have relevant messages
                  if (relevantMessages.length > 0) {
                    // Find the currently visible RG dynamically
                    const rg = window.findVisibleRG ? window.findVisibleRG() : null;
                    if (rg === null) {
                      console.warn('No visible RG found, skipping message injection');
                      continue;
                    }
                    
                    console.log(`Processing ${relevantMessages.length} messages for conversation ${chatId} in rg${rg} (action: ${data.action})`);
                    
                    // Pagination: Only load recent messages initially
                    const INITIAL_MESSAGE_LIMIT = 50;
                    let messagesToInject;
                    
                    if (data.action === 'message' && relevantMessages.length > INITIAL_MESSAGE_LIMIT) {
                      // For bulk history loads, only show recent messages
                      messagesToInject = relevantMessages
                        .sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at)) // Sort by time
                        .slice(-INITIAL_MESSAGE_LIMIT); // Take last 50
                      
                      // Store older messages for later loading
                      const olderMessages = relevantMessages.slice(0, -INITIAL_MESSAGE_LIMIT);
                      if (olderMessages.length > 0) {
                        window.olderMessages = window.olderMessages || {};
                        window.olderMessages[chatId] = olderMessages;
                        console.log(`Stored ${olderMessages.length} older messages for conversation ${chatId}`);
                      }
                      
                      console.log(`Showing ${messagesToInject.length} recent messages (${olderMessages.length} older messages available)`);
                    } else {
                      // For individual new messages ('event'), inject all
                      messagesToInject = relevantMessages;
                    }
                    
                    // Inject the messages with proper error handling
                    try {
                      await new Promise((resolve, reject) => {
                        // Check if injectMessages function exists
                        if (typeof window.injectMessages !== 'function') {
                          reject(new Error('window.injectMessages function not found'));
                          return;
                        }
                        
                        // Inject the messages
                        window.injectMessages(rg, messagesToInject, window.currentUserId || data.userId);
                        
                        // Wait for DOM updates
                        requestAnimationFrame(() => {
                          requestAnimationFrame(() => {
                            resolve();
                          });
                        });
                      });
                      
                      console.log(`Finished processing ${messagesToInject.length} messages in rg${rg}`);
                      
                      // Add a small delay to prevent overwhelming the UI
                      await new Promise(resolve => setTimeout(resolve, 100));
                      
                      // Trigger bubble function to refresh conversations if it exists
                      const refreshFn = `bubble_fn_refreshConversations${rg}`;
                      if (typeof window[refreshFn] === 'function') {
                        try {
                          window[refreshFn]();
                          console.log(`Called ${refreshFn} after processing messages`);
                        } catch (error) {
                          console.error(`Error calling ${refreshFn}:`, error);
                        }
                      }
                    } catch (injectionError) {
                      console.error('Error injecting messages:', injectionError);
                    }
                  }
                }
              } catch (error) {
                console.error('Error processing individual message:', error);
                // Continue processing other messages even if one fails
              }
            }
          } catch (error) {
            console.error('Error in message queue processing:', error);
          } finally {
            // Always reset the processing flag
            isProcessing = false;
          }
        };
        
        // Make sure to export this function if needed
        window.processMessageQueue = processMessageQueue;
        
        // Set up message listener for new channels
        channel.on((data) => {
          // Add to queue and process
          messageQueue.push(data);
          processMessageQueue();
          
          // Also trigger any existing realtime listeners
          if (window.xanoRealtimeListeners) {
            window.xanoRealtimeListeners.map((x) => {
              if (x.data.channel == channelName || x.data.channel == null) {
                x.data.message_received(data);
              }
            });
          }
        });
      }
      
      // Store channel info globally (without RG since it's dynamic)
      window.currentChannel = {
        userId: userId,
        channelName: channelName,
        channelKey: channelKey,
        channel: channel,
        authToken: authToken,
        realtimeHash: realtimeHash,
        joinedAt: Date.now()
      };
  
      // Set current user ID (used by existing message functions)
      window.currentUserId = userId;
  
      // Add channel to the browser realtime object
      window.xanoRealtime[channelKey] = { channel: channel };
  
      console.info(`joinChannel: Successfully joined channel ${channelName} for user ${userId}`);
      
      // Trigger bubble function to notify successful join (no RG number) after 2 second delay
      setTimeout(() => {
        if (typeof window.bubble_fn_joinedChannel === 'function') {
          window.bubble_fn_joinedChannel(true);
          console.log('Called bubble_fn_joinedChannel after 2 second delay');
        }
      }, 2000);
      
      return channel;
  
    } catch (error) {
      console.error('joinChannel: Error joining channel', error);
      // Clear the stored info on error
      window.currentChannel = null;
      window.currentUserId = null;
      throw error;
    }
  };
  
  /**
   * Leave a channel via Xano realtime
   * 
   * @param {number} rg - The repeating group number
   * @param {string} userId - The user ID
   */
  window.leaveChannel = (rg, userId) => {
    if (typeof rg !== 'number') {
      console.error('leaveChannel: rg must be a number');
      return;
    }
    
    if (!userId) {
      console.error('leaveChannel: userId is required');
      return;
    }
  
    const channelInfo = window.currentChannel;
    if (!channelInfo || channelInfo.userId !== userId || channelInfo.rg !== rg) {
      console.warn(`leaveChannel: Not in channel for user ${userId} in rg${rg} or no active channel`);
      return;
    }
  
    try {
      const channelKey = channelInfo.channelKey;
      const channelName = channelInfo.channelName;
      
      // Disconnect from the channel if it exists
      if (window.xanoRealtime && window.xanoRealtime[channelKey]) {
        const channel = window.xanoRealtime[channelKey].channel;
        if (channel && typeof channel.disconnect === 'function') {
          channel.disconnect();
        } else if (channel && typeof channel.leave === 'function') {
          channel.leave();
        }
        
        // Remove from xanoRealtime object
        delete window.xanoRealtime[channelKey];
      }
  
      // Clear channel info
      window.currentChannel = null;
      window.currentUserId = null;
  
      console.info(`leaveChannel: Successfully left channel ${channelName} for user ${userId} in rg${rg}`);
  
    } catch (error) {
      console.error('leaveChannel: Error leaving channel', error);
      throw error;
    }
  };
  
  /**
   * Get current channel info
   * @returns {Object|null} Channel info object or null if not joined
   */
  window.getCurrentChannel = () => {
    return window.currentChannel || null;
  };
  
  /**
   * Check if user is currently in a specific channel
   * @param {number} rg - The repeating group number
   * @param {string} userId - The user ID to check
   * @returns {boolean} True if user is in the channel for this userId and rg
   */
  window.isInChannel = (rg, userId) => {
    return window.currentChannel?.userId === userId && window.currentChannel?.rg === rg;
  };
  
  /**
   * Load older messages for the current conversation
   * Call this when user scrolls to top or clicks "Load More"
   * 
   * @param {number} batchSize - Number of older messages to load (default: 50)
   * @returns {boolean} True if messages were loaded, false if no more messages
   */
  window.loadOlderMessages = (batchSize = 50) => {
    // Get current conversation ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatid');
    
    if (!chatId) {
      console.error('loadOlderMessages: No chatid in URL');
      return false;
    }
    
    // Check if we have older messages stored
    if (!window.olderMessages || !window.olderMessages[chatId]) {
      console.log('loadOlderMessages: No older messages available');
      return false;
    }
    
    // Find the currently visible RG
    const rg = window.findVisibleRG();
    if (rg === null) {
      console.error('loadOlderMessages: No visible RG found');
      return false;
    }
    
    const olderMessages = window.olderMessages[chatId];
    
    if (olderMessages.length === 0) {
      console.log('loadOlderMessages: All older messages already loaded');
      return false;
    }
    
    // Get the next batch of older messages (from the end, working backwards)
    const messagesToLoad = olderMessages.splice(-batchSize, batchSize);
    
    if (messagesToLoad.length === 0) {
      console.log('loadOlderMessages: No more messages to load');
      return false;
    }
    
    console.log(`loadOlderMessages: Loading ${messagesToLoad.length} older messages`);
    
    // Inject the older messages (they should appear at the top)
    window.injectMessages(rg, messagesToLoad, window.currentUserId, true);
    
    console.log(`loadOlderMessages: ${olderMessages.length} older messages remaining`);
    
    return true;
  };
  
  /**
   * Check if there are older messages available to load
   * @returns {number} Number of older messages available
   */
  window.getOlderMessagesCount = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const chatId = urlParams.get('chatid');
    
    if (!chatId || !window.olderMessages || !window.olderMessages[chatId]) {
      return 0;
    }
    
    return window.olderMessages[chatId].length;
  };
  
  
  
  /**
   * Send a message through the Xano realtime channel
   * 
   * @param {Object} messageData - The message data object to send
   * @returns {Promise} Promise that resolves when message is sent
   */
  window.sendMessage = (messageData) => {
    if (!messageData || typeof messageData !== 'object') {
      console.error('sendMessage: messageData is required and must be an object');
      return Promise.reject(new Error('Message data is required and must be an object'));
    }
  
    const channelInfo = window.currentChannel;
    if (!channelInfo) {
      console.error('sendMessage: No active channel. Join a channel first.');
      return Promise.reject(new Error('No active channel'));
    }
  
    try {
      // Get channel from xanoRealtime object exactly like your plugin
      const channelKey = channelInfo.channelKey;
      
      if (!window.xanoRealtime || !window.xanoRealtime[channelKey]) {
        console.error('sendMessage: Channel not found in xanoRealtime');
        return Promise.reject(new Error('Channel not found in xanoRealtime'));
      }
      
      const thisChannel = window.xanoRealtime[channelKey].channel;
      
      if (!thisChannel) {
        console.error('sendMessage: Channel object not found');
        return Promise.reject(new Error('Channel object not found'));
      }
  
      console.log('Sending message:', messageData);
  
      // Send message as object (official Xano SDK format)
      thisChannel.message(messageData);
      
      console.log('Message sent successfully');
      return Promise.resolve();
  
    } catch (error) {
      console.error('sendMessage: Error sending message', error);
      return Promise.reject(error);
    }
  };
  
  
  
  /**
   * Send a message with optimistic UI update
   */
  window.sendMessageOptimistic = (messageData) => {
    const channelInfo = window.currentChannel;
    if (!channelInfo) {
      console.error('No active channel');
      return Promise.reject(new Error('No active channel'));
    }
    
    // Create optimistic message object
    const optimisticMessage = {
      id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
      created_at: Date.now(),
      conversation_id: messageData.conversation_id,
      user_id: channelInfo.userId,
      message: messageData.message,
      isFile: messageData.isFile || false,
      file_type: messageData.file_type || "",
      file_name: messageData.file_name || "",
      reply_to_id: messageData.reply_to_id || null,
      _user: {
        id: channelInfo.userId,
        name: window.currentUserName || 'You', // You'll need to store this
        // ... other user fields
      },
      _reactions: [],
      _translations: []
    };
    
    // Find RG and immediately inject the message
    const rg = window.findVisibleRG();
    if (rg !== null) {
      console.log('Optimistically rendering message');
      window.injectMessages(rg, [optimisticMessage], channelInfo.userId);
    }
    
    // Track this message (will be replaced when real message arrives)
    // Note: we'll need to update this when we get the real ID back
    
    // Send the actual message
    return window.sendMessage(messageData).then(() => {
      console.log('Message sent, waiting for server confirmation');
      // When the real message comes back with proper ID, we'll need to update our tracking
    });
  };
  
  
  /* ─────────── EXTRACT LAST 10 MESSAGES ─────────── */
  
  
  function extractLast10Messages() {
    const container = document.querySelector('.chat-messages');
    if (!container) return [];
  
    const messageElements = Array.from(container.querySelectorAll('.message'));
    const last10 = messageElements.slice(-10);
  
    const messages = last10.map(el => {
      const sender = el.dataset.username || "Unknown";
      const message = el.dataset.message || "";
  
      return { sender, message };
    });
  
    return messages;
  }
  