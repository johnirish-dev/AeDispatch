import { describe, expect, it } from "vitest";
import {
  bootstrapCI,
  gini,
  leadTimeWeeks,
  mean,
  median,
  ndcgAtK,
  pairedDifference,
  precisionAtK,
  spearman,
  trueTop,
  verdictOf,
} from "../src/algorithms/metrics";

// Barangays 0..5 and the cases each really had afterwards.
const gains = [0, 5, 0, 2, 9, 1];

describe("precision@k", () => {
  it("is 1 when the recommended barangays are the true top k", () => {
    expect(precisionAtK([4, 1, 3], gains, 3)).toBe(1);
  });

  it("counts only barangays that had cases, and divides by k", () => {
    // true top 3 = 4 (9 cases), 1 (5 cases), 3 (2 cases); recommending 4, 0, 2 finds one of three
    expect(precisionAtK([4, 0, 2], gains, 3)).toBeCloseTo(1 / 3);
  });

  it("breaks ties between equal gains by the lower index", () => {
    expect(trueTop([3, 3, 3, 0], 2)).toEqual([0, 1]);
  });

  it("cannot reach 1 when fewer than k barangays had cases", () => {
    expect(precisionAtK([4, 1, 0, 2], [0, 5, 0, 0, 9, 0], 4)).toBeCloseTo(2 / 4);
  });

  it("is NaN when nobody had a case", () => {
    expect(precisionAtK([0, 1], [0, 0], 2)).toBeNaN();
  });
});

describe("ndcg@k", () => {
  it("is 1 for the best possible order", () => {
    expect(ndcgAtK([4, 1, 3, 5, 0, 2], gains, 3)).toBeCloseTo(1);
  });

  it("is lower for the reverse order, and higher when the big case is first", () => {
    const worst = ndcgAtK([2, 0, 5, 3, 1, 4], gains, 3);
    const middle = ndcgAtK([1, 4, 3, 5, 0, 2], gains, 3);
    const best = ndcgAtK([4, 1, 3, 5, 0, 2], gains, 3);
    expect(worst).toBeLessThan(middle);
    expect(middle).toBeLessThan(best);
  });

  it("is NaN when nobody had a case", () => {
    expect(ndcgAtK([0, 1], [0, 0], 2)).toBeNaN();
  });
});

describe("gini", () => {
  it("is 0 when every barangay is chosen equally often", () => {
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0);
  });

  it("is (n-1)/n when one barangay gets every dispatch", () => {
    expect(gini([0, 0, 0, 4])).toBeCloseTo(0.75);
  });

  it("is 0 when nothing was dispatched", () => {
    expect(gini([0, 0, 0])).toBe(0);
  });
});

describe("spearman", () => {
  it("is 1 for the same order and -1 for the reverse", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  it("is NaN when one list is constant", () => {
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNaN();
  });
});

describe("lead time, mean and median", () => {
  it("counts weeks before the jump as positive", () => {
    expect(leadTimeWeeks(5, 8)).toBe(3);
    expect(leadTimeWeeks(8, 8)).toBe(0);
    expect(leadTimeWeeks(9, 8)).toBe(-1);
    expect(leadTimeWeeks(null, 8)).toBeNull();
  });

  it("skip NaN values", () => {
    expect(mean([1, 2, NaN, 3])).toBe(2);
    expect(median([5, NaN, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("bootstrap interval", () => {
  it("is repeatable for the same seed and contains the mean", () => {
    const values = [0.4, 0.5, 0.6, 0.55, 0.45, 0.5, 0.52, 0.48];
    const a = bootstrapCI(values, 500, 7);
    const b = bootstrapCI(values, 500, 7);
    expect(a).toEqual(b);
    expect(a.low).toBeLessThanOrEqual(a.mean);
    expect(a.high).toBeGreaterThanOrEqual(a.mean);
  });

  it("is narrower for steadier values", () => {
    const steady = bootstrapCI([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 500, 1);
    const wide = bootstrapCI([0.1, 0.9, 0.2, 0.8, 0.3, 0.7], 500, 1);
    expect(steady.high - steady.low).toBeLessThan(wide.high - wide.low);
  });
});

describe("paired differences and the verdict", () => {
  it("subtracts item by item", () => {
    expect(pairedDifference([3, 5, 7], [1, 5, 9])).toEqual([2, 0, -2]);
  });

  it("calls a method better only when the whole interval is above 0", () => {
    expect(verdictOf({ mean: 0.2, low: 0.1, high: 0.3 })).toBe("better");
    expect(verdictOf({ mean: -0.2, low: -0.3, high: -0.1 })).toBe("worse");
    expect(verdictOf({ mean: 0.05, low: -0.1, high: 0.2 })).toBe("tie");
  });
});
