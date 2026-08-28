// src/commands/auth.js — Kelola provider AI via CLI (/auth)

import { addProvider, removeProvider, setPrimary, updateApiKey, loadProviders } from '../providers-registry.js';
import { print, printBlock, blank } from '../ui.js';

/**
 * Mask API key untuk display (hanya tampilkan 4 karakter terakhir)
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length <= 4) return '****';
  return 'sk-...' + key.slice(-4);
}

/**
 * Handle /auth command
 * @param {string} arg
 * @param {Function} ask
 */
export async function handleAuth(arg, ask) {
  const trimmed = (arg || '').trim();

  // /auth (tanpa argumen) — list providers
  if (!trimmed) {
    const providers = loadProviders();
    
    print('info', 'Provider terdaftar:');
    blank();
    
    providers.forEach((p, idx) => {
      const isPrimary = idx === 0;
      const marker = isPrimary ? ' ★ PRIMARY' : '';
      printBlock(
        `${idx + 1}. ${p.name.toUpperCase()}${marker}\n` +
        `   URL: ${p.baseUrl}\n` +
        `   Model: ${p.model}\n` +
        `   API Key: ${maskKey(p.apiKey)}\n` +
        `   Active: ${p.active ? 'Ya' : 'Tidak'}`,
        2
      );
    });
    
    blank();
    print('info', 'Gunakan /auth add|remove|use|key untuk mengelola provider.');
    return;
  }

  // /auth add <nama> <baseUrl> <apiKey> [model]
  if (trimmed.startsWith('add ')) {
    const parts = trimmed.slice(4).trim().split(/\s+/);
    if (parts.length < 3) {
      print('error', 'Format: /auth add <nama> <baseUrl> <apiKey> [model]');
      return;
    }

    const [name, baseUrl, apiKey, ...modelParts] = parts;
    const model = modelParts.join(' ') || 'qwen/qwen3-coder-plus';

    try {
      addProvider({ name, baseUrl, apiKey, model, active: true });
      print('ok', `Provider "${name}" berhasil ditambahkan.`);
    } catch (err) {
      print('error', `Gagal menambahkan provider: ${err.message}`);
    }
    return;
  }

  // /auth remove <nama>
  if (trimmed.startsWith('remove ')) {
    const name = trimmed.slice(7).trim();
    if (!name) {
      print('error', 'Format: /auth remove <nama>');
      return;
    }

    try {
      removeProvider(name);
      print('ok', `Provider "${name}" berhasil dihapus.`);
    } catch (err) {
      print('error', `Gagal menghapus provider: ${err.message}`);
    }
    return;
  }

  // /auth use <nama>
  if (trimmed.startsWith('use ')) {
    const name = trimmed.slice(4).trim();
    if (!name) {
      print('error', 'Format: /auth use <nama>');
      return;
    }

    try {
      setPrimary(name);
      print('ok', `Provider "${name}" sekarang adalah PRIMARY (pertama di cascade).`);
    } catch (err) {
      print('error', `Gagal set primary: ${err.message}`);
    }
    return;
  }

  // /auth key <nama> <apiKey_baru>
  if (trimmed.startsWith('key ')) {
    const parts = trimmed.slice(4).trim().split(/\s+/);
    if (parts.length < 2) {
      print('error', 'Format: /auth key <nama> <apiKey_baru>');
      return;
    }

    const [name, ...keyParts] = parts;
    const newKey = keyParts.join(' ');

    try {
      updateApiKey(name, newKey);
      print('ok', `API key untuk "${name}" berhasil diperbarui.`);
    } catch (err) {
      print('error', `Gagal update API key: ${err.message}`);
    }
    return;
  }

  // Unknown /auth subcommand
  const knownSubs = ['add', 'remove', 'use', 'key'];
  if (knownSubs.includes(trimmed)) {
    print('warn', `Subcommand "${trimmed}" butuh argumen tambahan.`);
    print('info', `Format: /auth ${trimmed} <argumen>`);
  } else {
    print('warn', `Subcommand tidak dikenal: "${trimmed}"`);
    print('info', 'Subcommand yang tersedia: add, remove, use, key');
  }
}