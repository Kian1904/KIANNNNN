import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.krouter_data');
const DB_PATH = path.join(DATA_DIR, 'krouter.db');

let _db = null;

function _open() {
  if (_db) return _db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  _db = new DatabaseSync(DB_PATH);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA foreign_keys = ON');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task         TEXT NOT NULL,
      action_type  TEXT NOT NULL,
      detail       TEXT,
      reasoning    TEXT,
      approved     INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export function logStep({ task, actionType, detail, reasoning, approved }) {
  const db = _open();
  return db.prepare(`
    INSERT INTO conversations (task, action_type, detail, reasoning, approved)
    VALUES (@task, @actionType, @detail, @reasoning, @approved)
  `).run({
    task,
    actionType,
    detail: detail ? JSON.stringify(detail) : null,
    reasoning: reasoning || null,
    approved: approved ? 1 : 0
  });
}

export function getRecentConversations(limit = 10) {
  const db = _open();
  return db.prepare(`SELECT * FROM conversations ORDER BY id DESC LIMIT ?`).all(limit);
}

export function getDbPath() {
  return DB_PATH;
}
