// What the page remembers on this phone (language, barangay, whether the intro was seen, ...).
// Every read and write is guarded: a private window or blocked storage must never break the page.

const PREFIX = "aed.res.";

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* nothing to do */
    }
  },
};

/** Today as YYYY-MM-DD in the phone's own time zone (the daily check-in resets at local midnight). */
export function todayText(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}
