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
  constructor(status, message, body = null) {
    super(message);
    this.status = status;
    /** What the server sent besides the message (for example nextReportDate), or null. */
    this.body = body;
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
  if (!response.ok) throw new ServiceError(response.status, data?.error ?? "Request failed", data);
  return data;
}

export const service = {
  /** [{ id, name, municipality }] */
  listBarangays() {
    return call("/barangays");
  },

  /** { level, alerts: [{ level, issuedAt, message }], weather }; level is null if not scored yet. weather.days is the rain of the last 7 days. */
  async getRisk(barangayId) {
    const view = await call(`/barangays/${barangayId}`);
    return { level: view.level, alerts: view.alerts, weather: view.weather ?? null };
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

  /** { canReport, nextReportDate }: a resident may send one household report in any 7 days. */
  reportStatus() {
    return call("/report/status");
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
