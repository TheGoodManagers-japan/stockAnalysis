/* ─────────────────── CONFIG & HELPERS ─────────────────── */
const DATE_LOCALE = 'en-US';
const parseTime = t => (typeof t === 'string' ? new Date(t).getTime() : t);
const fmtTime   = t => new Intl.DateTimeFormat(DATE_LOCALE,{hour:'2-digit',minute:'2-digit'}).format(parseTime(t));
const fmtDate   = t => new Intl.DateTimeFormat(DATE_LOCALE,{month:'short',day:'numeric',year:'numeric'}).format(parseTime(t));
const esc       = s => s ? s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '';

/* aggregate reactions */
const agg = arr => {
  const m = {};
  for (const r of arr ?? []) if (r.emoji) {
    m[r.emoji] ??= { c: 0, users: [], userIds: [] };
    m[r.emoji].c++;
    if (r._user)   m[r.emoji].users.push(r._user.name || 'Unknown');
    if (r.user_id) m[r.emoji].userIds.push(r.user_id);
  }
  return Object.entries(m).map(([e, d]) => ({ e, c: d.c, users: d.users, userIds: d.userIds }));
};

const renderDivider = lbl => `
  <div class="date-divider" data-date="${lbl}">
    <div class="date-divider-line"></div>
    <div class="date-divider-label">${lbl}</div>
    <div class="date-divider-line"></div>
  </div>`;

/* ─────────── FILE ATTACHMENT (message = URL) ─────────── */
function renderFileAttachment(m) {
  const url   = esc(m.message || '#');
  const name  = esc(m.file_name || url.split('/').pop() || 'download');
  const type  = (m.file_type || '').toLowerCase();
  const cls   = type.startsWith('image') ? 'image-attachment' : 'generic-attachment';
  const thumb = type.startsWith('image')
      ? `<img src="${url}" alt="${name}" class="file-image-preview">`
      : `<span class="file-icon">📎</span>`;

  return `
    <div class="file-attachment ${cls}" data-url="${url}" data-name="${name}" data-type="${type}">
      <a href="#" class="file-open-trigger" tabindex="0">
        ${thumb}<span class="file-name">${name}</span>
      </a>
    </div>`;
}

/* ─────────── INLINE REPLY PREVIEW ─────────── */
function renderInlineReplyPreview(r) {
  if (!r?.id) return '';
  const un   = esc(r._users?.name || 'Unknown');
  const body = r.isFile
      ? renderFileAttachment(r)
      : `<div class="message-text lang-original">${esc(r.message)}</div>` +
        (r._translations || []).map(tr => `
          <div class="message-text lang-${esc(tr.language)}" style="display:none;">
            ${esc(tr.translated_text)}
          </div>`).join('');
  return `
    <div class="reply-preview reply-scroll-target" data-target-id="${esc(r.id)}">
      <div class="reply-preview-header">
        <span class="reply-to-name">${un}</span>
      </div>${body}
    </div>`;
}

/* ─────────── REPLY HTML FOR BUBBLE ─────────── */
function buildReplyHtml(msgEl) {
  const un   = esc(msgEl.dataset.username);
  const file = msgEl.querySelector('.file-attachment');
  const body = file
      ? file.outerHTML
      : Array.from(msgEl.querySelectorAll('.message-text')).map(el => el.outerHTML).join('');
  return `<div class="reply-preview-custom">
            <strong class="reply-name">${un}</strong>
            <div class="reply-body">${body}</div>
          </div>`;
}


