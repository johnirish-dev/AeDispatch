// Everything the resident page asks of the server goes through this file (the routes under
// /api/resident). The screens call these functions and never use fetch themselves.
//
// What the server decides, and what stays on the phone:
//   - The risk LEVEL and alerts come from the server (never a score or a case count).
//   - The daily question needs no sign-in. The "once a day" rule is kept on the phone (see app.js);
//     the server only caps how many one barangay can add in a day.
//   - Only the household report needs the PIN sign-in. The SMS is simulated: the server hands the
//     PIN back and the page shows it as a "demo SMS".

const BASE = "/api/resident";

/** A request the server refused, or could not be understood. `status` is the HTTP status (0: no connection). */
export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ServiceError(0, "No connection");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) throw new ServiceError(response.status, data?.error ?? "Request failed");
  return data;
}

// The 7-day outlook is an illustration (the screen says so): its shape follows the level, and the
// same barangay always gets the same shape. It is not a forecast and uses no live data.
const LEVEL_HEIGHT = { low: 24, moderate: 34, elevated: 46, high: 56 };

function outlookFor(level, barangayId) {
  const base = LEVEL_HEIGHT[level];
  const peakDay = 1 + (barangayId % 4);
  const bars = Array.from({ length: 7 }, (_, i) => {
    const slope = base * (1 - 0.1 * Math.abs(i - peakDay));
    const wobble = (barangayId * 7 + i * 5) % 5;
    return Math.round(slope + wobble);
  });
  return { bars, peakDay };
}

export const service = {
  /** [{ id, name, municipality }] */
  listBarangays() {
    return call("/barangays");
  },

  /** { level, alerts: [{ level, issuedAt, message }], bars, peakDay }; level is null if not scored yet. */
  async getRisk(barangayId) {
    const view = await call(`/barangays/${barangayId}`);
    const outlook = view.level === null ? { bars: [], peakDay: 0 } : outlookFor(view.level, barangayId);
    return { level: view.level, alerts: view.alerts, ...outlook };
  },

  /** The anonymous daily answer: "yes" (more mosquitoes than usual) or "no". */
  async submitDailyAnswer(barangayId, answer) {
    try {
      await call(`/barangays/${barangayId}/daily-answer`, { method: "POST", body: { answer } });
      return { saved: true };
    } catch (error) {
      // The barangay's daily limit was reached: the person is not told, and nothing is lost for them.
      if (error instanceof ServiceError && error.status === 429) return { saved: false };
      throw error;
    }
  },

  /** An anonymous count only; the result of the symptom check is never sent. A failure is ignored. */
  async recordSymptomCheck(barangayId, warningSigns) {
    try {
      await call(`/barangays/${barangayId}/symptom-check`, { method: "POST", body: { warningSigns } });
      return { saved: true };
    } catch {
      return { saved: false };
    }
  },

  /** Starts a sign-in: { pin, expiresInSeconds }. The PIN is returned only because the SMS is simulated. */
  sendPin(phone) {
    return call("/auth/send-pin", { method: "POST", body: { phone } });
  },

  /** { ok: true } or { ok: false, reason: "wrong" | "expired" | "tooMany", triesLeft } */
  verifyPin(phone, pin, barangayId) {
    return call("/auth/verify", { method: "POST", body: { phone, pin, barangayId } });
  },

  /** Is the sign-in still valid? (A session lasts 8 hours and is lost when the server restarts.) */
  async isSignedIn() {
    try {
      await call("/me");
      return true;
    } catch {
      return false;
    }
  },

  /** The household report. The server files it under the barangay chosen at sign-in. */
  submitReport(flags) {
    return call("/household-report", {
      method: "POST",
      body: {
        standingWater: flags.standing_water,
        cloggedGutter: flags.clogged_drain,
        oldContainers: flags.tires_cans,
        bitesIndoors: flags.indoor_bites,
      },
    });
  },
};
