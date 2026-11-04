import { describe, it, expect } from 'vitest';
import { MaxHeap, HeapItem } from '../src/algorithms/maxHeap';

function verifyHeapInvariants(heap: MaxHeap) {
  const arr = heap._test_getHeapArray();
  const pos = heap._test_getPosMap();
  
  expect(arr.length).toBe(pos.size);
  
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    expect(pos.get(item.barangayId)).toBe(i); // pos map accurate
    
    const left = 2 * i + 1;
    const right = 2 * i + 2;
    
    // Parent >= children invariant (accounting for deterministic string tie-breaker)
    if (left < arr.length) {
      const cmp = arr[left].score !== item.score 
        ? arr[left].score - item.score 
        : item.barangayId.localeCompare(arr[left].barangayId);
      expect(cmp).toBeLessThanOrEqual(0);
    }
    
    if (right < arr.length) {
      const cmp = arr[right].score !== item.score 
        ? arr[right].score - item.score 
        : item.barangayId.localeCompare(arr[right].barangayId);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  }
}

describe('MaxHeap', () => {
  it('handles build, peek, and extractMax in correct order', () => {
    const heap = new MaxHeap();
    heap.build([
      { barangayId: 'A', score: 30 },
      { barangayId: 'B', score: 70 },
      { barangayId: 'C', score: 40 },
    ]);
    
    expect(heap.size()).toBe(3);
    verifyHeapInvariants(heap);
    
    expect(heap.peek()?.barangayId).toBe('B');
    expect(heap.extractMax()?.barangayId).toBe('B');
    expect(heap.size()).toBe(2);
    expect(heap.extractMax()?.barangayId).toBe('C');
    expect(heap.extractMax()?.barangayId).toBe('A');
    expect(heap.extractMax()).toBeNull();
  });

  it('updates keys correctly with sift up and sift down', () => {
    const heap = new MaxHeap();
    heap.updateKey('X', 10);
    heap.updateKey('Y', 20);
    heap.updateKey('Z', 5);
    
    expect(heap.peek()?.barangayId).toBe('Y');
    
    // Sift up
    heap.updateKey('Z', 50);
    expect(heap.peek()?.barangayId).toBe('Z');
    verifyHeapInvariants(heap);
    
    // Sift down
    heap.updateKey('Z', 2);
    expect(heap.peek()?.barangayId).toBe('Y');
    verifyHeapInvariants(heap);
  });

  it('extracts topK without mutating live heap', () => {
    const heap = new MaxHeap();
    heap.build([
      { barangayId: 'B1', score: 10 },
      { barangayId: 'B2', score: 50 },
      { barangayId: 'B3', score: 30 },
      { barangayId: 'B4', score: 40 },
      { barangayId: 'B5', score: 20 },
    ]);
    
    const top3 = heap.topK(3);
    expect(top3).toEqual([
      { barangayId: 'B2', score: 50 },
      { barangayId: 'B4', score: 40 },
      { barangayId: 'B3', score: 30 },
    ]);
    
    // Size should remain unchanged
    expect(heap.size()).toBe(5);
  });

  it('handles edge cases for topK', () => {
    const heap = new MaxHeap();
    expect(heap.topK(5)).toEqual([]);
    
    heap.updateKey('A', 10);
    expect(heap.topK(0)).toEqual([]);
    expect(heap.topK(5).length).toBe(1); // k > n
  });

  it('removes elements successfully', () => {
    const heap = new MaxHeap();
    heap.build([
      { barangayId: 'B1', score: 10 },
      { barangayId: 'B2', score: 50 }, // Root
      { barangayId: 'B3', score: 30 }
    ]);
    
    heap.remove('B2'); // Remove root
    expect(heap.size()).toBe(2);
    expect(heap.peek()?.barangayId).toBe('B3');
    verifyHeapInvariants(heap);
    
    heap.remove('Missing'); // Ignore safely
    expect(heap.size()).toBe(2);
    
    heap.remove('B1'); // Remove leaf
    expect(heap.size()).toBe(1);
    verifyHeapInvariants(heap);
  });

  it('maintains invariants through randomized operation sequences', () => {
    const heap = new MaxHeap();
    const map = new Map<string, number>(); // Sorted reference map
    
    // Fuzz test: 2000 random operations
    for (let i = 0; i < 2000; i++) {
      const op = Math.random();
      const id = `B_${Math.floor(Math.random() * 50)}`; // Pool of 50 barangays
      
      if (op < 0.6) {
        // 60% chance: Insert / Update
        const score = Math.floor(Math.random() * 100);
        heap.updateKey(id, score);
        map.set(id, score);
      } else if (op < 0.8 && heap.size() > 0) {
        // 20% chance: Extract Max
        const max = heap.extractMax();
        if (max) map.delete(max.barangayId);
      } else {
        // 20% chance: Remove specific key
        heap.remove(id);
        map.delete(id);
      }
      verifyHeapInvariants(heap);
    }
    
    expect(heap.size()).toBe(map.size);
  });
});