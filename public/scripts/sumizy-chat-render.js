// sumizy-chat-render.js

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

      const bulletMatch = line.match(/^(\s*)([\*\-\+•])\s+(.*)$/);
      const numberedMatch = line.match(/^(\s*)(\d+\.)\s+(.*)$/);

      if (bulletMatch || numberedMatch) {
        const indent = (bulletMatch ? bulletMatch[1] : numberedMatch[1]).length;
        const content = bulletMatch ? bulletMatch[3] : numberedMatch[3];
        const isNumbered = !!numberedMatch;

        const level = Math.floor(indent / 2);

        while (
          listStack.length > 0 &&
          listStack[listStack.length - 1].level > level
        ) {
          const list = listStack.pop();
          result.push(`</${list.type}>`);
        }

        const needNewList =
          listStack.length === 0 ||
          listStack[listStack.length - 1].level < level ||
          (listStack[listStack.length - 1].level === level &&
            listStack[listStack.length - 1].type !==
              (isNumbered ? "ol" : "ul"));

        if (needNewList) {
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

        let processedContent = content;

        processedContent = processedContent.replace(
          /\*\*([^\*]+)\*\*/g,
          "<strong>$1</strong>"
        );
        processedContent = processedContent.replace(
          /__([^_]+)__/g,
          "<strong>$1</strong>"
        );

        processedContent = processedContent.replace(
          /(?<!\*)\*([^\*\n]+)\*(?!\*)/g,
          "<em>$1</em>"
        );
        processedContent = processedContent.replace(
          /(?<!_)_([^_\n]+)_(?!_)/g,
          "<em>$1</em>"
        );

        processedContent = processedContent.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>'
        );

        result.push(`<li>${processedContent}</li>`);
      } else {
        while (listStack.length > 0) {
          result.push(`</${listStack.pop().type}>`);
        }
        result.push(line);
      }
    }

    while (listStack.length > 0) {
      result.push(`</${listStack.pop().type}>`);
    }

    return result.join("\n");
  };

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

  // Step 6: paragraphs / line breaks
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

  // Step 7: Restore code
  codeBlocks.forEach((block, i) => {
    html = html.replace(`__CODE_BLOCK_${i}__`, block);
  });
  inlineCodes.forEach((code, i) => {
    html = html.replace(`__INLINE_CODE_${i}__`, code);
  });

  return html;
}

window.parseMarkdown = parseMarkdown;

/* Small helpers used below */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function parseTime(t) {
  return typeof t === "number" ? t : Date.parse(t) || 0;
}
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}

/* ─────────── FILE ATTACHMENT (message = URL) ─────────── */
function renderFileAttachment(m) {
  const type = String(m.file_type || "").toLowerCase();
  const rawUrl = String(m.message || "");
  const url = esc(rawUrl);
  const name = esc(m.file_name || rawUrl.split("/").pop() || "download");

  const looksImage =
    type.startsWith("image") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(rawUrl);

  const cls = looksImage ? "image-attachment" : "generic-attachment";

  return looksImage
    ? `
      <div class="file-attachment ${cls}" data-url="${url}" data-name="${name}" data-type="${type}">
        <a href="#" class="file-open-trigger" tabindex="0">
          <img src="${url}" alt="" class="file-image-preview">
        </a>
      </div>`
    : `
      <div class="file-attachment ${cls}" data-url="${url}" data-name="${name}" data-type="${type}">
        <a href="#" class="file-open-trigger" tabindex="0">
          <span class="file-icon">📎</span><span class="file-name">${name}</span>
        </a>
      </div>`;
}

function renderInlineReplyPreview(r) {
  if (!r?.id) return "";
  const un = esc(r._users?.name || "Unknown");
  const isDeleted = !!r.isDeleted;

  const body = isDeleted
    ? `<div class="message-text lang-original">${esc("Message Unsent")}</div>`
    : r.isFile
    ? renderFileAttachment(r)
    : `<div class="message-text lang-original">${esc(r.message)}</div>` +
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

  const deletedAttrs = isDeleted
    ? ' data-deleted="true" class="is-deleted"'
    : "";
  return `
    <div class="reply-preview reply-scroll-target"${deletedAttrs} data-target-id="${esc(
    r.id
  )}">
      <div class="reply-preview-header">
        <span class="reply-to-name">${un}</span>
      </div>${body}
    </div>`;
}

/* ─────────── AGGREGATE REACTIONS (expect window.agg if present) ─────────── */
function agg(raw) {
  try {
    if (typeof window.agg === "function") return window.agg(raw || []);
  } catch {}
  // tiny fallback
  const map = new Map();
  for (const r of raw || []) {
    const e = r?.emoji || r?.e || r?.key || r?.symbol;
    if (!e) continue;
    const uid = r?.user_id;
    const entry = map.get(e) || { e, c: 0, users: [], userIds: [] };
    entry.c += 1;
    if (uid) entry.userIds.push(uid);
    map.set(e, entry);
  }
  return Array.from(map.values());
}

