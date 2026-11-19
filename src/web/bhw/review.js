import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function sumGroup(list) {
  return list.reduce((acc, c) => ({
    withCover: acc.withCover + (Number(c.withCover) || 0),
    withoutCover: acc.withoutCover + (Number(c.withoutCover) || 0),
    total: acc.total + (Number(c.total) || 0),
    positive: acc.positive + (Number(c.positive) || 0),
    larvae: acc.larvae + (Number(c.larvaeCount) || 0),
    pupae: acc.pupae + (Number(c.pupaeCount) || 0)
  }), { withCover: 0, withoutCover: 0, total: 0, positive: 0, larvae: 0, pupae: 0 });
}

const GROUPS = [
  { key: 'indoor', label: 'Indoor containers', short: 'Indoor' },
  { key: 'outdoor', label: 'Outdoor containers', short: 'Outdoor' },
  { key: 'natural', label: 'Natural containers', short: 'Natural' }
];

// Inspection result: status icon, headline, and a ring showing the container index.
export function renderResultCard({ totals, meta }) {
  const positive = totals.positive > 0;
  const ci = totals.total > 0 ? (totals.positive / totals.total) * 100 : 0;
  const ciText = `${Number.isInteger(ci) ? ci : ci.toFixed(1)}%`;
  const title = positive
    ? `Larvae or pupae found in ${totals.positive} ${totals.positive === 1 ? 'container' : 'containers'}`
    : 'No larvae or pupae detected';

  return `
    <div class="bhw-result ${positive ? 'is-alert' : ''}" role="status">
      <div class="bhw-result-icon">${positive ? icon('exclaim', 22, 2.4) : icon('check', 22, 2.4)}</div>
      <div class="bhw-result-main">
        <span class="bhw-result-label">Inspection result</span>
        <strong class="bhw-result-title">${title}</strong>
        <span class="bhw-result-meta">${esc(meta)}</span>
      </div>
      <div class="bhw-result-gauge">
        <div class="bhw-ring" style="--p:${Math.min(100, ci).toFixed(1)}"><span>${ciText}</span></div>
        <div class="bhw-gauge-text">
          <strong>${totals.positive} of ${totals.total}</strong>
          <span>containers positive</span>
        </div>
      </div>
    </div>`;
}

// Water containers block: stat tiles, grouped table, and an "All containers" total row.
export function renderContainersReview({ conts, totals, editHtml = '' }) {
  const stat = (label, value, hot = false) => `
    <div class="bhw-stat ${hot && value > 0 ? 'is-hot' : ''}"><span>${label}</span><strong>${value}</strong></div>`;

  const cells = (vals, { natural = false, pos = true } = {}) => {
    const [wc, woc, tot, p, l, pu] = vals;
    const cell = (n, cls = '') => `<td class="${Number(n) === 0 ? 'is-zero' : ''} ${cls}">${n}</td>`;
    return `
      ${natural ? '<td class="is-zero">—</td>' : cell(wc)}
      ${cell(woc)}
      <td class="tot">${tot}</td>
      ${cell(p, pos && Number(p) > 0 ? 'is-pos' : '')}
      ${cell(l)}
      ${cell(pu)}`;
  };

  const known = new Set(GROUPS.map((g) => g.key));
  const loose = conts.filter((c) => !known.has(c.location));
  const groups = [...GROUPS, ...(loose.length ? [{ key: '__other', label: 'Containers', short: 'Containers' }] : [])];

  const body = groups.map((g) => {
    const rows = g.key === '__other' ? loose : conts.filter((c) => c.location === g.key);
    if (rows.length === 0) return '';
    const sub = sumGroup(rows);
    return `
      <tr class="grp"><th colspan="7" scope="colgroup">${g.label}</th></tr>
      ${rows.map((c) => `
        <tr>
          <td class="name">${esc(c.containerType)}</td>
          ${cells([c.withCover, c.withoutCover, c.total, c.positive, c.larvaeCount, c.pupaeCount], { natural: g.key === 'natural' })}
        </tr>`).join('')}
      <tr class="sub">
        <td class="name">${g.short} subtotal</td>
        ${cells([sub.withCover, sub.withoutCover, sub.total, sub.positive, sub.larvae, sub.pupae], { natural: g.key === 'natural', pos: false })}
      </tr>`;
  }).join('');

  return `
    <div class="bhw-review-box bhw-cont-review">
      <div class="bhw-review-hdr">
        <div class="bhw-review-titles">
          <span class="bhw-review-title">Water containers</span>
          <span class="bhw-review-sub">Dengue Form 5</span>
        </div>
        ${editHtml}
      </div>

      <div class="bhw-stats">
        ${stat('Inspected', totals.total)}
        ${stat('With cover', totals.withCover)}
        ${stat('Without cover', totals.withoutCover)}
        ${stat('Positive (+)', totals.positive, true)}
        ${stat('Larvae', totals.larvae)}
        ${stat('Pupae', totals.pupae)}
      </div>

      ${conts.length === 0
        ? '<p class="bhw-empty-note">No water containers recorded at this household.</p>'
        : `
        <div class="bhw-ctable-wrap">
          <table class="bhw-ctable">
            <thead>
              <tr>
                <th scope="col">Type of container</th>
                <th scope="col">With cover</th>
                <th scope="col">Without cover</th>
                <th scope="col">Total</th>
                <th scope="col">Positive (+)</th>
                <th scope="col">Larvae</th>
                <th scope="col">Pupae</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot>
              <tr class="grand">
                <td class="name">All containers</td>
                <td>${totals.withCover}</td>
                <td>${totals.withoutCover}</td>
                <td>${totals.total}</td>
                <td>${totals.positive}</td>
                <td>${totals.larvae}</td>
                <td>${totals.pupae}</td>
              </tr>
            </tfoot>
          </table>
        </div>`}
    </div>`;
}
