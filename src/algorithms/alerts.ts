// Alert rule for the resident screens.
//
// An alert is issued only when a barangay's score crosses the alert threshold
// upward (not every time it is above it), and only if fewer than the allowed
// number of alerts went out in the last 7 days. This limits alert fatigue.
//
// The decision carries the risk level only. It never contains case counts or
// locations, and the wording of the message is left to the UI strings.
//
// Scores are the whole-point scores the officer sees (0-100).

import { ModelParameters, toPoints } from "./parameters";
import { RiskLevel, riskLevel } from "./risk";

export interface AlertCheck {
  /** Score before the update; null if the barangay had no earlier score. */
  previousScore100: number | null;
  currentScore100: number;
  /** When this barangay's earlier alerts were issued. */
  recentAlertTimes: Date[];
  now: Date;
}

export type AlertReason =
  | "crossed"
  | "no-previous-score"
  | "no-upward-crossing"
  | "cap-reached";

export interface AlertDecision {
  issue: boolean;
  reason: AlertReason;
  /** Present only when an alert is issued. */
  level?: RiskLevel;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function shouldIssueAlert(
  check: AlertCheck,
  p: ModelParameters,
): AlertDecision {
  const threshold = toPoints(p.constants.alertThreshold);

  // First score ever: there is no "crossing" yet. This also keeps the seed
  // data from firing alerts for every barangay that starts above the line.
  if (check.previousScore100 === null) {
    return { issue: false, reason: "no-previous-score" };
  }

  const crossedUp =
    check.previousScore100 < threshold && check.currentScore100 >= threshold;
  if (!crossedUp) return { issue: false, reason: "no-upward-crossing" };

  // Count alerts inside the window (now - 7 days, now].
  const windowStart = check.now.getTime() - p.constants.alertWindowDays * MS_PER_DAY;
  const recent = check.recentAlertTimes.filter((t) => {
    const time = t.getTime();
    return time > windowStart && time <= check.now.getTime();
  }).length;
  if (recent >= p.constants.alertCap) {
    return { issue: false, reason: "cap-reached" };
  }

  return {
    issue: true,
    reason: "crossed",
    level: riskLevel(check.currentScore100, p),
  };
}