/* ─────────── ROBUST MARKDOWN PARSER FOR NESTED LISTS ─────────── */
function parseMarkdown(text) {
  if (!text) return '';
  
  // Step 1: Escape HTML to prevent XSS
  let html = text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  
  // Step 2: Temporarily replace code blocks to protect them
  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre class="code-block"><code>${code}</code></pre>`);
    return placeholder;
  });
  
  // Step 3: Temporarily replace inline code to protect it
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code class="inline-code">${code}</code>`);
    return placeholder;
  });
  
  // Step 4: Process lists with better nesting support
  const processLists = (text) => {
    const lines = text.split('\n');
    const result = [];
    const listStack = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for list items with various bullet types
      const bulletMatch = line.match(/^(\s*)([\*\-\+•])\s+(.*)$/);
      const numberedMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);
      
      if (bulletMatch || numberedMatch) {
        const indent = (bulletMatch ? bulletMatch[1] : numberedMatch[1]).length;
        const content = bulletMatch ? bulletMatch[3] : numberedMatch[3];
        const isNumbered = !!numberedMatch;
        
        // Determine nesting level (every 2-4 spaces or a tab = 1 level)
        const level = Math.floor(indent / 2);
        
        // Close lists that are deeper than current level
        while (listStack.length > 0 && listStack[listStack.length - 1].level > level) {
          const list = listStack.pop();
          result.push(`</${list.type}>`);
        }
        
        // Check if we need to start a new list
        const needNewList = listStack.length === 0 || 
                           listStack[listStack.length - 1].level < level ||
                           (listStack[listStack.length - 1].level === level && 
                            listStack[listStack.length - 1].type !== (isNumbered ? 'ol' : 'ul'));
        
        if (needNewList) {
          // Close same-level list of different type if exists
          if (listStack.length > 0 && 
              listStack[listStack.length - 1].level === level && 
              listStack[listStack.length - 1].type !== (isNumbered ? 'ol' : 'ul')) {
            result.push(`</${listStack.pop().type}>`);
          }
          
          const listType = isNumbered ? 'ol' : 'ul';
          const listClass = level > 0 ? ' class="nested-list"' : ' class="chat-list"';
          result.push(`<${listType}${listClass}>`);
          listStack.push({ type: listType, level: level });
        }
        
        // Process the content for inline formatting
        let processedContent = content;
        
        // Handle bold formatting (** or __)
        processedContent = processedContent.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
        processedContent = processedContent.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        
        // Handle italic formatting (* or _) - careful not to match list markers
        processedContent = processedContent.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');
        processedContent = processedContent.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
        
        // Handle links
        processedContent = processedContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
          '<a href="$2" target="_blank" rel="noopener">$1</a>');
        
        result.push(`<li>${processedContent}</li>`);
      } else {
        // Not a list item - close all open lists
        while (listStack.length > 0) {
          result.push(`</${listStack.pop().type}>`);
        }
        
        // Add the non-list line
        result.push(line);
      }
    }
    
    // Close any remaining open lists
    while (listStack.length > 0) {
      result.push(`</${listStack.pop().type}>`);
    }
    
    return result.join('\n');
  };
  
  // Apply list processing
  html = processLists(html);
  
  // Step 5: Process inline formatting for non-list content
  // Split by lines to avoid processing list items again
  const lines = html.split('\n');
  const processedLines = lines.map(line => {
    // Skip if line is a list tag or list item
    if (line.match(/^<[uo]l/) || line.match(/^<\/[uo]l>/) || line.match(/^<li>/)) {
      return line;
    }
    
    // Process bold (not already in lists)
    line = line.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Process italic (not already in lists)
    line = line.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');
    line = line.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
    
    // Process links
    line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    return line;
  });
  
  html = processedLines.join('\n');
  
  // Step 6: Handle paragraphs and line breaks
  // Split on double newlines for paragraphs
  const blocks = html.split(/\n\n+/);
  
  html = blocks.map(block => {
    // Don't wrap lists, code blocks, or empty blocks
    if (block.trim() === '' || 
        block.includes('<ul') || 
        block.includes('<ol') || 
        block.includes('__CODE_BLOCK_')) {
      return block;
    }
    
    // Check if the entire block is already wrapped in HTML tags
    if (block.trim().match(/^<[^>]+>.*<\/[^>]+>$/s)) {
      return block;
    }
    
    // Convert single newlines to <br> and wrap in paragraph
    const withBreaks = block.trim().replace(/\n/g, '<br>');
    return `<p>${withBreaks}</p>`;
  }).filter(block => block.trim() !== '').join('\n\n');
  
  // Step 7: Restore code blocks and inline code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });
  
  inlineCodes.forEach((code, i) => {
    html = html.replace(`__INLINE_CODE_${i}__`, code);
  });
  
  return html;
}

window.parseMarkdown = parseMarkdown;

