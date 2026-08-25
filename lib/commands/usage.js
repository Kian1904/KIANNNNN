// lib/commands/usage.js - /usage command handler

import { print, printBlock } from '../ui.js'

/**
 * Handle /usage command.
 * @param {{ tasks: number, llmCalls: number, byProvider: Object, byAction: Object }} 
 */
 export function handleUsage(stats) {
   print('usage', 'Per provider:');
   Object.entries(stats.byProvider)
   .sort((a, b) => b[1] - a[1])
   .forEach(([name, count]) => printBlock(`${name}: ${count}`, 6));
 }
 
 if (Object.keys(stats.byAction).length > 0) {
   print('usage', 'Per action:');
   Object.entries(stats.byAction)
   .sort((a, b) => b[1] - a[1])
   .forEach(([action, count]) => printBlock(`${action}: ${count}`, 6));
 }