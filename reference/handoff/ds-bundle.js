/* @ds-bundle: {"format":4,"namespace":"ASBDesignSystem_0955c8","components":[{"name":"Button","sourcePath":"components/Button/Button.jsx"},{"name":"Chip","sourcePath":"components/Chip/Chip.jsx"},{"name":"DataTable","sourcePath":"components/DataTable/DataTable.jsx"},{"name":"ICON_NAMES","sourcePath":"components/Icon/Icon.jsx"},{"name":"Icon","sourcePath":"components/Icon/Icon.jsx"},{"name":"Input","sourcePath":"components/Input/Input.jsx"},{"name":"SegmentedToggle","sourcePath":"components/SegmentedToggle/SegmentedToggle.jsx"},{"name":"Sidebar","sourcePath":"components/Sidebar/Sidebar.jsx"},{"name":"SoftCard","sourcePath":"components/SoftCard/SoftCard.jsx"},{"name":"SoftCardZone","sourcePath":"components/SoftCard/SoftCard.jsx"},{"name":"StatusBadge","sourcePath":"components/StatusBadge/StatusBadge.jsx"},{"name":"TerminalCard","sourcePath":"components/TerminalCard/TerminalCard.jsx"},{"name":"Toggle","sourcePath":"components/Toggle/Toggle.jsx"},{"name":"Tooltip","sourcePath":"components/Tooltip/Tooltip.jsx"}],"sourceHashes":{"components/Button/Button.jsx":"1b600b7f533b","components/Chip/Chip.jsx":"e5b9e2d076ec","components/DataTable/DataTable.jsx":"87493999c76e","components/Icon/Icon.jsx":"1d6fbc942419","components/Input/Input.jsx":"1949abd5b3a4","components/SegmentedToggle/SegmentedToggle.jsx":"99dfb9b7c714","components/Sidebar/Sidebar.jsx":"2ff5f36a7a4f","components/SoftCard/SoftCard.jsx":"fb28cf3d4325","components/StatusBadge/StatusBadge.jsx":"0488215a561f","components/TerminalCard/TerminalCard.jsx":"de2e95534dd7","components/Toggle/Toggle.jsx":"5023e5fe5274","components/Tooltip/Tooltip.jsx":"1f1f637fb937"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ASBDesignSystem_0955c8 = window.ASBDesignSystem_0955c8 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/Button/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Button — .asb-btn. 12px/600, 3px radius; primary fills navy.
function Button({
  variant = 'secondary',
  type = 'button',
  children,
  className = '',
  ...rest
}) {
  const cls = ['asb-btn', variant !== 'secondary' && 'asb-btn--' + variant, className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Button/Button.jsx", error: String((e && e.message) || e) }); }

// components/Chip/Chip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Chip — .asb-chip. Default 3px; filter variant 9px + shadow. Optional count + caret.
function Chip({
  variant = 'default',
  active = false,
  count,
  caret = false,
  children,
  className = '',
  ...rest
}) {
  const cls = ['asb-chip', variant === 'filter' && 'asb-chip--filter', active && 'is-active', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: cls,
    "aria-pressed": active
  }, rest), children, count != null && /*#__PURE__*/React.createElement("span", {
    className: "asb-chip__count"
  }, count), caret && /*#__PURE__*/React.createElement("span", {
    className: "asb-chip__caret",
    "aria-hidden": "true"
  }, "\u25BE"));
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Chip/Chip.jsx", error: String((e && e.message) || e) }); }

// components/DataTable/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// DataTable — .asb-table. Dense terminal table: 0.5px hairlines, tabular numerals,
// uppercase micro headers, optional striped rows. Column-driven.
function DataTable({
  columns = [],
  rows = [],
  dense = false,
  striped = false,
  className = '',
  ...rest
}) {
  const cls = ['asb-table', dense && 'asb-table--dense', striped && 'asb-table--striped', className].filter(Boolean).join(' ');
  const colCls = c => [c.numeric || c.align === 'right' ? 'asb-table__num' : '', c.name ? 'asb-table__name' : ''].filter(Boolean).join(' ') || undefined;
  return /*#__PURE__*/React.createElement("table", _extends({
    className: cls
  }, rest), /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    className: c.numeric || c.align === 'right' ? 'asb-table__num' : undefined,
    style: c.width ? {
      width: c.width
    } : undefined
  }, c.header)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, ri) => /*#__PURE__*/React.createElement("tr", {
    key: r.id != null ? r.id : ri
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: colCls(c)
  }, typeof c.render === 'function' ? c.render(r[c.key], r) : r[c.key]))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/DataTable/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/Icon/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// ASB custom icon set — 25 glyphs on a 24×24 grid (asb/icons.jsx).
