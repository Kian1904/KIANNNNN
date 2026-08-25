/**
 * mcp/catalog/index.js — Known MCP connectors.
 * Tambah entry baru di sini kalau ada connector baru yang stabil dan sering dipakai.
 * @type {{ name: string, url: string, description: string }[]}
 */
import ktools from './ktools.js';

export const CATALOG = [ktools /* tambah lainnya nanti */];
