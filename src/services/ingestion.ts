// src/services/ingestion.ts
import { db } from '../db';

export interface ImportResult {
  success: boolean;
  errors: string[];
  affectedBarangayIds: string[];
  importId?: string;
}

function getDateOfISOWeek(w: string): string {
  const [yearStr, weekStr] = w.split('-W');
  const y = parseInt(yearStr, 10);
  const wNum = parseInt(weekStr, 10);
  const simple = new Date(y, 0, 1 + (wNum - 1) * 7);
  const dow = simple.getDay();
  const isoStart = simple;
  if (dow <= 4) {
    isoStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    isoStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return isoStart.toISOString().split('T')[0];
}

export function importCases(officerId: string, csvText: string): ImportResult {
  const lines = csvText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length <= 1) return { success: false, errors: ['File is empty or missing headers'], affectedBarangayIds: [] };

  const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
  if (headers.join(',') !== 'week,barangay,purok,cases') {
    return { success: false, errors: ['Invalid headers. Must be: week, barangay, purok, cases'], affectedBarangayIds: [] };
  }

  const errors: string[] = [];
  const validRows: any[] = [];
  const affectedBarangays = new Set<string>();

  const bpList = db.prepare('SELECT p.id as purok_id, p.name as purok_name, b.id as brgy_id, b.name as brgy_name FROM purok p JOIN barangay b ON p.barangay_id = b.id').all() as any[];
  const bpMap = new Map();
  bpList.forEach(bp => {
    bpMap.set(`${bp.brgy_name.toLowerCase()}_${bp.purok_name.toLowerCase()}`, { brgy_id: bp.brgy_id, purok_id: bp.purok_id });
  });

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    if (parts.length !== 4) {
      errors.push(`Row ${i + 1}: Expected 4 columns, got ${parts.length}`);
      continue;
    }
    
    const [week, barangay, purok, casesStr] = parts;
    let rowHasError = false; // Flag to prevent processing invalid rows
    
    if (!/^20\d{2}-W\d{2}$/.test(week)) {
      errors.push(`Row ${i + 1}: Invalid ISO week format (expected e.g., 2026-W42)`);
      rowHasError = true;
    }
    
    const cases = parseInt(casesStr, 10);
    if (isNaN(cases) || cases < 0) {
      errors.push(`Row ${i + 1}: Cases must be a positive integer`);
      rowHasError = true;
    }

    const key = `${barangay.toLowerCase()}_${purok.toLowerCase()}`;
    const bp = bpMap.get(key);
    
    if (!bp) {
      errors.push(`Row ${i + 1}: Unknown barangay (${barangay}) or purok (${purok})`);
      rowHasError = true;
    } 
    
    // Only process dates and queue for DB insertion if the row is perfectly valid
    if (!rowHasError && bp) {
      validRows.push({
        barangay_id: bp.brgy_id,
        purok_id: bp.purok_id,
        iso_week: week,
        week_start: getDateOfISOWeek(week),
        confirmed_cases: cases
      });
      affectedBarangays.add(bp.brgy_id);
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, affectedBarangayIds: [] };
  }

  const importId = `IMP_${Date.now()}`;
  
  const doImport = db.transaction((rows) => {
    const insertCase = db.prepare(`
      INSERT INTO case_record (barangay_id, purok_id, iso_week, week_start, confirmed_cases)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(purok_id, iso_week) DO UPDATE SET confirmed_cases = excluded.confirmed_cases
    `);
    
    for (const r of rows) {
      insertCase.run(r.barangay_id, r.purok_id, r.iso_week, r.week_start, r.confirmed_cases);
    }

    db.prepare(`
      INSERT INTO case_import (id, officer_id, iso_week, row_count, status, errors)
      VALUES (?, ?, ?, ?, 'success', '[]')
    `).run(importId, officerId, rows[0].iso_week, rows.length);
  });

  doImport(validRows);

  return { success: true, errors: [], affectedBarangayIds: Array.from(affectedBarangays), importId };
}

export function getLatestWeather() {
  const record = db.prepare('SELECT * FROM weather_record ORDER BY date DESC LIMIT 1').get() as any;
  if (!record) return { isStale: true, record: null };
  
  const diffTime = Math.abs(new Date().getTime() - new Date(record.date).getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return { isStale: diffDays > 2, record };
}

export function simulateWeather(preset: 'dry' | 'normal' | 'heavy-rain') {
  let rain = 0; let temp = 30;
  if (preset === 'dry') { rain = 0; temp = 32; }
  else if (preset === 'heavy-rain') { rain = 50; temp = 26; }
  else { rain = 10; temp = 28; }
  
  const date = new Date().toISOString().split('T')[0];
  
  db.prepare(`
    INSERT INTO weather_record (date, municipality, mean_temp_c, rainfall_mm, source)
    VALUES (?, 'Daraga', ?, ?, 'simulated')
    ON CONFLICT(date, municipality) DO UPDATE SET 
      mean_temp_c = excluded.mean_temp_c,
      rainfall_mm = excluded.rainfall_mm,
      source = 'simulated'
  `).run(date, temp, rain);
  
  const brgys = db.prepare('SELECT id FROM barangay').all() as any[];
  return brgys.map(b => b.id);
}