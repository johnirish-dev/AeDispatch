// Indexed binary max heap for the barangay priority queue.
//
// The heap array holds (id, score) entries. A position map (id -> array index)
// lets us find any barangay in O(1), so a score can change without a search.
//
// Complexity (n = number of entries):
//   build O(n) | updateKey O(log n) | remove O(log n) | extractMax O(log n)
//   peek O(1)  | topK O(k log k)    | has O(1)        | size O(1)
//
// Ids must all be the same type (all strings or all numbers) so that the
// tie-break comparison is well defined.

export type HeapId = string | number;

export interface HeapEntry {
  id: HeapId;
  score: number;
}

export class MaxHeap {
  private heap: HeapEntry[] = [];
  private pos = new Map<HeapId, number>();

  get size(): number {
    return this.heap.length;
  }

  has(id: HeapId): boolean {
    return this.pos.has(id);
  }

  /** Replace the contents with `entries`. Ids must be unique. */
  build(entries: HeapEntry[]): void {
    const seen = new Set<HeapId>();
    for (const e of entries) {
      if (seen.has(e.id)) throw new Error(`Duplicate id in build: ${e.id}`);
      seen.add(e.id);
    }

    this.heap = entries.map((e) => ({ id: e.id, score: e.score }));
    this.pos = new Map();
    this.heap.forEach((e, i) => this.pos.set(e.id, i));

    // Sift down every parent, starting from the last one.
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }

  /** Set the score of `id`, inserting it if it is not in the heap yet. */
  updateKey(id: HeapId, score: number): void {
    const i = this.pos.get(id);
    if (i === undefined) {
      this.heap.push({ id, score });
      this.pos.set(id, this.heap.length - 1);
      this.siftUp(this.heap.length - 1);
      return;
    }
    this.heap[i].score = score;
    this.restore(i);
  }

  /** The highest-ranked entry, or undefined if the heap is empty. */
  peek(): HeapEntry | undefined {
    return this.heap.length > 0 ? { ...this.heap[0] } : undefined;
  }

  /** Remove and return the highest-ranked entry. */
  extractMax(): HeapEntry | undefined {
    const top = this.peek();
    if (top) this.remove(top.id);
    return top;
  }

  /** Remove `id`. Returns false if it was not in the heap. */
  remove(id: HeapId): boolean {
    const i = this.pos.get(id);
    if (i === undefined) return false;

    const last = this.heap.length - 1;
    this.swap(i, last);
    this.heap.pop();
    this.pos.delete(id);

    // The entry moved into slot i may belong higher or lower.
    if (i < this.heap.length) this.restore(i);
    return true;
  }

  /**
   * The k highest-ranked entries in rank order, without changing the heap.
   * An auxiliary heap holds candidate indices: the next best entry is always
   * the best candidate, and extracting it adds its two children.
   */
  topK(k: number): HeapEntry[] {
    const count = Math.min(Math.floor(k), this.heap.length);
    if (!(count > 0)) return [];

    const candidates: number[] = [0];
    const better = (a: number, b: number) =>
      MaxHeap.outranks(this.heap[a], this.heap[b]);

    const pushCandidate = (index: number) => {
      candidates.push(index);
      let c = candidates.length - 1;
      while (c > 0) {
        const parent = (c - 1) >> 1;
        if (!better(candidates[c], candidates[parent])) break;
        [candidates[c], candidates[parent]] = [candidates[parent], candidates[c]];
        c = parent;
      }
    };

    const popCandidate = (): number => {
      const best = candidates[0];
      const tail = candidates.pop() as number;
      if (candidates.length > 0) {
        candidates[0] = tail;
        let c = 0;
        for (;;) {
          const left = 2 * c + 1;
          const right = left + 1;
          let top = c;
          if (left < candidates.length && better(candidates[left], candidates[top])) top = left;
          if (right < candidates.length && better(candidates[right], candidates[top])) top = right;
          if (top === c) break;
          [candidates[c], candidates[top]] = [candidates[top], candidates[c]];
          c = top;
        }
      }
      return best;
    };

    const result: HeapEntry[] = [];
    while (result.length < count) {
      const index = popCandidate();
      result.push({ ...this.heap[index] });
      const left = 2 * index + 1;
      if (left < this.heap.length) pushCandidate(left);
      if (left + 1 < this.heap.length) pushCandidate(left + 1);
    }
    return result;
  }

  /** True if the heap order and the position map are both consistent. */
  isValid(): boolean {
    if (this.pos.size !== this.heap.length) return false;
    for (let i = 0; i < this.heap.length; i++) {
      if (this.pos.get(this.heap[i].id) !== i) return false;
      if (i > 0 && MaxHeap.outranks(this.heap[i], this.heap[(i - 1) >> 1])) return false;
    }
    return true;
  }

  // a ranks above b if its score is higher; equal scores go to the smaller id.
  // Plain < is used (not localeCompare) so the order never depends on locale.
  private static outranks(a: HeapEntry, b: HeapEntry): boolean {
    if (a.score !== b.score) return a.score > b.score;
    return a.id < b.id;
  }

  // Move the entry at i up or down, whichever direction it needs.
  private restore(i: number): void {
    const id = this.heap[i].id; // siftUp may move it, so follow it by id
    this.siftUp(i);
    this.siftDown(this.pos.get(id) as number);
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!MaxHeap.outranks(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let top = i;
      if (left < n && MaxHeap.outranks(this.heap[left], this.heap[top])) top = left;
      if (right < n && MaxHeap.outranks(this.heap[right], this.heap[top])) top = right;
      if (top === i) return;
      this.swap(i, top);
      i = top;
    }
  }

  private swap(i: number, j: number): void {
    if (i === j) return;
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
    this.pos.set(this.heap[i].id, i);
    this.pos.set(this.heap[j].id, j);
  }
}