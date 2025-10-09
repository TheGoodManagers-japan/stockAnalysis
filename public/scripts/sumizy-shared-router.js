// sumizy-shared-router.js
// Canonical, single source of truth for pane IDs.
// Exposes: window.getPaneIdsFromUrl() -> { main, ai }
// Optional hook: window.mapEntityToConversationId(type, id) -> conversationId

(function () {
  // Allow the app to override this hook at boot if you have a real resolver.
  const mapEntityToConversationId =
    window.mapEntityToConversationId ||
    function defaultMap(type, id) {
      // Return a real conversation UUID if you can; otherwise composite is fine.
      return `${type}:${id}`;
    };

  const ENTITY_KEYS = [
    "messaging",
    "messages",
    "discussions",
    "discussion",
    "tickets",
    "tasks",
  ];

  function safeURL(href) {
    try {
      return new URL(href, location.origin);
    } catch {
      return null;
    }
  }

  function normId(s) {
    if (!s) return null;
    try {
      s = decodeURIComponent(String(s));
    } catch {}
    // strip trailing slash or stray query/hash
    s = s.replace(/[/?#].*$/, "");
    return s || null;
  }

  function pickFromQuery(u, key) {
    const v = u?.searchParams?.get?.(key);
    return normId(v || "");
  }

  // Try to derive a main conversation id from pathname segments
  function deriveMainFromPath(u) {
    if (!u) return null;
    const path = (u.pathname || "").replace(/\/+/g, "/").toLowerCase();

    // Match /{entity}/{id} or /app/{anything}/{entity}/{id}
    // We scan segments to find the **last** entity occurrence with a following id
    const segs = path.split("/").filter(Boolean); // remove empty
    for (let i = 0; i < segs.length - 1; i++) {
      if (ENTITY_KEYS.includes(segs[i])) {
        const rawId = normId(segs[i + 1]);
        if (rawId) {
          const type = segs[i]; // already lowercased
          try {
            const mapped = mapEntityToConversationId(type, rawId);
            if (mapped) return String(mapped);
          } catch {
            // fall through to composite
          }
          return `${type}:${rawId}`;
        }
      }
    }
    return null;
  }

  // Legacy/fallbacks in query params like ?ticket=123 or ?task=abc
  function deriveMainFromQuery(u) {
    if (!u) return null;
    for (const k of ["ticket", "task", "discussion", "messages", "messaging"]) {
      const v = pickFromQuery(u, k);
      if (v) {
        const type = k.endsWith("s") ? k.slice(0, -1) : k; // messages->message (we’ll normalize below)
        const entity =
          type === "message"
            ? "messages"
            : type === "discussion"
            ? "discussions"
            : type === "ticket"
            ? "tickets"
            : type === "task"
            ? "tasks"
            : type;
        try {
          const mapped = mapEntityToConversationId(entity, v);
          if (mapped) return String(mapped);
        } catch {}
        return `${entity}:${v}`;
      }
    }
    return null;
  }

  // Derive AI pane id
  function deriveAIFromUrl(u) {
    if (!u) return null;

    // 1) explicit query
    const fromQuery = pickFromQuery(u, "ai-chat");
    if (fromQuery) return fromQuery;

    // 2) path variants: /ai/:id or /ai-chat/:id
    const segs = (u.pathname || "").split("/").filter(Boolean);
    for (let i = 0; i < segs.length - 1; i++) {
      if (
        segs[i].toLowerCase() === "ai" ||
        segs[i].toLowerCase() === "ai-chat"
      ) {
        const raw = normId(segs[i + 1]);
        if (raw) return raw;
      }
    }

    // 3) hash like #ai-chat=xyz
    const m = (u.hash || "").match(/ai-chat=([^&]+)/i);
    if (m) return normId(m[1]);

    return null;
  }

  function getPaneIdsFromUrlCanonical() {
    const u = safeURL(location.href);
    if (!u) return { main: null, ai: null };

    // Priority for MAIN:
    //   1) ?chatid=<id>
    //   2) path entities (/discussions/:id, /tickets/:id, /tasks/:id, /messages/:id, /messaging/:id)
    //   3) query fallbacks (?ticket=..., ?task=..., ...)
    const chatid = pickFromQuery(u, "chatid");
    const main =
      chatid || deriveMainFromPath(u) || deriveMainFromQuery(u) || null;

    // AI id
    const ai = deriveAIFromUrl(u);

    return { main, ai };
  }

  // Export the canonical resolver (single source of truth)
  window.getPaneIdsFromUrl = getPaneIdsFromUrlCanonical;

  // Re-expose hook so the app can set a real mapper later without touching this file
  if (!window.mapEntityToConversationId) {
    window.mapEntityToConversationId = mapEntityToConversationId;
  }
})();
