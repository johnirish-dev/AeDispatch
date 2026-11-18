import { get } from '../shared/api.js';
import { showModal } from './alerts.js';

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

  async fetchServerSurveys() {
    this.cleanLegacySeed();
    try {
      const rows = await get('/api/bhw/surveys');
      if (Array.isArray(rows)) {
        const mapped = rows.map(r => ({
          id: `db-${r.id}`,
          surveyId: r.id,
          surveyedAt: r.createdAt ? new Date(r.createdAt).getTime() : new Date(r.surveyDate).getTime(),
          houseNo: r.houseNo,
          purokId: r.purokId,
          purokName: r.purokName || `Purok ${r.purokId}`,
          headOfFamily: r.headOfFamily || 'Recorded Household',
          containers: r.containers || [],
          form: r
        }));
        this.setKey('aed.bhw.synced', mapped);
        return mapped;
      }
    } catch (e) {
      // Route not merged yet or offline; fall back to local synced list
    }
    return this.getSyncedForms();
  }
};
