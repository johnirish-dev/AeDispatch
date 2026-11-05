// Seeded random numbers, so every simulation and seed is reproducible.

export type Rng = () => number;

/** mulberry32: small, fast, and good enough for simulation. Returns [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both included. */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Standard normal (Box-Muller). */
export function normal(rng: Rng): number {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function poisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda >= 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export function binomial(rng: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  if (n <= 60) {
    let hits = 0;
    for (let i = 0; i < n; i++) if (rng() < p) hits++;
    return hits;
  }
  const x = Math.round(n * p + Math.sqrt(n * p * (1 - p)) * normal(rng));
  return Math.min(n, Math.max(0, x));
}

/** Splits `total` into `parts` non-negative integers that add up to `total`. */
export function splitCount(rng: Rng, total: number, parts: number): number[] {
  const out = new Array<number>(parts).fill(0);
  for (let i = 0; i < total; i++) out[Math.floor(rng() * parts)]++;
  return out;
}
