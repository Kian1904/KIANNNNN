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

// /connect add <url>                — nama otomatis dari catalog/hostname
  // /connect add <name...> <url>      — nama custom (spasi boleh di nama)
  if (sub === 'add') {
    let rest = parts.slice(1);
    let apiKey;
   const keyFlagdIx = rest.findIndex(p => p.startsWith(--'key='));
   if (keyFladIdx >= 0) {
     apiKey = rest[keyFlagIdx].slice('--key='.length);
     rest = rest.filter((_, i) => i !== keyFladIdx);
   }
    if (rest.length === 0) {
      print('warn', 'butuh url. contoh: /connect add https://example.com/mcp');
      print('info', 'nama custom: /connect add My Server https://example.com/mcp --key=abc123');
      return false;
    }

    const url = rest[rest.length - 1];
    if (!/^https?:\/\//i.test(url)) {
      print('warn', `bagian terakhir (selain --key=) harus url (http/https): "${url}"`);
      return false;
    }

    const customName = rest.slice(0, -1).join(' ').trim();
    const known = CATALOG.find(c => c.url === url);
    const name = customName || (known ? known.name : url.replace(/^https?:\/\//, '').split('/')[0]);

    const existing = listConnections().find(c => c.name === name);
    if (existing && existing.url !== url) {
      print('warn', `nama "${name}" udah dipakai connector lain (${existing.url}). Pakai nama beda.`);
      return false;
    }

    const conn = addConnection({ name, url, active: true, apiKey });
    print('connect', `${conn.name} ditambahkan (${conn.url})${apiKey}.`);
    return true;
  }
  
  // /connect key <name> <apiKey>
  if (sub === 'key') {
    const apiKey = parts[parts.length - 1];
    const name = parts.slice(1, -1).join(' ').trim();
    if (!name || !apiKey || parts.length < 3) { print('warn', 'contoh: /connect key K\'s Tools abc123token');
      return false;
    }
  }
  const existing = listConnections().find( c => c.name === name);
  if (!existing) { print('warn', `connector "${name}" tidak ditemukan.`);
    return false;
  }
  addConnection({ name: existing.name, url: existing.url, active: existing.active, apiKey });
  print('connect', `API key untuk ${name} diupdate.`);
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
