// === Kabutan -> POST { news: [...] } every 5 min ===
// Sends only ONE body field (body_text OR body_html) to cut payload size.
// https://s.kabutan.jp/market_news/?day=15&month=9&page=1&search_archive_news=13&year=2025
// === Kabutan -> POST { news: [...] } every 5 min (JP tickers only) ===
// === Kabutan -> POST { news: [...] } every 5 min (JP tickers only; single "ticker") ===
(() => {
    const CFG = {
      listUrl: location.href,
      intervalMs: 5 * 60 * 1000,
      throttleMs: 400,
      maxPerCycle: 30,
      apiUrl: "https://thegoodmanagers.com/api/1.1/wf/kabutan",
      sendOnlyNew: true,
      bodyField: "text",   // "text" => body_text  |  "html" => body_html
      maxBodyChars: 4000,  // 0 = no truncation
      jpOnly: true         // send only articles with JP tickers (####.T)
    };
  
    // --- UI badge ---
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position: "fixed", right: "12px", bottom: "12px", zIndex: 999999,
      background: "rgba(0,0,0,0.75)", color: "#fff", font: "12px/1.4 sans-serif",
      padding: "8px 10px", borderRadius: "8px"
    });
    badge.textContent = "Kabutan auto: starting…";
    document.body.appendChild(badge);
  
    // --- helpers ---
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const normText = (el) => norm(el?.textContent || "");
    const trunc = (s, n) => (typeof s === "string" && n && n > 0 && s.length > n ? s.slice(0, n) : s);
    const htmlDecode = (s) => { const d = document.createElement("textarea"); d.innerHTML = s || ""; return d.value; };
    const toHanDigits = (s) => (s || "").replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xFF10 + 0x30));
  
    async function fetchDoc(url) {
      const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
      const html = await res.text();
      return new DOMParser().parseFromString(html, "text/html");
    }
  
    function extractList(doc) {
      const rows = [];
      const seenTmp = new Set();
      for (const li of doc.querySelectorAll("li")) {
        const a = li.querySelector('a.w-full[href^="/news/"], a[href^="/news/"]');
        if (!a) continue;
        const href = a.getAttribute("href");
        if (!href) continue;
        const url = new URL(href, location.origin).href;
        if (seenTmp.has(url)) continue;
        seenTmp.add(url);
  
        const title_ja = normText(a);
        if (!title_ja) continue;
  
        const timeEl = li.querySelector("time[datetime], time");
        const datetime = timeEl?.getAttribute?.("datetime") || normText(timeEl) || null;
        const category = normText(li.querySelector(".news_category-factor")) || null;
        const isNew = !!li.querySelector(".text-red");
  
        rows.push({ title_ja, url, category, datetime, isNew });
      }
      return rows;
    }
  
    // --- JP ticker extraction from detail doc (returns array of ####.T) ---
    function extractJPTickers(doc) {
      const out = new Set();
  
      // 0) <meta name="description" content="… ＜3397＞ …">
      const meta = doc.querySelector('meta[name="description"]')?.getAttribute("content");
      if (meta) {
        const dec = toHanDigits(htmlDecode(meta));
        (dec.match(/＜\s*([0-9]{4})\s*＞/g) || []).forEach(m => {
          const code = (m.match(/([0-9]{4})/) || [])[1];
          if (code) out.add(`${code}.T`);
        });
      }
  
      // 1) Links like /stocks/7203 or ?code=7203
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || "";
        let abs = href; try { abs = new URL(href, location.origin).href; } catch {}
        const mPathJP = abs.match(/\/stocks?\/(\d{4})(?:\/|$)/);
        if (mPathJP) out.add(`${mPathJP[1]}.T`);
        const mQueryJP = abs.match(/[?&]code=(\d{4})(?:&|$)/);
        if (mQueryJP) out.add(`${mQueryJP[1]}.T`);
      });
  
      // 2) Bracketed codes in anchor text
      doc.querySelectorAll('a').forEach(a => {
        const txt = toHanDigits(a.textContent || "").replace(/[<>\[\]［］【】()（）]/g, " ");
        const m = txt.match(/\b(\d{4})\b/);
        if (m) out.add(`${m[1]}.T`);
      });
  
      // 3) Fallback: scan whole page text
      const allText = toHanDigits(doc.body?.textContent || "");
      (allText.match(/\b(\d{4})\b/g) || []).forEach(code => out.add(`${code}.T`));
  
      return [...out];
    }
  
    async function extractArticle(url) {
      const doc = await fetchDoc(url);
      const bodyEl = doc.querySelector(".news-body");
  
      let body_text = null, body_html = null;
      if (bodyEl) {
        if (CFG.bodyField === "text") {
          const paras = [...bodyEl.querySelectorAll("p")];
          body_text = paras.map(p => p.textContent.trim()).filter(Boolean).join(" ");
          body_text = trunc(body_text, CFG.maxBodyChars);
        } else {
          body_html = trunc(bodyEl.innerHTML.trim(), CFG.maxBodyChars);
        }
      }
  
      const artTimeEl = doc.querySelector("article time[datetime], time[datetime]");
      const article_datetime = artTimeEl?.getAttribute?.("datetime") || null;
  
      const tickers = extractJPTickers(doc); // array of ####.T
  
      let footer = null;
      if (bodyEl) {
        const paras = [...bodyEl.querySelectorAll("p")];
        footer = paras.slice(-3).map(p => p.textContent.trim()).filter(Boolean).join(" / ") || null;
        footer = trunc(footer, 800);
      }
  
      return { body_text, body_html, article_datetime, tickers, footer };
    }
  
    async function sendPayload(items) {
      // choose the FIRST JP ticker (####.T) and send it as "ticker"
      const sanitized = items.map(x => {
        const ticker = Array.isArray(x.tickers)
          ? x.tickers.find(t => /^\d{4}\.T$/.test(t)) || null
          : null;
  
        const o = {
          title_ja: x.title_ja ?? null,
          url: x.url ?? null,
          category: x.category ?? null,
          datetime: x.datetime ?? null,
          isNew: !!x.isNew,
          article_datetime: x.article_datetime ?? null,
          ticker,                    // << single string field
          footer: x.footer ?? null
        };
        if (CFG.bodyField === "text") o.body_text = x.body_text ?? null;
        else o.body_html = x.body_html ?? null;
        return o;
      });
  
      const payload = { news: sanitized };
  
      try {
        const res = await fetch(CFG.apiUrl, {
          method: "POST",
          mode: "cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) console.warn("POST failed, status:", res.status);
      } catch (e) {
        console.warn("POST error (maybe CORS). Falling back to no-cors.");
        try {
          await fetch(CFG.apiUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: JSON.stringify(payload)
          });
        } catch (e2) {
          console.error("Fallback POST failed:", e2.message);
        }
      }
    }
  
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  
    // state
    window.kabutanSeen = window.kabutanSeen || new Set();
    window.kabutanStop && window.kabutanStop();
    let running = false;
  
    async function cycle() {
      if (running) return;
      running = true;
  
      try {
        const listDoc = await fetchDoc(CFG.listUrl);
        const list = extractList(listDoc);
  
        const candidates = CFG.sendOnlyNew ? list.filter(x => !window.kabutanSeen.has(x.url)) : list;
        const targets = candidates.slice(0, CFG.maxPerCycle);
  
        for (let i = 0; i < targets.length; i++) {
          try { Object.assign(targets[i], await extractArticle(targets[i].url)); } catch {}
          if (i < targets.length - 1) await wait(CFG.throttleMs);
        }
  
        targets.forEach(x => window.kabutanSeen.add(x.url));
  
        // keep only those with at least one JP ticker (####.T)
        const jpTargets = CFG.jpOnly
          ? targets.filter(x => Array.isArray(x.tickers) && x.tickers.some(t => /^\d{4}\.T$/.test(t)))
          : targets;
  
        if (jpTargets.length) {
          console.table(jpTargets.map(r => ({
            title_ja: r.title_ja.slice(0, 40),
            ticker: (r.tickers || []).find(t => /^\d{4}\.T$/.test(t)) || "",
            list_time: r.datetime,
            article_time: r.article_datetime,
            url: r.url
          })));
          await sendPayload(jpTargets);
          badge.textContent = `Kabutan auto: sent ${jpTargets.length} JP item(s) • next in ${Math.round(CFG.intervalMs/60000)}m`;
        } else {
          badge.textContent = `Kabutan auto: no JP items • next in ${Math.round(CFG.intervalMs/60000)}m`;
        }
      } catch (e) {
        console.error("Cycle error:", e);
        badge.textContent = "Kabutan auto: error (see console)";
      } finally {
        running = false;
      }
    }
  
    // start & schedule
    cycle();
    const timer = setInterval(cycle, CFG.intervalMs);
    window.kabutanStop = () => { clearInterval(timer); badge.textContent = "Kabutan auto: stopped"; };
    console.log("▶️ Running (JP tickers only, single 'ticker'). To stop: kabutanStop()");
  })();
  