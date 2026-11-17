import { get, post } from '../shared/api.js';
import { Store } from './store.js';
import { icon } from './icons.js';

let clockTimer = null;
let syncInProgress = false;

export function updateSyncBadge() {
  const count = Store.getQueue().length;
  const badge = document.getElementById('sync-badge');
  const mobBadge = document.getElementById('mob-sync-badge');
  if (badge) {
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (mobBadge) {
    mobBadge.textContent = count > 0 ? `(${count})` : '';
  }
}

async function doSync() {
  if (syncInProgress) return;
  const queue = Store.getQueue();
  if (queue.length === 0) return;

  syncInProgress = true;
  let sent = 0;

  Store.saveSyncedForm({
        id: `sync-${res?.surveyId || Date.now()}`,
        surveyId: res?.surveyId,
        surveyedAt: Date.now(),
        houseNo: item.payload.houseNo,
        purokId: item.payload.purokId,
        purokName: item.purokName || `Purok ${item.payload.purokId}`,
        headOfFamily: item.payload.headOfFamily,
        containers: item.payload.containers || [],
        form: {
          ...item.payload,
          storeys: item.payload.storeys === 1 ? 'Single storey' : item.payload.storeys === 2 ? '2 or more storeys' : '',
          screening: item.payload.screened === true ? 'Screened' : item.payload.screened === false ? 'Unscreened' : ''
        }
      });

  for (const item of queue) {
    try {
      const res = await post('/api/bhw/surveys', item.payload);
      Store.dequeue(item.id);
      Store.saveSyncedForm({
        id: `sync-${res?.surveyId || Date.now()}`,
        surveyId: res?.surveyId,
        surveyedAt: Date.now(),
        houseNo: item.payload.houseNo,
        purokId: item.payload.purokId,
        purokName: item.purokName || `Purok ${item.payload.purokId}`,
        headOfFamily: item.payload.headOfFamily,
        containers: item.payload.containers || []
      });
      sent++;
    } catch (err) {
      item.lastError = err.data?.error || 'Sync failed';
    }
  }

  syncInProgress = false;
  updateSyncBadge();
  const remaining = Store.getQueue().length;
  alert(`${sent} sent, ${remaining} still waiting.`);
  window.dispatchEvent(new Event('hashchange'));
}

document.getElementById('sync-btn')?.addEventListener('click', doSync);
document.getElementById('mob-sync-btn')?.addEventListener('click', doSync);

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

export async function renderDashboard(root) {
  updateSyncBadge();
  if (clockTimer) clearInterval(clockTimer);

  const me = window.bhwContext;
  let tasks = [];
  try {
    tasks = await get('/api/bhw/tasks');
  } catch (e) {
    tasks = [];
  }
  window.bhwTasks = tasks;

  const drafts = Store.getDrafts();
  const queue = Store.getQueue();
  const synced = await Store.fetchServerSurveys();

  const weeklyTarget = 20;
  const submittedCount = synced.length;
  const weeklyPct = Math.min(100, Math.round((submittedCount / weeklyTarget) * 100));
  const remainingHouseholds = Math.max(0, weeklyTarget - submittedCount);

  const allContainers = [
    ...drafts.flatMap(d => d.form?.containers || []),
    ...queue.flatMap(q => q.payload?.containers || []),
    ...synced.flatMap(s => s.containers || [])
  ];
  const positiveTotal = allContainers.reduce((sum, c) => sum + (Number(c.positive) || 0), 0);

  const formatNow = () => {
    const d = new Date();
    return d.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit'
    });
  };

  const openTask = tasks.find(t => t.status !== 'completed');
  const activeTierLabel = openTask
    ? (openTask.type === 'search_and_destroy' ? 'Tier 1' : openTask.type === 'spot_check' ? 'Spot check' : 'Tier 2 review')
    : 'Spot check';

  root.innerHTML = `
    <div class="bhw-topbar">
      <h1 class="bhw-page-title">Dashboard</h1>
      <div class="bhw-clock-pill">
        <span class="bhw-dot-green"></span>
        ${icon('clock', 14)}
        <span id="live-clock">${formatNow()}</span>
      </div>
    </div>

    <div class="bhw-progress-strip">
      <strong>Weekly progress</strong>
      <span>${submittedCount} of ${weeklyTarget} households surveyed</span>
      <div class="bhw-progress-track">
        <div class="bhw-progress-fill" style="width: ${weeklyPct}%;"></div>
      </div>
      <strong>${weeklyPct}%</strong>
    </div>

    <div class="bhw-kpi-grid">
      <div class="bhw-kpi-card is-primary">
        <div class="bhw-kpi-top">
          <span>Submitted forms</span>
          <a href="#/forms" class="bhw-kpi-arrow" aria-label="View submitted forms">${icon('arrowUpRight', 14)}</a>
        </div>
        <div class="bhw-kpi-value">${submittedCount}</div>
        <div class="bhw-kpi-foot"><span class="bhw-dot green-light"></span> ${weeklyPct}% of weekly target</div>
      </div>

      <div class="bhw-kpi-card">
        <div class="bhw-kpi-top">
          <span>Drafts</span>
          <a href="#/forms" class="bhw-kpi-arrow" aria-label="View drafts">${icon('arrowUpRight', 14)}</a>
        </div>
        <div class="bhw-kpi-value">${drafts.length}</div>
        <div class="bhw-kpi-foot"><span class="bhw-dot amber"></span> Awaiting completion</div>
      </div>

      <div class="bhw-kpi-card">
        <div class="bhw-kpi-top">
          <span>Positive containers</span>
          <a href="#/forms" class="bhw-kpi-arrow" aria-label="View positive containers">${icon('arrowUpRight', 14)}</a>
        </div>
        <div class="bhw-kpi-value">${positiveTotal}</div>
        <div class="bhw-kpi-foot"><span class="bhw-dot red"></span> With larvae or pupae</div>
      </div>

      <div class="bhw-kpi-card">
        <div class="bhw-kpi-top">
          <span>Waiting to sync</span>
          <a href="#/forms" class="bhw-kpi-arrow" aria-label="View waiting to sync">${icon('arrowUpRight', 14)}</a>
        </div>
        <div class="bhw-kpi-value">${queue.length}</div>
        <div class="bhw-kpi-foot"><span class="bhw-dot blue"></span> Pending upload</div>
      </div>
    </div>

    <div class="bhw-dashboard-split">
      <section class="bhw-panel">
        <div class="bhw-panel-header">
          <div>
            <h2 class="bhw-panel-title">Assigned puroks</h2>
            <p class="bhw-panel-sub">${remainingHouseholds} households remaining to meet this week's target</p>
          </div>
          <a href="#/survey" class="bhw-pill-btn primary">${icon('plus', 14)} New household survey</a>
        </div>
        <div id="puroks-list"></div>
      </section>

      <section class="bhw-panel">
        <div class="bhw-panel-header">
          <div>
            <h2 class="bhw-panel-title">Recent forms</h2>
            <p class="bhw-panel-sub">Latest household entries</p>
          </div>
          <a href="#/forms" class="bhw-pill-btn outline sm">View all</a>
        </div>
        <div id="recent-forms-list"></div>
      </section>
    </div>
  `;

  clockTimer = setInterval(() => {
    const el = document.getElementById('live-clock');
    if (el) el.textContent = formatNow();
  }, 1000);

  const puroksList = root.querySelector('#puroks-list');
  const puroks = me?.puroks || [];
  const targetPerPurok = Math.max(4, Math.ceil(weeklyTarget / Math.max(1, puroks.length)));

  puroks.forEach((p, idx) => {
    const surveyedInPurok = synced.filter(s => String(s.purokId) === String(p.id)).length;
    const pct = Math.min(100, Math.round((surveyedInPurok / targetPerPurok) * 100));
    const statusLabel = surveyedInPurok >= targetPerPurok
      ? 'Completed'
      : surveyedInPurok > 0 || openTask
        ? 'In progress'
        : 'Not started';

    const row = document.createElement('div');
    row.className = 'bhw-purok-row';
    if (idx === 0) row.style.borderTop = 'none';
    row.innerHTML = `
      <div class="bhw-purok-left">
        <div class="bhw-num-circle">${idx + 1}</div>
        <div>
          <strong style="font-size:14px; display:block;">${p.name}</strong>
          <span style="font-size:12px; color:#6B7280;">${activeTierLabel} · ${surveyedInPurok} of ${targetPerPurok} surveyed</span>
        </div>
      </div>
      <div class="bhw-purok-bar-wrap">
        <div class="bhw-progress-track"><div class="bhw-progress-fill" style="width:${pct}%"></div></div>
        <strong style="font-size:12px;">${pct}%</strong>
      </div>
      <span class="bhw-status-badge in-progress">${statusLabel}</span>
    `;
    puroksList.appendChild(row);
  });

  const recentList = root.querySelector('#recent-forms-list');
  const combined = [
    ...drafts.map(d => ({
      houseNo: d.form.houseNo,
      head: d.form.headOfFamily,
      purok: d.form.purokName || `Purok ${d.form.purokId}`,
      time: formatRelativeTime(d.savedAt),
      badge: 'Draft',
      cls: 'draft',
      ts: d.savedAt || 0
    })),
    ...queue.map(q => ({
      houseNo: q.payload.houseNo,
      head: q.payload.headOfFamily,
      purok: q.purokName || `Purok ${q.payload.purokId}`,
      time: formatRelativeTime(q.queuedAt),
      badge: 'Pending sync',
      cls: 'pending',
      ts: q.queuedAt || 0
    })),
    ...synced.map(s => ({
      houseNo: s.houseNo,
      head: s.headOfFamily,
      purok: s.purokName || `Purok ${s.purokId}`,
      time: formatRelativeTime(s.surveyedAt),
      badge: 'Synced',
      cls: 'synced',
      ts: s.surveyedAt || 0
    }))
  ].sort((a, b) => b.ts - a.ts).slice(0, 4);

  if (combined.length === 0) {
    recentList.innerHTML = `<p style="font-size:13px; color:#6B7280; padding:12px 0;">No household forms recorded on this device yet.</p>`;
  } else {
    combined.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'bhw-purok-row';
      if (idx === 0) row.style.borderTop = 'none';
      row.innerHTML = `
        <div>
          <strong style="font-size:13px; display:block;">House ${item.houseNo || '—'} · ${item.head || 'Unnamed'}</strong>
          <span style="font-size:12px; color:#6B7280;">${item.purok} · ${item.time}</span>
        </div>
        <span class="bhw-status-badge ${item.cls}">${item.badge}</span>
      `;
      recentList.appendChild(row);
    });
  }
}