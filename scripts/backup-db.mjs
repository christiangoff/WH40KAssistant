#!/usr/bin/env node
// Snapshot the SQLite DB + uploaded files to an external drive.
//
// - Uses SQLite's online backup API, so it is safe to run while the app is
//   writing (a plain `cp` of a WAL database can capture a torn state).
// - Refuses to run unless the backup drive is actually mounted, so a missing
//   USB drive never causes "backups" to silently pile up on the SD card.
// - Prunes snapshots older than BACKUP_RETAIN_DAYS.
//
// Env:
//   BACKUP_DIR           destination directory   (default /mnt/backup/warhammer)
//   BACKUP_RETAIN_DAYS   keep snapshots this many days (default 30)
//
// Run from the repo root:  node scripts/backup-db.mjs

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const DB_PATH = path.join(APP_DIR, "data", "warhammer.db");
const DEST = process.env.BACKUP_DIR ?? "/mnt/backup/warhammer";
const RETAIN_DAYS = Number(process.env.BACKUP_RETAIN_DAYS ?? 30);

function die(msg) {
  console.error(`[backup] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) die(`database not found at ${DB_PATH}`);

// Guard: the parent of DEST must contain a `.backup-drive` marker file.
// Create it once, on the drive, during setup: `touch /mnt/backup/.backup-drive`
// If the drive is not mounted the marker is gone and we bail out.
const driveRoot = path.dirname(DEST);
const sentinel = path.join(driveRoot, ".backup-drive");
if (!fs.existsSync(sentinel)) {
  die(`marker ${sentinel} missing — backup drive not mounted? aborting.`);
}

fs.mkdirSync(DEST, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // 2026-09-03T03-15-00
const snap = path.join(DEST, `warhammer-${stamp}.db`);

// 1. Consistent DB snapshot.
const db = new Database(DB_PATH, { readonly: true });
try {
  await db.backup(snap);
} finally {
  db.close();
}

// 2. Compress it, drop the raw copy.
await pipeline(createReadStream(snap), createGzip(), createWriteStream(`${snap}.gz`));
fs.rmSync(snap);

// 3. Archive uploaded files (everything under data/ that isn't the DB).
const uploads = path.join(DEST, `uploads-${stamp}.tar.gz`);
execFileSync("tar", [
  "czf", uploads,
  "--exclude=*.db", "--exclude=*.db-wal", "--exclude=*.db-shm",
  "-C", APP_DIR, "data",
]);

// 4. Prune old snapshots.
const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
let pruned = 0;
for (const name of fs.readdirSync(DEST)) {
  if (!/^(warhammer|uploads)-.*\.(gz)$/.test(name)) continue;
  const p = path.join(DEST, name);
  if (fs.statSync(p).mtimeMs < cutoff) {
    fs.rmSync(p);
    pruned++;
  }
}

const size = (fs.statSync(`${snap}.gz`).size / 1024).toFixed(0);
console.log(`[backup] ok — ${path.basename(snap)}.gz (${size} KiB), pruned ${pruned}, dest ${DEST}`);
