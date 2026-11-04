import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMETERS, ModelParameters } from "../src/algorithms/parameters";
import {
  recommendedAction,
  riskLevel,
  tier2Status,
  trend,
} from "../src/algorithms/risk";

const P = DEFAULT_PARAMETERS;

describe("riskLevel (whole-point score)", () => {
  it.each([
    [0, "low"],
    [24, "low"],
    [25, "moderate"],
    [39, "moderate"],
    [40, "elevated"],
    [69, "elevated"],
    [70, "high"],
    [100, "high"],
  ])("score %i is %s", (score, level) => {
    expect(riskLevel(score, P)).toBe(level);
  });

  it("reads the cut-offs from the parameters", () => {
    const strict: ModelParameters = {
      ...P,
      constants: {
        ...P.constants,
        riskCutoffs: { moderate: 0.1, elevated: 0.2, high: 0.3 },
      },
    };
    expect(riskLevel(15, strict)).toBe("moderate");
    expect(riskLevel(30, strict)).toBe("high");
  });
});

describe("tier2Status", () => {
  it("stays locked with no cases", () => {
    expect(tier2Status([], P)).toEqual({ unlocked: false, puroks: [] });
  });

  it("stays locked at exactly 2 cases in a purok (needs more than 2)", () => {
    const r = tier2Status([{ purok: "Purok 4", cases: 2 }], P);
    expect(r.unlocked).toBe(false);
  });

  it("unlocks at 3 cases in one purok", () => {
    const r = tier2Status([{ purok: "Purok 4", cases: 3 }], P);
    expect(r.unlocked).toBe(true);
    expect(r.puroks).toEqual([{ purok: "Purok 4", cases: 3 }]);
  });

  it("does not add up cases across puroks", () => {
    // 2 + 2 + 2 = 6 cases in the barangay, but no single purok has more than 2
    const r = tier2Status(
      [
        { purok: "Purok 1", cases: 2 },
        { purok: "Purok 2", cases: 2 },
        { purok: "Purok 3", cases: 2 },
      ],
      P,
    );
    expect(r.unlocked).toBe(false);
  });

  it("lists every qualifying purok, most cases first", () => {
    const r = tier2Status(
      [
        { purok: "Purok 1", cases: 3 },
        { purok: "Purok 2", cases: 1 },
        { purok: "Purok 5", cases: 5 },
      ],
      P,
    );
    expect(r.puroks.map((x) => x.purok)).toEqual(["Purok 5", "Purok 1"]);
  });

  it("reads the minimum from the parameters", () => {
    const stricter: ModelParameters = {
      ...P,
      constants: { ...P.constants, tier2: { ...P.constants.tier2, minCases: 5 } },
    };
    expect(tier2Status([{ purok: "Purok 4", cases: 4 }], stricter).unlocked).toBe(false);
    expect(tier2Status([{ purok: "Purok 4", cases: 5 }], stricter).unlocked).toBe(true);
  });
});

describe("recommendedAction", () => {
  it("recommends Monitor below 40 and Tier 1 from 40", () => {
    expect(recommendedAction(39, [], P).action).toBe("monitor");
    expect(recommendedAction(40, [], P).action).toBe("tier1");
    expect(recommendedAction(85, [], P).action).toBe("tier1");
  });

  it("a high score alone never unlocks Tier 2", () => {
    const r = recommendedAction(100, [{ purok: "Purok 1", cases: 2 }], P);
    expect(r.action).toBe("tier1");
    expect(r.tier2.unlocked).toBe(false);
  });

  it("Tier 2 depends on purok cases, not on the score", () => {
    const r = recommendedAction(10, [{ purok: "Purok 4", cases: 3 }], P);
    expect(r.action).toBe("monitor");
    expect(r.tier2.unlocked).toBe(true);
  });
});

describe("trend (2-point dead band)", () => {
  it("is rising above +2 points", () => {
    expect(trend(53, 50, P)).toBe("rising");
  });
  it("is falling below -2 points", () => {
    expect(trend(47, 50, P)).toBe("falling");
  });
  it("is flat at exactly +2 and -2 points", () => {
    expect(trend(52, 50, P)).toBe("flat");
    expect(trend(48, 50, P)).toBe("flat");
  });
  it("is flat when nothing changed", () => {
    expect(trend(50, 50, P)).toBe("flat");
  });
  it("is flat when there is no earlier score", () => {
    expect(trend(50, null, P)).toBe("flat");
    expect(trend(50, undefined, P)).toBe("flat");
  });
});
