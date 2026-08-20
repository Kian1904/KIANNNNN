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
  _db.exec(`
    CREATE TABLE IF NOT EXISTS agent_decisions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key        TEXT NOT NULL,
      value      TEXT NOT NULL,
      context    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS agent_learning (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      summary    TEXT NOT NULL,
      source_ids TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath   TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

export function saveDecision({ key, value, context }) {
  const db = _open();
  return db.prepare(`
    INSERT INTO agent_decisions (key, value, context)
    VALUES (@key, @value, @context)
  `).run({ key, value, context: context || null });
}

export function getRecentDecisions(limit = 5) {
  const db = _open();
  return db.prepare(`SELECT * FROM agent_decisions ORDER BY id DESC LIMIT ?`).all(limit);
}

export function saveSnapshot({ filepath, content }) {
  const db = _open();
  return db.prepare(`
   INSERT INTO snapshots (filepath, content)
   VALUES (@filepath, @content)
  `).run({ filepath, content });
}

export function getLatestSnapshot(filepath) {
  const db = _open();
  return db.prepare(`
   SELECT * FROM snapshots WHERE filepath = ? ORDER BY id DESC LIMIT 1`).get(filepath);
}

export function listSnapshots() {
  const db = _open();
  return db.prepare(`
   SELECT filepath, MAX(created_at) as last_snapshot, COUNT(*) as versions
   FROM snapshots GROUP BY filepath ORDER BY last_snapshot DESC`).all();
}

export function countConversations() {
  const db = _open();
  return db.prepare(`SELECT COUNT(*) as count FROM conversations`).get().count;
}

export function getOldConversations(limit) {
  const db = _open();
  return db.prepare(`SELECT * FROM conversations ORDER BY id ASC LIMIT ?`).all(limit);
}

export function deleteConversationsByIds(ids) {
  const db = _open();
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`DELETE FROM conversations WHERE id IN (${placeholders})`).run(...ids);
}

export function saveLearningSummary({ summary, sourceIds }) {
  const db = _open();
  return db.prepare(`
    INSERT INTO agent_learning (summary, source_ids)
    VALUES (@summary, @sourceIds)
  `).run({ summary, sourceIds: JSON.stringify(sourceIds) });
}