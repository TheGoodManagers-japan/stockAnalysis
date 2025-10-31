(() => {
  "use strict";

  (async () => {
    /* ===== Config ===== */
    const WEBHOOK_URL =
      "https://sccopy-38403.bubbleapps.io/version-32etr/api/1.1/wf/receive-programs";
    const MAX_ITEMS = 1000;

    // Always send (don't skip on missing)
    const FORCE_POST = true;

    // Validation rules
    const REQUIRED_FIELDS = [
      "program_title",
      "program_start_date",
      "program_end_date",
      "program_location", // Online|Offline|Hybrid
      "program_description",
      "program_application_deadline",
      "apply_link",
      "organizer_name",
      "program_cost_usd", // number (0 allowed)
    ];
    const REQUIRE_AT_LEAST_ONE_IMAGE = true;

    /* ===== Live FX setup ===== */

    // Minimal static fallback (used only if the API fails)
    const FX_META = { as_of: "live-or-fallback" };
    let FX_RATES_TO_USD = {
      USD: 1,
      EUR: 1.07,
      GBP: 1.25,
      JPY: 0.0065, // ~ placeholder
    };

    // Map common prefixes & symbols to ISO codes
    const CURR_PREFIX_MAP = {
      C$: "CAD",
      CA$: "CAD",
      A$: "AUD",
      NZ$: "NZD",
      S$: "SGD",
      HK$: "HKD",
      $: "USD",
      "€": "EUR",
      "£": "GBP",
      "¥": "JPY", // Note: also used for CNY in some contexts; we default to JPY here
      "₩": "KRW",
      "₹": "INR",
      R$: "BRL",
      "₽": "RUB",
      "₺": "TRY",
      zł: "PLN",
    };

    // Load live rates (USD base) from exchangerate.host
    async function loadFxRates() {
      const url = "https://api.exchangerate.host/latest?base=USD";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("FX HTTP " + res.status);
        const data = await res.json();
        if (!data || !data.rates) throw new Error("FX invalid payload");
        // data.rates: quote is how many <CURRENCY> per USD (e.g., EUR=0.93 means 1 USD = 0.93 EUR)
        // To convert X (in CCY) -> USD: USD = X / (rates[CCY])
        // We'll store USD_per_CCY directly for convenience.
        const m = {};
        m["USD"] = 1;
        for (const [ccy, quotePerUSD] of Object.entries(data.rates)) {
          if (!quotePerUSD || !isFinite(quotePerUSD)) continue;
          m[ccy.toUpperCase()] = 1 / quotePerUSD; // USD per 1 CCY
        }
        FX_RATES_TO_USD = m;
        console.log("💱 FX loaded", {
          base: "USD",
          sample: Object.fromEntries(Object.entries(m).slice(0, 8)),
        });
      } catch (e) {
        clearTimeout(timer);
        console.warn("⚠️ FX fallback (using static)", String(e?.message || e));
      }
    }

    // Run FX load early (non-blocking for the rest of the scrape)
    await loadFxRates();

    /* ===== Tiny utils ===== */

    // Ensure end date is not before start date (only if both exist)
    const ensureEndNotBeforeStart = (start, end) => {
      if (!start || !end) return { start, end };
      const aligned = new Date(end.getTime());
      aligned.setFullYear(start.getFullYear());
      let fixed = aligned;
      if (aligned < start) {
        fixed = new Date(aligned.getTime());
        fixed.setFullYear(aligned.getFullYear() + 1);
      }
      if (fixed < start) fixed = new Date(start.getTime());
      return { start, end: fixed };
    };

    const _str = (v) => (typeof v === "string" ? v.trim() : "");
    const applyAddressFallbacks = (rec) => {
      const prog = _str(rec.program_address);
      const org = _str(rec.organizer_address);
      if (!prog && org) rec.program_address = org;
      if (!org && prog) rec.organizer_address = prog;
      return rec;
    };

    const safeJsonParse = (s) => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };
    const $$ = (root, sel) =>
      Array.from((root || document).querySelectorAll(sel));
    const $1 = (root, sel) => (root || document).querySelector(sel);
    const text = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
    const attr = (el, name) => (el ? el.getAttribute(name) || "" : "");
    const absUrl = (href) => (href ? new URL(href, location.href).href : "");
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

    const htmlToText = (html) => {
      const h = String(html || "");
      const withBreaks = h
        .replace(/<\s*br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<li[^>]*>/gi, "- ")
        .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)");
      const tmp = document.createElement("div");
      tmp.innerHTML = withBreaks;
      return (tmp.textContent || tmp.innerText || "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    };

    const toISO = (d) =>
      d
        ? new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 10)
        : "";

    const MONTH = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const monthIndex = (s) =>
      s ? MONTH[String(s).slice(0, 3).toLowerCase()] ?? null : null;

    const titleFromAnchor = (a) => {
      if (!a) return "";
      const nodes = Array.from(a.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean);
      const t = nodes.join(" ").replace(/\s+/g, " ").trim();
      return t || a.innerText.replace(/\s+/g, " ").trim();
    };
    const parseSubtitle = (raw) => {
      const parts = (raw || "").split("•").map((s) => s.trim());
      return { dates_text: parts[0] || "", location: parts[1] || "" };
    };
    const parseDeadline = (item) => {
      const desktop = text($1(item, ".organization-picture .data-overlay"));
      const mobile = text($1(item, ".result-action .only-mobile"));
      return (desktop || mobile || "")
        .replace(/^\s*(?:by|deadline:?)\s*/i, "")
        .trim();
    };
    const pick2x = (img) => {
      const ss = attr(img, "srcset");
      if (!ss) return "";
      const cand = ss
        .split(",")
        .map((s) => s.trim())
        .find((s) => /\s2x$/i.test(s));
      return cand ? cand.split(/\s+/)[0] || "" : "";
    };

    /* ===== Money (+ live FX) ===== */

    // Parse amounts like:
    // - "C$17k", "CA$ 20,000", "A$5k", "HK$ 12k", "$ 5k", "€1.2m", "£750k", "¥120k"
    // - "AUD 5k", "EUR 12,000"  (leading ISO)
    // - "17k CAD", "12,000 EUR" (trailing ISO)
    function moneyAny(s) {
      if (!s) return null;
      const raw = String(s).replace(/\s+/g, " ").trim();
      const scaleToN = (ch) => {
        const t = (ch || "").toLowerCase();
        return t === "k" ? 1e3 : t === "m" ? 1e6 : t === "b" ? 1e9 : 1;
      };

      // 1) Prefixed symbols (C$, CA$, A$, NZ$, S$, HK$, $, €, £, ¥, ₩, ₹, R$, ₽, ₺, zł)
      const prefixRe = new RegExp(
        `^\\s*(${Object.keys(CURR_PREFIX_MAP)
          .map((x) => x.replace(/[$]/g, "\\$"))
          .join("|")})\\s*([\\d.,]+)\\s*([kKmMbB])?\\b`
      );
      let m = raw.match(prefixRe);
      if (m) {
        const code = CURR_PREFIX_MAP[m[1]];
        const num = parseFloat(m[2].replace(/,/g, ""));
        if (!isFinite(num)) return null;
        return {
          currencyCode: code,
          amount: Math.round(num * scaleToN(m[3])),
          raw,
        };
      }

      // 2) Leading ISO code: "AUD 5k", "EUR 12,000"
      m = raw.match(/^\s*([A-Z]{3})\s*([\d.,]+)\s*([kKmMbB])?\b/);
      if (m) {
        const code = m[1].toUpperCase();
        const num = parseFloat(m[2].replace(/,/g, ""));
        if (!isFinite(num)) return null;
        return {
          currencyCode: code,
          amount: Math.round(num * scaleToN(m[3])),
          raw,
        };
      }

      // 3) Trailing ISO code: "17k CAD", "12,000 EUR"
      m = raw.match(/^\s*([\d.,]+)\s*([kKmMbB])?\s*([A-Z]{3})\b/);
      if (m) {
        const code = m[3].toUpperCase();
        const num = parseFloat(m[1].replace(/,/g, ""));
        if (!isFinite(num)) return null;
        return {
          currencyCode: code,
          amount: Math.round(num * scaleToN(m[2])),
          raw,
        };
      }

      // 4) Symbol-only: "$ 5k", "€ 2.5m", "£ 10,000", "¥ 120k"
      m = raw.match(/^\s*([€£¥₩₹$])\s*([\d.,]+)\s*([kKmMbB])?\b/);
      if (m) {
        const sym = m[1];
        const code = CURR_PREFIX_MAP[sym] || (sym === "$" ? "USD" : null);
        if (!code) return null;
        const num = parseFloat(m[2].replace(/,/g, ""));
        if (!isFinite(num)) return null;
        return {
          currencyCode: code,
          amount: Math.round(num * scaleToN(m[3])),
          raw,
        };
      }

      return null;
    }

    function convertToUSD(obj) {
      if (!obj) return null;
      const code = (obj.currencyCode || "").toUpperCase();
      const rate = FX_RATES_TO_USD[code];
      if (!rate || !isFinite(rate)) {
        // Unknown currency code in current rate table → return null (let caller decide fallback)
        return null;
      }
      return {
        currency: "USD",
        amount: Math.round(obj.amount * rate),
        rate_used: rate,
        from_currency: code,
        meta: FX_META,
      };
    }

    // Equity (% max) parser
    const parseEquityMaxPercent = (s) => {
      if (!s) return null;
      const t = String(s).toLowerCase();
      const pctNums = (str) =>
        (str.match(/(\d+(?:\.\d+)?)\s*%/g) || []).map((x) => parseFloat(x));
      const range = t.match(
        /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*%/
      );
      if (range) return Math.max(parseFloat(range[1]), parseFloat(range[2]));
      const upTo = t.match(/up\s*to\s*(\d+(?:\.\d+)?)\s*%/);
      if (upTo) return +upTo[1];
      const le = t.match(/(?:≤|<=|max(?:imum)?\s*)\s*(\d+(?:\.\d+)?)\s*%/);
      if (le) return +le[1];
      const singles = pctNums(t);
      return singles.length ? Math.max(...singles) : null;
    };

    // Mode normalizer → "Online" | "Offline" | "Hybrid" | ""
    const normalizeMode = (s) => {
      const t = (s || "").toLowerCase();
      if (!t) return "";
      const hasVirtual = /\bvirtual\b/.test(t);
      const hasRemote = /\bremote\b/.test(t);
      const hasOnline = /\bon[-\s]?line\b/.test(t) || hasVirtual || hasRemote;
      const hasInPerson =
        /\bin\s*person\b|\bin-person\b|\bon\s*site\b|\bonsite\b|\boffline\b|\bon\s*campus\b|\bcampus\b/.test(
          t
        );
      if (hasOnline && hasInPerson) return "Hybrid";
      if (hasOnline) return "Online";
      if (hasInPerson) return "Offline";
      return "Online";
    };

    // Validation helpers
    const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
    const isDateYYYYMMDD = (v) =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const isNumberOrZero = (v) => typeof v === "number" && !Number.isNaN(v);
    const validateRecord = (rec) => {
      const missing = [];
      for (const key of REQUIRED_FIELDS) {
        const v = rec[key];
        if (key === "program_cost_usd") {
          if (!isNumberOrZero(v)) missing.push(key);
          continue;
        }
        if (!isNonEmptyString(v)) missing.push(key);
      }
      if (
        isNonEmptyString(rec.program_start_date) &&
        !isDateYYYYMMDD(rec.program_start_date)
      )
        missing.push("program_start_date(format)");
      if (
        isNonEmptyString(rec.program_end_date) &&
        !isDateYYYYMMDD(rec.program_end_date)
      )
        missing.push("program_end_date(format)");
      if (
        isNonEmptyString(rec.program_application_deadline) &&
        !isDateYYYYMMDD(rec.program_application_deadline)
      )
        missing.push("program_application_deadline(format)");
      const allowedModes = new Set(["Online", "Offline", "Hybrid"]);
      if (
        isNonEmptyString(rec.program_location) &&
        !allowedModes.has(rec.program_location)
      )
        missing.push("program_location(enum)");
      if (REQUIRE_AT_LEAST_ONE_IMAGE) {
        if (
          !isNonEmptyString(rec.program_main_image) &&
          !isNonEmptyString(rec.program_cover_image)
        ) {
          missing.push("program_main_image|program_cover_image");
        }
      }
      return { ok: missing.length === 0, missing };
    };

    // Waiters + iframe
    const waitForAny = (doc, selectors, { timeout = 20000, poll = 200 } = {}) =>
      new Promise((resolve, reject) => {
        const t0 = Date.now();
        const tick = () => {
          for (const sel of selectors) {
            const el = doc.querySelector(sel);
            if (el) return resolve({ sel, el });
          }
          if (Date.now() - t0 >= timeout)
            return reject(new Error(`Timeout: ${selectors.join(", ")}`));
          setTimeout(tick, poll);
        };
        tick();
      });
    const observeFor = (doc, selectors, { timeout = 8000 } = {}) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          obs.disconnect();
          reject(new Error("Observer timeout"));
        }, timeout);
        const obs = new MutationObserver(() => {
          for (const sel of selectors) {
            if (doc.querySelector(sel)) {
              clearTimeout(timer);
              obs.disconnect();
              return resolve(sel);
            }
          }
        });
        obs.observe(doc, { childList: true, subtree: true });
      });
    const waitForBullets = async (
      doc,
      { timeout = 15000, poll = 200 } = {}
    ) => {
      const start = Date.now();
      const selList = [
        "ul.bullets-display.currency-position-block li",
        "ul.bullets-display li",
      ];
      while (Date.now() - start < timeout) {
        for (const sel of selList) if (doc.querySelector(sel)) return true;
        await new Promise((r) => setTimeout(r, poll));
      }
      return false;
    };
    const loadInIframe = (url) =>
      new Promise((resolve, reject) => {
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.left = "-20000px";
        iframe.style.top = "0";
        iframe.style.width = "1400px";
        iframe.style.height = "2000px";
        iframe.src = url;
        iframe.addEventListener("load", () => resolve(iframe), { once: true });
        iframe.addEventListener(
          "error",
          () => reject(new Error(`Failed to load: ${url}`)),
          { once: true }
        );
        document.body.appendChild(iframe);
      });

    // Robust waits
    const waitForTrue = async (fn, { timeout = 20000, poll = 200 } = {}) => {
      const t0 = Date.now();
      for (;;) {
        try {
          if (await fn()) return true;
        } catch {}
        if (Date.now() - t0 > timeout) return false;
        await new Promise((r) => setTimeout(r, poll));
      }
    };
    const waitDomSettled = async (doc, quietMs = 700, max = 5000) => {
      let last = Date.now();
      const mo = new MutationObserver(() => {
        last = Date.now();
      });
      mo.observe(doc, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const t0 = Date.now();
      try {
        for (;;) {
          if (Date.now() - last >= quietMs) break;
          if (Date.now() - t0 >= max) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        mo.disconnect();
      }
    };

    function parseBulletsBlock(doc) {
      const out = { categories: [], locations: [], criteria: [] };
      const uniq = (arr) =>
        Array.from(new Set(arr.filter(Boolean).map((s) => s.trim())));
      const header = Array.from(doc.querySelectorAll(".mb8")).find((el) =>
        /looking\s+for\s+companies/i.test(el.textContent || "")
      );
      let uls = [];
      if (
        header &&
        header.nextElementSibling &&
        header.nextElementSibling.matches("ul.bullets-display")
      ) {
        uls = [header.nextElementSibling];
      } else {
        uls = Array.from(doc.querySelectorAll("ul.bullets-display"));
      }
      if (!uls.length) return out;
      uls.forEach((ul) => {
        ul.querySelectorAll("li").forEach((li) => {
          const raw = (li.textContent || "").replace(/\s+/g, " ").trim();
          const anchors = Array.from(li.querySelectorAll("a"))
            .map((a) => (a.textContent || "").trim())
            .filter(Boolean);
          if (/^\s*in\s/i.test(raw)) out.categories.push(...anchors);
          else if (/^\s*located in\s/i.test(raw))
            out.locations.push(...anchors);
          else if (raw) out.criteria.push(raw);
        });
      });
      out.categories = uniq(out.categories);
      out.locations = uniq(out.locations);
      out.criteria = uniq(out.criteria);
      return out;
    }

    // ---------- Scraper for the About/Program page ----------
    const scrapeAboutDoc = (doc) => {
      const root = doc.querySelector(".tile.standard-overview") || doc;

      const overview = {};
      root
        .querySelectorAll(".benefits--container .info-wrapper")
        .forEach((w) => {
          const value =
            text(w.querySelector(".b18")) ||
            text(w.querySelector(".b18.tight"));
          const label = text(w.querySelector(".b14"));
          if (label) {
            const key = label
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "");
            overview[key] = value;
          }
        });

      const org_description =
        text(root.querySelector(".description-wrapper > div")) ||
        text(root.querySelector(".description-wrapper")) ||
        "";

      let program_description_html = "",
        program_description_text = "";
      {
        const ppRoot =
          doc.querySelector('[data-mod-name="descriptions_product_program"]') ||
          doc.querySelector('[data-mod-name="product_program"]');
        if (ppRoot) {
          const expanded = ppRoot.querySelector("#description-expanded");
          const collapsed = ppRoot.querySelector("#description-collapsed");
          const rawHtml =
            (expanded && expanded.innerHTML && expanded.innerHTML.trim()) ||
            (collapsed && collapsed.innerHTML && collapsed.innerHTML.trim()) ||
            "";
          program_description_html = rawHtml;
          program_description_text =
            htmlToText(rawHtml) ||
            (expanded ? (expanded.textContent || "").trim() : "") ||
            (collapsed ? (collapsed.textContent || "").trim() : "");
        }
      }

      const investment_stats = Array.from(
        root.querySelectorAll(".description-wrapper li.investment-block")
      )
        .map((li) => ({
          text: text(li),
          images: Array.from(li.querySelectorAll("img")).map((img) => img.src),
        }))
        .filter((x) => x.text);

      const overviewMain =
        doc.querySelector('[data-mod-name="overview_main"]') ||
        doc.querySelector(
          ".indented-highlight-block.sidebar-block.overview-blocks"
        ) ||
        doc;

      let sidebar_dates_text = "",
        sidebar_duration_text = "";
      {
        const dateNode =
          overviewMain.querySelector(".cba .b16") ||
          doc.querySelector('[data-mod-name="overview_main"] .cba .b16') ||
          null;
        const dt = text(dateNode);
        if (dt) {
          const m = dt.match(/^(.*?)(?:\s*\((.*?)\))?$/);
          sidebar_dates_text = (m && m[1] ? m[1] : dt).trim();
          sidebar_duration_text = (m && m[2] ? m[2] : "").trim();
        }
      }

      const normalizeLocation = (s) =>
        (s || "")
          .replace(/\s+/g, " ")
          .replace(/\s*,\s*/g, ", ")
          .trim();
      let locationTextSidebar = "";
      {
        const pickFirst = (roots, sels) => {
          for (const r of roots)
            for (const sel of sels) {
              const n = r.querySelector(sel);
              const t = text(n);
              if (t) return t;
            }
          return "";
        };
        const roots = [overviewMain, doc];
        const selectors = [
          "#csInlineLocation .inner",
          ".location-wrapper .inner",
          ".location-wrapper",
          ".sidebar-block .inner",
          '[class*="location"] .inner',
          '[id*="Location"] .inner',
        ];
        locationTextSidebar = normalizeLocation(pickFirst(roots, selectors));
        if (!locationTextSidebar) {
          const icon =
            overviewMain.querySelector(".fa-map-marker") ||
            doc.querySelector(".fa-map-marker");
          if (icon) {
            const container =
              icon.closest(".location-wrapper") || icon.parentElement;
            locationTextSidebar = normalizeLocation(text(container));
          }
        }
      }

      const links = {};
      const linksRoot = doc.querySelector(".profile-links-wrapper");
      if (linksRoot) {
        const as = Array.from(linksRoot.querySelectorAll("a[href]"));
        as.forEach((a) => {
          const href = a.getAttribute("href");
          if (!href) return;
          const cls = a.className || "";
          if (/link-website/i.test(cls)) links.website = href;
          else if (/link-linkedin/i.test(cls)) links.linkedin = href;
          else if (/link-twitter/i.test(cls)) links.twitter = href;
          else if (/link-facebook/i.test(cls)) links.facebook = href;
          else if (/link-instagram/i.test(cls)) links.instagram = href;
        });
      }

      let address = null;
      {
        const scripts = Array.from(
          doc.querySelectorAll('script[type="application/ld+json"]')
        );
        const coercePostal = (a) =>
          a && {
            streetAddress: a.streetAddress || "",
            addressLocality: a.addressLocality || "",
            addressRegion: a.addressRegion || "",
            postalCode: a.postalCode || "",
            addressCountry: a.addressCountry || "",
          };
        const findPostal = (node) => {
          if (!node || typeof node !== "object") return null;
          if (node["@type"] === "PostalAddress") return coercePostal(node);
          if (Array.isArray(node)) {
            for (const v of node) {
              const r = findPostal(v);
              if (r) return r;
            }
            return null;
          }
          for (const k of Object.keys(node)) {
            const r = findPostal(node[k]);
            if (r) return r;
          }
          return null;
        };
        for (const s of scripts) {
          const data = safeJsonParse(s.textContent || "");
          if (!data) continue;
          const found = findPostal(data);
          if (found) {
            address = found;
            break;
          }
        }
      }

      const identity = {};
      identity.name = text(doc.querySelector(".cover-title")) || "";
      identity.tagline = text(doc.querySelector(".cover-blurb")) || "";
      const thumbImg = doc.querySelector("#profile-picture img");
      identity.thumbnail = thumbImg ? thumbImg.getAttribute("src") || "" : "";
      const ss2 = thumbImg ? thumbImg.getAttribute("srcset") || "" : "";
      identity.thumbnail_2x = ss2
        ? (
            ss2
              .split(",")
              .map((s) => s.trim())
              .find((s) => /\s2x$/i.test(s)) || ""
          ).split(/\s+/)[0] || ""
        : "";
      const ogImage = doc.querySelector('meta[property="og:image"]');
      identity.og_image = ogImage ? ogImage.getAttribute("content") || "" : "";

      const bullets = parseBulletsBlock(doc);

      return {
        overview,
        program_description_html,
        program_description: program_description_text,
        org_description,
        investment_stats,
        categories: bullets.categories || [],
        applicant_locations: bullets.locations || [],
        applicant_criteria: bullets.criteria || [],
        sidebar: {
          dates_text: sidebar_dates_text,
          duration_text: sidebar_duration_text,
          location_text: locationTextSidebar,
        },
        address,
        links,
        identity,
      };
    };

    // Listing rows
    const rows = $$(
      document,
      "#csResultsBlock .bordered-list-item.result-item"
    );
    if (!rows.length) {
      console.warn("No .result-item rows found.");
      return;
    }

    const listing = rows.map((item, idx) => {
      const orgLinkA = $1(item, ".organization-picture a");
      const img = $1(item, ".organization-picture img");
      const titleA = $1(item, ".result-description .title a");
      const moreInfoA = $1(item, ".result-action .t14 a");
      const applyA = $1(item, ".result-action .t18r a");
      const subtitle = parseSubtitle(
        text($1(item, ".result-description .subtitle"))
      );
      const details = text($1(item, ".result-description .details span"));
      const verified = !!$1(item, ".verified-badge");
      const about_link = absUrl(
        attr(titleA, "href") || attr(moreInfoA, "href")
      );
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
        source_url: location.href,
      };
    });

    const targets = listing.slice(0, MAX_ITEMS);

    // Namespaced state
    window.__sc__raw = window.__sc__raw || [];
    window.__sc__enriched = window.__sc__enriched || [];
    window.__sc__skipped = window.__sc__skipped || [];

    /* ===== Date parsing ===== */
    const parseYear = (title, deadlineText) => {
      const y = (title || "").match(/\b(20\d{2})\b/);
      if (y) return +y[1];
      const m = (deadlineText || "").match(/([A-Za-z]{3,})\s*(\d{1,2})/);
      if (m) {
        const mi = monthIndex(m[1]);
        const dd = +m[2];
        const now = new Date();
        const guess = new Date(
          now.getFullYear(),
          mi ?? now.getMonth(),
          dd || 1
        );
        const cutoff = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - 31
        );
        return guess < cutoff ? now.getFullYear() + 1 : now.getFullYear();
      }
      return new Date().getFullYear();
    };

    const parseRange = (txt, fallbackYear) => {
      if (!txt) return { start: null, end: null };
      const clean = String(txt)
        .replace(/[\u00A0\u2007\u202F]/g, " ")
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      const DASH = "(?:-|–|—|to)";
      const re = new RegExp(
        String.raw`([A-Za-z]{3,})\s*(\d{1,2})(?:\s*'\s*(\d{2,4}))?\s*` +
          DASH +
          String.raw`\s*([A-Za-z]{3,})\s*(\d{1,2})(?:\s*'\s*(\d{2,4}))?`
      );
      const normYY = (y) => {
        if (y == null) return null;
        const n = parseInt(String(y), 10);
        return !isFinite(n) ? null : n < 100 ? 2000 + n : n;
      };
      const m = clean.match(re);
      if (m) {
        const m1 = monthIndex(m[1]);
        const d1 = parseInt(m[2], 10);
        const y1 = normYY(m[3]) ?? fallbackYear;
        const m2 = monthIndex(m[4]);
        const d2 = parseInt(m[5], 10);
        let y2 = normYY(m[6]);
        if (m1 == null || m2 == null || !d1 || !d2)
          return { start: null, end: null };
        if (y2 == null) {
          if (y1 != null) y2 = m2 < m1 ? y1 + 1 : y1;
          else if (fallbackYear != null)
            y2 = m2 < m1 ? fallbackYear + 1 : fallbackYear;
        }
        const start = y1 != null ? new Date(y1, m1, d1) : null;
        const end = y2 != null ? new Date(y2, m2, d2) : start;
        return { start, end };
      }
      const single = clean.match(
        /([A-Za-z]{3,})\s*(\d{1,2})(?:\s*'\s*(\d{2,4}))?/
      );
      if (single) {
        const mi = monthIndex(single[1]);
        const d = parseInt(single[2], 10);
        const y =
          single[3] == null
            ? fallbackYear
            : parseInt(single[3], 10) < 100
            ? 2000 + parseInt(single[3], 10)
            : parseInt(single[3], 10);
        if (mi != null && d && y != null) {
          const s = new Date(y, mi, d);
          return { start: s, end: s };
        }
      }
      return { start: null, end: null };
    };

    const parseSingle = (txt, y) => {
      const m = (txt || "").match(
        /([A-Za-z]{3,})\s*(\d{1,2})(?:\s*['’]?\s*(\d{2,4}))?/
      );
      if (!m) return null;
      const mi = monthIndex(m[1]);
      const d = +m[2];
      const yy = (() => {
        if (m[3] == null) return y;
        const n = parseInt(m[3], 10);
        return n < 100 ? 2000 + n : n;
      })();
      return mi == null || !d || yy == null ? null : new Date(yy, mi, d);
    };

    const addrToLine = (a) => {
      if (!a) return "";
      const parts = [
        a.streetAddress,
        a.addressLocality,
        a.addressRegion,
        a.postalCode,
        a.addressCountry,
      ].filter(Boolean);
      return parts.join(", ");
    };

    const parseCostUSD = (overview) => {
      const raw = (
        overview?.cost ||
        overview?.fee ||
        overview?.tuition ||
        ""
      ).trim();
      if (!raw) return null;
      const t = raw.toLowerCase();
      if (/^free\b/.test(t)) return 0;
      if (/^\$?\s*0(?:\.0+)?\s*$/.test(t)) return 0;
      const money = moneyAny(raw);
      if (!money) return null;
      const usd = convertToUSD(money);
      return usd ? usd.amount : null;
    };

    const toProgramRecord = (e) => {
      // 1) Parse program dates first (prefer sidebar > listing)
      const yearFromTitleOrDeadline = parseYear(e.title, e.deadline_text);
      let { start, end } = parseRange(
        e.sidebar?.dates_text || e.dates_text,
        yearFromTitleOrDeadline
      );

      // Ensure end is never before start
      ({ start, end } = ensureEndNotBeforeStart(start, end));

      // 2) Parse deadline; anchor to start/end year if present; avoid post-start deadline
      let deadline = null;
      if (e.deadline_text) {
        const fallbackYearForDeadline =
          (start && start.getFullYear()) ||
          (end && end.getFullYear()) ||
          yearFromTitleOrDeadline;
        deadline = parseSingle(e.deadline_text, fallbackYearForDeadline);
        if (deadline && start && deadline > start) {
          deadline = new Date(
            deadline.getFullYear() - 1,
            deadline.getMonth(),
            deadline.getDate()
          );
        } else if (deadline && !start && end && deadline > end) {
          deadline = new Date(
            deadline.getFullYear() - 1,
            deadline.getMonth(),
            deadline.getDate()
          );
        }
      }

      const startISO = toISO(start);
      const endISO = toISO(end);
      const deadlineISO = toISO(deadline);
      const effectiveDeadlineISO = deadlineISO || "";

      const perCompany = e.overview?.per_company || "";
      const sampleFunding =
        moneyAny(perCompany) ||
        moneyAny(e.investment_stats?.[0]?.text) ||
        moneyAny(e.program_description || e.program_description_html) ||
        null;
      const sampleFundingUSD = convertToUSD(sampleFunding);

      const equitySource =
        e.overview?.equity_taken || e.details || e.program_description || "";
      const equityMax = parseEquityMaxPercent(equitySource);

      const overviewModeRaw = [
        "location",
        "program_location",
        "format",
        "program_format",
        "mode",
        "program_mode",
        "delivery",
        "delivery_mode",
      ]
        .map((k) =>
          e.overview && typeof e.overview[k] === "string" ? e.overview[k] : ""
        )
        .find((v) => v && v.trim());
      const modeFromTile = normalizeMode(overviewModeRaw);

      const fallbackText = (
        e.sidebar?.location_text ||
        e.location ||
        ""
      ).toLowerCase();
      const modeFromFallback = normalizeMode(fallbackText);
      const mode = modeFromTile || modeFromFallback || "";

      const mainImage =
        e.identity?.og_image || e.image_src_2x || e.image_src || "";
      const coverImage =
        e.identity?.og_image || e.image_src_2x || e.image_src || "";

      return {
        program_title: e.title || "",
        program_start_date: startISO,
        program_end_date: endISO,
        program_address: addrToLine(e.address || null),
        program_location: mode,
        program_cost_usd: parseCostUSD(e.overview),
        program_description:
          e.program_description ||
          (e.program_description_html
            ? htmlToText(e.program_description_html)
            : "") ||
          "",
        program_application_deadline: effectiveDeadlineISO,
        program_main_image: mainImage,
        program_cover_image: coverImage,
        program_funding_amount_in_usd:
          sampleFundingUSD && typeof sampleFundingUSD.amount === "number"
            ? String(sampleFundingUSD.amount)
            : "",
        program_equity_max_percent: equityMax != null ? equityMax : null,
        apply_link: e.apply_link || "",
        program_categories: Array.isArray(e.categories) ? e.categories : [],
        program_applicant_location_requirement: Array.isArray(
          e.applicant_locations
        )
          ? e.applicant_locations
          : [],
        program_applicant_company_criteria: Array.isArray(e.applicant_criteria)
          ? e.applicant_criteria
          : [],
        organizer_website: e.links?.website || "",
        organizer_logo: e.identity?.thumbnail || "",
        organizer_linkedin: e.links?.linkedin || "",
        organizer_name: e.identity?.name || "",
        organizer_address: addrToLine(e.address || null),
        organizer_description: e.org_description || "",
      };
    };

    // POST helper — ALWAYS logs payload
    const postProgram = async (record, { seq, total }) => {
      const endpoint = WEBHOOK_URL.replace(/\s+/g, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
          mode: "cors",
          credentials: "omit",
          signal: controller.signal,
        });
        clearTimeout(timer);
        const txt = await res.text().catch(() => "");
        console.log(`📤 POST [${seq}/${total}] → ${res.status}`, {
          record,
          response: txt.slice(0, 1000),
          ok: res.ok,
          endpoint,
        });
        return res.ok;
      } catch (err) {
        clearTimeout(timer);
        console.warn(`⚠️ POST error [${seq}/${total}]`, {
          error: String(err?.message || err),
          record,
          endpoint,
        });
        return false;
      }
    };

    /* ===== Crawl loop ===== */
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];

      // Try to build & post from listing row BEFORE opening the detail page
      {
        let preRecord = toProgramRecord(row);
        preRecord = applyAddressFallbacks(preRecord);

        let preVerdict = validateRecord(preRecord);

        if (!preVerdict.ok) {
          const allowedModes = new Set(["Online", "Offline", "Hybrid"]);
          if (!allowedModes.has(preRecord.program_location)) {
            const fbMode = normalizeMode(row.location || "");
            preRecord.program_location =
              (allowedModes.has(fbMode) && fbMode) || "Online";
          }
          if (
            !(typeof preRecord.program_cost_usd === "number") ||
            Number.isNaN(preRecord.program_cost_usd)
          ) {
            preRecord.program_cost_usd = 0;
          }

          // Dates & deadline: DO NOT synthesize start/end; only fix ordering if both exist.
          if (
            preRecord.program_start_date &&
            preRecord.program_end_date &&
            preRecord.program_end_date < preRecord.program_start_date
          ) {
            preRecord.program_end_date = preRecord.program_start_date;
          }
          // Keep deadline empty if missing
          preRecord.program_application_deadline =
            preRecord.program_application_deadline || "";

          // Apply link fallbacks
          preRecord.apply_link =
            preRecord.apply_link ||
            row.more_info_link ||
            row.about_link ||
            row.profile_link ||
            row.source_url ||
            "";

          // Images
          preRecord.program_main_image =
            preRecord.program_main_image ||
            row.image_src_2x ||
            row.image_src ||
            "";
          preRecord.program_cover_image =
            preRecord.program_cover_image || preRecord.program_main_image || "";

          // Organizer fallbacks
          preRecord.organizer_name =
            preRecord.organizer_name || row.title || "";
          preRecord.organizer_website = preRecord.organizer_website || "";
          preRecord.organizer_address = preRecord.organizer_address || "";
          preRecord.organizer_description =
            preRecord.organizer_description || "";

          preRecord._validation_missing = preVerdict.missing;
        }

        preVerdict = validateRecord(preRecord);

        if (preVerdict.ok) {
          console.log(
            `✅ Listing-only sufficient, posting without opening detail: ${preRecord.program_title}`
          );
          window.__sc__enriched.push(preRecord);
          await postProgram(preRecord, { seq: i + 1, total: targets.length });
          continue; // Skip iframe load for this item
        } else {
          console.log(
            `ℹ️ Listing-only incomplete, will open detail page: ${row.title}`,
            preVerdict.missing
          );
        }
      }

      if (window.__sc__raw.some((x) => x.profile_link === row.profile_link)) {
        console.log(`⏭️  Already processed: ${row.title}`);
        continue;
      }

      const out = { ...row };
      await sleep(rand(500, 1200));
      console.log(`🔎 [${i + 1}/${targets.length}] Load: ${row.about_link}`);

      const tryOnce = async () => {
        const iframe = await loadInIframe(row.about_link);
        const doc = iframe.contentDocument || iframe.contentWindow.document;

        try {
          const btn = Array.from(
            doc.querySelectorAll("button, .btn, .ot-sdk-container button")
          ).find((b) => /accept|agree|consent/i.test(b.textContent || ""));
          if (btn) btn.click();
        } catch {}

        for (const y of [0, 400, 1000, 1600, 2800]) {
          try {
            iframe.contentWindow.scrollTo(0, y);
          } catch {}
          await sleep(150);
        }

        const targetsSel = [
          ".tile.standard-overview",
          ".benefits--container",
          ".description-wrapper",
          ".investment-block",
          ".bullets-display",
          '[data-mod-name="product_program"]',
          "#csDescriptionsWrapper",
        ];

        try {
          await waitForAny(doc, targetsSel, { timeout: 25000, poll: 250 });
        } catch {
          try {
            await observeFor(doc, targetsSel, { timeout: 8000 });
          } catch {}
        }

        await waitForBullets(doc).catch(() => {});
        await waitForTrue(
          () => {
            const b18s = doc.querySelectorAll(
              ".benefits--container .info-wrapper .b18"
            );
            const hasSomeB18Text =
              b18s.length >= 3 &&
              Array.from(b18s).some((n) => (n.textContent || "").trim());
            const desc = doc.querySelector(
              "#description-expanded, #description-collapsed, [data-mod-name='product_program']"
            );
            const bullets = !!doc.querySelector(
              "ul.bullets-display li, ul.bullets-display.currency-position-block li"
            );
            return hasSomeB18Text || !!desc || bullets;
          },
          { timeout: 20000, poll: 200 }
        );

        await waitDomSettled(doc, 700, 5000);

        await Promise.allSettled(
          Array.from(doc.images || []).map((img) =>
            img && img.decode ? img.decode().catch(() => {}) : Promise.resolve()
          )
        );

        const extra = scrapeAboutDoc(doc);
        iframe.remove();
        return extra;
      };

      try {
        let extra = await tryOnce();
        const overviewKeyCount = Object.keys(extra.overview || {}).length;
        const hasDesc =
          !!extra.program_description ||
          !!(
            extra.program_description_html &&
            extra.program_description_html.trim()
          );
        const hasBullets =
          (extra.categories && extra.categories.length > 0) ||
          (extra.applicant_criteria && extra.applicant_criteria.length > 0);
        const hasInvest =
          extra.investment_stats && extra.investment_stats.length > 0;

        const empty =
          overviewKeyCount < 2 && !hasDesc && !hasBullets && !hasInvest;

        if (empty) {
          console.log("↻ Retrying once (late hydration)...");
          await sleep(600);
          extra = await tryOnce();
        }
        Object.assign(out, extra);
      } catch (e) {
        out._about_error = String(e?.message || e);
      }

      window.__sc__raw.push(out);

      // Map to final schema and VALIDATE
      let record = toProgramRecord(out);
      record = applyAddressFallbacks(record);
      const verdict = validateRecord(record);

      // Never skip: coerce + annotate, then POST
      if (!verdict.ok) {
        console.warn(
          `⚠️ MISSING/INVALID [${i + 1}/${targets.length}] ${
            record.program_title || out.title || "(untitled)"
          } →`,
          verdict.missing
        );

        const allowedModes = new Set(["Online", "Offline", "Hybrid"]);
        if (!allowedModes.has(record.program_location)) {
          const fbMode = normalizeMode(
            out.sidebar?.location_text || out.location || ""
          );
          record.program_location =
            (allowedModes.has(fbMode) && fbMode) || "Online";
        }

        if (
          !(typeof record.program_cost_usd === "number") ||
          Number.isNaN(record.program_cost_usd)
        ) {
          record.program_cost_usd = 0; // default to 0 when unknown
        }

        // Dates: DO NOT synthesize start/end. Only fix ordering if both exist.
        if (
          record.program_start_date &&
          record.program_end_date &&
          record.program_end_date < record.program_start_date
        ) {
          record.program_end_date = record.program_start_date;
        }

        // Deadline: keep empty if missing
        record.program_application_deadline =
          record.program_application_deadline || "";

        // Apply link: try multiple fallbacks
        record.apply_link =
          record.apply_link ||
          out.more_info_link ||
          out.about_link ||
          out.profile_link ||
          out.source_url ||
          "";

        // Images: allow empty strings
        record.program_main_image = record.program_main_image || "";
        record.program_cover_image = record.program_cover_image || "";

        // Organizer fields
        record.organizer_name = record.organizer_name || out.title || "";
        record.organizer_website = record.organizer_website || "";
        record.organizer_address = record.organizer_address || "";
        record.organizer_description = record.organizer_description || "";

        // Attach missing list for server-side handling/visibility
        record._validation_missing = verdict.missing;
      }

      console.log(
        "🧭 Mode:",
        record.program_location,
        "| 💵 CostUSD:",
        record.program_cost_usd
      );

      window.__sc__enriched.push(record);
      await postProgram(record, { seq: i + 1, total: targets.length });
    }

    // Optional: summaries
    if (window.__sc__enriched.length) {
      console.table(
        window.__sc__enriched.map((r) => ({
          title: r.program_title,
          mode: r.program_location,
          costUSD: r.program_cost_usd,
          start: r.program_start_date,
          end: r.program_end_date,
          deadline: r.program_application_deadline,
        }))
      );
    }
    if (window.__sc__skipped.length) {
      console.table(
        window.__sc__skipped.map((s) => ({
          title: s.title,
          missing: s.missing.join(", "),
        }))
      );
    }
  })();
})();
