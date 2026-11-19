import { showModal } from './alerts.js';

import { get } from '../shared/api.js';

// The barangay's recent surveys as the server lists them (no household details). Kept apart from the full forms saved
// on this phone so one never overwrites the other.
const SERVER_KEY = 'aed.bhw.server';

function serverRowToForm(r) {
  const interviewer = r.interviewer || '';
  const purokName = r.purokName || `Purok ${r.purokId}`;
  const containers = Array.isArray(r.containers) ? r.containers : [];
  return {
    id: `db-${r.id}`,
    surveyId: r.id,
    surveyedAt: new Date(r.submittedAt).getTime() || new Date(r.surveyDate).getTime() || 0,
    houseNo: r.houseNo,
    purokId: r.purokId,
    purokName,
    headOfFamily: interviewer ? `Surveyed by ${interviewer}` : 'Recorded household',
    fromServer: true,
    containers,
    form: { houseNo: r.houseNo, purokId: r.purokId, purokName, surveyDate: r.surveyDate, surveyedBy: interviewer, noContainersFound: r.noContainersFound, containers, fromServer: true }
  };
}

export const Store = {
  getKey(key, defaultVal) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  },
  setKey(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      return false;
    }
  },
  cleanLegacySeed() {
    try {
      if (localStorage.getItem('aed.bhw.seeded')) {
        localStorage.removeItem('aed.bhw.seeded');
        localStorage.removeItem('aed.bhw.drafts');
        localStorage.removeItem('aed.bhw.queue');
        localStorage.removeItem('aed.bhw.synced');
      }
    } catch (e) {
      // Ignore storage errors in private windows
    }
  },
  getToken() { return this.getKey('aed.bhw.token', null); },
  setToken(token) { return this.setKey('aed.bhw.token', token); },
  getContext() { return this.getKey('aed.bhw.context', null); },
  setContext(context) { return this.setKey('aed.bhw.context', context); },

  getDrafts() {
    this.cleanLegacySeed();
    return this.getKey('aed.bhw.drafts', []);
  },
  saveDraft(draft) {
    const drafts = this.getDrafts().filter(d => d.id !== draft.id);
    drafts.unshift(draft);
    if (!this.setKey('aed.bhw.drafts', drafts)) {
      showModal({
        type: 'error',
        title: 'Draft not saved',
        message: 'This phone could not save the draft, so the form stays open. Free up some storage space on the phone, then try again.'
      });
      return false;
    }
    return true;
  },
  deleteDraft(id) {
    this.setKey('aed.bhw.drafts', this.getDrafts().filter(d => d.id !== id));
  },

  getQueue() {
    this.cleanLegacySeed();
    return this.getKey('aed.bhw.queue', []);
  },
  enqueue(item) {
    const q = this.getQueue().filter(i => i.id !== item.id);
    q.unshift(item);
    this.setKey('aed.bhw.queue', q);
  },
  updateQueueItem(id, patch) {
    const queue = this.getQueue();
    const item = queue.find(i => i.id === id);
    if (!item) return false;
    Object.assign(item, patch);
    return this.setKey('aed.bhw.queue', queue);
  },
  dequeue(id) {
    this.setKey('aed.bhw.queue', this.getQueue().filter(i => i.id !== id));
  },

  getSyncedForms() {
    this.cleanLegacySeed();
    return this.getKey('aed.bhw.synced', []);
  },
  saveSyncedForm(form) {
    const synced = this.getSyncedForms().filter(s => String(s.id) !== String(form.id));
    synced.unshift(form);
    this.setKey('aed.bhw.synced', synced.slice(0, 50));
  },
  deleteSyncedForm(id) {
    this.setKey('aed.bhw.synced', this.getSyncedForms().filter(s => String(s.id) !== String(id)));
  },

  /**
   * The submitted forms: the full copies saved on this phone, plus the barangay's other recent surveys from the
   * server (counts only), so several phones that share a barangay link see the same list. A survey that is on both
   * keeps the full copy from this phone.
   */
  getSubmittedForms() {
    const local = this.getSyncedForms();
    const have = new Set(local.filter(f => f.surveyId !== undefined && f.surveyId !== null).map(f => String(f.surveyId)));
    const others = this.getKey(SERVER_KEY, []).filter(r => !have.has(String(r.id))).map(serverRowToForm);
    return [...local, ...others].sort((a, b) => (b.surveyedAt || 0) - (a.surveyedAt || 0));
  },

  /** Asks the server for the barangay's list. Offline or on an error it keeps the list it got last time. */
  async fetchServerSurveys() {
    this.cleanLegacySeed();
    try {
      const rows = await get('/api/bhw/surveys');
      if (Array.isArray(rows)) this.setKey(SERVER_KEY, rows);
    } catch (e) {
      // No connection (or a link that is no longer valid): show what is already known.
    }
    return this.getSubmittedForms();
  }
};
