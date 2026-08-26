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
  
  // Check if table exists and migrate if needed
  const tables = _db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations', 'conversation_threads');").all();
  const hasConversationsTable = tables.some(t => t.name === 'conversations');
  const hasThreadsTable = tables.some(t => t.name === 'conversation_threads');
  
  // Create tables if they don't exist
  if (!hasThreadsTable) {
    _db.exec(`
      CREATE TABLE conversation_threads (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        title        TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  
  if (!hasConversationsTable) {
    _db.exec(`
      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id    INTEGER NOT NULL DEFAULT 1,
        role         TEXT NOT NULL DEFAULT 'user',
        content      TEXT NOT NULL,
        action_type  TEXT,
        detail       TEXT,
        reasoning    TEXT,
        approved     INTEGER,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE
      )
    `);
  } else {
    // Check kolom yang mungkin belum ada (migrasi incremental dari schema lama)
    const columns = _db.prepare("PRAGMA table_info(conversations)").all();
    const colNames = columns.map(col => col.name);

    if (!colNames.includes('thread_id')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN thread_id INTEGER NOT NULL DEFAULT 1");
    }
    if (!colNames.includes('role')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    }
    if (!colNames.includes('action_type')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN action_type TEXT");
    }
    if (!colNames.includes('detail')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN detail TEXT");
    }
    if (!colNames.includes('reasoning')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN reasoning TEXT");
    }
    if (!colNames.includes('approved')) {
      _db.exec("ALTER TABLE conversations ADD COLUMN approved INTEGER");
    }
  }
  
  // Create other tables if they don't exist
  if (!_db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_decisions';").get()) {
    _db.exec(`
      CREATE TABLE agent_decisions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        context    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  
  if (!_db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_learning';").get()) {
    _db.exec(`
      CREATE TABLE agent_learning (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        summary    TEXT NOT NULL,
        source_ids TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }
  
  if (!_db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshots';").get()) {
    _db.exec(`
      CREATE TABLE snapshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath   TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  return _db;
}

export function createThread(title = null) {
  const db = _open();
  const result = db.prepare(`
    INSERT INTO conversation_threads (title)
    VALUES (@title)
  `).run({ title: title || null });
  return result.lastInsertRowid;
}

export function getThread(threadId) {
  const db = _open();
  return db.prepare(`
    SELECT * FROM conversation_threads WHERE id = ?
  `).get(threadId);
}

export function updateThreadTitle(threadId, title) {
  const db = _open();
  return db.prepare(`
    UPDATE conversation_threads SET title = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, threadId);
}

export function logStep({ threadId, role, content, actionType, detail, reasoning, approved }) {
  const db = _open();
  return db.prepare(`
    INSERT INTO conversations (thread_id, role, content, action_type, detail, reasoning, approved)
    VALUES (@threadId, @role, @content, @actionType, @detail, @reasoning, @approved)
  `).run({
    threadId,
    role,
    content,
    actionType: actionType || null,
    detail: detail ? JSON.stringify(detail) : null,
    reasoning: reasoning || null,
    approved: approved !== undefined ? (approved ? 1 : 0) : null
  });
}

export function getConversation(threadId, limit = 50) {
  const db = _open();
  // Check if thread_id column exists to determine query structure
  const columns = db.prepare("PRAGMA table_info(conversations)").all();
  const hasThreadIdColumn = columns.some(col => col.name === 'thread_id');

  if (hasThreadIdColumn) {
    return db.prepare(`
      SELECT * FROM conversations WHERE thread_id = ? ORDER BY id ASC LIMIT ?
    `).all(threadId, limit);
  } else {
    // Fallback for old structure without thread_id
    // Ensure role column is included with default 'user' value
    const oldColumns = db.prepare("PRAGMA table_info(conversations)").all();
    const hasRoleColumn = oldColumns.some(col => col.name === 'role');
    
    const selectSql = hasRoleColumn
      ? `SELECT *, 1 as thread_id FROM conversations ORDER BY id ASC LIMIT ?`
      : `SELECT id, 1 as thread_id, 'user' as role, content FROM conversations ORDER BY id ASC LIMIT ?`;
    
    return db.prepare(selectSql).all(limit);
  }
}

export function getRecentConversations(limit = 10) {
  const db = _open();
  // Check if thread_id column exists to determine query structure
  const columns = db.prepare("PRAGMA table_info(conversations)").all();
  const hasThreadIdColumn = columns.some(col => col.name === 'thread_id');
  
  if (hasThreadIdColumn) {
    return db.prepare(`
      SELECT c.*, ct.title as thread_title
      FROM conversations c
      JOIN conversation_threads ct ON c.thread_id = ct.id
      ORDER BY c.id DESC LIMIT ?
    `).all(limit);
  } else {
    // Fallback for old structure without thread_id
    return db.prepare(`
      SELECT c.*, NULL as thread_title, 1 as thread_id
      FROM conversations c
      ORDER BY c.id DESC LIMIT ?
    `).all(limit);
  }
}

export function getAllThreads(limit = 20) {
  const db = _open();
  return db.prepare(`
    SELECT * FROM conversation_threads ORDER BY updated_at DESC LIMIT ?
  `).all(limit);
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

export function deleteThread(threadId) {
  const db = _open();
  return db.prepare(`DELETE FROM conversation_threads WHERE id = ?`).run(threadId);
}