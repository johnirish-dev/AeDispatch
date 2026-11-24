import { showModal } from './alerts.js';

import { get } from '../shared/api.js';

// Everything this phone saves (drafts, forms waiting to send, submitted copies, the barangay's survey list from the
// server, the cached barangay details) is kept PER BARANGAY, under 'aed.bhw.b<barangay number>.<name>'. The same
// browser can open the links of several barangays (a laptop used for testing, a shared phone) and each one must see
// only its own forms. The server's survey list is kept apart from the full forms saved on this phone so one never
// overwrites the other.
const PREFIX = 'aed.bhw.';
// Before this change these were single, shared keys. They are moved into the right barangay once (see adoptOldData).
const OLD_KEYS = { drafts: 'aed.bhw.drafts', queue: 'aed.bhw.queue', synced: 'aed.bhw.synced', server: 'aed.bhw.server', context: 'aed.bhw.context' };
const TOKEN_MAP_KEY = 'aed.bhw.tokens'; // which barangay each link (token) belongs to, so an offline start knows it

// A short tag for a link, so the map does not hold the link itself.
function tagOf(token) {
  let h = 5381;
  for (const ch of String(token)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function serverRowToForm(r) {
  const interviewer = r.interviewer || '';
  const purokName = r.purokName || `Purok ${r.purokId}`;
  const containers = Array.isArray(r.containers) ? r.containers : [];
  // `household` is there only when the server is set to share households' details (SHARE_HOUSEHOLD_DETAILS).
  const hh = r.household || null;
  const details = hh
    ? {
        headOfFamily: hh.headOfFamily || '',
        age: hh.age ?? '',
        sex: hh.sex || '',
        civilStatus: hh.civilStatus || '',
        occupation: hh.occupation || '',
        personsSlept: hh.personsSlept ?? '',
        buildingStructure: hh.buildingStructure || '',
        storeys: hh.storeys === 1 ? 'Single storey' : hh.storeys === 2 ? '2 or more storeys' : '',
        screening: hh.screened === true ? 'Screened' : hh.screened === false ? 'Unscreened' : '',
        rooms: hh.rooms ?? ''
      }
    : {};
  return {
    id: `db-${r.id}`,
    surveyId: r.id,
    surveyedAt: new Date(r.submittedAt).getTime() || new Date(r.surveyDate).getTime() || 0,
    houseNo: r.houseNo,
    purokId: r.purokId,
    purokName,
    // Without shared details the server list has no head of the family, so say where the name is kept.
    // Who did the survey is shown in its own place: the "Surveyed by" line of the form (form.surveyedBy below).
    headOfFamily: hh ? details.headOfFamily : 'Recorded on another phone',
    fromServer: true,
    containers,
    form: { houseNo: r.houseNo, purokId: r.purokId, purokName, surveyDate: r.surveyDate, ...details, surveyedBy: interviewer, noContainersFound: r.noContainersFound, containers, fromServer: true, householdShared: Boolean(hh) }
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

  // ---- which barangay this phone is working in --------------------------------------------------------
  // `scope` is the barangay number of the link that is open. Until it is known nothing is read or written (the app
  // only draws and syncs after it is known), so forms can never be saved under, or sent for, the wrong barangay.
  scope: null,

  /** Remembers that this link (token) opens this barangay, for starting offline later. */
  rememberToken(token, barangayId) {
    const map = this.getKey(TOKEN_MAP_KEY, {});
    map[tagOf(token)] = barangayId;
    this.setKey(TOKEN_MAP_KEY, map);
  },
  barangayOfToken(token) {
    const id = this.getKey(TOKEN_MAP_KEY, {})[tagOf(token)];
    return typeof id === 'number' ? id : null;
  },

  /** Switches to a barangay's own storage, first moving over anything saved before storage was split up. */
  useBarangay(id) {
    this.scope = id;
    this.adoptOldData(id);
  },

  /**
   * Forms saved before the split sit under shared keys. They belong to the barangay the phone last used, which the old
   * cached details name. If that is this barangay they are moved here; if not (or if it is unknown) they stay where
   * they are, for the barangay they belong to, and are never guessed at.
   */
  adoptOldData(id) {
    try {
      const old = JSON.parse(localStorage.getItem(OLD_KEYS.context) || 'null');
      if (!old || old.barangay?.id !== id) return;
      for (const [name, key] of Object.entries(OLD_KEYS)) {
        const value = localStorage.getItem(key);
        if (value === null) continue;
        const current = localStorage.getItem(this.scoped(name));
        if (current === null) {
          localStorage.setItem(this.scoped(name), value);
        } else if (['drafts', 'queue', 'synced'].includes(name)) {
          // this barangay already has forms of its own: add the old ones that are not there yet, never replace
          const own = JSON.parse(current);
          const added = JSON.parse(value).filter(item => !own.some(o => String(o.id) === String(item.id)));
          localStorage.setItem(this.scoped(name), JSON.stringify([...own, ...added]));
        }
        localStorage.removeItem(key);
      }
    } catch (e) {
      // Storage blocked or unreadable: nothing to move.
    }
  },

  scoped(name) { return `${PREFIX}b${this.scope}.${name}`; },
  getScoped(name, defaultVal) { return this.scope === null ? defaultVal : this.getKey(this.scoped(name), defaultVal); },
  setScoped(name, val) { return this.scope === null ? false : this.setKey(this.scoped(name), val); },

  getContext() { return this.getScoped('context', null); },
  setContext(context) { return this.setScoped('context', context); },

  getDrafts() {
    this.cleanLegacySeed();
    return this.getScoped('drafts', []);
  },
  saveDraft(draft) {
    const drafts = this.getDrafts().filter(d => d.id !== draft.id);
    drafts.unshift(draft);
    if (!this.setScoped('drafts', drafts)) {
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
    this.setScoped('drafts', this.getDrafts().filter(d => d.id !== id));
  },

  getQueue() {
    this.cleanLegacySeed();
    return this.getScoped('queue', []);
  },
  enqueue(item) {
    const q = this.getQueue().filter(i => i.id !== item.id);
    q.unshift(item);
    this.setScoped('queue', q);
  },
  updateQueueItem(id, patch) {
    const queue = this.getQueue();
    const item = queue.find(i => i.id === id);
    if (!item) return false;
    Object.assign(item, patch);
    return this.setScoped('queue', queue);
  },
  dequeue(id) {
    this.setScoped('queue', this.getQueue().filter(i => i.id !== id));
  },

  getSyncedForms() {
    this.cleanLegacySeed();
    return this.getScoped('synced', []);
  },
  saveSyncedForm(form) {
    const synced = this.getSyncedForms().filter(s => String(s.id) !== String(form.id));
    synced.unshift(form);
    this.setScoped('synced', synced.slice(0, 50));
  },
  deleteSyncedForm(id) {
    this.setScoped('synced', this.getSyncedForms().filter(s => String(s.id) !== String(id)));
  },

  /**
   * The submitted forms: the full copies saved on this phone, plus the barangay's other recent surveys from the
   * server (counts only), so several phones that share a barangay link see the same list. A survey that is on both
   * keeps the full copy from this phone.
   */
  getSubmittedForms() {
    const local = this.getSyncedForms();
    const have = new Set(local.filter(f => f.surveyId !== undefined && f.surveyId !== null).map(f => String(f.surveyId)));
    const others = this.getScoped('server', []).filter(r => !have.has(String(r.id))).map(serverRowToForm);
    return [...local, ...others].sort((a, b) => (b.surveyedAt || 0) - (a.surveyedAt || 0));
  },

  /** Asks the server for the barangay's list. Offline or on an error it keeps the list it got last time. */
  async fetchServerSurveys() {
    this.cleanLegacySeed();
    const barangay = this.scope;
    try {
      const rows = await get('/api/bhw/surveys');
      // only keep it if this phone is still working in the barangay the question was asked for
      if (Array.isArray(rows) && barangay === this.scope) this.setScoped('server', rows);
    } catch (e) {
      // No connection (or a link that is no longer valid): show what is already known.
    }
    return this.getSubmittedForms();
  }
};
