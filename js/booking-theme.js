/* SimpleHotelier — booking page themes (fonts, colors, corners, wording).
   Shared by the guest page (book.html) and the Booking Page studio
   (app.html). A property's tenants.booking_theme is untrusted input: only
   allowlisted fonts, #rrggbb colors and known options are ever applied, so a
   stored theme can never inject CSS or load an arbitrary stylesheet. */
"use strict";

(function () {
  /* Google Fonts allowlist: key -> family, CSS stack and the css2 axis spec. */
  const FONTS = {
    "instrument-serif": { label: "Instrument Serif", family: "Instrument Serif", stack: "'Instrument Serif', Georgia, serif", spec: "ital@0;1", heading: true },
    "playfair": { label: "Playfair Display", family: "Playfair Display", stack: "'Playfair Display', Georgia, serif", spec: "wght@500;600;700", heading: true },
    "fraunces": { label: "Fraunces", family: "Fraunces", stack: "'Fraunces', Georgia, serif", spec: "wght@400;600;700", heading: true },
    "dm-serif": { label: "DM Serif Display", family: "DM Serif Display", stack: "'DM Serif Display', Georgia, serif", spec: "ital@0;1", heading: true },
    "cormorant": { label: "Cormorant Garamond", family: "Cormorant Garamond", stack: "'Cormorant Garamond', Georgia, serif", spec: "wght@500;600;700", heading: true },
    "libre-baskerville": { label: "Libre Baskerville", family: "Libre Baskerville", stack: "'Libre Baskerville', Georgia, serif", spec: "wght@400;700", heading: true, body: true },
    "lora": { label: "Lora", family: "Lora", stack: "'Lora', Georgia, serif", spec: "wght@400;500;600;700", heading: true, body: true },
    "sora": { label: "Sora", family: "Sora", stack: "'Sora', system-ui, sans-serif", spec: "wght@600;700;800", heading: true },
    "space-grotesk": { label: "Space Grotesk", family: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif", spec: "wght@500;600;700", heading: true },
    "bebas-neue": { label: "Bebas Neue", family: "Bebas Neue", stack: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif", spec: "wght@400", heading: true },
    "outfit": { label: "Outfit", family: "Outfit", stack: "'Outfit', system-ui, sans-serif", spec: "wght@400;500;600;700", heading: true, body: true },
    "montserrat": { label: "Montserrat", family: "Montserrat", stack: "'Montserrat', system-ui, sans-serif", spec: "wght@400;500;600;700", heading: true, body: true },
    "poppins": { label: "Poppins", family: "Poppins", stack: "'Poppins', system-ui, sans-serif", spec: "wght@400;500;600;700", heading: true, body: true },
    "inter": { label: "Inter", family: "Inter", stack: "'Inter', system-ui, sans-serif", spec: "wght@400;500;600;700", heading: true, body: true },
    "public-sans": { label: "Public Sans", family: "Public Sans", stack: "'Public Sans', system-ui, sans-serif", spec: "wght@400;500;600;700", body: true },
    "dm-sans": { label: "DM Sans", family: "DM Sans", stack: "'DM Sans', system-ui, sans-serif", spec: "wght@400;500;600;700", body: true },
    "work-sans": { label: "Work Sans", family: "Work Sans", stack: "'Work Sans', system-ui, sans-serif", spec: "wght@400;500;600;700", body: true },
    "nunito-sans": { label: "Nunito Sans", family: "Nunito Sans", stack: "'Nunito Sans', system-ui, sans-serif", spec: "wght@400;600;700", body: true },
    "source-sans": { label: "Source Sans 3", family: "Source Sans 3", stack: "'Source Sans 3', system-ui, sans-serif", spec: "wght@400;600;700", body: true },
    "karla": { label: "Karla", family: "Karla", stack: "'Karla', system-ui, sans-serif", spec: "wght@400;500;600;700", body: true }
  };

  /* Heading weight that suits each face (display serifs read best light). */
  const HEAD_WEIGHT = { "instrument-serif": 400, "dm-serif": 400, "cormorant": 600, "playfair": 600, "fraunces": 600,
    "libre-baskerville": 700, "lora": 600, "sora": 700, "space-grotesk": 600, "bebas-neue": 400, "outfit": 600, "montserrat": 700, "poppins": 600, "inter": 700 };
  /* Letter spacing for headings: condensed all-caps faces need air. */
  const HEAD_TRACK = { "bebas-neue": "0.03em" };

  /* Text has its own color on the page and on cards, so a dark page can have
     light cards (and the reverse). Headings default to the page text color. */
  const COLOR_KEYS = [
    ["bg", "Page background"], ["ink", "Page text"],
    ["surface", "Cards & panels"], ["surfaceInk", "Card text"],
    ["heading", "Headings"], ["accent", "Accent"],
    ["brand", "Buttons & links"], ["footer", "Footer"]
  ];
  /* Colors a theme may leave out: worked out from the theme's own colors. */
  const DERIVED = ["surfaceInk", "heading"];
  const RADII = { square: [4, 6, 8, 10, 6], soft: [10, 16, 20, 24, 999], rounded: [14, 22, 28, 32, 999] }; // input, card, panel, hero, button
  /* What a property's guests book: key -> singular / plural as shown, plus a
     name pattern for the "Automatic" guess (first match wins, so specific
     words come before general ones). Owners can also type their own words. */
  const UNITS = [
    ["cabin", "cabin", "cabins", /\bcabins?\b/],
    ["yurt", "yurt", "yurts", /\byurts?\b/],
    ["treehouse", "treehouse", "treehouses", /\btree ?houses?\b/],
    ["glamping-tent", "glamping tent", "glamping tents", /\bglamping\b/],
    ["tent", "tent", "tents", /\btents?\b|\bteepees?\b|\btipis?\b/],
    ["rv-site", "RV site", "RV sites", /\brv\b|\bcampers?\b|\bhook-?ups?\b/],
    ["campsite", "campsite", "campsites", /\bcamp ?sites?\b|\bpitch(es)?\b/],
    ["chalet", "chalet", "chalets", /\bchalets?\b/],
    ["cottage", "cottage", "cottages", /\bcottages?\b/],
    ["bungalow", "bungalow", "bungalows", /\bbungalows?\b/],
    ["villa", "villa", "villas", /\bvillas?\b/],
    ["lodge", "lodge", "lodges", /\blodges?\b/],
    ["suite", "suite", "suites", /\bsuites?\b/],
    ["apartment", "apartment", "apartments", /\bapartments?\b|\bapts?\b|\bflats?\b/],
    ["condo", "condo", "condos", /\bcondos?\b/],
    ["house", "house", "houses", /\bhouses?\b/],
    ["home", "home", "homes", /\bhomes?\b/],
    ["room", "room", "rooms", /\brooms?\b|\bking\b|\bqueen\b|\bdouble\b|\btwin\b/],
    ["unit", "unit", "units", null]
  ];
  const UNIT_NOUNS = Object.fromEntries(UNITS.map(([k, one, many]) => [k, { one, many }]));
  const GENERIC_UNIT = { one: "stay", many: "stays" };
  const UNIT_WORD = /^[A-Za-z][A-Za-z0-9 '’&-]{0,23}$/;

  const PRESETS = {
    meadow: { label: "Meadow", headingFont: "instrument-serif", bodyFont: "inter", radius: "soft",
      colors: { bg: "#f3f4ef", surface: "#ffffff", ink: "#1c2620", brand: "#2f5d46", accent: "#8a6a2e", footer: "#1c2620" } },
    pine: { label: "Pine", headingFont: "sora", bodyFont: "public-sans", radius: "soft",
      colors: { bg: "#eef2ef", surface: "#ffffff", ink: "#101f1e", brand: "#0c3b3c", accent: "#b97a2a", footer: "#0a2a2b" } },
    coastal: { label: "Coastal", headingFont: "fraunces", bodyFont: "dm-sans", radius: "rounded",
      colors: { bg: "#f2f6f8", surface: "#ffffff", ink: "#13232f", brand: "#1f5f7a", accent: "#c26a3d", footer: "#10242f" } },
    desert: { label: "Desert", headingFont: "dm-serif", bodyFont: "work-sans", radius: "soft",
      colors: { bg: "#f7f1ea", surface: "#fffdf9", ink: "#2b1d14", brand: "#a0522d", accent: "#6b8e5a", footer: "#2b1d14" } },
    modern: { label: "Modern", headingFont: "space-grotesk", bodyFont: "inter", radius: "square",
      colors: { bg: "#ffffff", surface: "#f5f5f2", ink: "#111111", brand: "#111111", accent: "#e4572e", footer: "#111111" } },
    evening: { label: "Evening", headingFont: "cormorant", bodyFont: "inter", radius: "soft",
      colors: { bg: "#14171a", surface: "#1d2126", ink: "#edeae4", brand: "#d4a85a", accent: "#d4a85a", footer: "#0d0f11" } }
  };
  const DEFAULT_PRESET = "meadow";

  const isHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

  /* Any stored/edited theme -> a complete, safe theme. Unknown values fall
     back to the preset (or Meadow). */
  function normalize(raw) {
    const t = raw && typeof raw === "object" ? raw : {};
    const presetKey = PRESETS[t.preset] ? t.preset : DEFAULT_PRESET;
    const base = PRESETS[presetKey];
    const colors = {};
    COLOR_KEYS.forEach(([k]) => {
      if (isHex(t.colors && t.colors[k])) colors[k] = t.colors[k].toLowerCase();
      else if (!DERIVED.includes(k)) colors[k] = base.colors[k];
    });
    // Themes saved before card text existed: keep the page text if it reads
    // well on the cards, otherwise use whichever of near-black/white does.
    if (!colors.surfaceInk) colors.surfaceInk = contrast(colors.ink, colors.surface) >= 4.5 ? colors.ink : onColor(colors.surface);
    if (!colors.heading) colors.heading = colors.ink;
    const font = (key, kind, fallback) => (FONTS[key] && FONTS[key][kind] ? key : fallback);
    return {
      preset: presetKey,
      headingFont: font(t.headingFont, "heading", base.headingFont),
      bodyFont: font(t.bodyFont, "body", base.bodyFont),
      radius: RADII[t.radius] ? t.radius : base.radius,
      colors,
      eyebrow: clean(t.eyebrow, 60),
      ...unitFields(t),
      numberedSteps: t.numberedSteps !== false
    };
  }

  /* Relative luminance + WCAG contrast, for auto text colors and studio warnings. */
  function luminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }
  const onColor = (hex) => (contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111");

  function fontsHref(theme) {
    const keys = [...new Set([theme.headingFont, theme.bodyFont])];
    const families = keys.map((k) => "family=" + FONTS[k].family.replace(/ /g, "+") + ":" + FONTS[k].spec).join("&");
    return "https://fonts.googleapis.com/css2?" + families + "&display=swap";
  }

  /* Apply a theme to a document: CSS variables on :root plus one font link. */
  function apply(raw, doc) {
    const d = doc || document;
    const t = normalize(raw);
    const c = t.colors;
    const [rIn, rCard, rPanel, rHero, rBtn] = RADII[t.radius];
    // Links and badges use the button color unless it would vanish on the
    // page (or card) behind them; then they use that area's text color.
    const pageLink = contrast(c.brand, c.bg) >= 3 ? c.brand : c.ink;
    const cardLink = contrast(c.brand, c.surface) >= 3 ? c.brand : c.surfaceInk;
    const vars = {
      "--bg": c.bg, "--surface": c.surface, "--ink": c.ink, "--brand": c.brand, "--accent": c.accent, "--footer": c.footer,
      "--heading": c.heading, "--card-ink": c.surfaceInk, "--page-ink": c.ink,
      "--link": pageLink, "--card-link": cardLink,
      "--brand-ink": onColor(c.brand), "--footer-ink": onColor(c.footer),
      // Secondary text and lines, on the page and (book.css re-scopes these) on cards.
      "--ink-2": `color-mix(in srgb, ${c.ink} 82%, ${c.bg})`,
      "--muted": `color-mix(in srgb, ${c.ink} 64%, ${c.bg})`,
      "--line": `color-mix(in srgb, ${c.ink} 12%, ${c.bg})`,
      "--field-line": `color-mix(in srgb, ${c.ink} 24%, ${c.bg})`,
      "--card-ink-2": `color-mix(in srgb, ${c.surfaceInk} 82%, ${c.surface})`,
      "--card-muted": `color-mix(in srgb, ${c.surfaceInk} 64%, ${c.surface})`,
      "--card-line": `color-mix(in srgb, ${c.surfaceInk} 12%, ${c.surface})`,
      "--card-field-line": `color-mix(in srgb, ${c.surfaceInk} 24%, ${c.surface})`,
      "--brand-soft": `color-mix(in srgb, ${c.brand} 10%, ${c.surface})`,
      "--brand-hover": `color-mix(in srgb, ${c.brand} 82%, #000)`,
      "--chip": `color-mix(in srgb, ${pageLink} 13%, ${c.bg})`,
      "--placeholder": `color-mix(in srgb, ${c.brand} 14%, ${c.bg})`,
      "--eyebrow": `color-mix(in srgb, ${c.accent} 35%, #ffffff)`,
      "--footer-muted": `color-mix(in srgb, ${onColor(c.footer)} 68%, ${c.footer})`,
      "--font-head": FONTS[t.headingFont].stack, "--font-body": FONTS[t.bodyFont].stack,
      "--head-weight": String(HEAD_WEIGHT[t.headingFont] || 600),
      "--head-track": HEAD_TRACK[t.headingFont] || "0em",
      "--r-input": rIn + "px", "--r-card": rCard + "px", "--r-panel": rPanel + "px", "--r-hero": rHero + "px", "--r-btn": rBtn + "px"
    };
    Object.entries(vars).forEach(([k, v]) => d.documentElement.style.setProperty(k, v));
    d.documentElement.dataset.theme = t.preset;
    let link = d.getElementById("shThemeFonts");
    if (!link) {
      link = d.createElement("link");
      link.id = "shThemeFonts";
      link.rel = "stylesheet";
      d.head.appendChild(link);
    }
    const href = fontsHref(t);
    if (link.href !== href) {
      link.href = href;
      if (link.addEventListener && d.fonts) {
        const faces = [`${HEAD_WEIGHT[t.headingFont] || 600} 1em "${FONTS[t.headingFont].family}"`,
          `400 1em "${FONTS[t.bodyFont].family}"`, `600 1em "${FONTS[t.bodyFont].family}"`];
        fontsLoading.set(d, new Promise((done) => {
          link.addEventListener("load", done, { once: true });
          link.addEventListener("error", done, { once: true });
        }).then(() => Promise.all(faces.map((f) => d.fonts.load(f)))).catch(() => {}));
      }
    }
    return t;
  }
  const fontsLoading = new WeakMap();
  /* Resolves once the applied theme's fonts can draw (or failed to load), so
     the booking page can appear in them instead of swapping fonts after. */
  function fontsReady(doc) {
    return fontsLoading.get(doc || document) || Promise.resolve();
  }

  /* The theme each booking page last showed, so a return visit paints in the
     property's own colors and fonts straight away (book.js saves it on every
     load). Keyed by the page's address for the property: host + ?property=. */
  const SAVED = "sh-booking-themes";
  function savedKey() {
    const q = new URLSearchParams(location.search);
    return location.hostname + "|" + (q.get("property") || q.get("slug") || "");
  }
  function savedTheme() {
    try { return JSON.parse(localStorage.getItem(SAVED) || "{}")[savedKey()] || null; } catch { return null; }
  }
  function rememberTheme(raw) {
    try {
      const all = JSON.parse(localStorage.getItem(SAVED) || "{}");
      delete all[savedKey()];
      all[savedKey()] = raw && typeof raw === "object" ? raw : {};
      const keys = Object.keys(all);
      keys.slice(0, Math.max(0, keys.length - 20)).forEach((k) => { delete all[k]; });
      localStorage.setItem(SAVED, JSON.stringify(all));
    } catch { /* storage off: the next visit starts in the default theme */ }
  }

  /* unitNoun: a UNITS key, "custom" (owner-typed words) or "" (Automatic). */
  function unitFields(t) {
    if (t.unitNoun === "custom") {
      const one = clean(t.unitOne, 24), many = clean(t.unitMany, 24);
      if (UNIT_WORD.test(one)) return { unitNoun: "custom", unitOne: one, unitMany: UNIT_WORD.test(many) ? many : one + "s" };
      return { unitNoun: "", unitOne: "", unitMany: "" };
    }
    return { unitNoun: UNIT_NOUNS[t.unitNoun] ? t.unitNoun : "", unitOne: "", unitMany: "" };
  }
  /* Words for the booking page: the owner's choice, else a guess from the
     room type / room names, else the neutral "stay". */
  function unitWords(t, names) {
    if (t && t.unitNoun === "custom" && t.unitOne) return { one: t.unitOne, many: t.unitMany || t.unitOne + "s" };
    if (t && UNIT_NOUNS[t.unitNoun]) return UNIT_NOUNS[t.unitNoun];
    const text = String(names || "").toLowerCase();
    const hit = UNITS.find(([, , , re]) => re && re.test(text));
    return hit ? UNIT_NOUNS[hit[0]] : GENERIC_UNIT;
  }
  /* "a cabin" / "an RV site" / "an apartment" / "a unit". */
  const withArticle = (word) => ((/^(rv\b|[aeio])/i.test(word) || /^u(?!ni|s[eu])/i.test(word) ? "an " : "a ") + word);

  // book.html loads this with data-apply: paint the property's last-seen
  // theme (else the default) right away, before the page draws (no inline
  // script needed, so the CSP can forbid inline scripts).
  if (typeof document !== "undefined" && document.currentScript && document.currentScript.hasAttribute("data-apply")) apply(savedTheme() || {});

  /* Studio font pickers: every allowlisted face, subset to just the letters
     of the font names, so each option can be shown in its own typeface. */
  function previewFontsHref() {
    const keys = Object.keys(FONTS);
    const text = [...new Set(keys.map((k) => FONTS[k].label).join("").concat("Aa"))].sort().join("");
    return "https://fonts.googleapis.com/css2?" + keys.map((k) => "family=" + FONTS[k].family.replace(/ /g, "+") + ":" + FONTS[k].spec).join("&") +
      "&text=" + encodeURIComponent(text) + "&display=swap";
  }

  window.SHTheme = { FONTS, HEAD_WEIGHT, PRESETS, COLOR_KEYS, RADII, UNITS, UNIT_NOUNS, DEFAULT_PRESET, normalize, apply, contrast, onColor, fontsHref, previewFontsHref, unitWords, withArticle, isHex, fontsReady, rememberTheme };
})();
