// lib/commands/connect.js - /connect command handler: MCP plugin manager

import { listConnections, addConnection, toggleConnection } from '../../mcp/registry.js';
import { CATALOG } from '../../mcp/catalog/index.js';
import { print, printBlock } from '../ui.js';

/**
 * Handle /connect command.
 * @param {string} arg - argumen setelah "/connect " (bisa string kosong)
 * @returns {boolean} true kalau state connector berubah (perlu rediscover tools)
 */
export async function handleConnect(arg) {
  const parts = (arg || '').trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] || '').toLowerCase();

  // /connect (tanpa argumen) — tampilkan active connectors + sisa catalog
  if (!sub) {
    const active = listConnections();
    print('connect', 'Connector kamu:');
    if (active.length === 0) {
      printBlock('(belum ada connector ditambahkan)');
    } else {
      active.forEach(c => {
        const status = c.active ? 'ON ' : 'OFF';
        printBlock(`[${status}] ${c.name} — ${c.url}  (${c.tools.length} tools)`);
      });
    }

    const known = new Set(active.map(c => c.name));
    const remaining = CATALOG.filter(c => c.url && !known.has(c.name));
    printBlock('');
    print('connect', 'Catalog (belum ditambahkan):');
    if (remaining.length === 0) {
      printBlock('(kosong, atau semua sudah ditambahkan)');
    } else {
      remaining.forEach(c => printBlock(`${c.name} — ${c.description}`));
    }

    print('info', '/connect add <url>  |  /connect toggle <name>');
    return false;
  }

  // /connect add <url>
  if (sub === 'add') {
    const url = parts[1];
    if (!url) {
      print('warn', 'butuh url. contoh: /connect add https://example.com/mcp');
      return false;
    }
    const known = CATALOG.find(c => c.url === url);
    const name = known ? known.name : url.replace(/^https?:\/\//, '').split('/')[0];
    const conn = addConnection({ name, url, active: true });
    print('connect', `${conn.name} ditambahkan (${conn.url}).`);
    return true;
  }

  // /connect toggle <name>
  if (sub === 'toggle') {
    const name = parts.slice(1).join(' ');
    if (!name) {
      print('warn', 'butuh nama connector persis. contoh: /connect toggle K\'s Tools');
      return false;
    }
    try {
      const status = toggleConnection(name);
      print('connect', `${name} sekarang ${status ? 'ON' : 'OFF'}.`);
      return true;
    } catch (err) {
      print('warn', err.message);
      return false;
    }
  }

  print('warn', `subcommand tidak dikenal: "${sub}". pakai: add, toggle, atau tanpa argumen.`);
  return false;
}
