import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "warhammer.db");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  const database = db;

  database.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      faction TEXT,
      wahapedia_url TEXT,
      quantity INTEGER DEFAULT 1,
      stats_json TEXT,
      stats_fetched_at INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS armies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      point_limit INTEGER DEFAULT 2000,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS army_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      army_id INTEGER REFERENCES armies(id) ON DELETE CASCADE,
      unit_id INTEGER REFERENCES units(id),
      model_count INTEGER DEFAULT 1,
      custom_points INTEGER
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      army_id INTEGER REFERENCES armies(id),
      opponent TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      cp_start INTEGER DEFAULT 0,
      cp_current INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS match_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
      army_unit_id INTEGER REFERENCES army_units(id),
      unit_name TEXT,
      max_wounds INTEGER,
      current_wounds INTEGER,
      is_destroyed INTEGER DEFAULT 0
    );
  `);

  // Army squads table
  database.exec(`
    CREATE TABLE IF NOT EXISTS army_squads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      army_id INTEGER NOT NULL REFERENCES armies(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
  `);

  // Migrate army_units: add squad_id if missing
  const auCols = database.pragma("table_info(army_units)") as { name: string }[];
  if (!auCols.find((c) => c.name === "squad_id")) {
    database.exec(`ALTER TABLE army_units ADD COLUMN squad_id INTEGER REFERENCES army_squads(id) ON DELETE SET NULL`);
  }
  if (!auCols.find((c) => c.name === "selected_weapons")) {
    database.exec(`ALTER TABLE army_units ADD COLUMN selected_weapons TEXT`);
  }
  if (!auCols.find((c) => c.name === "label")) {
    database.exec(`ALTER TABLE army_units ADD COLUMN label TEXT`);
  }

  // Migrate matches: add VP, round, phase columns if missing
  const mCols = database.pragma("table_info(matches)") as { name: string }[];
  if (!mCols.find((c) => c.name === "vp")) {
    database.exec(`ALTER TABLE matches ADD COLUMN vp INTEGER DEFAULT 0`);
  }
  if (!mCols.find((c) => c.name === "vp_opponent")) {
    database.exec(`ALTER TABLE matches ADD COLUMN vp_opponent INTEGER DEFAULT 0`);
  }
  if (!mCols.find((c) => c.name === "round")) {
    database.exec(`ALTER TABLE matches ADD COLUMN round INTEGER DEFAULT 1`);
  }
  if (!mCols.find((c) => c.name === "phase")) {
    database.exec(`ALTER TABLE matches ADD COLUMN phase TEXT DEFAULT 'Command'`);
  }
  if (!mCols.find((c) => c.name === "active_player")) {
    database.exec(`ALTER TABLE matches ADD COLUMN active_player TEXT DEFAULT 'mine'`);
  }

  // Migrate armies: add faction if missing
  const armyCols = database.pragma("table_info(armies)") as { name: string }[];
  if (!armyCols.find((c) => c.name === "faction")) {
    database.exec(`ALTER TABLE armies ADD COLUMN faction TEXT`);
  }

  // Migrate army_units: add detachment if missing
  if (!auCols.find((c) => c.name === "detachment")) {
    database.exec(`ALTER TABLE army_units ADD COLUMN detachment TEXT`);
  }

  // Users, sessions, invite codes
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      used_by INTEGER REFERENCES users(id),
      used_at INTEGER,
      created_at INTEGER
    );
  `);

  // Migrate units + armies: add user_id
  const uCols = database.pragma("table_info(units)") as { name: string }[];
  if (!uCols.find((c) => c.name === "user_id")) {
    database.exec(`ALTER TABLE units ADD COLUMN user_id INTEGER REFERENCES users(id)`);
  }
  if (!armyCols.find((c) => c.name === "user_id")) {
    database.exec(`ALTER TABLE armies ADD COLUMN user_id INTEGER REFERENCES users(id)`);
  }
}

export default getDb;