/* ─────────── UPDATE RENDERMSG TO USE MARKDOWN PARSER ─────────── */
const renderMsgWithMarkdown = (m, cuid) => {
  const AI_USER_ID = '5c82f501-a3da-4083-894c-4367dc2e01f3';
  const isAIChat = window.location.pathname.includes('ai-chat') || 
                   window.location.search.includes('ai-chat');
  const isAIMessage = m.user_id === AI_USER_ID;
  
  const u = m._user ?? {};
  const ts = parseTime(m.created_at);
  
  // Handle avatar for AI in AI chat mode
  let avatarStyle = '';
  let avatarContent = '';
  
  if (isAIChat && isAIMessage) {
    avatarContent = 'AI';
  } else if (u.profilePicture) {
    avatarStyle = `style="background-image:url('${u.profilePicture}')"`;
  } else {
    const initial = (u.name || 'U').charAt(0).toUpperCase();
    avatarStyle = `style="background: #3a81df; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;"`;
    avatarContent = initial;
  }
  
  // Parse markdown for AI messages in AI chat mode, otherwise use regular escaping
  let messageContent;
  if (isAIChat && isAIMessage && m.message) {
    messageContent = parseMarkdown(m.message);
  } else if (m.message) {
    messageContent = esc(m.message);
  }
  
  const body = m.isFile
      ? renderFileAttachment(m)
      : `<div class="message-text lang-original">${messageContent}</div>` +
        (m._translations || []).map(tr => `
          <div class="message-text lang-${esc(tr.language)}" style="display:none;">
            ${isAIChat && isAIMessage ? parseMarkdown(tr.translated_text) : esc(tr.translated_text)}
          </div>`).join('');

  const reacts = agg(m._reactions).map(r => {
    const mine = cuid && r.userIds.includes(cuid);
    return `<div class="reaction${mine ? ' user-reacted' : ''}"
                data-emoji="${esc(r.e)}"
                data-users='${JSON.stringify(r.users)}'
                data-user-ids='${JSON.stringify(r.userIds)}'>
              <span class="reaction-emoji">${r.e}</span>
              <span class="reaction-count">${r.c}</span>
            </div>`;
  }).join('');

  const actionTrigger = isAIChat ? '' : '<div class="message-actions-trigger">⋮</div>';

  return `<div class="message${m._reply ? ' has-reply' : ''}${isAIChat && isAIMessage ? ' ai-message' : ''}"
               data-id="${m.id}" data-ts="${ts}" data-uid="${m.user_id}"
               data-username="${esc(u.name || 'Unknown')}"
               data-message="${esc(m.isFile ? m.file_name : m.message)}">
            <div class="message-wrapper">
              <div class="message-gutter">
                <div class="avatar" ${avatarStyle}>${avatarContent}</div>
              </div>
              <div class="message-content-wrapper">
                <div class="message-header">
                  <span class="username">${esc(u.name || 'Unknown')}</span>
                  <span class="timestamp">${fmtTime(ts)}</span>
                  ${actionTrigger}
                </div>
                ${m._reply && m._reply.id ? renderInlineReplyPreview(m._reply) : ''}
                ${body}
                ${reacts ? `<div class="reactions">${reacts}</div>` : ''}
              </div>
            </div>
          </div>`;
};

// Replace the existing renderMsg with this new version
window.renderMsg = renderMsgWithMarkdown;


/* ─────────── AI TYPING INDICATOR ─────────── */
let typingIndicatorElement = null;
let typingIndicatorTimeout = null;

window.showAITypingIndicator = function(rgNum) {
  const isAIChat = window.location.pathname.includes('ai-chat') || 
                   window.location.search.includes('ai-chat');
  if (!isAIChat) return;
  
  const chatContainer = document.querySelector(`#rg${rgNum} .chat-messages`);
  if (!chatContainer) return;
  
  window.hideAITypingIndicator();
  
  if (typingIndicatorTimeout) {
    clearTimeout(typingIndicatorTimeout);
  }
  
  // Create typing indicator as a pseudo-message
  const typingMessage = {
    id: 'typing-indicator',
    created_at: Date.now(),
    user_id: '5c82f501-a3da-4083-894c-4367dc2e01f3',
    message: `<div style="display: flex; gap: 4px;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out; animation-delay: -0.32s;"></span>
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out; animation-delay: -0.16s;"></span>
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #667eea; opacity: 0.4; animation: typingBounce 1.4s infinite ease-in-out;"></span>
    </div>`,
    _user: {
      name: 'Sumizy AI',
      profilePicture: null
    },
    isFile: false,
    _reactions: [],
    _translations: []
  };
  
  // Render typing indicator using the same renderMsg function
  const typingHTML = renderMsg(typingMessage, null);
  typingIndicatorElement = document.createElement('div');
  typingIndicatorElement.innerHTML = typingHTML;
  typingIndicatorElement = typingIndicatorElement.firstChild;
  typingIndicatorElement.classList.add('typing-indicator');
  
  chatContainer.appendChild(typingIndicatorElement);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  
  // Auto-hide after 30 seconds
  typingIndicatorTimeout = setTimeout(() => {
    window.hideAITypingIndicator();
  }, 30000);
};

