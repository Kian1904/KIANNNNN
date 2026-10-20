// tests/test-mcp-catalog.mjs — Kontrak mcp/catalog (resolveCatalog + findInCatalog).
//
// Yang dites:
//   - entry tanpa env → TIDAK muncul (jangan tawarin connector mati)
//   - entry dengan env → muncul lengkap (id, name, url, description)
//   - envKeyVar dibaca; kalau gak ada → null
//   - findInCatalog by id (ada / gak ada)
//   - file duplikat lama (mcp-catalog-index.js) udah gak ada
//
// Written by K-sRouter

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function check(label, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`); }
}
function finish() {
  console.log(`\n=== HASIL MCP-CATALOG: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const { CATALOG, resolveCatalog, findInCatalog } = await import('../mcp/catalog/index.js');

console.log('\n[1] Struktur catalog');
check('CATALOG berupa array', Array.isArray(CATALOG));
check('ada minimal 1 entry', CATALOG.length >= 1, `jumlah=${CATALOG.length}`);
check('tiap entry punya id', CATALOG.every(c => typeof c.id === 'string' && c.id.length > 0));
check('tiap entry punya envUrlVar', CATALOG.every(c => typeof c.envUrlVar === 'string' && c.envUrlVar.length > 0));

console.log('\n[2] resolveCatalog — env KOSONG');
const empty = resolveCatalog({});
check('entry tanpa env dibuang', empty.length === 0, `dapat ${empty.length}`);
check('gak ada url hardcoded di source ktools',
  CATALOG.find(c => c.id === 'ktools')?.url === null,
  String(CATALOG.find(c => c.id === 'ktools')?.url));

console.log('\n[3] resolveCatalog — env TERISI');
const filled = resolveCatalog({ MCP_SERVER_URL: 'https://contoh.test/mcp' });
check('entry muncul', filled.length === 1, `dapat ${filled.length}`);
check('url dari env kepake', filled[0]?.url === 'https://contoh.test/mcp', String(filled[0]?.url));
check('id ikut kebawa', filled[0]?.id === 'ktools', String(filled[0]?.id));
check('name ikut kebawa', filled[0]?.name === "K's Tools", String(filled[0]?.name));
check('description ikut kebawa', typeof filled[0]?.description === 'string' && filled[0].description.length > 0);
check('apiKey null kalau env key kosong', filled[0]?.apiKey === null, String(filled[0]?.apiKey));

console.log('\n[4] resolveCatalog — env API key ikut');
const withKey = resolveCatalog({
  MCP_SERVER_URL: 'https://contoh.test/mcp',
  MCP_SERVER_API_KEY: 'rahasia-123',
});
check('apiKey kebaca dari env', withKey[0]?.apiKey === 'rahasia-123', String(withKey[0]?.apiKey));

console.log('\n[5] findInCatalog');
check('id ada → objek', findInCatalog('ktools')?.id === 'ktools');
check('id ngawur → null', findInCatalog('gak-ada') === null);

console.log('\n[6] Bersih-bersih file duplikat');
const dup = path.join(REPO_ROOT, 'mcp', 'catalog', 'mcp-catalog-index.js');
check('mcp-catalog-index.js (duplikat lama) udah dihapus', !fs.existsSync(dup));

finish();
