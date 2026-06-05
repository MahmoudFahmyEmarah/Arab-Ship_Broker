/* asb/loader-overlay.js — drop-in propeller loading overlay for page transitions.
 *
 * USAGE
 *   1) Multi-page (separate .html files):
 *        <script src="asb/loader-overlay.js"></script>
 *      Include it on every page. It auto-shows the propeller the instant an
 *      internal link is clicked and fades it out once the next page loads.
 *
 *   2) Single-page / React route change:
 *        ASBLoader.show();  // before the transition
 *        ASBLoader.hide();  // when the new view is ready
 *
 * Config via a data-attribute on the <script> tag (all optional):
 *        data-min-visible="700"   minimum ms the overlay stays up (avoids flash)
 *        data-auto-nav="true"     intercept internal link clicks (default true)
 */
(function () {
  if (window.__asbLoaderInit) return;
  window.__asbLoaderInit = true;

  // ---- read config off the including <script> tag -------------------------
  var self = document.currentScript || (function () {
    var s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  var MIN_VISIBLE = parseInt((self && self.getAttribute('data-min-visible')) || '700', 10);
  var AUTO_NAV = (self && self.getAttribute('data-auto-nav')) !== 'false';
  var FLAG = 'asbNavigating';

  // ---- styles -------------------------------------------------------------
  var CSS = [
    '.asb-loading-overlay{',
    '  --asb-paper:#f5f7fa;',
    '  position:fixed; inset:0; z-index:2147483000;',
    '  display:flex; align-items:center; justify-content:center;',
    '  color:#15223a; background:rgba(245,247,250,.80);',
    '  -webkit-backdrop-filter:blur(3px); backdrop-filter:blur(3px);',
    '  opacity:0; visibility:hidden;',
    '  transition:opacity .35s ease, visibility 0s linear .35s;',
    '}',
    '@media (prefers-color-scheme: dark){',
    '  .asb-loading-overlay{ --asb-paper:#0c1623; color:#fff; background:rgba(8,16,28,.82); }',
    '}',
    '.asb-loading-overlay.is-visible{ opacity:1; visibility:visible; transition:opacity .35s ease, visibility 0s; }',
    '.asb-loading-overlay .prop{ display:block; width:min(40vmin,280px); height:min(40vmin,280px); }',
    '.asb-loading-overlay .blades{ transform-origin:160px 160px; animation:asb-prop-blades .75s linear infinite; }',
    '@keyframes asb-prop-blades{ from{ transform:rotate(0deg) scale(1.2);} to{ transform:rotate(360deg) scale(1.2);} }',
    '.asb-loading-overlay .hydro-out,.asb-loading-overlay .hydro-in{ transform-origin:160px 160px; }',
    '.asb-loading-overlay .hydro-out{ animation:asb-prop-spin 2.6s linear infinite; }',
    '.asb-loading-overlay .hydro-in{ animation:asb-prop-spin 3.8s linear infinite; }',
    '@keyframes asb-prop-spin{ to{ transform:rotate(360deg);} }',
    '@media (prefers-reduced-motion: reduce){',
    '  .asb-loading-overlay .blades{ animation-duration:1.5s; }',
    '  .asb-loading-overlay .hydro-out{ animation-duration:5.2s; }',
    '  .asb-loading-overlay .hydro-in{ animation-duration:7.6s; }',
    '}'
  ].join('\n');

  var SVG = [
    '<svg class="prop" viewBox="0 0 320 320" aria-hidden="true">',
    '  <defs><path id="asb-blade" fill="currentColor" d="M152 144 C 145 116 139 86 150 56 C 157 38 177 35 185 55 C 197 84 192 117 177 139 C 171 147 158 149 152 144 Z"/></defs>',
    '  <circle class="hydro-out" cx="160" cy="160" r="138" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="26 62" opacity=".16"/>',
    '  <circle class="hydro-in" cx="160" cy="160" r="110" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="16 70" opacity=".10"/>',
    '  <g class="blades">',
    '    <use href="#asb-blade"/>',
    '    <use href="#asb-blade" transform="rotate(120 160 160)"/>',
    '    <use href="#asb-blade" transform="rotate(240 160 160)"/>',
    '  </g>',
    '  <circle cx="160" cy="160" r="22" fill="currentColor"/>',
    '  <circle cx="160" cy="160" r="8" fill="var(--asb-paper)"/>',
    '</svg>'
  ].join('\n');

  var styleEl, overlay;

  function inject() {
    if (overlay) return;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'asb-loader-style';
      styleEl.textContent = CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    overlay = document.createElement('div');
    overlay.className = 'asb-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Loading');
    overlay.innerHTML = SVG;
    (document.body || document.documentElement).appendChild(overlay);
  }

  function show() { inject(); requestAnimationFrame(function () { overlay.classList.add('is-visible'); }); }
  function hide() { if (overlay) overlay.classList.remove('is-visible'); }

  window.ASBLoader = { show: show, hide: hide };

  // ---- cross-page navigation behaviour -----------------------------------
  function flagSet() { try { return sessionStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
  function setFlag(v) { try { v ? sessionStorage.setItem(FLAG, '1') : sessionStorage.removeItem(FLAG); } catch (e) {} }

  // If we arrived here mid-navigation, show immediately and fade out on load.
  inject();
  if (flagSet()) {
    show();
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var finish = function () {
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var wait = Math.max(0, MIN_VISIBLE - (now - t0));
      setTimeout(function () { hide(); setFlag(false); }, wait);
    };
    if (document.readyState === 'complete') finish();
    else window.addEventListener('load', finish);
  }

  // Back/forward cache restore: make sure the overlay isn't stuck on.
  window.addEventListener('pageshow', function (e) { if (e.persisted) { hide(); setFlag(false); } });

  // Intercept internal link clicks → show overlay, then let navigation proceed.
  if (AUTO_NAV) {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin) return;                 // external
      if (url.pathname === location.pathname && url.hash) return; // same-page anchor
      setFlag(true);
      show();
    }, true);
  }
})();
