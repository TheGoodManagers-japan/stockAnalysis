// sumizy-chat-utils.js

/* ─────────────────── CONFIG & HELPERS ─────────────────── */
const DATE_LOCALE = "en-US";
const parseTime = (t) => (typeof t === "string" ? new Date(t).getTime() : t);
const fmtTime = (t) =>
  new Intl.DateTimeFormat(DATE_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseTime(t));
const fmtDate = (t) =>
  new Intl.DateTimeFormat(DATE_LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseTime(t));
const esc = (s) =>
  s
    ? s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          }[c])
      )
    : "";

/* aggregate reactions */
const agg = (arr) => {
  const m = {};
  for (const r of arr ?? [])
    if (r.emoji) {
      m[r.emoji] ??= { c: 0, users: [], userIds: [] };
      m[r.emoji].c++;
      if (r._user) m[r.emoji].users.push(r._user.name || "Unknown");
      if (r.user_id) m[r.emoji].userIds.push(r.user_id);
    }
  return Object.entries(m).map(([e, d]) => ({
    e,
    c: d.c,
    users: d.users,
    userIds: d.userIds,
  }));
};

const renderDivider = (lbl) => `
  <div class="date-divider" data-date="${lbl}">
    <div class="date-divider-line"></div>
    <div class="date-divider-label">${lbl}</div>
    <div class="date-divider-line"></div>
  </div>`;

/* ─────────── RETRY MECHANISM FOR DOM ELEMENTS ─────────── */
/**
 * Wait for an element to exist in the DOM with retry mechanism
 * @param {string} selector - CSS selector for the element
 * @param {number} maxRetries - Maximum number of retries (default: 50)
 * @param {number} retryDelay - Delay between retries in ms (default: 2000)
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
        console.warn(
          `Element ${selector} not found after ${maxRetries} retries`
        );
        resolve(null);
      } else {
        retries++;
        setTimeout(checkElement, retryDelay);
      }
    };

    checkElement();
  });
}
window.waitForElement = waitForElement;

/* ─────────── URL HELPERS (pane-aware) ─────────── */
function getUrlParams() {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams("");
  }
}

/** Returns { mainId: string|null, aiId: string|null } via canonical resolver */
function getPaneIdsFromUrl() {
  const ids = (window.getPaneIdsFromUrl && window.getPaneIdsFromUrl()) || { main: null, ai: null };
  return { mainId: ids.main, aiId: ids.ai };
}


/** Legacy: the primary chat id (main pane); prefer mainId */
function getChatIdFromURL() {
  const { mainId } = getPaneIdsFromUrl();
  return mainId;
}

/** Quick boolean to tell if the AI pane is active via URL */
function isAIChatUrl() {
  const { aiId } = getPaneIdsFromUrl();
  if (aiId) return true;
  // accept other patterns used elsewhere
  const q = getUrlParams();
  return (
    location.pathname.toLowerCase().includes("ai-chat") ||
    q.get("mode") === "ai" ||
    q.get("chat") === "ai" ||
    (location.hash || "").toLowerCase().includes("ai-chat")
  );
}

/* ─────────── PANE DISCOVERY ─────────── */
/**
 * Find the RG number for a given pane.
 * @param {"main"|"ai"} pane
 * @returns {number|null}
 */
