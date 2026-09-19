/* Eat at State — Lunch Menus PWA */
(function () {
  "use strict";

  const CATEGORIES = ["entree", "side", "grain", "salad", "dessert", "beverage", "other"];
  const CAT_LABEL = {
    entree: "Entrees", side: "Sides", grain: "Grains",
    salad: "Salads", dessert: "Desserts", beverage: "Beverages", other: "Other",
  };
  const CAT_EMOJI = {
    entree: "\u{1F37D}\uFE0F", side: "\u{1F35F}", grain: "\u{1F35E}",
    salad: "\u{1F957}", dessert: "\u{1F370}", beverage: "\u{1F964}", other: "\u{1F9C2}",
  };
  const STORE_KEY = "eas-lunch-cache";

  /* ---------- dietary tags (rule-based, from ingredient lists) ----------
     Conservative by design: an item is tagged only when the evidence is
     unambiguous. A false "vegan"/"gluten-free" is worse than no tag, so
     anything needing judgment (cross-contact, "may contain", hidden gluten in
     flavorings) is treated as not-dietary. vegan ⊂ vegetarian — one check
     covers both. */

  const MEAT_RE = /\b(beef|veal|steak|hamburg|chicken|turkey|drumstick|wing|thigh|bacon|pancetta|prosciutto|salami|pepperoni|ham\b|pork|sausage|chorizo|andouille|frankfurter|hot dog|lamb|game meat|venison|bison|brisket|ribs?|meat|meatballs?|meatloaf|jerky|duck\b|goose\b|lard|anchov|sardines?|salmon|tuna|cod|tilapia|trout|mackerel|pollock|whitefish|fish|fish sauce|clams?|shrimp|prawn|crab|lobster|scallop|calamari|oyster|caviar)\b/i;
  // Plant-based milks/creams contain the dairy words ("almond milk") — strip
  // them before testing, or vegan/dairy-free items made with them would be
  // excluded. Animal milks (cow/goat/buffalo) are NOT in this list: they are
  // real dairy.
  const PLANT_DAIRY_RE = /\b(?:almond|soy|coconut|oat|rice|cashew|peanut|hemp|macadamia) (?:milk|cream|butter|yogurt)\b/gi;
  // "Cream of tartar" (a baking acid) and "cream of coconut" are not dairy.
  const CREAM_NONDAIRY_RE = /\bcream of (?:tartar|coconut)\b/gi;
  const DAIRY_RE = /\b(milk|lactose|whey|casein|butter|ghee|cheese|queso|cream|sour cream|half and half|buttermilk|yogurt|yoghurt|parmesan|mozzarella|cheddar|feta|ricotta|crème|quark|curd)\b/i;
  // Real gluten sources. \b keeps "buckwheat" out (it is gluten-free). Malt is
  // flagged except its sugar derivatives (maltodextrin/maltitol/maltose).
  const GLUTEN_RE = /\b(wheat|barley|rye|spelt|triticale|farro|durum|semolina|couscous|bulgur|seitan|kamut|einkorn|emmer|malt(?!odextrin|itol|ose))\b/i;
  // Oats carry a cross-contamination risk, so they are treated as gluten
  // unless the item explicitly declares itself gluten-free (certified GF oats).
  const OATS_RE = /\b(oats?|oat ?meal|oat ?flour|oat ?bran)\b/i;
  const GF_EXEMPT_RE = /\bgluten[- ]?free\b/i;
  const EGG_RE = /\b(eggs?|egg white|egg yolk|albumin|mayo|mayonnaise|meringue|aioli|eclair)\b/i;
  const HONEY_RE = /\b(honey)\b/i;
  const GELATIN_RE = /\b(gelatin|gelatine|isinglass)\b/i; // animal-derived, vegan-only concern
  // Whole-word "nut" is safe: \b keeps butternut/nutmeg/nutty out.
  const NUT_RE = /\b(peanut|groundnut|almond|cashew|walnut|hazelnut|pistachio|pecan|macadamia|pine nut|tree nut|nut)\b/i;
  const DIETS = [
    { id: "vegetarian", label: "Vegetarian", test: (t) => !MEAT_RE.test(t) },
    { id: "vegan",      label: "Vegan",      test: (t) => {
      const p = t.replace(PLANT_DAIRY_RE, " ");
      return !MEAT_RE.test(p) && !DAIRY_RE.test(p) && !EGG_RE.test(p) && !HONEY_RE.test(p) && !GELATIN_RE.test(p);
    } },
    { id: "nutfree",    label: "Nut-free",   test: (t) => !NUT_RE.test(t) },
    { id: "glutenfree", label: "Gluten-free", test: (t) =>
      !GLUTEN_RE.test(t) && (!OATS_RE.test(t) || GF_EXEMPT_RE.test(t)) },
    { id: "dairyfree",  label: "Dairy-free", test: (t) => {
      const p = t.replace(PLANT_DAIRY_RE, " ").replace(CREAM_NONDAIRY_RE, " ");
      return !DAIRY_RE.test(p);
    } },
  ];
  // Returns the diet ids an item satisfies, or null when the item has no
  // ingredient list to judge (then it matches no filter, ever). Prefers the
  // server-computed `item.diet` field (Go DietTags, same rules); falls back
  // to local computation for pre-tag snapshots / old cached data.
  function dietTags(item) {
    if (Array.isArray(item.diet) && item.diet.length) return item.diet;
    const t = (item.ingredients || "").toLowerCase();
    if (!t) return null;
    return DIETS.filter((d) => d.test(t)).map((d) => d.id);
  }
  // A diet filter matches an entry when the item carries that tag. Null tags
  // (no ingredient data) never match — conservative.
  function dietMatches(entry, dietId) {
    const tags = dietTags(entry.item);
    return tags ? tags.includes(dietId) : false;
  }

  // Static (GitHub Pages) mode: no backend, load the latest snapshot from
  // the data/ directory (published from the data branch).
  // Also enabled with ?static=1 for testing against a local server.
  const STATIC = location.hostname.endsWith(".github.io") ||
    new URLSearchParams(location.search).has("static");
  let staticDate = null; // YYYY-MM-DD of the newest date dir (data/<date>/) that has data

  const state = {
    data: null,          // {meal, date, fetched_at, halls:[...]}
    meal: "lunch",
    date: null,
    hallIndex: 0,
    view: "categories",   // "stations" | "categories" | "nutrition"
    cats: new Set(),     // empty = all; categories view only
    stations: new Set(), // empty = all; stations view only (per-session)
    proteins: new Set(), // empty = all; nutrition view only (per-session)
    dietFilters: new Set(), // dietary filters (all views), persisted
    showCarried: false,  // "breakfast menu also served" items hidden by default (all views)
    query: "",
    loading: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- theme (dark default, light opt-in) ---------- */

  const THEME_KEY = "eas-theme";
  const STATION_STATE_KEY = "eas-stations-collapsed"; // ["<hall>||<station>", ...] — collapsed set
  const VIEW_KEY = "eas-view";       // "stations" | "categories" | "nutrition"
  const HALL_KEY = "eas-hall";       // hall name (index shifts when halls close, so persist by name)
  const CAT_STATE_KEY = "eas-cats-collapsed"; // [category id, ...] — collapsed set (Categories view)
  const CARRIED_KEY = "eas-show-carried";     // "0"/"1" — "breakfast menu also served" items shown (all views)
  const DIET_KEY = "eas-diet-filters";        // ["vegan","vegetarian",...] — active diet filters
  const FILTER_SEEN_KEY = "eas-filter-seen";  // "1" — first-run "Filters" FAB hint already shown
  // Restore the carried-items visibility switch (default: hidden — the
  // hall's carried-over breakfast menu crowds the list in every view).
  try { state.showCarried = localStorage.getItem(CARRIED_KEY) === "1"; } catch (e) {}
  // Restore persisted dietary filters (a person's diet is stable, so this is
  // the one chip set that survives reloads — unlike the per-session expand sets).
  try {
    const dv = JSON.parse(localStorage.getItem(DIET_KEY) || "[]");
    if (Array.isArray(dv)) state.dietFilters = new Set(dv.filter((id) => DIETS.some((d) => d.id === id)));
  } catch (e) {}
  function isLight() { return document.documentElement.classList.contains("light"); }
  // "system" (default) follows the OS; explicit "light"/"dark" wins.
  function themeSetting() {
    try { return localStorage.getItem(THEME_KEY) || "system"; } catch (e) { return "system"; }
  }
  const lightMQ = window.matchMedia("(prefers-color-scheme: light)");
  function applyTheme() {
    const s = themeSetting();
    document.documentElement.classList.toggle("light", s === "light" || (s === "system" && lightMQ.matches));
    applyThemeMenu();
  }
  const ICON_M = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  const ICON_S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  const ICON_SYS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';
  function applyThemeMenu() {
    const item = $("#menu-theme");
    if (!item) return;
    const s = themeSetting();
    const light = isLight();
    item.querySelector(".mi-ico").innerHTML = s === "system" ? ICON_SYS : (light ? ICON_M : ICON_S);
    item.querySelector(".mi-label").textContent = "Theme";
    item.querySelector(".mi-state").textContent = s === "system" ? "System" : (light ? "Light" : "Dark");
    item.title = "Theme: " + (s === "system" ? "follow system" : light ? "Light" : "Dark") + " — tap to change";
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add("show"));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => { t.hidden = true; }, 220);
    }, 2200);
  }

  async function shareSite() {
    const url = location.origin + location.pathname;
    if (navigator.share) {
      gaEvent("share", { share_target: "site", share_method: "native" });
      try {
        await navigator.share({
          title: "Eat@State — MSU dining menus",
          text: "MSU campus dining menus, simplified.",
          url,
        });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // user dismissed the sheet
        // share failed (e.g. insecure context) — fall through to copy
      }
    }
    gaEvent("share", { share_target: "site", share_method: "copy" });
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied");
    } catch (e) {
      window.prompt("Copy this link:", url);
    }
  }

  const moreMenu = $("#more-menu");
  const mealBtn = $("#meal-btn");
  // The overflow menu opens from the meal button, which shows the active
  // meal + date and holds the meal picker plus the secondary actions.
  function closeMoreMenu() {
    if (!moreMenu) return;
    moreMenu.classList.remove("open");
    if (mealBtn) {
      mealBtn.classList.remove("menu-open");
      mealBtn.setAttribute("aria-expanded", "false");
    }
  }
  function openMoreMenu() {
    if (!moreMenu) return;
    moreMenu.classList.add("open");
    if (mealBtn) {
      mealBtn.classList.add("menu-open");
      mealBtn.setAttribute("aria-expanded", "true");
    }
  }
  function toggleMoreMenu() {
    moreMenu.classList.contains("open") ? closeMoreMenu() : openMoreMenu();
  }

  function initMoreMenu() {
    // html.light already applied pre-paint by the head bootstrap.
    mealBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMoreMenu();
    });
    document.addEventListener("click", (e) => {
      if (moreMenu.classList.contains("open") && !moreMenu.contains(e.target)) closeMoreMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMoreMenu();
    });
    window.addEventListener("resize", () => closeMoreMenu());

    $("#menu-theme").addEventListener("click", () => {
      // Cycle System → Light → Dark → System. "system" is the default
      // (follow the OS) until the user explicitly picks one.
      const order = ["system", "light", "dark"];
      const next = order[(order.indexOf(themeSetting()) + 1) % order.length];
      try {
        if (next === "system") localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch (e) {}
      applyTheme();
      closeMoreMenu();
    });
    // Live-follow the OS while the setting is "system".
    if (lightMQ.addEventListener) {
      lightMQ.addEventListener("change", () => { if (themeSetting() === "system") applyTheme(); });
    }
    // Refresh is PWA-only: the static site has no live source to refetch.
    if (STATIC) $("#menu-refresh").hidden = true;
    $("#menu-refresh").addEventListener("click", () => {
      closeMoreMenu();
      doFetch(state.meal, { force: true });
    });
    $("#menu-share").addEventListener("click", () => {
      closeMoreMenu();
      shareSite();
    });
    $("#menu-hours").addEventListener("click", () => {
      closeMoreMenu();
      openHoursModal();
    });
    $("#menu-about").addEventListener("click", () => {
      closeMoreMenu();
      openAboutModal();
    });
    applyTheme(); // align the menu label with the (pre-paint) applied theme
  }

  /* ---------- data ---------- */

  function loadCache(meal, date) {
    try {
      const raw = localStorage.getItem(STORE_KEY + ":" + meal + ":" + date);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveCache(meal, date, data) {
    try {
      localStorage.setItem(STORE_KEY + ":" + meal + ":" + date, JSON.stringify(data));
      // prune old dates (keep only today per meal)
      const prefix = STORE_KEY + ":";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix) && k !== STORE_KEY + ":" + meal + ":" + date) {
          const d = k.slice(prefix.length).split(":").pop();
          if (d < todayStr()) localStorage.removeItem(k);
        }
      }
    } catch (e) { /* quota — ignore */ }
  }

  function todayStr() {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(new Date());
    } catch (e) {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
  }

  // Date string (America/Detroit) for offsetDays days ago from today.
  function detDateStr(offsetDays) {
    const d = new Date(Date.now() - offsetDays * 86400000);
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit" }).format(d);
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

  // Fetch one per-meal snapshot from data/<date>/<meal>.json; null if absent.
  async function fetchMealFile(date, meal) {
    try {
      const res = await fetch("data/" + date + "/" + meal + ".json", { cache: "no-cache" });
      if (!res.ok) return null;
      const f = await res.json();
      if (f && Array.isArray(f.halls) && f.halls.length) return f;
      return null;
    } catch (e) { return null; }
  }

  // Resolve the newest date (today back 7 days) that actually has menu data,
  // by probing a representative meal file. Cached for the session so meal-tab
  // switches don't re-probe.
  async function loadStatic(force) {
    if (staticDate && !force) return true;
    staticDate = null;
    for (let i = 0; i < 7; i++) {
      const key = detDateStr(i);
      for (const probe of ["lunch", "breakfast", "dinner"]) {
        if (await fetchMealFile(key, probe)) { staticDate = key; return true; }
      }
    }
    return false;
  }

  // Find the newest date (newest first, back 7 days) that has data for THIS
  // meal — a date can be present but lack a meal file (all halls closed).
  async function findMealData(meal) {
    const order = [];
    if (staticDate) order.push(staticDate);
    for (let i = 0; i < 7; i++) order.push(detDateStr(i));
    const seen = new Set();
    for (const date of order) {
      if (seen.has(date)) continue;
      seen.add(date);
      const d = await fetchMealFile(date, meal);
      if (d) return { date: date, data: d };
    }
    return null;
  }

  async function fetchMenusStatic(meal, force, seq) {
    state.meal = meal;
    renderChrome();
    state.loading = true;
    const btn = $("#menu-refresh");
    if (btn) btn.classList.add("spinning");
    try {
      if (!staticDate || force) {
        const c = $("#content");
        c.innerHTML = "";
        c.appendChild(el("div", "status", "Loading menu data…"));
        await loadStatic(force);
      }
      const found = await findMealData(meal);
      if (seq !== undefined && seq !== reqSeq) return; // superseded
      if (!found) {
        const c = $("#content");
        c.innerHTML = "";
        c.appendChild(el("div", "empty",
          staticDate ? "No " + meal + " data in the latest snapshot."
                     : "No menu data found. Check the data branch in the repository."));
        return;
      }
      state.data = {
        meal: meal,
        date: found.date,
        fetched_at: found.data.fetched_at,
        halls: found.data.halls,
      };
      state.date = found.date;
      render();
    } finally {
      if (seq === undefined || seq === reqSeq) {
        state.loading = false;
        if (btn) btn.classList.remove("spinning");
      }
    }
  }

  // Dispatch to the live API or static snapshot depending on mode. One
  // request-sequence counter covers both paths so a slow response can never
  // overwrite a newer one (rapid meal-tab switching).
  let reqSeq = 0;
  function doFetch(meal, opts) {
    const seq = ++reqSeq;
    if (STATIC) return fetchMenusStatic(meal, opts && opts.force, seq);
    return fetchMenus(meal, todayStr(), seq);
  }

  async function fetchMenus(meal, date, seq) {
    state.meal = meal;
    renderChrome();
    state.loading = true;
    const btn = $("#menu-refresh");
    if (btn) btn.classList.add("spinning");
    try {
      const res = await fetch("/api/menus?meal=" + meal + "&date=" + (date || todayStr()));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (seq !== reqSeq) return; // superseded by a newer request
      state.data = data;
      state.date = data.date;
      saveCache(data.meal, data.date, data);
      render();
    } catch (err) {
      if (seq !== reqSeq) return;
      const cached = loadCache(meal, state.date || date || todayStr());
      if (cached) {
        state.data = cached;
        state.date = cached.date;
        showOffline(true);
        render();
      } else {
        showError(err.message);
      }
    } finally {
      if (seq === reqSeq) {
        state.loading = false;
        if (btn) btn.classList.remove("spinning");
      }
    }
  }

  function showError(msg) {
    state.data = null;
    closeFiltersSheet();
    $("#hall-track").innerHTML = "";
    $("#content").innerHTML = "";
    const d = el("div", "error");
    d.appendChild(el("div", null, "Could not load menus"));
    d.appendChild(el("div", null, msg));
    d.appendChild(el("div", null, "Check your connection and pull to refresh."));
    $("#content").appendChild(d);
  }

  function showOffline(on) {
    $("#offline-banner").hidden = !on;
  }

  /* ---------- derived data ---------- */

  function matches(q, entry) {
    // Dietary filters combine as AND (vegan + nut-free = both must hold) —
    // that's what a person's actual constraints mean.
    if (state.dietFilters.size) {
      for (const d of state.dietFilters) if (!dietMatches(entry, d)) return false;
    }
    if (!q) return true;
    const hay = (entry.item.name + " " + (entry.item.desc || "") + " " + entry.hall + " " + entry.station).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  /* ---------- rendering ---------- */

  function syncMealBtn() {
    // Meal button shows the active meal + the date the data is for
    // (compact "Lunch · Sep 16"). The full picker lives in the menu.
    const label = $("#meal-btn-label");
    if (!label) return;
    const mealText = state.meal.charAt(0).toUpperCase() + state.meal.slice(1);
    let datePart = "";
    if (state.date) {
      const d = new Date(state.date + "T12:00:00"); // local noon → date-safe
      datePart = " · " + new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
    }
    label.textContent = mealText + datePart;
    // Keep the in-menu tabs' active state + the brand date label in step.
    ["breakfast", "lunch", "dinner"].forEach((x) => {
      const b = $("#meal-" + x);
      if (b) {
        b.classList.toggle("active", x === state.meal);
        b.setAttribute("aria-selected", String(x === state.meal));
      }
    });
  }

  function renderChrome() {
    if (state.date) $("#date-label").textContent = state.date;
    syncMealBtn();
    document.title = "Eat@State - Simplified";
  }

  function render() {
    if (!state.data) return;
    renderChrome();
    renderHallRow();
    $("#date-label").textContent = state.date;
    $("#fetched-at").textContent =
      "Updated " + new Date(state.data.fetched_at).toLocaleString() + " · " + state.meal;
    renderContentOnly();
    if (!$("#filters-sheet").hidden) renderFiltersSheet();
    syncFilterFab();
  }

  let userPickedHall = false; // set on chip click; persisted hall only applies before that
  function renderHallRow() {
    const row = $("#hall-track");
    row.innerHTML = "";
    const halls = state.data.halls;
    // Closed halls stay in the row (dimmed, labelled) — selecting one shows
    // a clear "closed for <meal>" message in the content area instead of
    // silently falling back to another hall.
    const open = halls.map((h, i) => ({ h, i })).filter((e) => !e.h.closed);
    if (open.length) {
      if (!userPickedHall) {
        // First render of this session: restore the persisted hall by name
        // (name, not index — the index shifts when halls are closed).
        // A persisted hall that is closed for this meal is kept as the
        // selection: its chip shows and the content says so.
        let saved = null;
        try { saved = localStorage.getItem(HALL_KEY); } catch (e) {}
        const byNameIdx = halls.findIndex((h) => h.name === saved);
        const match = open.find((e) => e.h.name === saved);
        // A persisted hall that is closed for this meal is kept as the
        // selection: its chip shows and the content says so.
        state.hallIndex = byNameIdx !== -1 ? byNameIdx : (match || open[0]).i;
      }
      // (No silent fallback when the selection is closed: the content area
      // renders the closed message, and the user can tap another chip.)
    }
    halls.forEach((h, i) => {
      const closed = !!h.closed;
      const b = el("button", "hall-chip" + (i === state.hallIndex ? " active" : "") + (closed ? " closed" : ""));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === state.hallIndex));
      b.textContent = h.name + (closed ? "  closed" : "");
      b.addEventListener("click", () => {
        userPickedHall = true;
        state.hallIndex = i;
        if (!closed) { try { localStorage.setItem(HALL_KEY, h.name); } catch (e) {} }
        gaEvent("select_hall", { hall: h.name, meal: state.meal, closed: closed });
        renderHallRow();
        if (!$("#filters-sheet").hidden) renderFiltersSheet();
        syncFilterFab();
        renderContentOnly();
      });
      row.appendChild(b);
    });
    // Restored (persisted) hall: center it in the horizontal scroller.
    // Skipped once the user has clicked a chip this session. Manual
    // scrollLeft (not scrollIntoView) so the page never scrolls vertically.
    const activeChip = row.querySelector(".hall-chip.active");
    if (activeChip && !userPickedHall) {
      row.scrollLeft = activeChip.offsetLeft - (row.clientWidth - activeChip.clientWidth) / 2;
    }
    syncHallFades();
  }

  // Hall chip row: soft edge fades signal more halls off-screen (the row's
  // scrollbar is hidden). .at-start/.at-end on the row are updated on
  // scroll, resize, and after each render.
  function syncHallFades() {
    const row = $("#hall-track");
    const wrap = row && row.parentElement; // .hall-row
    if (!row || !wrap) return;
    const max = row.scrollWidth - row.clientWidth;
    wrap.classList.toggle("at-start", max <= 0 || row.scrollLeft <= 2);
    wrap.classList.toggle("at-end", max <= 0 || row.scrollLeft >= max - 2);
  }

  /* ---------- filters (FAB + bottom sheet) ----------
     All filter controls — category chips, dietary chips, the "from
     breakfast" switch — live in one bottom sheet behind the floating
     Filters button. Content re-renders live as chips toggle (no Apply
     step); the FAB badge shows how many filters are active. */

  // Scope mirrors the content: all halls while searching, else the selected
  // hall only. Counts don't apply the text query itself (same rule the old
  // chip rows had).
  function rawScopeEntries() {
    if (state.query) return allHallItems();
    const hall = (state.data.halls[state.hallIndex] || state.data.halls[0]);
    return hall && !hall.closed && !hall.error ? hallItems(hall) : [];
  }
  // Distinct station names in scope, in first-appearance order (chip list
  // for the Stations view's section filter).
  function scopeStationNames() {
    const out = [];
    const seen = new Set();
    for (const e of rawScopeEntries()) if (!seen.has(e.station)) { seen.add(e.station); out.push(e.station); }
    return out;
  }
  function filterScopeEntries() {
    const entries = rawScopeEntries();
    // Carried items are hidden in EVERY view unless the switch is on —
    // the counts should say what the view will actually show.
    if (!state.query && !state.showCarried) {
      return entries.filter((e) => !e.item.carried);
    }
    return entries;
  }
  // Filters that are active in the CURRENT view: each view's section filter
  // (Categories/Stations/Proteins) counts only in that view; diet and
  // carried-items are global.
  function activeFilterCount() {
    let n = state.dietFilters.size;
    if (state.view === "categories") n += state.cats.size;
    else if (state.view === "stations") n += state.stations.size;
    else if (state.view === "nutrition") n += state.proteins.size;
    return n;
  }
  function canFilter() {
    if (!state.data) return false;
    return filterScopeEntries().length > 0;
  }

  function syncFilterFab() {
    const fab = $("#filters-fab");
    const wrap = $("#filters-fab-wrap");
    const badge = $("#filters-badge");
    const sheet = $("#filters-sheet");
    if (!fab || !badge || !sheet) return;
    const open = !sheet.hidden;
    fab.classList.toggle("open", open);
    fab.setAttribute("aria-expanded", String(open));
    const disabled = !open && !canFilter();
    fab.classList.toggle("disabled", disabled);
    fab.toggleAttribute("disabled", disabled);
    const n = activeFilterCount();
    badge.hidden = n === 0;
    badge.textContent = String(n);
    // Filter changes flip the fade state too (the observer only re-fires on
    // scroll changes, not on content re-renders).
    if (typeof syncFabAway === "function") syncFabAway();
    // First-run discoverability: a "Filters" label sits next to the FAB
    // until the user opens the sheet once (FILTER_SEEN_KEY).
    let seen = false;
    try { seen = localStorage.getItem(FILTER_SEEN_KEY) === "1"; } catch (e) {}
    if (wrap) wrap.classList.toggle("hint", !open && !seen);
  }

  function renderFiltersSheet() {
    const body = $("#filters-body");
    const meta = $("#filters-meta");
    if (!body || !meta) return;
    if (!state.data) { syncFilterFab(); return; }
    let scope;
    const mealCap = state.meal.charAt(0).toUpperCase() + state.meal.slice(1);
    if (state.query) scope = "All halls · " + mealCap + " · \u201c" + state.query + "\u201d";
    else {
      const hall = state.data.halls[state.hallIndex] || state.data.halls[0];
      scope = (hall ? hall.name : "") + " · " + mealCap;
    }
    meta.textContent = scope;

    const entries = filterScopeEntries();
    body.innerHTML = "";

    // "Breakfast menu also served" — a scope/display control (which meal's
    // items are shown), not a personal constraint, so it sits at the TOP
    // under the scope line, above the Categories/Dietary attribute filters.
    // All three views; only when the scope contains carried-over items.
    const hasCarried = rawScopeEntries().some((e) => e.item.carried);
    if (hasCarried) {
      const w = el("button", "switch switch-row" + (state.showCarried ? " on" : ""));
      w.type = "button";
      w.setAttribute("role", "switch");
      w.setAttribute("aria-checked", String(state.showCarried));
      w.title = (state.showCarried ? "Hide" : "Show") + " breakfast menu items also served at " + state.meal;
      w.appendChild(el("span", "sw-track"));
      // Meaning: the hall's breakfast menu is ALSO served at the selected
      // meal; the switch shows/hides those carried-over items. Neutral label
      // (ON/OFF is visible on the switch; the title says what tapping does,
      // with the actual meal name).
      w.appendChild(el("span", "sw-label", "Breakfast menu also served"));
      w.addEventListener("click", () => {
        state.showCarried = !state.showCarried;
        try { localStorage.setItem(CARRIED_KEY, state.showCarried ? "1" : "0"); } catch (e) {}
        afterFilterChange();
      });
      body.appendChild(w);
    }

    // Section filter — one row per view (per-session, not persisted),
    // matching each view's own grouping: Categories view filters dish
    // categories, Stations view filters stations, Nutrition view filters
    // proteins. A view only ever shows its own row, so nothing here can
    // silently affect another view.
    const sectionSpec = state.view === "categories"
      ? { label: "Categories", set: state.cats,
          items: CATEGORIES.map((c) => ({ id: c, name: CAT_LABEL[c], emoji: CAT_EMOJI[c] })),
          count: (e, id) => (e.item.cat === id ? 1 : 0) }
      : state.view === "stations"
      ? { label: "Stations", set: state.stations,
          items: scopeStationNames().map((n) => ({ id: n, name: n, emoji: "" })),
          count: (e, id) => (e.station === id ? 1 : 0) }
      : { label: "Proteins", set: state.proteins,
          items: PROTEINS.map((p) => ({ id: p.id, name: p.label, emoji: p.emoji })),
          count: (e, id) => (detectProteins(e.item.name).some((p) => p.id === id) ? 1 : 0) };
    const secCounts = {};
    for (const e of entries)
      for (const it of sectionSpec.items)
        secCounts[it.id] = (secCounts[it.id] || 0) + sectionSpec.count(e, it.id);
    body.appendChild(el("h3", "filters-label", sectionSpec.label));
    const secWrap = el("div", "filters-chips");
    const allSec = el("button", "cat-chip" + (sectionSpec.set.size === 0 ? " active" : ""));
    allSec.type = "button";
    allSec.textContent = "All";
    allSec.addEventListener("click", () => { sectionSpec.set.clear(); afterFilterChange(); });
    secWrap.appendChild(allSec);
    const totalSecs = sectionSpec.items.filter((it) => secCounts[it.id]).length;
    for (const it of sectionSpec.items) {
      if (!secCounts[it.id]) continue;
      const b = el("button", "cat-chip" + (sectionSpec.set.has(it.id) ? " active" : ""));
      b.type = "button";
      b.appendChild(document.createTextNode((it.emoji ? it.emoji + " " : "") + it.name));
      // "Other" (categories) is a catch-all (condiments, toppings, produce,
      // build-your-own) whose count is always the largest by far — it reads
      // as noise, not a useful size cue, so drop its badge and let the real
      // categories' counts stay comparable. The count still reaches screen
      // readers.
      if (sectionSpec.label === "Categories" && it.id === "other") b.setAttribute("aria-label", it.name + " " + secCounts[it.id]);
      else b.appendChild(el("span", "n", String(secCounts[it.id])));
      b.addEventListener("click", () => {
        if (sectionSpec.set.has(it.id)) sectionSpec.set.delete(it.id); else sectionSpec.set.add(it.id);
        if (sectionSpec.set.size === totalSecs) sectionSpec.set.clear();
        afterFilterChange();
      });
      secWrap.appendChild(b);
    }
    body.appendChild(secWrap);

    // Dietary (personal constraints — persisted in eas-diet-filters).
    body.appendChild(el("h3", "filters-label", "Dietary"));
    const dietWrap = el("div", "filters-chips");
    for (const d of DIETS) {
      const n = entries.filter((e) => dietMatches(e, d.id)).length;
      const b = el("button", "diet-chip" + (state.dietFilters.has(d.id) ? " active" : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.dietFilters.has(d.id)));
      b.title = "Filter items that look " + d.label.toLowerCase() + " from their ingredient list";
      b.appendChild(document.createTextNode(d.label));
      b.appendChild(el("span", "n", String(n)));
      b.addEventListener("click", () => {
        if (state.dietFilters.has(d.id)) state.dietFilters.delete(d.id);
        else state.dietFilters.add(d.id);
        try { localStorage.setItem(DIET_KEY, JSON.stringify(Array.from(state.dietFilters))); } catch (e) {}
        gaEvent("toggle_diet_filter", { filter: d.id, on: state.dietFilters.has(d.id) });
        afterFilterChange();
      });
      dietWrap.appendChild(b);
    }
    body.appendChild(dietWrap);

    // Footer: Reset all — only when something is actually active. The sheet
    // applies every change live, so there's no "Done/Apply" to confirm; the
    // FAB (✕), backdrop, top-right ✕ and Escape all close it.
    const reset = el("button", "filters-reset", "Reset all");
    reset.type = "button";
    const anyActive = activeFilterCount() > 0 || state.showCarried;
    reset.hidden = !anyActive;
    if (anyActive) {
      const foot = el("div", "filters-foot");
      reset.addEventListener("click", () => {
        // Reset only what this view actually shows: each view's section
        // filter (cats/stations/proteins) is invisible in the other views,
        // so don't silently clear it from here.
        if (state.view === "categories") state.cats.clear();
        else if (state.view === "stations") state.stations.clear();
        else if (state.view === "nutrition") state.proteins.clear();
        state.dietFilters.clear();
        state.showCarried = false;
        try {
          localStorage.setItem(DIET_KEY, "[]");
          localStorage.setItem(CARRIED_KEY, "0");
        } catch (e) {}
        gaEvent("filter_reset", {});
        afterFilterChange();
      });
      foot.appendChild(reset);
      body.appendChild(foot);
    }
  }

  function afterFilterChange() {
    renderFiltersSheet();
    syncFilterFab();
    renderContentOnly();
  }

  function openFiltersSheet() {
    const m = $("#filters-sheet");
    if (!m || !m.hidden) return;
    gaEvent("filter_sheet_open", { view: state.view, search: !!state.query });
    m.hidden = false;
    document.body.style.overflow = "hidden";
    renderFiltersSheet();
    syncFilterFab();
  }
  function closeFiltersSheet() {
    const m = $("#filters-sheet");
    if (!m || m.hidden) return;
    m.hidden = true;
    document.body.style.overflow = "";
    syncFilterFab();
  }

  function renderContentOnly() {
    if (state.view === "stations") renderStations();
    else if (state.view === "categories") renderCategories();
    else renderNutrition();
  }

  function itemBadge(cat) {
    const b = el("span", "cat-badge" + (cat === "entree" ? " entree" : ""));
    b.textContent = cat;
    return b;
  }

  // Renders the trailing category badge on dish rows. Inside a category
  // section the badge is redundant (the section says it), so the Categories
  // view suppresses it — only Stations/search rows keep it.
  function appendItemBadge(b, cat, withBadge) {
    if (withBadge !== false && cat) b.appendChild(itemBadge(cat));
  }

  /* ---------- food-kind emoji (from dish names; first match wins, none = no emoji) ---------- */

      const FOOD_KINDS = [
    { id: "coffee", emoji: "☕", re: /\b(coffee|coffee ?mate|coffees?mate|latte|espresso|cappuccino|hot ?choc|cocoa|chocolate ?milk|decaf)\b/i },
    { id: "soda", emoji: "🥤", re: /\b(coke|pepsi|sprite|fanta|ginger ?ale|root ?beer|powerade|gatorade|slurpee|dr ?pepper|mountain ?dew|7-? ?up|barq|soda|pop)\b/i },
    { id: "drink", emoji: "🧃", re: /\b(juice|lemonade|smoothie|iced ?tea|tea|kombucha|water|punch|ade|cocktail|coconut ?water|berry ?blend)\b/i },
    { id: "cereal", emoji: "🥣", re: /\b(cereal|cereals|granola|oat ?meal|oats?|porridge|flakes|loops|puffs|charms|jacks|chex|grahams|bran|cheerios|special ?k|crunch|pebbles|musli|muesli|nature valley|cinnamon toast)\b/i },
    { id: "icecream", emoji: "🍦", re: /\b(ice ?cream|soft ?serve|frozen ?yogurt|cones?|sorbet)\b/i },
    { id: "cake", emoji: "🍰", re: /\b(cakes?|cheesecake|cupcakes?|muffins?|pie|brownies?|puddings?|jello|custard|flan|trifle|cobbler|parfait)\b/i },
    { id: "sweet", emoji: "🍩", re: /\b(donuts?|cookies?|whoopie|candy|chocolate|gummi|gummies?|marshmallows?|sprinkles|m&ms?|tootsie|peppermint|lollipop|licorice|peanut ?butter ?cups?|fudge|snickers|twix|skittles|star ?burst|reese|3 ?musketeers|jolly ranchers?|caramel)\b/i },
    { id: "yogurt", emoji: "🥛", re: /\b(yogurt|yoghurt)\b/i },
    { id: "vegan", emoji: "🌱", re: /\b(tofu|tempeh|seitan|edamame|vegan|veg ?gie|vegetarian|jackfruit)\b/i },
    { id: "chicken", emoji: "🍗", re: /\b(chicken|chick'n|turkey|drumstick|wings?)\b/i },
    { id: "beef", emoji: "🥩", re: /\b(lamb|beef|steak|roast ?beef|brisket|ribs?|salami|prosciutto|pastrami|corned ?beef|pepperoni|meat)\b/i },
    { id: "pork", emoji: "🐖", re: /\b(pork|ham)\b/i },
    { id: "fish", emoji: "🐟", re: /\b(fish|whitefish|salmon|tuna|cod|tilapia|trout|mackerel|anchov(y|ies)|sardines?|pollock)\b/i },
    { id: "shellfish", emoji: "🦐", re: /\b(shrimp|prawn|crab|lobster|scallop|calamari)\b/i },
    { id: "bacon", emoji: "🥓", re: /\b(bacon)\b/i },
    { id: "burger", emoji: "🍔", re: /\b(burgers?|cheeseburgers?|hamburgers?)\b/i },
    { id: "sausage", emoji: "🌭", re: /\b(sausages?|chorizo|andouille|hot ?dog|frankfurter|patties?)\b/i },
    { id: "sandwich", emoji: "🥪", re: /\b(sandwiches?|subs?|wraps?|panini|pitas?|club ?house|egg ?rolls?)\b/i },
    { id: "pizza", emoji: "🍕", re: /\b(pizza)\b/i },
    { id: "mexican", emoji: "🌮", re: /\b(tacos?|burrito|nachos?|fajita|quesadilla|enchilada|tortilla|guacamole|pico ?de ?gallo)\b/i },
    { id: "salad", emoji: "🥗", re: /\b(salads?|coleslaw)\b(?!\s+dressing)/i },
    { id: "soup", emoji: "🍲", re: /\b(soups?|stew|chili|bisque|chowder|pakora|curry)\b/i },
    { id: "beans", emoji: "🫘", re: /\b(bean|beans|lentils?|chickpeas?|hummus|falafels?)\b/i },
    { id: "potato", emoji: "🥔", re: /\b(potato|potatoes?|fries|frites|mashed|gratin|hash ?browns?|taters?)\b/i },
    { id: "noodle", emoji: "🍜", re: /\b(pad thai|ramen|sushi|dumplings?|spring ?rolls?|lo ?mein|chow ?mein|pho|udon|soba)\b/i },
    { id: "pasta", emoji: "🍝", re: /\b(pasta|macaroni|spaghetti|noodles?|penne|fettuccine|lasagna|gnocchi|orzo|farfalle|couscous)\b/i },
    { id: "rice", emoji: "🍚", re: /\b(rice|basmati|quinoa)\b/i },
    { id: "omelet", emoji: "🍳", re: /\b(omelets?|omelettes?)\b/i },
  { id: "egg", emoji: "🥚", re: /\b(eggs?)\b/i },
    { id: "cheese", emoji: "🧀", re: /\b(cheese|queso)\b/i },
    { id: "dairy", emoji: "🧈", re: /\b(butter|buttermilk|milk|cream|sour ?cream|half and half)\b/i },
    { id: "bread", emoji: "🍞", re: /\b(bread|bagels?|croissant|buns?|rolls?|biscuits?|crackers?|croutons|baguette|naan|focaccia|ciabatta|waffles?|pancakes?|french toast|grinder|powerseed|seeded)\b/i },
    { id: "fruit", emoji: "🍎", re: /\b(apples?|applesauce|bananas?|oranges?|grapes?|melons?|watermelon|strawberries?|blueberries?|peaches?|pears?|cherries?|pineapple|mango|kiwi|berries?|fruit|raisins?|apricots?|nectarine|cantaloupe|honeydew|cranberries?|pomegranate|coconut|dates?|clementines?)\b/i },
    { id: "citrus", emoji: "🍋", re: /\b(lemon|lime|orange|grapefruit)\b/i },
    { id: "veg", emoji: "🥦", re: /\b(broccoli|cauliflower|carrots?|corn|spinach|kale|lettuce|onions?|tomatoes?|peppers?|jalapenos?|squash|zucchini|cucumbers?|beets?|mushrooms?|celery|peas|asparagus|artichoke|avocado|green ?beans?|romaine|vegetables?|veggies?|greens?|sprouts?|olives?|radishes?|turnip|arugula|almonds?|nuts?|peanuts?|cashews?|walnuts?|spring ?mix|sprout ?mix|bok ?choy|garlic|giardiniera|cilantro|pepperoncinis?)\b/i },
    { id: "condiment", emoji: "🧂", re: /\b(ketchup|mustard|mayo|mayonnaise|jelly|jam|preserves|sauces?|dressing|salsa|vinaigrette|glaze|oil|vinegar|honey|salt|pretzels?|dips?|packets?|sugar|equal|sweetener|flavoring|tamari|soy|pickles?|pickled|seeds?|ginger|peanut ?butter|sunbutter|aioli|tabasco|chipotle|pesto|marinara|chili ?crisp|toppings?|cheetos?|ruffles?|lays?|wasabi|nori|furikake)\b/i }
  ];
function foodEmoji(name) {
    const n = name || "";
    for (const k of FOOD_KINDS) if (k.re.test(n)) return k.emoji;
    return "";
  }
  function foodEmojiSpan(item) {
    const e = foodEmoji(item.name);
    if (!e) return null;
    const s = el("span", "dish-emoji");
    s.textContent = e;
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  /* ---------- protein detection (from dish names; data has no such field) ---------- */

  const PROTEINS = [
    { id: "beef",      label: "Beef",      emoji: "🥩", re: /\b(beef|steak|hamburg?er|roast beef)\b/i },
    { id: "pork",      label: "Pork",      emoji: "🐖", re: /\b(pork|sausage|bacon)\b|\bham\b(?!\w*burger)/i },
    { id: "lamb",      label: "Lamb",      emoji: "🐏", re: /\blamb\b/i },    { id: "poultry",   label: "Poultry",   emoji: "🍗", re: /\b(chicken|turkey|drumstick|thighs?)\b/i },
    { id: "fish",      label: "Fish",      emoji: "🐟", re: /\b(fish|salmon|tuna|cod|tilapia|trout|mackerel)\b/i },
    { id: "shellfish", label: "Shellfish", emoji: "🍤", re: /\b(shrimp|prawn|crab|lobster|scallop|calamari)\b/i },
    { id: "vegan",     label: "Vegan",     emoji: "🌱", re: /\b(tofu|tempeh|seitan|edamame|falafels?|lentils?|chickpeas?|quinoa|black beans?|kidney beans?|navy beans?|beans?)\b/i },
  ];
  function detectProteins(name) {
    const out = [];
    const n = name || "";
    // A "turkey burger" is poultry, not beef: suppress beef on burger when poultry is present.
    const isPoultry = /\b(chicken|turkey)\b/i.test(n);
    for (const p of PROTEINS) {
      if (p.id === "beef" && isPoultry) {
        if (/\b(beef|steak|roast beef)\b/i.test(n)) out.push(p);
      } else if (p.re.test(n)) {
        out.push(p);
      }
    }
    return out;
  }

  function makeItemButton(entry, opts) {
    const o = opts || {};
    const b = el("button", "item" + (entry.item.cat === "entree" ? " entree" : "") + (entry.item.carried ? " carried" : ""));
    const fe = foodEmojiSpan(entry.item);
    if (fe) b.appendChild(fe);
    b.appendChild(document.createTextNode(entry.item.name));
    if (entry.item.carried) b.appendChild(el("span", "carried-tag", "breakfast menu"));
    if (entry.item.calories) b.appendChild(el("span", "cal", Math.round(entry.item.calories) + " cal"));
    appendItemBadge(b, entry.item.cat, o.withBadge);
    b.addEventListener("click", () => openModal(entry));
    return b;
  }

  // Resolves the selected hall for hall-scoped views. If the hall is
  // unavailable (missing/closed/error) it renders the appropriate message
  // into #content and returns null; otherwise returns the hall untouched.
  function selectedHall(c) {
    const halls = state.data.halls;
    const hall = halls[state.hallIndex] || halls[0];
    if (!hall) { c.appendChild(el("div", "empty", "No halls available.")); return null; }
    if (hall.closed) {
      const d = el("div", "hall-closed");
      const big = el("div", "big");
      big.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><path d="M14 12v.01"/></svg>';
      d.appendChild(big);
      d.appendChild(el("div", null, hall.name + " is closed for " + state.meal + " on " + state.date));
      d.appendChild(el("div", "hint", "No menu is published for this meal yet — check back when " + state.meal + " opens, or tap another hall."));
      c.appendChild(d);
      return null;
    }
    if (hall.error) {
      c.appendChild(el("div", "error", "Error loading " + hall.name + ": " + hall.error));
      return null;
    }
    return hall;
  }

  // Flat {item, hall, station} entries for a single hall's stations.
  function hallItems(hall) {
    const out = [];
    for (const s of hall.stations) {
      for (const it of s.items) out.push({ item: it, hall: hall.name, station: s.name });
    }
    return out;
  }

  // Flat entries across every open hall — used by search, which spans all halls.
  function allHallItems() {
    const out = [];
    for (const h of state.data.halls) {
      if (h.closed || h.error) continue;
      for (const e of hallItems(h)) out.push(e);
    }
    return out;
  }

  // Per-item source tag: station only when hall-scoped, "hall · station" in
  // global search where the hall is no longer implied.
  function entryTag(e, searching) {
    return searching ? e.hall + " · " + e.station : e.station;
  }

  // Collapsible station sections (Stations view). Expanded by default; the
  // collapsed set is persisted per hall+station so the layout survives reloads.
  function stationCollapsed() {
    try {
      const v = JSON.parse(localStorage.getItem(STATION_STATE_KEY) || "[]");
      return new Set(Array.isArray(v) ? v : Object.keys(v));
    }
    catch (e) { return new Set(); }
  }
  function setStationCollapsed(key, collapsed) {
    const s = stationCollapsed();
    if (collapsed) s.add(key); else s.delete(key);
    try {
      localStorage.setItem(STATION_STATE_KEY, JSON.stringify(Array.from(s)));
    } catch (e) {}
  }
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  // Collapsible category sections (Categories view). Categories are a fixed,
  // hall-independent set, so the collapsed set is keyed by category id only.
  function catCollapsed() {
    try {
      const v = JSON.parse(localStorage.getItem(CAT_STATE_KEY) || "[]");
      return new Set(Array.isArray(v) ? v : Object.keys(v));
    }
    catch (e) { return new Set(); }
  }
  function setCatCollapsed(cat, collapsed) {
    const s = catCollapsed();
    if (collapsed) s.add(cat); else s.delete(cat);
    try { localStorage.setItem(CAT_STATE_KEY, JSON.stringify(Array.from(s))); }
    catch (e) {}
  }
  // "Other" (the salad-bar long tail) is collapsed by default in Categories
  // view; this remembers whether the user has expanded it.
  const OTHER_EXPANDED_KEY = "eas-other-expanded"; // "1" when expanded
  function otherExpanded() {
    try { return localStorage.getItem(OTHER_EXPANDED_KEY) === "1"; } catch (e) { return false; }
  }
  function setOtherExpanded(expanded) {
    try { localStorage.setItem(OTHER_EXPANDED_KEY, expanded ? "1" : "0"); } catch (e) {}
  }
  // Progressive disclosure in Categories view: long sections show the first
  // CAT_PREVIEW items (protein-matched ones float to the top, so they make
  // the cut) plus a "Show all" row. Expansion is per-session, not persisted.
  const CAT_PREVIEW = 8;
  const catExpanded = new Set();
  // Stations and Nutrition mirror the Categories "preview + Show all N"
  // behavior for long sections. Per-session, not persisted.
  const stationExpanded = new Set();
  const nutriExpanded = new Set();
  // Nutrition protein sections are collapsible (like Categories); the collapsed
  // set is persisted per protein id.
  const NUTRI_STATE_KEY = "eas-nutrition-collapsed"; // [protein id, ...] — collapsed set
  function nutriCollapsed() {
    try {
      const v = JSON.parse(localStorage.getItem(NUTRI_STATE_KEY) || "[]");
      return new Set(Array.isArray(v) ? v : Object.keys(v));
    } catch (e) { return new Set(); }
  }
  function setNutriCollapsed(id, collapsed) {
    const s = nutriCollapsed();
    if (collapsed) s.add(id); else s.delete(id);
    try { localStorage.setItem(NUTRI_STATE_KEY, JSON.stringify(Array.from(s))); } catch (e) {}
  }
  // Entrees first (CATEGORIES rank), then the rest in menu order — stable
  // sort, so within-category menu order is preserved.
  const CAT_RANK = {};
  CATEGORIES.forEach((c, i) => { CAT_RANK[c] = i; });
  const byCatRank = (items) => items.sort((a, b) =>
    (CAT_RANK[a.item.cat] ?? CATEGORIES.length) - (CAT_RANK[b.item.cat] ?? CATEGORIES.length));
  // "+ N more" progressive-disclosure row; N is the number of items the
  // click will reveal (total minus the preview already shown).
  function makeShowAllButton(moreCount, onShow) {
    const more = el("button", "show-all");
    more.type = "button";
    more.textContent = "+" + moreCount + " more";
    more.addEventListener("click", onShow);
    return more;
  }
  // Empty-state message: search and diet filters get distinct wording.
  function filterEmptyMsg(searching) {
    if (searching) return "No dishes match your search.";
    if (state.dietFilters.size) return "No dishes match the selected filters.";
    return "No dishes to show.";
  }
  function renderStations() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    // Search suppresses progressive disclosure (surface every match). Diet
    // filters keep it: a filtered view previews CAT_PREVIEW + "+ N more" like
    // the unfiltered view, since matches are still a browsable list.
    const filtering = searching;
    // "Breakfast menu also served" switch: when off, carried items are
    // hidden from the stations — same rule as the other views.
    const hideCarried = !state.showCarried;
    // Section filter: when active, only the selected stations render.
    const stFilter = state.stations;
    // No search: the selected hall. Search: every open hall.
    const halls = searching
      ? state.data.halls.filter((h) => !h.closed && !h.error)
      : [selectedHall(c)];
    if (!searching && !halls[0]) return;
    const collapsed = stationCollapsed();
    let shown = 0;
    for (const hall of halls) {
      if (!hall) continue;
      const byStation = {};
      const order = [];
      for (const s of hall.stations) {
        if (stFilter.size && !stFilter.has(s.name)) continue;
        for (const it of s.items) {
          const e = { item: it, hall: hall.name, station: s.name };
          if (!matches(q, e)) continue;
          // Carried-over breakfast items live in their own station with a
          // "breakfast menu" tag (hidden when the "Breakfast menu also
          // served" switch is off).
          if (it.carried && hideCarried) continue;
          if (!byStation[s.name]) { byStation[s.name] = { group: s.group, items: [] }; order.push(s.name); }
          byStation[s.name].items.push(e);
        }
        shown += byStation[s.name] ? byStation[s.name].items.length : 0;
      }
      // In global search the hall earns a header; otherwise the station name
      // leads, exactly like the normal Stations view.
      for (const name of order) {
        const st = byStation[name];
        if (!st.items.length) continue;
        // Entrees first so the decision-relevant items aren't buried.
        byCatRank(st.items);
        const key = hall.name + "||" + name;
        const box = el("section", "station");
        const head = el("button", "cat-head");
        head.type = "button";
        const isCollapsed = collapsed.has(key);
        if (isCollapsed) box.classList.add("collapsed");
        head.setAttribute("aria-expanded", String(!isCollapsed));
        if (searching) {
          head.appendChild(el("span", "cat-head-label", hall.name));
          head.appendChild(el("span", "station-group", name));
        } else {
          head.appendChild(el("span", "cat-head-label", name));
          if (st.group) head.appendChild(el("span", "station-group", st.group));
        }
        const chev = el("span", "chev");
        chev.innerHTML = CHEV;
        chev.setAttribute("aria-hidden", "true");
        head.appendChild(chev);
        box.appendChild(head);
        const ul = el("ul", "items");
        // Progressive disclosure (mirrors Categories): long stations preview
        // CAT_PREVIEW items + a "Show all" row; expansion is per-session and
        // suppressed during search (a search should surface all matches).
        const skey = hall.name + "||" + name;
        const sExpanded = stationExpanded.has(skey);
        const sVisible = sExpanded || filtering ? st.items : st.items.slice(0, CAT_PREVIEW);
        for (const it of sVisible) ul.appendChild(makeItemButton(it));
        box.appendChild(ul);
        if (!filtering && st.items.length > CAT_PREVIEW && !sExpanded) {
          box.appendChild(makeShowAllButton(st.items.length - CAT_PREVIEW, () => {
            stationExpanded.add(skey);
            renderStations();
          }));
        }
        head.addEventListener("click", () => {
          const nowCollapsed = box.classList.toggle("collapsed");
          head.setAttribute("aria-expanded", String(!nowCollapsed));
          setStationCollapsed(key, nowCollapsed);
        });
        c.appendChild(box);
      }
    }
    if (!shown) c.appendChild(el("div", "empty", filterEmptyMsg(searching)));
  }

  // Item button for a "list" section (cat-section/cat-list): name, carried
  // tag, station/hall tag, category badge. Used by Categories and Nutrition.
  // calEntree (Categories view): calories inline on entrees only — the
  // decision-relevant rows.
  function makeListItemButton(entry, searching, withBadge, calEntree) {
    const b = el("button", "item" + (entry.item.carried ? " carried" : ""));
    const fe = foodEmojiSpan(entry.item);
    if (fe) b.appendChild(fe);
    b.appendChild(document.createTextNode(entry.item.name));
    if (entry.item.carried) b.appendChild(el("span", "carried-tag", "breakfast menu"));
    if (entry.item.calories && calEntree && entry.item.cat === "entree") b.appendChild(el("span", "cal", Math.round(entry.item.calories) + " cal"));
    b.appendChild(el("span", "hall-tag", entryTag(entry, searching)));
    appendItemBadge(b, entry.item.cat, withBadge);
    b.addEventListener("click", () => openModal(entry));
    return b;
  }

  function renderCategories() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    // Only search suppresses progressive disclosure; diet filters keep it.
    const filtering = searching;
    // Search spans all halls; otherwise the selected hall only.
    let entries;
    const hideCarried = !state.showCarried;
    if (searching) {
      entries = allHallItems().filter((e) =>
        (state.cats.size === 0 || state.cats.has(e.item.cat)) && matches(q, e) &&
        (!hideCarried || !e.item.carried));
    } else {
      const hall = selectedHall(c);
      if (!hall) return;
      entries = hallItems(hall).filter((e) =>
        (state.cats.size === 0 || state.cats.has(e.item.cat)) && matches(q, e) &&
        (!hideCarried || !e.item.carried));
    }
    if (!entries.length) { c.appendChild(el("div", "empty", filterEmptyMsg(searching))); return; }
    const byCat = {};
    for (const e of entries) (byCat[e.item.cat] = byCat[e.item.cat] || []).push(e);
    const collapsed = catCollapsed();
    for (const cat of CATEGORIES) {
      const list = byCat[cat];
      if (!list) continue;
      // Items matching a protein type (beef, lamb, …) float to the top of each category.
      list.sort((a, b) =>
        (detectProteins(b.item.name).length ? 1 : 0) - (detectProteins(a.item.name).length ? 1 : 0));
      // "Other" (the salad-bar long tail) starts collapsed; every other
      // category follows the persisted collapse state.
      const isCollapsed = collapsed.has(cat) || (cat === "other" && !otherExpanded());
      const sec = el("section", "cat-section" + (isCollapsed ? " collapsed" : ""));
      const head = el("button", "cat-head");
      head.type = "button";
      head.setAttribute("aria-expanded", String(!isCollapsed));
      const label = el("span", "cat-head-label");
      label.textContent = CAT_EMOJI[cat] + " " + CAT_LABEL[cat] + "  (" + list.length + ")";
      head.appendChild(label);
      const chev = el("span", "chev");
      chev.innerHTML = CHEV;
      chev.setAttribute("aria-hidden", "true");
      head.appendChild(chev);
      sec.appendChild(head);
      // Progressive disclosure: long sections show a preview plus a
      // "Show all" row (expansion is per-session, not persisted).
      const expanded = catExpanded.has(cat);
      const visible = expanded || filtering ? list : list.slice(0, CAT_PREVIEW);
      const previewed = !expanded && !filtering && list.length > CAT_PREVIEW;
      const ul = el("ul", "cat-list");
      for (const e of visible) ul.appendChild(makeListItemButton(e, searching, false, true));
      if (previewed) {
        const more = el("button", "show-all");
        more.type = "button";
        more.textContent = "+" + (list.length - CAT_PREVIEW) + " more";
        more.addEventListener("click", () => {
          catExpanded.add(cat);
          renderCategories();
        });
        ul.appendChild(more);
      }
      sec.appendChild(ul);
      head.addEventListener("click", () => {
        const nowCollapsed = sec.classList.toggle("collapsed");
        head.setAttribute("aria-expanded", String(!nowCollapsed));
        if (cat === "other") {
          // Other's state lives in OTHER_EXPANDED_KEY, not the persisted
          // collapsed set — keep any legacy "other" entry out of that set.
          setOtherExpanded(!nowCollapsed);
          const s = catCollapsed();
          if (s.has("other")) {
            s.delete("other");
            try { localStorage.setItem(CAT_STATE_KEY, JSON.stringify(Array.from(s))); } catch (e) {}
          }
        } else setCatCollapsed(cat, nowCollapsed);
      });
      c.appendChild(sec);
    }
  }

  function renderNutrition() {
    const c = $("#content");
    c.innerHTML = "";
    const q = state.query.toLowerCase();
    const searching = !!q;
    // Only search suppresses progressive disclosure; diet filters keep it.
    const filtering = searching;
    let entries;
    if (searching) {
      entries = allHallItems().filter((e) => matches(q, e));
    } else {
      const hall = selectedHall(c);
      if (!hall) return;
      entries = hallItems(hall).filter((e) => matches(q, e));
    }
    if (!entries.length) { c.appendChild(el("div", "empty", filterEmptyMsg(searching))); return; }
    // "Breakfast menu also served" switch: when off, carried items don't
    // appear in the protein sections — same rule as the other views.
    const hideCarried = !state.showCarried;
    if (hideCarried) entries = entries.filter((e) => !e.item.carried);
    if (!entries.length) { c.appendChild(el("div", "empty", filterEmptyMsg(searching))); return; }
    const byProtein = {};
    for (const e of entries) {
      for (const p of detectProteins(e.item.name)) (byProtein[p.id] = byProtein[p.id] || []).push(e);
    }
    // Section filter: when active, only the selected protein sections render.
    const prFilter = state.proteins;
    const collapsed = nutriCollapsed();
    let shown = false;
    for (const p of PROTEINS) {
      const list = byProtein[p.id];
      if (!list || !list.length) continue;
      if (prFilter.size && !prFilter.has(p.id)) continue;
      shown = true;
      // Entrees first so the decision-relevant dishes aren't buried.
      byCatRank(list);
      // Collapsible section header (like Categories); collapsed set persisted.
      const isCollapsed = collapsed.has(p.id);
      const sec = el("section", "cat-section" + (isCollapsed ? " collapsed" : ""));
      const head = el("button", "cat-head");
      head.type = "button";
      head.setAttribute("aria-expanded", String(!isCollapsed));
      const label = el("span", "cat-head-label");
      label.textContent = p.emoji + " " + p.label + "  (" + list.length + ")";
      head.appendChild(label);
      const chev = el("span", "chev");
      chev.innerHTML = CHEV;
      chev.setAttribute("aria-hidden", "true");
      head.appendChild(chev);
      sec.appendChild(head);
      const ul = el("ul", "cat-list");
      // Progressive disclosure (mirrors Categories): long protein sections
      // preview CAT_PREVIEW items + a "Show all" row; per-session, suppressed
      // during search.
      const nExpanded = nutriExpanded.has(p.id);
      const nVisible = nExpanded || filtering ? list : list.slice(0, CAT_PREVIEW);
      for (const e of nVisible) ul.appendChild(makeListItemButton(e, searching));
      if (!filtering && list.length > CAT_PREVIEW && !nExpanded) {
        ul.appendChild(makeShowAllButton(list.length - CAT_PREVIEW, () => {
          nutriExpanded.add(p.id);
          renderNutrition();
        }));
      }
      sec.appendChild(ul);
      head.addEventListener("click", () => {
        const nowCollapsed = sec.classList.toggle("collapsed");
        head.setAttribute("aria-expanded", String(!nowCollapsed));
        setNutriCollapsed(p.id, nowCollapsed);
      });
      c.appendChild(sec);
    }
    if (!shown) c.appendChild(el("div", "empty", filterEmptyMsg(searching)));
  }

  /* ---------- analytics (GA4, optional — no-op if gtag absent) ---------- */

  function gaEvent(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }
  // Debounce repeated search-as-you-type so we log one event per settled query.
  let searchTimer = null;
  function gaSearch(query) {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => gaEvent("search", { search_term: query }), 400);
  }

  /* ---------- modal ---------- */

  function openModal(entry) {
    gaEvent("view_item", {
      item_name: entry.item.name,
      hall: entry.hall,
      station: entry.station,
      category: entry.item.cat || "",
      meal: state.meal,
    });
    const m = $("#modal");
    const it = entry.item;
    const mt = $("#modal-title");
    mt.textContent = "";
    const fe = foodEmojiSpan(it);
    if (fe) { fe.classList.add("big"); mt.appendChild(fe); }
    mt.appendChild(document.createTextNode(it.name));
    const catDiv = $("#modal-cat");
    catDiv.innerHTML = "";
    catDiv.appendChild(itemBadge(it.cat));
    catDiv.appendChild(el("span", "hall-tag", entry.hall + " · " + entry.station));
    const meta = [];
    if (it.calories) meta.push(Math.round(it.calories) + " calories");
    if (it.carried && state.meal !== "breakfast") meta.push("breakfast menu");
    $("#modal-meta").textContent = meta.join(" · ");
    $("#modal-desc").textContent = it.desc || "";
    $("#modal-desc").hidden = !it.desc;
    const ing = $("#modal-ingredients");
    if (it.ingredients) {
      ing.hidden = false;
      $("#modal-ingredients-text").textContent = it.ingredients;
    } else ing.hidden = true;
    m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
  }
  $("#modal").addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  /* ---------- dining hours modal ---------- */

  const HOURS_CACHE_KEY = "eas-hours-cache";
  let hoursData = null; // in-memory; persisted to localStorage for offline

  // PWA: live /api/hours (server caches 6h). Static: the published snapshot.
  async function fetchHours() {
    const url = STATIC ? "data/dining-hours.json" : "/api/hours";
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    if (!d || !Array.isArray(d.sections)) throw new Error("bad hours payload");
    return d;
  }
  function loadHoursCache() {
    try { return JSON.parse(localStorage.getItem(HOURS_CACHE_KEY)); } catch (e) { return null; }
  }
  function saveHoursCache(d) {
    try { localStorage.setItem(HOURS_CACHE_KEY, JSON.stringify(d)); } catch (e) {}
  }

  function openHoursModal() {
    gaEvent("view_hours", {});
    const m = $("#hours-modal");
    const meta = $("#hours-meta");
    const body = $("#hours-body");
    m.hidden = false;
    document.body.style.overflow = "hidden";
    body.innerHTML = "";
    if (hoursData) {
      meta.textContent = hoursMetaLine(hoursData);
      renderHours(hoursData, body);
      return;
    }
    const cached = loadHoursCache();
    if (cached) {
      hoursData = cached;
      meta.textContent = hoursMetaLine(cached) + " · cached";
      renderHours(cached, body);
    } else {
      meta.textContent = "";
      body.appendChild(el("div", "status", "Loading dining hours…"));
    }
    // Always refresh in the background so the modal is current on next open
    // (and populates the offline cache even when it was empty).
    fetchHours()
      .then((d) => {
        if (hoursData && hoursData.fetched_at === d.fetched_at) return; // unchanged
        hoursData = d;
        saveHoursCache(d);
        if (m.hidden) return; // modal closed in the meantime
        meta.textContent = hoursMetaLine(d);
        body.innerHTML = "";
        renderHours(d, body);
      })
      .catch((err) => {
        if (m.hidden || cached) return;
        body.innerHTML = "";
        body.appendChild(el("div", "empty", "Could not load dining hours."));
        body.appendChild(el("div", "empty", err.message));
      });
  }
  function closeHoursModal() {
    $("#hours-modal").hidden = true;
    document.body.style.overflow = "";
  }
  $("#hours-modal").addEventListener("click", (e) => { if (e.target.closest("[data-hours-close]")) closeHoursModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHoursModal(); });

  /* ---------- about modal ---------- */

  const FEEDBACK_URL = "https://github.com/eatatstate/menus/issues/new?template=feedback.yml";

  function openAboutModal() {
    gaEvent("view_about", {});
    const meta = document.querySelector(".build-meta");
    const sha = meta ? meta.dataset.sha || "" : "";
    const time = meta ? meta.dataset.time || "" : "";
    const isPlaceholder = !sha || sha.indexOf("__") === 0 || sha === "dev";
    // SHA is display-only: the build repo is private, so no commit link.
    $("#about-sha").textContent = isPlaceholder ? "dev build" : sha;
    $("#about-time").textContent = time && time.indexOf("__") !== 0 ? time : "—";
    // Feedback opens the template form with the build SHA in the issue title.
    // (A URL title param replaces the template's own title prefix, so the
    // full "[feedback] <sha>" title is built here.)
    $("#about-feedback").href = isPlaceholder ? FEEDBACK_URL : FEEDBACK_URL +
      "&title=" + encodeURIComponent("[feedback] " + sha);
    const m = $("#about-modal");
    m.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeAboutModal() {
    $("#about-modal").hidden = true;
    document.body.style.overflow = "";
  }
  $("#about-modal").addEventListener("click", (e) => { if (e.target.closest("[data-about-close]")) closeAboutModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAboutModal(); });

  function hoursMetaLine(d) {
    const n = d.sections.reduce((a, s) => a + s.locations.length, 0);
    const updated = d.fetched_at ? new Date(d.fetched_at).toLocaleDateString() : "";
    return n + " locations" + (updated ? " · updated " + updated : "");
  }

  function renderHours(d, body) {
    for (const sec of d.sections) {
      if (!sec.locations.length) continue;
      body.appendChild(el("h3", "hours-sec", sec.name));
      for (const loc of sec.locations) {
        body.appendChild(renderHoursLocation(loc));
      }
    }
  }

  function renderHoursLocation(loc) {
    const card = el("div", "hours-loc");
    const head = el("div", "hours-loc-head");
    head.appendChild(el("span", "hours-loc-name", loc.name));
    if (loc.building) head.appendChild(el("span", "hours-loc-bld", loc.building));
    card.appendChild(head);
    // Flatten the hours groups (regular + special) into day rows; show the
    // valid-dates window as a subtitle when present.
    const daysEl = el("div", "hours-days");
    for (const g of loc.hours || []) {
      if (g.valid_dates) daysEl.appendChild(el("div", "hours-valid", g.valid_dates + (g.type === "special_hours" ? " (special)" : "")));
      for (const day of g.days || []) {
        const row = el("div", "hours-day" + (day.closed ? " closed" : ""));
        row.appendChild(el("span", "hours-day-name", day.days));
        if (day.closed) {
          row.appendChild(el("span", "hours-day-slots", "Closed"));
        } else {
          // Each slot is one unsplittable unit: the line can break only at
          // the comma between slots, never mid-slot ("4:30 pm–9:00 pm" stays
          // together instead of wrapping after "9:00" and orphaning "pm").
          const slotsEl = el("span", "hours-day-slots");
          const parts = day.slots || [];
          parts.forEach((s, i) => {
            if (i) slotsEl.appendChild(document.createTextNode(", "));
            slotsEl.appendChild(el("span", "hours-slot", s.open && s.close ? s.open + "–" + s.close : (s.raw || "")));
          });
          row.appendChild(slotsEl.childNodes.length ? slotsEl : el("span", "hours-day-slots", "—"));
        }
        daysEl.appendChild(row);
      }
    }
    card.appendChild(daysEl);
    return card;
  }

  /* ---------- controls ---------- */

  const VIEWS = ["stations", "categories", "nutrition"];
  VIEWS.forEach((v) => $("#seg-" + v).addEventListener("click", () => setView(v)));
  function setView(v) {
    state.view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    gaEvent("select_view", { view: v, meal: state.meal });
    VIEWS.forEach((x) => {
      const b = $("#seg-" + x);
      b.classList.toggle("active", x === v);
      b.setAttribute("aria-selected", String(x === v));
    });
    if (!$("#filters-sheet").hidden) renderFiltersSheet();
    syncFilterFab();
    renderContentOnly();
  }

  const searchInput = $("#search");
  // Collapsed search: ⌕ button on the view-mode row toggles the input row.
  const searchRow = $("#search-row");
  const searchToggle = $("#search-toggle");
  function setSearchOpen(open) {
    searchRow.hidden = !open;
    searchToggle.setAttribute("aria-expanded", String(open));
    if (open) searchInput.focus();
    else {
      searchInput.value = "";
      state.query = "";
      $("#search-clear").hidden = true;
      if (!$("#filters-sheet").hidden) renderFiltersSheet();
      syncFilterFab();
      renderContentOnly();
    }
  }
  searchToggle.addEventListener("click", () => setSearchOpen(searchRow.hidden));
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim();
    $("#search-clear").hidden = !state.query;
    if (state.query) gaSearch(state.query);
    // Chip counts follow the search scoping (all halls)
    if (!$("#filters-sheet").hidden) renderFiltersSheet();
    syncFilterFab();
    renderContentOnly();
  });
  $("#search-clear").addEventListener("click", () => {
    searchInput.value = "";
    state.query = "";
    $("#search-clear").hidden = true;
    if (!$("#filters-sheet").hidden) renderFiltersSheet();
    syncFilterFab();
    renderContentOnly();
  });

  // The static page is served from a provided JSON file, so there is no live
  // source to refresh — the overflow menu's refresh item is hidden in STATIC
  // mode (handled in initMoreMenu).

  ["breakfast", "lunch", "dinner"].forEach((m) => {
    $("#meal-" + m).addEventListener("click", () => setMeal(m));
  });
  function setMeal(m) {
    if (m === state.meal && state.data) return;
    gaEvent("select_meal", { meal: m });
    state.meal = m;
    renderChrome(); // updates the meal button label + in-menu tabs immediately
    closeMoreMenu(); // picker chose a meal — collapse the menu
    if (!$("#filters-sheet").hidden) renderFiltersSheet();
    syncFilterFab();
    // instant: show any cached snapshot for this meal
    const today = todayStr();
    const cached = loadCache(m, today);
    if (cached) {
      state.data = cached;
      state.date = cached.date;
      render();
    } else {
      // no cache: show a loading state instead of stale content
      const c = $("#content");
      c.innerHTML = "";
      c.appendChild(el("div", "status", "Loading " + m + "…"));
    }
    doFetch(m);
  }

  /* ---------- offline / SW ---------- */

  function updateOnline() {
    if (navigator.onLine && !state.loading) {
      // back online: refetch to clear stale banner
      showOffline(false);
      doFetch(state.meal, { force: true });
    } else if (!navigator.onLine) {
      showOffline(true);
    }
  }
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);

  if ("serviceWorker" in navigator && !STATIC) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  /* ---------- init ---------- */

  initMoreMenu();

  // Keep the sticky control bar docked right below the sticky topbar
  // (topbar height varies: safe-area inset, mobile single-row layout).
  const topbar = $(".topbar");
  const syncStickbarTop = () => {
    if (topbar) document.documentElement.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
  };
  syncStickbarTop();
  window.addEventListener("resize", syncStickbarTop);
  window.addEventListener("load", syncStickbarTop);
  if (topbar && "ResizeObserver" in window) {
    new ResizeObserver(syncStickbarTop).observe(topbar);
  }

  // Horizontal-scroll a chip row with the mouse wheel (desktop); touch
  // scrolls natively. Applied to the hall row and the category row.
  function wheelScrollRow(row) {
    row.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // already horizontal
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const atStart = row.scrollLeft <= 0 && e.deltaY < 0;
      const atEnd = row.scrollLeft >= max && e.deltaY > 0;
      if (atStart || atEnd) return; // let the page scroll at the edges
      row.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }
  const hallTrack = $("#hall-track");
  if (hallTrack) {
    wheelScrollRow(hallTrack);
    hallTrack.addEventListener("scroll", syncHallFades, { passive: true });
    window.addEventListener("resize", syncHallFades);
  }

  // Filters FAB: opens the bottom sheet. First open marks the FAB as
  // "seen" so the discoverability label never comes back.
  const filtersFab = $("#filters-fab");
  if (filtersFab) {
    filtersFab.addEventListener("click", () => {
      const sheet = $("#filters-sheet");
      if (!sheet.hidden) { closeFiltersSheet(); return; }
      try { localStorage.setItem(FILTER_SEEN_KEY, "1"); } catch (e) {}
      openFiltersSheet();
    });
  }
  $("#filters-sheet").addEventListener("click", (e) => { if (e.target.closest("[data-filters-close]")) closeFiltersSheet(); });
  // Escape closes the filters sheet too (hours/about modals close themselves).
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeFiltersSheet(); });

  // Footer reaches the FAB → fade the FAB out so it never covers the
  // footer's centered text (measured: the text overlaps the FAB's left
  // ~13px at rest). NEVER fade while filters are active — a filtered/
  // empty result shortens the page, and hiding the only re-entry point to
  // the filters strands the user. Also never fade when the footer is
  // already visible at REST (scrollY ≈ 0): on short pages (small hall,
  // few search results) the FAB would load hidden and only reappear once
  // the user expanded a section — undiscoverable (Tony, 2026-09-19);
  // there, the 13px text tuck under the FAB's edge is the acceptable cost.
  // Trigger boundary: the FAB's BOTTOM edge (the only reachable one — the
  // footer top sits 788 vs the FAB top 780 at max scroll, so a top-edge
  // boundary would never fire). The older threshold:0 observer faded the
  // whole ~56px of the footer's first appearance, i.e. while it was still
  // off-screen and the FAB was covering the last category header — that
  // read as a glitch in the Categories view. The IO only fires on
  // intersection CHANGES, so the class is derived state (footerVisible ×
  // scrolled × filter count), recomputed from scroll, resize, and every
  // filter change.
  let footerVisible = false;
  function syncFabAway() {
    if (!filtersFab) return;
    filtersFab.parentElement.classList.toggle(
      "away", footerVisible && window.scrollY > 4 && activeFilterCount() === 0
    );
  }
  const footer = $(".footer");
  let fabObs = null;
  if (filtersFab && footer && "IntersectionObserver" in window) {
    const makeObs = () => {
      if (fabObs) fabObs.disconnect();
      const r = filtersFab.getBoundingClientRect();
      // Root bottom = the FAB's BOTTOM edge. The footer top crosses this
      // only once the footer has risen onto the FAB (it can't scroll higher
      // than the page end, so a top-edge boundary would never be reached).
      const margin = "0px 0px -" + Math.max(0, Math.round(window.innerHeight - r.bottom)) + "px 0px";
      fabObs = new IntersectionObserver((es) => {
        footerVisible = es[0].isIntersecting;
        syncFabAway();
      }, { rootMargin: margin });
      fabObs.observe(footer);
    };
    makeObs();
    window.addEventListener("resize", makeObs);
    // The IO doesn't re-fire while the footer stays intersected (short
    // pages), but the scrollY>4 condition still needs re-checking.
    window.addEventListener("scroll", syncFabAway, { passive: true });
  }

  // Default meal by local time: 9:00–11:00 breakfast, 11:00–16:30 lunch,
  // 16:30–21:00 dinner (3:00–4:30 is lunch per menu hours); before 9:00
  // breakfast is the next service, after 21:00 dinner just ended.
  function defaultMeal() {
    const d = new Date();
    const t = d.getHours() + d.getMinutes() / 60;
    if (t >= 9 && t < 11) return "breakfast";
    if (t >= 11 && t < 16.5) return "lunch";
    if (t >= 16.5) return "dinner";
    return "breakfast";
  }

  // Restore persisted view mode before the first render (HTML defaults to
  // Categories; the active class + state are aligned here without re-rendering).
  let savedView = null;
  try { savedView = localStorage.getItem(VIEW_KEY); } catch (e) {}
  if (savedView && VIEWS.includes(savedView) && savedView !== state.view) {
    state.view = savedView;
    VIEWS.forEach((x) => {
      const b = $("#seg-" + x);
      b.classList.toggle("active", x === savedView);
      b.setAttribute("aria-selected", String(x === savedView));
    });
  }

  const initialMeal = defaultMeal();
  if (initialMeal !== state.meal) {
    setMeal(initialMeal);
  } else {
    const cached = STATIC ? null : loadCache("lunch", todayStr());
    if (cached) {
      state.data = cached;
      state.date = cached.date;
      render();
    } else {
      render(); // shows loading status
    }
    doFetch("lunch");
  }
})();
