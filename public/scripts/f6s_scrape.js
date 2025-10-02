// SAFE RERUN: sets window.f6s_raw incrementally, enriches, and downloads JSON.
// Limiting to first 5 items. Paste on the LISTING page.
// url: https://www.f6s.com/programs?type[]=accelerator&sort=open
// Paste in DevTools console on the LISTING page.
// Scrapes first 5 items, loads About pages via hidden iframes, enriches locally,
// saves to window.f6s_raw/window.f6s_enriched, downloads JSON, and POSTs to your webhook.
// Paste in DevTools console on the LISTING page.
// Scrapes first 5 items, loads each About page via hidden iframes,
// enriches locally, and POSTs EACH ENRICHED PROGRAM immediately
// to your endpoint (no auth). Also keeps local copies and downloads a file.
// Paste in DevTools on the LISTING page.
// Scrapes first 5, opens each About page in a hidden iframe, enriches,
// and POSTs EACH item immediately to your endpoint (no auth).
// parsed.mode is normalized to: "Hybrid" | "Online" | "Offline".
// Paste on the F6S LISTING page (e.g. https://www.f6s.com/programs?type[]=accelerator&sort=open)
// Sends EACH item immediately to your API. No downloads.

(() => {
    'use strict';
    
    (async () => {
      /* ===== Config ===== */
      const WEBHOOK_URL =
        "https://sccopy-38403.bubbleapps.io/version-42lqm/api/1.1/wf/receive-programs/initialize";
      const POST_WRAPPER_KEY = "programs";
      const MAX_ITEMS = 1;
    
      /* ===== Tiny utils ===== */
      const $$  = (root, sel) => Array.from((root || document).querySelectorAll(sel));
      const $1  = (root, sel) => (root || document).querySelector(sel);
      const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
      const attr = (el, name) => (el ? el.getAttribute(name) || "" : "");
      const absUrl = (href) => (href ? new URL(href, location.href).href : "");
      const toKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const rand = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
    
      // JST date helpers
      const MS_DAY=86400000, JST=9*3600000;
      const jstStartOfDayEpoch = (ms=Date.now()) => Math.floor((ms+JST)/MS_DAY)*MS_DAY - JST;
      const jstEpochFromYMD = (y,m0,d) => Date.UTC(y,m0,d) - JST;
      const toISO = (d) => d ? new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10) : null;
    
      const MONTH = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const monthIndex = (s) => s ? MONTH[String(s).slice(0,3).toLowerCase()] ?? null : null;
    
      const titleFromAnchor = (a) => {
        if (!a) return "";
        const nodes = Array.from(a.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => (n.textContent || "").trim())
          .filter(Boolean);
        const t = nodes.join(" ").replace(/\s+/g, " ").trim();
        return t || a.innerText.replace(/\s+/g, " ").trim();
      };
      const parseSubtitle = (raw) => {
        const parts = (raw || "").split("•").map(s=>s.trim());
        return { dates_text: parts[0] || "", location: parts[1] || "" };
      };
      const parseDeadline = (item) => {
        const desktop = text($1(item, ".organization-picture .data-overlay"));
        const mobile  = text($1(item, ".result-action .only-mobile"));
        return (desktop || mobile || "").replace(/^\s*by\s*/i, "").trim();
      };
      const pick2x = (img) => {
        const ss = attr(img, "srcset"); if (!ss) return "";
        const cand = ss.split(",").map(s=>s.trim()).find(s=>/\s2x$/i.test(s));
        return cand ? (cand.split(/\s+/)[0] || "") : "";
      };
    
      // Iframe loader + hydration waiters
      const waitForAny = (doc, selectors, {timeout=20000, poll=200}={}) =>
        new Promise((resolve, reject) => {
          const t0 = Date.now();
          const tick = () => {
            for (const sel of selectors) {
              const el = doc.querySelector(sel);
              if (el) return resolve({ sel, el });
            }
            if (Date.now() - t0 >= timeout) return reject(new Error(`Timeout waiting for any: ${selectors.join(", ")}`));
            setTimeout(tick, poll);
          };
          tick();
        });
      const observeFor = (doc, selectors, {timeout=8000}={}) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => { obs.disconnect(); reject(new Error("Observer timeout")); }, timeout);
          const obs = new MutationObserver(() => {
            for (const sel of selectors) {
              if (doc.querySelector(sel)) { clearTimeout(timer); obs.disconnect(); return resolve(sel); }
            }
          });
          obs.observe(doc, { childList: true, subtree: true });
        });
      const loadInIframe = (url) => new Promise((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.left = "-20000px";
        iframe.style.top = "0";
        iframe.style.width = "1400px";
        iframe.style.height = "2000px";
        iframe.src = url;
        iframe.addEventListener("load", () => resolve(iframe), { once: true });
        iframe.addEventListener("error", () => reject(new Error(`Failed to load: ${url}`)), { once: true });
        document.body.appendChild(iframe);
      });
    
      // About-page scraper
      const scrapeAboutDoc = (doc) => {
        const root = doc.querySelector(".tile.standard-overview") || doc;
    
        const overview = {};
        root.querySelectorAll(".benefits--container .info-wrapper").forEach((w) => {
          const value = text(w.querySelector(".b18")) || text(w.querySelector(".b18.tight"));
          const label = text(w.querySelector(".b14"));
          if (label) overview[toKey(label)] = value;
        });
    
        const description =
          text(root.querySelector(".description-wrapper > div")) ||
          text(root.querySelector(".description-wrapper"));
    
        const investment_stats = Array.from(root.querySelectorAll(".description-wrapper li.investment-block"))
          .map((li) => ({ text: text(li), images: Array.from(li.querySelectorAll("img")).map(img => img.src) }))
          .filter(x => x.text);
    
        const header = Array.from(root.querySelectorAll(".mb8"))
          .find(el => /looking\s+for\s+companies/i.test(el.textContent || ""));
        let categories = [], cities = [], other_filters = [];
        if (header) {
          const ul = header.nextElementSibling;
          if (ul && ul.matches("ul")) {
            ul.querySelectorAll("li").forEach((li) => {
              const raw = text(li);
              if (/^in\s/i.test(raw)) {
                categories = Array.from(li.querySelectorAll("a")).map(a=>text(a)).filter(Boolean);
              } else if (/^located in\s/i.test(raw)) {
                cities = Array.from(li.querySelectorAll("a")).map((a) => {
                  const t = text(a); const m = t.match(/^(.*?)\s*\((.*?)\)$/);
                  return m ? { city: m[1], country: m[2] } : { label: t };
                });
              } else if (raw) {
                other_filters.push(raw);
              }
            });
          }
        }
        return { overview, description, investment_stats, categories, cities, other_filters };
      };
    
      // Build listing
      const rows = $$(document, "#csResultsBlock .bordered-list-item.result-item");
      if (!rows.length) { console.warn("No .result-item rows found."); return; }
    
      const listing = rows.map((item, idx) => {
        const orgLinkA  = $1(item, ".organization-picture a");
        const img       = $1(item, ".organization-picture img");
        const titleA    = $1(item, ".result-description .title a");
        const moreInfoA = $1(item, ".result-action .t14 a");
        const applyA    = $1(item, ".result-action .t18r a");
    
        const subtitle  = parseSubtitle(text($1(item, ".result-description .subtitle")));
        const details   = text($1(item, ".result-description .details span"));
        const verified  = !!$1(item, ".verified-badge");
        const about_link = absUrl(attr(titleA, "href") || attr(moreInfoA, "href"));
    
        return {
          _index: idx,
          title: titleFromAnchor(titleA),
          verified,
          dates_text: subtitle.dates_text,
          location: subtitle.location,
          details,
          deadline_text: parseDeadline(item),
          profile_link: absUrl(attr(orgLinkA, "href")),
          about_link,
          more_info_link: absUrl(attr(moreInfoA, "href")),
          apply_link: absUrl(attr(applyA, "href")),
          image_src: attr(img, "src") || "",
          image_src_2x: pick2x(img),
          source_url: location.href
        };
      });
    
      const targets = listing.slice(0, MAX_ITEMS);
    
      // Namespaced state (won't collide on reruns)
      window.__sc__raw = window.__sc__raw || [];
      window.__sc__enriched = window.__sc__enriched || [];
      const rawBuf = window.__sc__raw;
      const enrichedBuf = window.__sc__enriched;
    
      /* ===== Enrichment helpers ===== */
      const programType = (title) => {
        const t = (title || "").toLowerCase();
        if (/\bexpo\b/.test(t)) return "expo";
        if (/\bopen\s*call\b/.test(t)) return "open_call";
        if (/\bchallenge|competition|grant\b/.test(t)) return "competition/grant";
        return "accelerator";
      };
      const parseYear = (title, deadlineText) => {
        const y = (title || "").match(/\b(20\d{2})\b/); if (y) return +y[1];
        const m = (deadlineText || "").match(/([A-Za-z]{3,})\s*(\d{1,2})/);
        if (m) {
          const mi = monthIndex(m[1]); const dd = +m[2]; const now = new Date();
          const guess = new Date(now.getFullYear(), mi ?? now.getMonth(), dd || 1);
          const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 31);
          return guess < cutoff ? now.getFullYear() + 1 : now.getFullYear();
        }
        return new Date().getFullYear();
      };
      const parseSingle = (txt, y) => {
        const m = (txt || "").match(/([A-Za-z]{3,})\s*(\d{1,2})/);
        if (!m) return null;
        const mi = monthIndex(m[1]); const d = +m[2];
        return (mi==null || !d) ? null : new Date(y, mi, d);
      };
      const parseRange = (txt, y) => {
        if (!txt) return { start: null, end: null };
        const m = txt.match(/([A-Za-z]{3,})\s*(\d{1,2})\s*-\s*([A-Za-z]{3,})\s*(\d{1,2})/);
        if (!m) { const s=parseSingle(txt,y); return { start:s, end:s }; }
        let m1=monthIndex(m[1]), d1=+m[2], m2=monthIndex(m[3]), d2=+m[4];
        if (m1==null || m2==null) return { start: null, end: null };
        let y1=y, y2=y; if (m2 < m1) y2 = y1 + 1;
        return { start: new Date(y1, m1, d1), end: new Date(y2, m2, d2) };
      };
      const money = (s) => {
        if (!s) return null;
        const m = String(s).match(/([$€£])\s*([\d.,]+)\s*([kKmM])?/);
        if (!m) return null;
        const num = parseFloat(m[2].replace(/,/g,""));
        const scale=(m[3]||"").toLowerCase();
        return { currency:m[1], amount: Math.round(num * (scale==="m"?1_000_000:scale==="k"?1_000:1)) };
      };
    
      // Normalize to: Hybrid | Online | Offline
      const computeMode = (locText, fallbackLocation) => {
        const t = (locText || fallbackLocation || "").toLowerCase();
        const hasOnline  = /\b(virtual|online|remote|zoom|webinar)\b/.test(t);
        const hasOffline = /\b(in[\s-]?person|onsite|on[\s-]?site|in[-\s]?person)\b/.test(t)
                        || /[a-z],\s*[a-z]/i.test(t)
                        || /\b(united|kingdom|states|india|japan|france|germany|morocco|belgium|canada|australia)\b/.test(t);
        if (/\bhybrid\b/.test(t) || (hasOnline && hasOffline)) return "Hybrid";
        if (hasOnline && !hasOffline) return "Online";
        if (hasOffline && !hasOnline) return "Offline";
        return /,/.test(t) ? "Offline" : "Offline";
      };
    
      const isFreeCost = (cost) => /^\s*\$?\s*0(\.0+)?\s*$/i.test((cost||"").trim());
    
      /* ===== POST helper (send one now) ===== */
      async function postOne(item, { seq, total }) {
        const endpoint = WEBHOOK_URL.replace(/\s+/g, ""); // sanitize spaces
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
    
        const body = {};
        body[POST_WRAPPER_KEY] = item;
        body.meta = { source: location.href, count: 1, seq, total, sent_at: new Date().toISOString() };
    
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            mode: "cors",
            credentials: "omit",
            signal: controller.signal
          });
          clearTimeout(timer);
    
          const txt = await res.text().catch(()=> "");
          let payload = null; try { payload = JSON.parse(txt); } catch { payload = { raw: txt }; }
          if (res.ok) console.info(`✅ Sent [${seq}/${total}] ${item.title} — ${res.status}`, payload);
          else console.warn(`⚠️ Send failed [${seq}/${total}] — ${res.status}`, payload);
          return { ok: res.ok, status: res.status, payload };
        } catch (err) {
          clearTimeout(timer);
          console.warn(`⚠️ Send error [${seq}/${total}]`, String(err?.message || err));
          return { ok: false, status: 0, error: String(err?.message || err) };
        }
      }
    
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        if (enrichedBuf.some(x => x.profile_link === row.profile_link)) {
          console.log(`⏭️  Already processed: ${row.title}`);
          continue;
        }
    
        const out = { ...row };
        await sleep(rand(300, 800));
        console.log(`🔎 [${i+1}/${targets.length}] Load: ${row.about_link}`);
    
        const tryOnce = async () => {
          const iframe = await loadInIframe(row.about_link);
          const doc = iframe.contentDocument || iframe.contentWindow.document;
    
          try {
            const btn = Array.from(doc.querySelectorAll("button, .btn, .ot-sdk-container button"))
              .find(b => /accept|agree|consent/i.test(b.textContent || ""));
            if (btn) btn.click();
          } catch {}
    
          for (let y of [0, 400, 1000, 1600]) {
            try { iframe.contentWindow.scrollTo(0, y); } catch {}
            await sleep(150);
          }
    
          const targetsSel = [
            ".tile.standard-overview",
            ".benefits--container",
            ".description-wrapper",
            ".investment-block",
            ".bullets-display"
          ];
          try { await waitForAny(doc, targetsSel, { timeout: 25000, poll: 250 }); }
          catch { try { await observeFor(doc, targetsSel, { timeout: 8000 }); } catch {} }
    
          const extra = scrapeAboutDoc(doc);
          iframe.remove();
          return extra;
        };
    
        try {
          let extra = await tryOnce();
          const empty = Object.keys(extra.overview||{}).length === 0 &&
                        !extra.description &&
                        (!extra.investment_stats || extra.investment_stats.length === 0) &&
                        (!extra.categories || extra.categories.length === 0);
          if (empty) {
            console.log("↻ Retrying once (late hydration)...");
            await sleep(600);
            extra = await tryOnce();
          }
          Object.assign(out, extra);
        } catch (e) {
          out._about_error = String(e?.message || e);
        }
    
        // save raw
        rawBuf.push(out);
        window.__sc__raw = rawBuf;
    
        // enrich one
        const year = parseYear(out.title, out.deadline_text);
        const { start, end } = parseRange(out.dates_text, year);
        const deadline = parseSingle(out.deadline_text, year);
        const fundedPerYear = parseInt((out.overview?.funded_per_year || "").replace(/[^\d]/g,"") || "0", 10);
        const sampleFunding = money(out.investment_stats?.[0]?.text) || money(out.description) || null;
        const equity_required = /no\s*equity/i.test(out.description || "") ? false : null;
        const gives_funding = /funds/i.test(out.details || "") || !!sampleFunding || /grant/i.test(JSON.stringify(out.overview || {}));
        const mode = computeMode(out.overview?.location, out.location);
        const is_free = isFreeCost(out.overview?.cost || "");
        const slug = (out.profile_link || "").split("/").filter(Boolean).pop();
        const todayJst = jstStartOfDayEpoch();
        const deadlineJst = deadline ? jstEpochFromYMD(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()) : null;
        const days_to_deadline = (deadlineJst != null) ? Math.floor((deadlineJst - todayJst)/MS_DAY) : null;
    
        const enrichedOne = {
          ...out,
          parsed: {
            slug,
            program_type: programType(out.title),
            cohort_year: year,
            season: ((out.title || "").match(/\b(Spring|Summer|Fall|Autumn|Winter)\b/i)?.[1] || null),
            start_date: toISO(start),
            end_date: toISO(end),
            duration_days: (start && end) ? Math.round((end - start) / MS_DAY) + 1 : null,
            duration_weeks: (start && end) ? +(((end - start) / MS_DAY + 1) / 7).toFixed(1) : null,
            application_deadline: toISO(deadline),
            days_to_deadline,
            is_open: (days_to_deadline != null) ? (days_to_deadline >= 0) : null,
            mode, // "Hybrid" | "Online" | "Offline"
            cities_count: out.cities?.length || 0,
            is_free,
            equity_required,
            gives_funding,
            funded_per_year_int: fundedPerYear,
            sample_funding: sampleFunding,
            primary_sector: out.categories?.[0] || null,
            dedupe_key: [slug, year, ((out.title||"").match(/\b(Spring|Summer|Fall|Autumn|Winter)\b/i)?.[1]||"")].join("_").toLowerCase(),
            scraped_at: new Date().toISOString(),
            parse_version: "v1.6-no-llm"
          }
        };
    
        // save enriched and POST
        enrichedBuf.push(enrichedOne);
        window.__sc__enriched = enrichedBuf;
        await postOne(enrichedOne, { seq: i+1, total: targets.length });
      }
    
      // Summary only
      console.table(window.__sc__enriched.map(e => ({
        title: e.title,
        type: e.parsed?.program_type,
        mode: e.parsed?.mode,
        deadline: e.parsed?.application_deadline,
        daysLeftJST: e.parsed?.days_to_deadline,
        start: e.parsed?.start_date,
        end: e.parsed?.end_date,
        weeks: e.parsed?.duration_weeks,
        free: e.parsed?.is_free,
        funding: e.parsed?.sample_funding?.amount ?? "",
        perYear: e.parsed?.funded_per_year_int ?? ""
      })));
    })();
    })();