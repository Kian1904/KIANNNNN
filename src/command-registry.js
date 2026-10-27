// M63: CLI command registry — semua command terdaftar di satu tempat.
// Written by K'

export const COMMANDS = [
  { name: '/squad', desc: 'rencana squad → review → eksekusi' },
  { name: '/plan', desc: 'lihat rencana tanpa eksekusi' },
  { name: '/agent', desc: 'pilih/daftar agent' },
  { name: '/mode', desc: 'mode approval: safe | wellwell | yolo' },
  { name: '/route', desc: 'auto-routing: on | off | test' },
  { name: '/rollback', desc: 'restore file ke snapshot' },
  { name: '/model', desc: 'switch model' },
  { name: '/usage', desc: 'statistik sesi' },
  { name: '/connect', desc: 'kelola MCP connector' },
  { name: '/auth', desc: 'kelola API key' },
  { name: '/status', desc: 'status task aktif' },
  { name: '/history', desc: 'lihat history task' },
  { name: '/stop', desc: 'hentikan task' },
  { name: '/resume', desc: 'lanjutkan task' },
  { name: '/retry', desc: 'ulang task' },
  { name: '/replan', desc: 'susun ulang rencana' },
  { name: '/save', desc: 'simpan session' },
  { name: '/load', desc: 'load session' },
  { name: '/reset', desc: 'reset session' },
  { name: '/help', desc: 'tampilkan bantuan' },
  { name: '/exit', desc: 'keluar' },
];

export function getCommandList() {
  return [...COMMANDS];
}

export function isRegisteredCommand(name) {
  return COMMANDS.some(c => c.name === name);
}