/* ─────────── UPDATE RENDERMSG TO BE PANE-AWARE ─────────── */
const renderMsgWithMarkdown = (m, cuid) => {
  const AI_USER_ID = "5c82f501-a3da-4083-894c-4367dc2e01f3";
  const isNotification = !!m.is_notification;

  // Detect “AI chat mode”
  let isAIChat =
    typeof window.isAIChat === "function"
      ? !!window.isAIChat() // dual-pane aware
      : window.location.pathname.includes("ai-chat") ||
        window.location.search.includes("ai-chat");

  const isAIMessage = String(m.user_id) === AI_USER_ID;

  const u = m._user ?? {};
  const ts = parseTime(m.created_at);

  // Avatar
  let avatarStyle = "";
  let avatarContent = "";
  if (isAIChat && isAIMessage) {
    avatarContent = "AI";
  } else if (u.profilePicture) {
    avatarStyle = `style="background-image:url('${u.profilePicture}')"`; // trusted path
  } else {
    const initial = (u.name || "U").charAt(0).toUpperCase();
    avatarStyle = `style="background:#3a81df;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;"`;
    avatarContent = initial;
  }

  // Body
  let messageContent = "";
  if (m.isFile) {
    messageContent = renderFileAttachment(m);
  } else if (m.message) {
    messageContent =
      isAIChat && isAIMessage
        ? `<div class="message-text lang-original">${parseMarkdown(
            m.message
          )}</div>`
        : `<div class="message-text lang-original">${esc(m.message)}</div>`;
    // translations
    if (Array.isArray(m._translations) && m._translations.length > 0) {
      messageContent += m._translations
        .map((tr) => {
          const lang = esc(tr.language);
          const txt = tr.translated_text || "";
          const inner = isAIChat && isAIMessage ? parseMarkdown(txt) : esc(txt);
          return `<div class="message-text lang-${lang}" style="display:none;">${inner}</div>`;
        })
        .join("");
    } else {
      // No translations yet: add EN/JA placeholders (hidden by default)
      const placeholders = [
        { language: "en", text: "Translation not available yet" },
        { language: "ja", text: "翻訳はまだありません" },
      ];
      messageContent += placeholders
        .map((p) => {
          const inner = isAIChat && isAIMessage ? parseMarkdown(p.text) : esc(p.text);
          return `<div class="message-text lang-${esc(p.language)}" style="display:none;">${inner}</div>`;
        })
        .join("");
    }
    
  }

  
  const reacts = isNotification
    ? ""
    : agg(m._reactions)
        .map((r) => {
          const mine = cuid && r.userIds.includes(cuid);
          return `<div class="reaction${mine ? " user-reacted" : ""}"
                  data-emoji="${esc(r.e)}"
                  data-users='${JSON.stringify(r.users || [])}'
                  data-user-ids='${JSON.stringify(r.userIds || [])}'>
                <span class="reaction-emoji">${r.e}</span>
                <span class="reaction-count">${r.c}</span>
              </div>`;
        })
        .join("");

  // >>> PATCH: read receipts on first render <<<
  const readers =
    typeof window.getReaders === "function" ? window.getReaders(m) : [];
  const readReceipts =
    typeof window.renderReadReceipts === "function"
      ? window.renderReadReceipts(readers, cuid)
      : "";

        const actionTrigger = isNotification
          ? ''
          : '<div class="message-actions-trigger" aria-label="Message actions" tabindex="0">⋮</div>';

  const imageLike =
    m.isFile &&
    (String(m.file_type || "")
      .toLowerCase()
      .startsWith("image") ||
      /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(m.message || "")));

  return `<div class="message${m._reply ? " has-reply" : ""}${
    isAIChat && isAIMessage ? " ai-message" : ""
      }${isNotification ? " is-notification" : ""}"
                     data-id="${m.id}" data-ts="${ts}" data-uid="${m.user_id}"
                     data-notification="${isNotification ? "true" : "false"}"
                 data-username="${esc(u.name || "Unknown")}"
                 data-message="${esc(
                   imageLike ? "" : m.isFile ? m.file_name : m.message || ""
                 )}">
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
                  ${messageContent}
                  ${reacts ? `<div class="reactions">${reacts}</div>` : ""}
                  ${readReceipts}
                  
                </div>
              </div>
            </div>`;
};

// Replace the existing renderMsg with this new version
window.renderMsg = renderMsgWithMarkdown;

/* Keep exports used elsewhere */
window.buildReplyHtml = function buildReplyHtml(msgEl) {
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
};
