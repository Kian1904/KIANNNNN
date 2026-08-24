// lib/utils/fs.js - File system utillities

import fs from 'fs';

/**
 * Baca file dengan aman, return placeholder kalau tidak ada
 * @param {string|null} target
 * @returns {string}
 */
 export function readFileSafe(target) {
   if (!target || !fs.existsSync(target)) return '(file lo mana oon? gak ketemu jirr)';
   return fs.readFileSync(target, 'utf8');
 }
 
 /**
  * List isi direktori.
  * @param {string|null} target
  * @returns {string}
  */
  export function listDirSafe(target) {
    const dir = (target || '.').trim();
    if (!fs.existsSync(dir)) return `(direktori '${dir}' gak ada bro)`;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (entries.length === 0) return '(kosong)';
      return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n');
       }
    catch (err) {
      return `(error baca direktori: ${err.message})`;
    }
  }

/**
 * load AGENT.md dari root project.
 * @returns {string|null}
 */
 export function loadAgentMd() {
   const path = './AGENT.md';
   if (!fs.existsSync(path)) return null;
   return fs.readFileSync(path, 'utf8');
 }
 