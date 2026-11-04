import { describe, it, expect } from 'vitest';
import { MaxHeap } from '../src/algorithms/maxHeap';

// Small seeded generator so a failing random test can be reproduced.
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reference ranking: score descending, then id ascending.
function sortedReference(model: Map<string, number>): { id: string; score: number }[] {
  return [...model.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

function heapWith(entries: [string, number][]): MaxHeap {
  const h = new MaxHeap();
  h.build(entries.map(([id, score]) => ({ id, score })));
  return h;
}

describe('MaxHeap basics', () => {
  it('builds from entries and returns the maximum', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30], ['d', 40]]);
    expect(h.size).toBe(4);
    expect(h.peek()).toEqual({ id: 'b', score: 50 });
    expect(h.isValid()).toBe(true);
  });

  it('extractMax returns entries from highest to lowest', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30], ['d', 40]]);
    const order = [h.extractMax(), h.extractMax(), h.extractMax(), h.extractMax()];
    expect(order.map((e) => e?.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(h.size).toBe(0);
  });

  it('updateKey inserts a new id', () => {
    const h = new MaxHeap();
    h.updateKey('a', 5);
    h.updateKey('b', 9);
    expect(h.has('b')).toBe(true);
    expect(h.peek()?.id).toBe('b');
  });

  it('updateKey moves an entry up and down', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30]]);
    h.updateKey('a', 90);
    expect(h.peek()?.id).toBe('a');
    h.updateKey('a', 1);
    expect(h.peek()?.id).toBe('b');
    expect(h.isValid()).toBe(true);
  });

  it('updateKey with the same score changes nothing', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30]]);
    h.updateKey('c', 30);
    expect(h.topK(3).map((e) => e.id)).toEqual(['b', 'c', 'a']);
    expect(h.isValid()).toBe(true);
  });

  it('remove works for the root, a middle entry and a leaf', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30], ['d', 40], ['e', 20]]);
    expect(h.remove('b')).toBe(true); // root
    expect(h.remove('c')).toBe(true); // middle
    expect(h.remove('a')).toBe(true); // leaf
    expect(h.isValid()).toBe(true);
    expect(h.topK(5).map((e) => e.id)).toEqual(['d', 'e']);
    expect(h.has('b')).toBe(false);
  });

  it('remove of an unknown id returns false', () => {
    const h = heapWith([['a', 1]]);
    expect(h.remove('zzz')).toBe(false);
    expect(h.size).toBe(1);
  });
});

describe('MaxHeap edge cases', () => {
  it('handles an empty heap', () => {
    const h = new MaxHeap();
    expect(h.peek()).toBeUndefined();
    expect(h.extractMax()).toBeUndefined();
    expect(h.topK(3)).toEqual([]);
    expect(h.size).toBe(0);
  });

  it('build with an empty list gives an empty heap', () => {
    const h = heapWith([['a', 1]]);
    h.build([]);
    expect(h.size).toBe(0);
    expect(h.has('a')).toBe(false);
    expect(h.isValid()).toBe(true);
  });

  it('build replaces earlier contents', () => {
    const h = heapWith([['a', 1], ['b', 2]]);
    h.build([{ id: 'x', score: 7 }]);
    expect(h.size).toBe(1);
    expect(h.has('a')).toBe(false);
  });

  it('build rejects duplicate ids', () => {
    const h = new MaxHeap();
    expect(() =>
      h.build([{ id: 'a', score: 1 }, { id: 'a', score: 2 }]),
    ).toThrow();
  });

  it('topK handles k = 0, negative k and k larger than size', () => {
    const h = heapWith([['a', 10], ['b', 20]]);
    expect(h.topK(0)).toEqual([]);
    expect(h.topK(-1)).toEqual([]);
    expect(h.topK(99).map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('topK does not change the live heap', () => {
    const h = heapWith([['a', 10], ['b', 50], ['c', 30], ['d', 40]]);
    h.topK(3);
    expect(h.size).toBe(4);
    expect(h.peek()?.id).toBe('b');
    expect(h.isValid()).toBe(true);
  });

  it('peek returns a copy, so callers cannot corrupt the heap', () => {
    const h = heapWith([['a', 10], ['b', 50]]);
    const top = h.peek();
    if (top) top.score = -1;
    expect(h.peek()?.score).toBe(50);
  });
});

describe('MaxHeap tie-breaking', () => {
  it('ranks equal scores by smaller id first', () => {
    const h = heapWith([['c', 5], ['a', 5], ['b', 5]]);
    expect(h.topK(3).map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(h.extractMax()?.id).toBe('a');
  });

  it('keeps the tie-break after updateKey', () => {
    const h = heapWith([['a', 1], ['b', 5], ['c', 9]]);
    h.updateKey('c', 5);
    expect(h.topK(3).map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('works with numeric ids', () => {
    const h = new MaxHeap();
    h.build([{ id: 10, score: 3 }, { id: 2, score: 3 }]);
    expect(h.peek()?.id).toBe(2);
  });
});

describe('MaxHeap randomized test against a sorted reference', () => {
  it('matches the reference after every operation (seeded)', () => {
    const rand = seededRandom(20261119);
    const heap = new MaxHeap();
    const model = new Map<string, number>();

    for (let step = 0; step < 5000; step++) {
      const id = `b${Math.floor(rand() * 60)}`;
      const score = Math.floor(rand() * 20); // small range forces many ties
      const op = rand();

      if (op < 0.55) {
        heap.updateKey(id, score);
        model.set(id, score);
      } else if (op < 0.75) {
        expect(heap.remove(id)).toBe(model.delete(id));
      } else if (op < 0.9) {
        const expected = sortedReference(model)[0];
        expect(heap.extractMax()).toEqual(expected);
        if (expected) model.delete(expected.id);
      } else {
        const entries = sortedReference(model);
        const shuffled = [...entries].sort(() => rand() - 0.5);
        heap.build(shuffled);
      }

      const ref = sortedReference(model);
      const k = Math.floor(rand() * 10);
      expect(heap.isValid()).toBe(true);
      expect(heap.size).toBe(ref.length);
      expect(heap.peek()).toEqual(ref[0]);
      expect(heap.topK(k)).toEqual(ref.slice(0, k));
    }
  });
});