// Contract: stroke glyphs fill:none / stroke:currentColor / width size<=16?1.7:1.5,
// round caps+joins; 5 solid glyphs use fill:currentColor with #fff knockouts.
const ICONS = {
  Dashboard: {
    svg: '<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/>'
  },
  Cargo: {
    solid: true,
    svg: '<path d="M 13.5 6 L 22.5 19 L 9.5 19 Z"/><path d="M 7 10 L 14.5 19 L 1.5 19 L 5 14 Z"/>'
  },
  Vessel: {
    solid: true,
    svg: '<rect x="4" y="9.5" width="3" height="3"/><rect x="5" y="6" width="1.6" height="3.8"/><path d="M 1.5 14 L 17 14 Q 21 14 22.5 11 L 22.5 16 Q 22 17.5 19 17.5 L 4 17.5 Q 2 17.5 1.5 16 Z"/><path d="M 1.5 19.5 Q 4 18.5 6.5 19.5 T 11.5 19.5 T 16.5 19.5 T 22.5 19.5" stroke="currentColor" stroke-width="1.1" fill="none"/><path d="M 1.5 21.5 Q 4 20.5 6.5 21.5 T 11.5 21.5 T 16.5 21.5 T 22.5 21.5" stroke="currentColor" stroke-width="1.1" fill="none"/>'
  },
  Voyage: {
    solid: true,
    svg: '<rect x="4" y="6" width="1.6" height="3.5"/><circle cx="3.2" cy="5" r="1"/><circle cx="4.6" cy="3.7" r="1"/><rect x="3.5" y="9.5" width="3.5" height="3.5"/><rect x="7" y="9.5" width="3.5" height="3.5"/><circle cx="17.5" cy="7.5" r="4.2"/><path d="M 1.5 13 L 21 13 L 17.5 18 L 5 18 Z"/><path d="M 1.5 20.5 Q 4 19.5 6.5 20.5 T 11.5 20.5 T 16.5 20.5 T 22.5 20.5" stroke="currentColor" stroke-width="1.2" fill="none"/>'
  },
  PortDA: {
    solid: true,
    svg: '<rect fill="currentColor" x="10.4" y="2" width="3.2" height="2" rx="0.4"/><path fill="none" stroke="currentColor" stroke-width="0.8" d="M11.4 4 L9.2 7.3 M12.6 4 L14.8 7.3"/><rect fill="currentColor" x="8.6" y="7" width="6.8" height="1.2" rx="0.3"/><path fill="currentColor" d="M9 8.2 C7.6 10 8.1 12.1 11.8 12.7 L11.8 8.2 Z M15 8.2 C16.4 10 15.9 12.1 12.2 12.7 L12.2 8.2 Z"/><path fill="currentColor" d="M8.5 15 Q10 13 12 14 Q14 13 15.5 15 Z"/><path fill="currentColor" d="M8.5 15 L15.5 15 L14 18.4 L10 18.4 Z"/><path fill="none" stroke="currentColor" stroke-width="0.9" d="M9.6 18.4 L8.6 21 M14.4 18.4 L15.4 21"/><rect fill="currentColor" x="8.4" y="20.3" width="7.2" height="0.8"/>'
  },
  VoyCalc: {
    solid: true,
    svg: '<path fill="currentColor" fill-rule="evenodd" d="M4 8 L18 8 Q19 8 19 9 L19 16 Q19 17 18 17 L4 17 Q3 17 3 16 L3 9 Q3 8 4 8 Z M6.5 13 Q11 13.7 15.5 13 L14.4 14.8 Q11 15.4 7.6 14.8 Z M9.4 10.6 L12.6 10.6 L12.6 12.8 L9.4 12.8 Z M10.8 9 L12 9 L12 10.6 L10.8 10.6 Z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M9 3.8 A6 6 0 0 0 3.4 8.4"/><path fill="currentColor" d="M2.1 7.4 L3.9 9 L4.9 7 Z"/><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" d="M15 20.4 A6 6 0 0 0 20.6 15.8"/><path fill="currentColor" d="M21.9 16.8 L20.1 15.2 L19.1 17.2 Z"/>'
  },
  Settings: {
    svg: '<circle cx="12" cy="12" r="3"/><path d="M 12 2 L 12 5 M 12 19 L 12 22 M 2 12 L 5 12 M 19 12 L 22 12 M 5 5 L 7 7 M 17 17 L 19 19 M 5 19 L 7 17 M 17 7 L 19 5"/>'
  },
  Sidebar: {
    svg: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="9" y1="4" x2="9" y2="20"/>'
  },
  SignOut: {
    svg: '<path d="M 13 5 L 13 4 Q 13 3 12 3 L 5 3 Q 4 3 4 4 L 4 20 Q 4 21 5 21 L 12 21 Q 13 21 13 20 L 13 19"/><line x1="10" y1="12" x2="21" y2="12"/><polyline points="17,8 21,12 17,16"/>'
  },
  Map: {
    svg: '<polygon points="3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20"/><line x1="9" y1="4" x2="9" y2="17"/><line x1="15" y1="7" x2="15" y2="20"/>'
  },
  Plus: {
    svg: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
  },
  Close: {
    svg: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'
  },
  Back: {
    svg: '<polyline points="14,6 8,12 14,18"/>'
  },
  Search: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  User: {
    svg: '<circle cx="12" cy="8" r="3.5"/><path d="M 4 21 Q 4 14 12 14 Q 20 14 20 21"/>'
  },
  Shield: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/>'
  },
  ShieldLock: {
    svg: '<path d="M 12 3 L 4 6 L 4 12 Q 4 18 12 21 Q 20 18 20 12 L 20 6 Z"/><rect x="9.5" y="11" width="5" height="5" rx="0.5"/><path d="M 10.5 11 V 9.5 Q 10.5 8 12 8 Q 13.5 8 13.5 9.5 V 11"/>'
  },
  Bell: {
    svg: '<path d="M 6 17 V 11 Q 6 6 12 6 Q 18 6 18 11 V 17 L 20 19 H 4 Z"/><path d="M 10 21 Q 12 22 14 21"/>'
  },
  Star: {
    svg: '<polygon points="12,3 14.5,9 21,9.5 16,14 17.5,21 12,17.5 6.5,21 8,14 3,9.5 9.5,9"/>'
  },
  Doc: {
    svg: '<path d="M 6 3 L 16 3 L 19 6 L 19 21 L 6 21 Z"/><line x1="9" y1="9" x2="16" y2="9"/><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>'
  },
  ZoomIn: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  ZoomOut: {
    svg: '<circle cx="10" cy="10" r="6"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="15" y1="15" x2="20" y2="20"/>'
  },
  Caret: {
    svg: '<polyline points="6,9 12,15 18,9"/>'
  },
  Bolt: {
    svg: '<polygon points="13,3 5,13 11,13 9,21 19,11 13,11"/>'
  }
};
const PLUS_BADGE = '<circle cx="20" cy="4" r="3" fill="#fff"/><line x1="20" y1="2.6" x2="20" y2="5.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="18.6" y1="4" x2="21.4" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
const ROT = {
  down: 0,
  up: 180,
  left: 90,
  right: -90
};
const ICON_NAMES = ['Logo', ...Object.keys(ICONS)];
const LOGO_MASK = 'data:image/png;base64,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';
function Icon({
  name,
  size = 16,
  color,
  plus = false,
  direction = 'down',
  className = '',
  title,
  style,
  ...rest
}) {
  if (name === 'Logo') {
    return /*#__PURE__*/React.createElement("span", _extends({
      className: ('asb-icon ' + className).trim(),
      role: title ? 'img' : undefined,
      "aria-hidden": title ? undefined : true,
      "aria-label": title,
      style: {
        display: 'inline-block',
        width: size,
        height: size,
        background: color || 'currentColor',
        WebkitMaskImage: 'url(' + LOGO_MASK + ')',
        maskImage: 'url(' + LOGO_MASK + ')',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        verticalAlign: 'middle',
        flex: 'none',
        ...style
      }
    }, rest));
  }
  const ic = ICONS[name];
  if (!ic) return null;
  const solid = !!ic.solid;
  const sw = size <= 16 ? 1.7 : 1.5;
  const rot = ROT[direction] || 0;
  let inner = ic.svg;
  if (plus && (name === 'Cargo' || name === 'Vessel')) inner += PLUS_BADGE;
  if (title) inner = '<title>' + title + '</title>' + inner;
  const props = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: solid ? 'currentColor' : 'none',
    className: ('asb-icon ' + className).trim(),
    style: {
      color,
      display: 'inline-block',
      verticalAlign: 'middle',
      flex: 'none',
      ...(name === 'Caret' && rot ? {
        transform: 'rotate(' + rot + 'deg)',
        transition: 'transform var(--t-fast,150ms) var(--ease,ease)'
      } : null),
      ...style
    },
    'aria-hidden': title ? undefined : true,
    role: title ? 'img' : undefined,
    dangerouslySetInnerHTML: {
      __html: inner
    },
    ...rest
  };
  if (!solid) {
    props.stroke = 'currentColor';
    props.strokeWidth = sw;
    props.strokeLinecap = 'round';
    props.strokeLinejoin = 'round';
  }
  return /*#__PURE__*/React.createElement("svg", props);
}
Object.assign(__ds_scope, { ICON_NAMES, Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Icon/Icon.jsx", error: String((e && e.message) || e) }); }

// components/Input/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Input / Search — .asb-input. 3px radius; focus → 1px blue border.
const DEFAULT_SEARCH = /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 24 24",
  width: "15",
  height: "15",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.7",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("circle", {
  cx: "10",
  cy: "10",
  r: "6"
}), /*#__PURE__*/React.createElement("line", {
  x1: "15",
  y1: "15",
  x2: "20",
  y2: "20"
}));
function Input({
  search = false,
  icon,
  className = '',
  ...rest
}) {
  if (search) {
    return /*#__PURE__*/React.createElement("span", {
      className: "asb-search"
    }, /*#__PURE__*/React.createElement("span", {
      className: "asb-search__icon"
    }, icon || DEFAULT_SEARCH), /*#__PURE__*/React.createElement("input", _extends({
      className: ('asb-input ' + className).trim()
    }, rest)));
  }
  return /*#__PURE__*/React.createElement("input", _extends({
    className: ('asb-input ' + className).trim()
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Input/Input.jsx", error: String((e && e.message) || e) }); }

// components/SegmentedToggle/SegmentedToggle.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// SegmentedToggle — .match-toggle. 2–3 exclusive segments, hairline-divided, active fills.
function SegmentedToggle({
  options = [],
  value,
  onChange,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ('match-toggle ' + className).trim(),
    role: "tablist"
  }, rest), options.map(o => {
    const val = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    const active = value === val;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      type: "button",
      role: "tab",
      "aria-selected": active,
      className: 'match-toggle__seg' + (active ? ' is-active' : ''),
      onClick: () => onChange && onChange(val)
    }, label);
  }));
}
Object.assign(__ds_scope, { SegmentedToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/SegmentedToggle/SegmentedToggle.jsx", error: String((e && e.message) || e) }); }

// components/Sidebar/Sidebar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Sidebar / nav — dense grouped navigation. 180px expanded / 48px collapsed rail
// with fixed flyout labels. Active item = tinted fill + accent left border + accent icon.

function Sidebar({
  brand = {
    name: 'Arab ShipBroker',
    sub: 'Portal · Beta'
  },
  groups = [],
  collapsed = false,
  activeItem,
  onSelect,
  className = '',
  ...rest
}) {
  const cls = ['asb-sidebar', collapsed && 'asb-sidebar--collapsed', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("nav", _extends({
    className: cls
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "asb-sidebar__brand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "asb-sidebar__logo"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "Logo",
    size: collapsed ? 24 : 26
  })), !collapsed && /*#__PURE__*/React.createElement("span", {
    className: "asb-sidebar__name"
  }, brand.name, brand.sub && /*#__PURE__*/React.createElement("small", null, brand.sub))), /*#__PURE__*/React.createElement("div", {
    className: "asb-nav"
  }, groups.map((g, gi) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: g.label || gi
  }, g.label && /*#__PURE__*/React.createElement("div", {
    className: "asb-nav__section"
  }, g.label), g.items.map(it => {
    const id = it.id || it.label;
    const active = it.active || activeItem != null && id === activeItem;
    const icls = ['asb-nav__item', it.action && 'asb-nav__item--action', active && 'is-active'].filter(Boolean).join(' ');
    return /*#__PURE__*/React.createElement("button", {
      type: "button",
      key: id,
      className: icls,
      "aria-current": active ? 'page' : undefined,
      onClick: () => onSelect && onSelect(id)
    }, it.icon && /*#__PURE__*/React.createElement("span", {
      className: "asb-nav__icon"
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: it.icon,
      size: 16,
      plus: it.plus
    })), /*#__PURE__*/React.createElement("span", {
      className: "asb-nav__label"
    }, it.label), it.badge != null && /*#__PURE__*/React.createElement("span", {
      className: "asb-nav__badge"
    }, it.badge), collapsed && /*#__PURE__*/React.createElement("span", {
      className: "asb-nav__flyout"
    }, it.label));
  })))));
}
Object.assign(__ds_scope, { Sidebar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Sidebar/Sidebar.jsx", error: String((e && e.message) || e) }); }

// components/SoftCard/SoftCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// SoftCard — .asb-soft-card / .ccx. Shadow-defined, no border; 6px (cargo) / 16px (vessel).
function SoftCard({
  variant = 'cargo',
  hoverable = false,
  children,
  className = '',
  ...rest
}) {
  const cls = ['asb-soft-card', variant === 'vessel' && 'asb-soft-card--vessel', hoverable && 'asb-soft-card--hoverable', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, rest), children);
}

// Tinted inner data zone (1px gaps between zones done by the parent's gap).
function SoftCardZone({
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ('asb-soft-card__zone ' + className).trim()
  }, rest), children);
}
Object.assign(__ds_scope, { SoftCard, SoftCardZone });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/SoftCard/SoftCard.jsx", error: String((e && e.message) || e) }); }

