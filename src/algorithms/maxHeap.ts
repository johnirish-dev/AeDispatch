export interface HeapItem {
  barangayId: string;
  score: number;
}

export class MaxHeap {
  private heap: HeapItem[] = [];
  private pos: Map<string, number> = new Map();

  // O(1)
  public size(): number {
    return this.heap.length;
  }

  // O(1)
  public has(barangayId: string): boolean {
    return this.pos.has(barangayId);
  }

  // O(n) - Bottom-up heap construction
  public build(items: HeapItem[]): void {
    this.heap = items.map(item => ({ ...item }));
    this.pos.clear();
    for (let i = 0; i < this.heap.length; i++) {
      this.pos.set(this.heap[i].barangayId, i);
    }
    for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
      this.siftDown(i);
    }
  }

  // O(log n) - Insert if absent, update and sift if present
  public updateKey(barangayId: string, score: number): void {
    if (this.pos.has(barangayId)) {
      const idx = this.pos.get(barangayId)!;
      const oldScore = this.heap[idx].score;
      this.heap[idx].score = score;
      
      // Since score could go up or down, we check which way to sift
      if (idx > 0 && this.compare(idx, this.parent(idx)) > 0) {
        this.siftUp(idx);
      } else {
        this.siftDown(idx);
      }
    } else {
      this.heap.push({ barangayId, score });
      const idx = this.heap.length - 1;
      this.pos.set(barangayId, idx);
      this.siftUp(idx);
    }
  }

  // O(1)
  public peek(): HeapItem | null {
    return this.heap.length > 0 ? { ...this.heap[0] } : null;
  }

  // O(log n)
  public extractMax(): HeapItem | null {
    if (this.heap.length === 0) return null;
    const max = this.heap[0];
    this.swap(0, this.heap.length - 1);
    this.heap.pop();
    this.pos.delete(max.barangayId);
    
    if (this.heap.length > 0) {
      this.siftDown(0);
    }
    return max;
  }

  // O(log n) - Swap target with leaf, pop, and sift swapped element
  public remove(barangayId: string): void {
    if (!this.pos.has(barangayId)) return;
    
    const idx = this.pos.get(barangayId)!;
    const isLast = idx === this.heap.length - 1;
    
    this.swap(idx, this.heap.length - 1);
    this.heap.pop();
    this.pos.delete(barangayId);
    
    if (!isLast && this.heap.length > 0) {
      if (idx > 0 && this.compare(idx, this.parent(idx)) > 0) {
        this.siftUp(idx);
      } else {
        this.siftDown(idx);
      }
    }
  }

  // O(k log k) - Uses an auxiliary candidate heap to extract top K without modifying the live heap
  public topK(k: number): HeapItem[] {
    if (this.heap.length === 0 || k <= 0) return [];
    
    const result: HeapItem[] = [];
    const auxHeap: number[] = []; // Stores indices of the main heap
    
    const auxCompare = (i: number, j: number) => this.compare(auxHeap[i], auxHeap[j]);
    const auxSwap = (i: number, j: number) => {
      const temp = auxHeap[i]; auxHeap[i] = auxHeap[j]; auxHeap[j] = temp;
    };
    
    const auxSiftUp = (idx: number) => {
      while (idx > 0) {
        const p = Math.floor((idx - 1) / 2);
        if (auxCompare(idx, p) > 0) { auxSwap(idx, p); idx = p; } else break;
      }
    };
    
    const auxSiftDown = (idx: number) => {
      const size = auxHeap.length;
      while (true) {
        let maxIdx = idx;
        const left = 2 * idx + 1, right = 2 * idx + 2;
        if (left < size && auxCompare(left, maxIdx) > 0) maxIdx = left;
        if (right < size && auxCompare(right, maxIdx) > 0) maxIdx = right;
        if (maxIdx !== idx) { auxSwap(idx, maxIdx); idx = maxIdx; } else break;
      }
    };

    auxHeap.push(0); // push root index

    while (result.length < k && auxHeap.length > 0) {
      const topIdx = auxHeap[0];
      auxSwap(0, auxHeap.length - 1);
      auxHeap.pop();
      if (auxHeap.length > 0) auxSiftDown(0);
      
      result.push({ ...this.heap[topIdx] });

      const left = this.left(topIdx);
      const right = this.right(topIdx);
      
      if (left < this.heap.length) { auxHeap.push(left); auxSiftUp(auxHeap.length - 1); }
      if (right < this.heap.length) { auxHeap.push(right); auxSiftUp(auxHeap.length - 1); }
    }

    return result;
  }

  // --- Internal Heap Mechanics ---

  private parent(i: number) { return Math.floor((i - 1) / 2); }
  private left(i: number) { return 2 * i + 1; }
  private right(i: number) { return 2 * i + 2; }

  // Returns > 0 if heap[i] > heap[j]
  private compare(i: number, j: number): number {
    if (this.heap[i].score !== this.heap[j].score) {
      return this.heap[i].score - this.heap[j].score;
    }
    // Tie-breaker: deterministic descending alphabetical sort for stable ranking
    return this.heap[j].barangayId.localeCompare(this.heap[i].barangayId);
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
    this.pos.set(this.heap[i].barangayId, i);
    this.pos.set(this.heap[j].barangayId, j);
  }

  private siftUp(idx: number): void {
    while (idx > 0 && this.compare(idx, this.parent(idx)) > 0) {
      this.swap(idx, this.parent(idx));
      idx = this.parent(idx);
    }
  }

  private siftDown(idx: number): void {
    const size = this.heap.length;
    while (true) {
      let maxIdx = idx;
      const l = this.left(idx);
      const r = this.right(idx);
      
      if (l < size && this.compare(l, maxIdx) > 0) maxIdx = l;
      if (r < size && this.compare(r, maxIdx) > 0) maxIdx = r;
      
      if (maxIdx !== idx) {
        this.swap(idx, maxIdx);
        idx = maxIdx;
      } else {
        break;
      }
    }
  }

  // Visibility purely for strict Vitest invariant checks
  public _test_getHeapArray() { return this.heap; }
  public _test_getPosMap() { return this.pos; }
}