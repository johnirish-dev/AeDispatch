// src/db/seed.ts
import { db, initSchema } from './index';
import { generateSyntheticData } from '../sim/generator';
import crypto from 'crypto';

function hashAuth(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

console.log('Initializing database schema...');
initSchema();

console.log('Generating synthetic data...');
const { barangays, weather, cases, symptoms } = generateSyntheticData(8);

// Start a transaction for bulk inserts
const insertData = db.transaction(() => {
  // 1. Model Parameters (Version 1: Default Weights)
  const defaultParams = {
    weights: JSON.stringify({ w_W: 0.25, w_C: 0.20, w_S: 0.10, w_F: 0.15, w_H: 0.30 }),
    constants: JSON.stringify({ m: 10, lambda: 0.5, tau1: 0.40, tauA: 0.40, theta: 3, window: 14, alert_cap: 3, default_k: 3 })
  };
  db.prepare(`INSERT INTO model_parameters (version, weights, constants, note, is_active) VALUES (1, ?, ?, 'Default starting weights', 1)`)
    .run(defaultParams.weights, defaultParams.constants);

  // 2. Barangays & Puroks (Must be inserted before BHWs and Cases to satisfy Foreign Keys)
  const insertBrgy = db.prepare(`INSERT INTO barangay (id, name, municipality, population, area_km2) VALUES (?, ?, ?, ?, ?)`);
  const insertPurok = db.prepare(`INSERT INTO purok (id, barangay_id, name) VALUES (?, ?, ?)`);
  
  for (const b of barangays) {
    insertBrgy.run(b.id, b.name, b.municipality, b.pop, b.area);
    for (let p = 1; p <= b.puroks; p++) {
      insertPurok.run(`${b.id}_P${p}`, b.id, `Purok ${p}`);
    }
  }

  // 3. Users (Officer and BHWs)
  const officerHash = hashAuth('demo1234');
  db.prepare(`INSERT INTO staff_user (id, username, display_name, role, password_hash) VALUES ('U1', 'officer', 'Health Officer', 'officer', ?)`)
    .run(officerHash);

  const insertBHW = db.prepare(`INSERT INTO bhw (id, display_name, barangay_id, team_label, access_token_hash) VALUES (?, ?, ?, ?, ?)`);
  insertBHW.run('BHW1', 'Jun M. Santos', 'B1', 'Team B', hashAuth('token_jun'));
  insertBHW.run('BHW2', 'Maria C. Reyes', 'B3', 'Team A', hashAuth('token_maria'));
  insertBHW.run('BHW3', 'Lito D. Cruz', 'B5', 'Team C', hashAuth('token_lito'));

  // 4. Weather History
  const insertWeather = db.prepare(`INSERT INTO weather_record (date, municipality, mean_temp_c, rainfall_mm, source) VALUES (?, ?, ?, ?, ?)`);
  for (const w of weather) {
    insertWeather.run(w.date, w.municipality, w.mean_temp_c, w.rainfall_mm, w.source);
  }

  // 5. Case History
  const insertCase = db.prepare(`INSERT INTO case_record (barangay_id, purok_id, iso_week, week_start, confirmed_cases) VALUES (?, ?, ?, ?, ?)`);
  for (const c of cases) {
    insertCase.run(c.barangay_id, c.purok_id, c.iso_week, c.week_start, c.confirmed_cases);
  }

  // 6. Symptom Checks
  const insertSymptom = db.prepare(`INSERT INTO symptom_count (barangay_id, date, checks, checks_with_warning_signs) VALUES (?, ?, ?, ?)`);
  for (const s of symptoms) {
    insertSymptom.run(s.barangay_id, s.date, s.checks, s.checks_with_warning_signs);
  }
  
  // 7. Seed sample initial tasks
  db.prepare(`INSERT INTO field_task (id, barangay_id, type, puroks, status) VALUES ('T1', 'B1', 'spot_check', '["Purok 1"]', 'new')`).run();
});

insertData();
console.log('Database seeded successfully! (aedispatch.db)');