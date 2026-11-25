import { Store } from './store.js';
import { renderResultCard } from './review.js';
import { renderFormPaper } from './formpaper.js';
import { icon } from './icons.js';
import { esc } from './review.js';
import { showModal } from './alerts.js';
import { get, post } from '../shared/api.js';

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
const purokLabel = (name, id) => name || (id ? `Purok ${id}` : 'No purok selected');

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

const TASK_NAMES = { search_and_destroy: 'Tier 1 · Search & destroy', spot_check: 'Spot check', tier2_verification: 'Tier 2 review' };
const TASK_STATES = { new: 'Not started', in_progress: 'In progress' };

export async function renderMyForms(root, initialFilter) {
  const me = window.bhwContext;
  const puroks = me?.puroks || [];
  await Store.fetchServerSurveys();

  // The officer's open assignments for this barangay. Without a connection the panel is simply left out.
  let tasks = [];
  const loadTasks = async () => {
    try {
      const all = await get('/api/bhw/tasks');
      window.bhwTasks = all;
      tasks = all.filter(t => t.status !== 'completed');
    } catch {
      tasks = [];
    }
  };
  await loadTasks();

  let searchQuery = '';
  const FILTERS = ['draft', 'pending', 'synced', 'positive'];
  let statusFilter = FILTERS.includes(initialFilter) ? initialFilter : 'all';
  let sortKey = 'recent';
  let purokFilter = 'all';
  let viewingForm = null;
  let paperZoom = 1;
  let paperResizeHandler = null;
  let mobileFabOpen = false;

  const getCombined = () => {
    const drafts = Store.getDrafts().map(d => ({
      id: d.id,
      kind: 'draft',
      houseNo: d.form.houseNo,
      head: d.form.headOfFamily,
      purok: purokLabel(d.form.purokName, d.form.purokId),
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
      purok: purokLabel(q.purokName, q.payload.purokId),
      time: formatRelativeTime(q.queuedAt),
      ts: q.queuedAt || 0,
      containers: q.payload.containers || [],
      details: {
        ...q.payload,
        purokName: purokLabel(q.purokName, q.payload.purokId),
        storeys: q.payload.storeys === 1 ? 'Single storey' : q.payload.storeys === 2 ? '2 or more storeys' : (q.payload.storeys || ''),
        screening: q.payload.screened === true ? 'Screened' : q.payload.screened === false ? 'Unscreened' : (q.payload.screening || '')
      }
    }));
    const synced = Store.getSubmittedForms().map(s => ({
      id: s.id,
      kind: 'synced',
      houseNo: s.houseNo,
      head: s.headOfFamily,
      purok: purokLabel(s.purokName, s.purokId),
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

      ${d.fromServer && !d.householdShared ? `<p style="font-size:13px; color:#6B7280; margin:0 0 12px;">This form was recorded on another phone. Only the container counts are shown here; the household details stay on the phone that recorded it.</p>` : ''}

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
                  head: d.fromServer && !d.householdShared ? '' : item.head, // no name to print when the server did not share it
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
        <div class="bhw-forms-heading-row">
          <h1 class="bhw-page-title">My forms</h1>
          <a href="#/survey" class="bhw-pill-btn primary">${icon('plus', 14)} New survey</a>
        </div>
      </div>

      ${tasks.length === 0 ? '' : `
      <section class="bhw-panel bhw-tasks" aria-labelledby="tasks-title">
        <h2 id="tasks-title">Assignments from the LGU</h2>
        ${tasks.map(t => `
          <div class="bhw-task-row">
            <div>
              <strong>${esc(TASK_NAMES[t.type] || 'Field task')}</strong>
              <div class="bhw-task-meta">${esc(TASK_STATES[t.status] || t.status)} · ${t.households} household${t.households === 1 ? '' : 's'} submitted${t.puroks && t.puroks.length ? ` · ${esc(t.puroks.join(', '))}` : ''}</div>
            </div>
            <button type="button" class="bhw-pill-btn outline sm" data-finish="${t.id}" ${t.households === 0 ? 'disabled title="Submit a household survey first"' : ''}>Mark finished</button>
          </div>`).join('')}
      </section>`}

      <div class="bhw-filter-bar bhw-forms-filters">
        <div style="position:relative; display:flex; align-items:center;">
          <span style="position:absolute; left:14px; color:#6B7280; display:inline-flex; pointer-events:none;">${icon('search', 15)}</span>
          <input id="q-search" class="bhw-search-input" style="padding-left:38px;" type="search" placeholder="Search by house no., name or purok" value="${esc(searchQuery)}" autocomplete="off">
        </div>
        <div class="bhw-forms-filter-pills">
          <div class="bhw-field">
            <label for="q-status">Status</label>
            <select id="q-status" class="bhw-filter-select" aria-label="Status">
              <option value="all">All (${all.length})</option>
              <option value="draft">Draft (${counts.draft})</option>
              <option value="pending">Pending sync (${counts.pending})</option>
              <option value="synced">Submitted (${counts.synced})</option>
              <option value="positive">With positive findings (${counts.positive})</option>
            </select>
          </div>
          <div class="bhw-field">
            <label for="q-purok">Purok</label>
            <select id="q-purok" class="bhw-filter-select" aria-label="Purok">
              <option value="all">All puroks</option>
              ${puroks.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="bhw-field bhw-sort-field">
            <label for="q-sort">Sort by</label>
            <select id="q-sort" class="bhw-filter-select" aria-label="Sort by">
              ${Object.entries(SORTS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="bhw-mobile-sort-wrap">
          <button id="mobile-sort-toggle" type="button" class="bhw-mobile-sort-toggle" aria-expanded="false" aria-controls="mobile-sort-menu">
            <span>Sort: <strong id="mobile-sort-label">${esc(SORTS[sortKey].label)}</strong></span>${icon('chevronUp', 13, 1.8)}
          </button>
          <div id="mobile-sort-menu" class="bhw-mobile-sort-menu" role="menu" hidden>
            ${Object.entries(SORTS).map(([k, s]) => `<button type="button" role="menuitem" data-mobile-sort="${esc(k)}">${esc(s.label)}</button>`).join('')}
          </div>
        </div>
      </div>

      <div id="forms-count" class="bhw-forms-count" aria-live="polite" style="font-size:12px; color:#6B7280; margin-bottom:12px;"></div>

      <section class="bhw-panel bhw-flist" id="forms-rows"></section>

      <div class="bhw-mobile-fab-scrim" id="mobile-fab-scrim" hidden></div>
      <div class="bhw-mobile-fab">
        <div class="bhw-mobile-fab-actions" id="mobile-fab-actions" hidden>
          <a href="#/survey" class="bhw-mobile-fab-action">${icon('plus', 15)} New survey</a>
        </div>
        <button id="mobile-fab-toggle" type="button" aria-label="Open new survey actions" aria-expanded="false">
          <span class="bhw-mobile-fab-icon bhw-mobile-fab-icon-plus">${icon('plus', 21, 2)}</span>
          <span class="bhw-mobile-fab-icon bhw-mobile-fab-icon-close">${icon('x', 21, 2)}</span>
        </button>
      </div>
    `;

    root.querySelectorAll('[data-finish]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.finish);
        const task = tasks.find(t => t.id === id);
        const choice = await showModal({
          type: 'warning',
          title: 'Mark this task as finished?',
          message: `The LGU will see "${TASK_NAMES[task?.type] || 'the task'}" as completed. Only do this when every household for it has been surveyed.`,
          actions: [
            { label: 'Not yet', value: 'cancel' },
            { label: 'Mark finished', value: 'finish', primary: true }
          ]
        });
        if (choice !== 'finish') return;
        btn.disabled = true;
        try {
          await post(`/api/bhw/tasks/${id}/finish`);
          await loadTasks();
          render();
        } catch (err) {
          btn.disabled = false;
          await showModal({ type: 'error', title: 'Could not mark it finished', message: err?.message || 'Check your connection and try again.' });
        }
      });
    });

    // Only the list is redrawn while typing, so the search box keeps focus and the caret
    const searchEl = root.querySelector('#q-search');
    const statusEl = root.querySelector('#q-status');
    const purokEl = root.querySelector('#q-purok');
    const sortEl = root.querySelector('#q-sort');
    const mobileSortToggle = root.querySelector('#mobile-sort-toggle');
    const mobileSortLabel = root.querySelector('#mobile-sort-label');
    const mobileSortMenu = root.querySelector('#mobile-sort-menu');
    const mobileFabToggle = root.querySelector('#mobile-fab-toggle');
    const mobileFabActions = root.querySelector('#mobile-fab-actions');
    const mobileFabScrim = root.querySelector('#mobile-fab-scrim');
    statusEl.value = statusFilter;
    purokEl.value = purokFilter;
    sortEl.value = sortKey;
    mobileSortLabel.textContent = SORTS[sortKey].label;

    const countEl = root.querySelector('#forms-count');
    const listEl = root.querySelector('#forms-rows');

    const setMobileFabOpen = (open) => {
      mobileFabOpen = open;
      mobileFabActions.hidden = !open;
      mobileFabScrim.hidden = !open;
      mobileFabToggle.classList.toggle('is-open', open);
      mobileFabToggle.setAttribute('aria-expanded', String(open));
      mobileFabToggle.setAttribute('aria-label', open ? 'Close new survey actions' : 'Open new survey actions');
    };

    mobileSortToggle.addEventListener('click', () => {
      const open = mobileSortMenu.hidden;
      mobileSortMenu.hidden = !open;
      mobileSortToggle.setAttribute('aria-expanded', String(open));
    });
    mobileSortMenu.addEventListener('click', (event) => {
      const option = event.target.closest('[data-mobile-sort]');
      if (!option) return;
      sortKey = option.dataset.mobileSort;
      sortEl.value = sortKey;
      mobileSortLabel.textContent = SORTS[sortKey].label;
      mobileSortMenu.hidden = true;
      mobileSortToggle.setAttribute('aria-expanded', 'false');
      renderList();
    });
    mobileFabToggle.addEventListener('click', () => setMobileFabOpen(!mobileFabOpen));
    mobileFabScrim.addEventListener('click', () => setMobileFabOpen(false));

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
            <a href="#/survey" class="bhw-pill-btn primary sm">${icon('plus', 12)} New survey</a>
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
        const displayName = f.head || 'Unnamed';
        const mobileStatus = f.kind === 'draft'
          ? '<span class="bhw-status-badge draft">Draft</span>'
          : f.needsReview
            ? '<span class="bhw-status-badge needs-review">Needs attention</span>'
            : f.kind === 'pending'
              ? '<span class="bhw-status-badge pending">Pending sync</span>'
              : '<span class="bhw-status-badge synced">Submitted</span>';
        const mobileFinding = f.posCont > 0 ? 'Positive finding' : 'No positive findings';
        const mobileAction = f.kind === 'draft' || f.needsReview
          ? `<span class="bhw-fmobile-menu-wrap">
              <button type="button" class="bhw-fmobile-more" aria-label="More actions" aria-expanded="false">⋮</button>
              <span class="bhw-fmobile-menu" hidden><button type="button" class="delete-btn">Delete</button></span>
            </span>`
          : '<span class="bhw-fmobile-chevron" aria-hidden="true">›</span>';
        row.innerHTML = `
          <div class="bhw-fmobile-summary">
            <div class="bhw-fmobile-primary">
              <strong>#${esc(house)} · ${esc(displayName)}</strong>
              <span class="bhw-fmobile-status">${mobileStatus}${mobileAction}</span>
            </div>
            <div class="bhw-fmobile-secondary">
              ${esc(f.purok)}${f.kind === 'draft' || f.needsReview ? '' : ` <span class="bhw-fmobile-finding ${f.posCont > 0 ? 'is-positive' : ''}">· ${mobileFinding}</span>`}
            </div>
          </div>
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
        const openMobileTarget = () => {
          if (f.kind === 'draft' || f.needsReview) {
            window.location.hash = `#/survey/${encodeURIComponent(f.id)}`;
          } else {
            open();
          }
        };
        row.addEventListener('click', (e) => {
          if (!window.matchMedia('(max-width: 639px)').matches) return;
          if (e.target.closest('.bhw-fmobile-menu-wrap, .delete-btn, .bhw-factions')) return;
          openMobileTarget();
        });
        row.addEventListener('keydown', (e) => {
          if (!window.matchMedia('(max-width: 639px)').matches) return;
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          openMobileTarget();
        });
        if (window.matchMedia('(max-width: 639px)').matches) {
          row.tabIndex = 0;
          row.setAttribute('role', 'button');
          row.setAttribute('aria-label', `${f.kind === 'draft' ? 'Continue' : 'View'} House ${house} ${displayName}`);
        }
        row.querySelector('.bhw-fmobile-more')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const button = e.currentTarget;
          const menu = button.nextElementSibling;
          const isOpen = !menu.hidden;
          menu.hidden = isOpen;
          button.setAttribute('aria-expanded', String(!isOpen));
        });
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
          const confirmDelete = async () => {
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
          };
          row.querySelectorAll('.delete-btn').forEach(button => button.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDelete();
          }));
        }
        listEl.appendChild(row);
      });
    };

    searchEl.addEventListener('input', e => { searchQuery = e.target.value; renderList(); });
    statusEl.addEventListener('change', e => { statusFilter = e.target.value; renderList(); });
    purokEl.addEventListener('change', e => { purokFilter = e.target.value; renderList(); });
    sortEl.addEventListener('change', e => {
      sortKey = e.target.value;
      mobileSortLabel.textContent = SORTS[sortKey].label;
      renderList();
    });

    renderList();
  };

  render();
}
