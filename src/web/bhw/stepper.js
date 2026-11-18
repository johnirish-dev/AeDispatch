import { icon } from './icons.js';

const toInt = (raw) => {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  return digits === '' ? '' : parseInt(digits, 10);
};

// Quantity input: [ - ] 1 [ + ]. The number is still typeable, and negatives are impossible.
export function stepperHtml({ id = '', cls = '', value = '', min = 0, max = 999, label = 'value', placeholder = '–', disabled = false, size = '' }) {
  const v = value === null || value === undefined ? '' : value;
  return `
    <div class="bhw-stepper ${size}" data-min="${min}" data-max="${max}">
      <button type="button" class="bhw-step-btn" data-dir="-1" aria-label="Decrease ${label}" tabindex="-1" ${disabled ? 'disabled' : ''}>${icon('minus', 12)}</button>
      <input ${id ? `id="${id}"` : ''} class="bhw-step-input ${cls}" type="text" inputmode="numeric" autocomplete="off" aria-label="${label}" placeholder="${placeholder}" value="${v}" ${disabled ? 'disabled' : ''}>
      <button type="button" class="bhw-step-btn" data-dir="1" aria-label="Increase ${label}" tabindex="-1" ${disabled ? 'disabled' : ''}>${icon('plus', 12)}</button>
    </div>`;
}

export function bindSteppers(scope) {
  scope.querySelectorAll('.bhw-stepper').forEach((wrap) => {
    const input = wrap.querySelector('.bhw-step-input');
    const [minus, plus] = wrap.querySelectorAll('.bhw-step-btn');
    const min = Number(wrap.dataset.min) || 0;
    const max = Number(wrap.dataset.max) || 999;

    const sync = () => {
      const v = toInt(input.value);
      minus.disabled = input.disabled || v === '' || v <= min;
      plus.disabled = input.disabled || (v !== '' && v >= max);
    };

    // Digits only. Anything above max is capped, anything below min (such as 0 for age) is rejected.
    input.addEventListener('input', () => {
      let v = toInt(input.value);
      if (v !== '' && v > max) v = max;
      if (v !== '' && v < min) v = '';
      input.value = v === '' ? '' : String(v);
      sync();
    });

    const commit = (v) => {
      input.value = v === '' ? '' : String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    minus.addEventListener('click', () => {
      const v = toInt(input.value);
      if (v === '') return;
      commit(Math.max(min, v - 1));
    });
    plus.addEventListener('click', () => {
      const v = toInt(input.value);
      commit(v === '' ? Math.max(min, 1) : Math.min(max, v + 1));
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); plus.click(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); minus.click(); }
    });

    sync();
  });
}
