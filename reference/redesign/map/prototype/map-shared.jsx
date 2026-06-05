// asb/map-shared.jsx — SHARED map concerns for every map surface.
// Consistency Amendment (1 Jun 2026): one base theme + one toggle + one zone
// palette, used identically by the market map (asb/map.jsx · MapPane) AND the
// fleet map (asb/my-vessels-board.jsx · FleetMap). Load BEFORE both.
//
// Exposes:
//   window.ASB_MAP_TILES      — base + seamark tile URLs (light / dark)
//   window.ASB_ZONE_COLOR     — one zone→colour palette (codes + full names)
//   window.useMapBase()       — ['light'|'dark', setBase] · persisted + live-synced
//   window.MapBaseToggle      — the shared light/dark control (mode="icon"|"pill")

(function () {
  // ── Tiles ───────────────────────────────────────────────────────────
  // Light = Carto Voyager (the My Vessels style). Dark = Carto Dark Matter.
  // OpenSeaMap seamark overlay rides on BOTH bases.
  window.ASB_MAP_TILES = {
    light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    dark:  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    seamark: "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd",
  };

  // ── One zone palette (identical colours on every map) ─────────────────
  // Keyed by both the short code (market map) and the full name (fleet map),
  // so the same zone draws the same colour wherever it appears.
  window.ASB_ZONE_COLOR = {
    "AG":            "#534AB7", "Arabian Gulf":  "#534AB7",
    "R.SEA":         "#EF9F27", "Red Sea North": "#EF9F27", "Red Sea South": "#C76B12",
    "E.MED":         "#185FA5", "East Med":      "#185FA5",
    "B.SEA":         "#2A9962", "Black Sea":     "#2A9962",
    "A.SEA":         "#1F8A8A", "Arabian Sea":   "#1F8A8A",
    "E.AFR":         "#7A5BA6",
  };
  window.asbZoneColor = function (key, fallback) {
    return window.ASB_ZONE_COLOR[key] || fallback || "#8B95A3";
  };

  // ── Zone centroids ([lat, lng]) ───────────────────────────────────────
  // Pure geometry for direction math (preferred-direction markers, part 3).
  // NOT a rendered layer — zones are no longer tinted on the map.
  window.ASB_ZONE_CENTER = {
    "B.SEA": [43.75, 34.5], "Black Sea":     [43.75, 34.5],
    "E.MED": [33.5,  29.5], "East Med":      [33.5,  29.5],
    "R.SEA": [21.0,  38.25],"Red Sea North": [27.0, 35.5], "Red Sea South": [16.0, 41.0],
    "AG":    [26.5,  53.0], "Arabian Gulf":  [26.5,  53.0],
    "A.SEA": [15.0,  62.0], "Arabian Sea":   [15.0,  62.0],
    "E.AFR": [0.0,   45.0],
  };
  window.asbZoneCenter = function (key) {
    return window.ASB_ZONE_CENTER[key] || null;
  };

  // ── CENTRAL LAYER REGISTRY ────────────────────────────────────────────
  // Single source of truth for what a map may draw. THE PRINCIPLE:
  // a layer may render ONLY if it is declared here. Anything not in this
  // registry must not appear on any map — this is how dead/leftover
  // switches stay dead.
  //
  //   base     — locked tier, always on, identical on every map.
  //   toggles  — the ONLY adjustable switches allowed (filled in by parts 2+).
  //   contexts — per-page declaration of which side is "home"; the opposite
  //              side becomes the optional "opponent" layer (part 2).
  window.ASB_MAP_LAYERS = {
    base: {
      sea: {
        id: "sea", label: "Sea & ports", locked: true,
        note: "Carto basemap + OpenSeaMap seamark overlay + shared light/dark toggle.",
      },
    },
    toggles: {
      // The ONLY adjustable layer toggle: the opposing side of the market.
      // One toggle, default OFF; the home side stays locked-on.
      opponent: {
        id: "opponent",
        label: { cargo: "Show open tonnage", vessel: "Show open cargo" },
        default: "off",
        note: "Opposing side of the market — distinct (muted) marker style.",
      },
    },
    // Per-page context. `home` = the always-on locked side; the opposite side
    // is the opponent toggle. `pairing` registers the Dashboard click-to-pair
    // calc — Dashboard ONLY, so it can never leak onto another map.
    contexts: {
      "dashboard":      { home: "both",   pairing: true },
      "my-cargo":       { home: "cargo"  },
      "cargo-market":   { home: "cargo"  },
      "my-vessels":     { home: "vessel" },
      "tonnage-market": { home: "vessel" },
    },
  };

  // ── Shared base-theme state (persisted + broadcast) ───────────────────
  var BASE_KEY = "asb:mapBase";
  var BASE_EVT = "asb-mapbase";
  function readBase() {
    try { return localStorage.getItem(BASE_KEY) || "light"; } catch (e) { return "light"; }
  }
  window.useMapBase = function useMapBase() {
    var ref = React.useState(readBase());
    var base = ref[0], set = ref[1];
    React.useEffect(function () {
      var h = function (e) { set(e.detail); };
      window.addEventListener(BASE_EVT, h);
      return function () { window.removeEventListener(BASE_EVT, h); };
    }, []);
    var setBase = function (b) {
      try { localStorage.setItem(BASE_KEY, b); } catch (e) {}
      window.dispatchEvent(new CustomEvent(BASE_EVT, { detail: b }));
    };
    return [base, setBase];
  };

  // ── Shared toggle control ─────────────────────────────────────────────
  // mode="icon" → single 34px sun/moon button (fits the 44px right bar)
  // mode="pill" → segmented Light | Dark (fits a control panel)
  window.MapBaseToggle = function MapBaseToggle(props) {
    var mode = (props && props.mode) || "pill";
    var pair = window.useMapBase();
    var base = pair[0], setBase = pair[1];

    if (mode === "icon") {
      var next = base === "light" ? "dark" : "light";
      return (
        React.createElement("div", {
          className: "bar-icon asb-basetgl-icon",
          role: "button", "aria-label": "Map base: " + base,
          onClick: function () { setBase(next); },
        },
          React.createElement("i", { className: "ti " + (base === "light" ? "ti-sun" : "ti-moon") }),
          React.createElement("span", { className: "tooltip-l" },
            base === "light" ? "Light base · switch to dark" : "Dark base · switch to light")
        )
      );
    }

    return (
      React.createElement("div", { className: "asb-basetgl", role: "radiogroup", "aria-label": "Map base" },
        React.createElement("button", {
          type: "button", role: "radio", "aria-checked": base === "light",
          className: "asb-basetgl__b" + (base === "light" ? " is-on" : ""),
          onClick: function () { setBase("light"); },
        }, React.createElement("i", { className: "ti ti-sun" }), "Light"),
        React.createElement("button", {
          type: "button", role: "radio", "aria-checked": base === "dark",
          className: "asb-basetgl__b" + (base === "dark" ? " is-on" : ""),
          onClick: function () { setBase("dark"); },
        }, React.createElement("i", { className: "ti ti-moon" }), "Dark")
      )
    );
  };
})();
