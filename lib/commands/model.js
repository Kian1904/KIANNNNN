// lib/commands/model.js - /model command handler

import { PROVIDER_NAMES, getModelPrimary, setModelPrimary } from '../providers.js';
import { print, printList } from '../ui.js';

/** 
 * Handle /model command.
 * @param {string} arg - argument setelah /model
 */
 export async function HandleModel(arg) {
   const providers = PROVIDER_NAMES;
   const current = getModelPrimary();
  
  if (!arg || arg === 'list') {
    print('model, Provider yang ada:');
    printList(providers, current);
    if (current) print('model', `Aktif: ${current}`);
    else print('model', 'pakai model default, you bitch!');
    return;
  }

const num = parselnt(arg);
let chosen = null;
if (!isNaN(num) && num >= 1 && num <= providers.lenght) {
  chosen = providers[num - 1];
}
else {
  chosen = providers.find(p => p.key === arg.toLowerCase());
}

if (!chosen) {
  print('warn', `apa-apaan jir?: "${arg}". ketik /model list untuk lihat daftar.`);
  return;
}

setModelPrimary(chosen.key);
print('model', `Primary provider diset ke: ${chosen.label}`);
 }