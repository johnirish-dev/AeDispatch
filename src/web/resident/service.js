// Everything the resident page asks of a server goes through this file.
// Today each call is a SIMULATION with sample data (nothing is sent anywhere). When the resident
// routes exist on the server, only this file changes: the screens keep calling the same functions.
//
// Points for the backend that the simulation stands in for:
//   - The daily answer needs NO sign-in. It is an anonymous count per barangay (like the symptom
//     counts), with the "one answer a day" limit kept on the phone. Anonymous answers are easier
//     to spam than signed-in ones; the server should cap how many one barangay can add per day.
//   - Only the household report needs sign-in (mobile number, then a 6-digit PIN that is valid
//     for 5 minutes and allows 3 tries). The server stores only a salted hash of the number.

/** Sample barangays (the 8 in the demo data) with a made-up level and outlook, until the server provides them. */
export const BARANGAYS = [
  { id: "penafrancia", name: "Peñafrancia", level: "high", peakDay: 3, bars: [30, 38, 50, 58, 46, 32, 26] },
  { id: "bascaran", name: "Bascaran", level: "elevated", peakDay: 1, bars: [46, 58, 52, 44, 38, 32, 28] },
  { id: "sagpon", name: "Sagpon", level: "elevated", peakDay: 2, bars: [36, 44, 54, 42, 34, 26, 24] },
  { id: "tagas", name: "Tagas", level: "elevated", peakDay: 4, bars: [32, 36, 44, 50, 56, 40, 30] },
  { id: "kilicao", name: "Kilicao", level: "moderate", peakDay: 2, bars: [26, 32, 40, 34, 28, 24, 22] },
  { id: "banag", name: "Bañag", level: "moderate", peakDay: 3, bars: [24, 30, 36, 42, 34, 26, 22] },
  { id: "mabini", name: "Mabini", level: "low", peakDay: 2, bars: [20, 24, 30, 26, 22, 20, 18] },
  { id: "busay", name: "Busay", level: "low", peakDay: 1, bars: [22, 28, 26, 22, 20, 18, 18] },
];

export const MUNICIPALITY = "Daraga";

const wait = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

let pending = null; // the PIN waiting to be checked: { phone, pin, expiresAt, tries }

export const service = {
  async listBarangays() {
    await wait();
    return BARANGAYS.map(({ id, name }) => ({ id, name, municipality: MUNICIPALITY }));
  },

  /** The risk level and outlook for one barangay (never case counts or locations). */
  async getRisk(barangayId) {
    await wait();
    const b = BARANGAYS.find((x) => x.id === barangayId);
    return b ? { level: b.level, bars: b.bars, peakDay: b.peakDay } : null;
  },

  /** The anonymous daily answer: "yes" (more mosquitoes than usual) or "no". */
  async submitDailyAnswer(barangayId, answer) {
    await wait();
    if (!BARANGAYS.some((x) => x.id === barangayId)) throw new Error("Unknown barangay");
    if (answer !== "yes" && answer !== "no") throw new Error("Unknown answer");
    return { saved: true };
  },

  /** Anonymous count only; the result of the symptom check is never kept. */
  async recordSymptomCheck(barangayId, warningSigns) {
    await wait(40);
    return { saved: BARANGAYS.some((x) => x.id === barangayId) && typeof warningSigns === "boolean" };
  },

  /** Starts a sign-in. The PIN is returned here only because the SMS is simulated. */
  async sendPin(phone) {
    await wait();
    if (!/^9\d{9}$/.test(phone)) throw new Error("Bad number");
    const pin = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
    pending = { phone, pin, expiresAt: Date.now() + 5 * 60 * 1000, tries: 0 };
    return { pin, expiresInSeconds: 300 };
  },

  /** Result: { ok: true } or { ok: false, reason: "wrong" | "expired" | "tooMany", triesLeft } */
  async verifyPin(phone, pin) {
    await wait();
    if (pending === null || pending.phone !== phone) return { ok: false, reason: "expired", triesLeft: 0 };
    if (Date.now() > pending.expiresAt) {
      pending = null;
      return { ok: false, reason: "expired", triesLeft: 0 };
    }
    if (pending.tries >= 3) return { ok: false, reason: "tooMany", triesLeft: 0 };
    if (pin === pending.pin) {
      pending = null;
      return { ok: true };
    }
    pending.tries += 1;
    const triesLeft = 3 - pending.tries;
    return { ok: false, reason: triesLeft > 0 ? "wrong" : "tooMany", triesLeft };
  },

  /** The household report. Needs a signed-in resident; the server adds it to the barangay's totals only. */
  async submitReport(barangayId, flags) {
    await wait();
    if (!BARANGAYS.some((x) => x.id === barangayId)) throw new Error("Unknown barangay");
    return { saved: typeof flags === "object" };
  },
};
