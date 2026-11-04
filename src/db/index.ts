import Database from 'better-sqlite3';
import path from 'path';

// Store the database file in the project root (ignored by git)
const dbPath = path.resolve(process.cwd(), 'aedispatch.db');
export const db = new Database(dbPath);

// Enable foreign keys and WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Initializes the database schema based on CLAUDE.md Section 7.
 * Dropping tables first ensures `npm run seed` always starts fresh.
 */
export function initSchema() {
  const schema = `
    DROP TABLE IF EXISTS event_log;
    DROP TABLE IF EXISTS alert;
    DROP TABLE IF EXISTS model_parameters;
    DROP TABLE IF EXISTS survey_container;
    DROP TABLE IF EXISTS entomological_survey;
    DROP TABLE IF EXISTS field_task;
    DROP TABLE IF EXISTS recommendation;
    DROP TABLE IF EXISTS threat_score;
    DROP TABLE IF EXISTS case_import;
    DROP TABLE IF EXISTS case_record;
    DROP TABLE IF EXISTS weather_record;
    DROP TABLE IF EXISTS symptom_count;
    DROP TABLE IF EXISTS household_report;
    DROP TABLE IF EXISTS daily_answer;
    DROP TABLE IF EXISTS otp_challenge;
    DROP TABLE IF EXISTS resident;
    DROP TABLE IF EXISTS bhw;
    DROP TABLE IF EXISTS staff_user;
    DROP TABLE IF EXISTS purok;
    DROP TABLE IF EXISTS barangay;

    CREATE TABLE barangay (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      municipality TEXT NOT NULL,
      population INTEGER NOT NULL,
      area_km2 REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE purok (
      id TEXT PRIMARY KEY,
      barangay_id TEXT NOT NULL REFERENCES barangay(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE staff_user (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE bhw (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      team_label TEXT,
      access_token_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE resident (
      id TEXT PRIMARY KEY,
      phone_hash TEXT UNIQUE NOT NULL,
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      consent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE otp_challenge (
      id TEXT PRIMARY KEY,
      phone_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE daily_answer (
      resident_id TEXT NOT NULL REFERENCES resident(id),
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      date TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (resident_id, date)
    );

    CREATE TABLE household_report (
      resident_id TEXT NOT NULL REFERENCES resident(id),
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      date TEXT NOT NULL,
      standing_water INTEGER DEFAULT 0,
      clogged_gutter INTEGER DEFAULT 0,
      old_containers INTEGER DEFAULT 0,
      bites_indoors INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE symptom_count (
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      date TEXT NOT NULL,
      checks INTEGER DEFAULT 0,
      checks_with_warning_signs INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE weather_record (
      date TEXT NOT NULL,
      municipality TEXT NOT NULL,
      mean_temp_c REAL NOT NULL,
      rainfall_mm REAL NOT NULL,
      source TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (date, municipality)
    );

    CREATE TABLE case_record (
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      purok_id TEXT NOT NULL REFERENCES purok(id),
      iso_week TEXT NOT NULL,
      week_start TEXT NOT NULL,
      confirmed_cases INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (purok_id, iso_week)
    );

    CREATE TABLE case_import (
      id TEXT PRIMARY KEY,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      officer_id TEXT NOT NULL REFERENCES staff_user(id),
      iso_week TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      errors TEXT
    );

    CREATE TABLE threat_score (
      id TEXT PRIMARY KEY,
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      score REAL NOT NULL,
      W REAL NOT NULL,
      C REAL NOT NULL,
      S REAL NOT NULL,
      F REAL,
      H REAL NOT NULL,
      weights_used TEXT NOT NULL,
      density_factor REAL NOT NULL,
      raw_summary TEXT NOT NULL,
      params_version INTEGER NOT NULL
    );

    CREATE TABLE recommendation (
      id TEXT PRIMARY KEY,
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      score_id TEXT NOT NULL REFERENCES threat_score(id),
      tier TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      officer_id TEXT REFERENCES staff_user(id),
      decided_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE field_task (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT REFERENCES recommendation(id),
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      bhw_id TEXT REFERENCES bhw(id),
      type TEXT NOT NULL,
      puroks TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE entomological_survey (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES field_task(id),
      bhw_id TEXT NOT NULL REFERENCES bhw(id),
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      purok_id TEXT NOT NULL REFERENCES purok(id),
      house_no TEXT,
      head_of_family TEXT,
      age INTEGER,
      sex TEXT,
      civil_status TEXT,
      occupation TEXT,
      persons_slept INTEGER,
      building_structure TEXT,
      storeys TEXT,
      rooms INTEGER,
      screened INTEGER,
      surveyed_by TEXT NOT NULL,
      survey_date TEXT NOT NULL,
      no_containers_found INTEGER DEFAULT 0,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE survey_container (
      id TEXT PRIMARY KEY,
      survey_id TEXT NOT NULL REFERENCES entomological_survey(id) ON DELETE CASCADE,
      location TEXT NOT NULL,
      container_type TEXT NOT NULL,
      total INTEGER DEFAULT 0,
      with_cover INTEGER DEFAULT 0,
      without_cover INTEGER DEFAULT 0,
      positive INTEGER DEFAULT 0,
      larvae_count INTEGER DEFAULT 0,
      pupae_count INTEGER DEFAULT 0
    );

    CREATE TABLE model_parameters (
      version INTEGER PRIMARY KEY,
      weights TEXT NOT NULL,
      constants TEXT NOT NULL,
      note TEXT,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE alert (
      id TEXT PRIMARY KEY,
      barangay_id TEXT NOT NULL REFERENCES barangay(id),
      level TEXT NOT NULL,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      message TEXT NOT NULL
    );

    CREATE TABLE event_log (
      id TEXT PRIMARY KEY,
      at DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT NOT NULL,
      text TEXT NOT NULL
    );
  `;

  db.exec(schema);
}