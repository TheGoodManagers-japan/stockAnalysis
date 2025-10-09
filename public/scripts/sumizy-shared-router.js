// sumizy-chat-ux-extras.js

/* ─────────── Canonical pane id resolver (query + /tickets/:id | /tasks/:id) ─────────── */
(function () {
  function deriveMainFromRoute(u) {
    // 1) query param has priority
    const qp = (u.searchParams.get("chatid") || "").trim();
    if (qp) return qp;

    // 2) pathname: /tickets/:id or /tasks/:id
    const m = (u.pathname || "").match(/\/(tickets|tasks)\/([^/?#]+)/i);
    if (!m) return null;

    const entityType = m[1].toLowerCase(); // "tickets" | "tasks"
    const entityId = m[2];

    // Optional hook: let app map entity → real conversation id (UUID)
    if (typeof window.mapEntityToConversationId === "function") {
      try {
        const conv = window.mapEntityToConversationId(entityType, entityId);
        if (conv) return String(conv);
      } catch {}
    }
    // Fallback: composite id your backend can interpret
    return `${entityType}:${entityId}`;
  }

  function getPaneIdsFromUrl() {
    let url;
    try {
      url = new URL(location.href);
    } catch {
      return { main: null, ai: null };
    }

    const ai = (url.searchParams.get("ai-chat") || "").trim() || null;
    const main = deriveMainFromRoute(url);
    return { main, ai };
  }

  // Export canonical helper (overwrites any older versions)
  window.getPaneIdsFromUrl = getPaneIdsFromUrl;

  // Optional default mapper (no-op passthrough). Replace with your own if needed.
  window.mapEntityToConversationId =
    window.mapEntityToConversationId ||
    function (type, id) {
      return `${type}:${id}`; // or call your Bubble/Xano resolver here
    };
})();
