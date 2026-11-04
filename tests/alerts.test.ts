import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMETERS } from "../src/algorithms/parameters";
import { shouldIssueAlert } from "../src/algorithms/alerts";

const P = DEFAULT_PARAMETERS;
const now = new Date("2026-11-10T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

function check(previous: number | null, current: number, recent: Date[] = []) {
  return shouldIssueAlert(
    { previousScore100: previous, currentScore100: current, recentAlertTimes: recent, now },
    P,
  );
}

describe("alert rule", () => {
  it("issues an alert when the score crosses 40 upward", () => {
    const d = check(39, 40);
    expect(d.issue).toBe(true);
    expect(d.reason).toBe("crossed");
    expect(d.level).toBe("elevated");
  });

  it("reports the risk level reached (High if it jumps past 70)", () => {
    expect(check(30, 75).level).toBe("high");
  });

  it("does not alert when the score is still below 40", () => {
    const d = check(20, 39);
    expect(d.issue).toBe(false);
    expect(d.reason).toBe("no-upward-crossing");
    expect(d.level).toBeUndefined();
  });

  it("does not alert while the score stays above 40", () => {
    expect(check(45, 60).issue).toBe(false);
    expect(check(40, 41).issue).toBe(false);
  });

  it("does not alert when the score falls", () => {
    expect(check(60, 30).issue).toBe(false);
  });

  it("does not alert on a barangay's first score", () => {
    const d = check(null, 80);
    expect(d.issue).toBe(false);
    expect(d.reason).toBe("no-previous-score");
  });

  it("allows up to 3 alerts in 7 days and blocks the next one", () => {
    expect(check(39, 40, [daysAgo(1), daysAgo(3)]).issue).toBe(true); // 2 so far
    const blocked = check(39, 40, [daysAgo(1), daysAgo(3), daysAgo(5)]); // 3 so far
    expect(blocked.issue).toBe(false);
    expect(blocked.reason).toBe("cap-reached");
  });

  it("does not count alerts older than 7 days", () => {
    const old = [daysAgo(8), daysAgo(9), daysAgo(20)];
    expect(check(39, 40, old).issue).toBe(true);
  });

  it("treats an alert exactly 7 days old as outside the window", () => {
    const recent = [daysAgo(7), daysAgo(2), daysAgo(1)];
    expect(check(39, 40, recent).issue).toBe(true);
  });

  it("contains the risk level only, no counts or locations", () => {
    const d = check(39, 55);
    expect(Object.keys(d).sort()).toEqual(["issue", "level", "reason"]);
  });
});