function findRG(pane) {
  const attr = pane === "ai" ? 'data-pane="ai"' : 'data-pane="main"';
  const nodes = document.querySelectorAll(`.rg-reference[id^="rg"][${attr}]`);
  for (const el of nodes) {
    const style = window.getComputedStyle(el);
    const visible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0;
    if (visible) {
      const m = el.id.match(/^rg(\d+)$/);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

/**
 * Back-compat: first visible RG (used by older code)
 * NOTE: In dual-pane, this may return main OR ai, whichever matches first.
 */
function findVisibleRG() {
  const rgElements = document.querySelectorAll('.rg-reference[id^="rg"]');
  for (const el of rgElements) {
    const style = window.getComputedStyle(el);
    if (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    ) {
      const rgMatch = el.id.match(/^rg(\d+)$/);
      if (rgMatch) return parseInt(rgMatch[1], 10);
    }
  }
  return null;
}

/** Compose a stable paneKey like "main:rg1" or "ai:rg2" from an RG element or number */
function getPaneKey(elOrRg) {
  let rgNum = null;
  let pane = "main";
  if (typeof elOrRg === "number") {
    rgNum = elOrRg;
    const el = document.getElementById(`rg${rgNum}`);
    if (el && el.dataset && el.dataset.pane === "ai") pane = "ai";
  } else if (elOrRg && elOrRg.id) {
    const m = elOrRg.id.match(/^rg(\d+)$/);
    if (m) rgNum = parseInt(m[1], 10);
    if (elOrRg.dataset && elOrRg.dataset.pane === "ai") pane = "ai";
  }
  if (rgNum == null) return null;
  return `${pane}:rg${rgNum}`;
}

/* ─────────── LANGUAGE TOGGLE ─────────── */
function switchLanguage(lang) {
  document
    .querySelectorAll(".message-text")
    .forEach((el) => (el.style.display = "none"));
  document
    .querySelectorAll(`.lang-${lang}`)
    .forEach((el) => (el.style.display = ""));
}

/* ─────────── SMOOTH SCROLL + HIGHLIGHT ─────────── */
function scrollToMessage(id) {
  const t = document.querySelector(`.message[data-id="${id}"]`);
  if (!t) return;
  t.scrollIntoView({ behavior: "smooth", block: "center" });
  t.classList.add("message-scroll-highlight");
  setTimeout(() => t.classList.remove("message-scroll-highlight"), 1200);
}

/* click an inline reply preview */
document.addEventListener("click", (e) => {
  const p = e.target.closest(".reply-scroll-target");
  if (p) {
    e.stopPropagation();
    scrollToMessage(p.dataset.targetId);
  }
});

/* ─────────── BACK-COMP findVisibleRG EXPOSURE ─────────── */
window.findVisibleRG = window.findVisibleRG || findVisibleRG;

/* Also expose pane-aware RG finder */
window.findRG = findRG;

/* ─────────── CONVENIENCE: CLEAR CHAT BY PANE ─────────── */
async function clearVisibleChatDOMOnce() {
  const rg = findVisibleRG();
  if (rg === null) return;
  const g = document.getElementById(`rg${rg}`);
  const chat = g?.querySelector(".chat-messages");
  if (!chat) return;
  while (chat.firstChild) chat.firstChild.remove();
  // also reset injector cache so inserts start fresh
  if (window.__sumizyInjectorCache) {
    window.__sumizyInjectorCache.delete?.(rg);
  }
}

/** Clear specific pane without touching the other */
function clearChatByPane(pane /* "main"|"ai" */) {
  if (pane === "ai") {
    console.info("clearChatByPane skipped for AI (preserve)");
    return;
  }
  const rg = findRG(pane);
  if (rg == null) return;
  const g = document.getElementById(`rg${rg}`);
  const chat = g?.querySelector(".chat-messages");
  if (!chat) return;
  while (chat.firstChild) chat.firstChild.remove();
  window.__sumizyInjectorCache?.delete?.(rg);
  console.info(`clearChatByPane: ${pane} (#rg${rg}) cleared`);
}


/* ─────────── EXPORTS ─────────── */
Object.assign(window, {
  DATE_LOCALE,
  parseTime,
  fmtTime,
  fmtDate,
  esc,
  agg,
  renderDivider,
  waitForElement,

  // URL helpers
  getPaneIdsFromUrl,
  getChatIdFromURL,
  isAIChatUrl,

  // Pane helpers
  findVisibleRG,
  findRG,
  getPaneKey,
  clearChatByPane,

  // Misc UI helpers
  switchLanguage,
  scrollToMessage,

  // Kept for back-compat with earlier calls
  clearVisibleChatDOMOnce,
});
