import { Store } from './store.js';
import { renderResultCard } from './review.js';
import { renderFormPaper } from './formpaper.js';
import { icon } from './icons.js';
import { esc } from './review.js';
import { showModal } from './alerts.js';

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Case and accent insensitive, so "penafrancia" finds "Peñafrancia"
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const text = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
// Blank values always go last
const withBlankLast = (get, dir) => (a, b) => {
  const x = get(a); const y = get(b);
  if (!x && y) return 1;
  if (x && !y) return -1;
  return dir * text(x, y);
};
const KIND_ORDER = { draft: 0, pending: 1, synced: 2 };

const SORTS = {
  recent:      { label: 'Most recent', cmp: (a, b) => b.ts - a.ts },
  oldest:      { label: 'Oldest first', cmp: (a, b) => a.ts - b.ts },
  houseAsc:    { label: 'House no. (low to high)', cmp: withBlankLast(i => i.houseNo, 1) },
  houseDesc:   { label: 'House no. (high to low)', cmp: withBlankLast(i => i.houseNo, -1) },
  nameAsc:     { label: 'Head of family (A to Z)', cmp: withBlankLast(i => i.head, 1) },
  nameDesc:    { label: 'Head of family (Z to A)', cmp: withBlankLast(i => i.head, -1) },
  purok:       { label: 'Purok (A to Z)', cmp: (a, b) => text(a.purok, b.purok) || (b.ts - a.ts) },
  positive:    { label: 'Most positive findings', cmp: (a, b) => (b.posCont - a.posCont) || (b.ts - a.ts) },
  status:      { label: 'Status (drafts first)', cmp: (a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (b.ts - a.ts) }
};

export async function renderMyForms(root, initialFilter) {
  const me = window.bhwContext;
  const puroks = me?.puroks || [];
  await Store.fetchServerSurveys();

  let searchQuery = '';
  const FILTERS = ['draft', 'pending', 'synced', 'positive'];
  let statusFilter = FILTERS.includes(initialFilter) ? initialFilter : 'all';
  let sortKey = 'recent';
  let purokFilter = 'all';
  let viewingForm = null;
  let paperZoom = 1;
  let paperResizeHandler = null;

  const getCombined = () => {
    const drafts = Store.getDrafts().map(d => ({
      id: d.id,
      kind: 'draft',
      houseNo: d.form.houseNo,
      head: d.form.headOfFamily,
      purok: d.form.purokName || `Purok ${d.form.purokId}`,
      time: formatRelativeTime(d.savedAt),
      ts: d.savedAt || 0,
      progress: d.progress || 66,
      containers: d.form.containers || [],
      details: d.form
    }));
    const queue = Store.getQueue().map(q => ({
      id: q.id,
      kind: 'pending',
      needsReview: Boolean(q.needsReview),
      lastError: q.lastError || '',
      houseNo: q.payload.houseNo,
      head: q.payload.headOfFamily,
      purok: q.purokName || `Purok ${q.payload.purokId}`,
      time: formatRelativeTime(q.queuedAt),
      ts: q.queuedAt || 0,
      containers: q.payload.containers || [],
      details: {
        ...q.payload,
        purokName: q.purokName || `Purok ${q.payload.purokId}`,
        storeys: q.payload.storeys === 1 ? 'Single storey' : q.payload.storeys === 2 ? '2 or more storeys' : (q.payload.storeys || ''),
        screening: q.payload.screened === true ? 'Screened' : q.payload.screened === false ? 'Unscreened' : (q.payload.screening || '')
      }
    }));
    const synced = Store.getSubmittedForms().map(s => ({
      id: s.id,
      kind: 'synced',
      houseNo: s.houseNo,
      head: s.headOfFamily,
      purok: s.purokName || `Purok ${s.purokId}`,
      time: formatRelativeTime(s.surveyedAt),
      ts: s.surveyedAt || 0,
      containers: s.containers || [],
      details: s.form || s
    }));
    return [...drafts, ...queue, ...synced].map(it => ({
      ...it,
      totalCont: it.containers.reduce((s, c) => s + (Number(c.total) || 0), 0),
      posCont: it.containers.reduce((s, c) => s + (Number(c.positive) || 0), 0)
    }));
  };

  const renderDetailView = (item) => {
    if (paperResizeHandler) {
      window.removeEventListener('resize', paperResizeHandler);
      paperResizeHandler = null;
    }

    const d = item.details || {};
    const validConts = (item.containers || []).filter(c => c.containerType);
    const totals = validConts.reduce((acc, c) => ({
      withCover: acc.withCover + (Number(c.withCover) || 0),
      withoutCover: acc.withoutCover + (Number(c.withoutCover) || 0),
      total: acc.total + (Number(c.total) || 0),
      positive: acc.positive + (Number(c.positive) || 0),
      larvae: acc.larvae + (Number(c.larvaeCount) || 0),
      pupae: acc.pupae + (Number(c.pupaeCount) || 0)
    }), { withCover: 0, withoutCover: 0, total: 0, positive: 0, larvae: 0, pupae: 0 });

    const cIndex = totals.total > 0 ? ((totals.positive / totals.total) * 100).toFixed(1) : '0.0';
    const badgeLabel = item.kind === 'draft'
      ? 'Draft'
      : item.needsReview
        ? 'Needs attention'
        : item.kind === 'pending' ? 'Pending sync' : 'Submitted';

    root.innerHTML = `
      <div class="bhw-topbar bhw-forms-detail-topbar">
        <div>
          <div class="bhw-eyebrow">DENGUE FORM 5 · HOUSEHOLD RECORD</div>
          <h1 class="bhw-page-title">House ${item.houseNo || '—'} · ${item.head || 'Unnamed'}</h1>
          <p class="bhw-page-subtitle">${item.purok} · ${item.time}</p>
        </div>
        <div class="bhw-detail-actions" style="display:flex; align-items:center; gap:10px;">
          <span class="bhw-status-badge ${item.kind}">${badgeLabel}</span>
          ${item.kind === 'draft' || item.needsReview ? `<a href="#/survey/${item.id}" class="bhw-pill-btn primary sm">${icon('play', 12)} ${item.needsReview ? 'Fix and retry' : 'Continue draft'}</a>` : ''}
        </div>
      </div>

      <div class="bhw-detail-back-row">
        <button id="btn-back-forms" type="button" class="bhw-back-link">${icon('chevronLeft', 14, 2)} Back to My forms</button>
      </div>

      ${d.fromServer ? `<p style="font-size:13px; color:#6B7280; margin:0 0 12px;">This form was recorded on another phone. Only the container counts are shown here; the household details stay on the phone that recorded it.</p>` : ''}

      <section class="bhw-panel bhw-form-detail-panel">
        ${renderResultCard({ totals, meta: `House ${item.houseNo || '—'} · ${item.purok}` })}

        <div class="bhw-paper-viewer" id="paper-viewer">
          <div class="bhw-paper-toolbar" aria-label="Form preview controls">
            <span class="bhw-paper-toolbar-title">Form preview</span>
            <div class="bhw-paper-zoom-controls">
              <button id="paper-zoom-out" type="button" aria-label="Zoom out">−</button>
              <button id="paper-zoom-fit" type="button">Fit page</button>
              <span id="paper-zoom-level" aria-live="polite">Fit</span>
              <button id="paper-zoom-in" type="button" aria-label="Zoom in">+</button>
            </div>
          </div>
          <div class="bhw-paper-viewport" id="paper-viewport">
            <div class="bhw-paper-stage-shell" id="paper-stage-shell">
              <div class="bhw-paper-stage" id="paper-stage">
                ${renderFormPaper({
                  details: d,
                  containers: validConts,
                  houseNo: item.houseNo,
                  head: item.head,
                  purok: item.purok,
                  barangay: me?.barangay?.name,
                  stampLabel: item.kind === 'draft' ? 'Saved as draft' : item.needsReview ? 'Needs attention' : item.kind === 'pending' ? 'Queued' : 'Submitted',
                  stampTs: item.ts
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    `;

    const viewport = root.querySelector('#paper-viewport');
    const stageShell = root.querySelector('#paper-stage-shell');
    const stage = root.querySelector('#paper-stage');
    const paper = root.querySelector('.bhw-paper');
    const paperWidth = 900;

    const applyPaperScale = () => {
      if (!viewport || !stageShell || !stage || !paper) return;
      const availableWidth = Math.max(1, viewport.clientWidth - 4);
      const fitScale = Math.min(1, availableWidth / paperWidth);
      const scale = Math.min(2, Math.max(0.35, fitScale * paperZoom));
      stage.style.width = `${paperWidth}px`;
      stage.style.transform = `scale(${scale})`;
      stageShell.style.width = `${paperWidth * scale}px`;
      stageShell.style.height = `${paper.offsetHeight * scale}px`;
      root.querySelector('#paper-zoom-level').textContent = paperZoom === 1 ? 'Fit' : `${Math.round(scale * 100)}%`;
    };

    const schedulePaperScale = () => window.requestAnimationFrame(applyPaperScale);
    paperResizeHandler = schedulePaperScale;
    window.addEventListener('resize', paperResizeHandler);
    schedulePaperScale();

    root.querySelector('#paper-zoom-out').addEventListener('click', () => {
      paperZoom = Math.max(0.7, Number((paperZoom - 0.15).toFixed(2)));
      applyPaperScale();
    });
    root.querySelector('#paper-zoom-fit').addEventListener('click', () => {
      paperZoom = 1;
      applyPaperScale();
    });
    root.querySelector('#paper-zoom-in').addEventListener('click', () => {
      paperZoom = Math.min(2, Number((paperZoom + 0.15).toFixed(2)));
      applyPaperScale();
    });

    root.querySelector('#btn-back-forms').addEventListener('click', () => {
      if (paperResizeHandler) {
        window.removeEventListener('resize', paperResizeHandler);
        paperResizeHandler = null;
      }
      viewingForm = null;
      render();
    });
  };

  const render = () => {
    if (viewingForm) {
      renderDetailView(viewingForm);
      return;
    }

    const all = getCombined();
    const counts = {
      draft: all.filter(i => i.kind === 'draft').length,
      pending: all.filter(i => i.kind === 'pending').length,
      synced: all.filter(i => i.kind === 'synced').length,
      positive: all.filter(i => i.posCont > 0).length
    };

    root.innerHTML = `
      <div class="bhw-topbar bhw-forms-topbar">
        <div>
          <h1 class="bhw-page-title">My forms</h1>
          <p class="bhw-page-subtitle">${all.length} household ${all.length === 1 ? 'form' : 'forms'} recorded in this barangay and on this phone</p>
        </div>
        <a href="#/survey" class="bhw-pill-btn primary">${icon('plus', 14)} New household survey</a>
      </div>

      <div class="bhw-filter-bar bhw-forms-filters">
        <div style="position:relative; display:flex; align-items:center;">
          <span style="position:absolute; left:14px; color:#6B7280; display:inline-flex; pointer-events:none;">${icon('search', 15)}</span>
          <input id="q-search" class="bhw-search-input" style="padding-left:38px;" type="search" placeholder="Search by house no., name or purok" value="${esc(searchQuery)}" autocomplete="off">
        </div>
        <div class="bhw-field">
          <label for="q-status">Status</label>
          <select id="q-status" class="bhw-filter-select">
            <option value="all">All (${all.length})</option>
            <option value="draft">Draft (${counts.draft})</option>
            <option value="pending">Pending sync (${counts.pending})</option>
            <option value="synced">Submitted (${counts.synced})</option>
            <option value="positive">With positive findings (${counts.positive})</option>
          </select>
        </div>
        <div class="bhw-field">
          <label for="q-purok">Purok</label>
          <select id="q-purok" class="bhw-filter-select">
            <option value="all">All puroks</option>
            ${puroks.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="bhw-field">
          <label for="q-sort">Sort by</label>
          <select id="q-sort" class="bhw-filter-select">
            ${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div id="forms-count" class="bhw-forms-count" aria-live="polite" style="font-size:12px; color:#6B7280; margin-bottom:12px;"></div>

      <section class="bhw-panel bhw-flist" id="forms-rows"></section>
    `;

    // Only the list is redrawn while typing, so the search box keeps focus and the caret
    const searchEl = root.querySelector('#q-search');
    const statusEl = root.querySelector('#q-status');
    const purokEl = root.querySelector('#q-purok');
    const sortEl = root.querySelector('#q-sort');
    statusEl.value = statusFilter;
    purokEl.value = purokFilter;
    sortEl.value = sortKey;

    const countEl = root.querySelector('#forms-count');
    const listEl = root.querySelector('#forms-rows');

    const renderList = () => {
      const tokens = norm(searchQuery).replace(/#/g, ' ').split(/\s+/).filter(Boolean);
      const filtered = all.filter(item => {
        if (statusFilter === 'positive') { if (!(item.posCont > 0)) return false; }
        else if (statusFilter !== 'all' && item.kind !== statusFilter) return false;
        if (purokFilter !== 'all' && item.purok !== purokFilter) return false;
        if (tokens.length === 0) return true;
        const hay = norm(`house ${item.houseNo} ${item.head} ${item.purok}`);
        return tokens.every(t => hay.includes(t));
      }).sort(SORTS[sortKey].cmp);

      countEl.textContent = `Showing ${filtered.length} of ${all.length} ${all.length === 1 ? 'form' : 'forms'}`;

      if (all.length === 0) {
        listEl.innerHTML = `
          <div class="bhw-empty">
            <strong>No forms recorded yet</strong>
            <p>Household surveys you save or submit, and the barangay's recent submitted forms, will show up here.</p>
            <a href="#/survey" class="bhw-pill-btn primary sm">${icon('plus', 12)} New household survey</a>
          </div>`;
        return;
      }
      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="bhw-empty">
            <strong>No forms match your search</strong>
            <p>Try a different house number, name or purok, or clear the filters.</p>
            <button type="button" id="clear-filters" class="bhw-pill-btn outline sm">Clear search and filters</button>
          </div>`;
        listEl.querySelector('#clear-filters').addEventListener('click', () => {
          searchQuery = ''; statusFilter = 'all'; purokFilter = 'all';
          searchEl.value = ''; statusEl.value = 'all'; purokEl.value = 'all';
          renderList();
        });
        return;
      }

      listEl.innerHTML = `
        <div class="bhw-flist-head" aria-hidden="true">
          <span>House no.</span><span>Head of family</span><span>Purok</span><span>Findings</span><span>Status</span><span>Actions</span>
        </div>`;

      filtered.forEach(f => {
        const row = document.createElement('div');
        row.className = 'bhw-frow';
        if (f.kind !== 'draft' && !f.needsReview) {
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.setAttribute('aria-label', `View House ${f.houseNo || ''} ${f.head || ''}`);
        }

        const findingHtml = f.kind === 'draft'
          ? `<span class="bhw-finding-badge is-pending">In progress</span>`
          : f.posCont > 0
            ? `<span class="bhw-finding-badge is-positive">Positive finding</span>`
            : `<span class="bhw-finding-badge is-clear">No positive findings</span>`;

        const statusHtml = f.kind === 'draft'
          ? `<span class="bhw-status-badge draft">Draft</span>`
          : `<span class="bhw-status-badge ${f.needsReview ? 'needs-review' : f.kind}">${f.needsReview ? 'Needs attention' : f.kind === 'pending' ? 'Pending sync' : 'Submitted'}</span>`;

        const house = String(f.houseNo || '—');
        row.innerHTML = `
          <div class="bhw-fhouse" data-label="House no.">
            <span class="bhw-fhouse-no">${esc(house)}</span>
          </div>
          <div class="bhw-fhead" data-label="Head of family">${esc(f.head || 'Unnamed')}</div>
          <div class="bhw-fpurok" data-label="Purok">${esc(f.purok)}</div>
          <div class="bhw-finding" data-label="Findings">${findingHtml}</div>
          <div class="bhw-fstatus" data-label="Status">${statusHtml}</div>
          <div class="bhw-factions" data-label="Actions">
            ${f.kind === 'draft' || f.needsReview ? `<a href="#/survey/${esc(f.id)}" class="bhw-pill-btn outline sm continue-btn">${f.needsReview ? 'Fix and retry' : 'Continue'}</a>` : ''}
            ${f.kind === 'draft' || f.needsReview
              ? `<button type="button" class="bhw-pill-btn danger-outline sm delete-btn">Delete</button>`
              : `<button type="button" class="bhw-pill-btn text-action sm view-btn">View ${icon('chevronRight', 12, 2)}</button>`}
          </div>
        `;

        const open = () => { paperZoom = 1; viewingForm = f; render(); };
        if (f.kind !== 'draft' && !f.needsReview) {
          row.addEventListener('click', (e) => {
            if (e.target.closest('.view-btn')) return;
            open();
          });
          row.addEventListener('keydown', (e) => {
            if (e.target !== row) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
          });
          row.querySelector('.view-btn').addEventListener('click', open);
        } else if (f.kind === 'draft' || f.needsReview) {
          row.querySelector('.delete-btn').addEventListener('click', async () => {
            const result = await showModal({
              type: 'warning',
              title: 'Delete this draft?',
              message: `The saved form for House ${house} will be removed from this device.`,
              actions: [
                { label: 'Keep draft', value: 'cancel' },
                { label: 'Delete draft', value: 'delete', primary: true, danger: true }
              ]
            });
            if (result === 'delete') {
              if (f.kind === 'draft') Store.deleteDraft(f.id);
              else Store.dequeue(f.id);
              render();
            }
          });
        }
        listEl.appendChild(row);
      });
    };

    searchEl.addEventListener('input', e => { searchQuery = e.target.value; renderList(); });
    statusEl.addEventListener('change', e => { statusFilter = e.target.value; renderList(); });
    purokEl.addEventListener('change', e => { purokFilter = e.target.value; renderList(); });
    sortEl.addEventListener('change', e => { sortKey = e.target.value; renderList(); });

    renderList();
  };

  render();
}