window.hideAITypingIndicator = function() {
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

/* ─────────── INJECTOR FACTORY (FIXED) ─────────── */
function makeChatInjector(chatEl, cuid) {
  const bottom = () => requestAnimationFrame(() => (chatEl.scrollTop = chatEl.scrollHeight));
  const AI_USER_ID = '5c82f501-a3da-4083-894c-4367dc2e01f3'; // Sumizy AI's ID

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
      const el  = document.createRange().createContextualFragment(renderMsg(m, cuid)).firstElementChild;
      
      if (old) {
        old.replaceWith(el);
        // Don't scroll when updating existing messages
      } else {
        // Check if we need a date divider for this single message
        const msgDate = fmtDate(m.created_at);
        const existingDivider = chatEl.querySelector(`[data-date="${msgDate}"]`);
        
        const allDividers = chatEl.querySelectorAll('.date-divider');
        const lastDivider = allDividers[allDividers.length - 1];
        const lastDate = lastDivider ? lastDivider.dataset.date : '';
        
        if (msgDate !== lastDate && !existingDivider) {
          const dividerEl = document.createRange().createContextualFragment(renderDivider(msgDate));
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
    
    const sortedMessages = [...payload].sort((a, b) => parseTime(a.created_at) - parseTime(b.created_at));
    
    const existingDates = new Set(
      Array.from(chatEl.querySelectorAll('.date-divider')).map(div => div.dataset.date)
    );
    
    let batchLastDate = '';
    
    for (const m of sortedMessages) {
      if (m.isDeleted) {
        chatEl.querySelector(`[data-id="${m.id}"]`)?.remove();
        continue;
      }

      const lbl = fmtDate(m.created_at);
      
      if (lbl !== batchLastDate && !existingDates.has(lbl)) {
        frag.appendChild(document.createRange().createContextualFragment(renderDivider(lbl)));
        existingDates.add(lbl);
        batchLastDate = lbl;
      }
      
      frag.appendChild(document.createRange().createContextualFragment(renderMsg(m, cuid)));
      
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

/* ─────────── RETRY MECHANISM FOR DOM ELEMENTS ─────────── */
/**
 * Wait for an element to exist in the DOM with retry mechanism
 * @param {string} selector - CSS selector for the element
 * @param {number} maxRetries - Maximum number of retries (default: 50)
 * @param {number} retryDelay - Delay between retries in ms (default: 100)
 * @returns {Promise<Element|null>} Promise that resolves with the element or null
 */
function waitForElement(selector, maxRetries = 50, retryDelay = 2000) {
  return new Promise((resolve) => {
    let retries = 0;
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      
      if (element) {
        console.log(`Element ${selector} found after ${retries} retries`);
        resolve(element);
      } else if (retries >= maxRetries) {
        console.warn(`Element ${selector} not found after ${maxRetries} retries`);
        resolve(null);
      } else {
        retries++;
        setTimeout(checkElement, retryDelay);
      }
    };
    
    checkElement();
  });
}

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

/* ─────────── GLOBAL DISPATCHER WITH RETRY ─────────── */
const cache = new Map();
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

/* ─────────── LANGUAGE TOGGLE ─────────── */
function switchLanguage(lang) {
  document.querySelectorAll('.message-text').forEach(el => (el.style.display = 'none'));
  document.querySelectorAll(`.lang-${lang}`).forEach(el => (el.style.display = ''));
}

/* ─────────── SMOOTH SCROLL + HIGHLIGHT ─────────── */
function scrollToMessage(id) {
  const t = document.querySelector(`.message[data-id="${id}"]`); if (!t) return;
  t.scrollIntoView({ behavior: 'smooth', block: 'center' });
  t.classList.add('message-scroll-highlight');
  setTimeout(() => t.classList.remove('message-scroll-highlight'), 1200);
}

/* click an inline reply preview */
document.addEventListener('click', e => {
  const p = e.target.closest('.reply-scroll-target');
  if (p) { e.stopPropagation(); scrollToMessage(p.dataset.targetId); }
});

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
    
/* ─────────── CHANNEL JOIN/LEAVE FUNCTIONS ─────────── */

/* ─────────── HELPER FUNCTION TO FIND VISIBLE RG ─────────── */
/**
 * Find the currently visible repeating group
 * @returns {number|null} The RG number or null if none found
 */
window.findVisibleRG = () => {
  const rgElements = document.querySelectorAll('.rg-reference[id^="rg"]');
  for (const el of rgElements) {
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
      const rgMatch = el.id.match(/^rg(\d+)$/);
      if (rgMatch) {
        return parseInt(rgMatch[1]);
      }
    }
  }
  return null;
};

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
