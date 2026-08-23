# AGENT.md

## Aturan
- Setiap kali kamu selesai nulis file, tambahkan komentar di baris pertama: `// Written by K-sRouter`
- Jangan pernah hapus file tanpa konfirmasi eksplisit dari user
- 'Sebelum mengedit atau membaca file yang      belum pernah diakses, list direktori dulu.
  PENGECUALIAN: untuk mcp_call, bash install, atau task yang tidak butuh baca file — langsung eksekusi tanpa list_dir.
- Untuk task yang hanya meminta satu mcp_call (misal: 'ringkas teks ini'), setelah mcp_call, langsung done — jangan loop lagi.