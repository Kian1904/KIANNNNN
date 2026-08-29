// src/repl.js — Main REPL shell loop and CLI router

import readline from 'readline';
import fs from 'fs';
import { askWithFallback, PROVIDER_NAMES, setModelPrimary, getModelPrimary } from './providers.js';
import { runCasual } from './run-casual.js';
import { runTask } from './run-task.js';
import { discoverTools } from '../mcp/client.js';
import { print, printBlock, printUserMessage, printAssistantMessage, printSystemMessage, header, sep, blank, PROMPT, completer } from './ui.js';
import * as tui from './tui.js';
import { classifyIntent } from './intent.js';
import { readFileSafe, loadAgentMd } from './utils/fs.js';
import { handleModel } from './commands/model.js';
import { handleUsage } from './commands/usage.js';
import { handleConnect } from './commands/connect.js';
import { handleAuth } from './commands/auth.js'; // BARU

const DEBUG = process.argv.includes('--debug');
const dbg = (...args) => { if (DEBUG) console.log('[DEBUG:repl]', ...args); };

// Session allowed (stateful authorization per session)
const sessionAllowed = new Set();

const ALWAYS_ASK_PATTERNS = [
  /\brm\b/, /\bsudo\b/, /\bchmod\b/, /\bdd\b/,
  /\bnpm\s+uninstall\b/, /\bpkg\s+uninstall\b/, /\bkill\b/
];

function isDangerous(command) {
  return ALWAYS_ASK_PATTERNS.some(p => p.test(command));
}

// Initialize TUI state
tui.setCursorVisible(false);
tui.clearScreen();

// Fungsi untuk menampilkan chat box animasi saat processing
export async function showTypingAnimation(message) {
  const animOutput = await tui.typingAnimation(message, 30);
  process.stdout.write(animOutput);
}

export { sessionAllowed };