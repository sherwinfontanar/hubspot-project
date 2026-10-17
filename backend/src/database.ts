
import dotenv from "dotenv";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Load the project's root .env file.
dotenv.config({
  path: path.resolve(process.cwd(), "../.env"),
});

const configuredPath = process.env.DATABASE_PATH ?? "./data/orders.db";
const databasePath = path.resolve(process.cwd(), configuredPath);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending', 'processing', 'success', 'failed')
    ),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    contact_id TEXT,
    deal_id TEXT,
    error_message TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );


  
  DROP INDEX IF EXISTS idx_sync_attempts_order_id;

  CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_attempts_order_id
    ON sync_attempts(order_id);


  CREATE INDEX IF NOT EXISTS idx_sync_attempts_created_at
    ON sync_attempts(created_at DESC);
`);

const columns = db.prepare("PRAGMA table_info(sync_attempts)").all() as {
    name: string;
    }[];

    if (!columns.some((column) => column.name === "payload_json")) {
    db.exec("ALTER TABLE sync_attempts ADD COLUMN payload_json TEXT");
    }

export default db;
