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
  