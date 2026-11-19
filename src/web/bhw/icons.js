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
  chevronUp: '<path d="M4 10l4-4 4 4"/>',
  chevronLeft: '<path d="M10 3.5L5.5 8 10 12.5"/>',
  minus: '<path d="M3.5 8h9"/>',
  calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.8"/><path d="M2.5 6.8h11"/><path d="M5.5 2v3"/><path d="M10.5 2v3"/>',
  alert: '<path d="M8 2.6l5.8 10a.6.6 0 0 1-.5.9H2.7a.6.6 0 0 1-.5-.9L8 2.6z"/><path d="M8 6.8v3"/><path d="M8 11.7v.1"/>',
  exclaim: '<path d="M8 4v5"/><path d="M8 11.8v.2"/>',
  info: '<circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v3.6"/><path d="M8 5.2v.2"/>',
  doubleCheck: '<path d="M1.8 8.6l2.9 2.9 5.2-6"/><path d="M7.4 10.4l.7.7 5.7-6.5"/>',
  ban: '<circle cx="8" cy="8" r="6.2"/><path d="M3.7 3.7l8.6 8.6"/>',
  x: '<path d="M4 4l8 8"/><path d="M12 4l-8 8"/>',
  sync: '<path d="M13.2 7.2A5.3 5.3 0 0 0 3.6 4.8M2.8 2.8V5.2H5.2M2.8 8.8A5.3 5.3 0 0 0 12.4 11.2M13.2 13.2V10.8H10.8"/>',
  chevronRight: '<path d="M6 3.5L10.5 8 6 12.5"/>',
  checkCircle: '<circle cx="8" cy="8" r="6.2"/><path d="M5.2 8.3l2 2 3.6-4"/>'
};

export function icon(name, size = 14, stroke = 1.5) {
  const body = SVG_PATHS[name] || '';
  return `<svg class="bhw-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
