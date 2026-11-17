import { Store } from './store.js';
import { icon } from './icons.js';

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

export async function renderMyForms(root) {
  const me = window.bhwContext;
  const puroks = me?.puroks || [];
  await Store.fetchServerSurveys();

  let searchQuery = '';
  let statusFilter = 'all';
  let purokFilter = 'all';
  let viewingForm = null;

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
    const synced = Store.getSyncedForms().map(s => ({
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
    return [...drafts, ...queue, ...synced].sort((a, b) => b.ts - a.ts);
  };

  const renderDetailView = (item) => {
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
    const badgeLabel = item.kind === 'draft' ? 'Draft' : item.kind === 'pending' ? 'Pending sync' : 'Synced';

    root.innerHTML = `
      <div class="bhw-topbar">
        <div>
          <div class="bhw-eyebrow">DENGUE FORM 5 · HOUSEHOLD RECORD</div>
          <h1 class="bhw-page-title">House ${item.houseNo || '—'} · ${item.head || 'Unnamed'}</h1>
          <p class="bhw-page-subtitle">${item.purok} · ${item.time}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="bhw-status-badge ${item.kind}">${badgeLabel}</span>
          ${item.kind === 'draft' ? `<a href="#/survey/${item.id}" class="bhw-pill-btn primary sm">${icon('play', 12)} Continue draft</a>` : ''}
          <button id="btn-back-forms" type="button" class="bhw-pill-btn outline sm">Back to My forms</button>
        </div>
      </div>

      <section class="bhw-panel">
        <div class="bhw-result-banner">
          <div>
            <div style="font-size:11px; font-weight:800; color:#134E3A; text-transform:uppercase; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              <span class="bhw-dot green"></span> INSPECTION RESULT
            </div>
            <strong style="font-size:16px; display:block;">${totals.positive === 0 ? 'No larvae or pupae detected' : 'Larvae or pupae detected'}</strong>
            <span style="font-size:12px; color:#6B7280;">House ${item.houseNo || '—'}, ${item.purok}</span>
          </div>
          <div style="text-align:right;">
            <strong style="font-size:24px; color:#134E3A;">${totals.positive}</strong><span style="font-size:14px; color:#6B7280;">/${totals.total}</span>
            <div style="font-size:11px; color:#6B7280;">containers positive</div>
          </div>
        </div>

        <div class="bhw-review-box">
          <div class="bhw-review-hdr"><span>HOUSEHOLD INFORMATION</span></div>
          <div class="bhw-review-grid-3">
            <div class="bhw-review-cell"><span>House no.</span><strong>${item.houseNo || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Municipality/City</span><strong>Daraga</strong></div>
            <div class="bhw-review-cell"><span>Purok/Sitio</span><strong>${item.purok}</strong></div>
            <div class="bhw-review-cell"><span>Barangay</span><strong>${me?.barangay?.name || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Head of the family</span><strong>${item.head || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Age</span><strong>${d.age || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Sex</span><strong>${d.sex || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Civil status</span><strong>${d.civilStatus || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Occupation</span><strong>${d.occupation || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Persons who slept here</span><strong>${d.personsSlept || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Name of school</span><strong>${d.schoolName || '—'}</strong></div>
            <div class="bhw-review-cell shaded"></div>
          </div>
        </div>

        <div class="bhw-review-box">
          <div class="bhw-review-hdr"><span>BUILDING STRUCTURE</span></div>
          <div class="bhw-review-grid-3">
            <div class="bhw-review-cell"><span>Structure</span><strong>${d.buildingStructure || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Storeys</span><strong>${d.storeys || '—'}</strong></div>
            <div class="bhw-review-cell"><span>No. of rooms</span><strong>${d.rooms || '—'}</strong></div>
            <div class="bhw-review-cell"><span>Screening</span><strong>${d.screening || '—'}</strong></div>
            <div class="bhw-review-cell shaded"></div>
            <div class="bhw-review-cell shaded"></div>
          </div>
        </div>

        <div class="bhw-review-box" style="margin-bottom:0;">
          <div class="bhw-review-hdr"><span>WATER CONTAINERS PRESENT</span></div>
          <div class="bhw-stat-strip-6">
            <div><span style="font-size:11px;color:#6B7280;display:block;">Inspected</span><strong style="font-size:18px;">${totals.total}</strong></div>
            <div><span style="font-size:11px;color:#6B7280;display:block;">With cover</span><strong style="font-size:18px;">${totals.withCover}</strong></div>
            <div><span style="font-size:11px;color:#6B7280;display:block;">Without cover</span><strong style="font-size:18px;">${totals.withoutCover}</strong></div>
            <div><span style="font-size:11px;color:#6B7280;display:block;">Positive (+)</span><strong style="font-size:18px;">${totals.positive}</strong></div>
            <div><span style="font-size:11px;color:#6B7280;display:block;">Larvae</span><strong style="font-size:18px;">${totals.larvae}</strong></div>
            <div><span style="font-size:11px;color:#6B7280;display:block;">Pupae</span><strong style="font-size:18px;">${totals.pupae}</strong></div>
          </div>
          <div style="padding: 0 16px 8px; font-size:12px; color:#6B7280;">Container index (positive ÷ inspected): <strong style="color:#111827">${cIndex}%</strong></div>

          ${validConts.length > 0 ? `
            <table class="bhw-table">
              <thead>
                <tr>
                  <th>Type of container</th>
                  <th>With cover</th>
                  <th>Without cover</th>
                  <th>Total</th>
                  <th>(+) Containers</th>
                  <th>Larvae</th>
                  <th>Pupae</th>
                </tr>
              </thead>
              <tbody>
                ${validConts.map(c => `
                  <tr>
                    <td><strong>${c.containerType}</strong></td>
                    <td>${c.withCover}</td>
                    <td>${c.withoutCover}</td>
                    <td>${c.total}</td>
                    <td>${c.positive}</td>
                    <td>${c.larvaeCount}</td>
                    <td>${c.pupaeCount}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `<p style="padding: 8px 16px; font-size:12px; color:#6B7280;">No containers recorded at this household.</p>`}

          <div class="bhw-total-bar">
            <span>Total, all containers</span>
            <span>${totals.withCover}</span>
            <span>${totals.withoutCover}</span>
            <span>${totals.total}</span>
            <span>${totals.positive}</span>
            <span>${totals.larvae}</span>
            <span>${totals.pupae}</span>
          </div>
        </div>
      </section>
    `;

    root.querySelector('#btn-back-forms').addEventListener('click', () => {
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
    const filtered = all.filter(item => {
      if (statusFilter !== 'all' && item.kind !== statusFilter) return false;
      if (purokFilter !== 'all' && item.purok !== purokFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return `${item.houseNo} ${item.head} ${item.purok}`.toLowerCase().includes(q);
      }
      return true;
    });

    root.innerHTML = `
      <div class="bhw-topbar">
        <div>
          <h1 class="bhw-page-title">My forms</h1>
          <p class="bhw-page-subtitle">${all.length} household forms recorded on this device</p>
        </div>
        <a href="#/survey" class="bhw-pill-btn primary">${icon('plus', 14)} New household survey</a>
      </div>

      <div class="bhw-filter-bar">
        <div style="position:relative; display:flex; align-items:center;">
          <span style="position:absolute; left:14px; color:#6B7280; display:inline-flex; pointer-events:none;">${icon('search', 15)}</span>
          <input id="q-search" class="bhw-search-input" style="padding-left:38px;" type="search" placeholder="Search by house no., name or purok" value="${searchQuery}">
        </div>
        <div class="bhw-field">
          <label>Status</label>
          <select id="q-status" class="bhw-filter-select">
            <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>All (${all.length})</option>
            <option value="draft" ${statusFilter === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="pending" ${statusFilter === 'pending' ? 'selected' : ''}>Pending sync</option>
            <option value="synced" ${statusFilter === 'synced' ? 'selected' : ''}>Synced</option>
          </select>
        </div>
        <div class="bhw-field">
          <label>Purok</label>
          <select id="q-purok" class="bhw-filter-select">
            <option value="all">All puroks</option>
            ${puroks.map(p => `<option value="${p.name}" ${purokFilter === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
        <div class="bhw-field">
          <label>Sort by</label>
          <select class="bhw-filter-select">
            <option>Most recent</option>
          </select>
        </div>
      </div>

      <div style="font-size:12px; color:#6B7280; margin-bottom:12px;">Showing ${filtered.length} of ${all.length} forms</div>

      <section class="bhw-panel" style="padding: 4px 20px;" id="forms-rows"></section>
    `;

    root.querySelector('#q-search').addEventListener('input', e => { searchQuery = e.target.value; render(); });
    root.querySelector('#q-status').addEventListener('change', e => { statusFilter = e.target.value; render(); });
    root.querySelector('#q-purok').addEventListener('change', e => { purokFilter = e.target.value; render(); });

    const listEl = root.querySelector('#forms-rows');
    if (filtered.length === 0) {
      listEl.innerHTML = `<p style="font-size:13px; color:#6B7280; padding:18px 0; text-align:center;">No forms recorded yet. Click "+ New household survey" to submit a survey to the database.</p>`;
      return;
    }

    filtered.forEach((f, idx) => {
      const totalCont = f.containers.reduce((s, c) => s + (Number(c.total) || 0), 0);
      const posCont = f.containers.reduce((s, c) => s + (Number(c.positive) || 0), 0);

      const row = document.createElement('div');
      row.className = 'bhw-purok-row';
      if (idx === 0) row.style.borderTop = 'none';

      const metaRight = f.kind === 'draft'
        ? `<div style="display:flex; align-items:center; gap:8px; width:110px;">
             <div class="bhw-progress-track"><div class="bhw-progress-fill" style="width:${f.progress}%; background:#E08E26;"></div></div>
             <span style="font-size:12px; color:#6B7280;">${f.progress}%</span>
           </div>
           <span class="bhw-status-badge draft">Draft</span>
           <a href="#/survey/${f.id}" class="bhw-pill-btn outline sm">${icon('play', 12)} Continue</a>
           <button type="button" class="bhw-pill-btn outline sm view-btn">View</button>`
        : `<span style="font-size:12px; color:#6B7280;">${totalCont} containers · <strong style="color:${posCont > 0 ? '#C81E1E' : '#6B7280'}">${posCont} positive</strong></span>
           <span class="bhw-status-badge ${f.kind}">${f.kind === 'pending' ? 'Pending sync' : 'Synced'}</span>
           <button type="button" class="bhw-pill-btn outline sm view-btn">View</button>`;

      row.innerHTML = `
        <div>
          <strong style="font-size:14px; display:block;">House ${f.houseNo || '—'} · ${f.head || 'Unnamed'}</strong>
          <span style="font-size:12px; color:#6B7280;">${f.purok} · ${f.time}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          ${metaRight}
        </div>
      `;

      row.querySelector('.view-btn').addEventListener('click', () => {
        viewingForm = f;
        render();
      });

      listEl.appendChild(row);
    });
  };

  render();
}