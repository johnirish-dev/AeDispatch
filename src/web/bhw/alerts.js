import { icon } from './icons.js';

// Alert types, matched to how urgent they are:
//   showModal()       blocking, centre of the screen (needs a decision or must not be missed)
//   showBanner()      non-blocking, top of the content area (status that stays until dismissed)
//   showInlineAlert() inside the form or section it belongs to (problems the person can fix right there)
//   notify.*          toast in the corner (short confirmations that fade away); see toast.js

const TONE_ICON = { info: 'info', success: 'doubleCheck', warning: 'alert', error: 'ban' };

export function toneIconHtml(type, size = 22) {
  return icon(TONE_ICON[type] || 'info', size, 1.6);
}

function textBlock(title, message) {
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
  return body;
}

/* ---------- Inline alert ---------- */
export function showInlineAlert(slot, { type = 'warning', title = '', message = '' } = {}) {
  if (!slot) return null;
  slot.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'bhw-alert';
  el.dataset.tone = type;
  el.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');

  const tile = document.createElement('span');
  tile.className = 'bhw-alert-icon';
  tile.innerHTML = toneIconHtml(type, 18);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'bhw-alert-close';
  close.setAttribute('aria-label', 'Close warning');
  close.innerHTML = icon('x', 14, 1.6);

  let timer;
  let removeTimer;
  let paused = false;
  const startTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, 5000);
  };
  const pauseTimer = () => {
    paused = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const resumeTimer = () => {
    paused = false;
    startTimer();
  };
  const dismiss = () => {
    if (paused) return;
    if (el.classList.contains('is-leaving')) return;
    if (timer) clearTimeout(timer);
    el.classList.add('is-leaving');
    removeTimer = setTimeout(() => el.remove(), 320);
  };

  close.addEventListener('click', dismiss);
  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', resumeTimer);
  el.addEventListener('focusin', pauseTimer);
  el.addEventListener('focusout', (event) => {
    if (!el.contains(event.relatedTarget)) resumeTimer();
  });
  el.append(tile, textBlock(title, message), close);
  slot.appendChild(el);
  startTimer();
  return el;
}

export function clearInlineAlert(slot) {
  if (slot) slot.innerHTML = '';
}

/* ---------- Banner (top of the content area) ---------- */
export function hideBanner(id) {
  document.querySelectorAll(`#bhw-banner-slot [data-id="${id}"]`).forEach((n) => n.remove());
}

export function showBanner({ id = 'banner', type = 'info', title = '', message = '', actionLabel = '', onAction = null, dismissible = true } = {}) {
  const slot = document.getElementById('bhw-banner-slot');
  if (!slot) return null;
  hideBanner(id);

  const el = document.createElement('div');
  el.className = 'bhw-banner';
  el.dataset.tone = type;
  el.dataset.id = id;
  el.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');

  const tile = document.createElement('span');
  tile.className = 'bhw-banner-icon';
  tile.innerHTML = toneIconHtml(type, 20);
  el.append(tile, textBlock(title, message));

  if (actionLabel && onAction) {
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'bhw-banner-action';
    act.textContent = actionLabel;
    act.addEventListener('click', () => onAction(el));
    el.appendChild(act);
  }
  if (dismissible) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bhw-alert-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = icon('x', 14, 1.6);
    close.addEventListener('click', () => el.remove());
    el.appendChild(close);
  }
  slot.appendChild(el);
  return el;
}

/* ---------- Modal dialog (blocking) ---------- */
// Resolves with the clicked action's value, or null when dismissed with Esc or the backdrop.
export function showModal({ type = 'info', title = '', message = '', actions = [{ label: 'OK', value: 'ok', primary: true }], dismissible = true } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'bhw-modal-backdrop';

    const dlg = document.createElement('div');
    dlg.className = 'bhw-modal';
    dlg.dataset.tone = type;
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    const titleId = `bhw-modal-t-${Date.now()}`;
    dlg.setAttribute('aria-labelledby', titleId);

    const tile = document.createElement('span');
    tile.className = 'bhw-modal-icon';
    tile.innerHTML = toneIconHtml(type, 24);

    const h = document.createElement('h2');
    h.id = titleId;
    h.className = 'bhw-modal-title';
    h.textContent = title;

    const p = document.createElement('p');
    p.className = 'bhw-modal-text';
    p.textContent = message;

    const row = document.createElement('div');
    row.className = 'bhw-modal-actions';

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) { e.preventDefault(); close(null); }
      if (e.key === 'Tab') {
        const items = [...dlg.querySelectorAll('button')];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };

    function close(value) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    }

    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `bhw-pill-btn ${a.primary ? 'primary' : 'outline'}${a.danger ? ' danger' : ''}`;
      b.textContent = a.label;
      b.addEventListener('click', () => close(a.value));
      row.appendChild(b);
    });

    dlg.append(tile, h, p, row);
    backdrop.appendChild(dlg);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop && dismissible) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);

    const primary = row.querySelector('.primary') || row.querySelector('button');
    if (primary) primary.focus();
  });
}
