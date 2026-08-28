# INSTRUKSI UNTUK QWEN CODE — Restructure + Provider Registry + /auth command

Baca `SPEC.md` di root repo dulu sebelum mulai. Ini kerjaan gabungan 3 hal:
M12 (extended MAX_LOOPS), restructure folder (lib/ → src/, flatten commands),
dan provider registry berbasis JSON + command `/auth` (biar provider bisa
di-manage dari dalam CLI, gak perlu edit file+commit+push+git pull tiap ganti
provider).

## 1. M12 — Extended MAX_LOOPS (paling gampang, kerjain duluan)

Di file entry utama (bekas `index.js`, lokasi baru terserah hasil restructure
poin 2), cari:
```js
const MAX_LOOPS = 20;
```
Ganti:
```js
const MAX_LOOPS = parseInt(process.env.MAX_LOOPS) || 25;
```
Tambah di `.env`: `MAX_LOOPS=25`

## 2. Restructure folder: lib/ → src/, flatten commands

Rename folder `lib/` jadi `src/`. Update SEMUA import path di semua file yang
nunjuk ke `./lib/...` atau `../lib/...` jadi `./src/...` atau `../src/...`
(termasuk di index.js/entry utama, tests/, bin/kian kalau ada referensi).

Flatten `lib/commands/*.js` → `src/commands/*.js` (nama file sama, cuma folder
induknya berubah dari `lib` ke `src` — TIDAK perlu diratain lebih jauh dari itu,
`src/commands/model.js` dst tetap oke, yang penting bukan `lib/commands/`).

Pecah entry utama (index.js) yang sekarang isinya ratusan baris nyampur jadi:
- `src/run-task.js` — isi fungsi runTask() (loop ReAct: edit/bash/mcp_call/
  web_search/dst)
- `src/run-casual.js` — isi fungsi runCasual()
- `src/repl.js` — semua handler `/command` di REPL loop (termasuk /auth yang
  bakal ditambah di poin 3)
- `index.js` (tetap di root, JANGAN dipindah — entry point harus di root biar
  package.json `main` gak perlu berubah) — isinya cuma: import ketiga file di
  atas, setup awal (dotenv config, dst), panggil REPL loop. Target: di bawah
  50 baris.

Setelah rename, jalanin `node --check` ke semua file yang kena sentuh + jalanin
`tests/smoke-plan.mjs` buat mastiin gak ada broken import.

## 3. Provider registry berbasis JSON + command /auth

### Kenapa
Provider config sekarang hardcode di `src/providers.js` (bekas lib/providers.js).
Setiap mau tambah/ganti/hapus provider, user harus edit file, commit, push,
lalu git pull di Termux. User pengen ini SIMPLE kayak /connect (MCP) yang
udah ada — provider bisa di-manage dari command CLI langsung, TANPA edit file.

### PENTING — pelajaran dari masalah Qwen Code punya user (settings.json rawan
corrupt kalau typo manual): JANGAN PERNAH nyuruh user edit JSON manual. Semua
operasi (add/remove/update) WAJIB lewat command, dan WAJIB pakai pola
"validate dulu baru overwrite" — jangan pernah nulis langsung ke file asli
tanpa validasi, biar 1 kesalahan gak ngerusak semua data provider yang lain.

### File: `src/providers-registry.js` (baru)
Simpan di `~/.krouter_data/providers.json`. Array of objects:
```json
[
  {
    "name": "xkiro-coder",
    "baseUrl": "https://api.xkiro.example/v1",
    "apiKey": "sk-xxxx",
    "model": "qwen/qwen3-coder-plus",
    "active": true
  }
]
```
Catatan penting soal `baseUrl`: user cuma ngasih URL sampai `/v1` doang (TANPA
`/chat/completions` di belakangnya) — path `/chat/completions` (atau endpoint
yang sesuai) ditambahin otomatis di kode pas manggil API, user gak perlu tau
detail itu.

Fungsi yang dibutuhkan (pola sama persis kayak `mcp/registry.js`):
- `loadProviders()` — baca file, kalau belum ada, seed dari daftar 7 provider
  default yang sekarang hardcode di providers.js (biar fresh install tetap
  punya provider bawaan tanpa harus /auth add manual satu-satu)
- `saveProviders(list)` — WAJIB pola atomic write: `JSON.stringify(list)` dulu,
  validasi hasil stringify bisa di-`JSON.parse` balik tanpa error, baru ditulis
  ke file TEMPORARY (`providers.json.tmp`), baru di-rename ke `providers.json`
  asli. Ini mencegah file asli rusak kalau proses ke-interrupt di tengah nulis.
- `addProvider({name, baseUrl, apiKey, model})` — push ke array, saveProviders()
- `removeProvider(name)` — filter keluar entry dengan nama itu doang, sisanya
  utuh, saveProviders()
- `setPrimary(name)` — reorder array biar entry ini di depan (jadi provider
  pertama yang dicoba di cascade), saveProviders()
- `updateApiKey(name, newKey)` — cari entry by name, update field apiKey aja,
  saveProviders()

### Command: `/auth` (di src/repl.js atau src/commands/auth.js — pola sama
kayak connect.js)
- `/auth` (tanpa argumen) — list semua provider ke-configure + tandain mana
  yang primary/aktif duluan di cascade
- `/auth add <nama> <baseUrl> <apiKey> [model]` — tambah provider baru
- `/auth remove <nama>` — hapus SATU provider by nama, sisanya gak kesentuh
- `/auth use <nama>` — jadiin provider ini yang dicoba PERTAMA di cascade
- `/auth key <nama> <apiKey_baru>` — ganti API key provider yang udah ada,
  tanpa harus remove+add ulang

### Integrasi ke providers.js (cascade logic)
`src/providers.js` yang sekarang isinya array hardcoded provider, diubah baca
dari `providers-registry.js` (`loadProviders()`) alih-alih array statis di
kode. Command `/model` yang udah ada sebelumnya TETEP jalan seperti biasa
(switch primary provider sementara buat sesi ini doang), sedangkan `/auth use`
itu ngubah URUTAN PERMANEN di file JSON (persisten lintas sesi).

## Setelah semua selesai
Update SPEC.md: centang M12, tambah entry arsitektur baru soal provider
registry + /auth (contoh format udah ada di section "MCP architecture" buat
dicontoh gaya penulisannya), dan tulis di NEXT SESSION START POINT bahwa
restructure + provider registry ini sudah selesai divalidasi (atau catat kalau
ada yang belum sempat ditest).
