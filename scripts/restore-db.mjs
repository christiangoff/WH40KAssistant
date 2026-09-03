#!/usr/bin/env node
// Restore the SQLite DB from a snapshot produced by backup-db.mjs.
//
// Usage:
//   node scripts/restore-db.mjs /mnt/backup/warhammer/warhammer-2026-09-03T03-15-00.db.gz
//
// Stops here: this only restores the database file. Uploaded files come from
// the matching uploads-*.tar.gz — extract that by hand with:
//   tar xzf uploads-<stamp>.tar.gz -C <repo root>
//
// The app must be stopped first:  sudo systemctl stop warhammer

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_PATH = path.join(APP_DIR, "data", "warhammer.db");

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/restore-db.mjs <path-to-warhammer-*.db.gz>");
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`[restore] not found: ${src}`);
  process.exit(1);
}

// Refuse to run while the app holds the DB open (WAL file present + recent).
const wal = `${DB_PATH}-wal`;
if (fs.existsSync(wal) && fs.statSync(wal).size > 0) {
  console.error(`[restore] ${wal} is non-empty — stop the app first: sudo systemctl stop warhammer`);
  process.exit(1);
}

// Move the current DB aside rather than clobbering it.
if (fs.existsSync(DB_PATH)) {
  const aside = `${DB_PATH}.pre-restore-${Date.now()}`;
  fs.renameSync(DB_PATH, aside);
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(DB_PATH + ext)) fs.rmSync(DB_PATH + ext);
  }
  console.log(`[restore] moved existing db to ${path.basename(aside)}`);
}

const out = src.endsWith(".gz") ? DB_PATH : null;
if (out) {
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(DB_PATH));
} else {
  fs.copyFileSync(src, DB_PATH);
}

console.log(`[restore] restored ${DB_PATH} from ${path.basename(src)}`);
console.log("[restore] now start the app: sudo systemctl start warhammer");
