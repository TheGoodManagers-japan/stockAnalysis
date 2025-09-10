//sumizy-chat-render.js

/* ─────────── ROBUST MARKDOWN PARSER FOR NESTED LISTS ─────────── */
function parseMarkdown(text) {
  if (!text) return "";

  // Step 1: Escape HTML to prevent XSS
  let html = text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );

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
    const lines = text.split("\n");
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
        while (
          listStack.length > 0 &&
          listStack[listStack.length - 1].level > level
        ) {
          const list = listStack.pop();
          result.push(`</${list.type}>`);
        }

        // Check if we need to start a new list
        const needNewList =
          listStack.length === 0 ||
          listStack[listStack.length - 1].level < level ||
          (listStack[listStack.length - 1].level === level &&
            listStack[listStack.length - 1].type !==
              (isNumbered ? "ol" : "ul"));

        if (needNewList) {
          // Close same-level list of different type if exists
          if (
            listStack.length > 0 &&
            listStack[listStack.length - 1].level === level &&
            listStack[listStack.length - 1].type !== (isNumbered ? "ol" : "ul")
          ) {
            result.push(`</${listStack.pop().type}>`);
          }

          const listType = isNumbered ? "ol" : "ul";
          const listClass =
            level > 0 ? ' class="nested-list"' : ' class="chat-list"';
          result.push(`<${listType}${listClass}>`);
          listStack.push({ type: listType, level: level });
        }

        // Process the content for inline formatting
        let processedContent = content;

        // Handle bold formatting (** or __)
        processedContent = processedContent.replace(
          /\*\*([^\*]+)\*\*/g,
          "<strong>$1</strong>"
        );
        processedContent = processedContent.replace(
          /__([^_]+)__/g,
          "<strong>$1</strong>"
        );

        // Handle italic formatting (* or _) - careful not to match list markers
        processedContent = processedContent.replace(
          /(?<!\*)\*([^\*\n]+)\*(?!\*)/g,
          "<em>$1</em>"
        );
        processedContent = processedContent.replace(
          /(?<!_)_([^_\n]+)_(?!_)/g,
          "<em>$1</em>"
        );

        // Handle links
        processedContent = processedContent.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>'
        );

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

    return result.join("\n");
  };

  // Apply list processing
  html = processLists(html);

  // Step 5: Process inline formatting for non-list content
  const lines = html.split("\n");
  const processedLines = lines.map((line) => {
    if (
      line.match(/^<[uo]l/) ||
      line.match(/^<\/[uo]l>/) ||
      line.match(/^<li>/)
    ) {
      return line;
    }

    line = line.replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/__([^_]+)__/g, "<strong>$1</strong>");

    line = line.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, "<em>$1</em>");
    line = line.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");

    line = line.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    );

    return line;
  });

  html = processedLines.join("\n");

  // Step 6: Handle paragraphs and line breaks
  const blocks = html.split(/\n\n+/);

  html = blocks
    .map((block) => {
      if (
        block.trim() === "" ||
        block.includes("<ul") ||
        block.includes("<ol") ||
        block.includes("__CODE_BLOCK_")
      ) {
        return block;
      }

      if (block.trim().match(/^<[^>]+>.*<\/[^>]+>$/s)) {
        return block;
      }

      const withBreaks = block.trim().replace(/\n/g, "<br>");
      return `<p>${withBreaks}</p>`;
    })
    .filter((block) => block.trim() !== "")
    .join("\n\n");

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
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3";
  const isAIChat =
    window.location.pathname.includes("ai-chat") ||
    window.location.search.includes("ai-chat");
  const isAIMessage = m.user_id === AI_USER_ID;

  const u = m._user ?? {};
  const ts = parseTime(m.created_at);
  const isDeleted = !!m.isDeleted;

  // Handle avatar for AI in AI chat mode
  let avatarStyle = "";
  let avatarContent = "";

  if (isAIChat && isAIMessage) {
    avatarContent = "AI";
  } else if (u.profilePicture) {
    avatarStyle = `style="background-image:url('${u.profilePicture}')"`;
  } else {
    const initial = (u.name || "U").charAt(0).toUpperCase();
    avatarStyle = `style="background: #3a81df; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;"`;
    avatarContent = initial;
  }

  // Parse markdown for AI messages in AI chat mode, otherwise escape
  let messageContent = "";
  if (isAIChat && isAIMessage && m.message) {
    messageContent = parseMarkdown(m.message);
  } else if (m.message) {
    messageContent = esc(m.message);
  }

  const body = m.isFile
    ? renderFileAttachment(m)
    : `<div class="message-text lang-original">${messageContent}</div>` +
      (m._translations || [])
        .map(
          (tr) => `
            <div class="message-text lang-${esc(
              tr.language
            )}" style="display:none;">
              ${
                isAIChat && isAIMessage
                  ? parseMarkdown(tr.translated_text)
                  : esc(tr.translated_text)
              }
            </div>`
        )
        .join("");

  const reacts = agg(m._reactions)
    .map((r) => {
      const mine = cuid && r.userIds.includes(cuid);
      return `<div class="reaction${mine ? " user-reacted" : ""}"
                  data-emoji="${esc(r.e)}"
                  data-users='${JSON.stringify(r.users)}'
                  data-user-ids='${JSON.stringify(r.userIds)}'>
                <span class="reaction-emoji">${r.e}</span>
                <span class="reaction-count">${r.c}</span>
              </div>`;
    })
    .join("");

  // Hide action trigger on deleted messages
  const actionTrigger =
    isAIChat || isDeleted ? "" : '<div class="message-actions-trigger">⋮</div>';

  const classes = [
    "message",
    m._reply && m._reply.id ? "has-reply" : "",
    isAIChat && isAIMessage ? "ai-message" : "",
    isDeleted ? "is-deleted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `<div class="${classes}"
                 data-id="${m.id}" data-ts="${ts}" data-uid="${m.user_id}"
                 data-username="${esc(u.name || "Unknown")}"
                 data-message="${esc(m.isFile ? m.file_name : m.message || "")}"
                 data-deleted="${isDeleted ? "true" : "false"}">
              <div class="message-wrapper">
                <div class="message-gutter">
                  <div class="avatar" ${avatarStyle}>${avatarContent}</div>
                </div>
                <div class="message-content-wrapper">
                  <div class="message-header">
                    <span class="username">${esc(u.name || "Unknown")}</span>
                    <span class="timestamp">${fmtTime(ts)}</span>
                    ${actionTrigger}
                  </div>
                  ${
                    m._reply && m._reply.id
                      ? renderInlineReplyPreview(m._reply)
                      : ""
                  }
                  ${body}
                  ${reacts ? `<div class="reactions">${reacts}</div>` : ""}
                </div>
              </div>
            </div>`;
};

// Replace the existing renderMsg with this new version
window.renderMsg = renderMsgWithMarkdown;

/* ─────────── FILE ATTACHMENT (message = URL) ─────────── */
function renderFileAttachment(m) {
  const url = esc(m.message || "#");
  const name = esc(m.file_name || url.split("/").pop() || "download");
  const type = (m.file_type || "").toLowerCase();
  const cls = type.startsWith("image")
    ? "image-attachment"
    : "generic-attachment";
  const thumb = type.startsWith("image")
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
  if (!r?.id) return "";

  const un = esc(r._users?.name || r._user?.name || "Unknown");
  const isDeleted = !!r.isDeleted;

  // Always use the server’s message; it’s already overwritten for unsent
  const displayText =
    typeof r.message === "string" && r.message.trim()
      ? r.message
      : isDeleted
      ? "Message Unsent"
      : "";

  const classes = `reply-preview reply-scroll-target${
    isDeleted ? " is-deleted" : ""
  }`;

  const body = isDeleted
    ? `<div class="message-text lang-original">${esc(displayText)}</div>`
    : r.isFile
    ? renderFileAttachment(r)
    : `<div class="message-text lang-original">${esc(displayText)}</div>` +
      (r._translations || [])
        .map(
          (tr) => `
              <div class="message-text lang-${esc(
                tr.language
              )}" style="display:none;">
                ${esc(tr.translated_text)}
              </div>`
        )
        .join("");

  return `
    <div class="${classes}" data-deleted="${isDeleted ? "true" : "false"}"
         data-target-id="${esc(r.id)}">
      <div class="reply-preview-header">
        <span class="reply-to-name">${un}</span>
      </div>${body}
    </div>`;
}

/* ─────────── REPLY HTML FOR BUBBLE ─────────── */
function buildReplyHtml(msgEl) {
  const un = esc(msgEl.dataset.username);
  const file = msgEl.querySelector(".file-attachment");
  const body = file
    ? file.outerHTML
    : Array.from(msgEl.querySelectorAll(".message-text"))
        .map((el) => el.outerHTML)
        .join("");
  return `<div class="reply-preview-custom">
              <strong class="reply-name">${un}</strong>
              <div class="reply-body">${body}</div>
            </div>`;
}

window.buildReplyHtml = buildReplyHtml;
