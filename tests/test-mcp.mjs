import { discoverTools, callTool } from '../mcp/client.js';

const toolPool = await discoverTools();
console.log('Tools ditemukan:', toolPool.map(t => t.name));

if (toolPool.length === 0) {
  console.error('Tidak ada tool — cek koneksi MCP');
  process.exit(1);
}

const result = await callTool('summarize', { teks: 'Ini adalah teks panjang yang ingin diringkas menjadi poin-poin penting.', mode: 'poin' }, toolPool);
console.log('Hasil summarize:');
console.log(result);