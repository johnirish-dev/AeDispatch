import { icon } from './icons.js';
import { toneIconHtml } from './alerts.js';

// Bottom-right toast notifications. They replace the browser's alert() box.
const TYPES = {
  info:    { role: 'status', ms: 5500 },
  success: { role: 'status', ms: 4500 },
  warning: { role: 'alert',  ms: 7000 },
  error:   { role: 'alert',  ms: 8000 }
};

const MAX_VISIBLE = 4;
let host = null;

function getHost() {
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.className = 'bhw-toasts';
    document.body.appendChild(host);
  }
  return host;
}

function dismiss(el) {
  if (!el || el.dataset.closing) return;
  el.dataset.closing = '1';
  el.classList.add('is-leaving');
  setTimeout(() => el.remove(), 220);
}

export function showToast({ type = 'info', title = '', message = '', duration } = {}) {
  const cfg = TYPES[type] || TYPES.info;
  const wrap = getHost();

  // Same message already on screen: keep one copy
  const dup = [...wrap.children].find(t => t.dataset.key === `${type}|${title}|${message}`);
  if (dup) dismiss(dup);

  const el = document.createElement('div');
  el.className = 'bhw-toast';
  el.dataset.tone = TYPES[type] ? type : 'info';
  el.setAttribute('role', cfg.role);
  el.dataset.key = `${type}|${title}|${message}`;

  const tile = document.createElement('span');
  tile.className = 'bhw-toast-icon';
  tile.innerHTML = toneIconHtml(type, 22);

  const body = document.createElement('div');
  body.className = 'bhw-alert-body';
  if (title) {
    const t = document.createElement('strong');
    t.textContent = title;
    body.appendChild(t);
  }
  if (message) {
    const m = document.createElement('span');
    m.textContent = message;
    body.appendChild(m);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bhw-alert-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.innerHTML = icon('x', 14, 1.6);
  close.addEventListener('click', () => dismiss(el));

  el.append(tile, body, close);
  wrap.appendChild(el);

  while (wrap.children.length > MAX_VISIBLE) dismiss(wrap.firstElementChild);

  // Auto-dismiss; pause while the pointer is on it
  let timer = null;
  const start = () => { timer = setTimeout(() => dismiss(el), duration || cfg.ms); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  start();
  return el;
}

export const notify = {
  info: (title, message, opts) => showToast({ type: 'info', title, message, ...opts }),
  success: (title, message, opts) => showToast({ type: 'success', title, message, ...opts }),
  warning: (title, message, opts) => showToast({ type: 'warning', title, message, ...opts }),
  error: (title, message, opts) => showToast({ type: 'error', title, message, ...opts })
};
