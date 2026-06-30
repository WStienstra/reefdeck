/**
 * ReefDeck Icons — cohesive inline-SVG icon set (no emoji, no deps).
 * 24x24 grid, 1.75 stroke, round joins, currentColor. Filled icons set
 * fill on their own paths and override stroke locally.
 */
window.ICONS = {
  // ui chrome
  menu:      '<path d="M4 7h16M4 12h16M4 17h16"/>',
  // brand
  waves:     '<path d="M2 8c2.2-2.2 4.3-2.2 6.5 0s4.3 2.2 6.5 0 4.3-2.2 6.5 0"/><path d="M2 14c2.2-2.2 4.3-2.2 6.5 0s4.3 2.2 6.5 0 4.3-2.2 6.5 0"/>',
  // nav
  dashboard: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/>',
  droplet:   '<path d="M12 3s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.4 12 3 12 3Z"/>',
  dropletPlus:'<path d="M12 3s6 6.4 6 10.5a6 6 0 0 1-12 0C6 9.4 12 3 12 3Z"/><path d="M12 10.5v5M9.5 13h5"/>',
  history:   '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  chart:     '<path d="M4 4v15a1 1 0 0 0 1 1h15"/><path d="M7.5 14.5l3.2-3.6 2.8 2.2L20 7"/>',
  fish:      '<path d="M3 12c3-4.4 7.4-5.5 10.4-5.5 3 0 5.6 2.2 6.6 5.5-1 3.3-3.6 5.5-6.6 5.5C10.4 17.5 6 16.4 3 12Z"/><path d="M3 12c1.3.9 2.6 1.4 2.6 1.4M3 12c1.3-.9 2.6-1.4 2.6-1.4"/><circle cx="16" cy="10.6" r="1" fill="currentColor" stroke="none"/>',
  journal:   '<path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z"/><path d="M5 16.5h13"/><path d="M9 8h6M9 11h4"/>',
  sliders:   '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.3"/><circle cx="8" cy="17" r="2.3"/>',
  download:  '<path d="M12 3v12"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  info:      '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5M12 7.8h.01"/>',
  // actions / ui
  plus:      '<path d="M12 5v14M5 12h14"/>',
  trash:     '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7"/>',
  alert:     '<path d="M12 3.2 1.8 20.5h20.4L12 3.2Z"/><path d="M12 10v4.5M12 17.6h.01"/>',
  check:     '<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>',
  arrowRight:'<path d="M5 12h13"/><path d="M12.5 6l6 6-6 6"/>',
  edit:      '<path d="M4 20h4L19 9a2 2 0 0 0-2.8-2.8L5 17v3Z"/><path d="M14.5 7.5l2.8 2.8"/>',
  note:      '<path d="M5 4h14v11l-5 5H5V4Z"/><path d="M14 20v-5h5"/>',
  lock:      '<rect x="5" y="11" width="14" height="9" rx="2.2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sparkle:   '<path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7L12 3Z" fill="currentColor" stroke="none"/>',
  cloud:     '<path d="M7.5 18.5a4.2 4.2 0 0 1-.3-8.4 5.2 5.2 0 0 1 9.9-1.3 3.6 3.6 0 0 1 .6 7.1"/><path d="M7 18.5h10.5"/>',
  layers:    '<path d="M12 3l9 5-9 5-9-5 9-5Z"/><path d="M3 13l9 5 9-5"/>',
  wifi:      '<path d="M4.5 12.5a11 11 0 0 1 15 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none"/>',
  // scheduler / calculator / settings
  calendar:  '<rect x="3.5" y="5" width="17" height="16" rx="2.2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  clock:     '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  repeat:    '<path d="M4 9a5 5 0 0 1 5-5h7l-2.2-2.2M20 15a5 5 0 0 1-5 5H8l2.2 2.2"/>',
  bell:      '<path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 5 2 6.5 2 6.5H4.5s2-1.5 2-6.5Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  calculator:'<rect x="5" y="2.5" width="14" height="19" rx="2.2"/><path d="M8 6.5h8"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 14.5h.01M12 14.5h.01M15.5 14.5v3.5M8.5 18h3.5"/>',
  beaker:    '<path d="M9 3v6.5L4.7 17a2 2 0 0 0 1.8 3h11a2 2 0 0 0 1.8-3L15 9.5V3"/><path d="M7.5 3h9M7.8 14h8.4"/>',
  wrench:    '<path d="M15.5 7.5a4 4 0 0 1-5.3 5.3L5 18.3 4 17l5.2-5.2A4 4 0 0 1 14.5 6.5l-2.5 2.5 1.5 1.5 2.5-2.5c.3.4.5.9.5 1.5Z"/>',
  sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8"/>',
  moon:      '<path d="M20 13.5A8 8 0 0 1 10.5 4a7 7 0 1 0 9.5 9.5Z"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
  waterChange:'<path d="M12 3s5.5 6 5.5 9.7a5.5 5.5 0 0 1-11 0C6.5 9 12 3 12 3Z"/><path d="M9 13.5c.5 1.6 1.8 2.5 3 2.5"/>',
  // delta carets (filled)
  caretUp:   '<path d="M12 8l5 8H7l5-8Z" fill="currentColor" stroke="none"/>',
  caretDown: '<path d="M12 16l-5-8h10l-5 8Z" fill="currentColor" stroke="none"/>',
  flat:      '<path d="M6 12h12"/>',
  // inventory types
  coral:     '<path d="M12 21v-7"/><path d="M12 14.5c-1.7 0-2.7-1.3-2.7-2.8 0-1.1.7-1.8.7-3.1"/><path d="M12 13c1.7 0 2.7-1.3 2.7-2.8 0-1.3-.9-1.9-.9-3.3"/><circle cx="9.4" cy="7.2" r="1.7"/><circle cx="14.6" cy="6" r="1.7"/><circle cx="12" cy="5.4" r="1.7"/>',
  invert:    '<path d="M12 20a7 7 0 1 0-7-7c0 2.2 1.8 4 4 4s3.2-1.6 3.2-3.1-1.1-2.4-2.3-2.4"/><path d="M17.5 7.5 19.5 6M19 10.5l1.8-.6"/>',
  equipment: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.2v2.6M12 18.2v2.6M20.8 12h-2.6M5.8 12H3.2M18.2 5.8l-1.9 1.9M7.7 16.3l-1.9 1.9M18.2 18.2l-1.9-1.9M7.7 7.7 5.8 5.8"/>',
  other:     '<path d="M12 3l8.5 4.8v8.4L12 21l-8.5-4.8V7.8L12 3Z"/><path d="M3.7 7.9 12 12.6l8.3-4.7M12 12.6V21"/>',
  crown:     '<path d="M3 7l4.5 4L12 5l4.5 6L21 7l-1.8 11H4.8L3 7Z" fill="currentColor" stroke="none"/>',
  chip:      '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3"/>',
  gauge:     '<path d="M4 14a8 8 0 0 1 16 0"/><path d="M12 14l4-3"/><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none"/>',
  printer:   '<path d="M7 8V3h10v5"/><rect x="4.5" y="8" width="15" height="8" rx="1.8"/><path d="M7 14h10v6H7v-6Z"/><circle cx="16.5" cy="11" r="0.9" fill="currentColor" stroke="none"/>',
  zap:       '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" fill="currentColor" stroke="none"/>',
  camera:    '<path d="M2 9a2 2 0 0 1 2-2h2.4L8 4.5h8L17.6 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9Z"/><circle cx="12" cy="13" r="3.2"/>',
};

(function () {
  function svgIcon(name, size, cls) {
    var inner = window.ICONS[name];
    if (inner == null) inner = '';
    size = size || 20;
    return '<svg class="icon ' + (cls || '') + '" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  // Inject icons into any [data-icon] element (used for static markup like the sidebar nav).
  function injectIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      var size = parseInt(el.getAttribute('data-icon-size') || '20', 10);
      el.innerHTML = svgIcon(el.getAttribute('data-icon'), size);
    });
  }
  window.svgIcon = svgIcon;
  window.injectIcons = injectIcons;
})();
