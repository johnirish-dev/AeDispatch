// tests/ingestion.test.ts
import { describe, it, expect } from 'vitest';
import { importCases, getLatestWeather, simulateWeather } from '../src/services/ingestion';

describe('Ingestion Service', () => {
  it('rejects case import if headers are wrong', () => {
    const csv = `wrong,headers,here,cases\n2026-W45,Peñafrancia,Purok 1,0`;
    const res = importCases('U1', csv);
    
    expect(res.success).toBe(false);
    expect(res.errors[0]).toMatch(/Invalid headers/);
  });

  it('rejects case import if there are invalid rows, saving nothing', () => {
    const csv = `week,barangay,purok,cases
2026-W45,Peñafrancia,Purok 1,0
2026-W45,UnknownBarangay,Purok 1,2
InvalidWeek,Bascaran,Purok 2,-5`;

    const res = importCases('U1', csv);
    
    expect(res.success).toBe(false);
    expect(res.errors.length).toBe(3); 
    expect(res.affectedBarangayIds).toEqual([]);
  });

  it('accepts valid cases and returns affected barangay IDs', () => {
    const csv = `week,barangay,purok,cases
2026-W45,Peñafrancia,Purok 1,0
2026-W45,Peñafrancia,Purok 2,2
2026-W45,Bascaran,Purok 4,3`;

    const res = importCases('U1', csv);
    
    expect(res.success).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.affectedBarangayIds).toContain('B1');
    expect(res.affectedBarangayIds).toContain('B3');
  });

  it('simulates weather and checks staleness', () => {
    const affected = simulateWeather('heavy-rain');
    expect(affected.length).toBe(8);
    
    const weather = getLatestWeather();
    expect(weather.isStale).toBe(false);
    expect(weather.record.source).toBe('simulated');
    expect(weather.record.rainfall_mm).toBe(50);
  });
});