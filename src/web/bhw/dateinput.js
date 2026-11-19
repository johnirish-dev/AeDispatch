import { icon } from './icons.js';

// The app stores dates as yyyy-mm-dd. The form shows and accepts dd/mm/yyyy.
export function isoToDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function dmyToISO(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text || '');
  if (!m) return '';
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function todayISO() {
  const t = new Date();
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
}

function mask(raw, deleting) {
  const d = String(raw).replace(/\D/g, '').slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2 || (d.length === 2 && !deleting)) out += '/' + d.slice(2, 4);
  if (d.length > 4 || (d.length === 4 && !deleting)) out += '/' + d.slice(4);
  return out;
}

// Starts empty (no automatic "today"). A calendar button is there as a shortcut.
export function dateInputHtml({ id, iso = '' }) {
  return `
    <div class="bhw-date-wrap">
      <input id="${id}" class="bhw-control bhw-date-text" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="dd/mm/yyyy" value="${isoToDMY(iso)}">
      <button type="button" class="bhw-date-btn" aria-label="Pick date from calendar" tabindex="-1">${icon('calendar', 15)}</button>
      <input type="date" class="bhw-date-native" tabindex="-1" aria-hidden="true" max="${todayISO()}" value="${iso}">
    </div>`;
}

export function bindDateInputs(scope) {
  scope.querySelectorAll('.bhw-date-wrap').forEach((wrap) => {
    const text = wrap.querySelector('.bhw-date-text');
    const native = wrap.querySelector('.bhw-date-native');
    const btn = wrap.querySelector('.bhw-date-btn');

    text.addEventListener('input', (e) => {
      const deleting = Boolean(e.inputType && e.inputType.startsWith('delete'));
      const masked = mask(text.value, deleting);
      if (text.value !== masked) text.value = masked;
      const iso = dmyToISO(masked);
      native.value = iso;
    });

    btn.addEventListener('click', () => {
      native.value = dmyToISO(text.value);
      try {
        native.showPicker();
      } catch (_) {
        native.focus();
        native.click();
      }
    });

    native.addEventListener('change', () => {
      text.value = isoToDMY(native.value);
      text.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
}
