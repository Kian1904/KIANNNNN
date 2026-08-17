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
      target_file  TEXT NOT NULL,
      instruction  TEXT NOT NULL,
      reasoning    TEXT,
      approved     INTEGER NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export function logConversation({ targetFile, instruction, reasoning, approved }) {
  const db = _open();
  return db.prepare(`
    INSERT INTO conversations (target_file, instruction, reasoning, approved)
    VALUES (@targetFile, @instruction, @reasoning, @approved)
  `).run({
    targetFile,
    instruction,
    reasoning: reasoning || null,
    approved: approved ? 1 : 0
  });
}

export function getRecentConversations(limit = 10) {
  const db = _open();
  return db.prepare(`
    SELECT * FROM conversations ORDER BY id DESC LIMIT ?
  `).all(limit);
}

export function getDbPath() {
  return DB_PATH;
}

