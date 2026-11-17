const SVG_PATHS = {
  clock: '<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.4 1.4"/>',
  arrowUpRight: '<path d="M4.8 11.2L11.2 4.8"/><path d="M6.2 4.8h5v5"/>',
  plus: '<path d="M8 3.5v9"/><path d="M3.5 8h9"/>',
  check: '<path d="M3.5 8.3l3 3 6-6.5"/>',
  save: '<path d="M3 2.5h8.2L13.5 4.8V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z"/><path d="M5 2.5v3.5h5V2.5"/><path d="M4.8 9.5h6.4v4H4.8z"/>',
  edit: '<path d="M11.3 2.5a1.4 1.4 0 0 1 2 2L5.5 12.3 2.5 13l.7-3L11.3 2.5z"/>',
  trash: '<path d="M2.8 4.2h10.4"/><path d="M6 4.2V2.8c0-.3.2-.5.5-.5h3c.3 0 .5.2.5.5v1.4"/><path d="M4.2 4.2l.6 8.5c0 .5.4.8.9.8h4.6c.5 0 .9-.3.9-.8l.6-8.5"/><path d="M6.8 7v4"/><path d="M9.2 7v4"/>',
  play: '<polygon points="5,3.2 12.2,8 5,12.8"/>',
  send: '<path d="M13.8 2.2L7.2 8.8"/><path d="M13.8 2.2L9.5 13.8 7.2 8.8 2.2 6.5 13.8 2.2z"/>',
  search: '<circle cx="7.2" cy="7.2" r="4.6"/><path d="M10.6 10.6L13.8 13.8"/>',
  chevronUp: '<path d="M4 10l4-4 4 4"/>'
};

export function icon(name, size = 14) {
  const body = SVG_PATHS[name] || '';
  return `<svg class="bhw-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}