// components/StatusBadge/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// StatusBadge — .asb-badge. 10px/600 uppercase .04em, 2px radius.
function StatusBadge({
  status = 'in',
  children,
  className = '',
  ...rest
}) {
  const cls = ['asb-badge', 'asb-badge--' + status, className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement("span", _extends({
    className: cls
  }, rest), children != null ? children : status);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/StatusBadge/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/TerminalCard/TerminalCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// TerminalCard — .asb-card. Sharp: 4px, 0.5px hairline border, 14px pad.
function TerminalCard({
  hoverable = false,
  as: Tag = 'div',
  children,
  className = '',
  ...rest
}) {
  const cls = ['asb-card', hoverable && 'asb-card--hoverable', className].filter(Boolean).join(' ');
  return /*#__PURE__*/React.createElement(Tag, _extends({
    className: cls
  }, rest), children);
}
Object.assign(__ds_scope, { TerminalCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/TerminalCard/TerminalCard.jsx", error: String((e && e.message) || e) }); }

// components/Toggle/Toggle.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Toggle — .asb-toggle. 34×20 pill; navy on / grey off.
function Toggle({
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    className: ('asb-toggle ' + className).trim()
  }, rest));
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Toggle/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/Tooltip/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Tooltip — .asb-tip. Navy fill, 5px radius; optional severity sub-badge.
function Tooltip({
  title,
  sub,
  children,
  className = '',
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ('asb-tip ' + className).trim(),
    role: "tooltip"
  }, rest), title && /*#__PURE__*/React.createElement("span", {
    className: "asb-tip__title"
  }, title), children, sub && /*#__PURE__*/React.createElement("span", {
    className: "asb-tip__sub"
  }, sub));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/Tooltip/Tooltip.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.ICON_NAMES = __ds_scope.ICON_NAMES;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SegmentedToggle = __ds_scope.SegmentedToggle;

__ds_ns.Sidebar = __ds_scope.Sidebar;

__ds_ns.SoftCard = __ds_scope.SoftCard;

__ds_ns.SoftCardZone = __ds_scope.SoftCardZone;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.TerminalCard = __ds_scope.TerminalCard;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
