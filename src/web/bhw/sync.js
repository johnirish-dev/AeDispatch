import { post } from '../shared/api.js';
import { notify } from './toast.js';
import { hideBanner, showBanner } from './alerts.js';
import { Store } from './store.js';

let syncInProgress = false;
let listenersBound = false;

// A phone often reports "online" before the connection works, so the first try can fail. After a failure
// that may pass (no connection, a server error, too many requests) it tries again soon, then less often,
// instead of waiting for the next one-minute check.
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
let retryTimer = null;
let consecutiveFailures = 0;

function scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = RETRY_DELAYS_MS[Math.min(consecutiveFailures, RETRY_DELAYS_MS.length - 1)];
  consecutiveFailures++;
  retryTimer = setTimeout(() => syncPendingForms(), delay);
}

function resetRetry() {
  clearTimeout(retryTimer);
  retryTimer = null;
  consecutiveFailures = 0;
}

function makeClientSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `bhw-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(err) {
  return err?.body?.error || err?.message || 'Sync failed.';
}

function saveSyncedItem(item, surveyId) {
  const payload = item.payload;
  Store.saveSyncedForm({
    id: `sync-${surveyId || Date.now()}`,
    surveyId,
    surveyedAt: Date.now(),
    houseNo: payload.houseNo,
    purokId: payload.purokId,
    purokName: item.purokName || `Purok ${payload.purokId}`,
    headOfFamily: payload.headOfFamily,
    containers: payload.containers || [],
    form: {
      ...payload,
      storeys: payload.storeys === 1 ? 'Single storey' : payload.storeys === 2 ? '2 or more storeys' : '',
      screening: payload.screened === true ? 'Screened' : payload.screened === false ? 'Unscreened' : ''
    }
  });
}

/** Sends queued submissions. Network errors stay queued for the next retry. */
export async function syncPendingForms({ announce = false } = {}) {
  if (syncInProgress || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { sent: 0, remaining: Store.getQueue().length, skipped: true };
  }

  const queue = Store.getQueue().filter(item => !item.needsReview);
  if (queue.length === 0) {
    resetRetry();
    return { sent: 0, remaining: Store.getQueue().length, skipped: false };
  }

  syncInProgress = true;
  let sent = 0;
  let needsRetry = false;
  try {
    hideBanner('sync');
    for (const item of queue) {
      const clientSubmissionId = item.payload.clientSubmissionId || item.clientSubmissionId || makeClientSubmissionId();
      const payload = { ...item.payload, clientSubmissionId };
      Store.updateQueueItem(item.id, { payload, clientSubmissionId });
      try {
        const res = await post('/api/bhw/surveys', payload);
        Store.dequeue(item.id);
        saveSyncedItem({ ...item, payload }, res?.surveyId);
        sent++;
      } catch (err) {
        const permanent = err?.status >= 400 && err?.status < 500 && ![408, 409, 429].includes(err.status);
        Store.updateQueueItem(item.id, {
          attempts: (item.attempts || 0) + 1,
          lastAttemptAt: Date.now(),
          lastError: errorMessage(err),
          needsReview: permanent
        });
        if (!permanent) needsRetry = true;
        // If the connection failed, stop here: the retry below tries again soon.
        if (!err?.status) break;
      }
    }
  } finally {
    syncInProgress = false;
  }

  if (needsRetry) scheduleRetry();
  else resetRetry();

  const remaining = Store.getQueue().length;
  if (announce && remaining === 0 && sent > 0) {
    notify.success('Sync complete', `${sent} ${sent === 1 ? 'form' : 'forms'} sent.`);
  } else if (announce && remaining > 0) {
    const needsReview = Store.getQueue().filter(item => item.needsReview).length;
    showBanner({
      id: 'sync',
      type: 'warning',
      title: needsReview > 0 ? 'Some forms need attention' : 'Forms still waiting to sync',
      message: needsReview > 0
        ? `The server rejected a form: ${Store.getQueue().find(item => item.needsReview)?.lastError || 'open it and correct the highlighted fields.'}`
        : `${sent} sent, ${remaining} still waiting on this phone. They will retry automatically.`
    });
  }
  if (sent > 0) window.dispatchEvent(new Event('hashchange'));
  return { sent, remaining, skipped: false };
}

export function initAutoSync() {
  if (listenersBound) return;
  listenersBound = true;
  window.addEventListener('online', () => syncPendingForms({ announce: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncPendingForms();
  });
  window.setInterval(() => syncPendingForms(), 60_000);
  syncPendingForms();
}
