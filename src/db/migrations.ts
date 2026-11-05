// Schema migrations. They live in TypeScript (not .sql files) so that `tsc`
// builds carry them along with no copy step. To change the schema, add a new
// entry at the end; never edit one that has already been applied.

export interface Migration {
  name: string;
  sql: string;
}

// ISO timestamp default, e.g. 2026-11-05T09:00:00.000Z
const NOW = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
const BARANGAY = "INTEGER NOT NULL REFERENCES barangay(id) ON DELETE CASCADE";

const INIT = `
CREATE TABLE barangay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  municipality TEXT NOT NULL,
  population INTEGER NOT NULL CHECK (population > 0),
  area_km2 REAL NOT NULL CHECK (area_km2 > 0),
  created_at ${NOW},
  updated_at ${NOW}
);

CREATE TABLE purok (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barangay_id ${BARANGAY},
  name TEXT NOT NULL,
  created_at ${NOW},
  UNIQUE (barangay_id, name)
);

CREATE TABLE staff_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'officer' CHECK (role IN ('officer')),
  password_hash TEXT NOT NULL,
  created_at ${NOW},
  updated_at ${NOW}
);

CREATE TABLE bhw (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  barangay_id ${BARANGAY},
  team_label TEXT,
  access_token_hash TEXT NOT NULL UNIQUE,
  created_at ${NOW},
  updated_at ${NOW}
);

-- Residents are anonymous: only a salted hash of the phone number is kept.
CREATE TABLE resident (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash TEXT NOT NULL UNIQUE,
  barangay_id ${BARANGAY},
  consent_at TEXT NOT NULL,
  created_at ${NOW}
);

CREATE TABLE otp_challenge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at ${NOW}
);

CREATE TABLE daily_answer (
  resident_id INTEGER NOT NULL REFERENCES resident(id) ON DELETE CASCADE,
  barangay_id ${BARANGAY},
  date TEXT NOT NULL,
  answer TEXT NOT NULL CHECK (answer IN ('yes','no')),
  created_at ${NOW},
  PRIMARY KEY (resident_id, date)
);

CREATE TABLE household_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id INTEGER NOT NULL REFERENCES resident(id) ON DELETE CASCADE,
  barangay_id ${BARANGAY},
  date TEXT NOT NULL,
  standing_water INTEGER NOT NULL DEFAULT 0 CHECK (standing_water IN (0,1)),
  clogged_gutter INTEGER NOT NULL DEFAULT 0 CHECK (clogged_gutter IN (0,1)),
  old_containers INTEGER NOT NULL DEFAULT 0 CHECK (old_containers IN (0,1)),
  bites_indoors INTEGER NOT NULL DEFAULT 0 CHECK (bites_indoors IN (0,1)),
  created_at ${NOW}
);

CREATE TABLE symptom_count (
  barangay_id ${BARANGAY},
  date TEXT NOT NULL,
  checks INTEGER NOT NULL CHECK (checks >= 0),
  checks_with_warning_signs INTEGER NOT NULL CHECK (checks_with_warning_signs >= 0),
  created_at ${NOW},
  PRIMARY KEY (barangay_id, date)
);

-- A real record never overwrites a simulated one: both are kept, and reads
-- prefer simulated, then api, then file.
CREATE TABLE weather_record (
  date TEXT NOT NULL,
  municipality TEXT NOT NULL,
  mean_temp_c REAL NOT NULL,
  rainfall_mm REAL NOT NULL CHECK (rainfall_mm >= 0),
  source TEXT NOT NULL CHECK (source IN ('file','api','simulated')),
  created_at ${NOW},
  PRIMARY KEY (date, municipality, source)
);

CREATE TABLE case_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barangay_id ${BARANGAY},
  purok_id INTEGER NOT NULL REFERENCES purok(id) ON DELETE CASCADE,
  iso_week TEXT NOT NULL,
  week_start TEXT NOT NULL,
  confirmed_cases INTEGER NOT NULL CHECK (confirmed_cases >= 0),
  created_at ${NOW},
  UNIQUE (purok_id, iso_week)
);

CREATE TABLE case_import (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_at TEXT NOT NULL,
  officer_id INTEGER NOT NULL REFERENCES staff_user(id),
  iso_week TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('imported','rejected')),
  errors TEXT NOT NULL DEFAULT '[]',
  created_at ${NOW}
);

CREATE TABLE model_parameters (
  version INTEGER PRIMARY KEY,
  weights TEXT NOT NULL,
  constants TEXT NOT NULL,
  note TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at ${NOW}
);
CREATE UNIQUE INDEX one_active_parameters ON model_parameters (is_active) WHERE is_active = 1;

CREATE TABLE threat_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barangay_id ${BARANGAY},
  computed_at TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  w REAL NOT NULL,
  c REAL NOT NULL,
  s REAL NOT NULL,
  f REAL NOT NULL,
  h REAL NOT NULL,
  weights_used TEXT NOT NULL,
  density_factor REAL NOT NULL,
  raw_summary TEXT NOT NULL,
  params_version INTEGER NOT NULL REFERENCES model_parameters(version),
  created_at ${NOW}
);

CREATE TABLE recommendation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barangay_id ${BARANGAY},
  score_id INTEGER NOT NULL REFERENCES threat_score(id) ON DELETE CASCADE,
  tier INTEGER NOT NULL CHECK (tier IN (1,2)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  reason TEXT,
  officer_id INTEGER REFERENCES staff_user(id),
  decided_at TEXT,
  created_at ${NOW},
  updated_at ${NOW}
);

CREATE TABLE field_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id INTEGER REFERENCES recommendation(id) ON DELETE SET NULL,
  barangay_id ${BARANGAY},
  bhw_id INTEGER NOT NULL REFERENCES bhw(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('search_and_destroy','spot_check','tier2_verification')),
  puroks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','completed')),
  created_at ${NOW},
  updated_at ${NOW}
);

CREATE TABLE entomological_survey (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES field_task(id) ON DELETE SET NULL,
  bhw_id INTEGER REFERENCES bhw(id) ON DELETE SET NULL,
  barangay_id ${BARANGAY},
  purok_id INTEGER REFERENCES purok(id) ON DELETE SET NULL,
  house_no TEXT,
  head_of_family TEXT,
  age INTEGER,
  sex TEXT,
  civil_status TEXT,
  occupation TEXT,
  persons_slept INTEGER,
  building_structure TEXT,
  storeys INTEGER,
  rooms INTEGER,
  screened INTEGER CHECK (screened IN (0,1)),
  surveyed_by TEXT,
  survey_date TEXT NOT NULL,
  no_containers_found INTEGER NOT NULL DEFAULT 0 CHECK (no_containers_found IN (0,1)),
  submitted_at TEXT NOT NULL,
  created_at ${NOW}
);

CREATE TABLE survey_container (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  survey_id INTEGER NOT NULL REFERENCES entomological_survey(id) ON DELETE CASCADE,
  location TEXT NOT NULL CHECK (location IN ('indoor','outdoor','natural')),
  container_type TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  with_cover INTEGER NOT NULL CHECK (with_cover >= 0),
  without_cover INTEGER NOT NULL CHECK (without_cover >= 0),
  positive INTEGER NOT NULL CHECK (positive >= 0),
  larvae_count INTEGER NOT NULL DEFAULT 0 CHECK (larvae_count >= 0),
  pupae_count INTEGER NOT NULL DEFAULT 0 CHECK (pupae_count >= 0),
  created_at ${NOW},
  CHECK (positive <= total),
  CHECK (with_cover + without_cover = total)
);

CREATE TABLE alert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barangay_id ${BARANGAY},
  level TEXT NOT NULL CHECK (level IN ('low','moderate','elevated','high')),
  issued_at TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at ${NOW}
);

CREATE TABLE event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('decision','import','submission','weather','params','alert')),
  text TEXT NOT NULL,
  created_at ${NOW}
);

CREATE INDEX idx_case_barangay_week ON case_record (barangay_id, iso_week);
CREATE INDEX idx_answer_barangay_date ON daily_answer (barangay_id, date);
CREATE INDEX idx_report_barangay_date ON household_report (barangay_id, date);
CREATE INDEX idx_survey_barangay_date ON entomological_survey (barangay_id, survey_date);
CREATE INDEX idx_score_barangay_time ON threat_score (barangay_id, computed_at);
CREATE INDEX idx_task_bhw ON field_task (bhw_id, status);
CREATE INDEX idx_alert_barangay_time ON alert (barangay_id, issued_at);
CREATE INDEX idx_event_time ON event_log (at);
`;

export const MIGRATIONS: Migration[] = [{ name: "001_init", sql: INIT }];
